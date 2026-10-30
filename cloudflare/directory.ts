import {
  joinSchema,
  requestJoin,
  joinState,
  pendingJoins,
  decideJoins,
  pendingJoinCountSQL,
} from "../src/joinRequests.ts";
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
  BACKUP_METADATA_BYTES,
} from "../src/backupData.ts";
import { blank } from "../src/model.ts";
import type { SlideComment } from "../src/permissions.ts";
import {
  normalizeEmail,
  parseRecipients,
  sharedAccountNames,
} from "../src/preSharing.ts";
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
      CREATE TABLE IF NOT EXISTS recipients (deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, email TEXT NOT NULL, value TEXT NOT NULL, rank INTEGER NOT NULL, user_id TEXT, PRIMARY KEY(deck,email));
      CREATE INDEX IF NOT EXISTS recipients_email ON recipients(email);
      CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, owner TEXT NOT NULL, bytes INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
      CREATE INDEX IF NOT EXISTS assets_owner ON assets(owner);
      CREATE TABLE IF NOT EXISTS work_trash(deck TEXT PRIMARY KEY, created INTEGER NOT NULL, purging INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS rates (id TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL);
    `);
    if (
      ![
        ...this.sql.exec<{ name: string }>("PRAGMA table_info(work_trash)"),
      ].some((c) => c.name === "purging")
    )
      this.sql.exec(
        "ALTER TABLE work_trash ADD COLUMN purging INTEGER NOT NULL DEFAULT 0",
      );
    this.sql.exec(joinSchema);
    this.sql.exec(revisionSchema("directory") + restoreSchema);
    this.sql
      .exec(`INSERT OR IGNORE INTO restore_tasks(id,owner,request_key,content_hash,apply_sharing,title,status,created)
      SELECT id,owner,'legacy:'||id,'',-1,title,'uploading',updated FROM decks WHERE status='restoring'`);
  }
  private revision(id: string) {
    return (
      one<{ revision: string }>(this.sql, revisionQuery, id)?.revision ?? "0"
    );
  }
  private task(id: string, owner: string) {
    const row = one<Record<string, unknown>>(
      this.sql,
      taskQuery + " WHERE id=? AND owner=?",
      id,
      owner,
    );
    insist(row, 404, "復元ジョブが見つかりません。");
    return taskView(row);
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
        (work.status === "ready" || (incomplete && work.owner === user.id)) &&
        (!one(this.sql, "SELECT deck FROM work_trash WHERE deck=?", id) ||
          (incomplete && work.owner === user.id)),
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
  private async claim(user: User) {
    const pending = rows<{ deck: string; email: string; value: string }>(
      this.sql,
      "SELECT recipients.deck,recipients.email,recipients.value FROM recipients JOIN decks ON decks.id=recipients.deck WHERE recipients.email=? AND recipients.user_id IS NULL AND decks.status='ready' AND decks.owner<>?",
      normalizeEmail(user.email),
      user.id,
    );
    for (const recipient of pending) {
      let value: string | undefined;
      this.ctx.storage.transactionSync(() => {
        const current = one<{ value: string }>(
          this.sql,
          "SELECT recipients.value FROM recipients JOIN decks ON decks.id=recipients.deck WHERE recipients.deck=? AND recipients.email=? AND recipients.user_id IS NULL AND decks.status='ready' AND decks.owner<>?",
          recipient.deck,
          recipient.email,
          user.id,
        );
        if (!current) return;
        value = current.value;
        this.sql.exec(
          "INSERT OR IGNORE INTO members VALUES(?,?)",
          recipient.deck,
          user.id,
        );
        this.sql.exec(
          "INSERT INTO grants VALUES(?,?,?) ON CONFLICT(deck,user_id) DO UPDATE SET value=excluded.value",
          recipient.deck,
          user.id,
          value,
        );
        this.sql.exec(
          "UPDATE recipients SET user_id=? WHERE deck=? AND email=? AND user_id IS NULL",
          user.id,
          recipient.deck,
          recipient.email,
        );
      });
      if (value)
        await checked(
          await room(this.env, recipient.deck).fetch(
            internal("/permissions", {
              user: user.id,
              access: JSON.parse(value),
            }),
          ),
        );
    }
  }
  private recipientList(id: string) {
    return rows<{
      email: string;
      value: string;
      user_id: string | null;
      name: string | null;
    }>(
      this.sql,
      "SELECT recipients.email,recipients.value,recipients.user_id,users.name FROM recipients LEFT JOIN users ON users.id=recipients.user_id WHERE deck=? ORDER BY recipients.rank,recipients.email",
      id,
    ).map((r) => ({
      email: r.email,
      access: JSON.parse(r.value),
      ...(r.user_id ? { userId: r.user_id, name: r.name } : {}),
    }));
  }
  private removeWork(id: string) {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM assets WHERE deck=?", id);
      this.sql.exec("DELETE FROM invites WHERE deck=?", id);
      this.sql.exec("DELETE FROM recipients WHERE deck=?", id);
      this.sql.exec("DELETE FROM grants WHERE deck=?", id);
      this.sql.exec("DELETE FROM members WHERE deck=?", id);
      this.sql.exec("DELETE FROM join_requests WHERE deck=?", id);
      this.sql.exec("DELETE FROM work_trash WHERE deck=?", id);
      this.sql.exec("DELETE FROM decks WHERE id=?", id);
    });
  }
  private async saveAsset(
    work: Work,
    bytes: Uint8Array,
    user: User,
    assetId?: string,
  ) {
    const current = one<Work>(
      this.sql,
      "SELECT decks.* FROM decks JOIN members ON members.deck=decks.id WHERE decks.id=? AND members.user_id=?",
      work.id,
      user.id,
    );
    insist(
      current &&
        (["creating", "ready"].includes(current.status) ||
          (current.status === "restoring" && current.owner === user.id)),
      404,
      "作品が見つからないか、参加する権限がありません。",
    );
    const type = mime(bytes);
    insist(
      type && bytes.length <= 6_000_000,
      400,
      "6MB以下のPNG・JPEG・WebP・GIF画像を選んでください。",
    );
    const asset = assetId ?? crypto.randomUUID();
    const existing = one(
      this.sql,
      "SELECT id FROM assets WHERE id=? AND deck=?",
      asset,
      work.id,
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
      existing ||
        (total + bytes.length <= MAX_ASSETS &&
          owner + bytes.length <= MAX_USER_ASSETS),
      413,
      "写真の保存容量の上限です（作成者ごと50MB・アプリ全体500MB）。不要な作品を整理してください。",
    );
    if (!existing)
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
            headers: { "Content-Type": type, "X-Uploaded-By": user.id },
            body: bytes,
          }),
        ),
      );
    } catch (error) {
      if (!existing && !assetId)
        this.sql.exec("DELETE FROM assets WHERE id=?", asset);
      throw error;
    }
    return `/api/decks/${work.id}/assets/${asset}`;
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (
        (path === "/api/restores" && request.method === "POST") ||
        (/^\/api\/decks\/[a-f0-9-]{36}(?:\/(?:restore|trash|untrash))?$/.test(
          path,
        ) &&
          ["POST", "DELETE"].includes(request.method)) ||
        (request.method === "POST" && request.headers.has("X-Restore-Image"))
      ) {
        // Do not hold the Directory input gate while a slow client sends its body.
        const identity = await this.identity(request);
        const target = /^\/api\/decks\/([a-f0-9-]{36})/.exec(path);
        let denied: unknown;
        if (target) {
          try {
            this.access(target[1], identity.user, true, true);
          } catch (error) {
            // A known owner may replay a cancelled job with a request body.
            // Drain only this authenticated, bounded request before returning
            // its 404; otherwise workerd can reset the upload connection.
            if (
              !one(
                this.sql,
                "SELECT id FROM restore_tasks WHERE id=? AND owner=?",
                target[1],
                identity.user.id,
              )
            )
              throw error;
            this.rate(`api:${identity.user.id}`, 120);
            denied = error;
          }
        }
        const maximum =
          request.method === "DELETE"
            ? 20_000
            : request.headers.has("X-Restore-Image")
              ? 6_000_000
              : path === "/api/restores"
                ? 20_000
                : BACKUP_METADATA_BYTES + 1000;
        const bytes = await body(request, maximum);
        if (denied) throw denied;
        const buffered = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: new Uint8Array(bytes).buffer,
        });
        return await this.ctx.blockConcurrencyWhile(async () => {
          try {
            return await this.handle(buffered);
          } catch (error) {
            return failure(error);
          }
        });
      }
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
        "SELECT sessions.hash FROM sessions JOIN members ON members.user_id=sessions.user_id JOIN decks ON decks.id=members.deck WHERE sessions.hash=? AND sessions.user_id=? AND sessions.expires>? AND members.deck=? AND decks.status='ready' AND NOT EXISTS(SELECT 1 FROM work_trash WHERE deck=decks.id)",
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
        schoolClientId: this.env.GOOGLE_SCHOOL_CLIENT_ID || "",
        schoolDomain: this.env.GOOGLE_SCHOOL_DOMAIN || "",
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
          audience: [
            this.env.GOOGLE_CLIENT_ID,
            this.env.GOOGLE_SCHOOL_CLIENT_ID,
          ].filter((value): value is string => !!value),
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
    if (path !== "/api/logout") await this.claim(user);
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
    const lookupJoin = /^\/api\/join-requests\/([a-f0-9-]{36})$/.exec(path);
    if (lookupJoin && method === "GET")
      return json(
        joinState((q, ...a) => this.sql.exec(q, ...a), lookupJoin[1], user.id),
      );
    if (path === "/api/trash" && method === "GET")
      return json({
        decks: rows(
          this.sql,
          "SELECT decks.id,decks.title,work_trash.created,work_trash.purging FROM work_trash JOIN decks ON deck=decks.id WHERE owner=? ORDER BY created DESC",
          user.id,
        ),
      });
    if (path === "/api/restores" && method === "GET")
      return json({
        jobs: rows<Record<string, unknown>>(
          this.sql,
          taskQuery +
            " WHERE owner=? AND status<>'cancelled' ORDER BY created DESC",
          user.id,
        ).map(taskView),
      });
    const jobLookup =
      /^\/api\/(?:restores\/([a-f0-9-]{36})|decks\/([a-f0-9-]{36})\/restore)$/.exec(
        path,
      );
    if (jobLookup && method === "GET")
      return json(this.task(jobLookup[1] || jobLookup[2], user.id));
    if (path === "/api/decks" && method === "GET")
      return json({
        decks: rows<Work>(
          this.sql,
          `SELECT decks.id,decks.title,decks.owner,decks.updated,decks.status,${pendingJoinCountSQL("members.user_id")} FROM decks JOIN members ON members.deck=decks.id WHERE members.user_id=? AND (status='ready' OR decks.owner=?) AND NOT EXISTS(SELECT 1 FROM work_trash WHERE deck=decks.id) ORDER BY updated DESC`,
          user.id,
          user.id,
        ),
      });
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
        const raw = text(await body(request, 10_000_000));
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
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, (error as Error).message);
      }
      const requestKey = jobInput.key ?? crypto.randomUUID();
      if (restoring) {
        const prior = one<{
          id: string;
          content_hash: string;
          apply_sharing: number;
          status: string;
        }>(
          this.sql,
          "SELECT * FROM restore_tasks WHERE owner=? AND (request_key=? OR (?=0 AND content_hash<>'' AND content_hash=? AND apply_sharing=? AND status<>'cancelled' AND NOT EXISTS(SELECT 1 FROM work_trash WHERE deck=restore_tasks.id))) ORDER BY (request_key=?) DESC,created DESC LIMIT 1",
          user.id,
          requestKey,
          Number(jobInput.newCopy === true),
          jobInput.contentHash ?? "",
          jobInput.applySharing === undefined
            ? -1
            : Number(jobInput.applySharing),
          requestKey,
        );
        if (prior) {
          insist(
            !one(
              this.sql,
              "SELECT deck FROM work_trash WHERE deck=?",
              prior.id,
            ),
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
          const work = this.access(prior.id, user, true, true);
          if (work.status === "creating") {
            await checked(
              await room(this.env, prior.id).fetch(
                internal("/init", { id: prior.id, deck }),
              ),
            );
            this.sql.exec(
              "UPDATE decks SET status='restoring' WHERE id=?",
              prior.id,
            );
          }
          return json({ id: prior.id });
        }
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
        if (restoring)
          this.sql.exec(
            "INSERT INTO restore_tasks(id,owner,request_key,content_hash,apply_sharing,title,status,created) VALUES(?,?,?,?,?,?,'uploading',?)",
            work.id,
            user.id,
            requestKey,
            jobInput.contentHash ?? "",
            jobInput.applySharing === undefined
              ? -1
              : Number(jobInput.applySharing),
            deck.title,
            Date.now(),
          );
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
        this.sql.exec(
          "UPDATE decks SET status=? WHERE id=?",
          restoring ? "restoring" : "ready",
          work.id,
        );
      } catch (error) {
        try {
          await checked(
            await room(this.env, work.id).fetch(internal("/delete", {})),
          );
          this.removeWork(work.id);
          this.sql.exec(
            "UPDATE restore_tasks SET status='cancelled' WHERE id=?",
            work.id,
          );
        } catch {
          // Keep the reservation and an owner-visible row for deletion after recovery.
          this.sql.exec(
            "UPDATE decks SET status=? WHERE id=?",
            restoring ? "deleting" : "failed",
            work.id,
          );
          if (restoring)
            this.sql.exec(
              "UPDATE restore_tasks SET status='cancelling' WHERE id=?",
              work.id,
            );
        }
        throw error;
      }
      return json({ id: work.id }, 201);
    }
    const invite = /^\/api\/invites\/([A-Za-z0-9_-]{43})\/accept$/.exec(path);
    if (invite && method === "POST") {
      const found = one<{ deck: string }>(
        this.sql,
        "SELECT invites.deck FROM invites JOIN decks ON invites.deck=decks.id WHERE hash=? AND status='ready' AND NOT EXISTS(SELECT 1 FROM work_trash WHERE deck=decks.id)",
        await sha(invite[1]),
      );
      insist(found, 404, "招待リンクは無効か、更新されています。");
      const inviteHash = await sha(invite[1]);
      const result = this.ctx.storage.transactionSync(() =>
        requestJoin(
          (q, ...a) => this.sql.exec(q, ...a),
          found.deck,
          user.id,
          inviteHash,
        ),
      );
      return json(result, result.status === "pending" ? 202 : 200);
    }
    const match = /^\/api\/decks\/([a-f0-9-]{36})(?:\/(.*))?$/.exec(path);
    insist(match, 404, "見つかりません。");
    const [, id, extra] = match,
      work = this.access(
        id,
        user,
        false,
        (!extra && method === "DELETE") ||
          extra === "untrash" ||
          (extra === "assets" && method === "POST") ||
          (extra === "restore" && ["POST", "DELETE"].includes(method)),
      );
    insist(
      !one(this.sql, "SELECT deck FROM work_trash WHERE deck=?", id) ||
        (work.owner === user.id &&
          (extra === "untrash" ||
            ((!extra || extra === "restore") && method === "DELETE"))),
      404,
      "作品はごみ箱にあります。作品一覧に戻してから開いてください。",
    );
    if (extra === "join-requests" && method === "GET") {
      this.access(id, user, true);
      return json({
        requests: pendingJoins((q, ...a) => this.sql.exec(q, ...a), id),
      });
    }
    if (
      (extra === "join-requests/approve" || extra === "join-requests/reject") &&
      method === "POST"
    ) {
      this.access(id, user, true);
      const value = await input(request, 6000);
      const result = this.ctx.storage.transactionSync(() => {
        this.access(id, user, true);
        return decideJoins(
          (q, ...a) => this.sql.exec(q, ...a),
          id,
          value,
          extra.endsWith("/approve"),
        );
      });
      return json(result);
    }
    if ((extra === "trash" || extra === "untrash") && method === "POST") {
      this.access(id, user, true, extra === "untrash");
      this.ctx.storage.transactionSync(() => {
        if (extra === "trash") {
          this.sql.exec(
            "INSERT OR REPLACE INTO work_trash(deck,created,purging) VALUES(?,?,0)",
            id,
            Date.now(),
          );
          this.sql.exec("DELETE FROM invites WHERE deck=?", id);
          this.sql.exec(
            "DELETE FROM join_requests WHERE deck=? AND status<>'approved'",
            id,
          );
        } else {
          insist(
            work.status === "ready" &&
              !one<{ purging: number }>(
                this.sql,
                "SELECT purging FROM work_trash WHERE deck=?",
                id,
              )?.purging,
            409,
            "完全削除の途中です。完全に削除を再試行してください。",
          );
          this.sql.exec("DELETE FROM work_trash WHERE deck=?", id);
        }
        // Touch Directory revision: backups must notice a trash / restore ABA.
        this.sql.exec("UPDATE decks SET updated=? WHERE id=?", Date.now(), id);
      });
      if (extra === "trash")
        await checked(await room(this.env, id).fetch(internal("/suspend", {})));
      return json({ ok: true });
    }
    if (
      (extra === "history" || extra?.startsWith("history/")) &&
      ["GET", "POST"].includes(method)
    ) {
      this.access(id, user, true);
      const response = await room(this.env, id).fetch(
        new Request(`https://room/${extra}`, {
          method,
          ...(method === "POST"
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(await input(request, 2000)),
              }
            : {}),
        }),
      );
      this.access(id, user, true);
      return response;
    }
    if (extra === "backup/verify" && method === "POST") {
      this.access(id, user, true);
      const checkpoint = (await input(request)).checkpoint;
      insist(
        validCheckpoint(checkpoint),
        400,
        "バックアップの確認情報が正しくありません。",
      );
      const result = await checked(
        await room(this.env, id).fetch(internal("/backup/revision")),
      );
      const current = (await result.json()) as { revision: string };
      this.access(id, user, true);
      insist(
        checkpoint.directory === this.revision(id) &&
          checkpoint.room === current.revision,
        409,
        backupChanged,
      );
      return json({ ok: true });
    }
    if (extra === "backup" && method === "GET") {
      this.access(id, user, true);
      const people = () =>
        rows<User>(
          this.sql,
          "SELECT users.* FROM users JOIN members ON users.id=members.user_id WHERE members.deck=? AND users.id<>?",
          id,
          work.owner,
        ).map((p) => ({
          ...p,
          access: this.permissions(id, p.id, work.owner),
        }));
      const revision = this.revision(id);
      const recipients = this.recipientList(id),
        members = people();
      const response = await checked(
        await room(this.env, id).fetch(internal("/backup")),
      );
      const data = (await response.json()) as {
        deck: Deck;
        comments: SlideComment[];
        revision: string;
      };
      const latest = await checked(
        await room(this.env, id).fetch(internal("/backup/revision")),
      );
      const roomRevision = ((await latest.json()) as { revision: string })
        .revision;
      this.access(id, user, true);
      insist(
        revision === this.revision(id) && data.revision === roomRevision,
        409,
        backupChanged,
      );
      insist(
        JSON.stringify(recipients) === JSON.stringify(this.recipientList(id)) &&
          JSON.stringify(members) === JSON.stringify(people()),
        409,
        "共有設定が変更されました。もう一度バックアップしてください。",
      );
      return json({
        ...backupSnapshot(data.deck, data.comments, recipients, members),
        checkpoint: { directory: revision, room: data.revision },
      });
    }
    if (extra === "restore" && method === "POST") {
      try {
        this.access(id, user, true, true);
        insist(
          one(this.sql, "SELECT id FROM restore_tasks WHERE id=?", id),
          409,
          "復元は専用の新しい作品にだけ実行できます。",
        );
        const task = this.task(id, user.id);
        insist(
          !["cancelled", "cancelling"].includes(task.status),
          409,
          "この復元は取り消されています。",
        );
        const work = this.access(id, user, true, true);
        insist(
          work.status === "restoring" || task.status === "ready",
          409,
          "復元は専用の新しい作品にだけ実行できます。",
        );
        let snapshot, applySharing;
        try {
          const value = await input(request, BACKUP_METADATA_BYTES + 1000);
          insist(
            typeof value.applySharing === "boolean",
            400,
            "共有設定を確認してください。",
          );
          applySharing = value.applySharing;
          snapshot = parseBackupSnapshot(value.snapshot);
        } catch (error) {
          throw error instanceof HttpError
            ? error
            : new HttpError(400, (error as Error).message);
        }
        const commitHash = await sha(
          JSON.stringify({ snapshot, applySharing }),
        );
        const prior = one<{ commit_hash: string; apply_sharing: number }>(
          this.sql,
          "SELECT * FROM restore_tasks WHERE id=?",
          id,
        )!;
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
        if (task.status === "ready") return json({ id });
        await checked(
          await room(this.env, id).fetch(
            internal("/restore", { snapshot, owner: user.id, commitHash }),
          ),
        );
        this.sql.exec(
          "UPDATE restore_tasks SET commit_hash=?,apply_sharing=?,status='room_committed' WHERE id=?",
          commitHash,
          Number(applySharing),
          id,
        );

        this.ctx.storage.transactionSync(() => {
          if (applySharing)
            snapshot.sharing
              .filter((p) => p.email !== normalizeEmail(user.email))
              .forEach((p, rank) =>
                this.sql.exec(
                  "INSERT INTO recipients VALUES(?,?,?,?,NULL)",
                  id,
                  p.email,
                  JSON.stringify(p.access),
                  rank,
                ),
              );
          this.sql.exec(
            "UPDATE decks SET title=?,status='ready',updated=? WHERE id=?",
            snapshot.deck.title,
            Date.now(),
            id,
          );
          this.sql.exec(
            "UPDATE restore_tasks SET status='ready' WHERE id=?",
            id,
          );
        });
        return json({ id });
      } catch (error) {
        return failure(error);
      }
    }
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
    if ((!extra || extra === "restore") && method === "DELETE") {
      if (extra === "restore")
        insist(
          ["restoring", "deleting"].includes(
            this.access(id, user, true, true).status,
          ),
          409,
          "復元は完了済みです。作品一覧を確認してください。",
        );
      this.access(id, user, true, true);
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "UPDATE restore_tasks SET status='cancelling' WHERE id=?",
          id,
        );
        this.sql.exec(
          "INSERT INTO work_trash(deck,created,purging) VALUES(?,?,1) ON CONFLICT(deck) DO UPDATE SET purging=1",
          id,
          Date.now(),
        );
        this.sql.exec("UPDATE decks SET status='deleting' WHERE id=?", id);
      });
      await checked(await room(this.env, id).fetch(internal("/delete", {})));
      this.ctx.storage.transactionSync(() => {
        this.removeWork(id);
        this.sql.exec(
          "UPDATE restore_tasks SET status='cancelled' WHERE id=?",
          id,
        );
      });
      return json({ ok: true });
    }
    if (extra === "invite") {
      this.access(id, user, true);
      if (method === "POST" || method === "DELETE") {
        const raw = randomToken(),
          hash = await sha(raw);
        this.ctx.storage.transactionSync(() => {
          this.sql.exec("DELETE FROM invites WHERE deck=?", id);
          this.sql.exec(
            "DELETE FROM join_requests WHERE deck=? AND status<>'approved'",
            id,
          );
          if (method === "POST")
            this.sql.exec("INSERT INTO invites VALUES(?,?)", hash, id);
        });
        return method === "POST"
          ? json({ url: `${origin}/?join=${raw}` })
          : json({ ok: true });
      }
    }
    if (extra === "recipients") {
      this.access(id, user, true);
      if (method === "GET") return json({ recipients: this.recipientList(id) });
      if (method === "POST") {
        let recipients;
        try {
          recipients = parseRecipients(
            await input(request, 1_500_000),
            user.email,
          );
        } catch (error) {
          throw new HttpError(400, (error as Error).message);
        }
        const existing = this.recipientList(id);
        insist(
          new Set([
            ...existing.map((r) => r.email),
            ...recipients.map((r) => r.email),
          ]).size <= 500,
          413,
          "事前共有は1作品500アカウントまでです。",
        );
        const notifications: { user: string; access: unknown }[] = [];
        this.ctx.storage.transactionSync(() => {
          let rank = one<{ n: number }>(
            this.sql,
            "SELECT COALESCE(MAX(rank),-1) AS n FROM recipients WHERE deck=?",
            id,
          )!.n;
          for (const recipient of recipients) {
            const prior = existing.find((r) => r.email === recipient.email);
            const known = rows<{ id: string }>(
              this.sql,
              "SELECT users.id FROM users JOIN members ON members.user_id=users.id WHERE members.deck=? AND lower(users.email)=?",
              id,
              recipient.email,
            );
            const target =
              prior?.userId ?? (known.length === 1 ? known[0].id : null);
            this.sql.exec(
              "INSERT INTO recipients VALUES(?,?,?,?,?) ON CONFLICT(deck,email) DO UPDATE SET value=excluded.value,user_id=excluded.user_id",
              id,
              recipient.email,
              JSON.stringify(recipient.access),
              ++rank,
              target,
            );
            if (target) {
              this.sql.exec(
                "INSERT INTO grants VALUES(?,?,?) ON CONFLICT(deck,user_id) DO UPDATE SET value=excluded.value",
                id,
                target,
                JSON.stringify(recipient.access),
              );
              notifications.push({ user: target, access: recipient.access });
            }
          }
        });
        for (const value of notifications)
          await checked(
            await room(this.env, id).fetch(internal("/permissions", value)),
          );
        await checked(await room(this.env, id).fetch(internal("/roster", {})));
        return json({ recipients: this.recipientList(id) });
      }
    }
    if (extra?.startsWith("recipients/") && method === "DELETE") {
      this.access(id, user, true);
      const email = normalizeEmail(decodeURIComponent(extra.slice(11)));
      const entry = one<{ user_id: string | null }>(
        this.sql,
        "SELECT user_id FROM recipients WHERE deck=? AND email=?",
        id,
        email,
      );
      insist(
        !entry?.user_id || entry.user_id !== work.owner,
        400,
        "ホストの参加権限は解除できません。",
      );
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          "DELETE FROM recipients WHERE deck=? AND email=?",
          id,
          email,
        );
        if (entry?.user_id) {
          this.sql.exec(
            "DELETE FROM grants WHERE deck=? AND user_id=?",
            id,
            entry.user_id,
          );
          this.sql.exec(
            "DELETE FROM members WHERE deck=? AND user_id=?",
            id,
            entry.user_id,
          );
        }
      });
      if (entry?.user_id)
        await checked(
          await room(this.env, id).fetch(
            internal("/revoke", { user: entry.user_id }),
          ),
        );
      await checked(await room(this.env, id).fetch(internal("/roster", {})));
      return json({ recipients: this.recipientList(id) });
    }
    if (extra === "row-accounts" && method === "GET") {
      const members = rows<User>(
        this.sql,
        "SELECT users.* FROM users JOIN members ON users.id=members.user_id WHERE members.deck=?",
        id,
      ).map((member) => ({
        id: member.id,
        name: member.name,
        access: this.permissions(id, member.id, work.owner),
      }));
      return json(
        sharedAccountNames(
          this.recipientList(id),
          members.filter((m) => m.id !== work.owner),
        ),
      );
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
      this.sql.exec(
        "UPDATE recipients SET value=? WHERE deck=? AND user_id=?",
        JSON.stringify(access),
        id,
        target,
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
          (["POST", "PUT"].includes(method) && access.comment),
        403,
        "コメントする権限がありません。",
      );
      return room(this.env, id).fetch(
        internal(`/${extra}`, {
          method,
          user,
          host: work.owner === user.id,
          ...(["POST", "PUT"].includes(method)
            ? { value: await input(request) }
            : {}),
        }),
      );
    }
    if (extra?.startsWith("members/") && method === "DELETE") {
      this.access(id, user, true);
      const removed = decodeURIComponent(extra.slice(8));
      this.sql.exec(
        "DELETE FROM join_requests WHERE deck=? AND user_id=?",
        id,
        removed,
      );
      insist(removed !== user.id, 400, "作成者は参加者から削除できません。");
      this.sql.exec(
        "DELETE FROM recipients WHERE deck=? AND user_id=?",
        id,
        removed,
      );
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
      const digest = request.headers.get("X-Restore-Image");
      if (digest) {
        this.access(id, user, true, true);
        const task = this.task(id, user.id);
        insist(
          ["uploading", "room_committed", "ready"].includes(task.status),
          409,
          "この復元へ写真は保存できません。",
        );
        const bytes = await body(request, 6_000_000);
        insist(
          validDigest(digest) && (await digestBytes(bytes)) === digest,
          400,
          "写真の内容が一致しません。",
        );
        const asset = await imageId(id, digest);
        if (task.status !== "uploading") {
          insist(
            one(
              this.sql,
              "SELECT id FROM assets WHERE id=? AND deck=?",
              asset,
              id,
            ),
            409,
            "確定後に写真は追加できません。",
          );
          return json({ src: `/api/decks/${id}/assets/${asset}` }, 201);
        }
        return json(
          { src: await this.saveAsset(work, bytes, user, asset) },
          201,
        );
      }

      if (work.status === "restoring")
        insist(
          this.task(id, user.id).status === "uploading",
          409,
          "写真の復元は確定中です。",
        );
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
      return room(this.env, id).fetch(
        new Request(`https://internal/${extra}`, {
          headers: {
            "X-Media-User": user.id,
            "X-Media-Host": work.owner === user.id ? "1" : "0",
          },
        }),
      );
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
