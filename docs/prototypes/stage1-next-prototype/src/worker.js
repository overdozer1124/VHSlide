// VHSlide 段階①フェーズ1 次期独立試作ハーネス（実施計画 v0.2 手順1・ローカル模擬）
//
// !!! ローカル模擬専用 !!! 実 Google・実 Cloudflare には接続しない。
// - MOCK_AUTH=1 のとき ID トークンは `mock.<sub>.<nonce>` 形式の模擬値を受け付ける。
// - MOCK_AUTH でない場合は Google tokeninfo で検証する経路を用意してあるが、
//   ローカル試験では使わない（実アカウントに接続しないため）。
// - 識別子は生の sub を保存せず、sub の SHA-256 ハッシュで記録する（計画 第2節）。
// - テーブルは接頭辞 mtrial_*（計画 第3節）。
//
// エンドポイント:
//   GET  /nonce          nonce 発行（認証待ち記録に期限5分・単回使用で保存）
//   POST /register       初回登録（Origin 照合＋ID トークン＋初回用シークレット）
//   POST /login          登録済み subject の再ログイン（復旧後の事後照合用、手順5）
//   POST /operate        セッション＋CSRF による操作（毎回現在の資格を照合）
//   POST /recover        復旧（Origin 照合＋新しい ID トークン＋復旧キー、原子的更新）
//   POST /admin/restart  試験用フック（RESTART_KEY 一致時のみ DO を例外で再起動）
//   GET  /test/state     試験用読み取り（ALLOW_TEST_HOOKS=1 のときのみ）
//   GET  /test/boot      起動回数（boot_count）の読み取り（同上）

const EXPECTED_ORIGIN = "http://localhost:8787";
const SESSION_TTL_MS = 30 * 60 * 1000; // 計画 第3節: Max-Age 30分
const COOKIE_NAME = "session";

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

// ID トークンの検証。成功時は { sub, nonce } を返す。失敗時は HttpError。
async function verifyIdToken(token, env) {
  if (!token || typeof token !== "string") {
    throw new HttpError(400, "missing_id_token");
  }
  if (env.MOCK_AUTH === "1") {
    // 模擬経路: `mock.<sub>.<nonce>`。sub と nonce は実際に照合する。
    // aud・iss・exp・email_verified は模擬値で満たされたものとして扱う（計画 手順1）。
    if (!token.startsWith("mock.")) {
      throw new HttpError(401, "bad_mock_token_format");
    }
    const rest = token.slice("mock.".length);
    const idx = rest.lastIndexOf(".");
    if (idx <= 0) throw new HttpError(401, "bad_mock_token_format");
    const sub = rest.slice(0, idx);
    const nonce = rest.slice(idx + 1);
    if (!sub || !nonce) throw new HttpError(401, "bad_mock_token_claims");
    return { sub, nonce };
  }
  // 実経路（ローカル試験では未使用）: Google tokeninfo で検証する。
  const res = await fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" +
      encodeURIComponent(token)
  );
  if (!res.ok) throw new HttpError(401, "tokeninfo_rejected");
  const c = await res.json();
  const nowSec = Math.floor(Date.now() / 1000);
  if (!c.sub) throw new HttpError(401, "missing_sub");
  if (env.GOOGLE_CLIENT_ID && c.aud !== env.GOOGLE_CLIENT_ID) {
    throw new HttpError(401, "bad_aud");
  }
  if (!["accounts.google.com", "https://accounts.google.com"].includes(c.iss)) {
    throw new HttpError(401, "bad_iss");
  }
  if (!c.exp || Number(c.exp) <= nowSec) throw new HttpError(401, "token_expired");
  if (c.email_verified !== "true" && c.email_verified !== true) {
    throw new HttpError(401, "email_not_verified");
  }
  if (!c.nonce) throw new HttpError(401, "missing_nonce");
  return { sub: String(c.sub), nonce: String(c.nonce) };
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export class VerificationDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS mtrial_credentials (
        subject_hash TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS mtrial_completion (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        env_id TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        registered_at TEXT NOT NULL
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS mtrial_recovery (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        old_subject_hash TEXT NOT NULL,
        new_subject_hash TEXT NOT NULL,
        recovered_at TEXT NOT NULL
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS mtrial_sessions (
        session_hash TEXT PRIMARY KEY,
        subject_hash TEXT NOT NULL,
        csrf_token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS mtrial_pending_nonce (
        nonce TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS mtrial_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);
      // 起動のたびに boot_count を進める（再起動の検出用、手順6）。
      const rows = this.sql
        .exec("SELECT value FROM mtrial_meta WHERE key = 'boot_count'")
        .toArray();
      const next = (rows.length ? parseInt(rows[0].value, 10) : 0) + 1;
      this.sql.exec(
        "INSERT OR REPLACE INTO mtrial_meta (key, value) VALUES ('boot_count', ?)",
        String(next)
      );
      this.bootCount = next;
    });
  }

  nonceTtlMs() {
    const sec = Number(this.env.NONCE_TTL_SECONDS || "300");
    return (Number.isFinite(sec) ? sec : 300) * 1000;
  }

  // nonce の確認と消費（トランザクション内で呼ぶこと）。
  consumeNonce(nonce, nowMs) {
    const rows = this.sql
      .exec("SELECT nonce, expires_at, used FROM mtrial_pending_nonce WHERE nonce = ?", nonce)
      .toArray();
    if (!rows.length) throw new HttpError(401, "nonce_unknown");
    if (rows[0].used) throw new HttpError(401, "nonce_reused");
    if (rows[0].expires_at <= nowMs) throw new HttpError(401, "nonce_expired");
    this.sql.exec("UPDATE mtrial_pending_nonce SET used = 1 WHERE nonce = ?", nonce);
  }

  sessionCookieHeader(sessionId) {
    return `${COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`;
  }

  requireOrigin(request) {
    const origin = request.headers.get("Origin");
    if (origin !== EXPECTED_ORIGIN) {
      throw new HttpError(403, "bad_origin");
    }
    return origin;
  }

  testHooksAllowed() {
    return this.env.ALLOW_TEST_HOOKS === "1";
  }

  failMode(request) {
    if (!this.testHooksAllowed()) return null;
    return request.headers.get("X-Test-Fail");
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get("Origin"); // 受け取った Origin は応答に含める（計画 第3節）
    // /admin/restart は catch の外で扱う: 例外を DO の外へ伝播させて
    // ランタイムにインスタンスを破棄・再生成させるため。
    if (request.method === "POST" && path === "/admin/restart") {
      const key = request.headers.get("X-Restart-Key");
      if (!this.env.RESTART_KEY || key !== this.env.RESTART_KEY) {
        return jsonResponse({ ok: false, error: "bad_restart_key", origin }, 403);
      }
      throw new Error("test_restart_forced");
    }
    try {
      if (request.method === "GET" && path === "/nonce") {
        return this.handleNonce(origin);
      }
      if (request.method === "POST" && path === "/register") {
        return await this.handleRegister(request, origin);
      }
      if (request.method === "POST" && path === "/login") {
        return await this.handleLogin(request, origin);
      }
      if (request.method === "POST" && path === "/operate") {
        return await this.handleOperate(request, origin);
      }
      if (request.method === "POST" && path === "/recover") {
        return await this.handleRecover(request, origin);
      }
      if (request.method === "GET" && path === "/test/state") {
        if (!this.testHooksAllowed()) throw new HttpError(404, "not_found");
        return jsonResponse({ origin, boot_count: this.bootCount, tables: this.dumpTables() });
      }
      if (request.method === "GET" && path === "/test/boot") {
        if (!this.testHooksAllowed()) throw new HttpError(404, "not_found");
        return jsonResponse({ origin, boot_count: this.bootCount });
      }
      throw new HttpError(404, "not_found");
    } catch (e) {
      if (e instanceof HttpError) {
        return jsonResponse({ ok: false, error: e.code, origin }, e.status);
      }
      // 失敗注入などの予期せぬ例外は 500 として返す（インスタンスは落とさない）。
      return jsonResponse(
        { ok: false, error: "internal", detail: String(e && e.message), origin },
        500
      );
    }
  }

  dumpTables() {
    const names = [
      "mtrial_credentials",
      "mtrial_completion",
      "mtrial_recovery",
      "mtrial_sessions",
      "mtrial_pending_nonce",
      "mtrial_meta",
    ];
    const out = {};
    for (const n of names) {
      out[n] = this.sql.exec(`SELECT * FROM ${n}`).toArray();
    }
    return out;
  }

  handleNonce(origin) {
    const nonce = crypto.randomUUID();
    const expiresAt = Date.now() + this.nonceTtlMs();
    this.sql.exec(
      "INSERT INTO mtrial_pending_nonce (nonce, expires_at, used) VALUES (?, ?, 0)",
      nonce,
      expiresAt
    );
    return jsonResponse({
      ok: true,
      nonce,
      expires_at: new Date(expiresAt).toISOString(),
      origin,
    });
  }

  async readJsonBody(request) {
    try {
      return await request.json();
    } catch {
      throw new HttpError(400, "bad_json");
    }
  }

  async handleRegister(request, origin) {
    this.requireOrigin(request);
    const body = await this.readJsonBody(request);
    if (!this.env.BOOTSTRAP_SECRET || body.bootstrap_secret !== this.env.BOOTSTRAP_SECRET) {
      throw new HttpError(403, "bad_bootstrap_secret");
    }
    const claims = await verifyIdToken(body.id_token, this.env);
    const subjectHash = await sha256hex(claims.sub);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const sessionId = randomHex(32);
    const sessionHash = await sha256hex(sessionId);
    const csrf = randomHex(32);
    const envId = this.env.ENV_ID || "unknown-env";
    // 資格・完了記録・nonce 消費・セッション発行を1トランザクションで記録する（計画 第3節 A2）。
    this.ctx.storage.transactionSync(() => {
      const comp = this.sql
        .exec("SELECT id FROM mtrial_completion WHERE id = 1")
        .toArray();
      if (comp.length) throw new HttpError(409, "already_registered");
      this.consumeNonce(claims.nonce, nowMs);
      this.sql.exec(
        "INSERT INTO mtrial_credentials (subject_hash, created_at) VALUES (?, ?)",
        subjectHash,
        nowIso
      );
      this.sql.exec(
        "INSERT INTO mtrial_completion (id, env_id, subject_hash, registered_at) VALUES (1, ?, ?, ?)",
        envId,
        subjectHash,
        nowIso
      );
      if (this.failMode(request) === "register-mid") {
        throw new Error("injected_register_mid");
      }
      this.sql.exec(
        "INSERT INTO mtrial_sessions (session_hash, subject_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        sessionHash,
        subjectHash,
        csrf,
        nowMs,
        nowMs + SESSION_TTL_MS
      );
    });
    return jsonResponse(
      { ok: true, csrf_token: csrf, env_id: envId, origin },
      201,
      { "Set-Cookie": this.sessionCookieHeader(sessionId) }
    );
  }

  async handleLogin(request, origin) {
    // 登録済み subject の再ログイン（手順5の事後照合で使う）。
    // ログイン可否の正本は「現在の資格」（mtrial_credentials）であり、
    // 完了記録（mtrial_completion）は初代登録の履歴として不変に保ち、判定には使わない。
    // 復旧後は現在の資格が新 subject に切り替わっているため、旧 subject はここで拒否される。
    this.requireOrigin(request);
    const body = await this.readJsonBody(request);
    const claims = await verifyIdToken(body.id_token, this.env);
    const subjectHash = await sha256hex(claims.sub);
    const nowMs = Date.now();
    const sessionId = randomHex(32);
    const sessionHash = await sha256hex(sessionId);
    const csrf = randomHex(32);
    this.ctx.storage.transactionSync(() => {
      const cred = this.sql
        .exec("SELECT subject_hash FROM mtrial_credentials WHERE subject_hash = ?", subjectHash)
        .toArray();
      if (!cred.length) {
        throw new HttpError(403, "not_current_subject");
      }
      this.consumeNonce(claims.nonce, nowMs);
      this.sql.exec(
        "INSERT INTO mtrial_sessions (session_hash, subject_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        sessionHash,
        subjectHash,
        csrf,
        nowMs,
        nowMs + SESSION_TTL_MS
      );
    });
    return jsonResponse(
      { ok: true, csrf_token: csrf, origin },
      200,
      { "Set-Cookie": this.sessionCookieHeader(sessionId) }
    );
  }

  async handleOperate(request, origin) {
    this.requireOrigin(request);
    const cookies = parseCookies(request);
    const sessionId = cookies[COOKIE_NAME];
    if (!sessionId) throw new HttpError(403, "session_missing");
    const sessionHash = await sha256hex(sessionId);
    const rows = this.sql
      .exec(
        "SELECT session_hash, subject_hash, csrf_token, expires_at FROM mtrial_sessions WHERE session_hash = ?",
        sessionHash
      )
      .toArray();
    if (!rows.length) throw new HttpError(403, "session_not_found");
    const sess = rows[0];
    if (sess.expires_at <= Date.now()) {
      this.sql.exec("DELETE FROM mtrial_sessions WHERE session_hash = ?", sessionHash);
      throw new HttpError(403, "session_expired");
    }
    const csrfHeader = request.headers.get("X-CSRF");
    if (!csrfHeader) throw new HttpError(403, "csrf_missing");
    if (csrfHeader !== sess.csrf_token) throw new HttpError(403, "csrf_mismatch");
    // 毎回、現在の資格（subject が credentials に現存すること）を照合する（計画 第3節）。
    const cred = this.sql
      .exec("SELECT subject_hash FROM mtrial_credentials WHERE subject_hash = ?", sess.subject_hash)
      .toArray();
    if (!cred.length) throw new HttpError(403, "no_current_qualification");
    return jsonResponse({ ok: true, subject_hash: sess.subject_hash, origin });
  }

  async handleRecover(request, origin) {
    this.requireOrigin(request);
    const body = await this.readJsonBody(request);
    // 復旧キーだけでは実行できない: 新しい ID トークンの提示が必須（計画 第4節）。
    if (!body.id_token) throw new HttpError(400, "missing_id_token");
    if (!this.env.RECOVERY_KEY || body.recovery_key !== this.env.RECOVERY_KEY) {
      throw new HttpError(403, "bad_recovery_key");
    }
    const claims = await verifyIdToken(body.id_token, this.env);
    const newSubjectHash = await sha256hex(claims.sub);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const sessionId = randomHex(32);
    const sessionHash = await sha256hex(sessionId);
    const csrf = randomHex(32);
    // 旧資格の失効・新資格の付与・復旧記録・旧セッション削除を
    // 同一の原子的更新で行う（計画 第3節 A7）。
    // 旧 subject は「現在の資格」から得る。完了記録は初代登録の履歴として更新しない。
    this.ctx.storage.transactionSync(() => {
      const creds = this.sql
        .exec("SELECT subject_hash FROM mtrial_credentials")
        .toArray();
      if (!creds.length) throw new HttpError(409, "not_registered");
      const oldSubjectHash = creds[0].subject_hash;
      this.consumeNonce(claims.nonce, nowMs);
      this.sql.exec("DELETE FROM mtrial_credentials WHERE subject_hash = ?", oldSubjectHash);
      if (this.failMode(request) === "recover-mid") {
        throw new Error("injected_recover_mid");
      }
      this.sql.exec(
        "INSERT INTO mtrial_credentials (subject_hash, created_at) VALUES (?, ?)",
        newSubjectHash,
        nowIso
      );
      this.sql.exec(
        "INSERT INTO mtrial_recovery (old_subject_hash, new_subject_hash, recovered_at) VALUES (?, ?, ?)",
        oldSubjectHash,
        newSubjectHash,
        nowIso
      );
      this.sql.exec("DELETE FROM mtrial_sessions WHERE subject_hash = ?", oldSubjectHash);
      this.sql.exec(
        "INSERT INTO mtrial_sessions (session_hash, subject_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        sessionHash,
        newSubjectHash,
        csrf,
        nowMs,
        nowMs + SESSION_TTL_MS
      );
    });
    return jsonResponse(
      { ok: true, csrf_token: csrf, origin },
      201,
      { "Set-Cookie": this.sessionCookieHeader(sessionId) }
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // CORS は正規 Origin のみ許可する（計画 第3節）。
    if (request.method === "OPTIONS") {
      const o = request.headers.get("Origin");
      if (o === EXPECTED_ORIGIN) {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": EXPECTED_ORIGIN,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "content-type, x-csrf, x-test-fail, x-restart-key",
            "Access-Control-Allow-Credentials": "true",
          },
        });
      }
      return new Response(null, { status: 403 });
    }
    if (url.pathname === "/") {
      return new Response(
        "stage1 harness (local mock). Login page is a separate static file: public/login.html\n",
        { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }
    const id = env.VERIFY_ONLY.idFromName(
      env.INSTANCE_NAME || "stage1-verification-only-20261101"
    );
    const stub = env.VERIFY_ONLY.get(id);
    const res = await stub.fetch(request);
    const o = request.headers.get("Origin");
    if (o === EXPECTED_ORIGIN) {
      const headers = new Headers(res.headers);
      headers.set("Access-Control-Allow-Origin", EXPECTED_ORIGIN);
      headers.set("Access-Control-Allow-Credentials", "true");
      return new Response(res.body, { status: res.status, headers });
    }
    return res;
  },
};
