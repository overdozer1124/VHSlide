// S9 負例試験専用画面（public/s9-negative.html）の実画面試験。
// 実行: node test/s9-negative.screen.mjs
// （npm run test:screen:s9 でも実行できる）
//
// 目的：文字列の存在確認ではなく、ページ自体を DOM で実行し、チェーン
// の gating・送信引数・捕捉トークンの非表示・ログの秘密不出力を検証
// する（Codex レビュー 6734391864 への対応）。実 Google・実 Worker は
// 使わない。
//
// 実行環境の制約：この VM では実ブラウザーの起動ができないため jsdom
// でページを実行する。jsdom 31 は `<script type="module">` を実行しな
// いため、試験ではページ内のインライン・モジュールの import を、配信
// 中の3つの検証モジュール（tools/subject-hash-verify.mjs・
// tools/trial-apply.mjs・tools/s9-negative.mjs）の実ソースを結合して
// 解決し、古典スクリプトとして実行する（trial-apply.screen.mjs と
// 同じ方式）。変換は import／export の除去だけで、文の内容は変えない。
// DOM・イベント・タイマー・非同期の交錯は実際のページと同じ経路で実行する。
// - GIS は偽物（beforeParse で window.google を差し替え、本物の
//   gsi/client は空の応答を返す）。
// - JWKS はインターセプターで偽物の公開鍵集合を返す。ID トークンは
//   その場で生成した RSA 鍵で署名した RS256 JWT で、ページ内の JWKS
//   署名検証を通る。
// - /admin/verify-only はインターセプターで要求を記録し、場面ごとに
//   用意した応答（401／200／403）または例外（応答なし）を返す。実
//   Worker へは送らない。
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
const SERVE_PORT = 8898;
const CLIENT_ID = "screen-s9-client-id.apps.googleusercontent.com";
const ENV_ID = "stage1-phase2-verification-local";
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
  durableObjectsPersist: path.join(ROOT, ".persist-screen-s9"),
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
      const r = await fetch(base + "/s9-negative");
      if (r.status === 200) return true;
    } catch { /* 起動待ち */ }
    await sleep(200);
  }
  return false;
}

try {
  const ready = await waitReady();
  check("実画面: serve-real が起動し、s9-negative 画面を返す", ready, childLog.slice(-400));
  if (!ready) throw new Error("serve-real が起動しませんでした");

  // ページと3つの検証モジュールの実ソースを取得し、インライン・
  // モジュールの import を解決して古典スクリプト化する。
  const pageHtml = await (await fetch(base + "/s9-negative")).text();
  const s9Js = await (await fetch(base + "/s9-negative.mjs")).text();
  const trialJs = await (await fetch(base + "/trial-apply.mjs")).text();
  const verifyJs = await (await fetch(base + "/subject-hash-verify.mjs")).text();
  const inlineModule = pageHtml.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!inlineModule) throw new Error("ページ内にインライン・モジュールが見つかりません");
  const classic =
    stripModule(verifyJs) + "\n" + stripModule(trialJs) + "\n" + stripModule(s9Js) + "\n" + stripModule(inlineModule[1]);
  // モジュールは既定で遅延実行される（本文の解析後に実行）が、古典
  // スクリプトはその場で実行される。古典スクリプトを </body> の直前に
  // 移し、本文の要素が存在してから実行されるようにする。
  const testHtml = pageHtml
    .replace(inlineModule[0], "")
    .replace("</body>", `<script>${classic}</script>\n</body>`);
  check("実画面: ページのモジュール import を解決できる", testHtml.includes("tamperSignature"));

  // 場面ごとの状態は各 window に置く（__verifyQueue・__verifyCalls・
  // __verifyShouldThrow）。fetch のポリフィルがそれを参照する。

  async function makeDom() {
    const vc = new VirtualConsole();
    const jsdomErrors = [];
    vc.on("jsdomError", (e) => jsdomErrors.push(String(e && e.detail ? e.detail : e)));
    const dom = new JSDOM(testHtml, {
      url: base + "/s9-negative",
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
        // 代用する。/admin/verify-only だけは場面ごとの応答を返し、
        // それ以外（/nonce・JWKS）はここを通る。Cookie は簡易な保存庫
        // で送受信する（Secure 属性は課さない）。
        window.__fakeJwks = FAKE_JWKS;
        window.__verifyQueue = [];
        window.__verifyCalls = [];
        window.__verifyShouldThrow = false;
        // 遅延・順序逆転の場面で使う試験用の計測器。/nonce の呼び出し
        // 回数と応答の遅延（ms）、およびブラウザーCookie の保存庫を
        // 試験から読めるようにする（画面本体の変更ではない）。
        window.__nonceCalls = 0;
        window.__nonceDelayMs = 0;
        const cookieStore = new Map();
        window.__cookieStore = cookieStore;
        const nodeFetch = fetch;
        window.fetch = async (input, init = {}) => {
          const rawUrl = typeof input === "string" ? input : input.url;
          const url = new URL(rawUrl, window.location.href).href;
          const method = (init.method || "GET").toUpperCase();
          if (url.includes("oauth2/v3/certs")) {
            return new Response(JSON.stringify(window.__fakeJwks), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (url.includes("/admin/verify-only")) {
            let idToken = null;
            try {
              idToken = JSON.parse(init.body).id_token;
            } catch { /* 本体が読めなければ null のまま */ }
            window.__verifyCalls.push({
              url,
              method,
              credentials: init.credentials,
              redirect: init.redirect,
              contentType: (init.headers || {})["content-type"],
              hasIdToken: typeof idToken === "string" && idToken.length > 0,
              idToken,
              // 送信時点のブラウザーCookie（現行試行の文脈で送られるか）。
              cookie: [...cookieStore.values()].join("; "),
            });
            if (window.__verifyShouldThrow) {
              throw new Error("network down (test)");
            }
            const next = window.__verifyQueue.shift() || { status: 500, error: "unexpected_error" };
            const body = next.status === 200 ? { ok: true } : { error: next.error };
            return new Response(JSON.stringify(body), {
              status: next.status,
              headers: { "Content-Type": "application/json" },
            });
          }
          // /nonce の呼び出しを数え、試験で指定した遅延を入れる。
          // 遅延は fetch の呼び出し後・応答の受信前に起きるため、要求
          // 開始時刻起点の実装では期限の起点は遅延の影響を受けない
          // （受信時刻起点の旧実装では遅延分だけ後ろにずれる）。
          if (url.includes("/nonce")) {
            window.__nonceCalls += 1;
            if (window.__nonceDelayMs) await sleep(window.__nonceDelayMs);
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
  function logText(window) {
    return el(window, "log").textContent;
  }
  function stateText(window) {
    return el(window, "state").textContent;
  }
  function dispatchClick(window, id) {
    // 無効化されたボタンでもハンドラーを呼ぶ（合成イベント）。
    el(window, id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  }
  async function prep(window, chain) {
    el(window, "chainKind").value = chain;
    el(window, "accountConfirmed").checked = true;
    const before = window.__gis.callbacks.length;
    el(window, "prepS9").click();
    const ok = await waitFor(() => window.__gis.callbacks.length > before);
    if (!ok) throw new Error("準備で GIS コールバックが登録されませんでした");
    return window.__gis.callbacks.length - 1;
  }
  async function invokeCallback(window, index, nonce) {
    const token = mintToken(nonce);
    await window.__gis.callbacks[index]({ credential: token });
    await sleep(300);
    return token;
  }
  function lastLogEntry(window) {
    const matches = [...logText(window).matchAll(/試験ログ: (\{.*\})/g)];
    if (!matches.length) return null;
    try {
      return JSON.parse(matches[matches.length - 1][1]);
    } catch {
      return null;
    }
  }

  // ---- 場面1：初期状態。URL 入力欄がなく、ステップボタンは無効 ----
  {
    const { window } = await makeDom();
    const textInputs = window.document.querySelectorAll('input[type="text"], input[type="url"]');
    check("実画面: URL・テキスト入力欄がない", textInputs.length === 0, `inputs=${textInputs.length}`);
    check(
      "実画面: 初期状態ではステップボタンがすべて無効",
      el(window, "sendTampered").disabled &&
        el(window, "sendNoCookie").disabled &&
        el(window, "sendControl").disabled &&
        el(window, "sendResend").disabled,
      "いずれかのステップボタンが有効"
    );
    check("実画面: 初期状態では準備ボタンが有効", !el(window, "prepS9").disabled);
    check(
      "実画面: チェーン選択に A・B がある",
      el(window, "chainKind").value === "A" &&
        [...el(window, "chainKind").options].map((o) => o.value).join(",") === "A,B"
    );
    check(
      "実画面: 先行実測の参照範囲と未実証の注記がある",
      window.document.body.textContent.includes("Cookie属性") &&
        window.document.body.textContent.includes("Cookie返送") &&
        window.document.body.textContent.includes("実 Google nonce 一致") &&
        window.document.body.textContent.includes("未実証") &&
        window.document.body.textContent.includes("Origin の境界")
    );
    window.close();
  }

  // ---- 場面2：チェーンA の正常な進行。tampered → control → resend ----
  {
    const { window } = await makeDom();
    const idx = await prep(window, "A");
    const nonce = window.__gis.nonces[0];
    const token = await invokeCallback(window, idx, nonce);
    const trialId = el(window, "trialId").textContent;
    check(
      "実画面: 捕捉後に署名検証 ok がログに残る",
      logText(window).includes("署名検証 -> ok"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 捕捉後は tampered だけが有効（control・resend は無効）",
      !el(window, "sendTampered").disabled &&
        el(window, "sendControl").disabled &&
        el(window, "sendResend").disabled &&
        el(window, "sendNoCookie").disabled
    );
    check(
      "実画面: 状態表示の次のステップが tampered になる",
      stateText(window).includes('"next_step": "tampered"'),
      stateText(window).slice(0, 200)
    );
    // nonce 期限の表示：発行時刻＋5分が期限になる（全角括弧の数値で確認）。
    const nums = [...el(window, "nonceInfo").textContent.matchAll(/（(\d+)）/g)].map((m) => Number(m[1]));
    check(
      "実画面: nonce 期限の表示が発行時刻＋5分になる",
      nums.length === 2 && nums[1] - nums[0] === 300000,
      el(window, "nonceInfo").textContent
    );
    window.__verifyQueue = [
      { status: 401, error: "tokeninfo_rejected" },
      { status: 200, error: null },
      { status: 403, error: "nonce_replayed" },
    ];
    el(window, "sendTampered").click();
    await sleep(800);
    check("実画面: tampered の送信が1回だけ行われる", window.__verifyCalls.length === 1, `calls=${window.__verifyCalls.length}`);
    const call1 = window.__verifyCalls[0] || {};
    check(
      "実画面: tampered の送信先が固定パス POST /admin/verify-only になる",
      call1.url === base + "/admin/verify-only" && call1.method === "POST",
      JSON.stringify({ url: call1.url, method: call1.method })
    );
    check(
      "実画面: 送信に redirect:\"manual\" と application/json が含まれる",
      call1.redirect === "manual" && call1.contentType === "application/json",
      JSON.stringify({ redirect: call1.redirect, contentType: call1.contentType })
    );
    check(
      "実画面: tampered の送信は credentials: include になる",
      call1.credentials === "include",
      `credentials=${call1.credentials}`
    );
    check(
      "実画面: tampered の送信本体に id_token が含まれ、元トークンと異なる",
      call1.hasIdToken && call1.idToken !== token,
      "本体の id_token が元トークンと同じか欠けている"
    );
    const entry1 = lastLogEntry(window);
    check(
      "実画面: tampered のログが表示の試験 ID と対応する",
      !!entry1 && entry1.trial_id === trialId && entry1.chain === "A" &&
        entry1.step === "tampered" && entry1.response.status === 401 &&
        entry1.response.error === "tokeninfo_rejected",
      logText(window).slice(-400)
    );
    check(
      "実画面: tampered の後、control が有効になり resend はまだ無効",
      !el(window, "sendControl").disabled && el(window, "sendResend").disabled
    );
    el(window, "sendControl").click();
    await sleep(800);
    check("実画面: control の送信が行われる", window.__verifyCalls.length === 2, `calls=${window.__verifyCalls.length}`);
    const call2 = window.__verifyCalls[1] || {};
    check(
      "実画面: control の送信は元のトークンそのものになる",
      call2.idToken === token,
      "control の本体が元のトークンと異なる"
    );
    check(
      "実画面: control の送信も redirect:\"manual\"・固定パスになる",
      call2.redirect === "manual" && call2.url === base + "/admin/verify-only"
    );
    const entry2 = lastLogEntry(window);
    check(
      "実画面: control のログが 200・error null になる",
      !!entry2 && entry2.step === "control" && entry2.response.status === 200 &&
        entry2.response.error === null,
      logText(window).slice(-400)
    );
    check(
      "実画面: control の 200 の後、resend が有効になる",
      !el(window, "sendResend").disabled
    );
    el(window, "sendResend").click();
    await sleep(800);
    check("実画面: resend の送信が行われる", window.__verifyCalls.length === 3, `calls=${window.__verifyCalls.length}`);
    const call3 = window.__verifyCalls[2] || {};
    check(
      "実画面: resend の送信は元のトークンそのものになる",
      call3.idToken === token,
      "resend の本体が元のトークンと異なる"
    );
    const entry3 = lastLogEntry(window);
    check(
      "実画面: resend のログが 403 nonce_replayed になる",
      !!entry3 && entry3.step === "resend" && entry3.response.status === 403 &&
        entry3.response.error === "nonce_replayed",
      logText(window).slice(-400)
    );
    check(
      "実画面: チェーン完了後はステップボタンがすべて無効になる",
      el(window, "sendTampered").disabled &&
        el(window, "sendNoCookie").disabled &&
        el(window, "sendControl").disabled &&
        el(window, "sendResend").disabled
    );
    check(
      "実画面: チェーン完了でトークン消去がログに残る",
      logText(window).includes("トークンを消去しました（chain-completed）"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 画面の表示に捕捉したトークンが現れない",
      !window.document.body.textContent.includes(token),
      "画面の表示にトークンが含まれている"
    );
    check(
      "実画面: ログに捕捉したトークン・nonce が含まれない",
      !logText(window).includes(token) && !logText(window).includes(nonce),
      "ログにトークンまたは nonce が含まれている"
    );
    check(
      "実画面: 画面の表示に nonce の値が現れない",
      !window.document.body.textContent.includes(nonce),
      "画面の表示に nonce が含まれている"
    );
    window.close();
  }

  // ---- 場面3：チェーンB の進行。no-cookie は credentials: omit ----
  {
    const { window } = await makeDom();
    const idx = await prep(window, "B");
    const nonce = window.__gis.nonces[0];
    const token = await invokeCallback(window, idx, nonce);
    const trialId = el(window, "trialId").textContent;
    check(
      "実画面: チェーンB では no-cookie だけが最初に有効",
      !el(window, "sendNoCookie").disabled &&
        el(window, "sendTampered").disabled &&
        el(window, "sendControl").disabled &&
        el(window, "sendResend").disabled
    );
    window.__verifyQueue = [
      { status: 403, error: "nonce_context_mismatch" },
      { status: 200, error: null },
    ];
    el(window, "sendNoCookie").click();
    await sleep(800);
    check("実画面: no-cookie の送信が1回だけ行われる", window.__verifyCalls.length === 1, `calls=${window.__verifyCalls.length}`);
    const call1 = window.__verifyCalls[0] || {};
    check(
      "実画面: no-cookie の送信は credentials: omit になる",
      call1.credentials === "omit",
      `credentials=${call1.credentials}`
    );
    check(
      "実画面: no-cookie の送信も固定パス・redirect:\"manual\" になる",
      call1.url === base + "/admin/verify-only" && call1.redirect === "manual"
    );
    check(
      "実画面: no-cookie の送信本体に id_token が含まれる",
      call1.hasIdToken && call1.idToken === token,
      "本体の id_token が元のトークンと異なる"
    );
    const entry1 = lastLogEntry(window);
    check(
      "実画面: no-cookie のログが 403 nonce_context_mismatch になる",
      !!entry1 && entry1.trial_id === trialId && entry1.chain === "B" &&
        entry1.step === "no-cookie" && entry1.response.status === 403 &&
        entry1.response.error === "nonce_context_mismatch",
      logText(window).slice(-400)
    );
    check(
      "実画面: no-cookie の後、control が有効になる",
      !el(window, "sendControl").disabled
    );
    el(window, "sendControl").click();
    await sleep(800);
    check("実画面: チェーンB の control の送信が行われる", window.__verifyCalls.length === 2, `calls=${window.__verifyCalls.length}`);
    check(
      "実画面: チェーンB の完了後はステップボタンがすべて無効になる",
      el(window, "sendTampered").disabled &&
        el(window, "sendNoCookie").disabled &&
        el(window, "sendControl").disabled &&
        el(window, "sendResend").disabled
    );
    check(
      "実画面: チェーンB のログにトークン・nonce が含まれない",
      !logText(window).includes(token) && !logText(window).includes(nonce)
    );
    window.close();
  }

  // ---- 場面4：期待外れの応答でチェーンが停止し、後続は送れない ----
  {
    const { window } = await makeDom();
    const idx = await prep(window, "A");
    const nonce = window.__gis.nonces[0];
    await invokeCallback(window, idx, nonce);
    // tampered に 200 が返る（期待は 401）。
    window.__verifyQueue = [{ status: 200, error: null }];
    el(window, "sendTampered").click();
    await sleep(800);
    check("実画面: 期待外れの応答でも送信は1回だけ行われる", window.__verifyCalls.length === 1, `calls=${window.__verifyCalls.length}`);
    check(
      "実画面: 期待外れの応答でチェーン停止がログに残る",
      logText(window).includes("期待と異なる応答のためチェーンを停止します（tampered）"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 期待外れの応答でトークン消去がログに残る",
      logText(window).includes("トークンを消去しました（chain-halted）"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 停止後はステップボタンがすべて無効になる",
      el(window, "sendTampered").disabled &&
        el(window, "sendNoCookie").disabled &&
        el(window, "sendControl").disabled &&
        el(window, "sendResend").disabled
    );
    // 無効化された control ボタンを合成イベントで呼んでも送信されない。
    dispatchClick(window, "sendControl");
    await sleep(500);
    check("実画面: 停止後に control を呼んでも送信されない", window.__verifyCalls.length === 1, `calls=${window.__verifyCalls.length}`);
    window.close();
  }

  // ---- 場面5：レスポンスなし（fetch 例外）は状態未確定で停止し、再送しない ----
  {
    const { window } = await makeDom();
    const idx = await prep(window, "A");
    const nonce = window.__gis.nonces[0];
    await invokeCallback(window, idx, nonce);
    window.__verifyShouldThrow = true;
    el(window, "sendTampered").click();
    await sleep(800);
    check(
      "実画面: レスポンスなしで「応答なし：状態未確定、再送しません」がログに残る",
      logText(window).includes("応答なし：状態未確定、再送しません"),
      logText(window).slice(-300)
    );
    check(
      "実画面: レスポンスなしでトークン消去がログに残る",
      logText(window).includes("トークンを消去しました（chain-halted）"),
      logText(window).slice(-300)
    );
    check(
      "実画面: レスポンスなしでは試験ログが作られない（応答がないため）",
      !logText(window).includes("試験ログ:"),
      logText(window).slice(-300)
    );
    check(
      "実画面: レスポンスなしの後はステップボタンがすべて無効になる",
      el(window, "sendTampered").disabled &&
        el(window, "sendNoCookie").disabled &&
        el(window, "sendControl").disabled &&
        el(window, "sendResend").disabled
    );
    // 再送を試みても送信されない（同じステップの再呼出しも不可）。
    // 最初の試みは記録だけ残して fetch が例外になったため、呼び出し
    // 記録は1件のままである（再送が起きれば2件になる）。
    window.__verifyShouldThrow = false;
    window.__verifyQueue = [{ status: 401, error: "tokeninfo_rejected" }];
    const callsBeforeResend = window.__verifyCalls.length;
    dispatchClick(window, "sendTampered");
    await sleep(500);
    check(
      "実画面: レスポンスなしの後に再送しても送信されない",
      window.__verifyCalls.length === callsBeforeResend,
      `calls=${window.__verifyCalls.length} (before=${callsBeforeResend})`
    );
    window.close();
  }

  // ---- 場面6：古い GIS コールバックは新試行に混ざらない ----
  {
    const { window } = await makeDom();
    const idxA = await prep(window, "A");
    const nonceA = window.__gis.nonces[0];
    const trialIdA = el(window, "trialId").textContent;
    const idxB = await prep(window, "A");
    const nonceB = window.__gis.nonces[1];
    const trialIdB = el(window, "trialId").textContent;
    check("実画面: 準備ごとに試験 ID が新しくなる", trialIdA !== trialIdB, `${trialIdA} / ${trialIdB}`);
    await invokeCallback(window, idxA, nonceA);
    check(
      "実画面: 古いコールバックは捕捉しない（tampered が無効のまま）",
      el(window, "sendTampered").disabled,
      "古いコールバックで送信ボタンが有効になった"
    );
    check(
      "実画面: 古いコールバックの破棄がログに残る",
      logText(window).includes("古い試行のコールバックを破棄しました"),
      logText(window).slice(-300)
    );
    await invokeCallback(window, idxB, nonceB);
    check(
      "実画面: 新しいコールバックで捕捉できる（tampered が有効になる）",
      !el(window, "sendTampered").disabled
    );
    window.close();
  }

  // ---- 場面7：署名検証の失敗は試行を失敗させ、トークンを保持しない ----
  {
    const { window } = await makeDom();
    const idx = await prep(window, "A");
    // 誤った nonce のトークンで署名検証を失敗させる。
    const wrongToken = mintToken("wrong-nonce-for-s9-screen-test");
    await window.__gis.callbacks[idx]({ credential: wrongToken });
    await sleep(500);
    check(
      "実画面: 署名検証の失敗がログに残る",
      logText(window).includes("署名検証が通りませんでした"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 署名検証の失敗ではステップボタンが無効のまま",
      el(window, "sendTampered").disabled &&
        el(window, "sendControl").disabled &&
        el(window, "sendResend").disabled
    );
    check(
      "実画面: 署名検証の失敗では失敗したトークンが画面・ログに出ない",
      !window.document.body.textContent.includes(wrongToken) &&
        !logText(window).includes(wrongToken)
    );
    // 失敗した試行のあと、新しい試行を開始できる。
    el(window, "newTrial").click();
    await sleep(200);
    check(
      "実画面: 失敗のあと新しい試行を開始できる（準備ボタンが有効）",
      !el(window, "prepS9").disabled
    );
    window.close();
  }
  // ---- 場面8：遅延した /nonce 応答。期限の起点は要求開始時刻で、
  // 取得中の再準備・破棄は拒否され、Cookie は現行試行の1件だけになる
  // （Codex レビュー 6734640413 の指摘2）。----
  {
    const { window } = await makeDom();
    window.__nonceDelayMs = 1500;
    const t0 = Date.now();
    el(window, "chainKind").value = "A";
    el(window, "accountConfirmed").checked = true;
    const callbacksBefore = window.__gis.callbacks.length;
    el(window, "prepS9").click();
    const trialIdEarly = el(window, "trialId").textContent;
    check(
      "実画面: nonce 取得中は準備ボタンが無効になる",
      el(window, "prepS9").disabled,
      "取得中に準備ボタンが有効のまま"
    );
    check(
      "実画面: nonce 取得中は破棄・新規試行ボタンが無効になる",
      el(window, "discardTrial").disabled && el(window, "newTrial").disabled,
      "取得中に破棄または新規試行ボタンが有効のまま"
    );
    // 無効化されたボタンでも合成イベントでハンドラーを呼ぶ。取得中の
    // 再準備・破棄は拒否され、新しい試行は始まらない。
    dispatchClick(window, "prepS9");
    dispatchClick(window, "discardTrial");
    dispatchClick(window, "newTrial");
    await sleep(300);
    check(
      "実画面: 取得中の再準備は拒否され /nonce は1回だけ呼ばれる",
      window.__nonceCalls === 1,
      `calls=${window.__nonceCalls}`
    );
    check(
      "実画面: 取得中の再準備・破棄の拒否がログに残る",
      logText(window).includes("nonce 取得中のため準備できません") &&
        logText(window).includes("nonce 取得中のため破棄できません"),
      logText(window).slice(-300)
    );
    const ok = await waitFor(() => window.__gis.callbacks.length > callbacksBefore);
    check("実画面: 遅延した /nonce 応答で GIS コールバックが登録される", ok);
    check(
      "実画面: 遅延した応答で試行 ID が変わらない（旧応答が新試行を作らない）",
      el(window, "trialId").textContent === trialIdEarly,
      `${trialIdEarly} -> ${el(window, "trialId").textContent}`
    );
    const nums = [...el(window, "nonceInfo").textContent.matchAll(/（(\d+)）/g)].map((m) => Number(m[1]));
    check(
      "実画面: 遅延した応答でも nonce 期限の表示が発行時刻＋5分になる",
      nums.length === 2 && nums[1] - nums[0] === 300000,
      el(window, "nonceInfo").textContent
    );
    check(
      "実画面: nonce 期限の起点は要求開始時刻で、応答受信時刻ではない（遅延1500msに対し開始からのずれが1000ms未満）",
      nums.length === 2 && nums[0] >= t0 - 1000 && nums[0] - t0 < 1000,
      `issued-t0=${nums.length === 2 ? nums[0] - t0 : "?"}, info=${el(window, "nonceInfo").textContent}`
    );
    check(
      "実画面: Cookie 保存庫の nonce context は1件だけ（遅延応答の上書きがない）",
      window.__cookieStore.size === 1 && window.__cookieStore.has("op2_nonce_ctx"),
      [...window.__cookieStore.keys()].join(",")
    );
    // 遅延した応答で捕捉し、対照まで送る。現行試行の Cookie 文脈で
    // 送られることを確認する。
    const idx = window.__gis.callbacks.length - 1;
    const nonce = window.__gis.nonces[idx];
    const token = await invokeCallback(window, idx, nonce);
    check(
      "実画面: 遅延した応答の捕捉後も tampered が有効になる",
      !el(window, "sendTampered").disabled,
      "遅延した応答の捕捉で送信ボタンが有効にならない"
    );
    window.__verifyQueue = [
      { status: 401, error: "tokeninfo_rejected" },
      { status: 200, error: null },
    ];
    el(window, "sendTampered").click();
    await sleep(800);
    el(window, "sendControl").click();
    await sleep(800);
    check("実画面: 遅延した応答の試行でも control の送信が行われる", window.__verifyCalls.length === 2, `calls=${window.__verifyCalls.length}`);
    const controlCall = window.__verifyCalls[1] || {};
    check(
      "実画面: 対照の送信に現行試行の nonce context Cookie が付く",
      typeof controlCall.cookie === "string" && controlCall.cookie.includes("op2_nonce_ctx="),
      `cookie=${controlCall.cookie}`
    );
    check(
      "実画面: 遅延した応答の試行のログにトークン・nonce が含まれない",
      !logText(window).includes(token) && !logText(window).includes(nonce)
    );
    window.__nonceDelayMs = 0;
    window.close();
  }

  // ---- 場面9：Cookie の証拠の区別。返送は実証済み、属性は未確認と
  // 画面に明記される（Codex レビュー 6734640413 の指摘3）。----
  {
    const { window } = await makeDom();
    const bodyText = window.document.body.textContent;
    check(
      "実画面: Cookie返送が S9 正常系 seq 632/634 で実証済みと明記される",
      bodyText.includes("Cookie返送") &&
        bodyText.includes("seq 632/634") &&
        bodyText.includes("200 ok") &&
        bodyText.includes("nonce_context_mismatch"),
      "Cookie返送の実証の注記が見つからない"
    );
    check(
      "実画面: Cookie属性の実環境での実測元がないことが未確認と明記される",
      bodyText.includes("Cookie属性") &&
        bodyText.includes("実環境では未確認") &&
        bodyText.includes("Set-Cookie"),
      "Cookie属性の未確認の注記が見つからない"
    );
    check(
      "実画面: Cookie属性を実測したものとして扱わないことが明記される",
      bodyText.includes("属性値を実測したものとして扱いません"),
      "属性値の扱いの注記が見つからない"
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
