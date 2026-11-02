// VHSlide 段階①フェーズ1 次期試作ハーネス 試験ランナー（手順1・ローカル模擬）
//
// Miniflare をプログラムから起動してハーネスを載せ、計画 v0.3 第6節
// 手順3〜6の試験項目を自動で確認する。実 Google・実 Cloudflare には接続しない。
// 模擬 ID トークン（mock.<sub>.<nonce>）とダミーのシークレットだけを使う。
// 実認証ロジックの確認には、ローカルに立てた偽 tokeninfo サーバー
// （fabricated な JSON を返すだけの Node http サーバー）を使う。
//
// 実行: npm test  （= node test/run.mjs）
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import { Miniflare } from "miniflare";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// 実行環境の記録（環境差による再現条件の切り分け用。レビューでの指摘に対応）。
{
  let mfVersion = "unknown";
  try {
    mfVersion = JSON.parse(
      readFileSync(path.join(ROOT, "node_modules", "miniflare", "package.json"), "utf8")
    ).version;
  } catch { /* バージョンが読めなくても試験は続ける */ }
  console.log(
    `実行環境: OS=${os.platform()} ${os.release()} (${os.arch()}) Node=${process.version} Miniflare=${mfVersion}`
  );
}
const ORIGIN = "http://localhost:8787";
const ENV_ID = "stage1-verification-only-20261101";
const BOOTSTRAP_SECRET = "test-bootstrap-secret";
const RECOVERY_KEY = "test-recovery-key";
const RESTART_KEY = "test-restart-key";
const DIAG_KEY = "test-diag-key";
const REAL_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const REAL_SUB = "real-subject-001";

const SUB_A = "mock-subject-alpha-001"; // 初期登録・復旧元
const SUB_B = "mock-subject-beta-002"; // 復旧先
const SUB_C = "mock-subject-gamma-003"; // 並行登録用
const SUB_D = "mock-subject-delta-004"; // 並行登録用
const SUB_X = "mock-subject-xray-005"; // 失敗注入・未知 nonce 用
const SUB_T = "mock-subject-ttl-006"; // 期限切れ nonce 用
const SUB_W = "mock-subject-wrongsec-000"; // 誤シークレット用

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// ---------- 結果集計 ----------
const results = [];
function check(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -- " + detail}`);
}
function section(title) {
  console.log(`\n== ${title} ==`);
}

// ---------- Miniflare 起動 ----------
async function startHarness(persistName, extraBindings = {}) {
  const persist = path.join(ROOT, persistName);
  const mf = new Miniflare({
    modules: true,
    scriptPath: path.join(ROOT, "src", "worker.js"),
    compatibilityDate: "2025-01-01",
    durableObjects: {
      VERIFY_ONLY: { className: "VerificationDO", useSQLite: true },
    },
    durableObjectsPersist: persist,
    // 値が undefined のキーは binding 自体を外す（「未設定」の再現用）。
    bindings: Object.fromEntries(
      Object.entries({
        BOOTSTRAP_SECRET,
        RECOVERY_KEY,
        RESTART_KEY,
        DIAG_KEY,
        DEPLOYMENT_TIER: "local-mock",
        MOCK_AUTH: "1",
        ALLOW_TEST_HOOKS: "1",
        ENV_ID,
        ...extraBindings,
      }).filter(([, v]) => v !== undefined)
    ),
  });
  const url = await mf.ready;
  return { mf, base: url.toString().replace(/\/$/, "") };
}

// ---------- HTTP ヘルパ ----------
// 接続レベルの例外（fetch failed / ECONNRESET 等）だけを対象に、短い間隔で
// 最大3回まで再試行する。環境によっては Miniflare（workerd）への接続が
// 一時的に切れることがあるための措置で、HTTP 状態や応答内容の不一致は
// 再試行しない（アサーションの失敗をごまかさない）。再試行は出力に残す。
let connRetryTotal = 0;
function connErrorLabel(e) {
  const parts = [e && e.message, e && e.cause && (e.cause.code || e.cause.message)]
    .filter(Boolean)
    .join(" / ");
  return parts || String(e);
}
function isConnLevelError(e) {
  const label = connErrorLabel(e);
  return (
    (e instanceof TypeError && /fetch failed/.test(label)) ||
    /ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|UND_ERR_(CONNECT|CONN)/.test(label)
  );
}
async function fetchWithRetry(url, init) {
  const delaysMs = [150, 400, 1000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (!isConnLevelError(e) || attempt >= 3) throw e;
      connRetryTotal++;
      console.log(
        `  [retry] 接続レベルの例外のため再試行します (${attempt + 1}/3): ${init.method || "GET"} ${url} -- ${connErrorLabel(e)}`
      );
      await new Promise((r) => setTimeout(r, delaysMs[attempt]));
    }
  }
}

async function call(base, method, p, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.origin === undefined) {
    if (method === "POST") headers["Origin"] = ORIGIN;
  } else if (opts.origin !== null) {
    headers["Origin"] = opts.origin;
  }
  let body;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  if (opts.csrf !== undefined && opts.csrf !== null) headers["X-CSRF"] = opts.csrf;
  const res = await fetchWithRetry(base + p, { method, headers, body });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* JSON でない応答 */
  }
  const setCookie =
    typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return { status: res.status, json, setCookie, text };
}

function cookiePairFrom(setCookie, name) {
  const found = (setCookie || []).find((v) => v.startsWith(name + "="));
  return found ? found.split(";")[0] : null;
}

// nonce の発行。認証試行コンテキストの Cookie（mtrial_nonce_ctx）も一緒に返す。
// /register・/login・/recover では、発行時と同じコンテキスト Cookie の提示が必要。
async function issueNonce(base) {
  const r = await call(base, "GET", "/nonce", { origin: ORIGIN });
  if (r.status !== 200 || !r.json || !r.json.nonce) {
    throw new Error(`nonce 取得に失敗: ${r.status} ${r.text}`);
  }
  const ctx = cookiePairFrom(r.setCookie, "mtrial_nonce_ctx");
  if (!ctx) throw new Error("nonce 発行でコンテキスト Cookie が返りませんでした");
  return { nonce: r.json.nonce, ctx };
}

const mockToken = (sub, nonce) => `mock.${sub}.${nonce}`;

function sessionCookieFrom(setCookie) {
  return cookiePairFrom(setCookie, "session");
}

// 診断読み取り（秘匿化済み）。DIAG_KEY の照合が必須。
async function getState(base) {
  const r = await call(base, "GET", "/test/state", {
    origin: null,
    headers: { "X-Diag-Key": DIAG_KEY },
  });
  if (r.status !== 200) throw new Error(`/test/state 取得に失敗: ${r.status}`);
  return r.json;
}

// 「状態」の中核（資格・完了・復旧・セッション件数）。nonce 記録は試行ごとに
// 正当に増えるため不変確認の対象から外す。診断応答は秘匿化済みのため、
// セッションは件数で比較する。
function coreOf(state) {
  return JSON.stringify({
    credentials: state.credentials,
    completion: state.completion,
    recovery: state.recovery,
    sessions: state.counts.sessions,
  });
}

// ---------- 偽 tokeninfo サーバー（実認証ロジックの試験用） ----------
// id_token の先頭セグメントで返すクレームを切り替える:
//   good.<nonce>      正しいクレーム一式
//   badaud.<nonce>    aud 不一致
//   expired.<nonce>   exp 切れ
//   expstr.<nonce>    exp が非数値文字列（"not-a-number"）
//   expnull.<nonce>   exp が null（欠落相当）
//   expinf.<nonce>    exp が "Infinity" 文字列（有限でない）
//   unverified.<nonce> email_verified=false
//   nosub.<nonce>     sub 欠落
// それ以外は 400 を返す（tokeninfo_rejected の経路）。
let tokeninfoHits = 0;
const fakeTokeninfo = http.createServer((req, res) => {
  tokeninfoHits++;
  const u = new URL(req.url, "http://127.0.0.1");
  const token = u.searchParams.get("id_token") || "";
  const [kind, ...rest] = token.split(".");
  const nonce = rest.join(".");
  const now = Math.floor(Date.now() / 1000);
  const base = {
    iss: "https://accounts.google.com",
    aud: REAL_CLIENT_ID,
    exp: now + 3600,
    email_verified: "true",
    nonce,
  };
  let claims = null;
  if (kind === "good") claims = { ...base, sub: REAL_SUB };
  else if (kind === "badaud") claims = { ...base, sub: REAL_SUB, aud: "other-client-id" };
  else if (kind === "expired") claims = { ...base, sub: REAL_SUB, exp: now - 3600 };
  else if (kind === "expstr") claims = { ...base, sub: REAL_SUB, exp: "not-a-number" };
  else if (kind === "expnull") claims = { ...base, sub: REAL_SUB, exp: null };
  else if (kind === "expinf") claims = { ...base, sub: REAL_SUB, exp: "Infinity" };
  else if (kind === "unverified") claims = { ...base, sub: REAL_SUB, email_verified: "false" };
  else if (kind === "nosub") claims = { ...base };
  if (!claims) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_token" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(claims));
});
await new Promise((resolve) => fakeTokeninfo.listen(0, "127.0.0.1", resolve));
const FAKE_TOKENINFO_URL = `http://127.0.0.1:${fakeTokeninfo.address().port}/tokeninfo`;

// ---------- 本体 ----------
for (const d of [
  ".persist-main",
  ".persist-aux",
  ".persist-ttl",
  ".persist-ctx",
  ".persist-real",
  ".persist-config",
  ".persist-serve",
]) {
  rmSync(path.join(ROOT, d), { recursive: true, force: true });
}

let main = null;
let main2 = null;
try {
  // ================= メイン系列（登録→操作→復旧→照合） =================
  section("メイン系列: 登録・操作・復旧");
  main = await startHarness(".persist-main");
  const B = main.base;

  // 誤った初回用シークレット → 403・状態不変
  {
    const before = coreOf(await getState(B));
    const n = await issueNonce(B);
    const r = await call(B, "POST", "/register", {
      cookie: n.ctx,
      body: { id_token: mockToken(SUB_W, n.nonce), bootstrap_secret: "wrong-secret" },
    });
    const after = coreOf(await getState(B));
    check(
      "誤った初回用シークレットで 403・状態不変",
      r.status === 403 && before === after,
      `status=${r.status}`
    );
  }

  // 不正 Origin / Origin 欠落（/register） → 拒否・状態不変
  for (const [label, originOpt] of [
    ["不正 Origin", { origin: "http://evil.example" }],
    ["Origin 欠落", { origin: null }],
  ]) {
    const before = coreOf(await getState(B));
    const n = await issueNonce(B);
    const r = await call(B, "POST", "/register", {
      ...originOpt,
      cookie: n.ctx,
      body: { id_token: mockToken(SUB_A, n.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const after = coreOf(await getState(B));
    check(
      `${label} で /register 拒否・状態不変`,
      r.status === 403 && before === after,
      `status=${r.status}`
    );
  }

  // 通常登録 → 201、完了記録の必須項目
  let sessionA = null;
  let nonceA = null;
  {
    const n = await issueNonce(B);
    nonceA = n;
    const r = await call(B, "POST", "/register", {
      cookie: n.ctx,
      body: { id_token: mockToken(SUB_A, n.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const st = await getState(B);
    const comp = st.completion[0] || {};
    check(
      "通常登録が 201 で完了記録に env_id・subject_hash・registered_at がそろう",
      r.status === 201 &&
        comp.env_id === ENV_ID &&
        comp.subject_hash === sha256(SUB_A) &&
        !!comp.registered_at,
      `status=${r.status} completion=${JSON.stringify(comp)}`
    );
    const cookieHeader = (r.setCookie || []).join("; ");
    check(
      "登録応答に受け取った Origin が含まれ、Cookie 属性が仕様どおり（HttpOnly/SameSite=Strict/Path=/ /Max-Age=1800）",
      r.json && r.json.origin === ORIGIN &&
        cookieHeader.includes("HttpOnly") &&
        cookieHeader.includes("SameSite=Strict") &&
        cookieHeader.includes("Path=/") &&
        cookieHeader.includes("Max-Age=1800"),
      `origin=${r.json && r.json.origin} set-cookie=${cookieHeader}`
    );
    sessionA = { cookie: sessionCookieFrom(r.setCookie), csrf: r.json && r.json.csrf_token };
    if (!sessionA.cookie || !sessionA.csrf) throw new Error("登録応答からセッションを取得できませんでした");
  }

  // 再登録 → 409・状態不変
  {
    const before = coreOf(await getState(B));
    const n = await issueNonce(B);
    const r = await call(B, "POST", "/register", {
      cookie: n.ctx,
      body: { id_token: mockToken(SUB_A, n.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const after = coreOf(await getState(B));
    check("再登録が 409 で状態が変わらない", r.status === 409 && before === after, `status=${r.status}`);
  }

  // /operate: 有効セッションで 200
  {
    const r = await call(B, "POST", "/operate", { cookie: sessionA.cookie, csrf: sessionA.csrf, body: {} });
    check("/operate が有効セッションで 200", r.status === 200 && r.json && r.json.ok === true, `status=${r.status}`);
  }
  // /operate: CSRF 欠落 → 403
  {
    const r = await call(B, "POST", "/operate", { cookie: sessionA.cookie, body: {} });
    check("/operate は CSRF 欠落で 403", r.status === 403, `status=${r.status}`);
  }
  // /operate: CSRF 不一致 → 403
  {
    const r = await call(B, "POST", "/operate", { cookie: sessionA.cookie, csrf: "deadbeef", body: {} });
    check("/operate は CSRF 不一致で 403", r.status === 403, `status=${r.status}`);
  }
  // /operate: 不正 Origin → 403
  {
    const r = await call(B, "POST", "/operate", {
      origin: "http://evil.example",
      cookie: sessionA.cookie,
      csrf: sessionA.csrf,
      body: {},
    });
    check("/operate は不正 Origin で 403", r.status === 403, `status=${r.status}`);
  }

  // nonce 再利用の拒否（登録で消費済みの nonce を、発行時と同じ
  // コンテキスト Cookie を伴って復旧試行で再利用する）
  {
    const before = coreOf(await getState(B));
    const r = await call(B, "POST", "/recover", {
      cookie: nonceA.ctx,
      body: { id_token: mockToken(SUB_B, nonceA.nonce), recovery_key: RECOVERY_KEY },
    });
    const after = coreOf(await getState(B));
    check(
      "nonce の再利用が拒否される・状態不変",
      r.status === 401 && before === after,
      `status=${r.status} error=${r.json && r.json.error}`
    );
  }

  // 誤った復旧キー → 403・旧資格維持
  {
    const before = coreOf(await getState(B));
    const n = await issueNonce(B);
    const r = await call(B, "POST", "/recover", {
      cookie: n.ctx,
      body: { id_token: mockToken(SUB_B, n.nonce), recovery_key: "wrong-key" },
    });
    const after = coreOf(await getState(B));
    const op = await call(B, "POST", "/operate", { cookie: sessionA.cookie, csrf: sessionA.csrf, body: {} });
    check(
      "誤った復旧キーで 403・旧資格が維持される",
      r.status === 403 && before === after && op.status === 200,
      `status=${r.status} operate=${op.status}`
    );
  }

  // 復旧キーだけ（新しい ID トークンなし） → 復旧できない
  {
    const before = coreOf(await getState(B));
    const r = await call(B, "POST", "/recover", { body: { recovery_key: RECOVERY_KEY } });
    const after = coreOf(await getState(B));
    check(
      "復旧キーだけ（新しい ID トークンなし）では復旧できない",
      (r.status === 400 || r.status === 401 || r.status === 403) && before === after,
      `status=${r.status}`
    );
  }
  // ID トークンだけ（復旧キーなし） → 復旧できない
  {
    const before = coreOf(await getState(B));
    const n = await issueNonce(B);
    const r = await call(B, "POST", "/recover", {
      cookie: n.ctx,
      body: { id_token: mockToken(SUB_B, n.nonce) },
    });
    const after = coreOf(await getState(B));
    check(
      "ID トークンだけ（復旧キーなし）では復旧できない",
      r.status === 403 && before === after,
      `status=${r.status}`
    );
  }

  // 復旧途中の失敗注入 → 旧資格維持・新資格なし
  {
    const before = coreOf(await getState(B));
    const n = await issueNonce(B);
    const r = await call(B, "POST", "/recover", {
      headers: { "X-Test-Fail": "recover-mid" },
      cookie: n.ctx,
      body: { id_token: mockToken(SUB_B, n.nonce), recovery_key: RECOVERY_KEY },
    });
    const after = coreOf(await getState(B));
    const op = await call(B, "POST", "/operate", { cookie: sessionA.cookie, csrf: sessionA.csrf, body: {} });
    check(
      "復旧途中の失敗注入で旧資格が維持され新資格が付かない",
      r.status === 500 && before === after && op.status === 200,
      `status=${r.status} operate=${op.status}`
    );
  }

  // 正常な復旧 → 201、復旧記録に旧新の対応・日時・環境 ID
  let sessionB = null;
  {
    const n = await issueNonce(B);
    const r = await call(B, "POST", "/recover", {
      cookie: n.ctx,
      body: { id_token: mockToken(SUB_B, n.nonce), recovery_key: RECOVERY_KEY },
    });
    const st = await getState(B);
    const rec = st.recovery[0] || {};
    const comp = st.completion[0] || {};
    check(
      "正常な復旧が 201 で復旧記録に旧新の対応と日時が残る",
      r.status === 201 &&
        st.recovery.length === 1 &&
        rec.old_subject_hash === sha256(SUB_A) &&
        rec.new_subject_hash === sha256(SUB_B) &&
        !!rec.recovered_at,
      `status=${r.status} recovery=${JSON.stringify(rec)}`
    );
    check(
      "復旧記録に env_id が含まれ、完了記録の env_id と一致する",
      rec.env_id === ENV_ID && rec.env_id === comp.env_id,
      `recovery.env_id=${rec.env_id} completion.env_id=${comp.env_id}`
    );
    sessionB = { cookie: sessionCookieFrom(r.setCookie), csrf: r.json && r.json.csrf_token };
    if (!sessionB.cookie || !sessionB.csrf) throw new Error("復旧応答からセッションを取得できませんでした");
  }

  // 復旧前の旧セッション → 403、新セッション → 200
  {
    const oldOp = await call(B, "POST", "/operate", { cookie: sessionA.cookie, csrf: sessionA.csrf, body: {} });
    const newOp = await call(B, "POST", "/operate", { cookie: sessionB.cookie, csrf: sessionB.csrf, body: {} });
    check(
      "復旧前に発行された旧セッションは /operate で 403・新セッションは 200",
      oldOp.status === 403 && newOp.status === 200,
      `old=${oldOp.status} new=${newOp.status}`
    );
  }

  // 再ログイン: 旧 ID トークン拒否・新 ID トークン許可
  let sessionB2 = null;
  {
    const n1 = await issueNonce(B);
    const oldLogin = await call(B, "POST", "/login", {
      cookie: n1.ctx,
      body: { id_token: mockToken(SUB_A, n1.nonce) },
    });
    const n2 = await issueNonce(B);
    const newLogin = await call(B, "POST", "/login", {
      cookie: n2.ctx,
      body: { id_token: mockToken(SUB_B, n2.nonce) },
    });
    sessionB2 = { cookie: sessionCookieFrom(newLogin.setCookie), csrf: newLogin.json && newLogin.json.csrf_token };
    check(
      "復旧後に旧 ID トークンは拒否され新 ID トークンは許可される（再ログイン）",
      oldLogin.status === 403 && newLogin.status === 200 && !!sessionB2.cookie,
      `old=${oldLogin.status} new=${newLogin.status}`
    );
  }

  // 事後照合: ハッシュ再計算と記録の一致
  {
    const st = await getState(B);
    const comp = st.completion[0] || {};
    const rec = st.recovery[0] || {};
    check(
      "事後照合: 完了記録は初代（A）のまま不変で、復旧記録の旧新（A→B）と現在の資格（B）に一致する",
      comp.subject_hash === sha256(SUB_A) &&
        rec.old_subject_hash === sha256(SUB_A) &&
        rec.new_subject_hash === sha256(SUB_B) &&
        st.credentials.length === 1 &&
        st.credentials[0].subject_hash === sha256(SUB_B),
      `completion=${comp.subject_hash} recovery=${JSON.stringify(rec)} credentials=${JSON.stringify(st.credentials)}`
    );
  }

  // 生の sub が保存内容のどこにも現れない
  // 注意: 診断応答は秘匿化済み（sessions と nonce は件数のみ）のため、
  // この確認の範囲は秘匿化済み応答に限られる（README に明記）。
  {
    const st = await getState(B);
    const dump = JSON.stringify(st);
    const leaked = [SUB_A, SUB_B, SUB_C, SUB_D, SUB_X, SUB_T, SUB_W].filter((s) => dump.includes(s));
    check(
      "生の sub が診断応答（秘匿化済み）のどこにも現れない",
      leaked.length === 0,
      `leaked=${leaked.join(",")}`
    );
  }

  // 診断応答の秘匿化: CSRF 値・未使用 nonce の値を含まない
  {
    const n = await issueNonce(B);
    const st = await getState(B);
    const dump = JSON.stringify(st);
    check(
      "診断応答に CSRF 値・未使用 nonce の値・セッション ID が含まれない",
      !dump.includes(sessionB.csrf) &&
        !dump.includes(n.nonce) &&
        !dump.includes(sessionB.cookie.split("=")[1]),
      "秘匿化された値が診断応答に含まれています"
    );
  }

  // 診断経路の保護: DIAG_KEY が必須
  {
    const noKey = await call(B, "GET", "/test/state", { origin: null });
    const wrongKey = await call(B, "GET", "/test/state", {
      origin: null,
      headers: { "X-Diag-Key": "wrong-diag-key" },
    });
    const bootNoKey = await call(B, "GET", "/test/boot", { origin: null });
    check(
      "診断経路は DIAG_KEY なし・不一致では拒否される",
      noKey.status === 403 && wrongKey.status === 403 && bootNoKey.status === 403,
      `noKey=${noKey.status} wrongKey=${wrongKey.status} bootNoKey=${bootNoKey.status}`
    );
  }

  // ================= 中継（変形Bひな形）の素通し確認 =================
  section("中継: ヘッダー素通し");
  {
    const relayMf = new Miniflare({
      modules: true,
      scriptPath: path.join(ROOT, "relay", "worker.js"),
      compatibilityDate: "2025-01-01",
      bindings: { HARNESS_URL: B },
    });
    const relayUrl = await relayMf.ready;
    const RB = relayUrl.toString().replace(/\/$/, "");
    const viaRelay = await call(RB, "GET", "/nonce", { origin: ORIGIN });
    check(
      "[extra] 中継経由でも Origin が素通しされ応答に echo される",
      viaRelay.status === 200 && viaRelay.json && viaRelay.json.origin === ORIGIN,
      `status=${viaRelay.status} origin=${viaRelay.json && viaRelay.json.origin}`
    );
    const op = await call(RB, "POST", "/operate", { cookie: sessionB.cookie, csrf: sessionB.csrf, body: {} });
    check(
      "[extra] 中継経由の /operate で Cookie・CSRF・Origin が素通しされる",
      op.status === 200,
      `status=${op.status}`
    );
    await relayMf.dispose();
  }

  // ================= 実画面の提供サーバー（tools/serve-real.mjs） =================
  // ハーネス（模擬形態）を RELAY_URL の先に置き、serve-real が画面と API を
  // 同一生成元で提供する形（実試験の PC 側構成）を確認する。待ち受け
  // ポートは試験用に PORT で 18787 へずらすが、ブラウザー生成元は
  // http://localhost:8787 として Origin を付ける（実構成では 8787）。
  section("実画面の提供サーバー: serve-real");
  {
    const srv = await startHarness(".persist-serve");
    const SERVE_PORT = "18787";
    const SERVE_BASE = `http://127.0.0.1:${SERVE_PORT}`;
    const child = spawn(process.execPath, [path.join(ROOT, "tools", "serve-real.mjs")], {
      env: {
        ...process.env,
        GOOGLE_CLIENT_ID: REAL_CLIENT_ID,
        RELAY_URL: srv.base,
        PORT: SERVE_PORT,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let childOut = "";
    child.stdout.on("data", (d) => { childOut += d; });
    child.stderr.on("data", (d) => { childOut += d; });
    try {
      // 起動待ち（接続できるまで短く繰り返す。ここは試験対象の応答ではない）
      let html = null;
      for (let i = 0; i < 50 && html === null; i++) {
        try {
          const rr = await fetch(SERVE_BASE + "/");
          if (rr.status === 200) html = await rr.text();
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      check(
        "serve-real が実画面を返し、クライアント ID が差し込まれている（プレースホルダは残らない）",
        html !== null &&
          html.includes(REAL_CLIENT_ID) &&
          !html.includes("REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID"),
        html === null ? "serve-real が起動しませんでした" : "差し込み結果が不正です"
      );
      // serve-real 経由で nonce → 登録 → 操作の一連が通る
      const n = await issueNonce(SERVE_BASE);
      const reg = await call(SERVE_BASE, "POST", "/register", {
        cookie: n.ctx,
        body: { id_token: mockToken(SUB_A, n.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
      });
      const sess = { cookie: sessionCookieFrom(reg.setCookie), csrf: reg.json && reg.json.csrf_token };
      const op = sess.cookie
        ? await call(SERVE_BASE, "POST", "/operate", { cookie: sess.cookie, csrf: sess.csrf, body: {} })
        : { status: 0 };
      check(
        "serve-real 経由で nonce 取得 → 登録 201 → 操作 200 の一連が通る",
        reg.status === 201 && op.status === 200,
        `register=${reg.status} operate=${op.status}`
      );
      // ログ秘匿: 秘密の値・トークン類が serve-real の出力に現れない
      check(
        "serve-real のログに秘密の値・nonce・CSRF・セッション値が出ない",
        !childOut.includes(BOOTSTRAP_SECRET) &&
          !childOut.includes(n.nonce) &&
          !(sess.csrf && childOut.includes(sess.csrf)) &&
          !(sess.cookie && childOut.includes(sess.cookie.split("=")[1])),
        "serve-real のログに秘匿すべき値が含まれています"
      );
    } finally {
      child.kill();
      await srv.mf.dispose();
    }
  }

  // ================= 再起動（dispose → 同じ永続化先で再生成） =================
  section("再起動: dispose → 再生成");
  const bootBefore = (await getState(B)).boot_count;
  await main.mf.dispose();
  main2 = await startHarness(".persist-main");
  const B2 = main2.base;
  {
    const st = await getState(B2);
    check(
      "boot_count の変化で再起動を検出できる",
      typeof st.boot_count === "number" && st.boot_count > bootBefore,
      `before=${bootBefore} after=${st.boot_count}`
    );
    const comp = st.completion[0] || {};
    const n = await issueNonce(B2);
    const reReg = await call(B2, "POST", "/register", {
      cookie: n.ctx,
      body: { id_token: mockToken(SUB_B, n.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const oldOp = await call(B2, "POST", "/operate", { cookie: sessionA.cookie, csrf: sessionA.csrf, body: {} });
    const newOp = await call(B2, "POST", "/operate", { cookie: sessionB.cookie, csrf: sessionB.csrf, body: {} });
    check(
      "DO 再起動後も資格状態・再登録拒否・旧セッション拒否が維持される",
      comp.subject_hash === sha256(SUB_A) &&
        st.credentials.length === 1 &&
        st.credentials[0].subject_hash === sha256(SUB_B) &&
        reReg.status === 409 &&
        oldOp.status === 403 &&
        newOp.status === 200,
      `completion=${comp.subject_hash} reRegister=${reReg.status} oldSession=${oldOp.status} newSession=${newOp.status}`
    );
  }

  // /admin/restart フック
  // 注意（模擬層の制約）: ローカルの workerd/Miniflare では、DO の fetch で
  // 例外を投げてもインスタンスは破棄・再生成されない（本番 Cloudflare では
  // 例外時に DO が再起動する想定だが、例外送出のみを再生成とみなさない）。
  // そのためここでは「鍵の照合」と「一致時に例外が DO の外へ伝播すること
  // （500）」までを確認し、実際の再起動検出は上の dispose → 再生成＋
  // boot_count の項目で確認する。
  {
    const wrong = await call(B2, "POST", "/admin/restart", {
      headers: { "X-Restart-Key": "wrong-key" },
      body: {},
    });
    let threw = false;
    try {
      const r = await call(B2, "POST", "/admin/restart", {
        headers: { "X-Restart-Key": RESTART_KEY },
        body: {},
      });
      threw = r.status >= 500;
    } catch {
      threw = true; // 接続が切れる形で例外が伝播した場合
    }
    const st = await getState(B2);
    const comp = st.completion[0] || {};
    check(
      "[extra] /admin/restart は鍵不一致で 403・一致で例外を投げる",
      wrong.status === 403 && threw && comp.subject_hash === sha256(SUB_A),
      `wrongKey=${wrong.status} threw=${threw}`
    );
  }

  // ================= 補助系列（失敗注入・未知 nonce・並行登録） =================
  section("補助系列: 失敗注入・並行登録");
  {
    const aux = await startHarness(".persist-aux");
    const AB = aux.base;
    // 未知の nonce → 拒否
    {
      const n = await issueNonce(AB);
      const r = await call(AB, "POST", "/register", {
        cookie: n.ctx,
        body: { id_token: mockToken(SUB_X, "no-such-nonce"), bootstrap_secret: BOOTSTRAP_SECRET },
      });
      const st = await getState(AB);
      check(
        "未知の nonce が拒否される",
        r.status === 401 && st.credentials.length === 0 && st.completion.length === 0,
        `status=${r.status}`
      );
    }
    // 登録途中の失敗注入 → 資格も完了記録も残らない
    {
      const n = await issueNonce(AB);
      const r = await call(AB, "POST", "/register", {
        headers: { "X-Test-Fail": "register-mid" },
        cookie: n.ctx,
        body: { id_token: mockToken(SUB_X, n.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
      });
      const st = await getState(AB);
      check(
        "登録途中の失敗注入で資格も完了記録も残らない（ロールバック）",
        r.status === 500 && st.credentials.length === 0 && st.completion.length === 0,
        `status=${r.status} credentials=${st.credentials.length} completion=${st.completion.length}`
      );
    }
    // 並行登録（同時2件） → 成功1・拒否1
    {
      const [nC, nD] = [await issueNonce(AB), await issueNonce(AB)];
      const [rC, rD] = await Promise.all([
        call(AB, "POST", "/register", {
          cookie: nC.ctx,
          body: { id_token: mockToken(SUB_C, nC.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
        }),
        call(AB, "POST", "/register", {
          cookie: nD.ctx,
          body: { id_token: mockToken(SUB_D, nD.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
        }),
      ]);
      const statuses = [rC.status, rD.status].sort((a, b) => a - b);
      const st = await getState(AB);
      const winner = st.completion[0] || {};
      check(
        "並行登録（同時2件）で成功1・拒否1",
        statuses[0] === 201 && statuses[1] === 409 &&
          (winner.subject_hash === sha256(SUB_C) || winner.subject_hash === sha256(SUB_D)),
        `statuses=${statuses.join(",")} winner=${winner.subject_hash}`
      );
    }
    await aux.mf.dispose();
  }

  // ================= 期限切れ nonce =================
  section("期限切れ nonce");
  {
    const ttl = await startHarness(".persist-ttl", { NONCE_TTL_SECONDS: "0" });
    const TB = ttl.base;
    const n = await issueNonce(TB);
    const r = await call(TB, "POST", "/register", {
      cookie: n.ctx,
      body: { id_token: mockToken(SUB_T, n.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const st = await getState(TB);
    check(
      "期限切れ nonce が拒否される",
      r.status === 401 && st.credentials.length === 0,
      `status=${r.status}`
    );
    await ttl.mf.dispose();
  }

  // ================= nonce のブラウザー結び付け =================
  section("nonce のコンテキスト結び付け");
  {
    const cx = await startHarness(".persist-ctx");
    const CB = cx.base;
    const WRONG_CTX = "mtrial_nonce_ctx=0000000000000000000000000000000000000000000000000000000000000000";
    // 1) 別のコンテキスト（別の Cookie）での使用 → 拒否・状態不変
    const n1 = await issueNonce(CB);
    {
      const r = await call(CB, "POST", "/register", {
        cookie: WRONG_CTX,
        body: { id_token: mockToken(SUB_A, n1.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
      });
      const st = await getState(CB);
      check(
        "別のコンテキスト Cookie での nonce 使用が拒否される・状態不変",
        r.status === 403 && st.credentials.length === 0 && st.completion.length === 0,
        `status=${r.status} error=${r.json && r.json.error}`
      );
    }
    // 2) Cookie なしでの使用 → 拒否・状態不変
    //    （失敗した試行では nonce は消費されないことも併せて確認する）
    {
      const r = await call(CB, "POST", "/register", {
        body: { id_token: mockToken(SUB_A, n1.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
      });
      const st = await getState(CB);
      check(
        "コンテキスト Cookie なしでの nonce 使用が拒否される・状態不変",
        r.status === 403 && st.credentials.length === 0 && st.completion.length === 0,
        `status=${r.status} error=${r.json && r.json.error}`
      );
    }
    // 3) 正規の流れ（発行時と同じコンテキスト）では同じ nonce が通る
    let ctxSessionA = null;
    {
      const r = await call(CB, "POST", "/register", {
        cookie: n1.ctx,
        body: { id_token: mockToken(SUB_A, n1.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
      });
      check(
        "正規のコンテキストでは nonce が通り登録できる",
        r.status === 201,
        `status=${r.status} error=${r.json && r.json.error}`
      );
      ctxSessionA = { cookie: sessionCookieFrom(r.setCookie), csrf: r.json && r.json.csrf_token };
      if (!ctxSessionA.cookie) throw new Error("コンテキスト試験の登録でセッションを取得できませんでした");
    }
    // 4) /recover でもコンテキスト不一致は拒否され、正規の流れは通る
    {
      const n2 = await issueNonce(CB);
      const bad = await call(CB, "POST", "/recover", {
        cookie: WRONG_CTX,
        body: { id_token: mockToken(SUB_B, n2.nonce), recovery_key: RECOVERY_KEY },
      });
      const stBad = await getState(CB);
      const good = await call(CB, "POST", "/recover", {
        cookie: n2.ctx,
        body: { id_token: mockToken(SUB_B, n2.nonce), recovery_key: RECOVERY_KEY },
      });
      check(
        "/recover でもコンテキスト不一致は拒否され、正規のコンテキストでは復旧できる",
        bad.status === 403 &&
          stBad.credentials.length === 1 &&
          stBad.credentials[0].subject_hash === sha256(SUB_A) &&
          good.status === 201,
        `bad=${bad.status} good=${good.status}`
      );
    }
    // 5) /login でもコンテキスト不一致は拒否され、正規の流れは通る
    {
      const n3 = await issueNonce(CB);
      const bad = await call(CB, "POST", "/login", {
        cookie: WRONG_CTX,
        body: { id_token: mockToken(SUB_B, n3.nonce) },
      });
      const good = await call(CB, "POST", "/login", {
        cookie: n3.ctx,
        body: { id_token: mockToken(SUB_B, n3.nonce) },
      });
      check(
        "/login でもコンテキスト不一致は拒否され、正規のコンテキストでは再ログインできる",
        bad.status === 403 && good.status === 200,
        `bad=${bad.status} good=${good.status}`
      );
    }
    await cx.mf.dispose();
  }

  // ================= 実認証ロジック（偽 tokeninfo） =================
  section("実認証ロジック: 偽 tokeninfo での検証");
  {
    const real = await startHarness(".persist-real", {
      MOCK_AUTH: "",
      GOOGLE_CLIENT_ID: REAL_CLIENT_ID,
      TOKENINFO_URL: FAKE_TOKENINFO_URL,
    });
    const RB2 = real.base;
    // 正しいクレームで登録できる（TOKENINFO_URL の上書きが local-mock で効くことも含む）
    {
      const hitsBefore = tokeninfoHits;
      const n = await issueNonce(RB2);
      const r = await call(RB2, "POST", "/register", {
        cookie: n.ctx,
        body: { id_token: `good.${n.nonce}`, bootstrap_secret: BOOTSTRAP_SECRET },
      });
      const st = await getState(RB2);
      const comp = st.completion[0] || {};
      check(
        "実認証ロジック: 正しいクレームで登録できる",
        r.status === 201 &&
          tokeninfoHits > hitsBefore &&
          comp.subject_hash === sha256(REAL_SUB),
        `status=${r.status} hits=${hitsBefore}->${tokeninfoHits} completion=${JSON.stringify(comp)}`
      );
    }
    // クレーム異常はいずれも拒否され、状態が変わらない
    for (const [label, kind] of [
      ["aud 不一致", "badaud"],
      ["exp 切れ", "expired"],
      ["exp が非数値文字列", "expstr"],
      ["exp が null", "expnull"],
      ["exp が Infinity 文字列（有限でない）", "expinf"],
      ["email_verified=false", "unverified"],
      ["sub 欠落", "nosub"],
    ]) {
      const before = coreOf(await getState(RB2));
      const n = await issueNonce(RB2);
      const r = await call(RB2, "POST", "/register", {
        cookie: n.ctx,
        body: { id_token: `${kind}.${n.nonce}`, bootstrap_secret: BOOTSTRAP_SECRET },
      });
      const after = coreOf(await getState(RB2));
      check(
        `実認証ロジック: ${label} で拒否される・状態不変`,
        r.status === 401 && before === after,
        `status=${r.status} error=${r.json && r.json.error}`
      );
    }
    await real.mf.dispose();
  }
  // GOOGLE_CLIENT_ID 未設定では、tokeninfo に届く前に拒否される
  {
    const hitsBefore = tokeninfoHits;
    const nc = await startHarness(".persist-config", {
      MOCK_AUTH: "",
      GOOGLE_CLIENT_ID: "",
      TOKENINFO_URL: FAKE_TOKENINFO_URL,
    });
    const r = await call(nc.base, "POST", "/register", {
      body: { id_token: "good.anything", bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const n = await call(nc.base, "GET", "/nonce", { origin: ORIGIN });
    check(
      "GOOGLE_CLIENT_ID 未設定では全経路が拒否され、tokeninfo に届かない",
      r.status === 500 && r.json && r.json.error === "config_refused" &&
        n.status === 500 && tokeninfoHits === hitsBefore,
      `register=${r.status} nonce=${n.status} hits=${hitsBefore}->${tokeninfoHits}`
    );
    await nc.mf.dispose();
  }

  // ================= 設定検証（fail-closed） =================
  section("設定検証: tier=verify の禁止事項と診断経路の無効化");
  // tier=verify + MOCK_AUTH → 全拒否
  {
    const h = await startHarness(".persist-config", {
      DEPLOYMENT_TIER: "verify",
      MOCK_AUTH: "1",
      GOOGLE_CLIENT_ID: REAL_CLIENT_ID,
    });
    const n = await call(h.base, "GET", "/nonce", { origin: ORIGIN });
    const r = await call(h.base, "POST", "/register", {
      body: { id_token: "mock.x.y", bootstrap_secret: BOOTSTRAP_SECRET },
    });
    check(
      "tier=verify で MOCK_AUTH が有効なら全経路を拒否する",
      n.status === 500 && r.status === 500 &&
        n.json && n.json.error === "config_refused",
      `nonce=${n.status} register=${r.status}`
    );
    await h.mf.dispose();
  }
  // tier=verify + ALLOW_TEST_HOOKS → 全拒否
  {
    const h = await startHarness(".persist-config", {
      DEPLOYMENT_TIER: "verify",
      MOCK_AUTH: "",
      ALLOW_TEST_HOOKS: "1",
      GOOGLE_CLIENT_ID: REAL_CLIENT_ID,
    });
    const n = await call(h.base, "GET", "/nonce", { origin: ORIGIN });
    check(
      "tier=verify で ALLOW_TEST_HOOKS が有効なら全経路を拒否する",
      n.status === 500 && n.json && n.json.error === "config_refused",
      `nonce=${n.status}`
    );
    await h.mf.dispose();
  }
  // tier=verify + TOKENINFO_URL 上書き → 全拒否
  {
    const h = await startHarness(".persist-config", {
      DEPLOYMENT_TIER: "verify",
      MOCK_AUTH: "",
      ALLOW_TEST_HOOKS: "",
      GOOGLE_CLIENT_ID: REAL_CLIENT_ID,
      TOKENINFO_URL: FAKE_TOKENINFO_URL,
    });
    const n = await call(h.base, "GET", "/nonce", { origin: ORIGIN });
    check(
      "tier=verify で TOKENINFO_URL が設定されていたら全経路を拒否する",
      n.status === 500 && n.json && n.json.error === "config_refused",
      `nonce=${n.status}`
    );
    await h.mf.dispose();
  }
  // ENV_ID 未設定 → 登録・復旧を拒否する（代替値への読み替えをしない）
  {
    const h = await startHarness(".persist-config", { ENV_ID: "" });
    const n = await issueNonce(h.base);
    const r = await call(h.base, "POST", "/register", {
      cookie: n.ctx,
      body: { id_token: mockToken(SUB_A, n.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const n2 = await issueNonce(h.base);
    const rec = await call(h.base, "POST", "/recover", {
      cookie: n2.ctx,
      body: { id_token: mockToken(SUB_B, n2.nonce), recovery_key: RECOVERY_KEY },
    });
    const st = await getState(h.base);
    check(
      "ENV_ID 未設定では登録・復旧が拒否される",
      r.status === 500 && r.json && r.json.error === "config_missing_env_id" &&
        rec.status === 500 && rec.json && rec.json.error === "config_missing_env_id" &&
        st.credentials.length === 0 && st.completion.length === 0,
      `register=${r.status} recover=${rec.status}`
    );
    await h.mf.dispose();
  }
  // ALLOW_TEST_HOOKS なし → 診断経路は 404、失敗注入も働かない
  {
    const h = await startHarness(".persist-config", { ALLOW_TEST_HOOKS: "" });
    const st = await call(h.base, "GET", "/test/state", {
      origin: null,
      headers: { "X-Diag-Key": DIAG_KEY },
    });
    const n = await issueNonce(h.base);
    const r = await call(h.base, "POST", "/register", {
      headers: { "X-Test-Fail": "register-mid" },
      cookie: n.ctx,
      body: { id_token: mockToken(SUB_A, n.nonce), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    check(
      "ALLOW_TEST_HOOKS なしでは診断経路が 404 で、失敗注入も働かない",
      st.status === 404 && r.status === 201,
      `state=${st.status} registerWithFailHeader=${r.status}`
    );
    await h.mf.dispose();
  }
  // tier=verify（正規の組み合わせ） → 診断経路と再起動フックは無効（404）、
  // 通常経路は動く。/register は実 tokeninfo へ出るため、ここでは呼ばない。
  {
    const h = await startHarness(".persist-config", {
      DEPLOYMENT_TIER: "verify",
      MOCK_AUTH: "",
      ALLOW_TEST_HOOKS: "",
      GOOGLE_CLIENT_ID: REAL_CLIENT_ID,
    });
    const st = await call(h.base, "GET", "/test/state", {
      origin: null,
      headers: { "X-Diag-Key": DIAG_KEY },
    });
    const rst = await call(h.base, "POST", "/admin/restart", {
      headers: { "X-Restart-Key": RESTART_KEY },
      body: {},
    });
    const n = await call(h.base, "GET", "/nonce", { origin: ORIGIN });
    const op = await call(h.base, "POST", "/operate", { body: {} });
    check(
      "tier=verify では診断経路と /admin/restart が無効（404）で、通常経路は動く",
      st.status === 404 && rst.status === 404 && n.status === 200 && op.status === 403,
      `state=${st.status} restart=${rst.status} nonce=${n.status} operate=${op.status}`
    );
    // カナリア確認: 模擬形式のトークン（mock.*）が verify 形態で受理され
    // ないことを、振る舞いで確認する。verifyIdToken は実 tokeninfo へ
    // 照会するため、応答は 401（tokeninfo_rejected）または、tokeninfo に
    // 到達できない環境では 500 になる。いずれでも「登録として受理され
    // ない」ことが要点であり、201 にならないことを確認する。
    // 送るのは偽トークン文字列のみで、実 ID トークンではない。
    const canaryNonce = await issueNonce(h.base);
    const canary = await call(h.base, "POST", "/register", {
      cookie: canaryNonce.ctx,
      body: {
        id_token: mockToken("canary-subject", canaryNonce.nonce),
        bootstrap_secret: BOOTSTRAP_SECRET,
      },
    });
    check(
      "カナリア: tier=verify では模擬形式トークン（mock.*）での登録が拒否される",
      canary.status !== 201 && (canary.status === 401 || canary.status === 500),
      `status=${canary.status} error=${canary.json && canary.json.error}`
    );
    await h.mf.dispose();
  }
  // DEPLOYMENT_TIER 未設定 → 既定値への読み替えをせず全経路を拒否する
  {
    const h = await startHarness(".persist-config", { DEPLOYMENT_TIER: undefined });
    const n = await call(h.base, "GET", "/nonce", { origin: ORIGIN });
    const r = await call(h.base, "POST", "/register", {
      body: { id_token: mockToken(SUB_A, "any-nonce"), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const st = await call(h.base, "GET", "/test/state", {
      origin: null,
      headers: { "X-Diag-Key": DIAG_KEY },
    });
    check(
      "DEPLOYMENT_TIER 未設定では全経路が拒否される（既定値への読み替えをしない）",
      n.status === 500 && r.status === 500 && st.status === 500 &&
        n.json && n.json.error === "config_refused" &&
        n.json.detail === "config_bad_tier",
      `nonce=${n.status} register=${r.status} state=${st.status} detail=${n.json && n.json.detail}`
    );
    await h.mf.dispose();
  }
  // DEPLOYMENT_TIER が想定外の値 → 全経路を拒否する
  {
    const h = await startHarness(".persist-config", { DEPLOYMENT_TIER: "staging" });
    const n = await call(h.base, "GET", "/nonce", { origin: ORIGIN });
    check(
      "DEPLOYMENT_TIER が想定外の値では全経路が拒否される",
      n.status === 500 && n.json && n.json.error === "config_refused" &&
        n.json.detail === "config_bad_tier",
      `nonce=${n.status} detail=${n.json && n.json.detail}`
    );
    await h.mf.dispose();
  }
} catch (e) {
  check("ランナー実行が最後まで到達する", false, String(e && e.stack || e));
} finally {
  try {
    if (main) await main.mf.dispose();
  } catch { /* dispose 済みの場合がある */ }
  try {
    if (main2) await main2.mf.dispose();
  } catch { /* dispose 済みの場合がある */ }
  fakeTokeninfo.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n== 結果 ==`);
console.log(`合計 ${results.length} 件: PASS ${results.length - failed.length} / FAIL ${failed.length}`);
if (connRetryTotal > 0) {
  console.log(
    `接続レベルの例外による再試行が ${connRetryTotal} 回発生しました（HTTP 応答の不一致は再試行していません）`
  );
}
if (failed.length) {
  for (const f of failed) console.log(`  FAIL: ${f.name} -- ${f.detail}`);
}
process.exit(failed.length ? 1 : 0);
