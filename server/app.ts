import { syncFailure } from "../src/syncRecovery.ts";
import { COLLABORATION_PROTOCOL } from "../src/collaborationProtocol.ts";
import {
  pendingAssetSchema,
  imageSources,
  visibleComments,
  assertMediaReferences,
  consumePendingAssets,
} from "../src/mediaVisibility.ts";
import {
  joinSchema,
  requestJoin,
  joinState,
  pendingJoins,
  decideJoins,
  pendingJoinCountSQL,
  JoinRequestError,
} from "../src/joinRequests.ts";
import {
  historySchema,
  historyList,
  historySave,
  historyRead,
  historyBeforeChange,
} from "../src/historyStore.ts";
import {
  backupChanged,
  validCheckpoint,
  validDigest,
  revisionSchema,
  revisionQuery,
  restoreSchema,
  taskQuery,
  taskView,
  imageId,
  digestBytes,
} from "../src/backupProtocol.ts";
import {
  backupSnapshot,
  parseBackupSnapshot,
  restoredComments,
  BACKUP_METADATA_BYTES,
} from "../src/backupData.ts";
import {
  normalizeEmail,
  parseRecipients,
  sharedAccountNames,
} from "../src/preSharing.ts";
import { applyAuthorizedUpdate } from "../src/authorizeUpdate.ts";
import {
  AccessError,
  defaultAccess,
  hostAccess,
  parseAccess,
  parseComment,
} from "../src/permissions.ts";
import type { SlideComment } from "../src/permissions.ts";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { WebSocket, WebSocketServer } from "ws";
import * as Y from "yjs";
import { parseDeck, blank, MAX_FILE_BYTES } from "../src/model.ts";
import type { Deck } from "../src/model.ts";
import {
  createSharedDeck,
  readSharedDeck,
  fromBase64,
  toBase64,
} from "../src/sharedDeck.ts";
import { assetStorage } from "./storage.ts";

export interface User {
  id: string;
  name: string;
  email: string;
}
interface Options {
  directory: string;
  origin: string;
  clientId: string;
  /** Tests inject an identity verifier; production always verifies Google's signature. */
  verifyIdentity?: (credential: string) => Promise<User>;
  maxConnections?: number;
}
interface Room {
  media?: Set<string>;
  doc: Y.Doc;
  clients: Set<Peer>;
  touched: number;
  updates: number;
}
interface Peer {
  ws: WebSocket;
  user: User;
  session: string;
  room: string;
  alive: boolean;
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const uuid = /^[a-f0-9-]{36}$/;
const limit = (key: string, fallback: number) => {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error(`${key}には正の整数を設定してください。`);
  return n;
};
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
function insist(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
async function body(req: IncomingMessage, maximum: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    insist(size <= maximum, 413, "送信データが大きすぎます。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
function imageMime(bytes: Buffer): string | undefined {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return "image/gif";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
}

export function createApplication(options: Options) {
  const origin = new URL(options.origin).origin;
  mkdirSync(options.directory, { recursive: true });
  const db = new DatabaseSync(join(options.directory, "vhslide.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS decks (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, state BLOB NOT NULL, updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS members (deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(deck,user_id));
    CREATE TABLE IF NOT EXISTS grants (deck TEXT NOT NULL, user_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(deck,user_id), FOREIGN KEY(deck,user_id) REFERENCES members(deck,user_id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, slide TEXT NOT NULL, author TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS recipients (deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, email TEXT NOT NULL, value TEXT NOT NULL, rank INTEGER NOT NULL, user_id TEXT, PRIMARY KEY(deck,email));
    CREATE INDEX IF NOT EXISTS recipients_email ON recipients(email);
    CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, data BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS updates_deck ON updates(deck,seq);
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, owner TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS assets_owner ON assets(owner);
    CREATE TABLE IF NOT EXISTS restore_jobs (deck TEXT PRIMARY KEY REFERENCES decks(id) ON DELETE CASCADE);
  `);
  const commentColumns = new Set(
    (db.prepare("PRAGMA table_info(comments)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  for (const [name, type] of [
    ["color", "TEXT NOT NULL DEFAULT '#fff0a6'"],
    ["w", "REAL NOT NULL DEFAULT 0.24"],
    ["h", "REAL NOT NULL DEFAULT 0.30"],
  ])
    if (!commentColumns.has(name))
      db.exec(`ALTER TABLE comments ADD COLUMN ${name} ${type}`);

  db.exec(revisionSchema("node") + restoreSchema);
  db.exec(
    "CREATE TABLE IF NOT EXISTS restore_uploads(asset TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE, ready INTEGER NOT NULL CHECK(ready IN (0,1)))",
  );
  db.exec(`INSERT OR IGNORE INTO restore_tasks(id,owner,request_key,content_hash,apply_sharing,title,status,created)
    SELECT decks.id,decks.owner,'legacy:'||decks.id,'',-1,decks.title,'uploading',decks.updated FROM decks JOIN restore_jobs ON restore_jobs.deck=decks.id`);
  function revision(id: string) {
    return (
      (db.prepare(revisionQuery).get(id) as { revision: string } | undefined)
        ?.revision ?? "0"
    );
  }
  function task(id: string, owner: string) {
    const row = db
      .prepare(taskQuery + " WHERE id=? AND owner=?")
      .get(id, owner);
    insist(row, 404, "復元ジョブが見つかりません。");
    return taskView(row);
  }
  const jobLocks = new Map<string, Promise<void>>();
  async function lockJob(id: string) {
    const prior = jobLocks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    jobLocks.set(id, next);
    await prior;
    return () => {
      if (jobLocks.get(id) === next) jobLocks.delete(id);
      release();
    };
  }
  const storage = assetStorage(join(options.directory, "assets"));
  const rooms = new Map<string, Room>(),
    peers = new Set<Peer>(),
    deleting = new Set<string>();
  const maximumConnections =
    options.maxConnections ?? limit("MAX_CONNECTIONS", 200);
  const maximumRoom = limit("MAX_ROOM_CONNECTIONS", 50);
  const maximumAssets = limit(
    "MAX_TOTAL_ASSET_BYTES",
    storage.kind === "bucket" ? 5_000_000_000 : 1_000_000_000,
  );
  const userAssets = limit("MAX_USER_ASSET_BYTES", 250_000_000);
  const rate = new Map<string, { count: number; until: number }>();
  function rateLimit(key: string, maximum: number, amount = 1) {
    let entry = rate.get(key);
    if (!entry || entry.until < Date.now()) {
      entry = { count: 0, until: Date.now() + 60_000 };
      rate.set(key, entry);
    }
    entry.count += amount;
    insist(
      entry.count <= maximum,
      429,
      "操作が多いため、少し待ってからお試しください。",
    );
  }
  const googleKeys = createRemoteJWKSet(
    new URL("https://www.googleapis.com/oauth2/v3/certs"),
  );
  const verifyIdentity =
    options.verifyIdentity ??
    (async (credential: string): Promise<User> => {
      const { payload } = await jwtVerify(credential, googleKeys, {
        audience: options.clientId,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        algorithms: ["RS256"],
      });
      insist(
        payload.email_verified === true &&
          typeof payload.sub === "string" &&
          typeof payload.email === "string",
        401,
        "Googleアカウントを確認できませんでした。",
      );
      return {
        id: payload.sub,
        email: payload.email.slice(0, 320),
        name: String(payload.name ?? payload.email).slice(0, 100),
      };
    });
  function sessionHash(req: IncomingMessage) {
    const raw = /(?:^|;\s*)vhslide_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(
      req.headers.cookie ?? "",
    )?.[1];
    return raw ? sha(raw) : "";
  }
  function user(req: IncomingMessage): User {
    const found = db
      .prepare(
        "SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND expires>?",
      )
      .get(sessionHash(req), Date.now()) as unknown as User | undefined;
    insist(found, 401, "Googleアカウントでサインインしてください。");
    return found;
  }
  db.exec(pendingAssetSchema);
  db.exec(joinSchema);
  db.exec(historySchema);
  db.exec(
    "CREATE TABLE IF NOT EXISTS work_trash(deck TEXT PRIMARY KEY REFERENCES decks(id) ON DELETE CASCADE, created INTEGER NOT NULL, purging INTEGER NOT NULL DEFAULT 0)",
  );
  if (
    !(
      db.prepare("PRAGMA table_info(work_trash)").all() as { name: string }[]
    ).some((c) => c.name === "purging")
  )
    db.exec(
      "ALTER TABLE work_trash ADD COLUMN purging INTEGER NOT NULL DEFAULT 0",
    );
  const historySQL = (query: string, ...args: (string | number)[]) =>
    db.prepare(query).all(...args);
  function member(id: string, u: User, ownerOnly = false) {
    insist(uuid.test(id) && !deleting.has(id), 404, "作品が見つかりません。");
    const found = db
      .prepare(
        "SELECT decks.owner FROM decks JOIN members ON members.deck=decks.id WHERE decks.id=? AND members.user_id=?",
      )
      .get(id, u.id) as { owner: string } | undefined;
    insist(
      found &&
        (!ownerOnly || found.owner === u.id) &&
        (!db.prepare("SELECT deck FROM work_trash WHERE deck=?").get(id) ||
          (ownerOnly && found.owner === u.id)),
      404,
      "作品が見つからないか、参加する権限がありません。",
    );
    return found;
  }
  function permissions(id: string, user: string, owner: string) {
    if (owner === user) return hostAccess();
    const grant = db
      .prepare("SELECT value FROM grants WHERE deck=? AND user_id=?")
      .get(id, user) as { value: string } | undefined;
    return grant ? parseAccess(JSON.parse(grant.value)) : defaultAccess();
  }
  function recipientList(id: string) {
    return (
      db
        .prepare(
          "SELECT recipients.email,recipients.value,recipients.user_id,users.name FROM recipients LEFT JOIN users ON users.id=recipients.user_id WHERE deck=? ORDER BY recipients.rank,recipients.email",
        )
        .all(id) as unknown as {
        email: string;
        value: string;
        user_id: string | null;
        name: string | null;
      }[]
    ).map((r) => ({
      email: r.email,
      access: JSON.parse(r.value),
      ...(r.user_id ? { userId: r.user_id, name: r.name } : {}),
    }));
  }
  function claim(u: User) {
    const pending = db
      .prepare(
        "SELECT recipients.deck,recipients.email,recipients.value FROM recipients JOIN decks ON decks.id=recipients.deck WHERE email=? AND user_id IS NULL AND decks.owner<>?",
      )
      .all(normalizeEmail(u.email), u.id) as unknown as {
      deck: string;
      email: string;
      value: string;
    }[];
    for (const recipient of pending) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT OR IGNORE INTO members VALUES(?,?)").run(
          recipient.deck,
          u.id,
        );
        db.prepare(
          "INSERT INTO grants VALUES(?,?,?) ON CONFLICT(deck,user_id) DO UPDATE SET value=excluded.value",
        ).run(recipient.deck, u.id, recipient.value);
        db.prepare(
          "UPDATE recipients SET user_id=? WHERE deck=? AND email=? AND user_id IS NULL",
        ).run(u.id, recipient.deck, recipient.email);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      for (const peer of rooms.get(recipient.deck)?.clients ?? [])
        if (peer.user.id === u.id)
          peer.ws.send(
            JSON.stringify({
              type: "access",
              access: JSON.parse(recipient.value),
            }),
          );
    }
  }
  function room(id: string): Room {
    const existing = rooms.get(id);
    if (existing) {
      existing.touched = Date.now();
      return existing;
    }
    const row = db.prepare("SELECT state FROM decks WHERE id=?").get(id) as
      { state: Uint8Array } | undefined;
    insist(row, 404, "作品が見つかりません。");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, row.state);
    const updates = db
      .prepare("SELECT data FROM updates WHERE deck=? ORDER BY seq")
      .all(id) as unknown as { data: Uint8Array }[];
    for (const update of updates) Y.applyUpdate(doc, update.data);
    const result: Room = {
      doc,
      clients: new Set(),
      touched: Date.now(),
      updates: updates.length,
    };
    rooms.set(id, result);
    return result;
  }
  function validate(doc: Y.Doc, id: string): Deck {
    const deck = parseDeck(JSON.stringify(readSharedDeck(doc)));
    insist(
      Buffer.byteLength(JSON.stringify(deck)) <= 2_000_000 &&
        Y.encodeStateAsUpdate(doc).byteLength <= 8_000_000,
      413,
      "共有する作品の文字・図形が多すぎます。",
    );
    for (const slide of deck.slides)
      for (const e of slide.elements)
        if (e.type === "image") {
          const asset = new RegExp(
            `^/api/decks/${id}/assets/([a-f0-9-]{36})$`,
          ).exec(e.src ?? "");
          insist(
            asset &&
              db
                .prepare("SELECT id FROM assets WHERE id=? AND deck=?")
                .get(asset[1], id),
            400,
            "この作品の写真を使ってください。",
          );
          insist(
            !db
              .prepare(
                "SELECT asset FROM restore_uploads WHERE asset=? AND ready=0",
              )
              .get(asset![1]),
            400,
            "写真の保存が未完了です。同じバックアップから再開してください。",
          );
        }
    return deck;
  }
  function currentMedia(id: string) {
    const r = room(id);
    return (r.media ??= imageSources(readSharedDeck(r.doc)));
  }
  function ownsPending(asset: string, user: string) {
    return !!db
      .prepare(
        "SELECT asset FROM pending_asset_access WHERE asset=? AND user_id=?",
      )
      .get(asset, user);
  }
  function mayReadAsset(id: string, asset: string, user: User, owner: string) {
    return (
      user.id === owner ||
      currentMedia(id).has(`/api/decks/${id}/assets/${asset}`) ||
      ownsPending(asset, user.id)
    );
  }
  function compact(id: string, r: Room) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE decks SET state=? WHERE id=?").run(
        Y.encodeStateAsUpdate(r.doc),
        id,
      );
      db.prepare("DELETE FROM updates WHERE deck=?").run(id);
      db.exec("COMMIT");
      r.updates = 0;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  async function saveAsset(
    id: string,
    u: User,
    bytes: Buffer,
    fixedId?: string,
  ) {
    const { owner } = member(id, u);
    const mime = imageMime(bytes);
    insist(
      mime && bytes.length <= 6_000_000,
      400,
      "6MB以下のPNG・JPEG・WebP・GIF画像を選んでください。",
    );
    const asset = fixedId ?? randomUUID();
    const existing = db
      .prepare("SELECT id FROM assets WHERE id=? AND deck=?")
      .get(asset, id);
    if (existing && fixedId) {
      db.prepare("INSERT OR IGNORE INTO restore_uploads VALUES(?,0)").run(
        asset,
      );
      try {
        if (
          (await digestBytes(await storage.read(asset))) ===
          (await digestBytes(bytes))
        ) {
          db.prepare("UPDATE restore_uploads SET ready=1 WHERE asset=?").run(
            asset,
          );
          return `/api/decks/${id}/assets/${asset}`;
        }
      } catch {
        /* Resume a reserved upload interrupted before persistence. */
      }
      await storage.remove(asset);
    }
    const total = db
      .prepare("SELECT COALESCE(SUM(bytes),0) AS n FROM assets")
      .get() as { n: number };
    const used = db
      .prepare("SELECT COALESCE(SUM(bytes),0) AS n FROM assets WHERE owner=?")
      .get(owner) as { n: number };
    insist(
      existing ||
        (total.n + bytes.length <= maximumAssets &&
          used.n + bytes.length <= userAssets),
      413,
      "写真の保存容量の上限です。不要な作品を整理してください。",
    );
    if (!existing)
      db.prepare("INSERT INTO assets VALUES(?,?,?,?,?)").run(
        asset,
        id,
        owner,
        mime,
        bytes.length,
      );
    db.prepare("INSERT OR IGNORE INTO restore_uploads VALUES(?,0)").run(asset);
    try {
      await storage.put(asset, bytes, mime);
      insist(
        !deleting.has(id) &&
          db
            .prepare("SELECT id FROM assets WHERE id=? AND deck=?")
            .get(asset, id),
        409,
        "作品が削除されたため写真の保存を取り消しました。",
      );
      db.prepare("UPDATE restore_uploads SET ready=1 WHERE asset=?").run(asset);
      if (!existing)
        db.prepare(
          "INSERT OR IGNORE INTO pending_asset_access VALUES(?,?)",
        ).run(asset, u.id);
    } catch (error) {
      try {
        if (!fixedId) {
          await storage.remove(asset);
          db.prepare("DELETE FROM assets WHERE id=?").run(asset);
        }
      } catch {
        /* Retain a surviving reservation for a later explicit cleanup. */
      }
      throw error;
    }
    return `/api/decks/${id}/assets/${asset}`;
  }
  const cookie = (value: string, age: number) =>
    `vhslide_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.startsWith("https:") ? "; Secure" : ""}`;
  const server = createServer(async (req, res) => {
    let releaseJob: (() => void) | undefined;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://accounts.google.com; img-src 'self' data: blob: https:; frame-src https://accounts.google.com; connect-src 'self' ${origin.replace(/^http/, "ws")} https://accounts.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
    );
    try {
      const url = new URL(req.url ?? "/", origin),
        path = url.pathname;
      const method = req.method ?? "GET";
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method))
        insist(
          req.headers.origin === origin,
          403,
          "このサイトから操作してください。",
        );
      if (path === "/healthz" && method === "GET")
        return json(res, 200, { ok: true });
      if (path === "/api/config" && method === "GET")
        return json(res, 200, {
          clientId: options.clientId,
          enabled: !!options.clientId,
        });
      if (path === "/api/session" && method === "GET") {
        let current: User | null = null;
        try {
          current = user(req);
        } catch {
          /* Signed out. */
        }
        return json(res, 200, { user: current });
      }
      if (path === "/api/auth/google" && method === "POST") {
        insist(options.clientId, 503, "クラウド機能は準備中です。");
        rateLimit(
          `login:${req.headers["x-real-ip"] ?? req.socket.remoteAddress}`,
          120,
        );
        const input = JSON.parse((await body(req, 20_000)).toString());
        insist(
          typeof input.credential === "string",
          400,
          "サインイン情報を確認できません。",
        );
        let u: User;
        try {
          u = await verifyIdentity(input.credential);
        } catch {
          throw new HttpError(
            401,
            "Googleのサインインを確認できませんでした。もう一度お試しください。",
          );
        }
        db.prepare(
          "INSERT INTO users VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",
        ).run(u.id, u.name, u.email);
        const raw = token();
        db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
          sha(raw),
          u.id,
          Date.now() + 7 * 86400_000,
        );
        res.setHeader("Set-Cookie", cookie(raw, 7 * 86400));
        return json(res, 200, { user: u });
      }
      if (path === "/api/logout" && method === "POST") {
        const hash = sessionHash(req);
        db.prepare("DELETE FROM sessions WHERE hash=?").run(hash);
        for (const peer of peers)
          if (peer.session === hash)
            peer.ws.close(4001, "サインアウトしました。");
        res.setHeader("Set-Cookie", cookie("", 0));
        return json(res, 200, { ok: true });
      }
      if (path.startsWith("/api/")) {
        const u = user(req);
        claim(u);
        if (method !== "GET") rateLimit(`api:${u.id}`, 120);
        if (path === "/api/trash" && method === "GET")
          return json(res, 200, {
            decks: db
              .prepare(
                "SELECT decks.id,decks.title,work_trash.created,work_trash.purging FROM work_trash JOIN decks ON deck=decks.id WHERE owner=? ORDER BY created DESC",
              )
              .all(u.id),
          });
        if (path === "/api/restores" && method === "GET")
          return json(res, 200, {
            jobs: db
              .prepare(
                taskQuery +
                  " WHERE owner=? AND status<>'cancelled' ORDER BY created DESC",
              )
              .all(u.id)
              .map(taskView),
          });
        const jobLookup =
          /^\/api\/(?:restores\/([a-f0-9-]{36})|decks\/([a-f0-9-]{36})\/restore)$/.exec(
            path,
          );
        if (jobLookup && method === "GET")
          return json(res, 200, task(jobLookup[1] || jobLookup[2], u.id));
        const lookupJoin = /^\/api\/join-requests\/([a-f0-9-]{36})$/.exec(path);
        if (lookupJoin && method === "GET")
          return json(res, 200, joinState(historySQL, lookupJoin[1], u.id));
        if (path === "/api/decks" && method === "GET") {
          const decks = db
            .prepare(
              `SELECT decks.id,decks.title,decks.updated,decks.owner,CASE WHEN EXISTS(SELECT 1 FROM restore_jobs WHERE deck=decks.id) THEN 'restoring' ELSE 'ready' END AS status,${pendingJoinCountSQL("members.user_id")} FROM decks JOIN members ON decks.id=members.deck WHERE members.user_id=? AND NOT EXISTS(SELECT 1 FROM work_trash WHERE deck=decks.id) ORDER BY updated DESC`,
            )
            .all(u.id);
          return json(res, 200, { decks });
        }
        if (
          (path === "/api/decks" || path === "/api/restores") &&
          method === "POST"
        ) {
          const restoring = path === "/api/restores";
          let deck: Deck,
            jobInput: {
              key?: string;
              contentHash?: string;
              applySharing?: boolean;
              newCopy?: boolean;
            } = {};
          try {
            const raw = (
              await body(req, restoring ? 20_000 : MAX_FILE_BYTES)
            ).toString();
            if (restoring) {
              jobInput = JSON.parse(raw);
              insist(
                jobInput.newCopy === undefined ||
                  typeof jobInput.newCopy === "boolean",
                400,
                "復元方法を確認してください。",
              );
              insist(
                jobInput.key === undefined || validDigest(jobInput.key),
                400,
                "復元キーが正しくありません。",
              );
              insist(
                jobInput.contentHash === undefined ||
                  validDigest(jobInput.contentHash),
                400,
                "復元内容の識別子が正しくありません。",
              );
              insist(
                jobInput.applySharing === undefined ||
                  typeof jobInput.applySharing === "boolean",
                400,
                "共有設定を確認してください。",
              );
            }
            deck = parseDeck(
              restoring
                ? JSON.stringify({
                    version: 1,
                    title: JSON.parse(raw).title,
                    slides: [blank(0, 0)],
                  })
                : raw,
            );
          } catch (error) {
            throw error instanceof HttpError ||
              error instanceof JoinRequestError
              ? error
              : new HttpError(400, (error as Error).message);
          }
          const requestKey = jobInput.key ?? randomUUID();
          if (restoring) {
            const prior = db
              .prepare(
                "SELECT * FROM restore_tasks WHERE owner=? AND (request_key=? OR (?=0 AND content_hash<>'' AND content_hash=? AND apply_sharing=? AND status<>'cancelled' AND NOT EXISTS(SELECT 1 FROM work_trash WHERE deck=restore_tasks.id))) ORDER BY (request_key=?) DESC,created DESC LIMIT 1",
              )
              .get(
                u.id,
                requestKey,
                Number(jobInput.newCopy === true),
                jobInput.contentHash ?? "",
                jobInput.applySharing === undefined
                  ? -1
                  : Number(jobInput.applySharing),
                requestKey,
              ) as
              | {
                  id: string;
                  content_hash: string;
                  apply_sharing: number;
                  status: string;
                }
              | undefined;
            if (prior) {
              insist(
                !db
                  .prepare("SELECT deck FROM work_trash WHERE deck=?")
                  .get(prior.id),
                409,
                "復元済みの作品はごみ箱にあります。作品一覧に戻してから開いてください。",
              );
              insist(
                prior.content_hash === (jobInput.contentHash ?? "") &&
                  prior.apply_sharing ===
                    (jobInput.applySharing === undefined
                      ? -1
                      : Number(jobInput.applySharing)),
                409,
                "同じ復元キーで別の内容は復元できません。",
              );
              insist(
                !["cancelled", "cancelling"].includes(prior.status),
                409,
                "この復元は取り消されています。",
              );
              return json(res, 200, { id: prior.id });
            }
          }
          const owned = db
            .prepare("SELECT COUNT(*) AS n FROM decks WHERE owner=?")
            .get(u.id) as { n: number };
          insist(
            owned.n < limit("MAX_DECKS_PER_USER", 40),
            413,
            "保存できる作品数の上限です。",
          );
          const id = randomUUID();
          const seed = createSharedDeck({
            version: 1,
            title: deck.title,
            slides: [blank(0, 0)],
          });
          db.exec("BEGIN IMMEDIATE");
          try {
            db.prepare("INSERT INTO decks VALUES(?,?,?,?,?)").run(
              id,
              u.id,
              deck.title,
              Y.encodeStateAsUpdate(seed),
              Date.now(),
            );
            seed.destroy();
            db.prepare("INSERT INTO members VALUES(?,?)").run(id, u.id);
            if (restoring) {
              db.prepare("INSERT INTO restore_jobs VALUES(?)").run(id);
              db.prepare(
                "INSERT INTO restore_tasks(id,owner,request_key,content_hash,apply_sharing,title,status,created) VALUES(?,?,?,?,?,?,'uploading',?)",
              ).run(
                id,
                u.id,
                requestKey,
                jobInput.contentHash ?? "",
                jobInput.applySharing === undefined
                  ? -1
                  : Number(jobInput.applySharing),
                deck.title,
                Date.now(),
              );
            }
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
          try {
            for (const slide of deck.slides)
              for (const e of slide.elements)
                if (e.type === "image") {
                  insist(
                    typeof e.src === "string" && e.src.startsWith("data:"),
                    400,
                    "写真を含むJSONを読み込んでから保存してください。",
                  );
                  e.src = await saveAsset(
                    id,
                    u,
                    Buffer.from(e.src.slice(e.src.indexOf(",") + 1), "base64"),
                  );
                }
            const doc = createSharedDeck(deck);
            validate(doc, id);
            db.prepare("UPDATE decks SET state=? WHERE id=?").run(
              Y.encodeStateAsUpdate(doc),
              id,
            );
            doc.destroy();
          } catch (error) {
            const assets = db
              .prepare("SELECT id FROM assets WHERE deck=?")
              .all(id) as { id: string }[];
            await Promise.allSettled(
              assets.map((asset) => storage.remove(asset.id)),
            );
            db.prepare("DELETE FROM decks WHERE id=?").run(id);
            db.prepare(
              "UPDATE restore_tasks SET status='cancelled' WHERE id=?",
            ).run(id);
            throw error;
          }
          return json(res, 201, { id });
        }
        const invitation = /^\/api\/invites\/([A-Za-z0-9_-]{43})\/accept$/.exec(
          path,
        );
        if (invitation && method === "POST") {
          const found = db
            .prepare(
              "SELECT deck FROM invites WHERE hash=? AND NOT EXISTS(SELECT 1 FROM work_trash WHERE deck=invites.deck)",
            )
            .get(sha(invitation[1])) as { deck: string } | undefined;
          insist(found, 404, "招待リンクは無効か、更新されています。");
          const result = requestJoin(
            historySQL,
            found.deck,
            u.id,
            sha(invitation[1]),
          );
          return json(res, result.status === "pending" ? 202 : 200, result);
        }
        const match = /^\/api\/decks\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(path);
        insist(match, 404, "見つかりません。");
        const [, id, extra] = match;
        if (
          ["POST", "DELETE"].includes(method) &&
          (extra === "restore" || extra === "assets" || !extra) &&
          db
            .prepare("SELECT id FROM restore_tasks WHERE id=? AND owner=?")
            .get(id, u.id)
        ) {
          releaseJob = await lockJob(id);
        }
        const access = member(
          id,
          u,
          ((!extra || extra === "restore") && method === "DELETE") ||
            extra === "untrash",
        );
        const restoreJob = db
          .prepare("SELECT deck FROM restore_jobs WHERE deck=?")
          .get(id);
        if (
          restoreJob &&
          !(extra === "assets" && method === "POST") &&
          !(extra === "restore" && ["POST", "DELETE"].includes(method)) &&
          !(!extra && method === "DELETE")
        )
          throw new HttpError(
            409,
            "復元中の作品です。復元を完了するか削除してください。",
          );
        if (extra === "join-requests" && method === "GET") {
          member(id, u, true);
          return json(res, 200, { requests: pendingJoins(historySQL, id) });
        }
        if (
          (extra === "join-requests/approve" ||
            extra === "join-requests/reject") &&
          method === "POST"
        ) {
          member(id, u, true);
          const value = JSON.parse((await body(req, 6000)).toString());
          db.exec("BEGIN IMMEDIATE");
          try {
            member(id, u);
            member(id, u, true);
            const result = decideJoins(
              historySQL,
              id,
              value,
              extra.endsWith("/approve"),
            );
            db.exec("COMMIT");
            return json(res, 200, result);
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        }
        if ((extra === "trash" || extra === "untrash") && method === "POST") {
          member(id, u, true);
          if (extra === "trash") {
            db.prepare(
              "INSERT OR REPLACE INTO work_trash(deck,created,purging) VALUES(?,?,0)",
            ).run(id, Date.now());
            db.prepare("DELETE FROM invites WHERE deck=?").run(id);
            db.prepare(
              "DELETE FROM join_requests WHERE deck=? AND status<>'approved'",
            ).run(id);
            for (const peer of rooms.get(id)?.clients ?? [])
              peer.ws.close(4003, "作品はごみ箱に移動しました。");
          } else {
            insist(
              !(
                db
                  .prepare("SELECT purging FROM work_trash WHERE deck=?")
                  .get(id) as { purging: number } | undefined
              )?.purging,
              409,
              "完全削除の途中です。完全に削除を再試行してください。",
            );
            db.prepare("DELETE FROM work_trash WHERE deck=?").run(id);
          }
          db.prepare("UPDATE decks SET updated=? WHERE id=?").run(
            Date.now(),
            id,
          );
          return json(res, 200, { ok: true });
        }
        if (
          (extra === "history" || extra?.startsWith("history/")) &&
          ["GET", "POST"].includes(method)
        ) {
          member(id, u, true);
          if (extra !== "history") {
            const entry = historyList(historySQL, id).find(
              (e) => e.id === extra.slice(8),
            );
            insist(entry, 404, "保存した版が見つかりません。");
            return json(res, 200, {
              snapshot: historyRead(historySQL, id, entry.id),
            });
          }
          if (method === "POST") {
            const value = JSON.parse((await body(req, 2000)).toString());
            insist(
              typeof value.label === "string" && value.label.length <= 80,
              400,
              "版の名前を確認してください。",
            );
            const notes = db
              .prepare(
                "SELECT * FROM comments WHERE deck=? ORDER BY created,id",
              )
              .all(id) as SlideComment[];
            db.exec("BEGIN IMMEDIATE");
            try {
              historySave(
                historySQL,
                id,
                backupSnapshot(readSharedDeck(room(id).doc), notes, [], []),
                value.label,
              );
              db.exec("COMMIT");
            } catch (error) {
              db.exec("ROLLBACK");
              throw error;
            }
          }
          return json(res, 200, { entries: historyList(historySQL, id) });
        }
        if (extra === "backup/verify" && method === "POST") {
          member(id, u, true);
          const checkpoint = JSON.parse(
            (await body(req, 20_000)).toString(),
          ).checkpoint;
          insist(
            validCheckpoint(checkpoint),
            400,
            "バックアップの確認情報が正しくありません。",
          );
          member(id, u, true);
          insist(
            checkpoint.directory === revision(id) && checkpoint.room === "0",
            409,
            backupChanged,
          );
          return json(res, 200, { ok: true });
        }
        if (extra === "backup" && method === "GET") {
          member(id, u, true);
          const notes = db
            .prepare(
              "SELECT id,slide,author,name,text,x,y,created,color,w,h FROM comments WHERE deck=? ORDER BY created,id",
            )
            .all(id) as SlideComment[];
          const people = (
            db
              .prepare(
                "SELECT users.* FROM users JOIN members ON users.id=members.user_id WHERE members.deck=? AND users.id<>?",
              )
              .all(id, access.owner) as unknown as User[]
          ).map((p) => ({ ...p, access: permissions(id, p.id, access.owner) }));
          return json(res, 200, {
            ...backupSnapshot(
              readSharedDeck(room(id).doc),
              notes,
              recipientList(id),
              people,
            ),
            checkpoint: { directory: revision(id), room: "0" },
          });
        }
        if (extra === "restore" && method === "POST") {
          member(id, u, true);
          insist(
            db.prepare("SELECT id FROM restore_tasks WHERE id=?").get(id),
            409,
            "復元は専用の新しい作品にだけ実行できます。",
          );
          const restoreTask = task(id, u.id);
          insist(
            restoreTask.status === "ready" ||
              (restoreJob &&
                ["uploading", "room_committed"].includes(restoreTask.status)),
            409,
            "復元は専用の新しい作品にだけ実行できます。",
          );
          let snapshot, applySharing;
          try {
            const value = JSON.parse(
              (await body(req, BACKUP_METADATA_BYTES + 1000)).toString(),
            );
            insist(
              typeof value.applySharing === "boolean",
              400,
              "共有設定を確認してください。",
            );
            applySharing = value.applySharing;
            snapshot = parseBackupSnapshot(value.snapshot);
          } catch (error) {
            throw error instanceof HttpError ||
              error instanceof JoinRequestError
              ? error
              : new HttpError(400, (error as Error).message);
          }
          insist(
            restoreTask.status === "ready" ||
              db.prepare("SELECT deck FROM restore_jobs WHERE deck=?").get(id),
            409,
            "復元はすでに完了しているか取り消されています。",
          );
          member(id, u, true);
          const commitHash = sha(JSON.stringify({ snapshot, applySharing }));
          const prior = db
            .prepare(
              "SELECT commit_hash,apply_sharing FROM restore_tasks WHERE id=?",
            )
            .get(id) as { commit_hash: string; apply_sharing: number };
          insist(
            !prior.commit_hash || prior.commit_hash === commitHash,
            409,
            "復元内容が前の試行と一致しません。",
          );
          insist(
            prior.apply_sharing === -1 ||
              prior.apply_sharing === Number(applySharing),
            409,
            "共有設定が前の試行と一致しません。",
          );
          if (restoreTask.status === "ready") return json(res, 200, { id });
          const doc = createSharedDeck(snapshot.deck);
          try {
            validate(doc, id);
          } catch (error) {
            doc.destroy();
            throw error;
          }
          const notes = restoredComments(snapshot.comments, u.id);
          db.exec("BEGIN IMMEDIATE");
          try {
            db.prepare(
              "UPDATE decks SET title=?,state=?,updated=? WHERE id=?",
            ).run(
              snapshot.deck.title,
              Y.encodeStateAsUpdate(doc),
              Date.now(),
              id,
            );
            db.prepare("DELETE FROM updates WHERE deck=?").run(id);
            db.prepare("DELETE FROM comments WHERE deck=?").run(id);
            for (const c of notes)
              db.prepare(
                "INSERT INTO comments(id,deck,slide,author,name,text,x,y,created,color,w,h) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
              ).run(
                c.id,
                id,
                c.slide,
                c.author,
                c.name,
                c.text,
                c.x,
                c.y,
                c.created,
                c.color ?? "#fff0a6",
                c.w ?? 0.24,
                c.h ?? 0.3,
              );
            if (applySharing)
              snapshot.sharing
                .filter((p) => p.email !== normalizeEmail(u.email))
                .forEach((p, rank) =>
                  db
                    .prepare("INSERT INTO recipients VALUES(?,?,?,?,NULL)")
                    .run(id, p.email, JSON.stringify(p.access), rank),
                );
            db.prepare(
              "UPDATE restore_tasks SET status='ready',commit_hash=?,apply_sharing=? WHERE id=?",
            ).run(commitHash, Number(applySharing), id);
            db.prepare("DELETE FROM restore_jobs WHERE deck=?").run(id);
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            doc.destroy();
            throw error;
          }
          rooms.get(id)?.doc.destroy();
          rooms.delete(id);
          doc.destroy();
          return json(res, 200, { id });
        }

        if (!extra && method === "GET")
          return json(res, 200, {
            id,
            owner: access.owner,
            access: permissions(id, u.id, access.owner),
            state: toBase64(Y.encodeStateAsUpdate(room(id).doc)),
          });
        if ((!extra || extra === "restore") && method === "DELETE") {
          if (extra === "restore")
            insist(
              db.prepare("SELECT deck FROM restore_jobs WHERE deck=?").get(id),
              409,
              "復元は完了済みです。作品一覧を確認してください。",
            );
          member(id, u, true);
          db.prepare(
            "INSERT INTO work_trash(deck,created,purging) VALUES(?,?,1) ON CONFLICT(deck) DO UPDATE SET purging=1",
          ).run(id, Date.now());
          deleting.add(id);
          db.prepare(
            "UPDATE restore_tasks SET status='cancelling' WHERE id=?",
          ).run(id);
          try {
            for (const peer of rooms.get(id)?.clients ?? [])
              peer.ws.close(4003, "作品が削除されました。");
            const assets = db
              .prepare("SELECT id FROM assets WHERE deck=?")
              .all(id) as { id: string }[];
            for (const asset of assets) await storage.remove(asset.id);
            rooms.get(id)?.doc.destroy();
            rooms.delete(id);
            db.exec("BEGIN IMMEDIATE");
            try {
              for (const entry of historyList(historySQL, id)) {
                db.prepare("DELETE FROM work_history_parts WHERE id=?").run(
                  entry.id,
                );
              }
              db.prepare("DELETE FROM work_history WHERE deck=?").run(id);
              db.prepare("DELETE FROM decks WHERE id=?").run(id);
              db.prepare(
                "UPDATE restore_tasks SET status='cancelled' WHERE id=?",
              ).run(id);
              db.exec("COMMIT");
            } catch (error) {
              db.exec("ROLLBACK");
              throw error;
            }
          } finally {
            deleting.delete(id);
          }
          return json(res, 200, { ok: true });
        }
        if (extra === "invite" && method === "POST") {
          member(id, u, true);
          const raw = token();
          db.prepare("DELETE FROM invites WHERE deck=?").run(id);
          db.prepare(
            "DELETE FROM join_requests WHERE deck=? AND status<>'approved'",
          ).run(id);
          db.prepare("INSERT INTO invites VALUES(?,?)").run(sha(raw), id);
          return json(res, 200, { url: `${origin}/?join=${raw}` });
        }
        if (extra === "invite" && method === "DELETE") {
          member(id, u, true);
          db.prepare("DELETE FROM invites WHERE deck=?").run(id);
          db.prepare(
            "DELETE FROM join_requests WHERE deck=? AND status<>'approved'",
          ).run(id);
          return json(res, 200, { ok: true });
        }
        if (extra === "recipients") {
          member(id, u, true);
          if (method === "GET")
            return json(res, 200, { recipients: recipientList(id) });
          if (method === "POST") {
            let recipients;
            try {
              recipients = parseRecipients(
                JSON.parse((await body(req, 1_500_000)).toString()),
                u.email,
              );
            } catch (error) {
              throw new HttpError(400, (error as Error).message);
            }
            const existing = recipientList(id);
            insist(
              new Set([
                ...existing.map((r) => r.email),
                ...recipients.map((r) => r.email),
              ]).size <= 500,
              413,
              "事前共有は1作品500アカウントまでです。",
            );
            const notifications: { user: string; access: unknown }[] = [];
            db.exec("BEGIN IMMEDIATE");
            try {
              let rank = (
                db
                  .prepare(
                    "SELECT COALESCE(MAX(rank),-1) AS n FROM recipients WHERE deck=?",
                  )
                  .get(id) as { n: number }
              ).n;
              for (const recipient of recipients) {
                const prior = existing.find((r) => r.email === recipient.email);
                const known = db
                  .prepare(
                    "SELECT users.id FROM users JOIN members ON members.user_id=users.id WHERE members.deck=? AND lower(users.email)=?",
                  )
                  .all(id, recipient.email) as { id: string }[];
                const target =
                  prior?.userId ?? (known.length === 1 ? known[0].id : null);
                db.prepare(
                  "INSERT INTO recipients VALUES(?,?,?,?,?) ON CONFLICT(deck,email) DO UPDATE SET value=excluded.value,user_id=excluded.user_id",
                ).run(
                  id,
                  recipient.email,
                  JSON.stringify(recipient.access),
                  ++rank,
                  target,
                );
                if (target) {
                  db.prepare(
                    "INSERT INTO grants VALUES(?,?,?) ON CONFLICT(deck,user_id) DO UPDATE SET value=excluded.value",
                  ).run(id, target, JSON.stringify(recipient.access));
                  notifications.push({
                    user: target,
                    access: recipient.access,
                  });
                }
              }
              db.exec("COMMIT");
            } catch (error) {
              db.exec("ROLLBACK");
              throw error;
            }
            for (const value of notifications)
              for (const peer of rooms.get(id)?.clients ?? [])
                if (peer.user.id === value.user)
                  peer.ws.send(
                    JSON.stringify({ type: "access", access: value.access }),
                  );
            for (const peer of rooms.get(id)?.clients ?? [])
              peer.ws.send(JSON.stringify({ type: "roster" }));
            return json(res, 200, { recipients: recipientList(id) });
          }
        }
        if (extra?.startsWith("recipients/") && method === "DELETE") {
          member(id, u, true);
          const email = normalizeEmail(decodeURIComponent(extra.slice(11)));
          const entry = db
            .prepare("SELECT user_id FROM recipients WHERE deck=? AND email=?")
            .get(id, email) as { user_id: string | null } | undefined;
          insist(
            !entry?.user_id || entry.user_id !== access.owner,
            400,
            "ホストの参加権限は解除できません。",
          );
          db.exec("BEGIN IMMEDIATE");
          try {
            db.prepare("DELETE FROM recipients WHERE deck=? AND email=?").run(
              id,
              email,
            );
            if (entry?.user_id) {
              db.prepare("DELETE FROM grants WHERE deck=? AND user_id=?").run(
                id,
                entry.user_id,
              );
              db.prepare("DELETE FROM members WHERE deck=? AND user_id=?").run(
                id,
                entry.user_id,
              );
            }
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
          if (entry?.user_id)
            for (const peer of rooms.get(id)?.clients ?? [])
              if (peer.user.id === entry.user_id)
                peer.ws.close(4003, "作品への参加が解除されました。");
          for (const peer of rooms.get(id)?.clients ?? [])
            peer.ws.send(JSON.stringify({ type: "roster" }));
          return json(res, 200, { recipients: recipientList(id) });
        }
        if (extra === "row-accounts" && method === "GET") {
          const people = db
            .prepare(
              "SELECT users.* FROM users JOIN members ON users.id=members.user_id WHERE members.deck=?",
            )
            .all(id)
            .map((value) => {
              const person = value as unknown as User;
              return {
                id: person.id,
                name: person.name,
                access: permissions(id, person.id, access.owner),
              };
            });
          return json(
            res,
            200,
            sharedAccountNames(
              recipientList(id),
              people.filter((p) => p.id !== access.owner),
            ),
          );
        }
        if (extra === "members" && method === "GET") {
          member(id, u, true);
          return json(res, 200, {
            members: db
              .prepare(
                "SELECT users.* FROM users JOIN members ON users.id=members.user_id WHERE members.deck=?",
              )
              .all(id)
              .map((value) => {
                const user = value as unknown as User;
                return {
                  ...user,
                  access: permissions(id, user.id, access.owner),
                };
              }),
          });
        }
        if (extra === "permissions" && method === "GET")
          return json(res, 200, {
            access: permissions(id, u.id, access.owner),
          });
        if (extra?.startsWith("members/") && method === "PATCH") {
          member(id, u, true);
          const target = decodeURIComponent(extra.slice(8));
          insist(
            target !== access.owner &&
              db
                .prepare(
                  "SELECT user_id FROM members WHERE deck=? AND user_id=?",
                )
                .get(id, target),
            400,
            "参加者を選んでください。ホストの権限は変更できません。",
          );
          let grant;
          try {
            grant = parseAccess(
              JSON.parse((await body(req, 1_500_000)).toString()),
            );
          } catch {
            throw new HttpError(400, "権限の設定が正しくありません。");
          }
          db.prepare(
            "INSERT INTO grants VALUES(?,?,?) ON CONFLICT(deck,user_id) DO UPDATE SET value=excluded.value",
          ).run(id, target, JSON.stringify(grant));
          db.prepare(
            "UPDATE recipients SET value=? WHERE deck=? AND user_id=?",
          ).run(JSON.stringify(grant), id, target);
          for (const peer of rooms.get(id)?.clients ?? [])
            if (peer.user.id === target)
              peer.ws.send(JSON.stringify({ type: "access", access: grant }));
          for (const peer of rooms.get(id)?.clients ?? [])
            peer.ws.send(JSON.stringify({ type: "roster" }));
          return json(res, 200, { access: grant });
        }
        if (
          extra === "comments" ||
          /^comments\/[a-f0-9-]{36}$/.test(extra || "")
        ) {
          const grant = permissions(id, u.id, access.owner);
          if (extra === "comments" && method === "GET")
            return json(res, 200, {
              comments: visibleComments(
                readSharedDeck(room(id).doc),
                db
                  .prepare(
                    "SELECT id,slide,author,name,text,x,y,created,color,w,h FROM comments WHERE deck=? ORDER BY created,id",
                  )
                  .all(id) as SlideComment[],
                access.owner === u.id,
              ),
            });
          if (
            (extra === "comments" && method === "POST") ||
            (extra !== "comments" && method === "PUT")
          ) {
            insist(grant.comment, 403, "コメントする権限がありません。");
            let value;
            try {
              value = parseComment(
                JSON.parse((await body(req, 1_500_000)).toString()),
              );
            } catch {
              throw new HttpError(
                400,
                "付箋は1000文字以内で入力してください。",
              );
            }
            insist(
              readSharedDeck(room(id).doc).slides.some(
                (s) => s.id === value.slide,
              ),
              404,
              "スライドが見つかりません。",
            );
            const cid = method === "PUT" ? extra!.slice(9) : randomUUID();
            const existing = db
              .prepare("SELECT * FROM comments WHERE id=?")
              .get(cid) as unknown as
              (SlideComment & { deck: string }) | undefined;
            insist(
              !existing ||
                (existing.deck === id &&
                  (access.owner === u.id || existing.author === u.id) &&
                  existing.slide === value.slide),
              403,
              "自分の付箋だけを変更できます。",
            );
            insist(
              existing ||
                (
                  db
                    .prepare("SELECT COUNT(*) AS n FROM comments WHERE deck=?")
                    .get(id) as { n: number }
                ).n < 2000,
              413,
              "付箋は作品全体で2000枚までです。",
            );
            db.prepare(
              "INSERT INTO comments(id,deck,slide,author,name,text,x,y,created,color,w,h) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text,x=excluded.x,y=excluded.y,color=excluded.color,w=excluded.w,h=excluded.h",
            ).run(
              cid,
              id,
              value.slide,
              u.id,
              u.name,
              value.text,
              value.x,
              value.y,
              Date.now(),
              value.color ?? existing?.color ?? "#fff0a6",
              value.w ?? existing?.w ?? 0.24,
              value.h ?? existing?.h ?? 0.3,
            );
          } else if (method === "DELETE" && extra !== "comments") {
            const cid = extra.slice(9),
              comment = db
                .prepare("SELECT * FROM comments WHERE deck=? AND id=?")
                .get(id, cid) as unknown as SlideComment | undefined;
            insist(
              comment && (access.owner === u.id || comment.author === u.id),
              403,
              "自分の付箋だけを削除できます。",
            );
            db.prepare("DELETE FROM comments WHERE deck=? AND id=?").run(
              id,
              cid,
            );
          } else throw new HttpError(404, "見つかりません。");
          for (const peer of rooms.get(id)?.clients ?? [])
            peer.ws.send(JSON.stringify({ type: "comments" }));
          return json(res, 200, { ok: true });
        }
        if (extra?.startsWith("members/") && method === "DELETE") {
          member(id, u, true);
          const removed = decodeURIComponent(extra.slice(8));
          db.prepare(
            "DELETE FROM join_requests WHERE deck=? AND user_id=?",
          ).run(id, removed);
          insist(removed !== u.id, 400, "作成者は参加者から削除できません。");
          db.prepare("DELETE FROM recipients WHERE deck=? AND user_id=?").run(
            id,
            removed,
          );
          db.prepare("DELETE FROM members WHERE deck=? AND user_id=?").run(
            id,
            removed,
          );
          for (const peer of rooms.get(id)?.clients ?? [])
            if (peer.user.id === removed)
              peer.ws.close(4003, "作品への参加が解除されました。");
          return json(res, 200, { ok: true });
        }
        if (extra === "assets" && method === "POST") {
          const digest = req.headers["x-restore-image"];
          if (digest) {
            member(id, u, true);
            const current = task(id, u.id);
            insist(
              ["uploading", "room_committed", "ready"].includes(current.status),
              409,
              "この復元へ写真は保存できません。",
            );
            const bytes = await body(req, 6_000_000);
            insist(
              validDigest(digest) && (await digestBytes(bytes)) === digest,
              400,
              "写真の内容が一致しません。",
            );
            const asset = await imageId(id, digest);
            if (current.status !== "uploading") {
              insist(
                db
                  .prepare("SELECT id FROM assets WHERE id=? AND deck=?")
                  .get(asset, id),
                409,
                "確定後に写真は追加できません。",
              );
              return json(res, 201, {
                src: `/api/decks/${id}/assets/${asset}`,
              });
            }
            return json(res, 201, {
              src: await saveAsset(id, u, bytes, asset),
            });
          }

          if (restoreJob)
            insist(
              task(id, u.id).status === "uploading",
              409,
              "写真の復元は確定中です。",
            );
          insist(
            permissions(id, u.id, access.owner).mode !== "none",
            403,
            "写真を追加する権限がありません。",
          );
          return json(res, 201, {
            src: await saveAsset(id, u, await body(req, 6_000_000)),
          });
        }
        const asset = /^assets\/([a-f0-9-]{36})$/.exec(extra ?? "");
        if (asset && method === "GET") {
          const found = db
            .prepare("SELECT mime FROM assets WHERE deck=? AND id=?")
            .get(id, asset[1]) as { mime: string } | undefined;
          insist(found, 404, "写真が見つかりません。");
          insist(
            mayReadAsset(id, asset[1], u, access.owner),
            404,
            "写真が見つかりません。",
          );
          const bytes = await storage.read(asset[1]);
          const latestAccess = member(id, u);
          insist(
            mayReadAsset(id, asset[1], u, latestAccess.owner),
            404,
            "写真が見つかりません。",
          );
          res.writeHead(200, {
            "Content-Type": found.mime,
            "Content-Length": bytes.length,
            "Cache-Control": "private, no-store",
          });
          return res.end(bytes);
        }
        throw new HttpError(404, "見つかりません。");
      }
      insist(
        method === "GET" || method === "HEAD",
        405,
        "この操作には対応していません。",
      );
      const root = resolve("dist");
      let file = resolve(root, `.${decodeURIComponent(path)}`);
      insist(
        file.startsWith(`${root}/`) || file === root,
        404,
        "見つかりません。",
      );
      if (file === root || !extname(file)) file = join(root, "index.html");
      insist(
        statSync(file, { throwIfNoEntry: false })?.isFile(),
        404,
        "見つかりません。",
      );
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
      };
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        "Cache-Control":
          extname(file) === ".html"
            ? "no-store"
            : "public, max-age=31536000, immutable",
      });
      res.end(method === "HEAD" ? undefined : readFileSync(file));
    } catch (error) {
      if (res.headersSent) return res.end();
      const status =
        error instanceof HttpError || error instanceof JoinRequestError
          ? error.status
          : error instanceof SyntaxError
            ? 400
            : 500;
      json(res, status, {
        error:
          status < 500
            ? (error as Error).message
            : "サーバーで処理できませんでした。時間をおいてお試しください。",
      });
    } finally {
      releaseJob?.();
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 3_000_000,
    perMessageDeflate: false,
  });
  function broadcastPresence(r: Room) {
    const members = [
      ...new Map(
        [...r.clients]
          .filter((p) => p.ws.readyState === WebSocket.OPEN)
          .map((p) => [p.user.id, { id: p.user.id, name: p.user.name }]),
      ).values(),
    ];
    for (const peer of r.clients)
      if (peer.ws.readyState === WebSocket.OPEN)
        peer.ws.send(JSON.stringify({ type: "presence", members }));
  }
  server.on("upgrade", (req, socket, head) => {
    try {
      insist(req.headers.origin === origin, 403, "接続できません。");
      const match = /^\/api\/decks\/([a-f0-9-]{36})\/live$/.exec(req.url ?? "");
      insist(match, 404, "見つかりません。");
      const u = user(req),
        id = match[1];
      member(id, u);
      insist(
        peers.size < maximumConnections,
        503,
        "ただいま混み合っています。",
      );
      insist(
        !db.prepare("SELECT deck FROM restore_jobs WHERE deck=?").get(id),
        409,
        "復元中の作品です。",
      );
      const r = room(id);
      insist(
        r.clients.size < maximumRoom,
        503,
        "この作品の同時参加人数の上限です。",
      );
      wss.handleUpgrade(req, socket, head, (ws) => {
        const peer: Peer = {
          ws,
          user: u,
          session: sessionHash(req),
          room: id,
          alive: true,
        };
        peers.add(peer);
        r.clients.add(peer);
        ws.send(
          JSON.stringify({
            type: "hello",
            protocol: COLLABORATION_PROTOCOL,
            vector: toBase64(Y.encodeStateVector(r.doc)),
          }),
        );
        ws.send(Y.encodeStateAsUpdate(r.doc));
        broadcastPresence(r);
        ws.on("pong", () => {
          peer.alive = true;
        });
        ws.on("error", () => {});
        ws.on("message", (data, binary) => {
          let candidate: Y.Doc | undefined;
          let persistence = false;
          try {
            insist(!binary, 400, "通信形式が正しくありません。");
            insist(
              db
                .prepare("SELECT hash FROM sessions WHERE hash=? AND expires>?")
                .get(peer.session, Date.now()),
              401,
              "サインインし直してください。",
            );
            const work = member(id, u);
            rateLimit(`updates:${id}:${u.id}`, 1200);
            const message = JSON.parse(data.toString());
            insist(
              message.type === "update" &&
                typeof message.update === "string" &&
                typeof message.id === "string" &&
                message.id.length < 100,
              400,
              "通信形式が正しくありません。",
            );
            insist(
              message.protocol === COLLABORATION_PROTOCOL,
              409,
              "新しい権限方式に更新されました。未保存の変更はJSONに保存し、ページを再読み込みしてください。",
            );
            const update = fromBase64(message.update);
            rateLimit(`update-bytes:${u.id}`, 8_000_000, update.length);
            candidate = new Y.Doc();
            Y.applyUpdate(candidate, Y.encodeStateAsUpdate(r.doc));
            applyAuthorizedUpdate(
              r.doc,
              candidate,
              update,
              permissions(id, u.id, work.owner),
              work.owner === u.id,
            );
            const deck = validate(candidate, id),
              beforeDeck = readSharedDeck(r.doc);
            assertMediaReferences(
              beforeDeck,
              deck,
              work.owner === u.id,
              (src) => ownsPending(src.split("/").at(-1)!, u.id),
              (slide) =>
                !!db
                  .prepare(
                    "SELECT id FROM comments WHERE deck=? AND slide=? LIMIT 1",
                  )
                  .get(id, slide),
            );
            const removedPage = beforeDeck.slides.some(
              (s) => !deck.slides.some((t) => t.id === s.id),
            );
            persistence = true;
            db.exec("BEGIN IMMEDIATE");
            try {
              historyBeforeChange(
                historySQL,
                id,
                readSharedDeck(r.doc),
                deck,
                () =>
                  db
                    .prepare(
                      "SELECT * FROM comments WHERE deck=? ORDER BY created,id",
                    )
                    .all(id) as SlideComment[],
              );
              consumePendingAssets(historySQL, imageSources(deck));
              db.prepare("INSERT INTO updates(deck,data) VALUES(?,?)").run(
                id,
                update,
              );
              db.prepare("UPDATE decks SET title=?,updated=? WHERE id=?").run(
                deck.title,
                Date.now(),
                id,
              );
              db.exec("COMMIT");
            } catch (error) {
              db.exec("ROLLBACK");
              throw error;
            }
            Y.applyUpdate(r.doc, update);
            r.media = undefined;
            r.updates++;
            r.touched = Date.now();
            if (r.updates >= 200) compact(id, r);
            for (const other of r.clients)
              if (other !== peer && other.ws.readyState === WebSocket.OPEN) {
                if (other.ws.bufferedAmount > 4_000_000)
                  other.ws.close(1013, "接続し直しています。");
                else other.ws.send(update);
              }
            if (removedPage)
              for (const other of r.clients)
                if (other.ws.readyState === WebSocket.OPEN)
                  other.ws.send(JSON.stringify({ type: "comments" }));
            ws.send(JSON.stringify({ type: "ack", id: message.id }));
          } catch (error) {
            const recovery = syncFailure(
              error instanceof HttpError ? error.status : undefined,
              persistence,
              error instanceof AccessError,
            );
            ws.send(
              JSON.stringify({
                type: "error",
                ...recovery,
                message:
                  recovery.retryable && recovery.code !== "rate_limited"
                    ? "クラウドに保存できません。変更を保持して再接続を試みます。"
                    : error instanceof AccessError
                      ? error.message
                      : error instanceof HttpError && error.status < 500
                        ? error.message
                        : "変更を保存できませんでした。JSONを保存してから作品を開き直してください。",
              }),
            );
            ws.close(
              recovery.closeCode,
              recovery.retryable
                ? "再接続を待っています。"
                : "変更の確認が必要です。",
            );
          } finally {
            candidate?.destroy();
          }
        });
        ws.on("close", () => {
          peers.delete(peer);
          r.clients.delete(peer);
          r.touched = Date.now();
          broadcastPresence(r);
        });
      });
    } catch (error) {
      socket.write(
        `HTTP/1.1 ${error instanceof HttpError ? error.status : 500} Error\r\nConnection: close\r\n\r\n`,
      );
      socket.destroy();
    }
  });
  const timer = setInterval(() => {
    for (const peer of peers) {
      if (
        !db
          .prepare("SELECT hash FROM sessions WHERE hash=? AND expires>?")
          .get(peer.session, Date.now())
      ) {
        peer.ws.close(4001, "サインインし直してください。");
        continue;
      }
      if (!peer.alive) peer.ws.terminate();
      else {
        peer.alive = false;
        peer.ws.ping();
      }
    }
    for (const [id, r] of rooms)
      if (!r.clients.size && r.touched < Date.now() - 60_000) {
        compact(id, r);
        r.doc.destroy();
        rooms.delete(id);
      }
    for (const [key, entry] of rate)
      if (entry.until < Date.now()) rate.delete(key);
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  }, 30_000);
  timer.unref();
  return {
    server,
    async close() {
      clearInterval(timer);
      for (const peer of peers) peer.ws.terminate();
      wss.close();
      for (const [id, r] of rooms) {
        compact(id, r);
        r.doc.destroy();
      }
      rooms.clear();
      storage.close();
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
      db.close();
    },
  };
}
