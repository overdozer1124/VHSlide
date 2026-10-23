import { defaultAccess, hostAccess, parseAccess } from "../src/permissions.ts";
import { DurableObject } from "cloudflare:workers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { parseDeck } from "../src/model.ts";
import type { Deck } from "../src/model.ts";
import { fromBase64 } from "../src/sharedDeck.ts";
import {
  body,
  checked,
  failure,
  HttpError,
  input,
  insist,
  internal,
  json,
  mime,
  one,
  randomToken,
  room,
  rows,
  sha,
  text,
} from "./common.ts";
import type { Env, Identity, User } from "./common.ts";

const keys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const MAX_ASSETS = 500_000_000;
const MAX_USER_ASSETS = 50_000_000;
interface Work {
  id: string;
  owner: string;
  title: string;
  updated: number;
  status: string;
}

/** Private account directory. Only the Worker and other bound objects can call it. */
export class Directory extends DurableObject<Env> {
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS decks (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, updated INTEGER NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(deck,user_id));
      CREATE TABLE IF NOT EXISTS grants (deck TEXT NOT NULL, user_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(deck,user_id), FOREIGN KEY(deck,user_id) REFERENCES members(deck,user_id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, owner TEXT NOT NULL, bytes INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
      CREATE INDEX IF NOT EXISTS assets_owner ON assets(owner);
      CREATE TABLE IF NOT EXISTS rates (id TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL);
    `);
  }
  private rate(id: string, max: number) {
    const now = Date.now();
    const prior = one<{ n: number; until: number }>(
      this.sql,
      "SELECT n,until FROM rates WHERE id=?",
      id,
    );
    insist(
      !prior || prior.until <= now || prior.n < max,
      429,
      "操作が多いため、少し待ってからお試しください。",
    );
    this.sql.exec(
      "INSERT INTO rates VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET n=excluded.n,until=excluded.until",
      id,
      prior && prior.until > now ? prior.n + 1 : 1,
      prior && prior.until > now ? prior.until : now + 60_000,
    );
  }
  private async identity(request: Request): Promise<Identity> {
    const raw = /(?:^|;\s*)vhslide_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(
      request.headers.get("Cookie") || "",
    )?.[1];
    const session = raw ? await sha(raw) : "";
    const found = one<User & { expires: number }>(
      this.sql,
      "SELECT users.*,sessions.expires FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND expires>?",
      session,
      Date.now(),
    );
    insist(found, 401, "Googleアカウントでサインインしてください。");
    return {
      user: { id: found.id, name: found.name, email: found.email },
      expires: found.expires,
      session,
    };
  }
  private access(
    id: string,
    user: User,
    ownerOnly = false,
    incomplete = false,
  ) {
    const work = one<Work>(
      this.sql,
      "SELECT decks.* FROM decks JOIN members ON members.deck=decks.id WHERE decks.id=? AND members.user_id=?",
      id,
      user.id,
    );
    insist(
      work &&
        (!ownerOnly || work.owner === user.id) &&
        (work.status === "ready" || (incomplete && work.owner === user.id)),
      404,
      "作品が見つからないか、参加する権限がありません。",
    );
    return work;
  }
  private permissions(id: string, user: string, owner: string) {
    if (owner === user) return hostAccess();
    const grant = one<{ value: string }>(
      this.sql,
      "SELECT value FROM grants WHERE deck=? AND user_id=?",
      id,
      user,
    );
    return grant ? parseAccess(JSON.parse(grant.value)) : defaultAccess();
  }
  private removeWork(id: string) {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM assets WHERE deck=?", id);
      this.sql.exec("DELETE FROM invites WHERE deck=?", id);
      this.sql.exec("DELETE FROM grants WHERE deck=?", id);
      this.sql.exec("DELETE FROM members WHERE deck=?", id);
      this.sql.exec("DELETE FROM decks WHERE id=?", id);
    });
  }
  private async saveAsset(work: Work, bytes: Uint8Array, user: User) {
    const current = one<Work>(
      this.sql,
      "SELECT decks.* FROM decks JOIN members ON members.deck=decks.id WHERE decks.id=? AND members.user_id=?",
      work.id,
      user.id,
    );
    insist(
      current && ["creating", "ready"].includes(current.status),
      404,
      "作品が見つからないか、参加する権限がありません。",
    );
    const type = mime(bytes);
    insist(
      type && bytes.length <= 6_000_000,
      400,
      "6MB以下のPNG・JPEG・WebP・GIF画像を選んでください。",
    );
    // Reserve before awaiting: concurrent uploads cannot overrun the account/owner quota.
    const total = one<{ n: number }>(
      this.sql,
      "SELECT COALESCE(SUM(bytes),0) AS n FROM assets",
    )!.n;
    const owner = one<{ n: number }>(
      this.sql,
      "SELECT COALESCE(SUM(bytes),0) AS n FROM assets WHERE owner=?",
      work.owner,
    )!.n;
    insist(
      total + bytes.length <= MAX_ASSETS &&
        owner + bytes.length <= MAX_USER_ASSETS,
      413,
      "写真の保存容量の上限です（作成者ごと50MB・アプリ全体500MB）。不要な作品を整理してください。",
    );
    const asset = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO assets VALUES(?,?,?,?)",
      asset,
      work.id,
      work.owner,
      bytes.length,
    );
    try {
      await checked(
        await room(this.env, work.id).fetch(
          new Request(`https://internal/assets/${asset}`, {
            method: "POST",
            headers: { "Content-Type": type },
            body: bytes,
          }),
        ),
      );
    } catch (error) {
      this.sql.exec("DELETE FROM assets WHERE id=?", asset);
      throw error;
    }
    return `/api/decks/${work.id}/assets/${asset}`;
  }
  async fetch(request: Request): Promise<Response> {
    try {
      return await this.handle(request);
    } catch (error) {
      return failure(error);
    }
  }
  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url),
      path = url.pathname,
      method = request.method;
    if (path === "/internal/authorize" && method === "POST") {
      const data = await input(request);
      const active = one(
        this.sql,
        "SELECT sessions.hash FROM sessions JOIN members ON members.user_id=sessions.user_id JOIN decks ON decks.id=members.deck WHERE sessions.hash=? AND sessions.user_id=? AND sessions.expires>? AND members.deck=? AND decks.status='ready'",
        data.session,
        data.user,
        Date.now(),
        data.room,
      );
      insist(
        active,
        401,
        "サインインし直すか、作品への参加権限を確認してください。",
      );
      const work = one<Work>(
        this.sql,
        "SELECT * FROM decks WHERE id=?",
        data.room,
      )!;
      return json({
        access: this.permissions(data.room, data.user, work.owner),
        host: work.owner === data.user,
      });
    }
    if (path === "/internal/touched" && method === "POST") {
      const data = await input(request);
      this.sql.exec(
        "UPDATE decks SET title=?,updated=? WHERE id=? AND status='ready'",
        String(data.title).slice(0, 200),
        Date.now(),
        data.id,
      );
      return json({ ok: true });
    }
    if (path === "/api/config" && method === "GET")
      return json({
        clientId: this.env.GOOGLE_CLIENT_ID,
        enabled: !!this.env.GOOGLE_CLIENT_ID,
        syncIntervalMs: 1000,
        notice:
          "無料プラン：上限に達するとクラウド機能が停止します。写真は作成者ごと50MB・全体500MBまで。授業の終わりにはJSONも保存してください。",
      });
    if (path === "/api/session" && method === "GET") {
      try {
        return json({ user: (await this.identity(request)).user });
      } catch (error) {
        if (error instanceof HttpError && error.status === 401)
          return json({ user: null });
        throw error;
      }
    }
    const origin = this.env.PUBLIC_ORIGIN || url.origin;
    const cookie = (raw: string, age: number) =>
      `vhslide_session=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${origin.startsWith("https:") ? "; Secure" : ""}`;
    if (path === "/api/auth/google" && method === "POST") {
      insist(this.env.GOOGLE_CLIENT_ID, 503, "クラウド機能は準備中です。");
      this.rate(
        `login:${request.headers.get("CF-Connecting-IP") || "unknown"}`,
        120,
      );
      const data = await input(request);
      insist(
        typeof data.credential === "string",
        400,
        "サインイン情報を確認できません。",
      );
      let user: User;
      try {
        const { payload } = await jwtVerify(data.credential, keys, {
          audience: this.env.GOOGLE_CLIENT_ID,
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
        user = {
          id: payload.sub,
          name: String(payload.name ?? payload.email).slice(0, 100),
          email: payload.email.slice(0, 320),
        };
      } catch {
        throw new HttpError(
          401,
          "Googleのサインインを確認できませんでした。もう一度お試しください。",
        );
      }
      const raw = randomToken(),
        hash = await sha(raw);
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "INSERT INTO users VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",
          user.id,
          user.name,
          user.email,
        );
        this.sql.exec(
          "INSERT INTO sessions VALUES(?,?,?)",
          hash,
          user.id,
          Date.now() + 7 * 86400_000,
        );
      });
      if ((await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now() + 86400_000);
      return json({ user }, 200, { "Set-Cookie": cookie(raw, 7 * 86400) });
    }
    const identity = await this.identity(request),
      user = identity.user;
    if (path === "/api/logout" && method === "POST") {
      this.sql.exec("DELETE FROM sessions WHERE hash=?", identity.session);
      const works = rows<{ deck: string }>(
        this.sql,
        "SELECT deck FROM members WHERE user_id=?",
        user.id,
      );
      await Promise.all(
        works.map((work) =>
          room(this.env, work.deck)
            .fetch(internal("/revoke", { session: identity.session }))
            .then(checked),
        ),
      );
      return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    }
    if (method !== "GET") this.rate(`api:${user.id}`, 120);
    if (path === "/api/decks" && method === "GET")
      return json({
        decks: rows<Work>(
          this.sql,
          "SELECT decks.id,decks.title,decks.owner,decks.updated FROM decks JOIN members ON members.deck=decks.id WHERE members.user_id=? AND (status='ready' OR decks.owner=?) ORDER BY updated DESC",
          user.id,
          user.id,
        ),
      });
    if (path === "/api/decks" && method === "POST") {
      insist(
        one<{ n: number }>(
          this.sql,
          "SELECT COUNT(*) AS n FROM decks WHERE owner=?",
          user.id,
        )!.n < 40,
        413,
        "保存できる作品数の上限です（40作品）。",
      );
      let deck: Deck;
      try {
        deck = parseDeck(text(await body(request, 10_000_000)));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, (error as Error).message);
      }
      const work: Work = {
        id: crypto.randomUUID(),
        owner: user.id,
        title: deck.title,
        updated: Date.now(),
        status: "creating",
      };
      this.ctx.storage.transactionSync(() => {
        insist(
          one<{ n: number }>(
            this.sql,
            "SELECT COUNT(*) AS n FROM decks WHERE owner=?",
            user.id,
          )!.n < 40,
          413,
          "保存できる作品数の上限です（40作品）。",
        );
        this.sql.exec(
          "INSERT INTO decks VALUES(?,?,?,?,?)",
          work.id,
          user.id,
          work.title,
          work.updated,
          work.status,
        );
        this.sql.exec("INSERT INTO members VALUES(?,?)", work.id, user.id);
      });
      try {
        for (const slide of deck.slides)
          for (const e of slide.elements)
            if (e.type === "image") {
              const src = e.src;
              insist(
                typeof src === "string" && src.startsWith("data:"),
                400,
                "写真を含むJSONを読み込んでから保存してください。",
              );
              e.src = await this.saveAsset(
                work,
                fromBase64(src.slice(src.indexOf(",") + 1)),
                user,
              );
            }
        await checked(
          await room(this.env, work.id).fetch(
            internal("/init", { id: work.id, deck }),
          ),
        );
        this.sql.exec("UPDATE decks SET status='ready' WHERE id=?", work.id);
      } catch (error) {
        try {
          await checked(
            await room(this.env, work.id).fetch(internal("/delete", {})),
          );
          this.removeWork(work.id);
        } catch {
          // Keep the reservation and an owner-visible row for deletion after recovery.
          this.sql.exec("UPDATE decks SET status='failed' WHERE id=?", work.id);
        }
        throw error;
      }
      return json({ id: work.id }, 201);
    }
    const invite = /^\/api\/invites\/([A-Za-z0-9_-]{43})\/accept$/.exec(path);
    if (invite && method === "POST") {
      const found = one<{ deck: string }>(
        this.sql,
        "SELECT invites.deck FROM invites JOIN decks ON invites.deck=decks.id WHERE hash=? AND status='ready'",
        await sha(invite[1]),
      );
      insist(found, 404, "招待リンクは無効か、更新されています。");
      this.sql.exec(
        "INSERT OR IGNORE INTO members VALUES(?,?)",
        found.deck,
        user.id,
      );
      return json({ id: found.deck });
    }
    const match = /^\/api\/decks\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(path);
    insist(match, 404, "見つかりません。");
    const [, id, extra] = match,
      work = this.access(id, user, false, !extra && method === "DELETE");
    if (!extra && method === "GET") {
      const response = await checked(
        await room(this.env, id).fetch(internal("/state")),
      );
      return json({
        id,
        owner: work.owner,
        access: this.permissions(id, user.id, work.owner),
        ...((await response.json()) as object),
      });
    }
    if (!extra && method === "DELETE") {
      this.access(id, user, true, true);
      this.sql.exec("UPDATE decks SET status='deleting' WHERE id=?", id);
      await checked(await room(this.env, id).fetch(internal("/delete", {})));
      this.removeWork(id);
      return json({ ok: true });
    }
    if (extra === "invite") {
      this.access(id, user, true);
      if (method === "POST" || method === "DELETE") {
        const raw = randomToken(),
          hash = await sha(raw);
        this.ctx.storage.transactionSync(() => {
          this.sql.exec("DELETE FROM invites WHERE deck=?", id);
          if (method === "POST")
            this.sql.exec("INSERT INTO invites VALUES(?,?)", hash, id);
        });
        return method === "POST"
          ? json({ url: `${origin}/?join=${raw}` })
          : json({ ok: true });
      }
    }
    if (extra === "members" && method === "GET") {
      this.access(id, user, true);
      return json({
        members: rows<User>(
          this.sql,
          "SELECT users.* FROM users JOIN members ON users.id=members.user_id WHERE members.deck=?",
          id,
        ).map((member) => ({
          ...member,
          access: this.permissions(id, member.id, work.owner),
        })),
      });
    }
    if (extra === "permissions" && method === "GET")
      return json({ access: this.permissions(id, user.id, work.owner) });
    if (extra?.startsWith("members/") && method === "PATCH") {
      this.access(id, user, true);
      const target = decodeURIComponent(extra.slice(8));
      insist(
        target !== work.owner &&
          one(
            this.sql,
            "SELECT user_id FROM members WHERE deck=? AND user_id=?",
            id,
            target,
          ),
        400,
        "参加者を選んでください。ホストの権限は変更できません。",
      );
      let access;
      try {
        access = parseAccess(await input(request, 1_500_000));
      } catch {
        throw new HttpError(400, "権限の設定が正しくありません。");
      }
      this.sql.exec(
        "INSERT INTO grants VALUES(?,?,?) ON CONFLICT(deck,user_id) DO UPDATE SET value=excluded.value",
        id,
        target,
        JSON.stringify(access),
      );
      await checked(
        await room(this.env, id).fetch(
          internal("/permissions", { user: target, access }),
        ),
      );
      return json({ access });
    }
    if (extra === "comments" || /^comments\/[a-f0-9-]{36}$/.test(extra || "")) {
      const access = this.permissions(id, user.id, work.owner);
      insist(
        method === "GET" ||
          method === "DELETE" ||
          (method === "POST" && access.comment),
        403,
        "コメントする権限がありません。",
      );
      return room(this.env, id).fetch(
        internal(`/${extra}`, {
          method,
          user,
          host: work.owner === user.id,
          ...(method === "POST" ? { value: await input(request) } : {}),
        }),
      );
    }
    if (extra?.startsWith("members/") && method === "DELETE") {
      this.access(id, user, true);
      const removed = decodeURIComponent(extra.slice(8));
      insist(removed !== user.id, 400, "作成者は参加者から削除できません。");
      this.sql.exec(
        "DELETE FROM grants WHERE deck=? AND user_id=?",
        id,
        removed,
      );
      this.sql.exec(
        "DELETE FROM members WHERE deck=? AND user_id=?",
        id,
        removed,
      );
      await checked(
        await room(this.env, id).fetch(internal("/revoke", { user: removed })),
      );
      return json({ ok: true });
    }
    if (extra === "assets" && method === "POST") {
      insist(
        this.permissions(id, user.id, work.owner).mode !== "none",
        403,
        "写真を追加する権限がありません。",
      );
      return json(
        {
          src: await this.saveAsset(work, await body(request, 6_000_000), user),
        },
        201,
      );
    }
    if (/^assets\/[a-f0-9-]{36}$/.test(extra || "") && method === "GET")
      return room(this.env, id).fetch(internal(`/${extra}`));
    if (
      extra === "live" &&
      method === "GET" &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket"
    )
      return room(this.env, id).fetch(
        new Request("https://internal/live", {
          headers: {
            Upgrade: "websocket",
            "X-Identity": encodeURIComponent(JSON.stringify(identity)),
          },
        }),
      );
    throw new HttpError(404, "見つかりません。");
  }
  async alarm() {
    this.sql.exec("DELETE FROM sessions WHERE expires<=?", Date.now());
    this.sql.exec("DELETE FROM rates WHERE until<=?", Date.now());
  }
}
