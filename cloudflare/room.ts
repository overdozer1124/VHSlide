import { applyAuthorizedUpdate } from "../src/authorizeUpdate.ts";
import { AccessError, parseComment } from "../src/permissions.ts";
import type { EditAccess, SlideComment } from "../src/permissions.ts";
import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import { parseDeck } from "../src/model.ts";
import type { Deck } from "../src/model.ts";
import {
  createSharedDeck,
  fromBase64,
  readSharedDeck,
  toBase64,
} from "../src/sharedDeck.ts";
import {
  body,
  checked,
  directory,
  failure,
  input,
  insist,
  internal,
  json,
  one,
  rows,
} from "./common.ts";
import type { Env, Identity } from "./common.ts";

interface Peer extends Identity {
  since: number;
  count: number;
  bytes: number;
}
const CHUNK = 64 * 1024;
/** One persistent SQLite document per work. Hibernatable sockets have no idle JS timers. */
export class SlideRoom extends DurableObject<Env> {
  private sql: SqlStorage;
  private document?: Y.Doc;
  private updates = 0;
  private lastTouched = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshot (part INTEGER PRIMARY KEY, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, slide TEXT NOT NULL, author TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS asset_chunks (asset TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(asset,part));
    `);
  }
  private id() {
    return one<{ value: string }>(
      this.sql,
      "SELECT value FROM meta WHERE key='id'",
    )?.value;
  }
  private doc() {
    if (this.document) return this.document;
    insist(this.id(), 404, "作品が見つかりません。");
    const doc = new Y.Doc();
    const parts = rows<{ data: ArrayBuffer }>(
      this.sql,
      "SELECT data FROM snapshot ORDER BY part",
    );
    const size = parts.reduce((n, p) => n + p.data.byteLength, 0),
      data = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      data.set(new Uint8Array(part.data), offset);
      offset += part.data.byteLength;
    }
    Y.applyUpdate(doc, data);
    const updates = rows<{ data: ArrayBuffer }>(
      this.sql,
      "SELECT data FROM updates ORDER BY seq",
    );
    for (const update of updates)
      Y.applyUpdate(doc, new Uint8Array(update.data));
    this.updates = updates.length;
    return (this.document = doc);
  }
  private snapshot(doc: Y.Doc) {
    const data = Y.encodeStateAsUpdate(doc);
    this.sql.exec("DELETE FROM snapshot");
    for (let i = 0; i < data.length; i += CHUNK)
      this.sql.exec(
        "INSERT INTO snapshot VALUES(?,?)",
        i / CHUNK,
        data.slice(i, i + CHUNK).buffer,
      );
    this.sql.exec("DELETE FROM updates");
  }
  private validate(doc: Y.Doc): Deck {
    const raw = JSON.stringify(readSharedDeck(doc));
    insist(
      new TextEncoder().encode(raw).length <= 2_000_000 &&
        Y.encodeStateAsUpdate(doc).length <= 8_000_000,
      413,
      "共有する作品の文字・図形が多すぎます。",
    );
    const deck = parseDeck(raw),
      id = this.id();
    for (const slide of deck.slides)
      for (const e of slide.elements)
        if (e.type === "image") {
          const asset = new RegExp(
            `^/api/decks/${id}/assets/([a-f0-9-]{36})$`,
          ).exec(e.src ?? "");
          insist(
            asset &&
              one(this.sql, "SELECT id FROM assets WHERE id=?", asset[1]),
            400,
            "この作品の写真を使ってください。",
          );
        }
    return deck;
  }
  private peers() {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN);
  }
  private presence() {
    const peers = this.peers();
    const members = [
      ...new Map(
        peers.map((ws) => {
          const { user } = ws.deserializeAttachment() as Peer;
          return [user.id, { id: user.id, name: user.name }];
        }),
      ).values(),
    ];
    for (const ws of peers) {
      try {
        ws.send(JSON.stringify({ type: "presence", members }));
      } catch {
        ws.close(1011);
      }
    }
  }
  async fetch(request: Request): Promise<Response> {
    try {
      return await this.handle(request);
    } catch (error) {
      return failure(error);
    }
  }
  private async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/init" && request.method === "POST") {
      insist(!this.id(), 409, "作品はすでに作成されています。");
      const data = await input(request, 3_000_000);
      const deck = parseDeck(JSON.stringify(data.deck));
      const doc = createSharedDeck(deck);
      try {
        this.ctx.storage.transactionSync(() => {
          this.sql.exec("INSERT INTO meta VALUES('id',?)", data.id);
          this.validate(doc);
          this.snapshot(doc);
        });
        this.document = doc;
      } catch (error) {
        doc.destroy();
        throw error;
      }
      return json({ ok: true });
    }
    if (path === "/delete" && request.method === "POST") {
      for (const ws of this.peers()) ws.close(4003, "作品が削除されました。");
      this.document?.destroy();
      this.document = undefined;
      // Keep the schema for already queued events, but remove every persisted byte.
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "DELETE FROM comments; DELETE FROM asset_chunks; DELETE FROM assets; DELETE FROM updates; DELETE FROM snapshot; DELETE FROM meta;",
        );
      });
      await this.ctx.storage.deleteAlarm();
      return json({ ok: true });
    }
    if (path === "/revoke" && request.method === "POST") {
      const data = await input(request);
      for (const ws of this.peers()) {
        const peer = ws.deserializeAttachment() as Peer;
        if (peer.session === data.session || peer.user.id === data.user)
          ws.close(4003, "作品への参加が解除されました。");
      }
      return json({ ok: true });
    }
    if (path === "/roster" && request.method === "POST") {
      for (const ws of this.peers())
        ws.send(JSON.stringify({ type: "roster" }));
      return json({ ok: true });
    }
    if (path === "/permissions" && request.method === "POST") {
      const data = await input(request, 1_500_000);
      for (const ws of this.peers())
        if ((ws.deserializeAttachment() as Peer).user.id === data.user)
          ws.send(JSON.stringify({ type: "access", access: data.access }));
      for (const ws of this.peers())
        ws.send(JSON.stringify({ type: "roster" }));
      return json({ ok: true });
    }
    if (path === "/comments" || /^\/comments\/[a-f0-9-]{36}$/.test(path)) {
      const data = await input(request);
      if (path === "/comments" && data.method === "GET")
        return json({
          comments: rows<SlideComment>(
            this.sql,
            "SELECT * FROM comments ORDER BY created,id",
          ),
        });
      if (
        (path === "/comments" && data.method === "POST") ||
        (path !== "/comments" && data.method === "PUT")
      ) {
        let value;
        try {
          value = parseComment(data.value);
        } catch {
          insist(false, 400, "付箋は1000文字以内で入力してください。");
        }
        insist(
          readSharedDeck(this.doc()).slides.some(
            (slide) => slide.id === value.slide,
          ),
          404,
          "スライドが見つかりません。",
        );
        const id = data.method === "PUT" ? path.slice(10) : crypto.randomUUID();
        const existing = one<SlideComment>(
          this.sql,
          "SELECT * FROM comments WHERE id=?",
          id,
        );
        insist(
          !existing ||
            ((data.host || existing.author === data.user.id) &&
              existing.slide === value.slide),
          403,
          "自分の付箋だけを変更できます。",
        );
        insist(
          existing ||
            one<{ n: number }>(this.sql, "SELECT COUNT(*) AS n FROM comments")!
              .n < 2000,
          413,
          "付箋は作品全体で2000枚までです。",
        );
        this.sql.exec(
          "INSERT INTO comments VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,x=excluded.x,y=excluded.y",
          id,
          value.slide,
          data.user.id,
          data.user.name,
          value.text,
          value.x,
          value.y,
          Date.now(),
        );
      } else if (data.method === "DELETE") {
        const id = path.slice(10),
          comment = one<SlideComment>(
            this.sql,
            "SELECT * FROM comments WHERE id=?",
            id,
          );
        insist(
          comment && (data.host || comment.author === data.user.id),
          403,
          "自分の付箋だけを削除できます。",
        );
        this.sql.exec("DELETE FROM comments WHERE id=?", id);
      } else return json({ error: "見つかりません。" }, 404);
      for (const ws of this.peers())
        ws.send(JSON.stringify({ type: "comments" }));
      return json({ ok: true });
    }
    const asset = /^\/assets\/([a-f0-9-]{36})$/.exec(path);
    if (asset && request.method === "POST") {
      const data = await body(request, 6_000_000),
        mime = request.headers.get("Content-Type")!;
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "INSERT INTO assets VALUES(?,?,?)",
          asset[1],
          mime,
          data.length,
        );
        for (let i = 0; i < data.length; i += CHUNK)
          this.sql.exec(
            "INSERT INTO asset_chunks VALUES(?,?,?)",
            asset[1],
            i / CHUNK,
            data.slice(i, i + CHUNK).buffer,
          );
      });
      return json({ ok: true }, 201);
    }
    if (asset && request.method === "GET") {
      const info = one<{ mime: string; bytes: number }>(
        this.sql,
        "SELECT mime,bytes FROM assets WHERE id=?",
        asset[1],
      );
      insist(info, 404, "写真が見つかりません。");
      const chunks = rows<{ data: ArrayBuffer }>(
        this.sql,
        "SELECT data FROM asset_chunks WHERE asset=? ORDER BY part",
        asset[1],
      );
      return new Response(new Blob(chunks.map((chunk) => chunk.data)), {
        headers: {
          "Content-Type": info.mime,
          "Content-Length": String(info.bytes),
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (path === "/state" && request.method === "GET")
      return json({ state: toBase64(Y.encodeStateAsUpdate(this.doc())) });
    if (
      path === "/live" &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket"
    ) {
      const identity = JSON.parse(
        decodeURIComponent(request.headers.get("X-Identity") || ""),
      ) as Identity;
      insist(
        identity.expires > Date.now(),
        401,
        "サインインし直してください。",
      );
      insist(
        this.peers().length < 50,
        503,
        "この作品の同時参加人数の上限です（50人）。",
      );
      const doc = this.doc(),
        pair = new WebSocketPair(),
        client = pair[0],
        server = pair[1];
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > identity.expires)
        await this.ctx.storage.setAlarm(identity.expires);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        ...identity,
        since: Date.now(),
        count: 0,
        bytes: 0,
      } satisfies Peer);
      server.send(
        JSON.stringify({
          type: "hello",
          vector: toBase64(Y.encodeStateVector(doc)),
        }),
      );
      server.send(Y.encodeStateAsUpdate(doc));
      this.presence();
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: "見つかりません。" }, 404);
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Serialise complete persist/ack cycles; asynchronous metadata calls must not
    // let a stale candidate replace a newer document from another participant.
    await this.ctx.blockConcurrencyWhile(async () => {
      let candidate: Y.Doc | undefined;
      try {
        const peer = ws.deserializeAttachment() as Peer;
        insist(
          peer.expires > Date.now() && ws.readyState === WebSocket.OPEN,
          401,
          "サインインし直してください。",
        );
        insist(
          typeof message === "string" && message.length <= 3_000_000,
          400,
          "通信データが大きすぎます。",
        );
        const value = JSON.parse(message);
        insist(
          value.type === "update" &&
            typeof value.id === "string" &&
            value.id.length < 100 &&
            typeof value.update === "string",
          400,
          "通信形式が正しくありません。",
        );
        const update = fromBase64(value.update),
          now = Date.now();
        if (peer.since + 60_000 <= now) {
          peer.since = now;
          peer.count = 0;
          peer.bytes = 0;
        }
        peer.count++;
        peer.bytes += update.length;
        insist(
          peer.count <= 1200 && peer.bytes <= 8_000_000,
          429,
          "操作が多いため、少し待ってからお試しください。",
        );
        ws.serializeAttachment(peer);
        const authorization = await checked(
          await directory(this.env).fetch(
            internal("/internal/authorize", {
              session: peer.session,
              user: peer.user.id,
              room: this.id(),
            }),
          ),
        );
        const current = this.doc();
        candidate = new Y.Doc();
        Y.applyUpdate(candidate, Y.encodeStateAsUpdate(current));
        const rights = (await authorization.json()) as {
          access: EditAccess;
          host: boolean;
        };
        applyAuthorizedUpdate(
          current,
          candidate,
          update,
          rights.access,
          rights.host,
        );
        const deck = this.validate(candidate);
        const snapshot = this.updates >= 199;
        this.ctx.storage.transactionSync(() => {
          if (snapshot) this.snapshot(candidate!);
          else
            this.sql.exec(
              "INSERT INTO updates(data) VALUES(?)",
              update.slice().buffer,
            );
        });
        this.updates = snapshot ? 0 : this.updates + 1;
        this.document = candidate;
        candidate = undefined;
        current.destroy();
        // All writes above are committed before ACK. Directory metadata can be
        // retried later without losing the actual slide content.
        for (const other of this.peers())
          if (other !== ws) {
            try {
              other.send(update);
            } catch {
              other.close(1011);
            }
          }
        ws.send(JSON.stringify({ type: "ack", id: value.id }));
        if (now - this.lastTouched >= 5000) {
          this.lastTouched = now;
          await directory(this.env)
            .fetch(
              internal("/internal/touched", {
                id: this.id(),
                title: deck.title,
              }),
            )
            .catch(() => {});
        }
      } catch (error) {
        const response = failure(error),
          value = (await response.json()) as { error: string };
        try {
          ws.send(
            JSON.stringify({
              type: "error",
              message:
                error instanceof AccessError ? error.message : value.error,
              code: error instanceof AccessError ? "forbidden" : undefined,
            }),
          );
          ws.close(
            error instanceof AccessError ? 4004 : 4002,
            "JSONを保存してください。",
          );
        } catch {
          /* Socket already closed. */
        }
      } finally {
        candidate?.destroy();
      }
    });
  }
  webSocketClose(ws: WebSocket, code: number) {
    ws.close(code, "接続を終了しました。");
    this.presence();
  }
  webSocketError(ws: WebSocket) {
    ws.close(1011);
    this.presence();
  }
  async alarm() {
    let next = Infinity;
    for (const ws of this.peers()) {
      const peer = ws.deserializeAttachment() as Peer;
      if (peer.expires <= Date.now())
        ws.close(4001, "サインインし直してください。");
      else next = Math.min(next, peer.expires);
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
  }
}
