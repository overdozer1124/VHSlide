// VHSlide 段階①フェーズ2 先行検証ハーネス ― プラットフォーム経路の
// 一時ビルド（このファイルが「一時ビルドの成果物」に相当する）
//
// !!! ローカル模擬専用 !!! 実 Google・実 Cloudflare には接続しない。
// 実施計画 v0.5 第2節のプラットフォーム経路（2.1/2.3/2.4/2.6）を試作する。
// 専用経路はこのビルドにだけ存在し、通常ビルド（src/worker.js）には
// 存在しない。操作の直後に通常ビルドへ戻すのが運用であり、試験では
// Miniflare のインスタンスを差し替えて再現する。
//
// 承認内容は配置前にアカウント保有者が固定し、バインディングとして
// 埋め込む（計画 2.3）:
//   APPROVAL_ENV_ID        対象環境の識別子（env.ENV_ID と一致が必須）
//   APPROVAL_PURPOSE       用途 "bootstrap"（初期投入）/ "full-replace"（全面復旧）
//   APPROVAL_SUBJECT_HASH  対象主体の SHA-256 ハッシュ
//   APPROVAL_EXPIRES_AT    有効期限（Unix ミリ秒）
//   APPROVAL_ONE_TIME      使い捨ての値（提示側が知っていても、対象主体
//                          以外は登録できないことを 2.7 項目3で確認する）
//   APPROVAL_OPERATION_ID  操作ID（消費は操作ID単位で原子的・一回だけ）
// いずれか欠けた／ENV_ID と一致しないビルドは全経路を拒否する
// （fail-closed。誤った一時ビルドを配置した場合の無害化、2.6）。
//
// 一回値は照合のためだけに使い、ストレージには保存しない。
// 消費済み操作IDと完了記録は RegistryDO 側（サーバー側の状態）に
// 残るため、旧い一時ビルドが再配置されても再利用できない（2.3/2.6）。
//
// エンドポイント（一時ビルド）:
//   GET  /nonce            nonce 発行（専用経路の認証試行用）
//   POST /platform/apply   固定値の完全一致時のみ登録簿の初期投入／
//                          全面差し替えを行う専用経路
//   GET  /platform/inspect 診断用読み取り（プラットフォーム側からの
//                          状態確認の代替。local-mock＋フック＋DIAG_KEY）
//   ※ /admin/* はこのビルドには存在しない（404）。

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
// 一時ビルドの DO はプラットフォーム経路の専用処理（apply）と
// nonce 発行・読み取りだけを持ち、管理ルートの状態操作（admin）は
// 含まない（ビルド成果物として分離する。通常側の DO は
// src/worker.js）。
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

  // 失敗注入フックの可否（フェーズ1の流儀）: tier=local-mock かつ
  // ALLOW_TEST_HOOKS=1 のときだけ働く。判定は DO 自身の env で行い、
  // Worker の fetch が _fault を剥離するかどうかには依存しない。
  // これにより、Worker を経ない DO への直接入口からでもフックは
  // 起動できない（設定が verify の場合、ALLOW_TEST_HOOKS=1 は
  // validateConfig が構成自体を拒否するため、到達時点では常に
  // フック無効になっている）。
  faultHooksEnabled() {
    return (
      this.env.DEPLOYMENT_TIER === "local-mock" &&
      this.env.ALLOW_TEST_HOOKS === "1"
    );
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
    return {
      env_id: this.env.ENV_ID,
      generation: this.generation(),
      initialized: this.metaGet("initialized") === "1",
      operators,
      consumed_ops: consumed,
      completion,
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

      if (url.pathname === "/do/apply" && request.method === "POST") {
        const { body, ctx } = await request.json();
        const claims = await verifyIdToken(body.id_token, this.env);
        const ctxHash = ctx ? await sha256hex(ctx) : null;
        const env = this.env;
        const subjectHash = await sha256hex(claims.sub);
        let result;
        this.ctx.storage.transactionSync(() => {
          // 期限チェックは apply 処理の入口で行う。期限切れの承認
          // では、他の固定値の照合結果によらず、apply へのすべての
          // 要求を approval_expired で拒否する（計画 2.7 項目4の
          // 確認範囲はこの apply 経路である。/nonce の発行自体は
          // 状態を変更せず、発行された nonce も期限切れの承認では
          // ここで拒否されるため消費できない）。
          const expiresAt = finiteNumber(env.APPROVAL_EXPIRES_AT);
          if (expiresAt === null || expiresAt <= Date.now()) {
            throw new HttpError(403, "approval_expired");
          }
          // 固定値の照合（すべて一致しなければ拒否。計画 2.3）
          if (body.one_time_value !== env.APPROVAL_ONE_TIME) {
            throw new HttpError(403, "bad_one_time_value");
          }
          if (body.purpose !== env.APPROVAL_PURPOSE) {
            throw new HttpError(403, "purpose_mismatch");
          }
          if (body.env_id !== env.APPROVAL_ENV_ID) {
            throw new HttpError(403, "env_mismatch");
          }
          // 値が漏れても、固定された対象以外の主体は登録できない（2.3）。
          if (subjectHash !== env.APPROVAL_SUBJECT_HASH) {
            throw new HttpError(403, "subject_mismatch");
          }
          // nonce の消費は、固定値の照合を通った後にだけ行う。
          this.consumeNonce(claims.nonce, ctxHash);
          // 消費は操作ID単位で原子的（2.3）。消費済みは旧ビルドの
          // 再配置でも再利用できない（サーバー側の状態で照合する）。
          const consumed = [
            ...this.sql.exec(
              "SELECT operation_id FROM op2_consumed_ops WHERE operation_id = ?",
              env.APPROVAL_OPERATION_ID
            ),
          ];
          if (consumed.length) throw new HttpError(409, "operation_consumed");
          // 初期投入は「初期化済み」という状態で再実行を拒否する（2.3）。
          if (
            env.APPROVAL_PURPOSE === "bootstrap" &&
            this.metaGet("initialized") === "1"
          ) {
            throw new HttpError(409, "already_initialized");
          }
          // 全面復旧は初期化済みの登録簿への操作であり、初期化前の
          // 状態では拒否する（初期投入と全面復旧は別の操作として
          // 区別する。計画 2.1/2.3）。
          if (
            env.APPROVAL_PURPOSE === "full-replace" &&
            this.metaGet("initialized") !== "1"
          ) {
            throw new HttpError(409, "not_initialized");
          }
          // 失敗注入（フック有効時のみ。途中失敗のロールバック
          // 確認用）。ゲートは DO 内で判定するため、DO への直接
          // 入口でも verify 等では起動しない。
          if (this.faultHooksEnabled() && body._fault === "platform-mid") {
            throw new Error("injected_fault_platform_mid");
          }
          const now = new Date().toISOString();
          const nextGeneration = this.generation() + 1;
          // 登録簿の差し替え（初期投入・全面復旧とも、承認された
          // 主体だけを含む内容に置き換える）。
          this.sql.exec("DELETE FROM op2_operators");
          this.sql.exec(
            "INSERT INTO op2_operators (subject_hash, added_at, added_by) VALUES (?, ?, ?)",
            subjectHash,
            now,
            "platform:" + env.APPROVAL_OPERATION_ID
          );
          this.metaSet("generation", nextGeneration);
          this.metaSet("initialized", "1");
          this.sql.exec(
            "INSERT INTO op2_consumed_ops (operation_id, purpose, env_id, subject_hash, consumed_at) VALUES (?, ?, ?, ?, ?)",
            env.APPROVAL_OPERATION_ID,
            env.APPROVAL_PURPOSE,
            env.APPROVAL_ENV_ID,
            subjectHash,
            now
          );
          this.sql.exec(
            "INSERT INTO op2_completion (operation_id, env_id, subject_hash, purpose, applied_at) VALUES (?, ?, ?, ?, ?)",
            env.APPROVAL_OPERATION_ID,
            env.APPROVAL_ENV_ID,
            subjectHash,
            env.APPROVAL_PURPOSE,
            now
          );
          result = { ok: true, generation: nextGeneration };
        });
        // 失敗注入（フック有効時のみ。コミット後の応答喪失の
        // 再現）: トランザクションは成立済みだが、応答を返す前に
        // 例外で落とす。呼び出し側には 500 が返り、実施されたか
        // どうかは応答からは判断できない（再送せず、読み戻しで
        // 判断する。計画 2.6）。ゲートは DO 内で判定するため、
        // DO への直接入口でも verify 等では起動しない（成功後に
        // 意図的な 500 を返すことはできない）。
        if (this.faultHooksEnabled() && body._fault === "platform-after-commit") {
          throw new Error("injected_fault_platform_after_commit");
        }
        return jsonResponse(result, 201);
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

// 一時ビルド固有の設定検証。通常ビルドの validateConfig に加え、
// 承認内容（固定値）がすべて埋め込まれ、対象環境が一致することを要求する。
function validatePlatformConfig(env) {
  const base = validateConfig(env);
  if (base) return base;
  if (!env.APPROVAL_ENV_ID || env.APPROVAL_ENV_ID !== env.ENV_ID) {
    return "config_approval_env_mismatch";
  }
  if (env.APPROVAL_PURPOSE !== "bootstrap" && env.APPROVAL_PURPOSE !== "full-replace") {
    return "config_bad_approval_purpose";
  }
  if (!env.APPROVAL_SUBJECT_HASH) return "config_missing_approval_subject";
  if (!env.APPROVAL_ONE_TIME) return "config_missing_approval_one_time";
  if (!env.APPROVAL_OPERATION_ID) return "config_missing_approval_operation";
  if (finiteNumber(env.APPROVAL_EXPIRES_AT) === null) {
    return "config_bad_approval_expiry";
  }
  return null;
}

export default {
  async fetch(request, env) {
    const configError = validatePlatformConfig(env);
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

      if (url.pathname === "/platform/inspect" && request.method === "GET") {
        if (env.DEPLOYMENT_TIER !== "local-mock" || env.ALLOW_TEST_HOOKS !== "1") {
          return jsonResponse({ error: "not_found" }, 404);
        }
        if (request.headers.get("X-Diag-Key") !== env.DIAG_KEY) {
          return jsonResponse({ error: "bad_diag_key" }, 403);
        }
        const { status, json } = await doCall(env, "/do/snapshot", {});
        return jsonResponse(json, status);
      }

      if (url.pathname === "/platform/apply" && request.method === "POST") {
        const origin = checkOrigin(request);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object") {
          throw new HttpError(400, "bad_body");
        }
        // 失敗注入は local-mock＋フック有効時のみ（フェーズ1の流儀）。
        // それ以外の形態ではここで _fault を剥離する。なお最終的な
        // ゲートは DO 側（faultHooksEnabled）にもあり、DO への直接
        // 入口ではこの剥離を経ないため、DO 側の判定が正となる
        // （二重の防御。どちらか一方でもフックは起動しない）。
        const faultEnabled =
          env.DEPLOYMENT_TIER === "local-mock" && env.ALLOW_TEST_HOOKS === "1";
        const cookies = parseCookies(request);
        const { status, json } = await doCall(env, "/do/apply", {
          body: { ...body, _fault: faultEnabled ? body._fault : undefined },
          ctx: cookies[NONCE_CTX_COOKIE] || null,
        });
        return jsonResponse({ ...json, origin }, status);
      }

      // /admin/* を含むその他すべては一時ビルドに存在しない。
      return jsonResponse({ error: "not_found" }, 404);
    } catch (e) {
      if (e instanceof HttpError) {
        return jsonResponse({ error: e.code }, e.status);
      }
      return jsonResponse({ error: "internal", detail: String(e && e.message || e) }, 500);
    }
  },
};
