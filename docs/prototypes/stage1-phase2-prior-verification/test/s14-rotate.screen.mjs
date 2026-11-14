// S14 ローテーション専用画面（public/s14-rotate.html）の実画面試験。
// 実行: node test/s14-rotate.screen.mjs
// （npm run test:screen:s14 でも実行できる）
//
// 目的：文字列の存在確認ではなく、ページ自体を DOM で実行し、
// 対象 A・B の取得 → A の認可 → ローテーションの凍結 → ローテー
// ションの送信指示 → A の提示（403 not_operator が期待結果＝
// 合格）→ B の提示の gating・送信引数・順序の強制・ログの秘密
// 不出力を検証する。実 Google・実 Worker は使わない。
//
// 実行環境の制約：この VM では実ブラウザーの起動ができないため
// jsdom でページを実行する（s13-revoke.screen.mjs と同じ方式）。
// - GIS は偽物（beforeParse で window.google を差し替え、本物の
//   gsi/client は空の応答を返す）。
// - JWKS はインターセプターで偽物の公開鍵集合を返す。ID トークン
//   はその場で生成した RSA 鍵で署名した RS256 JWT で、ページ内の
//   JWKS 署名検証を通る。A・B は異なる sub で発行する。
// - /s14/nonces・/s14/freeze-rotate・/s14/send-rotate・
//   /s14/send-verify-only はインターセプターで要求を記録し、
//   場面ごとに用意した応答を返す。対象取得の /nonce も
//   インターセプターで偽の nonce を返す。送信器と実 Worker へは
//   送らない（送信器の実物確認は test/s14-sender.test.mjs と
//   test/s14-guard.test.mjs、入口の実物確認は
//   test/serve-real-s14.test.mjs）。
// - 送信窓の時間切れは、実時間では再現に時間がかかるため画面
//   試験では扱わない（状態機械と送信器の単体試験で境界を確認
//   する）。
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
const SERVE_PORT = 8909;
const CLIENT_ID = "screen-s14-client-id.apps.googleusercontent.com";
const ENV_ID = "stage1-phase2-verification-local";
const NOW = Math.floor(Date.now() / 1000);
const SUB_A = "screen-subject-A";
const SUB_B = "screen-subject-B";
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const HASH_A = sha256hex(SUB_A);
const HASH_B = sha256hex(SUB_B);

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

rmSync(path.join(ROOT, ".persist-screen-s14"), { recursive: true, force: true });
const mf = new Miniflare({
  modules: true,
  scriptPath: path.join(ROOT, "src", "worker.js"),
  compatibilityDate: "2025-01-01",
  durableObjects: { REGISTRY: { className: "RegistryDO", useSQLite: true } },
  durableObjectsPersist: path.join(ROOT, ".persist-screen-s14"),
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
      const r = await fetch(base + "/s14-rotate");
      if (r.status === 200) return true;
    } catch { /* 起動待ち */ }
    await sleep(200);
  }
  return false;
}

try {
  const ready = await waitReady();
  check("実画面: serve-real が起動し、s14-rotate 画面を返す", ready, childLog.slice(-400));
  if (!ready) throw new Error("serve-real が起動しませんでした");

  // ページと検証モジュールの実ソースを取得し、インライン・
  // モジュールの import を解決して古典スクリプト化する。
  const pageHtml = await (await fetch(base + "/s14-rotate")).text();
  const s14Js = await (await fetch(base + "/s14-rotate.mjs")).text();
  const s9Js = await (await fetch(base + "/s9-negative.mjs")).text();
  const trialJs = await (await fetch(base + "/trial-apply.mjs")).text();
  const verifyJs = await (await fetch(base + "/subject-hash-verify.mjs")).text();
  const sessionMatch = pageHtml.match(/const S14_SESSION = "([^"]+)"/);
  const SERVED_SESSION = sessionMatch ? sessionMatch[1] : null;
  const inlineModule = pageHtml.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!inlineModule) throw new Error("ページ内にインライン・モジュールが見つかりません");
  const classic =
    stripModule(verifyJs) + "\n" + stripModule(trialJs) + "\n" + stripModule(s9Js) + "\n" +
    stripModule(s14Js) + "\n" + stripModule(inlineModule[1]);
  const testHtml = pageHtml
    .replace(inlineModule[0], "")
    .replace("</body>", `<script>${classic}</script>\n</body>`);
  check("実画面: ページのモジュール import を解決できる", testHtml.includes("createS14Session"));

  async function makeDom() {
    const vc = new VirtualConsole();
    const jsdomErrors = [];
    vc.on("jsdomError", (e) => jsdomErrors.push(String(e && e.detail ? e.detail : e)));
    const dom = new JSDOM(testHtml, {
      url: base + "/s14-rotate",
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
          disableAutoSelect() {},
        } } };
        window.__fakeJwks = FAKE_JWKS;
        // 送信器入口と対象取得 nonce の記録と場面ごとの応答。
        window.__directNonceCalls = [];
        window.__nonceCalls = [];
        window.__freezeCalls = [];
        window.__rotateCalls = [];
        window.__verifyCalls = [];
        window.__rotateQueue = [];
        window.__verifyQueue = [];
        window.__rotateShouldThrow = false;
        window.__verifyShouldThrow = false;
        window.__senderNonceCounter = 0;
        window.__directNonceCounter = 0;
        const nodeFetch = fetch;
        window.fetch = async (input, init = {}) => {
          const rawUrl = typeof input === "string" ? input : input.url;
          const url = new URL(rawUrl, window.location.href).href;
          const pathname = new URL(url).pathname;
          const method = (init.method || "GET").toUpperCase();
          if (url.includes("oauth2/v3/certs")) {
            return new Response(JSON.stringify(window.__fakeJwks), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (pathname === "/s14/nonces") {
            const u = new URL(url);
            window.__nonceCalls.push({
              url,
              slot: u.searchParams.get("slot"),
              trialId: u.searchParams.get("trial_id"),
              session: (init.headers || {})["x-s14-session"],
            });
            window.__senderNonceCounter += 1;
            return new Response(JSON.stringify({ nonce: `sender-nonce-${window.__senderNonceCounter}` }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (pathname === "/nonce") {
            window.__directNonceCalls.push({ url });
            window.__directNonceCounter += 1;
            return new Response(JSON.stringify({ nonce: `direct-nonce-${window.__directNonceCounter}` }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (pathname === "/s14/freeze-rotate") {
            let body = null;
            try {
              body = JSON.parse(init.body);
            } catch { /* 本体が読めなければ null のまま */ }
            window.__freezeCalls.push({
              url,
              method,
              session: (init.headers || {})["x-s14-session"],
              body,
            });
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (pathname === "/s14/send-rotate" || pathname === "/s14/send-verify-only") {
            const isRotate = pathname === "/s14/send-rotate";
            let body = null;
            try {
              body = JSON.parse(init.body);
            } catch { /* 本体が読めなければ null のまま */ }
            const record = {
              url,
              method,
              session: (init.headers || {})["x-s14-session"],
              contentType: (init.headers || {})["content-type"],
              body,
            };
            const queue = isRotate ? window.__rotateQueue : window.__verifyQueue;
            if (isRotate) {
              window.__rotateCalls.push(record);
              if (window.__rotateShouldThrow) throw new Error("network down (test)");
            } else {
              window.__verifyCalls.push(record);
              if (window.__verifyShouldThrow) throw new Error("network down (test)");
            }
            const next = queue.shift() ||
              { status: 500, error: "unexpected_error", generation: null };
            if (next.instructionError) {
              return new Response(JSON.stringify({ error: next.instructionError }), {
                status: next.instructionStatus || 409,
                headers: { "Content-Type": "application/json" },
              });
            }
            return new Response(JSON.stringify(next), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return nodeFetch(url, { ...init, method });
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
  function phaseOf(window) {
    const m = stateText(window).match(/"phase": "([^"]+)"/);
    return m ? m[1] : null;
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
  // スロットの捕捉。prep は nonce を取得してからボタンを描く
  // ため、GIS コールバックの登録を待つ。
  async function captureSlot(window, prepId, sub) {
    const before = window.__gis.callbacks.length;
    el(window, prepId).click();
    const ok = await waitFor(() => window.__gis.callbacks.length > before);
    if (!ok) throw new Error(`${prepId} の準備で GIS コールバックが登録されませんでした`);
    return invokeLatestCallback(window, sub);
  }
  // 手順1の凍結まで進める共通の運転。
  async function driveToFrozen(window) {
    await newTrial(window);
    await captureSlot(window, "prepTargetA", SUB_A);
    checkBox(window, "targetAConfirmed");
    el(window, "completeTargetA").click();
    await captureSlot(window, "prepTargetB", SUB_B);
    checkBox(window, "targetBConfirmed");
    el(window, "completeTargetB").click();
    const tokenRotate = await captureSlot(window, "prepRotateAB", SUB_A);
    checkBox(window, "rotateABConfirmed");
    el(window, "completeRotateAB").click();
    el(window, "freezeRotate").click();
    // 凍結した対象の組の送信器への固定が済むまで待つ（固定の完了
    // 前は送信ボタンが有効にならない）。
    const froze = await waitFor(() => logText(window).includes("手順1のローテーション要求を凍結しました"));
    if (!froze) throw new Error("ローテーション要求が凍結されませんでした: " + logText(window).slice(-300));
    return { tokenRotate };
  }
  // 手順1の送信まで進める共通の運転。
  async function driveToRotateSent(window) {
    const tokens = await driveToFrozen(window);
    checkBox(window, "preRead");
    window.__rotateQueue.push({ status: 200, error: null, generation: 7 });
    el(window, "sendRotate").click();
    const ok = await waitFor(() => logText(window).includes("手順1の送信 -> 200 ok"));
    if (!ok) throw new Error("ローテーションの送信が記録されませんでした: " + logText(window).slice(-300));
    return tokens;
  }

  // ===== 場面1：正常系（対象取得→ローテーション→A提示の拒否→B提示） =====
  {
    const { window } = await makeDom();
    const trialId = await newTrial(window);
    check("場面1: 試行開始直後はローテーション送信・提示が無効",
      el(window, "sendRotate").disabled === true && el(window, "sendCheckA").disabled === true &&
      el(window, "sendCheckB").disabled === true);
    const tokenTargetA = await captureSlot(window, "prepTargetA", SUB_A);
    check("場面1: 手順0aの A の主体ハッシュが画面に表示される",
      el(window, "targetAHash").textContent === HASH_A);
    check("場面1: 対象取得の nonce は /nonce から直接取得され、送信器の nonce はまだ使われない",
      window.__directNonceCalls.length === 1 && window.__nonceCalls.length === 0);
    checkBox(window, "targetAConfirmed");
    el(window, "completeTargetA").click();
    check("場面1: 対象A取得の完了で段階が targeta-captured になる", phaseOf(window) === "targeta-captured");
    const tokenTargetB = await captureSlot(window, "prepTargetB", SUB_B);
    check("場面1: 手順0bの B の主体ハッシュが画面に表示され、A と異なることが確認済みになる",
      el(window, "targetBHash").textContent === HASH_B &&
      el(window, "targetBFacts").textContent.includes("確認済み"));
    checkBox(window, "targetBConfirmed");
    el(window, "completeTargetB").click();
    check("場面1: 対象B取得の完了で段階が targetb-captured になる",
      phaseOf(window) === "targetb-captured");
    const tokenRotate = await captureSlot(window, "prepRotateAB", SUB_A);
    check("場面1: 手順1の nonce 取得はスロット rotateAB で送信器へ行き、セッションが付く",
      window.__nonceCalls.length === 1 && window.__nonceCalls[0].slot === "rotateAB" &&
      window.__nonceCalls[0].trialId === trialId && window.__nonceCalls[0].session === SERVED_SESSION);
    check("場面1: 認可者がローテーション元 A と同一であることが表示で確認済みになる",
      el(window, "rotateABFacts").textContent.includes("確認済み"));
    checkBox(window, "rotateABConfirmed");
    el(window, "completeRotateAB").click();
    check("場面1: 認可の完了で段階が rotateab-captured になる",
      phaseOf(window) === "rotateab-captured");
    el(window, "freezeRotate").click();
    await waitFor(() => logText(window).includes("手順1のローテーション要求を凍結しました"));
    const frozenText = el(window, "frozenRotate").textContent;
    check("場面1: 凍結表示が凍結内容（rotate・旧主体 A・新主体 B・期待世代6・送信先）から作られる",
      frozenText.includes("rotate") && frozenText.includes(HASH_A) &&
      frozenText.includes(HASH_B) && frozenText.includes("期待世代： 6") &&
      frozenText.includes("/admin/registry/rotate"),
      frozenText);
    check("場面1: 凍結した対象の組（旧主体 A・新主体 B）が送信器へ固定として送られる",
      window.__freezeCalls.length === 1 &&
      window.__freezeCalls[0].body.trial_id === trialId &&
      window.__freezeCalls[0].body.old_subject_hash === HASH_A &&
      window.__freezeCalls[0].body.new_subject_hash === HASH_B &&
      window.__freezeCalls[0].session === SERVED_SESSION);
    check("場面1: 読み戻し未確認ではローテーション送信ボタンが無効",
      el(window, "sendRotate").disabled === true);
    checkBox(window, "preRead");
    check("場面1: 読み戻し確認でローテーション送信ボタンが有効になる",
      el(window, "sendRotate").disabled === false);
    window.__rotateQueue.push({ status: 200, error: null, generation: 7 });
    el(window, "sendRotate").click();
    await waitFor(() => logText(window).includes("手順1の送信 -> 200 ok"));
    check("場面1: ローテーションの送信指示が1回だけ送信器へ行く",
      window.__rotateCalls.length === 1);
    const rotateBody = window.__rotateCalls[0].body;
    check("場面1: ローテーションの送信引数が凍結内容と A のトークンである",
      rotateBody.trial_id === trialId && rotateBody.slot === "rotateAB" &&
      rotateBody.request.old_subject_hash === HASH_A &&
      rotateBody.request.new_subject_hash === HASH_B &&
      rotateBody.request.expected_generation === 6 && rotateBody.request.id_token === tokenRotate);
    check("場面1: ローテーションの後に段階が rotateab-sent になる", phaseOf(window) === "rotateab-sent");
    const tokenCheckA = await captureSlot(window, "prepCheckA", SUB_A);
    check("場面1: 手順2のAが手順1の認可者Aと同一であることが表示で確認済みになる",
      el(window, "checkAFacts").textContent.includes("確認済み"));
    checkBox(window, "checkAConfirmed");
    el(window, "completeCheckA").click();
    window.__verifyQueue.push({ status: 403, error: "not_operator", generation: null });
    el(window, "sendCheckA").click();
    await waitFor(() => logText(window).includes("手順2の提示 -> 403 not_operator"));
    check("場面1: 手順2の 403 not_operator は期待結果として記録され、段階が checka-recorded になる",
      phaseOf(window) === "checka-recorded" &&
      logText(window).includes("次回操作で拒否されます"));
    const verifyABody = window.__verifyCalls[0].body;
    check("場面1: 手順2の提示はスロット checkA で手順2のトークンを使う",
      window.__verifyCalls.length === 1 && verifyABody.slot === "checkA" &&
      verifyABody.request.id_token === tokenCheckA);
    const tokenCheckB = await captureSlot(window, "prepCheckB", SUB_B);
    check("場面1: 手順3のBが手順0bの対象 B と同一であることが表示で確認済みになる",
      el(window, "checkBFacts").textContent.includes("確認済み"));
    checkBox(window, "checkBConfirmed");
    el(window, "completeCheckB").click();
    window.__verifyQueue.push({ status: 200, error: null, generation: 7 });
    el(window, "sendCheckB").click();
    await waitFor(() => phaseOf(window) === "completed");
    check("場面1: 全手順が完了し、完了の記録がログに出る",
      logText(window).includes("S14 完了です"));
    check("場面1: 手順3の提示はスロット checkB で手順3のトークンを使う",
      window.__verifyCalls.length === 2 && window.__verifyCalls[1].body.slot === "checkB" &&
      window.__verifyCalls[1].body.request.id_token === tokenCheckB);
    const allLog = logText(window);
    check("場面1: ログにトークン・主体ハッシュ・nonce の値が出ない",
      !allLog.includes(tokenTargetA) && !allLog.includes(tokenTargetB) &&
      !allLog.includes(tokenRotate) && !allLog.includes(tokenCheckA) &&
      !allLog.includes(tokenCheckB) &&
      !allLog.includes(HASH_A) && !allLog.includes(HASH_B) &&
      !allLog.includes("sender-nonce-") && !allLog.includes("direct-nonce-"));
    check("場面1: 主体ハッシュ表示は消去されている（完了時の消去）",
      el(window, "targetAHash").textContent === "（消去されました）" &&
      el(window, "checkBHash").textContent === "（消去されました）");
    window.close();
  }

  // ===== 場面2：ローテーションが 409 で拒否されたら停止し、手順2へ進めない =====
  {
    const { window } = await makeDom();
    await driveToFrozen(window);
    checkBox(window, "preRead");
    window.__rotateQueue.push({ status: 409, error: "stale_generation", generation: null });
    el(window, "sendRotate").click();
    await waitFor(() => logText(window).includes("手順1の送信 -> 409 stale_generation"));
    check("場面2: ローテーションの 409 で段階が halted になる", phaseOf(window) === "halted");
    const gisBefore = window.__gis.callbacks.length;
    dispatchClick(window, "prepCheckA");
    await sleep(300);
    check("場面2: 停止後は手順2の準備が始まらない",
      window.__gis.callbacks.length === gisBefore && window.__rotateCalls.length === 1);
    window.close();
  }

  // ===== 場面3：手順2で 200 が返ったら（ローテーション元がまだ通ったら）停止する =====
  {
    const { window } = await makeDom();
    await driveToRotateSent(window);
    await captureSlot(window, "prepCheckA", SUB_A);
    checkBox(window, "checkAConfirmed");
    el(window, "completeCheckA").click();
    window.__verifyQueue.push({ status: 200, error: null, generation: 7 });
    el(window, "sendCheckA").click();
    await waitFor(() => logText(window).includes("手順2の提示の結果は期待と一致しませんでした"));
    check("場面3: 手順2の 200 は期待外れとして halted になる", phaseOf(window) === "halted");
    const gisBefore = window.__gis.callbacks.length;
    dispatchClick(window, "prepCheckB");
    await sleep(300);
    check("場面3: 停止後は手順3の準備が始まらず、提示も送られない",
      window.__gis.callbacks.length === gisBefore && window.__verifyCalls.length === 1);
    window.close();
  }

  // ===== 場面4：ローテーションの送信指示が失敗したら状態未確定で停止 =====
  {
    const { window } = await makeDom();
    await driveToFrozen(window);
    checkBox(window, "preRead");
    window.__rotateShouldThrow = true;
    el(window, "sendRotate").click();
    await waitFor(() => logText(window).includes("状態未確定"));
    check("場面4: 送信指示の失敗は状態未確定として記録され、段階は halted",
      phaseOf(window) === "halted" && stateText(window).includes('"undetermined": true'),
      stateText(window));
    check("場面4: 送信指示は1回だけ試みられた（再送なし）",
      window.__rotateCalls.length === 1);
    window.close();
  }

  // ===== 場面5：手順1のログインが B（wrong_authorizer）で停止 =====
  {
    const { window } = await makeDom();
    await newTrial(window);
    await captureSlot(window, "prepTargetA", SUB_A);
    checkBox(window, "targetAConfirmed");
    el(window, "completeTargetA").click();
    await captureSlot(window, "prepTargetB", SUB_B);
    checkBox(window, "targetBConfirmed");
    el(window, "completeTargetB").click();
    await captureSlot(window, "prepRotateAB", SUB_B);
    checkBox(window, "rotateABConfirmed");
    el(window, "completeRotateAB").click();
    await sleep(200);
    check("場面5: 認可者がローテーション元 A と異なれば停止し、案内が出る",
      phaseOf(window) === "halted" &&
      logText(window).includes("この試行は停止しました"),
      logText(window).slice(-300));
    check("場面5: 停止後は凍結できず、送信もされない",
      el(window, "freezeRotate").disabled === true && window.__rotateCalls.length === 0);
    window.close();
  }

  // ===== 場面6：送信器の事前確認エラー（1件も送信されていない） =====
  {
    const { window } = await makeDom();
    await driveToFrozen(window);
    checkBox(window, "preRead");
    window.__rotateQueue.push({ instructionError: "s14_rotate_target_mismatch", instructionStatus: 409 });
    el(window, "sendRotate").click();
    await waitFor(() => logText(window).includes("送信器の事前確認で拒否されました"));
    check("場面6: 事前確認エラーでは理由コードが出て、再送手段がない",
      logText(window).includes("s14_rotate_target_mismatch") &&
      el(window, "sendRotate").disabled === true,
      logText(window).slice(-300));
    window.close();
  }
} finally {
  child.kill("SIGTERM");
  await relayClose();
}

async function relayClose() {
  // Miniflare の終了を await で待ち切ってから永続化ディレクト
  // リーを削除する。dispose を待たずに削除すると、開いたままの
  // SQLite ハンドルと競合して Windows で EPERM になり、全項目
  // PASS でも終了コードが 1 になる（S12 画面試験と同じ順序）。
  await mf.dispose().catch(() => {});
  rmSync(path.join(ROOT, ".persist-screen-s14"), { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n===== 実画面結果: ${results.length - failed.length} PASS / ${failed.length} FAIL =====`);
if (failed.length > 0) {
  process.exitCode = 1;
}
