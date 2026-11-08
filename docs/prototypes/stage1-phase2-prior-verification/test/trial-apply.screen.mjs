// 検証専用画面（public/trial-apply.html）の実画面試験。
// 実行: node test/trial-apply.screen.mjs
// （npm run test:screen でも実行できる）
//
// 目的：文字列の存在確認ではなく、ページ自体を DOM で実行し、旧コール
// バック・失敗・二重操作のふるまいを検証する（Codex レビュー
// 6715565254 への対応）。実 Google・実 Worker は使わない。
//
// 実行環境の制約：この VM では実ブラウザーの起動ができない（管理下の
// Chrome は直接起動できず、Playwright 用ブラウザーの取得も承認待ちで
// 止まる）。そのため jsdom でページを実行する。jsdom 31 は
// `<script type="module">` を実行しないため、試験ではページ内の
// インライン・モジュールの import を、配信中の2つの検証モジュール
// （tools/trial-apply.mjs・tools/subject-hash-verify.mjs）の実ソースを
// 結合して解決し、古典スクリプトとして実行する。変換は import／export
// の除去だけで、文の内容は変えない。DOM・イベント・タイマー・非同期の
// 交錯は実際のページと同じ経路で実行する。なお2つのモジュールは
// `fail` という同名の関数を持つが、内容は同一である（片方がもう片方を
// 上書きしてもふるまいは変わらない）。
// - GIS は偽物（beforeParse で window.google を差し替え、本物の
//   gsi/client は空の応答を返す）。
// - JWKS はインターセプターで偽物の公開鍵集合を返す。ID トークンは
//   その場で生成した RSA 鍵で署名した RS256 JWT で、ページ内の JWKS
//   署名検証を通る。
// - /platform/apply はインターセプターで要求本体を記録し、遅延させら
//   れる。応答は中継（Miniflare の local-mock 通常ビルド）へ素通し
//   する。local-mock は MOCK_AUTH の形式でないトークンを拒否するた
//   め、応答は 401 tokeninfo_rejected になる。画面の送信・ログ対応の
//   確認には十分であり、201 の成功経路は実環境で確認する。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。
// ※ test/run.mjs の件数には含めない（別枠のローカル確認）。

import { Miniflare } from "miniflare";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign, webcrypto } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "jsdom";
const { JSDOM, VirtualConsole, requestInterceptor } = pkg;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_PORT = 8897;
const CLIENT_ID = "screen-client-id.apps.googleusercontent.com";
const ENV_ID = "stage1-phase2-verification-local";
const FIXED_ENV_ID = "stage1-verification-only-20261101";
const NOW = Math.floor(Date.now() / 1000);

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -- " + detail}`);
}

function base64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

// 偽 JWKS と RS256 JWT の発行（画面の JWKS 署名検証を通すため）。
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "screen-key-1";
jwk.use = "sig";
jwk.alg = "RS256";
const FAKE_JWKS = { keys: [jwk] };

function mintToken(nonce) {
  const h = { alg: "RS256", typ: "JWT", kid: "screen-key-1" };
  const p = {
    sub: "screen-subject-A",
    aud: CLIENT_ID,
    iss: "https://accounts.google.com",
    exp: NOW + 600,
    iat: NOW,
    nonce,
  };
  const input = `${base64url(JSON.stringify(h))}.${base64url(JSON.stringify(p))}`;
  const sig = sign("sha256", Buffer.from(input), privateKey);
  return `${input}.${base64url(sig)}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = 10000, stepMs = 50) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(stepMs);
  }
  return cond();
}

// モジュール・ソースの import／export を除去して古典スクリプト化する。
// 文の内容は変えない。
function stripModule(code) {
  return code
    .replace(/^import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?\s*$/gm, "")
    // `export ` だけを除去する。`async` は残す（async function のままにする）。
    .replace(/^export\s+(?=async\s+function|function|const|let|class)/gm, "");
}

const mf = new Miniflare({
  modules: true,
  scriptPath: path.join(ROOT, "src", "worker.js"),
  compatibilityDate: "2025-01-01",
  durableObjects: { REGISTRY: { className: "RegistryDO", useSQLite: true } },
  durableObjectsPersist: path.join(ROOT, ".persist-screen"),
  bindings: {
    DEPLOYMENT_TIER: "local-mock",
    MOCK_AUTH: "1",
    ALLOW_TEST_HOOKS: "1",
    GOOGLE_CLIENT_ID: CLIENT_ID,
    ENV_ID,
    DIAG_KEY: "screen-diag-key",
  },
});
const mfUrl = (await mf.ready).toString().replace(/\/$/, "");

const child = spawn("node", [path.join(ROOT, "tools", "serve-real.mjs")], {
  env: {
    ...process.env,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    RELAY_URL: mfUrl,
    PORT: String(SERVE_PORT),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let childLog = "";
child.stdout.on("data", (d) => { childLog += d; });
child.stderr.on("data", (d) => { childLog += d; });

const base = `http://127.0.0.1:${SERVE_PORT}`;
async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(base + "/trial-apply");
      if (r.status === 200) return true;
    } catch { /* 起動待ち */ }
    await sleep(200);
  }
  return false;
}

try {
  const ready = await waitReady();
  check("実画面: serve-real が起動し、trial-apply 画面を返す", ready, childLog.slice(-400));
  if (!ready) throw new Error("serve-real が起動しませんでした");

  // ページと2つの検証モジュールの実ソースを取得し、インライン・
  // モジュールの import を解決して古典スクリプト化する。
  const pageHtml = await (await fetch(base + "/trial-apply")).text();
  const trialJs = await (await fetch(base + "/trial-apply.mjs")).text();
  const verifyJs = await (await fetch(base + "/subject-hash-verify.mjs")).text();
  const inlineModule = pageHtml.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!inlineModule) throw new Error("ページ内にインライン・モジュールが見つかりません");
  const classic = stripModule(verifyJs) + "\n" + stripModule(trialJs) + "\n" + stripModule(inlineModule[1]);
  // モジュールは既定で遅延実行される（本文の解析後に実行）が、古典
  // スクリプトはその場で実行される。古典スクリプトを </body> の直前に
  // 移し、本文の要素が存在してから実行されるようにする。
  const testHtml = pageHtml
    .replace(inlineModule[0], "")
    .replace("</body>", `<script>${classic}</script>\n</body>`);
  check("実画面: ページのモジュール import を解決できる", testHtml.includes("buildTrialRequest"));

  // 場面ごとの状態は各 window に置く（__applyBodies・__applyDelayMs・
  // __nonceShouldFail）。fetch のポリフィルがそれを参照する。

  async function makeDom() {
    const vc = new VirtualConsole();
    const jsdomErrors = [];
    vc.on("jsdomError", (e) => jsdomErrors.push(String(e && e.detail ? e.detail : e)));
    const dom = new JSDOM(testHtml, {
      url: base + "/trial-apply",
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole: vc,
      resources: {
        interceptors: [
          // 副資源の読み込みだけを扱う。本物の GIS スクリプトは
          // 読み込ませない（空の応答を返す）。
          requestInterceptor((request) => {
            if (request.url.includes("gsi/client")) {
              return new Response("", { headers: { "Content-Type": "application/javascript" } });
            }
            return undefined;
          }),
        ],
      },
      beforeParse(window) {
        // jsdom の window.crypto には subtle がないため、Node の
        // WebCrypto の subtle を補う（実ブラウザーでは不要）。
        // 署名検証（importKey・verify・digest）はここを通る。
        try {
          window.crypto.subtle = webcrypto.subtle;
        } catch { /* crypto が差し替え不可ならそのままにする */ }
        // 偽 GIS。initialize でコールバックと nonce を記録する。
        window.__gis = { callbacks: [], nonces: [] };
        window.google = { accounts: { id: {
          initialize(opts) {
            window.__gis.callbacks.push(opts.callback);
            window.__gis.nonces.push(opts.nonce);
          },
          renderButton(el) {
            el.innerHTML = '<button type="button" id="fake-gis">Fake Google ログイン</button>';
          },
        } } };
        // jsdom 31 は window.fetch を持たないため、Node の fetch で
        // 代用する。ページの fetch 呼び出し（/nonce・JWKS・apply）は
        // すべてここを通る。Cookie は簡易な保存庫で送受信する
        // （Secure 属性は課さない）。
        window.__fakeJwks = FAKE_JWKS;
        window.__applyBodies = [];
        window.__applyDelayMs = 0;
        window.__nonceShouldFail = false;
        window.__jwksDelayMs = 0;
        const cookieStore = new Map();
        const nodeFetch = fetch;
        window.fetch = async (input, init = {}) => {
          const rawUrl = typeof input === "string" ? input : input.url;
          const url = new URL(rawUrl, window.location.href).href;
          const method = (init.method || "GET").toUpperCase();
          if (url.includes("oauth2/v3/certs")) {
            if (window.__jwksDelayMs > 0) {
              await new Promise((r) => setTimeout(r, window.__jwksDelayMs));
            }
            return new Response(JSON.stringify(window.__fakeJwks), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (url.includes("/nonce") && window.__nonceShouldFail) {
            return new Response("{}", {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (url.includes("/platform/apply")) {
            try {
              window.__applyBodies.push(JSON.parse(init.body));
            } catch { /* 本体が読めなければ記録しない */ }
            if (window.__applyDelayMs > 0) {
              await new Promise((r) => setTimeout(r, window.__applyDelayMs));
            }
          }
          const headers = new Headers(init.headers || {});
          const cookies = [...cookieStore.values()].join("; ");
          if (cookies) headers.set("Cookie", cookies);
          const res = await nodeFetch(url, { ...init, method, headers });
          const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
          for (const sc of setCookies) {
            const pair = sc.split(";")[0].trim();
            const eq = pair.indexOf("=");
            if (eq > 0) cookieStore.set(pair.slice(0, eq), pair);
          }
          return res;
        };
      },
    });
    const { window } = dom;
    await sleep(500);
    if (jsdomErrors.length) throw new Error(`ページの実行エラー: ${jsdomErrors[0]}`);
    return { dom, window };
  }

  function el(window, id) {
    return window.document.getElementById(id);
  }
  function fillTrial(window, { kind, envId, fixed, trial }) {
    el(window, "trialKind").value = kind;
    el(window, "trialEnvId").value = envId;
    el(window, "fixedOneTime").value = fixed;
    el(window, "trialOneTime").value = trial;
    el(window, "accountConfirmed").checked = true;
  }
  async function prep(window) {
    const before = window.__gis.callbacks.length;
    el(window, "prepTrial").click();
    const ok = await waitFor(() => window.__gis.callbacks.length > before);
    if (!ok) throw new Error("準備で GIS コールバックが登録されませんでした");
    return window.__gis.callbacks.length - 1;
  }
  async function invokeCallback(window, index, nonce) {
    const token = mintToken(nonce);
    await window.__gis.callbacks[index]({ credential: token });
    await sleep(300);
  }
  function displayText(window) {
    return el(window, "display").textContent;
  }
  function logText(window) {
    return el(window, "log").textContent;
  }
  function sendDisabled(window) {
    return el(window, "sendApply").disabled;
  }
  function dispatchClick(window, id) {
    // 無効化されたボタンでもハンドラーを呼ぶ（合成イベント）。
    el(window, id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  }

  // ---- 場面1：古い GIS コールバックは新試行に混ざらない ----
  {
    const { window } = await makeDom();
    await fillTrial(window, {
      kind: "env-mismatch",
      envId: "wrong-env-A",
      fixed: "fixed-secret-A",
      trial: "fixed-secret-A",
    });
    const idxA = await prep(window);
    const nonceA = window.__gis.nonces[0];
    const trialIdA = el(window, "trialId").textContent;
    await fillTrial(window, {
      kind: "env-mismatch",
      envId: "wrong-env-B",
      fixed: "fixed-secret-B",
      trial: "fixed-secret-B",
    });
    const idxB = await prep(window);
    const nonceB = window.__gis.nonces[1];
    const trialIdB = el(window, "trialId").textContent;
    check("実画面: 準備ごとに試験 ID が新しくなる", trialIdA !== trialIdB, `${trialIdA} / ${trialIdB}`);
    await invokeCallback(window, idxA, nonceA);
    check(
      "実画面: 古いコールバックは表示を作らない",
      displayText(window).includes("まだ表示記録がありません"),
      displayText(window).slice(0, 120)
    );
    check("実画面: 古いコールバックは送信ボタンを有効化しない", sendDisabled(window));
    check(
      "実画面: 古いコールバックの破棄がログに残る",
      logText(window).includes("古い試行のコールバックを破棄しました"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 古いコールバックの finally は新試行の入力欄を消さない",
      el(window, "fixedOneTime").value === "fixed-secret-B" &&
        el(window, "trialOneTime").value === "fixed-secret-B" &&
        el(window, "trialEnvId").value === "wrong-env-B",
      "新試行の入力が消えたか変わった"
    );
    await invokeCallback(window, idxB, nonceB);
    const shown = await waitFor(() =>
      !displayText(window).includes("まだ表示記録がありません")
    );
    check("実画面: 新しいコールバックは新試行の表示を作る", shown);
    const parsed = JSON.parse(displayText(window));
    check(
      "実画面: 新しいコールバックの表示が新試行の値と一致する",
      parsed.trial_id === trialIdB && parsed.env_id === "wrong-env-B",
      displayText(window).slice(0, 200)
    );
    check("実画面: 新しいコールバックで送信ボタンが有効になる", !sendDisabled(window));
    check(
      "実画面: 成功時は一回値入力欄が消去される",
      el(window, "fixedOneTime").value === "" && el(window, "trialOneTime").value === ""
    );
    window.close();
  }

  // ---- 場面2：準備失敗（nonce 取得失敗）は試行を無効化する ----
  {
    const { window } = await makeDom();
    window.__nonceShouldFail = true;
    await fillTrial(window, {
      kind: "env-mismatch",
      envId: "wrong-env-A",
      fixed: "fixed-secret-A",
      trial: "fixed-secret-A",
    });
    el(window, "prepTrial").click();
    await sleep(800);
    check(
      "実画面: nonce 取得失敗で準備エラーがログに残る",
      logText(window).includes("nonce が取得できませんでした") || logText(window).includes("エラー:"),
      logText(window).slice(-300)
    );
    check("実画面: 準備失敗では送信ボタンが無効のまま", sendDisabled(window));
    check(
      "実画面: 準備失敗では表示が作られない",
      displayText(window).includes("まだ表示記録がありません")
    );
    window.__nonceShouldFail = false;
    const idxRetry = await prep(window);
    check(
      "実画面: 準備失敗のあと準備し直せる（新しいコールバックが登録される）",
      idxRetry === 0
    );
    window.close();
  }

  // ---- 場面3：環境条件の失敗は送信を不能にする ----
  {
    const { window } = await makeDom();
    await fillTrial(window, {
      kind: "env-mismatch",
      envId: FIXED_ENV_ID, // 正しい環境IDで環境不一致試験＝前提違反
      fixed: "fixed-secret-A",
      trial: "fixed-secret-A",
    });
    const idx = await prep(window);
    const nonce = window.__gis.nonces[0];
    await invokeCallback(window, idx, nonce);
    check(
      "実画面: 環境条件の失敗は準備エラーとして記録される",
      logText(window).includes("異なりません"),
      logText(window).slice(-300)
    );
    check("実画面: 環境条件の失敗では送信ボタンが無効のまま", sendDisabled(window));
    check(
      "実画面: 環境条件の失敗では表示が作られない",
      displayText(window).includes("まだ表示記録がありません")
    );
    check(
      "実画面: 現行の失敗時は一回値入力欄が消去される（環境条件の失敗）",
      el(window, "fixedOneTime").value === "" && el(window, "trialOneTime").value === ""
    );
    window.close();
  }

  // ---- 場面3b：現行の署名検証の失敗でも一回値入力欄が消去される ----
  {
    const { window } = await makeDom();
    await fillTrial(window, {
      kind: "env-mismatch",
      envId: "wrong-env-A",
      fixed: "fixed-secret-A",
      trial: "fixed-secret-A",
    });
    const idx = await prep(window);
    // 誤った nonce のトークンで署名検証を失敗させる。
    const wrongToken = mintToken("wrong-nonce-for-screen-test");
    await window.__gis.callbacks[idx]({ credential: wrongToken });
    await sleep(500);
    check(
      "実画面: 署名検証の失敗が準備エラーとして記録される",
      logText(window).includes("署名検証が通りませんでした"),
      logText(window).slice(-300)
    );
    check("実画面: 署名検証の失敗では送信ボタンが無効のまま", sendDisabled(window));
    check(
      "実画面: 現行の失敗時は一回値入力欄が消去される（署名検証の失敗）",
      el(window, "fixedOneTime").value === "" && el(window, "trialOneTime").value === ""
    );
    window.close();
  }

  // ---- 場面4：送信とログが対応し、二重送信されない。送信中の準備はできない ----
  {
    const { window } = await makeDom();
    window.__applyBodies = [];
    window.__applyDelayMs = 800;
    await fillTrial(window, {
      kind: "one-time-mismatch",
      envId: FIXED_ENV_ID,
      fixed: "fixed-secret-A",
      trial: "trial-secret-B",
    });
    const idx = await prep(window);
    const nonce = window.__gis.nonces[0];
    await invokeCallback(window, idx, nonce);
    const shown = await waitFor(() =>
      !displayText(window).includes("まだ表示記録がありません")
    );
    check("実画面: 送信前の表示ができる", shown);
    const disp = JSON.parse(displayText(window));
    const shownTrialId = el(window, "trialId").textContent;
    el(window, "sendApply").click();
    dispatchClick(window, "sendApply"); // 送信中の二重操作
    dispatchClick(window, "prepTrial"); // 送信中の準備
    await sleep(2000);
    const log4 = logText(window);
    check(
      "実画面: 送信中の準備は拒否される",
      log4.includes("送信中のため準備できません"),
      log4.slice(-300)
    );
    check("実画面: 二重送信されない（apply は1回だけ）", window.__applyBodies.length === 1, `bodies=${window.__applyBodies.length}`);
    const sent = window.__applyBodies[0] || {};
    check(
      "実画面: 送信した本体の env_id・purpose が表示と一致する",
      sent.env_id === disp.env_id && sent.purpose === disp.purpose,
      JSON.stringify({ sent_env: sent.env_id, disp_env: disp.env_id })
    );
    const m = log4.match(/試験ログ: (\{.*\})/);
    let entry = null;
    try {
      entry = m ? JSON.parse(m[1]) : null;
    } catch { /* 解析できなければ null のまま */ }
    check(
      "実画面: ログの試験エントリが表示の試験 ID と対応する",
      !!entry && entry.trial_id === disp.trial_id && entry.trial_id === shownTrialId,
      log4.slice(-400)
    );
    check(
      "実画面: ログの応答エラーは許可一覧の理由コードに正規化される",
      !!entry && typeof entry.response.error === "string" && entry.response.error !== "",
      log4.slice(-400)
    );
    window.__applyDelayMs = 0;
    const before = window.__gis.callbacks.length;
    el(window, "prepTrial").click();
    const reprepped = await waitFor(() => window.__gis.callbacks.length > before);
    const trialIdAfter = el(window, "trialId").textContent;
    check(
      "実画面: 送信完了後に準備し直せる（試験 ID が新しくなる）",
      reprepped && trialIdAfter !== shownTrialId,
      `${shownTrialId} / ${trialIdAfter}`
    );
    window.close();
  }

  // ---- 場面5：遅延した旧コールバックの finally は新試行の入力欄を消さない ----
  {
    const { window } = await makeDom();
    window.__jwksDelayMs = 800;
    await fillTrial(window, {
      kind: "env-mismatch",
      envId: "wrong-env-A",
      fixed: "fixed-secret-A",
      trial: "fixed-secret-A",
    });
    const idxA = await prep(window);
    const nonceA = window.__gis.nonces[0];
    // コールバック A を呼び、JWKS 取得の遅延中に試行 B の準備を始める。
    const tokenA = mintToken(nonceA);
    const pendingA = window.__gis.callbacks[idxA]({ credential: tokenA });
    await sleep(200); // A が JWKS 取得の待ちに入る
    await fillTrial(window, {
      kind: "env-mismatch",
      envId: "wrong-env-B",
      fixed: "fixed-secret-B",
      trial: "fixed-secret-B",
    });
    const idxB = await prep(window);
    const nonceB = window.__gis.nonces[1];
    // A の遅延 JWKS が返り、try 内の照合で return する。finally が動く。
    await pendingA;
    await sleep(300);
    check(
      "実画面: 遅延した旧コールバックの finally は新試行の入力欄を消さない",
      el(window, "fixedOneTime").value === "fixed-secret-B" &&
        el(window, "trialOneTime").value === "fixed-secret-B" &&
        el(window, "trialEnvId").value === "wrong-env-B",
      "新試行の入力が消えたか変わった"
    );
    check(
      "実画面: 遅延した旧コールバックの破棄がログに残る",
      logText(window).includes("古い試行のコールバックを破棄しました"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 遅延した旧コールバックは表示を作らない",
      displayText(window).includes("まだ表示記録がありません")
    );
    check("実画面: 遅延した旧コールバックは送信ボタンを有効化しない", sendDisabled(window));
    window.__jwksDelayMs = 0;
    await invokeCallback(window, idxB, nonceB);
    const shown = await waitFor(() =>
      !displayText(window).includes("まだ表示記録がありません")
    );
    check("実画面: 遅延のあと新しいコールバックは表示を作る", shown);
    window.close();
  }
  // ---- 場面6：S4 の消費済み試験は用途 bootstrap の表示を作り、送信できる ----
  {
    const { window } = await makeDom();
    window.__applyBodies = [];
    await fillTrial(window, {
      kind: "operation-consumed",
      envId: FIXED_ENV_ID,
      fixed: "fixed-secret-A",
      trial: "fixed-secret-A",
    });
    const idx = await prep(window);
    const nonce = window.__gis.nonces[0];
    await invokeCallback(window, idx, nonce);
    const shown = await waitFor(() =>
      !displayText(window).includes("まだ表示記録がありません")
    );
    check("実画面: S4 消費済み試験の表示ができる", shown);
    const parsed = JSON.parse(displayText(window));
    check(
      "実画面: S4 消費済み試験の表示は用途 bootstrap・正しい env_id になる",
      parsed.kind === "operation-consumed" &&
        parsed.purpose === "bootstrap" &&
        parsed.env_id === FIXED_ENV_ID &&
        parsed.one_time === "一致",
      displayText(window).slice(0, 300)
    );
    check("実画面: S4 消費済み試験で送信ボタンが有効になる", !sendDisabled(window));
    el(window, "sendApply").click();
    await sleep(1000);
    check("実画面: S4 消費済み試験の送信は1回だけ行われる", window.__applyBodies.length === 1, `bodies=${window.__applyBodies.length}`);
    const sent = window.__applyBodies[0] || {};
    check(
      "実画面: S4 消費済み試験の送信本体の用途が bootstrap になる",
      sent.purpose === "bootstrap" && sent.env_id === FIXED_ENV_ID,
      JSON.stringify({ purpose: sent.purpose, env_id: sent.env_id })
    );
    const m = logText(window).match(/試験ログ: (\{.*\})/);
    let entry = null;
    try {
      entry = m ? JSON.parse(m[1]) : null;
    } catch { /* 解析できなければ null のまま */ }
    check(
      "実画面: S4 消費済み試験のログが表示の試験 ID と対応する",
      !!entry && entry.trial_id === parsed.trial_id,
      logText(window).slice(-400)
    );
    window.close();
  }

  // ---- 場面7：S4 の初期化済み試験で環境IDが誤っていると送信不能になる ----
  {
    const { window } = await makeDom();
    await fillTrial(window, {
      kind: "already-initialized",
      envId: "wrong-env-A", // 正しい環境IDでなければ S4 の前提違反
      fixed: "fixed-secret-A",
      trial: "fixed-secret-A",
    });
    const idx = await prep(window);
    const nonce = window.__gis.nonces[0];
    await invokeCallback(window, idx, nonce);
    check(
      "実画面: S4 初期化済み試験の環境条件の失敗は準備エラーとして記録される",
      logText(window).includes("一致しません"),
      logText(window).slice(-300)
    );
    check("実画面: S4 初期化済み試験の環境条件の失敗では送信ボタンが無効のまま", sendDisabled(window));
    check(
      "実画面: S4 初期化済み試験の環境条件の失敗では表示が作られない",
      displayText(window).includes("まだ表示記録がありません")
    );
    check(
      "実画面: S4 の現行の失敗時は一回値入力欄が消去される（環境条件の失敗）",
      el(window, "fixedOneTime").value === "" && el(window, "trialOneTime").value === ""
    );
    window.close();
  }
} catch (e) {
  console.log("FAIL  実画面試験の実行中に例外:", e.message);
  results.push({ name: "実画面試験の実行", pass: false });
} finally {
  child.kill();
  await mf.dispose().catch(() => {});
}

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log(`\n===== 実画面結果: ${passed} PASS / ${failed.length} FAIL（全 ${results.length} 件） =====`);
if (failed.length) {
  for (const f of failed) console.log(`  FAIL: ${f.name}`);
  process.exit(1);
}
