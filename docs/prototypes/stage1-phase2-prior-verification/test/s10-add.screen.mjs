// S10 運営者追加専用画面（public/s10-add-operator.html）の実画面試験。
// 実行: node test/s10-add.screen.mjs
// （npm run test:screen:s10 でも実行できる）
//
// 目的：文字列の存在確認ではなく、ページ自体を DOM で実行し、B の主体
// 取得 → A の認可 → 凍結要求の表示・確認 → 送信の gating・送信引数・
// 捕捉トークンの非表示・ログの秘密不出力を検証する（Codex レビュー
// 6758375470 への対応）。実 Google・実 Worker は使わない。
//
// 実行環境の制約：この VM では実ブラウザーの起動ができないため jsdom
// でページを実行する。jsdom 31 は `<script type="module">` を実行しな
// いため、試験ではページ内のインライン・モジュールの import を、配信
// 中の4つの検証モジュール（tools/subject-hash-verify.mjs・
// tools/trial-apply.mjs・tools/s9-negative.mjs・tools/s10-add.mjs）の
// 実ソースを結合して解決し、古典スクリプトとして実行する
// （s9-negative.screen.mjs と同じ方式）。変換は import／export の除去
// だけで、文の内容は変えない。DOM・イベント・タイマー・非同期の交錯は
// 実際のページと同じ経路で実行する。
// - GIS は偽物（beforeParse で window.google を差し替え、本物の
//   gsi/client は空の応答を返す）。
// - JWKS はインターセプターで偽物の公開鍵集合を返す。ID トークンは
//   その場で生成した RSA 鍵で署名した RS256 JWT で、ページ内の JWKS
//   署名検証を通る。B と A は異なる sub で発行する。
// - /nonce は実際の提供サーバー（serve-real.mjs）と Miniflare の通常
//   ビルドへ送る（Cookie 文脈の流れは実物）。/admin/registry/add は
//   インターセプターで要求を記録し、場面ごとに用意した応答
//   （200・409）または例外（応答なし）を返す。実 Worker へは送らない。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。
// ※ test/run.mjs の件数には含めない（別枠のローカル確認）。

import { Miniflare } from "miniflare";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign, webcrypto } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "jsdom";
const { JSDOM, VirtualConsole, requestInterceptor } = pkg;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_PORT = 8901;
const CLIENT_ID = "screen-s10-client-id.apps.googleusercontent.com";
const ENV_ID = "stage1-phase2-verification-local";
const NOW = Math.floor(Date.now() / 1000);
const SUB_B = "screen-subject-B";
const SUB_A = "screen-subject-A";
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const HASH_B = sha256hex(SUB_B);
const HASH_A = sha256hex(SUB_A);

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

function mintToken(nonce, sub) {
  const h = { alg: "RS256", typ: "JWT", kid: "screen-key-1" };
  const p = {
    sub,
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

rmSync(path.join(ROOT, ".persist-screen-s10"), { recursive: true, force: true });
const mf = new Miniflare({
  modules: true,
  scriptPath: path.join(ROOT, "src", "worker.js"),
  compatibilityDate: "2025-01-01",
  durableObjects: { REGISTRY: { className: "RegistryDO", useSQLite: true } },
  durableObjectsPersist: path.join(ROOT, ".persist-screen-s10"),
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
      const r = await fetch(base + "/s10-add-operator");
      if (r.status === 200) return true;
    } catch { /* 起動待ち */ }
    await sleep(200);
  }
  return false;
}

try {
  const ready = await waitReady();
  check("実画面: serve-real が起動し、s10-add-operator 画面を返す", ready, childLog.slice(-400));
  if (!ready) throw new Error("serve-real が起動しませんでした");

  // ページと4つの検証モジュールの実ソースを取得し、インライン・
  // モジュールの import を解決して古典スクリプト化する。
  const pageHtml = await (await fetch(base + "/s10-add-operator")).text();
  const s10Js = await (await fetch(base + "/s10-add.mjs")).text();
  const s9Js = await (await fetch(base + "/s9-negative.mjs")).text();
  const trialJs = await (await fetch(base + "/trial-apply.mjs")).text();
  const verifyJs = await (await fetch(base + "/subject-hash-verify.mjs")).text();
  const inlineModule = pageHtml.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!inlineModule) throw new Error("ページ内にインライン・モジュールが見つかりません");
  const classic =
    stripModule(verifyJs) + "\n" + stripModule(trialJs) + "\n" + stripModule(s9Js) + "\n" +
    stripModule(s10Js) + "\n" + stripModule(inlineModule[1]);
  // モジュールは既定で遅延実行される（本文の解析後に実行）が、古典
  // スクリプトはその場で実行される。古典スクリプトを </body> の直前に
  // 移し、本文の要素が存在してから実行されるようにする。
  const testHtml = pageHtml
    .replace(inlineModule[0], "")
    .replace("</body>", `<script>${classic}</script>\n</body>`);
  check("実画面: ページのモジュール import を解決できる", testHtml.includes("createAddSession"));

  async function makeDom() {
    const vc = new VirtualConsole();
    const jsdomErrors = [];
    vc.on("jsdomError", (e) => jsdomErrors.push(String(e && e.detail ? e.detail : e)));
    const dom = new JSDOM(testHtml, {
      url: base + "/s10-add-operator",
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
        // 代用する。/admin/registry/add だけは場面ごとの応答を返し、
        // それ以外（/nonce・JWKS）はここを通る。Cookie は簡易な保存庫
        // で送受信する（Secure 属性は課さない）。
        window.__fakeJwks = FAKE_JWKS;
        window.__addQueue = [];
        window.__addCalls = [];
        window.__addShouldThrow = false;
        window.__addDelayMs = 0;
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
          if (url.includes("/admin/registry/add")) {
            let body = null;
            try {
              body = JSON.parse(init.body);
            } catch { /* 本体が読めなければ null のまま */ }
            const cookies = [...cookieStore.values()].join("; ");
            window.__addCalls.push({
              url,
              method,
              credentials: init.credentials,
              redirect: init.redirect,
              contentType: (init.headers || {})["content-type"],
              body,
              cookie: cookies,
            });
            if (window.__addShouldThrow) {
              throw new Error("network down (test)");
            }
            if (window.__addDelayMs) await sleep(window.__addDelayMs);
            const next = window.__addQueue.shift() || { status: 500, error: "unexpected_error" };
            const respBody = next.status === 200
              ? { ok: true, generation: next.generation }
              : { error: next.error };
            return new Response(JSON.stringify(respBody), {
              status: next.status,
              headers: { "Content-Type": "application/json" },
            });
          }
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
  function dispatchClick(window, id) {
    // 無効化されたボタンでもハンドラーを呼ぶ（合成イベント）。
    el(window, id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  }
  function logText(window) {
    return el(window, "log").textContent;
  }
  function stateText(window) {
    return el(window, "state").textContent;
  }
  function checkBox(window, id) {
    const box = el(window, id);
    box.checked = true;
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
  }
  function countOccurrences(text, needle) {
    return text.split(needle).length - 1;
  }
  async function newTrial(window) {
    el(window, "newTrial").click();
    const ok = await waitFor(() => el(window, "trialId").textContent !== "（新しい試行を始めてください）");
    if (!ok) throw new Error("新しい試行が始まりませんでした");
    return el(window, "trialId").textContent;
  }
  async function prepRole(window, role) {
    const before = window.__gis.callbacks.length;
    el(window, role === "B" ? "prepB" : "prepA").click();
    const ok = await waitFor(() => window.__gis.callbacks.length > before);
    if (!ok) throw new Error(`${role} の準備で GIS コールバックが登録されませんでした`);
    return window.__gis.callbacks.length - 1;
  }
  async function invokeCallback(window, index, nonce, sub) {
    const token = mintToken(nonce, sub);
    await window.__gis.callbacks[index]({ credential: token });
    await sleep(500);
    return token;
  }
  async function captureRole(window, role, sub) {
    const idx = await prepRole(window, role);
    const nonce = window.__gis.nonces[window.__gis.nonces.length - 1];
    const token = await invokeCallback(window, idx, nonce, sub);
    return { token, nonce };
  }

  // ---- 場面1：初期状態。入力欄がなく、段階ボタンは無効 ----
  {
    const { window } = await makeDom();
    const textInputs = window.document.querySelectorAll('input[type="text"], input[type="url"], input[type="password"]');
    check("実画面: 主体ハッシュ・世代・トークンの入力欄がない", textInputs.length === 0, `inputs=${textInputs.length}`);
    check(
      "実画面: 初期状態では段階ボタンがすべて無効",
      el(window, "prepB").disabled &&
        el(window, "completeB").disabled &&
        el(window, "prepA").disabled &&
        el(window, "completeA").disabled &&
        el(window, "freezeReq").disabled &&
        el(window, "sendAdd").disabled,
      "いずれかの段階ボタンが有効"
    );
    check("実画面: 初期状態では新しい試行ボタンが有効", !el(window, "newTrial").disabled);
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

  // ---- 場面2：正常な進行。B 取得 → A 認可 → 凍結 → 送信（200・世代3） ----
  {
    const { window } = await makeDom();
    const trialId = await newTrial(window);
    const b = await captureRole(window, "B", SUB_B);
    check(
      "実画面: B の捕捉後に署名検証 ok がログに残る",
      logText(window).includes("B の署名検証 -> ok"),
      logText(window).slice(-300)
    );
    check(
      "実画面: B の主体ハッシュが画面に表示される（ログには出ない）",
      el(window, "bHash").textContent === HASH_B && !logText(window).includes(HASH_B),
      `bHash=${el(window, "bHash").textContent.slice(0, 20)}`
    );
    check("実画面: B の取得前は A の準備ボタンが無効", el(window, "prepA").disabled);
    checkBox(window, "bConfirmed");
    el(window, "completeB").click();
    await sleep(300);
    check(
      "実画面: B の取得完了後に段階が b-captured になる",
      stateText(window).includes('"phase": "b-captured"'),
      stateText(window).slice(0, 200)
    );
    const a = await captureRole(window, "A", SUB_A);
    check(
      "実画面: A の捕捉後に署名検証 ok がログに残る",
      logText(window).includes("A の署名検証 -> ok"),
      logText(window).slice(-300)
    );
    check(
      "実画面: A と B の主体ハッシュが異なることが確認される",
      el(window, "distinctCheck").textContent.includes("確認済み"),
      el(window, "distinctCheck").textContent
    );
    checkBox(window, "aConfirmed");
    el(window, "completeA").click();
    await sleep(300);
    check(
      "実画面: A の認可完了後に段階が a-captured になる",
      stateText(window).includes('"phase": "a-captured"'),
      stateText(window).slice(0, 200)
    );
    // nonce 期限の表示：B の発行時刻＋5分が期限になる（全角括弧の数値で確認）。
    const nums = [...el(window, "nonceInfo").textContent.matchAll(/（(\d+)）/g)].map((m) => Number(m[1]));
    check(
      "実画面: nonce 期限の表示が発行時刻＋5分になる",
      nums.length >= 2 && nums[1] - nums[0] === 300000,
      el(window, "nonceInfo").textContent
    );
    el(window, "freezeReq").click();
    await sleep(300);
    const frozenText = el(window, "frozenReq").textContent;
    check(
      "実画面: 凍結表示に対象・期待世代・送信先が含まれる",
      frozenText.includes("action: add") &&
        frozenText.includes("期待世代: 2") &&
        frozenText.includes("送信先: /admin/registry/add") &&
        frozenText.includes(HASH_B),
      frozenText.slice(0, 300)
    );
    check(
      "実画面: 凍結表示の対象が B の取得の表示と同一である",
      frozenText.includes(el(window, "bHash").textContent),
      "凍結表示と B の表示が一致しない"
    );
    check("実画面: 送信前は送信ボタンが無効（事前確認チェックなし）", el(window, "sendAdd").disabled);
    checkBox(window, "preReadConfirmed");
    check("実画面: 事前確認後に送信ボタンが有効になる", !el(window, "sendAdd").disabled);
    window.__addQueue = [{ status: 200, generation: 3 }];
    el(window, "sendAdd").click();
    await sleep(800);
    check("実画面: 追加の送信が1回だけ行われる", window.__addCalls.length === 1, `calls=${window.__addCalls.length}`);
    const call1 = window.__addCalls[0] || {};
    check(
      "実画面: 追加の送信先が固定パス POST /admin/registry/add になる",
      call1.url === base + "/admin/registry/add" && call1.method === "POST",
      JSON.stringify({ url: call1.url, method: call1.method })
    );
    check(
      "実画面: 追加の送信に redirect:\"manual\" と application/json と credentials: include が含まれる",
      call1.redirect === "manual" && call1.contentType === "application/json" && call1.credentials === "include",
      JSON.stringify({ redirect: call1.redirect, contentType: call1.contentType, credentials: call1.credentials })
    );
    check(
      "実画面: 追加の送信本体が凍結内容（対象B・期待世代2）と A のトークンである",
      call1.body &&
        call1.body.subject_hash === HASH_B &&
        call1.body.expected_generation === 2 &&
        call1.body.id_token === a.token,
      JSON.stringify(call1.body ? { subject_hash: call1.body.subject_hash?.slice(0, 8), expected_generation: call1.body.expected_generation, id_token_matches: call1.body.id_token === a.token } : null)
    );
    check(
      "実画面: 追加の送信に /nonce で発行された Cookie 文脈が送られる",
      typeof call1.cookie === "string" && call1.cookie.includes("op2_nonce_ctx="),
      `cookie=${call1.cookie}`
    );
    check(
      "実画面: 送信のログが試験 ID・200 ok・generation 3 と対応する",
      logText(window).includes("送信 -> 200 ok generation=3") && logText(window).includes(trialId),
      logText(window).slice(-400)
    );
    check(
      "実画面: 送信後に段階が completed になる",
      stateText(window).includes('"phase": "completed"'),
      stateText(window).slice(0, 200)
    );
    check(
      "実画面: 送信後に主体ハッシュの表示が消去される",
      el(window, "bHash").textContent.includes("消去されました") &&
        el(window, "aHash").textContent.includes("消去されました"),
      `bHash=${el(window, "bHash").textContent} aHash=${el(window, "aHash").textContent}`
    );
    check(
      "実画面: ログにトークン・nonce・主体ハッシュが出ない",
      !logText(window).includes(b.token) &&
        !logText(window).includes(a.token) &&
        !logText(window).includes(HASH_B) &&
        !logText(window).includes(HASH_A),
      logText(window).slice(-400)
    );
    window.close();
  }

  // ---- 場面3：A と B が同一アカウントの場合は same_subject で停止する ----
  {
    const { window } = await makeDom();
    await newTrial(window);
    await captureRole(window, "B", SUB_B);
    checkBox(window, "bConfirmed");
    el(window, "completeB").click();
    await sleep(300);
    await captureRole(window, "A", SUB_B);
    checkBox(window, "aConfirmed");
    el(window, "completeA").click();
    await sleep(300);
    check(
      "実画面: 同一主体の認可で same_subject がログに残る",
      logText(window).includes("same_subject"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 同一主体の検出後に試行が停止し、送信ができない",
      logText(window).includes("A の認可エラー") && window.__addCalls.length === 0,
      `calls=${window.__addCalls.length}`
    );
    window.close();
  }

  // ---- 場面4：順序の固定。B の取得前に A の準備はできない ----
  {
    const { window } = await makeDom();
    await newTrial(window);
    const before = window.__gis.callbacks.length;
    dispatchClick(window, "prepA");
    await sleep(500);
    check(
      "実画面: B の取得前に A の準備をしても GIS コールバックが登録されない",
      window.__gis.callbacks.length === before,
      `callbacks=${window.__gis.callbacks.length}`
    );
    check(
      "実画面: 順序外の準備でエラーがログに残る",
      logText(window).includes("準備エラー"),
      logText(window).slice(-300)
    );
    window.close();
  }

  // ---- 場面5：応答なしは状態未確定として停止し、再送しない ----
  {
    const { window } = await makeDom();
    await newTrial(window);
    await captureRole(window, "B", SUB_B);
    checkBox(window, "bConfirmed");
    el(window, "completeB").click();
    await sleep(300);
    await captureRole(window, "A", SUB_A);
    checkBox(window, "aConfirmed");
    el(window, "completeA").click();
    await sleep(300);
    el(window, "freezeReq").click();
    await sleep(300);
    checkBox(window, "preReadConfirmed");
    window.__addShouldThrow = true;
    el(window, "sendAdd").click();
    await sleep(800);
    check(
      "実画面: 応答なしで「状態未確定、再送しません」がログに残る",
      logText(window).includes("応答なし（状態未確定、再送しません）"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 応答なしの後に送信を試みても送信できない（再送なし）",
      (() => {
        dispatchClick(window, "sendAdd");
        return true;
      })() && window.__addCalls.length === 1,
      `calls=${window.__addCalls.length}`
    );
    check(
      "実画面: 応答なしの後に段階が halted（未確定）になる",
      stateText(window).includes('"phase": "halted"') && stateText(window).includes('"undetermined": true'),
      stateText(window).slice(0, 300)
    );
    window.close();
  }

  // ---- 場面6：409 stale_generation では試行が停止し、再送しない ----
  {
    const { window } = await makeDom();
    await newTrial(window);
    await captureRole(window, "B", SUB_B);
    checkBox(window, "bConfirmed");
    el(window, "completeB").click();
    await sleep(300);
    await captureRole(window, "A", SUB_A);
    checkBox(window, "aConfirmed");
    el(window, "completeA").click();
    await sleep(300);
    el(window, "freezeReq").click();
    await sleep(300);
    checkBox(window, "preReadConfirmed");
    window.__addQueue = [{ status: 409, error: "stale_generation" }];
    el(window, "sendAdd").click();
    await sleep(800);
    check(
      "実画面: 409 stale_generation がログに残る",
      logText(window).includes("送信 -> 409 stale_generation"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 409 の後に送信を試みても送信できない（再送なし）",
      (() => {
        dispatchClick(window, "sendAdd");
        return true;
      })() && window.__addCalls.length === 1,
      `calls=${window.__addCalls.length}`
    );
    window.close();
  }

  // ---- 場面7：B の署名検証が通らなければ試行が破棄される ----
  {
    const { window } = await makeDom();
    await newTrial(window);
    const idx = await prepRole(window, "B");
    const nonce = window.__gis.nonces[window.__gis.nonces.length - 1];
    // 発行した nonce と異なる nonce のトークンを渡す（nonce 不一致）。
    await invokeCallback(window, idx, "wrong-nonce", SUB_B);
    check(
      "実画面: nonce 不一致で署名検証 ng がログに残る",
      logText(window).includes("署名検証 -> ng"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 検証失敗後に試行が破棄される",
      stateText(window).includes("（試行がありません）"),
      stateText(window).slice(0, 200)
    );
    window.close();
  }

  // ---- 場面8：送信中の二重送信は起きない ----
  {
    const { window } = await makeDom();
    await newTrial(window);
    await captureRole(window, "B", SUB_B);
    checkBox(window, "bConfirmed");
    el(window, "completeB").click();
    await sleep(300);
    await captureRole(window, "A", SUB_A);
    checkBox(window, "aConfirmed");
    el(window, "completeA").click();
    await sleep(300);
    el(window, "freezeReq").click();
    await sleep(300);
    checkBox(window, "preReadConfirmed");
    window.__addQueue = [{ status: 200, generation: 3 }];
    window.__addDelayMs = 600;
    el(window, "sendAdd").click();
    await sleep(100);
    el(window, "sendAdd").click();
    await sleep(1200);
    check(
      "実画面: 送信中の2回目の送信は行われない",
      window.__addCalls.length === 1,
      `calls=${window.__addCalls.length}`
    );
    window.close();
  }

  // ---- 場面9：sha256hex の遅延中に旧試行を破棄・新規試行しても、
  // 遅れた旧コールバックが新試行へ書き込まない（Codex 6758648104 指摘1） ----
  {
    const { window } = await makeDom();
    check(
      "実画面: 画面の sha256hex が差し替え可能である（遅延の再現用）",
      typeof window.sha256hex === "function",
      `typeof=${typeof window.sha256hex}`
    );
    const trial1 = await newTrial(window);
    // ハッシュ計算を遅延させる。コールバックが sha256hex に到達した
    // ことを旗で確認してから、破棄・新規試行を行う。
    let releaseHash;
    window.__hashGate = new Promise((resolve) => { releaseHash = resolve; });
    window.__hashReached = false;
    const origSha256hex = window.sha256hex;
    window.sha256hex = async (text) => {
      window.__hashReached = true;
      await window.__hashGate;
      return origSha256hex(text);
    };
    const idxB = await prepRole(window, "B");
    const nonceB = window.__gis.nonces[window.__gis.nonces.length - 1];
    const cbPromise = window.__gis.callbacks[idxB]({ credential: mintToken(nonceB, SUB_B) });
    const reached = await waitFor(() => window.__hashReached === true);
    check(
      "実画面: 遅延させたハッシュ計算に旧コールバックが到達する",
      reached,
      "コールバックが sha256hex まで進まなかった"
    );
    el(window, "discardTrial").click();
    await sleep(200);
    const trial2 = await newTrial(window);
    check(
      "実画面: ハッシュ遅延中に破棄・新規試行で試行が置換される",
      trial2 !== trial1,
      `trial1=${trial1} trial2=${trial2}`
    );
    releaseHash();
    await cbPromise;
    await sleep(300);
    check(
      "実画面: 遅延した旧コールバックが破棄される（世代照合）",
      logText(window).includes("古い試行のコールバックを破棄しました"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 遅延した旧コールバックが新試行の B 表示へ書き込まない",
      !logText(window).includes("B の署名検証 -> ok") &&
        el(window, "bHash").textContent === "（まだ B のログインをしていません）",
      `bHash=${el(window, "bHash").textContent.slice(0, 20)}`
    );
    check(
      "実画面: 遅延した旧コールバックの後も新試行が b-preparing のままである",
      stateText(window).includes('"phase": "b-preparing"'),
      stateText(window).slice(0, 200)
    );
    // 新試行で B を取り直すと正常に捕捉できる。
    await captureRole(window, "B", SUB_B);
    check(
      "実画面: 新試行で B を取り直すと署名検証 ok が1回だけ記録される",
      countOccurrences(logText(window), "B の署名検証 -> ok") === 1 &&
        el(window, "bHash").textContent === HASH_B,
      logText(window).slice(-300)
    );
    window.close();
  }

  // ---- 場面10：捕捉済み・認可済みの役割への重複コールバックは
  // 役割・段階で破棄される（Codex 6758648104 指摘1） ----
  {
    const { window } = await makeDom();
    await newTrial(window);
    const idxB = await prepRole(window, "B");
    const nonceB = window.__gis.nonces[window.__gis.nonces.length - 1];
    await invokeCallback(window, idxB, nonceB, SUB_B);
    checkBox(window, "bConfirmed");
    el(window, "completeB").click();
    await sleep(300);
    // 重複 B コールバック（別の主体・同じ nonce。署名検証は通る）。
    await invokeCallback(window, idxB, nonceB, SUB_A);
    check(
      "実画面: 捕捉済みの B への重複コールバックが役割・段階で破棄される",
      logText(window).includes("役割・段階が一致しないコールバックを破棄しました"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 重複 B コールバックで B の主体ハッシュが書き換わらない",
      el(window, "bHash").textContent === HASH_B,
      `bHash=${el(window, "bHash").textContent.slice(0, 20)}`
    );
    check(
      "実画面: B の署名検証 ok が1回だけ記録される",
      countOccurrences(logText(window), "B の署名検証 -> ok") === 1,
      logText(window).slice(-300)
    );
    const idxA = await prepRole(window, "A");
    const nonceA = window.__gis.nonces[window.__gis.nonces.length - 1];
    await invokeCallback(window, idxA, nonceA, SUB_A);
    checkBox(window, "aConfirmed");
    el(window, "completeA").click();
    await sleep(300);
    // 重複 A コールバック（別の主体・同じ nonce。署名検証は通る）。
    await invokeCallback(window, idxA, nonceA, SUB_B);
    check(
      "実画面: 認可済みの A への重複コールバックが役割・段階で破棄される",
      countOccurrences(logText(window), "役割・段階が一致しないコールバックを破棄しました") === 2,
      logText(window).slice(-300)
    );
    check(
      "実画面: 重複 A コールバックで A の主体ハッシュが書き換わらない",
      el(window, "aHash").textContent === HASH_A,
      `aHash=${el(window, "aHash").textContent.slice(0, 20)}`
    );
    check(
      "実画面: A の署名検証 ok が1回だけ記録される",
      countOccurrences(logText(window), "A の署名検証 -> ok") === 1,
      logText(window).slice(-300)
    );
    // 重複を拒否した後も試行は正常に進み、送信できる。
    el(window, "freezeReq").click();
    await sleep(300);
    checkBox(window, "preReadConfirmed");
    window.__addQueue = [{ status: 200, generation: 3 }];
    el(window, "sendAdd").click();
    await sleep(800);
    check(
      "実画面: 重複コールバックの拒否後も追加が1回で完了する",
      window.__addCalls.length === 1 && stateText(window).includes('"phase": "completed"'),
      `calls=${window.__addCalls.length}`
    );
    window.close();
  }

  // ---- 場面11：遅延した B／A の nonce 取得中に、合成イベントでの
  // 再準備・破棄・新規試行は拒否され、Cookie 文脈も保たれる
  // （Codex 6758648104 指摘2） ----
  {
    const { window } = await makeDom();
    const trial1 = await newTrial(window);
    // B の nonce 取得を遅延させる。
    window.__nonceDelayMs = 600;
    el(window, "prepB").click();
    const fetchingB = await waitFor(() => window.__nonceCalls === 1);
    check(
      "実画面: B の nonce 取得が飛行中になる",
      fetchingB,
      `nonceCalls=${window.__nonceCalls}`
    );
    dispatchClick(window, "newTrial");
    dispatchClick(window, "discardTrial");
    dispatchClick(window, "prepB");
    await sleep(200);
    check(
      "実画面: B の nonce 取得中に合成イベントの新規試行が拒否される",
      logText(window).includes("nonce 取得中のため新しい試行を開始できません"),
      logText(window).slice(-300)
    );
    check(
      "実画面: B の nonce 取得中に合成イベントの破棄が拒否される",
      logText(window).includes("nonce 取得中のため破棄できません"),
      logText(window).slice(-300)
    );
    check(
      "実画面: B の nonce 取得中に合成イベントの再準備が拒否される",
      logText(window).includes("準備エラー"),
      logText(window).slice(-300)
    );
    check(
      "実画面: B の nonce 取得中の拒否で試行が置換されず /nonce も増えない",
      el(window, "trialId").textContent === trial1 &&
        window.__nonceCalls === 1 &&
        window.__gis.callbacks.length === 0,
      `trialId=${el(window, "trialId").textContent} nonceCalls=${window.__nonceCalls} callbacks=${window.__gis.callbacks.length}`
    );
    const bReady = await waitFor(() => window.__gis.callbacks.length > 0);
    check(
      "実画面: 遅延した B の nonce 取得が完了して GIS コールバックが登録される",
      bReady,
      `callbacks=${window.__gis.callbacks.length}`
    );
    window.__nonceDelayMs = 0;
    await invokeCallback(window, window.__gis.callbacks.length - 1, window.__gis.nonces[window.__gis.nonces.length - 1], SUB_B);
    check(
      "実画面: 遅延した B の nonce で捕捉でき、/nonce は1回のままである",
      logText(window).includes("B の署名検証 -> ok") && window.__nonceCalls === 1,
      `nonceCalls=${window.__nonceCalls}`
    );
    checkBox(window, "bConfirmed");
    el(window, "completeB").click();
    await sleep(300);
    // A の nonce 取得も同様に遅延させる。
    window.__nonceDelayMs = 600;
    el(window, "prepA").click();
    const fetchingA = await waitFor(() => window.__nonceCalls === 2);
    check(
      "実画面: A の nonce 取得が飛行中になる",
      fetchingA,
      `nonceCalls=${window.__nonceCalls}`
    );
    dispatchClick(window, "newTrial");
    dispatchClick(window, "discardTrial");
    dispatchClick(window, "prepA");
    await sleep(200);
    check(
      "実画面: A の nonce 取得中に合成イベントの新規試行が拒否される",
      logText(window).includes("nonce 取得中のため新しい試行を開始できません"),
      logText(window).slice(-300)
    );
    check(
      "実画面: A の nonce 取得中に合成イベントの破棄が拒否される",
      logText(window).includes("nonce 取得中のため破棄できません"),
      logText(window).slice(-300)
    );
    check(
      "実画面: A の nonce 取得中に合成イベントの再準備が拒否される",
      logText(window).includes("準備エラー"),
      logText(window).slice(-300)
    );
    check(
      "実画面: A の nonce 取得中の拒否で試行が置換されず /nonce も増えない",
      el(window, "trialId").textContent === trial1 && window.__nonceCalls === 2,
      `trialId=${el(window, "trialId").textContent} nonceCalls=${window.__nonceCalls}`
    );
    const aReady = await waitFor(() => window.__gis.callbacks.length > 1);
    check(
      "実画面: 遅延した A の nonce 取得が完了して GIS コールバックが登録される",
      aReady,
      `callbacks=${window.__gis.callbacks.length}`
    );
    window.__nonceDelayMs = 0;
    await invokeCallback(window, window.__gis.callbacks.length - 1, window.__gis.nonces[window.__gis.nonces.length - 1], SUB_A);
    checkBox(window, "aConfirmed");
    el(window, "completeA").click();
    await sleep(300);
    el(window, "freezeReq").click();
    await sleep(300);
    checkBox(window, "preReadConfirmed");
    window.__addQueue = [{ status: 200, generation: 3 }];
    el(window, "sendAdd").click();
    await sleep(800);
    check(
      "実画面: 取得中の拒否の後も追加が1回で完了する",
      window.__addCalls.length === 1 && stateText(window).includes('"phase": "completed"'),
      `calls=${window.__addCalls.length}`
    );
    const call = window.__addCalls[0] || {};
    check(
      "実画面: 取得中の拒否の後も送信に A の nonce の Cookie 文脈が送られる",
      typeof call.cookie === "string" && call.cookie.includes("op2_nonce_ctx="),
      `cookie=${call.cookie}`
    );
    check(
      "実画面: 取得中の拒否で余分な /nonce が発行されていない",
      window.__nonceCalls === 2,
      `nonceCalls=${window.__nonceCalls}`
    );
    window.close();
  }
} catch (e) {
  console.log("FAIL  実画面試験の実行中に例外:", e.message);
  results.push({ name: "実画面試験の実行", pass: false });
} finally {
  child.kill();
  await mf.dispose().catch(() => {});
  rmSync(path.join(ROOT, ".persist-screen-s10"), { recursive: true, force: true });
}

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log(`\n===== 実画面結果: ${passed} PASS / ${failed.length} FAIL（全 ${results.length} 件） =====`);
if (failed.length) {
  for (const f of failed) console.log(`  FAIL: ${f.name}`);
  process.exit(1);
}
