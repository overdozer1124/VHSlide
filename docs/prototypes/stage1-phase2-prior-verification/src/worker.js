// VHSlide 段階①フェーズ2 先行検証ハーネス ― 通常ビルド（アプリ側）
//
// !!! ローカル模擬専用 !!! 実 Google・実 Cloudflare には接続しない。
// 実施計画 v0.5 第2節（独立した運営者認可の設計）のうち、アプリ内管理
// ルート（2.1/2.5）を試作する。プラットフォーム経路の一時ビルドは
// src/platform-worker.js（別ファイル＝別ビルド成果物として扱う）。
//
// - 運営者セッションは発行しない。管理操作のたびに新しい ID トークンを
//   検証する（2.5）。ローカルではモック検証器が本物の検証項目
//   （iss・aud・exp の有限数値検査・nonce・sub の存在）をすべて明示的に
//   検査する。署名検証だけはモックでは代替できない（実環境必須）。
// - 登録簿の在籍・世代の照合と変更の適用、nonce の消費は、Directory DO
//   相当の RegistryDO の単一 transactionSync で行う（2.5）。
// - 識別子は生の sub を保存せず SHA-256 ハッシュで記録する
//   （フェーズ1の流儀を踏襲。仮名識別子であり匿名化ではない）。
// - テーブルは接頭辞 op2_*。
//
// 設定検証（fail-closed）: DEPLOYMENT_TIER は `local-mock` / `verify` の
// 明示指定が必須。tier=verify では MOCK_AUTH=1・ALLOW_TEST_HOOKS=1・
// TOKENINFO_URL の上書きを禁止する。非 MOCK 時は GOOGLE_CLIENT_ID が
// 必須（aud 検査を省略しない）。ENV_ID が未設定なら操作を拒否する。
//
// エンドポイント（通常ビルド）:
//   GET  /nonce                 nonce 発行（期限5分・単回使用。認証試行
//                               コンテキストを HttpOnly Cookie で結び付け）
//   POST /admin/verify-only     トークン検証＋在籍照合だけを行う操作
//                               （リプレイ試験等に使う。状態は変えない）
//   POST /admin/registry/add    登録簿への追加 { subject_hash }
//   POST /admin/registry/revoke 登録簿からの失効 { subject_hash }
//   POST /admin/registry/rotate ローテーション { old_subject_hash, new_subject_hash }
//                               （add/revoke/rotate は expected_generation 必須）
//   GET  /test/registry         診断用読み取り＝プラットフォーム経路での
//                               「登録簿の読み戻し」のローカル代替。
//                               local-mock＋ALLOW_TEST_HOOKS=1＋DIAG_KEY 照合時のみ。
//   ※ 専用経路 /platform/apply の実装は、通常ビルドの成果物には
//     含まれない（RegistryDO に apply 処理自体を持たない）。外側の
//     404 だけでなく、成果物の中に内部操作が存在しないことを、
//     試験の静的確認で示す。

const EXPECTED_ORIGIN = "http://localhost:8787";
const NONCE_CTX_COOKIE = "op2_nonce_ctx";
const NONCE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const VALID_ISS = ["accounts.google.com", "https://accounts.google.com"];

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

// クレームの数値項目を有限の数値として解釈する（フェーズ1の流儀）。
// 非数値・NaN・Infinity・欠落は null（fail-closed）。
function finiteNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// 設定検証。問題がなければ null、あれば拒否理由コードを返す。
function validateConfig(env) {
  const tier = env.DEPLOYMENT_TIER;
  if (tier !== "local-mock" && tier !== "verify") return "config_bad_tier";
  if (tier === "verify") {
    if (env.MOCK_AUTH === "1") return "config_mock_in_verify";
    if (env.ALLOW_TEST_HOOKS === "1") return "config_hooks_in_verify";
    if (env.TOKENINFO_URL) return "config_tokeninfo_override_in_verify";
  }
  if (env.MOCK_AUTH !== "1" && !env.GOOGLE_CLIENT_ID) {
    return "config_missing_client_id";
  }
  if (!env.ENV_ID) return "config_missing_env_id";
  return null;
}

// ID トークンの検証。成功時は { sub, nonce } を返す。失敗時は HttpError。
// ローカルモック形式: mockop|<sub>|<nonce>|<iss>|<aud>|<exp>
//   （iss の URL に含まれる "." と衝突しないよう、区切りは "|" を使う）
//   フェーズ1のモック（mock.<sub>.<nonce>）と違い、iss・aud・exp も
//   値として持ち、検証器が本物と同じ項目を明示的に検査する。
//   署名検証のみモックでは代替不能（実環境必須として区別する）。
async function verifyIdToken(token, env) {
  if (!token || typeof token !== "string") {
    throw new HttpError(400, "missing_id_token");
  }
  if (env.MOCK_AUTH === "1") {
    if (!token.startsWith("mockop|")) {
      throw new HttpError(401, "bad_mock_token_format");
    }
    const parts = token.slice("mockop|".length).split("|");
    if (parts.length !== 5) throw new HttpError(401, "bad_mock_token_format");
    const [sub, nonce, iss, aud, exp] = parts;
    if (!sub) throw new HttpError(401, "missing_sub");
    if (!nonce) throw new HttpError(401, "missing_nonce");
    if (!VALID_ISS.includes(iss)) throw new HttpError(401, "bad_iss");
    // aud 検査は省略しない（モックでも GOOGLE_CLIENT_ID と照合する）。
    if (aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, "bad_aud");
    const expSec = finiteNumber(exp);
    const nowSec = Math.floor(Date.now() / 1000);
    if (expSec === null || expSec <= nowSec) {
      throw new HttpError(401, "token_expired");
    }
    return { sub, nonce };
  }
  // 実経路: Google tokeninfo で検証する（フェーズ1と同等）。
  // TOKENINFO_URL の上書きは tier=local-mock でのみ有効。
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
  if (c.aud !== env.GOOGLE_CLIENT_ID) throw new HttpError(401, "bad_aud");
  if (!VALID_ISS.includes(c.iss)) throw new HttpError(401, "bad_iss");
  const expSec = finiteNumber(c.exp);
  if (expSec === null || expSec <= nowSec) {
    throw new HttpError(401, "token_expired");
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

function checkOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin !== EXPECTED_ORIGIN) throw new HttpError(403, "bad_origin");
  return origin;
}

// 登録簿を持つ Durable Object。製品では Directory DO に対応する。
// 通常ビルドの DO は管理ルートの状態操作だけを持ち、プラット
// フォーム経路の専用処理（apply）は含まない（ビルド成果物として
// 分離する。プラットフォーム側の DO は src/platform-worker.js）。
// 検証用 Worker の既存名前空間（VerificationDO、移行タグ verify-v1 で
// 作成）のための受動スタブ。このスクリプトの版は、既存の Durable Object
// 名前空間が依存するクラスを export し続けなければ作成・配置できない
// （プラットフォームの検査、エラー 10064）。このクラスは状態に一切
// 触れず、404 を返すだけである。
export class VerificationDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async fetch() {
    return new Response("not_configured", { status: 404 });
  }
}
export class RegistryDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS op2_operators (
        subject_hash TEXT PRIMARY KEY,
        added_at TEXT NOT NULL,
        added_by TEXT NOT NULL
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS op2_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS op2_consumed_ops (
        operation_id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        env_id TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        consumed_at TEXT NOT NULL
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS op2_completion (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL UNIQUE,
        env_id TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        purpose TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS op2_pending_nonce (
        nonce TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        ctx_hash TEXT
      )`);
      this.sql.exec(
        "INSERT OR IGNORE INTO op2_meta (key, value) VALUES ('generation', '0')"
      );
      this.sql.exec(
        "INSERT OR IGNORE INTO op2_meta (key, value) VALUES ('initialized', '0')"
      );
    });
  }

  metaGet(key) {
    const rows = [...this.sql.exec("SELECT value FROM op2_meta WHERE key = ?", key)];
    return rows.length ? rows[0].value : null;
  }

  metaSet(key, value) {
    this.sql.exec(
      "INSERT INTO op2_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      String(value)
    );
  }

  generation() {
    return Number(this.metaGet("generation") || "0");
  }

  // nonce の照合と消費。呼び出し側のトランザクション内で使うこと。
  // 固定値の不一致など、nonce 消費より前に判定すべき拒否は呼び出し側が
  // 先に行う（拒否で nonce を燃やさない）。
  consumeNonce(nonce, ctxHash) {
    const rows = [
      ...this.sql.exec("SELECT * FROM op2_pending_nonce WHERE nonce = ?", nonce),
    ];
    if (!rows.length) throw new HttpError(401, "unknown_nonce");
    const row = rows[0];
    if (row.used) throw new HttpError(403, "nonce_replayed");
    if (row.expires_at <= Date.now()) throw new HttpError(401, "nonce_expired");
    if (!ctxHash || row.ctx_hash !== ctxHash) {
      throw new HttpError(403, "nonce_context_mismatch");
    }
    this.sql.exec("UPDATE op2_pending_nonce SET used = 1 WHERE nonce = ?", nonce);
  }

  snapshot() {
    const operators = [
      ...this.sql.exec(
        "SELECT subject_hash, added_at, added_by FROM op2_operators ORDER BY added_at, subject_hash"
      ),
    ];
    const consumed = [
      ...this.sql.exec(
        "SELECT operation_id, purpose, env_id, subject_hash, consumed_at FROM op2_consumed_ops ORDER BY consumed_at, operation_id"
      ),
    ];
    const completion = [
      ...this.sql.exec(
        "SELECT operation_id, env_id, subject_hash, purpose, applied_at FROM op2_completion ORDER BY id"
      ),
    ];
    // 読み戻し対象には、未消費 nonce の内訳（件数のみ。nonce の値や
    // ctx ハッシュ自体は含めない）も含める（手順書 v0.3 の読み戻し
    // 対象の定義。消費の巻き戻りや再送の使用済み状態を、読み戻しで
    // 確認できるようにするため）。
    const nonceRows = [
      ...this.sql.exec(
        "SELECT used, COUNT(*) AS n FROM op2_pending_nonce GROUP BY used"
      ),
    ];
    let nonceUsed = 0;
    let nonceUnused = 0;
    for (const r of nonceRows) {
      if (r.used) nonceUsed = r.n;
      else nonceUnused = r.n;
    }
    return {
      env_id: this.env.ENV_ID,
      generation: this.generation(),
      initialized: this.metaGet("initialized") === "1",
      operators,
      consumed_ops: consumed,
      completion,
      pending_nonces: {
        total: nonceUsed + nonceUnused,
        used: nonceUsed,
        unused: nonceUnused,
      },
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/do/nonce" && request.method === "POST") {
        const nonce = randomHex(16);
        const ctx = randomHex(16);
        const ctxHash = await sha256hex(ctx);
        this.sql.exec(
          "INSERT INTO op2_pending_nonce (nonce, expires_at, used, ctx_hash) VALUES (?, ?, 0, ?)",
          nonce,
          Date.now() + NONCE_TTL_MS,
          ctxHash
        );
        return jsonResponse({ nonce, ctx });
      }

      if (url.pathname === "/do/snapshot" && request.method === "POST") {
        return jsonResponse(this.snapshot());
      }


      if (url.pathname === "/do/admin" && request.method === "POST") {
        const { body, ctx } = await request.json();
        const claims = await verifyIdToken(body.id_token, this.env);
        const ctxHash = ctx ? await sha256hex(ctx) : null;
        const callerHash = await sha256hex(claims.sub);
        let result;
        this.ctx.storage.transactionSync(() => {
          // nonce の消費・在籍照合・世代照合・変更の適用を同一
          // トランザクションで行う（計画 2.5）。
          this.consumeNonce(claims.nonce, ctxHash);
          const caller = [
            ...this.sql.exec(
              "SELECT subject_hash FROM op2_operators WHERE subject_hash = ?",
              callerHash
            ),
          ];
          // 認可の照会に失敗した場合は拒否する（fail-closed）。
          // 失効した運営者は、次の操作でここで拒否される。
          if (!caller.length) throw new HttpError(403, "not_operator");
          const gen = this.generation();
          if (body.action === "verify-only") {
            result = { ok: true, generation: gen };
            return;
          }
          // 登録簿の変更は、提示された世代が現在の世代と一致する
          // 場合にだけ適用する。古い世代に基づく同時更新は拒否。
          if (body.expected_generation !== gen) {
            throw new HttpError(409, "stale_generation");
          }
          const now = new Date().toISOString();
          if (body.action === "add") {
            const exists = [
              ...this.sql.exec(
                "SELECT subject_hash FROM op2_operators WHERE subject_hash = ?",
                body.subject_hash
              ),
            ];
            if (exists.length) throw new HttpError(409, "already_member");
            this.sql.exec(
              "INSERT INTO op2_operators (subject_hash, added_at, added_by) VALUES (?, ?, ?)",
              body.subject_hash,
              now,
              callerHash
            );
          } else if (body.action === "revoke") {
            const exists = [
              ...this.sql.exec(
                "SELECT subject_hash FROM op2_operators WHERE subject_hash = ?",
                body.subject_hash
              ),
            ];
            if (!exists.length) throw new HttpError(404, "target_not_member");
            // 最後の運営者の失効はアプリ側では行わない（計画 2.1:
            // 全運営者の緊急失効と全運営者喪失時の回復はプラット
            // フォーム経路に限定される）。登録簿が空になる失効は、
            // 同一トランザクションの中で数えて拒否する。並行する
            // 別の失効とは世代照合で直列化されるため、2件の失効が
            // すり抜けて空になることはない。
            const countRows = [
              ...this.sql.exec("SELECT COUNT(*) AS n FROM op2_operators"),
            ];
            if (Number(countRows[0].n) <= 1) {
              throw new HttpError(409, "last_operator");
            }
            this.sql.exec(
              "DELETE FROM op2_operators WHERE subject_hash = ?",
              body.subject_hash
            );
          } else if (body.action === "rotate") {
            const oldExists = [
              ...this.sql.exec(
                "SELECT subject_hash FROM op2_operators WHERE subject_hash = ?",
                body.old_subject_hash
              ),
            ];
            if (!oldExists.length) throw new HttpError(404, "target_not_member");
            const newExists = [
              ...this.sql.exec(
                "SELECT subject_hash FROM op2_operators WHERE subject_hash = ?",
                body.new_subject_hash
              ),
            ];
            if (newExists.length) throw new HttpError(409, "already_member");
            this.sql.exec(
              "DELETE FROM op2_operators WHERE subject_hash = ?",
              body.old_subject_hash
            );
            this.sql.exec(
              "INSERT INTO op2_operators (subject_hash, added_at, added_by) VALUES (?, ?, ?)",
              body.new_subject_hash,
              now,
              callerHash
            );
          } else {
            throw new HttpError(400, "unknown_action");
          }
          const nextGeneration = gen + 1;
          this.metaSet("generation", nextGeneration);
          result = { ok: true, generation: nextGeneration };
        });
        return jsonResponse(result, 200);
      }

      return jsonResponse({ error: "not_found" }, 404);
    } catch (e) {
      if (e instanceof HttpError) {
        return jsonResponse({ error: e.code }, e.status);
      }
      // 失敗注入など、想定外の例外は 500（トランザクションは
      // ロールバックされている）。
      return jsonResponse({ error: "internal", detail: String(e && e.message || e) }, 500);
    }
  }
}

function registryStub(env) {
  const id = env.REGISTRY.idFromName("registry:" + env.ENV_ID);
  return env.REGISTRY.get(id);
}

async function doCall(env, pathName, payload) {
  const stub = registryStub(env);
  const res = await stub.fetch("https://registry.internal" + pathName, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

export default {
  async fetch(request, env) {
    const configError = validateConfig(env);
    if (configError) {
      return jsonResponse({ error: "config_refused", detail: configError }, 500);
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === "/nonce" && request.method === "GET") {
        const { status, json } = await doCall(env, "/do/nonce", {});
        if (status !== 200) return jsonResponse(json, status);
        // 実環境構成（verify）では Secure を必須とする（DESIGN.md
        // 「試作の制約」3）。ローカル模擬は http://localhost 起点の
        // ため付けない。変形B（ブラウザーから見た生成元は
        // http://localhost:8787）で実際に送り返されるかは、実環境で
        // 実測する。
        const secureAttr = env.DEPLOYMENT_TIER === "verify" ? "; Secure" : "";
        return jsonResponse(
          { nonce: json.nonce },
          200,
          {
            "set-cookie":
              `${NONCE_CTX_COOKIE}=${json.ctx}; HttpOnly; SameSite=Strict; Path=/; Max-Age=300${secureAttr}`,
          }
        );
      }

      if (url.pathname === "/test/registry" && request.method === "GET") {
        // 診断用読み取り（プラットフォーム経路での読み戻しの代替）。
        // フック無効・鍵不一致では存在自体を隠す（404/403）。
        if (env.DEPLOYMENT_TIER !== "local-mock" || env.ALLOW_TEST_HOOKS !== "1") {
          return jsonResponse({ error: "not_found" }, 404);
        }
        if (request.headers.get("X-Diag-Key") !== env.DIAG_KEY) {
          return jsonResponse({ error: "bad_diag_key" }, 403);
        }
        const { status, json } = await doCall(env, "/do/snapshot", {});
        return jsonResponse(json, status);
      }

      if (url.pathname.startsWith("/admin/") && request.method === "POST") {
        const origin = checkOrigin(request);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
          throw new HttpError(400, "bad_body");
        }
        const cookies = parseCookies(request);
        const action =
          url.pathname === "/admin/verify-only"
            ? "verify-only"
            : url.pathname === "/admin/registry/add"
              ? "add"
              : url.pathname === "/admin/registry/revoke"
                ? "revoke"
                : url.pathname === "/admin/registry/rotate"
                  ? "rotate"
                  : null;
        if (!action) return jsonResponse({ error: "not_found", origin }, 404);
        const { status, json } = await doCall(env, "/do/admin", {
          body: { ...body, action },
          ctx: cookies[NONCE_CTX_COOKIE] || null,
        });
        return jsonResponse({ ...json, origin }, status);
      }

      // /platform/apply を含むその他すべては通常ビルドに存在しない。
      return jsonResponse({ error: "not_found" }, 404);
    } catch (e) {
      if (e instanceof HttpError) {
        return jsonResponse({ error: e.code }, e.status);
      }
      return jsonResponse({ error: "internal", detail: String(e && e.message || e) }, 500);
    }
  },
};
