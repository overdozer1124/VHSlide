// S5 並行試験専用画面（public/s5-apply.html）の実画面試験。
// 実行: node test/s5-apply.screen.mjs
// （npm run test:screen:s5 でも実行できる）
//
// 目的：文字列の存在確認ではなく、ページ自体を DOM で実行し、6スロット
// の準備・送信・失敗・二重操作のふるまいを検証する。実 Google・実 Worker
// は使わない。
//
// 実行環境の制約：この VM では実ブラウザーの起動ができない（管理下の
// Chrome は直接起動できず、Playwright 用ブラウザーの取得も承認待ちで
// 止まる）。そのため jsdom でページを実行する。jsdom 31 は
// `<script type="module">` を実行しないため、試験ではページ内の
// インライン・モジュールの import を、配信中の3つの検証モジュール
// （tools/s5-apply.mjs・tools/trial-apply.mjs・
// tools/subject-hash-verify.mjs）の実ソースを結合して解決し、古典
// スクリプトとして実行する。変換は import／export の除去だけで、文の
// 内容は変えない。DOM・イベント・タイマー・非同期の交錯は実際のページ
// と同じ経路で実行する。なお3つのモジュールは `fail` という同名の関数
// を持つが、内容は同一である（片方がもう片方を上書きしてもふるまいは
// 変わらない）。
// - GIS は偽物（beforeParse で window.google を差し替え、本物の
//   gsi/client は空の応答を返す）。
// - JWKS はインターセプターで偽物の公開鍵集合を返す。ID トークンは
//   その場で生成した RSA 鍵で署名した RS256 JWT で、ページ内の JWKS
//   署名検証を通る。
// - /s5/nonces・/s5/send は提供サーバー（serve-real.mjs）の実経路を
//   通す。送信器（tools/s5-sender.mjs）は本物であり、中継先は
//   local-mock の通常ビルドである。通常ビルドに /platform/apply は
//   ないため、6件の応答はすべて 404 になる。画面の送信・ログ対応の
//   確認には十分であり、201 の成功経路と並行消費の判定は送信器の
//   試験（test/s5-sender.test.mjs）で一時ビルド相手に確認する。
//   実環境の 201・409 の観測は実環境で行う。
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
const SERVE_PORT = 8896;
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

function tokenNonceClaim(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.nonce || null;
  } catch {
    return null;
  }
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
  durableObjectsPersist: path.join(ROOT, ".persist-screen-s5"),
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
      const r = await fetch(base + "/s5-apply");
      if (r.status === 200) return true;
    } catch { /* 起動待ち */ }
    await sleep(200);
  }
  return false;
}

try {
  const ready = await waitReady();
  check("実画面: serve-real が起動し、s5-apply 画面を返す", ready, childLog.slice(-400));
  if (!ready) throw new Error("serve-real が起動しませんでした");

  // ページと3つの検証モジュールの実ソースを取得し、インライン・
  // モジュールの import を解決して古典スクリプト化する。
  const pageHtml = await (await fetch(base + "/s5-apply")).text();
  const s5Js = await (await fetch(base + "/s5-apply.mjs")).text();
  const trialJs = await (await fetch(base + "/trial-apply.mjs")).text();
  const verifyJs = await (await fetch(base + "/subject-hash-verify.mjs")).text();
  const inlineModule = pageHtml.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!inlineModule) throw new Error("ページ内にインライン・モジュールが見つかりません");
  const classic = stripModule(verifyJs) + "\n" + stripModule(trialJs) + "\n" + stripModule(s5Js) + "\n" + stripModule(inlineModule[1]);
  // モジュールは既定で遅延実行される（本文の解析後に実行）が、古典
  // スクリプトはその場で実行される。古典スクリプトを </body> の直前に
  // 移し、本文の要素が存在してから実行されるようにする。
  const testHtml = pageHtml
    .replace(inlineModule[0], "")
    .replace("</body>", `<script>${classic}</script>\n</body>`);
  check("実画面: ページのモジュール import を解決できる", testHtml.includes("buildS5Requests"));

  // 場面ごとの状態は各 window に置く（__s5SendPosts・
  // __noncesShouldFail）。fetch のポリフィルがそれを参照する。

  async function makeDom() {
    const vc = new VirtualConsole();
    const jsdomErrors = [];
    vc.on("jsdomError", (e) => jsdomErrors.push(String(e && e.detail ? e.detail : e)));
    const dom = new JSDOM(testHtml, {
      url: base + "/s5-apply",
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
        // 代用する。ページの fetch 呼び出し（JWKS・/s5/nonces・
        // /s5/send）はすべてここを通る。Cookie は簡易な保存庫で送受信
        // する（Secure 属性は課さない）。
        window.__fakeJwks = FAKE_JWKS;
        window.__s5SendPosts = [];
        window.__s5NoncesRequests = [];
        window.__s5SendHeaders = [];
        window.__noncesShouldFail = false;
        const cookieStore = new Map();
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
          // /s5/nonces の呼び出しを記録する（セッション・試行 ID の
          // 送信確認用）。試験単位のセッションは、配信された画面に
          // 差し込まれた値であり、値はここでは表示しない。
          if (url.includes("/s5/nonces")) {
            const reqHeaders = new Headers(init.headers || {});
            window.__s5NoncesRequests.push({
              url,
              session: reqHeaders.get("x-s5-session"),
            });
          }
          if (url.includes("/s5/nonces") && window.__noncesShouldFail) {
            return new Response(JSON.stringify({ error: "s5_nonce_issuance_failed" }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (url.includes("/s5/send")) {
            try {
              window.__s5SendPosts.push(JSON.parse(init.body));
              window.__s5SendHeaders.push(new Headers(init.headers || {}).get("x-s5-session"));
            } catch { /* 本体が読めなければ記録しない */ }
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
  function displayText(window) {
    return el(window, "display").textContent;
  }
  function logText(window) {
    return el(window, "log").textContent;
  }
  function sendDisabled(window) {
    return el(window, "sendS5").disabled;
  }
  function dispatchClick(window, id) {
    // 無効化されたボタンでもハンドラーを呼ぶ（合成イベント）。
    el(window, id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  }

  // 6スロット分の GIS ログインを順に行う。ページはスロットごとに
  // initialize し直してボタンを描き直すため、コールバックの登録を待って
  // から各スロットのトークンを渡す。startIndex は、古い試行のコール
  // バックが配列に残っている場合に、新しい試行のコールバックの開始位置
  // を指定する（場面2）。
  async function signInAllSlots(window, startIndex = 0) {
    for (let slot = 0; slot < 6; slot++) {
      const idx = startIndex + slot;
      const ok = await waitFor(() => window.__gis.callbacks.length > idx);
      if (!ok) throw new Error(`スロット ${slot + 1}/6 のログインボタンが表示されませんでした`);
      const nonce = window.__gis.nonces[idx];
      const token = mintToken(nonce);
      await window.__gis.callbacks[idx]({ credential: token });
      await sleep(300);
    }
  }

  // ---- 場面1：6スロットの準備から並行送信・ログ対応まで ----
  {
    const { window } = await makeDom();
    window.__s5SendPosts = [];
    el(window, "fixedOneTime").value = "fixed-secret-s5";
    el(window, "accountConfirmed").checked = true;
    el(window, "prepS5").click();
    await signInAllSlots(window);
    const shown = await waitFor(() =>
      !displayText(window).includes("まだ表示記録がありません")
    );
    check("実画面: 6スロット揃うと送信直前の表示ができる", shown);
    const displays = JSON.parse(displayText(window));
    check("実画面: 送信直前の表示は6件分ある", Array.isArray(displays) && displays.length === 6, `len=${displays && displays.length}`);
    const trialId = el(window, "trialId").textContent;
    check(
      "実画面: 6件の表示は条件が等しく、スロット番号が順序どおりになる",
      displays.every((d, i) =>
        d.trial_id === trialId && d.slot === i &&
        d.env_id === FIXED_ENV_ID && d.purpose === "full-replace" &&
        d.one_time === "固定の一回値を6件で共用" &&
        d.nonce === "発行済み・他スロットと異なる"
      ),
      displayText(window).slice(0, 400)
    );
    check(
      "実画面: 6スロット揃うと送信ボタンが有効になる",
      !sendDisabled(window)
    );
    check(
      "実画面: 6スロット揃うと一回値入力欄が消去される",
      el(window, "fixedOneTime").value === ""
    );
    check(
      "実画面: スロットの状態表示が6件とも取得済みになる",
      el(window, "slotStatus").textContent.includes("スロット 6/6: トークン取得済み・署名検証通過")
    );
    el(window, "sendS5").click();
    const logged = await waitFor(() => logText(window).includes("試験ログ:"));
    check("実画面: 並行送信後に試験ログが記録される", logged);
    check(
      "実画面: 並行送信は1回だけ行われる",
      window.__s5SendPosts.length === 1,
      `posts=${window.__s5SendPosts.length}`
    );
    const sent = window.__s5SendPosts[0] || {};
    const requests = sent.requests || [];
    check("実画面: 送信指示には6件の要求が含まれる", requests.length === 6, `len=${requests.length}`);
    check(
      "実画面: 送信指示の6件は env_id・purpose・一回値が等しい",
      requests.length === 6 &&
        requests.every((r) =>
          r.env_id === FIXED_ENV_ID && r.purpose === "full-replace" &&
          r.one_time_value === requests[0].one_time_value
        )
    );
    const tokenNonces = requests.map((r) => tokenNonceClaim(r.id_token));
    check(
      "実画面: 送信指示の6件のトークンの nonce はすべて異なる",
      requests.length === 6 &&
        tokenNonces.every(Boolean) && new Set(tokenNonces).size === 6,
      `nonces=${tokenNonces.join(",")}`
    );
    // 画面から /s5/nonces・/s5/send への呼び出しが、試験単位の
    // セッションとその試行の ID を示していること（呼び出し元境界の
    // 画面側の配線）。セッションの値は表示しない（一致の真偽だけ）。
    const pageSession = (testHtml.match(/const S5_SESSION = "([^"]+)"/) || [])[1];
    check(
      "実画面: /s5/nonces の呼び出しは1回で、セッションと試行 ID を示す",
      window.__s5NoncesRequests.length === 1 &&
        !!pageSession &&
        window.__s5NoncesRequests[0].session === pageSession &&
        window.__s5NoncesRequests[0].url.includes(`trial_id=${trialId}`),
      `requests=${window.__s5NoncesRequests.length}`
    );
    check(
      "実画面: /s5/send の呼び出しも同じセッションを示す",
      window.__s5SendHeaders.length === 1 &&
        window.__s5SendHeaders[0] === pageSession,
      `headers=${window.__s5SendHeaders.length}`
    );
    const m = logText(window).match(/試験ログ: (\{.*\})/);
    let entry = null;
    try {
      entry = m ? JSON.parse(m[1]) : null;
    } catch { /* 解析できなければ null のまま */ }
    check(
      "実画面: 試験ログが表示の試験 ID と対応し、6スロット分ある",
      !!entry && entry.trial_id === trialId && entry.slots.length === 6,
      logText(window).slice(-400)
    );
    check(
      "実画面: 集計の行に 201 の件数が記録される",
      logText(window).includes("集計: 201="),
      logText(window).slice(-300)
    );
    // 通常ビルドの中継では 6件とも 404 になる（送信器の試験で
    // 201・409 の判定は一時ビルド相手に確認する）。
    check(
      "実画面: 6件の応答がすべて記録される（中継は通常ビルドのため 404）",
      !!entry && entry.slots.every((s) => s.response.status === 404),
      logText(window).slice(-400)
    );
    window.close();
  }

  // ---- 場面2：古い試行のコールバックは新試行に混ざらない ----
  {
    const { window } = await makeDom();
    el(window, "fixedOneTime").value = "fixed-secret-s5";
    el(window, "accountConfirmed").checked = true;
    el(window, "prepS5").click();
    const firstReady = await waitFor(() => window.__gis.callbacks.length > 0);
    check("実画面: 準備で最初のスロットのボタンが表示される", firstReady);
    const trialIdA = el(window, "trialId").textContent;
    // 新しい試行の準備を始める（古い試行は無効化される）。
    el(window, "fixedOneTime").value = "fixed-secret-s5";
    el(window, "prepS5").click();
    const secondReady = await waitFor(() => window.__gis.callbacks.length > 1);
    check("実画面: 準備し直すと新しい試行のボタンが表示される", secondReady);
    const trialIdB = el(window, "trialId").textContent;
    check("実画面: 準備ごとに試験 ID が新しくなる", trialIdA !== trialIdB, `${trialIdA} / ${trialIdB}`);
    // 古い試行のコールバックを呼ぶ（スロット0の nonce で）。
    const nonceA = window.__gis.nonces[0];
    await window.__gis.callbacks[0]({ credential: mintToken(nonceA) });
    await sleep(300);
    check(
      "実画面: 古いコールバックの破棄がログに残る",
      logText(window).includes("古い試行のコールバックを破棄しました"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 古いコールバックは表示を作らない",
      displayText(window).includes("まだ表示記録がありません")
    );
    check("実画面: 古いコールバックは送信ボタンを有効化しない", sendDisabled(window));
    // 新しい試行の6スロットを進める（古い試行のコールバックは
    // 添え字0に残っているため、開始位置は1）。
    await signInAllSlots(window, 1);
    const shown = await waitFor(() =>
      !displayText(window).includes("まだ表示記録がありません")
    );
    check("実画面: 新しい試行の6スロットで表示ができる", shown);
    window.close();
  }

  // ---- 場面3：現行の署名検証の失敗で password 欄が消去され、試行が無効化される ----
  {
    const { window } = await makeDom();
    el(window, "fixedOneTime").value = "fixed-secret-s5";
    el(window, "accountConfirmed").checked = true;
    el(window, "prepS5").click();
    const ready0 = await waitFor(() => window.__gis.callbacks.length > 0);
    check("実画面: 準備で最初のスロットのボタンが表示される", ready0);
    // 誤った nonce のトークンで署名検証を失敗させる。
    const wrongToken = mintToken("wrong-nonce-for-screen-test");
    await window.__gis.callbacks[0]({ credential: wrongToken });
    await sleep(500);
    check(
      "実画面: 署名検証の失敗が準備エラーとして記録される",
      logText(window).includes("署名検証が通りませんでした"),
      logText(window).slice(-300)
    );
    check("実画面: 署名検証の失敗では送信ボタンが無効のまま", sendDisabled(window));
    check(
      "実画面: 現行の失敗時は一回値入力欄が消去される（署名検証の失敗）",
      el(window, "fixedOneTime").value === ""
    );
    check(
      "実画面: 署名検証の失敗では表示が作られない",
      displayText(window).includes("まだ表示記録がありません")
    );
    // 準備し直せる。
    el(window, "fixedOneTime").value = "fixed-secret-s5";
    el(window, "prepS5").click();
    const reprepped = await waitFor(() => window.__gis.callbacks.length > 1);
    check("実画面: 失敗のあと準備し直せる", reprepped);
    window.close();
  }

  // ---- 場面4：二重送信されず、送信中の準備はできない ----
  {
    const { window } = await makeDom();
    window.__s5SendPosts = [];
    el(window, "fixedOneTime").value = "fixed-secret-s5";
    el(window, "accountConfirmed").checked = true;
    el(window, "prepS5").click();
    await signInAllSlots(window);
    const shown = await waitFor(() =>
      !displayText(window).includes("まだ表示記録がありません")
    );
    check("実画面: 送信前の表示ができる", shown);
    el(window, "sendS5").click();
    dispatchClick(window, "sendS5"); // 送信中の二重操作
    dispatchClick(window, "prepS5"); // 送信中の準備
    const logged = await waitFor(() => logText(window).includes("試験ログ:"));
    check("実画面: 並行送信後に試験ログが記録される", logged);
    check(
      "実画面: 送信中の準備は拒否される",
      logText(window).includes("送信中のため準備できません"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 二重送信されない（送信指示は1回だけ）",
      window.__s5SendPosts.length === 1,
      `posts=${window.__s5SendPosts.length}`
    );
    window.close();
  }

  // ---- 場面5：nonce 取得の失敗で準備は無効化され、準備し直せる ----
  {
    const { window } = await makeDom();
    window.__noncesShouldFail = true;
    el(window, "fixedOneTime").value = "fixed-secret-s5";
    el(window, "accountConfirmed").checked = true;
    el(window, "prepS5").click();
    await sleep(800);
    check(
      "実画面: nonce 取得失敗で準備エラーがログに残る",
      logText(window).includes("6件分の nonce が取得できませんでした") || logText(window).includes("エラー:"),
      logText(window).slice(-300)
    );
    check("実画面: 準備失敗では送信ボタンが無効のまま", sendDisabled(window));
    check(
      "実画面: 準備失敗では表示が作られない",
      displayText(window).includes("まだ表示記録がありません")
    );
    window.__noncesShouldFail = false;
    el(window, "prepS5").click();
    const reprepped = await waitFor(() => window.__gis.callbacks.length > 0);
    check("実画面: 準備失敗のあと準備し直せる", reprepped);
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
