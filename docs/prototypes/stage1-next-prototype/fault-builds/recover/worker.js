// VHSlide 段階①フェーズ1 次期独立試作ハーネス（実施計画 v0.3 手順1・ローカル模擬）
//
// !!! ローカル模擬専用 !!! 実 Google・実 Cloudflare には接続しない。
// - MOCK_AUTH=1 のとき ID トークンは `mock.<sub>.<nonce>` 形式の模擬値を受け付ける。
// - MOCK_AUTH でない場合は Google tokeninfo で検証する経路を用意してある
//   （ローカル試験では偽 tokeninfo サーバーで検証ロジックだけを確認する）。
// - 識別子は生の sub を保存せず、sub の SHA-256 ハッシュで記録する（計画 第2節）。
// - テーブルは接頭辞 mtrial_*（計画 第3節）。
//
// 設定検証（fail-closed）: DEPLOYMENT_TIER は `local-mock` / `verify` の
// 明示指定が必須。未設定・空・想定外の値では全経路を 500 config_refused で
// 拒否する（既定値への読み替えはしない。配置設定の取り違えで MOCK_AUTH や
// テストフックが意図せず有効になる組合せを残さないため）。
// 不正な組み合わせでは全経路を 500 config_refused で拒否する。
// - tier=verify では MOCK_AUTH=1・ALLOW_TEST_HOOKS=1・TOKENINFO_URL の上書きを禁止
// - 非 MOCK 時は GOOGLE_CLIENT_ID が未設定・空なら必ず拒否（aud 検査を省略しない）
// - ENV_ID が未設定・空なら登録・復旧を拒否（代替値への読み替えはしない）
//
// エンドポイント:
//   GET  /nonce          nonce 発行（認証待ち記録に期限5分・単回使用で保存。
//                        認証試行コンテキストを HttpOnly Cookie で結び付ける）
//   POST /register       初回登録（Origin 照合＋ID トークン＋初回用シークレット）
//   POST /login          登録済み subject の再ログイン（復旧後の事後照合用、手順5）
//   POST /operate        セッション＋CSRF による操作（毎回現在の資格を照合）
//   POST /recover        復旧（Origin 照合＋新しい ID トークン＋復旧キー、原子的更新）
//   POST /admin/restart  試験用フック（local-mock のみ。RESTART_KEY 照合必須）
//   GET  /test/state     診断用読み取り（local-mock＋ALLOW_TEST_HOOKS=1＋DIAG_KEY 照合。
//                        秘匿化済みの集計と記録だけを返す）
//   GET  /test/boot      起動回数（boot_count）の読み取り（同上）

const EXPECTED_ORIGIN = "http://localhost:8787";
const SESSION_TTL_MS = 30 * 60 * 1000; // 計画 第3節: Max-Age 30分
const COOKIE_NAME = "session";
const NONCE_CTX_COOKIE = "mtrial_nonce_ctx";
const NONCE_CTX_MAX_AGE = 300; // nonce の有効期限（5分）に合わせる
const DEFAULT_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

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

// 設定検証。問題がなければ null、あれば拒否理由のコードを返す。
// 不正な組み合わせでは推測で動かさず、全経路を拒否する（fail-closed）。
// DEPLOYMENT_TIER は明示指定が必須で、未設定・空・想定外はすべて拒否する。
function validateConfig(env) {
  const tier = env.DEPLOYMENT_TIER;
  if (tier !== "local-mock" && tier !== "verify") return "config_bad_tier";
  if (tier === "verify") {
    if (env.MOCK_AUTH === "1") return "config_mock_in_verify";
    if (env.ALLOW_TEST_HOOKS === "1") return "config_hooks_in_verify";
    if (env.TOKENINFO_URL) return "config_tokeninfo_override_in_verify";
  }
  // 非 MOCK 時は aud 検査の基準が必須。未設定・空なら必ず拒否する。
  if (env.MOCK_AUTH !== "1" && !env.GOOGLE_CLIENT_ID) {
    return "config_missing_client_id";
  }
  return null;
}

// 登録・復旧に必要な ENV_ID の確認。未設定・空は代替値に読み替えず拒否する。
function requireEnvId(env) {
  if (!env.ENV_ID) throw new HttpError(500, "config_missing_env_id");
  return env.ENV_ID;
}

// クレームの数値項目を有限の数値として解釈する。
// 数値そのもの、または数値として解釈できる文字列なら数値を返し、
// 非数値文字列・空文字・NaN・Infinity・null・欠落などは null を返す。
// （`Number("not-a-number")` は NaN となり比較が常に false になるため、
//  単なる数値比較では不正値を拒否できない。有限性を明示的に検査する。）
function finiteNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
  // 実経路: Google tokeninfo で検証する。
  // TOKENINFO_URL の上書きは tier=local-mock でのみ有効（検証ロジックの試験用）。
  // tier=verify では設定検証で上書き自体を拒否し、ここでも既定値だけを使う。
  const tokeninfoUrl =
    env.DEPLOYMENT_TIER === "local-mock" && env.TOKENINFO_URL
      ? env.TOKENINFO_URL
      : DEFAULT_TOKENINFO_URL;
  const res = await fetch(
    tokeninfoUrl + "?id_token=" + encodeURIComponent(token)
  );
  if (!res.ok) throw new HttpError(401, "tokeninfo_rejected");
  const c = await res.json();
  const nowSec = Math.floor(Date.now() / 1000);
  if (!c.sub) throw new HttpError(401, "missing_sub");
  // aud 検査は省略しない（GOOGLE_CLIENT_ID の必須は設定検証で保証される）。
  if (c.aud !== env.GOOGLE_CLIENT_ID) {
    throw new HttpError(401, "bad_aud");
  }
  if (!["accounts.google.com", "https://accounts.google.com"].includes(c.iss)) {
    throw new HttpError(401, "bad_iss");
  }
  // exp は有限の数値であることを明示的に検査する（fail-closed）。
  // 非数値文字列・NaN・Infinity・欠落はすべて期限不正として拒否する。
  const expSec = finiteNumber(c.exp);
  if (expSec === null || expSec <= nowSec) {
    throw new HttpError(401, "token_expired");
  }
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
        env_id TEXT,
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
        used INTEGER NOT NULL DEFAULT 0,
        ctx_hash TEXT
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS mtrial_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);
      // 既存の永続化データに対する列追加（env_id / ctx_hash を後から足したため）。
      const recCols = this.sql
        .exec("PRAGMA table_info(mtrial_recovery)")
        .toArray()
        .map((r) => r.name);
      if (!recCols.includes("env_id")) {
        this.sql.exec("ALTER TABLE mtrial_recovery ADD COLUMN env_id TEXT");
      }
      const nonceCols = this.sql
        .exec("PRAGMA table_info(mtrial_pending_nonce)")
        .toArray()
        .map((r) => r.name);
      if (!nonceCols.includes("ctx_hash")) {
        this.sql.exec("ALTER TABLE mtrial_pending_nonce ADD COLUMN ctx_hash TEXT");
      }
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

  tier() {
    return this.env.DEPLOYMENT_TIER;
  }

  nonceTtlMs() {
    const sec = Number(this.env.NONCE_TTL_SECONDS || "300");
    return (Number.isFinite(sec) ? sec : 300) * 1000;
  }

  // nonce の確認と消費（トランザクション内で呼ぶこと）。
  // 発行時に結び付けた認証試行コンテキスト（Cookie のハッシュ）と
  // 要求の Cookie が一致することを要求する（ログイン CSRF 対策）。
  consumeNonce(nonce, ctxHash, nowMs) {
    const rows = this.sql
      .exec("SELECT nonce, expires_at, used, ctx_hash FROM mtrial_pending_nonce WHERE nonce = ?", nonce)
      .toArray();
    if (!rows.length) throw new HttpError(401, "nonce_unknown");
    if (!ctxHash || rows[0].ctx_hash !== ctxHash) {
      throw new HttpError(403, "nonce_context_mismatch");
    }
    if (rows[0].used) throw new HttpError(401, "nonce_reused");
    if (rows[0].expires_at <= nowMs) throw new HttpError(401, "nonce_expired");
    this.sql.exec("UPDATE mtrial_pending_nonce SET used = 1 WHERE nonce = ?", nonce);
  }

  // 要求の Cookie から認証試行コンテキストのハッシュを取り出す。
  async nonceCtxHash(request) {
    const ctx = parseCookies(request)[NONCE_CTX_COOKIE];
    return ctx ? await sha256hex(ctx) : null;
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
    // 失敗注入は試験用フックが有効で、かつ tier=local-mock のときだけ働く。
    if (!this.testHooksAllowed()) return null;
    if (this.tier() !== "local-mock") return null;
    return request.headers.get("X-Test-Fail");
  }

  // 診断経路の可否: "ok" / "not_found"（経路自体を無効化）/ "forbidden"（鍵不一致）。
  diagAccess(request) {
    if (!this.testHooksAllowed()) return "not_found";
    if (this.tier() !== "local-mock") return "not_found";
    if (!this.env.DIAG_KEY || request.headers.get("X-Diag-Key") !== this.env.DIAG_KEY) {
      return "forbidden";
    }
    return "ok";
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get("Origin"); // 受け取った Origin は応答に含める（計画 第3節）
    // 設定検証を全経路の入口で行う（fail-closed）。
    const cfgErr = validateConfig(this.env);
    if (cfgErr) {
      return jsonResponse({ ok: false, error: "config_refused", detail: cfgErr, origin }, 500);
    }
    // /admin/restart は catch の外で扱う: 例外を DO の外へ伝播させて
    // ランタイムにインスタンスを破棄・再生成させるため。
    // tier=verify では経路自体を無効化する。
    if (request.method === "POST" && path === "/admin/restart") {
      if (this.tier() !== "local-mock") {
        return jsonResponse({ ok: false, error: "not_found", origin }, 404);
      }
      const key = request.headers.get("X-Restart-Key");
      if (!this.env.RESTART_KEY || key !== this.env.RESTART_KEY) {
        return jsonResponse({ ok: false, error: "bad_restart_key", origin }, 403);
      }
      throw new Error("test_restart_forced");
    }
    try {
      if (request.method === "GET" && path === "/nonce") {
        return await this.handleNonce(origin);
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
        const d = this.diagAccess(request);
        if (d === "not_found") throw new HttpError(404, "not_found");
        if (d === "forbidden") throw new HttpError(403, "diag_key_refused");
        return jsonResponse({ ok: true, origin, ...this.stateSummary() });
      }
      if (request.method === "GET" && path === "/test/boot") {
        const d = this.diagAccess(request);
        if (d === "not_found") throw new HttpError(404, "not_found");
        if (d === "forbidden") throw new HttpError(403, "diag_key_refused");
        return jsonResponse({ ok: true, origin, boot_count: this.bootCount });
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

  // 診断用読み取り（秘匿化済み）。検証に必要な集計と記録だけを返す。
  // mtrial_sessions の csrf_token、未使用 nonce の値、セッション ID（ハッシュ含む）
  // は含めない。sessions と pending_nonce は件数のみ。
  stateSummary() {
    const credentials = this.sql
      .exec("SELECT subject_hash, created_at FROM mtrial_credentials ORDER BY created_at")
      .toArray();
    const completion = this.sql
      .exec("SELECT env_id, subject_hash, registered_at FROM mtrial_completion")
      .toArray();
    const recovery = this.sql
      .exec("SELECT id, env_id, old_subject_hash, new_subject_hash, recovered_at FROM mtrial_recovery ORDER BY id")
      .toArray();
    const sessionCount = this.sql
      .exec("SELECT COUNT(*) AS n FROM mtrial_sessions")
      .toArray()[0].n;
    const nonceRow = this.sql
      .exec("SELECT COUNT(*) AS total, COALESCE(SUM(used), 0) AS used_count FROM mtrial_pending_nonce")
      .toArray()[0];
    return {
      boot_count: this.bootCount,
      credentials,
      completion,
      recovery,
      counts: {
        credentials: credentials.length,
        completion: completion.length,
        recovery: recovery.length,
        sessions: sessionCount,
        pending_nonce_total: nonceRow.total,
        pending_nonce_used: nonceRow.used_count,
        pending_nonce_unused: nonceRow.total - nonceRow.used_count,
      },
    };
  }

  async handleNonce(origin) {
    const nonce = crypto.randomUUID();
    const expiresAt = Date.now() + this.nonceTtlMs();
    // 認証試行コンテキスト: 発行したブラウザーとの結び付け用ランダム値。
    // 生値は HttpOnly Cookie でだけ返し、保存はハッシュにする。
    const ctx = randomHex(32);
    const ctxHash = await sha256hex(ctx);
    this.sql.exec(
      "INSERT INTO mtrial_pending_nonce (nonce, expires_at, used, ctx_hash) VALUES (?, ?, 0, ?)",
      nonce,
      expiresAt,
      ctxHash
    );
    return jsonResponse(
      {
        ok: true,
        nonce,
        expires_at: new Date(expiresAt).toISOString(),
        origin,
      },
      200,
      {
        "Set-Cookie": `${NONCE_CTX_COOKIE}=${ctx}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${NONCE_CTX_MAX_AGE}`,
      }
    );
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
    const envId = requireEnvId(this.env);
    const body = await this.readJsonBody(request);
    if (!this.env.BOOTSTRAP_SECRET || body.bootstrap_secret !== this.env.BOOTSTRAP_SECRET) {
      throw new HttpError(403, "bad_bootstrap_secret");
    }
    const claims = await verifyIdToken(body.id_token, this.env);
    const subjectHash = await sha256hex(claims.sub);
    const ctxHash = await this.nonceCtxHash(request);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const sessionId = randomHex(32);
    const sessionHash = await sha256hex(sessionId);
    const csrf = randomHex(32);
    // 資格・完了記録・nonce 消費・セッション発行を1トランザクションで記録する（計画 第3節 A2）。
    this.ctx.storage.transactionSync(() => {
      const comp = this.sql
        .exec("SELECT id FROM mtrial_completion WHERE id = 1")
        .toArray();
      if (comp.length) throw new HttpError(409, "already_registered");
      this.consumeNonce(claims.nonce, ctxHash, nowMs);
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
    const ctxHash = await this.nonceCtxHash(request);
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
      this.consumeNonce(claims.nonce, ctxHash, nowMs);
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
    const envId = requireEnvId(this.env);
    const body = await this.readJsonBody(request);
    // 復旧キーだけでは実行できない: 新しい ID トークンの提示が必須（計画 第4節）。
    if (!body.id_token) throw new HttpError(400, "missing_id_token");
    if (!this.env.RECOVERY_KEY || body.recovery_key !== this.env.RECOVERY_KEY) {
      throw new HttpError(403, "bad_recovery_key");
    }
    const claims = await verifyIdToken(body.id_token, this.env);
    const newSubjectHash = await sha256hex(claims.sub);
    const ctxHash = await this.nonceCtxHash(request);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const sessionId = randomHex(32);
    const sessionHash = await sha256hex(sessionId);
    const csrf = randomHex(32);
    // 旧資格の失効・新資格の付与・復旧記録・旧セッション削除を
    // 同一の原子的更新で行う（計画 第3節 A7）。
    // 旧 subject は「現在の資格」から得る。完了記録は初代登録の履歴として更新しない。
    // 復旧記録には対象環境の識別子（env_id）も残し、記録単体で照合できるようにする。
    this.ctx.storage.transactionSync(() => {
      const creds = this.sql
        .exec("SELECT subject_hash FROM mtrial_credentials")
        .toArray();
      if (!creds.length) throw new HttpError(409, "not_registered");
      const oldSubjectHash = creds[0].subject_hash;
      this.consumeNonce(claims.nonce, ctxHash, nowMs);
      this.sql.exec("DELETE FROM mtrial_credentials WHERE subject_hash = ?", oldSubjectHash);
      // FAULT BUILD V (verification only): unconditional mid-recovery failure.
      throw new Error("injected_recover_mid");
      this.sql.exec(
        "INSERT INTO mtrial_credentials (subject_hash, created_at) VALUES (?, ?)",
        newSubjectHash,
        nowIso
      );
      this.sql.exec(
        "INSERT INTO mtrial_recovery (env_id, old_subject_hash, new_subject_hash, recovered_at) VALUES (?, ?, ?, ?)",
        envId,
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
    // 設定検証を入口で行う（fail-closed）。不正な組み合わせでは全経路を拒否する。
    const cfgErr = validateConfig(env);
    if (cfgErr) {
      return jsonResponse(
        { ok: false, error: "config_refused", detail: cfgErr },
        500
      );
    }
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
            "Access-Control-Allow-Headers": "content-type, x-csrf, x-test-fail, x-restart-key, x-diag-key",
            "Access-Control-Allow-Credentials": "true",
          },
        });
      }
      return new Response(null, { status: 403 });
    }
    if (url.pathname === "/") {
      return new Response(
        "stage1 harness (local mock). Login pages are separate static files: public/login-mock.html (mock only) / public/login-real.html (real GIS, for the real test)\n",
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
