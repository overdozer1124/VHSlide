// S11 並行送信専用画面（public/s11-parallel.html）の実画面試験。
// 実行: node test/s11-parallel.screen.mjs
// （npm run test:screen:s11 でも実行できる）
//
// 目的：文字列の存在確認ではなく、ページ自体を DOM で実行し、
// C の主体取得 → B の参照取得 → 手順3の A 認可 → 手順3の凍結 →
// 手順3の送信指示 → 手順4の A 認可×2 → 手順4の凍結 → 手順4の
// 同時送信指示の gating・送信引数・捕捉トークンの非表示・ログの
// 秘密不出力を検証する（Codex の手順レビュー seq 691 への対応）。
// 実 Google・実 Worker は使わない。
//
// 実行環境の制約：この VM では実ブラウザーの起動ができないため
// jsdom でページを実行する（s10-add.screen.mjs と同じ方式）。
// - GIS は偽物（beforeParse で window.google を差し替え、本物の
//   gsi/client は空の応答を返す）。
// - JWKS はインターセプターで偽物の公開鍵集合を返す。ID トークン
//   はその場で生成した RSA 鍵で署名した RS256 JWT で、ページ内の
//   JWKS 署名検証を通る。C・B・A・X は異なる sub で発行する。
// - C・B 捕捉用の /nonce は実際の提供サーバー（serve-real.mjs）
//   と Miniflare の通常ビルドへ送る（実物）。
// - /s11/nonces・/s11/send-stale・/s11/send-concurrent は
//   インターセプターで要求を記録し、場面ごとに用意した応答を
//   返す。送信器と実 Worker へは送らない（送信器の実物確認は
//   test/s11-sender.test.mjs と test/s11-guard.test.mjs）。
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
const SERVE_PORT = 8903;
const CLIENT_ID = "screen-s11-client-id.apps.googleusercontent.com";
const ENV_ID = "stage1-phase2-verification-local";
const NOW = Math.floor(Date.now() / 1000);
const SUB_C = "screen-subject-C";
const SUB_B = "screen-subject-B";
const SUB_A = "screen-subject-A";
const SUB_X = "screen-subject-X";
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const HASH_C = sha256hex(SUB_C);
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
    .replace(/^export\s+(?=async\s+function|function|const|let|class)/gm, "");
}

rmSync(path.join(ROOT, ".persist-screen-s11"), { recursive: true, force: true });
const mf = new Miniflare({
  modules: true,
  scriptPath: path.join(ROOT, "src", "worker.js"),
  compatibilityDate: "2025-01-01",
  durableObjects: { REGISTRY: { className: "RegistryDO", useSQLite: true } },
  durableObjectsPersist: path.join(ROOT, ".persist-screen-s11"),
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
      const r = await fetch(base + "/s11-parallel");
      if (r.status === 200) return true;
    } catch { /* 起動待ち */ }
    await sleep(200);
  }
  return false;
}

try {
  const ready = await waitReady();
  check("実画面: serve-real が起動し、s11-parallel 画面を返す", ready, childLog.slice(-400));
  if (!ready) throw new Error("serve-real が起動しませんでした");

  // ページと4つの検証モジュールの実ソースを取得し、インライン・
  // モジュールの import を解決して古典スクリプト化する。
  const pageHtml = await (await fetch(base + "/s11-parallel")).text();
  const s11Js = await (await fetch(base + "/s11-parallel.mjs")).text();
  const s9Js = await (await fetch(base + "/s9-negative.mjs")).text();
  const trialJs = await (await fetch(base + "/trial-apply.mjs")).text();
  const verifyJs = await (await fetch(base + "/subject-hash-verify.mjs")).text();
  const sessionMatch = pageHtml.match(/const S11_SESSION = "([^"]+)"/);
  const SERVED_SESSION = sessionMatch ? sessionMatch[1] : null;
  const inlineModule = pageHtml.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!inlineModule) throw new Error("ページ内にインライン・モジュールが見つかりません");
  const classic =
    stripModule(verifyJs) + "\n" + stripModule(trialJs) + "\n" + stripModule(s9Js) + "\n" +
    stripModule(s11Js) + "\n" + stripModule(inlineModule[1]);
  const testHtml = pageHtml
    .replace(inlineModule[0], "")
    .replace("</body>", `<script>${classic}</script>\n</body>`);
  check("実画面: ページのモジュール import を解決できる", testHtml.includes("createS11Session"));

  async function makeDom() {
    const vc = new VirtualConsole();
    const jsdomErrors = [];
    vc.on("jsdomError", (e) => jsdomErrors.push(String(e && e.detail ? e.detail : e)));
    const dom = new JSDOM(testHtml, {
      url: base + "/s11-parallel",
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole: vc,
      resources: {
        interceptors: [
          requestInterceptor((request) => {
            if (request.url.includes("gsi/client")) {
              return new Response("", { headers: { "Content-Type": "application/javascript" } });
            }
            return undefined;
          }),
        ],
      },
      beforeParse(window) {
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
        window.__fakeJwks = FAKE_JWKS;
        // 送信器入口の記録と場面ごとの応答。
        window.__nonceCalls = [];
        window.__staleCalls = [];
        window.__concCalls = [];
        window.__staleQueue = [];
        window.__concQueue = [];
        window.__staleShouldThrow = false;
        window.__concShouldThrow = false;
        window.__concDelayMs = 0;
        window.__senderNonceCounter = 0;
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
          if (url.includes("/s11/nonces")) {
            const u = new URL(url);
            const procedure = u.searchParams.get("procedure");
            window.__nonceCalls.push({
              url,
              procedure,
              trialId: u.searchParams.get("trial_id"),
              session: (init.headers || {})["x-s11-session"],
            });
            const count = procedure === "concurrent" ? 2 : 1;
            const nonces = [];
            for (let i = 0; i < count; i++) {
              window.__senderNonceCounter += 1;
              nonces.push(`sender-nonce-${window.__senderNonceCounter}`);
            }
            return new Response(JSON.stringify({ nonces }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (url.includes("/s11/send-stale")) {
            let body = null;
            try {
              body = JSON.parse(init.body);
            } catch { /* 本体が読めなければ null のまま */ }
            window.__staleCalls.push({
              url,
              method,
              session: (init.headers || {})["x-s11-session"],
              contentType: (init.headers || {})["content-type"],
              body,
            });
            if (window.__staleShouldThrow) {
              throw new Error("network down (test)");
            }
            const next = window.__staleQueue.shift() ||
              { status: 500, error: "unexpected_error", generation: null };
            if (next.instructionError) {
              return new Response(JSON.stringify({ error: next.instructionError }), {
                status: next.instructionStatus || 409,
                headers: { "Content-Type": "application/json" },
              });
            }
            return new Response(
              JSON.stringify({
                trial_id: body ? body.trial_id : null,
                procedure: "stale",
                result: { status: next.status, error: next.error, generation: next.generation },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          if (url.includes("/s11/send-concurrent")) {
            let body = null;
            try {
              body = JSON.parse(init.body);
            } catch { /* 本体が読めなければ null のまま */ }
            window.__concCalls.push({
              url,
              method,
              session: (init.headers || {})["x-s11-session"],
              contentType: (init.headers || {})["content-type"],
              body,
            });
            if (window.__concShouldThrow) {
              throw new Error("network down (test)");
            }
            if (window.__concDelayMs) await sleep(window.__concDelayMs);
            const next = window.__concQueue.shift() || { results: [] };
            if (next.instructionError) {
              return new Response(JSON.stringify({ error: next.instructionError }), {
                status: next.instructionStatus || 409,
                headers: { "Content-Type": "application/json" },
              });
            }
            return new Response(
              JSON.stringify({
                trial_id: body ? body.trial_id : null,
                procedure: "concurrent",
                results: next.results,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
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
  async function newTrial(window) {
    el(window, "newTrial").click();
    const ok = await waitFor(() => el(window, "trialId").textContent !== "（新しい試行を始めてください）");
    if (!ok) throw new Error("新しい試行が始まりませんでした");
    return el(window, "trialId").textContent;
  }
  async function invokeLatestCallback(window, sub) {
    const idx = window.__gis.callbacks.length - 1;
    const nonce = window.__gis.nonces[idx];
    const token = mintToken(nonce, sub);
    await window.__gis.callbacks[idx]({ credential: token });
    await sleep(500);
    return token;
  }
  async function captureBrowserRole(window, prepId, sub) {
    const before = window.__gis.callbacks.length;
    el(window, prepId).click();
    const ok = await waitFor(() => window.__gis.callbacks.length > before);
    if (!ok) throw new Error(`${prepId} の準備で GIS コールバックが登録されませんでした`);
    return invokeLatestCallback(window, sub);
  }
  // 手順3の認可捕捉。prepP3 は送信器から nonce を取得してから
  // ボタンを描くため、GIS コールバックの登録を待つ。
  async function captureP3(window, sub) {
    const before = window.__gis.callbacks.length;
    el(window, "prepP3").click();
    const ok = await waitFor(() => window.__gis.callbacks.length > before);
    if (!ok) throw new Error("手順3の準備で GIS コールバックが登録されませんでした");
    return invokeLatestCallback(window, sub);
  }
  // 手順4の2スロット捕捉。スロット0の捕捉後にスロット1のボタンが
  // 描かれる。
  async function captureP4(window, sub0, sub1) {
    const before = window.__gis.callbacks.length;
    el(window, "prepP4").click();
    const ok = await waitFor(() => window.__gis.callbacks.length > before);
    if (!ok) throw new Error("手順4の準備で GIS コールバックが登録されませんでした");
    const token0 = await invokeLatestCallback(window, sub0);
    // スロット1のボタンはスロット0のコールバックの中で描かれるため、
    // 登録は invokeLatestCallback の完了時点で済んでいる場合がある。
    // prepP4 のクリック前の件数＋2（スロット0・スロット1）で判定する。
    const ok2 = await waitFor(() => window.__gis.callbacks.length >= before + 2);
    if (!ok2) {
      throw new Error(
        "手順4のスロット1のボタンが描かれませんでした: callbacks=" +
          window.__gis.callbacks.length +
          " log=" + logText(window).slice(-400) + " state=" + stateText(window).slice(0, 200)
      );
    }
    const token1 = await invokeLatestCallback(window, sub1);
    return [token0, token1];
  }
  // 手順3の送信まで進める共通の進行。
  async function proceedThroughStale(window, staleResult) {
    const trialId = await newTrial(window);
    await captureBrowserRole(window, "prepC", SUB_C);
    checkBox(window, "cConfirmed");
    el(window, "completeC").click();
    await sleep(300);
    await captureBrowserRole(window, "prepB", SUB_B);
    checkBox(window, "bConfirmed");
    el(window, "completeB").click();
    await sleep(300);
    const tokenP3 = await captureP3(window, SUB_A);
    checkBox(window, "p3Confirmed");
    el(window, "completeP3").click();
    await sleep(300);
    el(window, "freezeStale").click();
    await sleep(300);
    checkBox(window, "preRead3");
    window.__staleQueue = [staleResult];
    el(window, "sendStale").click();
    await sleep(800);
    return { trialId, tokenP3 };
  }

  // ---- 場面1：初期状態。入力欄がなく、段階ボタンは無効 ----
  {
    const { window } = await makeDom();
    const textInputs = window.document.querySelectorAll('input[type="text"], input[type="url"], input[type="password"]');
    check("実画面: 主体ハッシュ・世代・トークンの入力欄がない", textInputs.length === 0, `inputs=${textInputs.length}`);
    check(
      "実画面: 初期状態では段階ボタンがすべて無効",
      el(window, "prepC").disabled &&
        el(window, "completeC").disabled &&
        el(window, "prepB").disabled &&
        el(window, "completeB").disabled &&
        el(window, "prepP3").disabled &&
        el(window, "completeP3").disabled &&
        el(window, "freezeStale").disabled &&
        el(window, "sendStale").disabled &&
        el(window, "prepP4").disabled &&
        el(window, "completeP4").disabled &&
        el(window, "freezeP4").disabled &&
        el(window, "sendP4").disabled,
      "いずれかの段階ボタンが有効"
    );
    check("実画面: 初期状態では新しい試行ボタンが有効", !el(window, "newTrial").disabled);
    check(
      "実画面: Cookie文脈の分離と未実証の注記がある",
      window.document.body.textContent.includes("Cookie") &&
        window.document.body.textContent.includes("送信器") &&
        window.document.body.textContent.includes("未実証") &&
        window.document.body.textContent.includes("Origin の境界")
    );
    window.close();
  }

  // ---- 場面2：正常な進行。手順3（409 stale）→ 手順4（成功1件）で S11 完了 ----
  {
    const { window } = await makeDom();
    const trialId = await newTrial(window);
    const tokenC = await captureBrowserRole(window, "prepC", SUB_C);
    check(
      "実画面: C の捕捉後に署名検証 ok がログに残る",
      logText(window).includes("C の署名検証 -> ok"),
      logText(window).slice(-300)
    );
    check(
      "実画面: C の主体ハッシュが画面に表示される（ログには出ない）",
      el(window, "cHash").textContent === HASH_C && !logText(window).includes(HASH_C),
      `cHash=${el(window, "cHash").textContent.slice(0, 20)}`
    );
    check("実画面: C の取得前は B の準備ボタンが無効", el(window, "prepB").disabled);
    checkBox(window, "cConfirmed");
    el(window, "completeC").click();
    await sleep(300);
    check(
      "実画面: C の取得完了後に段階が c-captured になる",
      stateText(window).includes('"phase": "c-captured"'),
      stateText(window).slice(0, 200)
    );
    const tokenB = await captureBrowserRole(window, "prepB", SUB_B);
    check(
      "実画面: C と B の主体ハッシュが異なることが確認される",
      el(window, "cbDistinct").textContent.includes("確認済み"),
      el(window, "cbDistinct").textContent
    );
    checkBox(window, "bConfirmed");
    el(window, "completeB").click();
    await sleep(300);
    check(
      "実画面: B の参照取得完了後に段階が refs-captured になる",
      stateText(window).includes('"phase": "refs-captured"'),
      stateText(window).slice(0, 200)
    );
    const tokenP3 = await captureP3(window, SUB_A);
    check(
      "実画面: 手順3の nonce 発行が送信器入口（手順 stale・試行 ID・セッション付き）で行われる",
      window.__nonceCalls.length === 1 &&
        window.__nonceCalls[0].procedure === "stale" &&
        window.__nonceCalls[0].trialId === trialId &&
        window.__nonceCalls[0].session === SERVED_SESSION,
      JSON.stringify(window.__nonceCalls.map((c) => ({ procedure: c.procedure, trialId: c.trialId, sessionOk: c.session === SERVED_SESSION })))
    );
    check(
      "実画面: 認可者が B・C と異なることが確認される",
      el(window, "p3Facts").textContent.includes("確認済み"),
      el(window, "p3Facts").textContent
    );
    checkBox(window, "p3Confirmed");
    el(window, "completeP3").click();
    await sleep(300);
    check(
      "実画面: 手順3の認可完了後に段階が p3-captured になる",
      stateText(window).includes('"phase": "p3-captured"'),
      stateText(window).slice(0, 200)
    );
    el(window, "freezeStale").click();
    await sleep(300);
    const frozenStaleText = el(window, "frozenStale").textContent;
    check(
      "実画面: 手順3の凍結表示に対象・期待世代2・送信先が含まれる",
      frozenStaleText.includes("action: add") &&
        frozenStaleText.includes("期待世代: 2") &&
        frozenStaleText.includes("送信先: /admin/registry/add") &&
        frozenStaleText.includes(HASH_C),
      frozenStaleText.slice(0, 300)
    );
    check(
      "実画面: 手順3の凍結表示の対象が C の取得の表示と同一である",
      frozenStaleText.includes(el(window, "cHash").textContent),
      "凍結表示と C の表示が一致しない"
    );
    check("実画面: 手順3は送信前確認チェックなしでは送信ボタンが無効", el(window, "sendStale").disabled);
    checkBox(window, "preRead3");
    check("実画面: 事前確認後に手順3の送信ボタンが有効になる", !el(window, "sendStale").disabled);
    window.__staleQueue = [{ status: 409, error: "stale_generation", generation: null }];
    el(window, "sendStale").click();
    await sleep(800);
    check("実画面: 手順3の送信指示が1回だけ行われる", window.__staleCalls.length === 1, `calls=${window.__staleCalls.length}`);
    const staleCall = window.__staleCalls[0] || {};
    check(
      "実画面: 手順3の送信指示先が固定パスで、セッションと JSON が付く",
      staleCall.url === base + "/s11/send-stale" &&
        staleCall.method === "POST" &&
        staleCall.session === SERVED_SESSION &&
        staleCall.contentType === "application/json",
      JSON.stringify({ url: staleCall.url, method: staleCall.method, sessionOk: staleCall.session === SERVED_SESSION })
    );
    check(
      "実画面: 手順3の送信本体が凍結内容（対象C・期待世代2）と A のトークンである",
      staleCall.body &&
        staleCall.body.trial_id === trialId &&
        staleCall.body.request.subject_hash === HASH_C &&
        staleCall.body.request.expected_generation === 2 &&
        staleCall.body.request.id_token === tokenP3,
      JSON.stringify(staleCall.body ? { subject: staleCall.body.request.subject_hash?.slice(0, 8), gen: staleCall.body.request.expected_generation, tokenOk: staleCall.body.request.id_token === tokenP3 } : null)
    );
    check(
      "実画面: 手順3のログが 409 stale_generation と対応する",
      logText(window).includes("手順3の送信 -> 409 stale_generation") && logText(window).includes(trialId),
      logText(window).slice(-400)
    );
    check(
      "実画面: 手順3の完了後に段階が p3-completed になる",
      stateText(window).includes('"phase": "p3-completed"'),
      stateText(window).slice(0, 200)
    );
    check(
      "実画面: 手順3の送信後に認可者ハッシュの表示が消去される",
      el(window, "p3Hash").textContent.includes("消去されました"),
      `p3Hash=${el(window, "p3Hash").textContent}`
    );
    // 手順4。
    const [token41, token42] = await captureP4(window, SUB_A, SUB_A);
    check(
      "実画面: 手順4の nonce 発行が送信器入口（手順 concurrent・2件）で行われる",
      window.__nonceCalls.length === 2 && window.__nonceCalls[1].procedure === "concurrent",
      JSON.stringify(window.__nonceCalls.map((c) => c.procedure))
    );
    check(
      "実画面: 手順4の2件の認可が同一主体（A）で B・C と異なることが確認される",
      el(window, "p4Facts").textContent.includes("確認済み"),
      el(window, "p4Facts").textContent
    );
    checkBox(window, "p4Confirmed");
    el(window, "completeP4").click();
    await sleep(300);
    check(
      "実画面: 手順4の認可完了後に段階が p4-captured になる",
      stateText(window).includes('"phase": "p4-captured"'),
      stateText(window).slice(0, 200)
    );
    el(window, "freezeP4").click();
    await sleep(300);
    const frozenP4Text = el(window, "frozenP4").textContent;
    check(
      "実画面: 手順4の凍結表示に2件とも対象・期待世代3が含まれる",
      frozenP4Text.includes(HASH_C) &&
        (frozenP4Text.match(/期待世代: 3/g) || []).length === 2 &&
        frozenP4Text.includes("スロット 1/2") &&
        frozenP4Text.includes("スロット 2/2"),
      frozenP4Text.slice(0, 300)
    );
    check("実画面: 手順4は送信前確認チェックなしでは送信ボタンが無効", el(window, "sendP4").disabled);
    checkBox(window, "preRead4");
    check("実画面: 事前確認後に手順4の送信ボタンが有効になる", !el(window, "sendP4").disabled);
    window.__concQueue = [{
      results: [
        { slot: 0, status: 200, error: null, generation: 4 },
        { slot: 1, status: 409, error: "stale_generation", generation: null },
      ],
    }];
    el(window, "sendP4").click();
    await sleep(800);
    check("実画面: 手順4の送信指示が1回だけ行われる", window.__concCalls.length === 1, `calls=${window.__concCalls.length}`);
    const concCall = window.__concCalls[0] || {};
    check(
      "実画面: 手順4の送信本体が2件同一（対象C・期待世代3）で、トークンだけが異なる",
      concCall.body &&
        concCall.body.trial_id === trialId &&
        Array.isArray(concCall.body.requests) &&
        concCall.body.requests.length === 2 &&
        concCall.body.requests[0].subject_hash === HASH_C &&
        concCall.body.requests[1].subject_hash === HASH_C &&
        concCall.body.requests[0].expected_generation === 3 &&
        concCall.body.requests[1].expected_generation === 3 &&
        concCall.body.requests[0].id_token === token41 &&
        concCall.body.requests[1].id_token === token42 &&
        token41 !== token42,
      JSON.stringify(concCall.body ? { n: concCall.body.requests?.length, tokensOk: concCall.body.requests?.[0]?.id_token === token41 && concCall.body.requests?.[1]?.id_token === token42 } : null)
    );
    check(
      "実画面: 手順4の集計ログが成功1件・stale 1件と対応する",
      logText(window).includes("200 ok（generation 4）=1件") &&
        logText(window).includes("409 stale_generation=1件"),
      logText(window).slice(-500)
    );
    check(
      "実画面: 手順4の完了後に段階が completed になる",
      stateText(window).includes('"phase": "completed"'),
      stateText(window).slice(0, 200)
    );
    check(
      "実画面: 完了後に主体ハッシュの表示が消去される",
      el(window, "cHash").textContent.includes("消去されました") &&
        el(window, "bHash").textContent.includes("消去されました") &&
        el(window, "p4Hash").textContent.includes("消去されました"),
      `cHash=${el(window, "cHash").textContent} p4Hash=${el(window, "p4Hash").textContent}`
    );
    check(
      "実画面: ログにトークン・nonce・主体ハッシュが出ない",
      !logText(window).includes(tokenC) &&
        !logText(window).includes(tokenB) &&
        !logText(window).includes(tokenP3) &&
        !logText(window).includes(token41) &&
        !logText(window).includes(token42) &&
        !logText(window).includes("sender-nonce-") &&
        !logText(window).includes(HASH_C) &&
        !logText(window).includes(HASH_B) &&
        !logText(window).includes(HASH_A),
      logText(window).slice(-400)
    );
    window.close();
  }

  // ---- 場面3：C と B が同一アカウントの場合は target_matches_operator で停止する ----
  {
    const { window } = await makeDom();
    await newTrial(window);
    await captureBrowserRole(window, "prepC", SUB_C);
    checkBox(window, "cConfirmed");
    el(window, "completeC").click();
    await sleep(300);
    await captureBrowserRole(window, "prepB", SUB_C);
    checkBox(window, "bConfirmed");
    el(window, "completeB").click();
    await sleep(300);
    check(
      "実画面: 同一主体の参照取得で target_matches_operator がログに残る",
      logText(window).includes("target_matches_operator"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 同一主体の検出後に試行が停止し、送信指示ができない",
      window.__staleCalls.length === 0 && window.__concCalls.length === 0,
      `stale=${window.__staleCalls.length} conc=${window.__concCalls.length}`
    );
    window.close();
  }

  // ---- 場面4：順序の固定。参照取得の前に手順3の準備はできない ----
  {
    const { window } = await makeDom();
    await newTrial(window);
    const before = window.__gis.callbacks.length;
    dispatchClick(window, "prepP3");
    await sleep(500);
    check(
      "実画面: 参照取得の前に手順3の準備をしても GIS コールバックが登録されない",
      window.__gis.callbacks.length === before && window.__nonceCalls.length === 0,
      `callbacks=${window.__gis.callbacks.length} nonceCalls=${window.__nonceCalls.length}`
    );
    check(
      "実画面: 順序外の準備でエラーがログに残る",
      logText(window).includes("準備エラー"),
      logText(window).slice(-300)
    );
    window.close();
  }

  // ---- 場面5：手順3が期待外れ応答（200）なら停止し、手順4へ進めず再送しない ----
  {
    const { window } = await makeDom();
    await proceedThroughStale(window, { status: 200, error: null, generation: 3 });
    check(
      "実画面: 手順3の 200 は期待外れとしてログに残る",
      logText(window).includes("手順3の送信 -> 200 ok"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 手順3の期待外れ後に段階が halted になる",
      stateText(window).includes('"phase": "halted"'),
      stateText(window).slice(0, 200)
    );
    const before = window.__gis.callbacks.length;
    dispatchClick(window, "prepP4");
    await sleep(500);
    check(
      "実画面: 停止後は手順4の準備ができず、再送もされない",
      window.__gis.callbacks.length === before &&
        window.__staleCalls.length === 1 &&
        window.__concCalls.length === 0,
      `callbacks=${window.__gis.callbacks.length} stale=${window.__staleCalls.length}`
    );
    window.close();
  }

  // ---- 場面6：手順3の送信指示の通信失敗は状態未確定として停止し、再送しない ----
  {
    const { window } = await makeDom();
    const trialId = await newTrial(window);
    await captureBrowserRole(window, "prepC", SUB_C);
    checkBox(window, "cConfirmed");
    el(window, "completeC").click();
    await sleep(300);
    await captureBrowserRole(window, "prepB", SUB_B);
    checkBox(window, "bConfirmed");
    el(window, "completeB").click();
    await sleep(300);
    await captureP3(window, SUB_A);
    checkBox(window, "p3Confirmed");
    el(window, "completeP3").click();
    await sleep(300);
    el(window, "freezeStale").click();
    await sleep(300);
    checkBox(window, "preRead3");
    window.__staleShouldThrow = true;
    el(window, "sendStale").click();
    await sleep(800);
    check(
      "実画面: 送信指示の通信失敗は状態未確定としてログに残る",
      logText(window).includes("手順3の送信 -> 応答なし（状態未確定、再送しません）") &&
        logText(window).includes(trialId),
      logText(window).slice(-300)
    );
    check(
      "実画面: 状態未確定の停止は undetermined を伴う",
      stateText(window).includes('"phase": "halted"') &&
        stateText(window).includes('"undetermined": true'),
      stateText(window).slice(0, 200)
    );
    window.close();
  }

  // ---- 場面7：手順4の2件の認可者が異なれば authorizer_mismatch で停止する ----
  {
    const { window } = await makeDom();
    await proceedThroughStale(window, { status: 409, error: "stale_generation", generation: null });
    await captureP4(window, SUB_A, SUB_X);
    checkBox(window, "p4Confirmed");
    el(window, "completeP4").click();
    await sleep(300);
    check(
      "実画面: 認可者の不一致で authorizer_mismatch がログに残る",
      logText(window).includes("authorizer_mismatch"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 認可者の不一致後に同時送信の指示ができない",
      window.__concCalls.length === 0,
      `conc=${window.__concCalls.length}`
    );
    window.close();
  }

  // ---- 場面8：手順4の認可者が B の場合は wrong_authorizer で停止する ----
  {
    const { window } = await makeDom();
    await proceedThroughStale(window, { status: 409, error: "stale_generation", generation: null });
    await captureP4(window, SUB_B, SUB_B);
    checkBox(window, "p4Confirmed");
    el(window, "completeP4").click();
    await sleep(300);
    check(
      "実画面: 認可者が B の場合に wrong_authorizer がログに残る",
      logText(window).includes("wrong_authorizer"),
      logText(window).slice(-300)
    );
    check(
      "実画面: wrong_authorizer 後に同時送信の指示ができない",
      window.__concCalls.length === 0,
      `conc=${window.__concCalls.length}`
    );
    window.close();
  }

  // ---- 場面9：手順4の成功が2件なら停止し、再送しない ----
  {
    const { window } = await makeDom();
    await proceedThroughStale(window, { status: 409, error: "stale_generation", generation: null });
    await captureP4(window, SUB_A, SUB_A);
    checkBox(window, "p4Confirmed");
    el(window, "completeP4").click();
    await sleep(300);
    el(window, "freezeP4").click();
    await sleep(300);
    checkBox(window, "preRead4");
    window.__concQueue = [{
      results: [
        { slot: 0, status: 200, error: null, generation: 4 },
        { slot: 1, status: 200, error: null, generation: 4 },
      ],
    }];
    el(window, "sendP4").click();
    await sleep(800);
    check(
      "実画面: 成功2件は期待外れとして段階が halted になる",
      stateText(window).includes('"phase": "halted"') &&
        logText(window).includes("200 ok（generation 4）=2件"),
      stateText(window).slice(0, 200)
    );
    check(
      "実画面: 成功2件でも送信指示は1回だけで、再送しない",
      window.__concCalls.length === 1,
      `conc=${window.__concCalls.length}`
    );
    window.close();
  }

  // ---- 場面10：手順4に応答なしがあれば状態未確定として停止する ----
  {
    const { window } = await makeDom();
    await proceedThroughStale(window, { status: 409, error: "stale_generation", generation: null });
    await captureP4(window, SUB_A, SUB_A);
    checkBox(window, "p4Confirmed");
    el(window, "completeP4").click();
    await sleep(300);
    el(window, "freezeP4").click();
    await sleep(300);
    checkBox(window, "preRead4");
    window.__concQueue = [{
      results: [
        { slot: 0, status: 200, error: null, generation: 4 },
        { slot: 1, status: null, error: "no_response", generation: null },
      ],
    }];
    el(window, "sendP4").click();
    await sleep(800);
    check(
      "実画面: 応答なしは状態未確定としてログに残る",
      logText(window).includes("応答なしのスロットがあります（状態未確定、再送しません") &&
        logText(window).includes("応答なし=1件"),
      logText(window).slice(-400)
    );
    check(
      "実画面: 状態未確定の停止は undetermined を伴う",
      stateText(window).includes('"phase": "halted"') &&
        stateText(window).includes('"undetermined": true'),
      stateText(window).slice(0, 200)
    );
    window.close();
  }

  // ---- 場面11：手順4の送信中は二重送信が起きない ----
  {
    const { window } = await makeDom();
    await proceedThroughStale(window, { status: 409, error: "stale_generation", generation: null });
    await captureP4(window, SUB_A, SUB_A);
    checkBox(window, "p4Confirmed");
    el(window, "completeP4").click();
    await sleep(300);
    el(window, "freezeP4").click();
    await sleep(300);
    checkBox(window, "preRead4");
    window.__concDelayMs = 600;
    window.__concQueue = [{
      results: [
        { slot: 0, status: 200, error: null, generation: 4 },
        { slot: 1, status: 409, error: "stale_generation", generation: null },
      ],
    }];
    el(window, "sendP4").click();
    dispatchClick(window, "sendP4");
    await sleep(1200);
    check(
      "実画面: 送信中の二重クリックでも送信指示は1回だけ行われる",
      window.__concCalls.length === 1,
      `conc=${window.__concCalls.length}`
    );
    check(
      "実画面: 二重送信防止の後も S11 は完了する",
      stateText(window).includes('"phase": "completed"'),
      stateText(window).slice(0, 200)
    );
    window.close();
  }

  // ---- 場面12：送信器の事前確認で拒否された場合は、送信されていない旨を出して停止する ----
  {
    const { window } = await makeDom();
    const trialId = await newTrial(window);
    await captureBrowserRole(window, "prepC", SUB_C);
    checkBox(window, "cConfirmed");
    el(window, "completeC").click();
    await sleep(300);
    await captureBrowserRole(window, "prepB", SUB_B);
    checkBox(window, "bConfirmed");
    el(window, "completeB").click();
    await sleep(300);
    await captureP3(window, SUB_A);
    checkBox(window, "p3Confirmed");
    el(window, "completeP3").click();
    await sleep(300);
    el(window, "freezeStale").click();
    await sleep(300);
    checkBox(window, "preRead3");
    window.__staleQueue = [{ instructionError: "s11_nonces_expired", instructionStatus: 410 }];
    el(window, "sendStale").click();
    await sleep(800);
    check(
      "実画面: 事前確認の拒否は「送信されていない」旨とともにログに残る",
      logText(window).includes("送信指示エラー: s11_nonces_expired（1件も送信されていません。試行を停止します）"),
      logText(window).slice(-300)
    );
    check(
      "実画面: 事前確認の拒否後に試行が破棄される",
      stateText(window).includes("（試行がありません）"),
      stateText(window).slice(0, 200)
    );
    window.close();
  }
} catch (e) {
  console.log("FAIL  実画面試験の実行中に例外:", e.message);
  results.push({ name: "実画面試験の実行", pass: false });
} finally {
  child.kill();
  await mf.dispose().catch(() => {});
  rmSync(path.join(ROOT, ".persist-screen-s11"), { recursive: true, force: true });
}

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log(`\n===== 実画面結果: ${passed} PASS / ${failed.length} FAIL（全 ${results.length} 件） =====`);
if (failed.length) {
  for (const f of failed) console.log(`  FAIL: ${f.name}`);
  process.exit(1);
}
