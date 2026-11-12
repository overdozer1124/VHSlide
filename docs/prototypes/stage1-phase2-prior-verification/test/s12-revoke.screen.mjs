// S12 失効専用画面（public/s12-revoke.html）の実画面試験。
// 実行: node test/s12-revoke.screen.mjs
// （npm run test:screen:s12 でも実行できる）
//
// 目的：文字列の存在確認ではなく、ページ自体を DOM で実行し、
// B の保持 → A の認可 → 失効の凍結 → 失効の送信指示 → 新しい B の
// 提示 → 保持した失効前トークンの提示 → C の提示の gating・送信
// 引数・保持トークンの同一性・ログの秘密不出力を検証する。
// 実 Google・実 Worker は使わない。
//
// 実行環境の制約：この VM では実ブラウザーの起動ができないため
// jsdom でページを実行する（s11-parallel.screen.mjs と同じ方式）。
// - GIS は偽物（beforeParse で window.google を差し替え、本物の
//   gsi/client は空の応答を返す）。
// - JWKS はインターセプターで偽物の公開鍵集合を返す。ID トークン
//   はその場で生成した RSA 鍵で署名した RS256 JWT で、ページ内の
//   JWKS 署名検証を通る。A・B・C・X は異なる sub で発行する。
// - /s12/nonces・/s12/send-revoke・/s12/send-verify-only は
//   インターセプターで要求を記録し、場面ごとに用意した応答を
//   返す。送信器と実 Worker へは送らない（送信器の実物確認は
//   test/s12-sender.test.mjs と test/s12-guard.test.mjs）。
// - 保持トークンの鮮度の時間切れは、実時間では再現に時間が
//   かかるため画面試験では扱わない（状態機械と送信器の単体試験
//   で境界を確認する）。
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
const SERVE_PORT = 8905;
const CLIENT_ID = "screen-s12-client-id.apps.googleusercontent.com";
const ENV_ID = "stage1-phase2-verification-local";
const NOW = Math.floor(Date.now() / 1000);
const SUB_A = "screen-subject-A";
const SUB_B = "screen-subject-B";
const SUB_C = "screen-subject-C";
const SUB_X = "screen-subject-X";
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const HASH_A = sha256hex(SUB_A);
const HASH_B = sha256hex(SUB_B);
const HASH_C = sha256hex(SUB_C);

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

rmSync(path.join(ROOT, ".persist-screen-s12"), { recursive: true, force: true });
const mf = new Miniflare({
  modules: true,
  scriptPath: path.join(ROOT, "src", "worker.js"),
  compatibilityDate: "2025-01-01",
  durableObjects: { REGISTRY: { className: "RegistryDO", useSQLite: true } },
  durableObjectsPersist: path.join(ROOT, ".persist-screen-s12"),
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
      const r = await fetch(base + "/s12-revoke");
      if (r.status === 200) return true;
    } catch { /* 起動待ち */ }
    await sleep(200);
  }
  return false;
}

try {
  const ready = await waitReady();
  check("実画面: serve-real が起動し、s12-revoke 画面を返す", ready, childLog.slice(-400));
  if (!ready) throw new Error("serve-real が起動しませんでした");

  // ページと検証モジュールの実ソースを取得し、インライン・
  // モジュールの import を解決して古典スクリプト化する。
  const pageHtml = await (await fetch(base + "/s12-revoke")).text();
  const s12Js = await (await fetch(base + "/s12-revoke.mjs")).text();
  const s9Js = await (await fetch(base + "/s9-negative.mjs")).text();
  const trialJs = await (await fetch(base + "/trial-apply.mjs")).text();
  const verifyJs = await (await fetch(base + "/subject-hash-verify.mjs")).text();
  const sessionMatch = pageHtml.match(/const S12_SESSION = "([^"]+)"/);
  const SERVED_SESSION = sessionMatch ? sessionMatch[1] : null;
  const inlineModule = pageHtml.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!inlineModule) throw new Error("ページ内にインライン・モジュールが見つかりません");
  const classic =
    stripModule(verifyJs) + "\n" + stripModule(trialJs) + "\n" + stripModule(s9Js) + "\n" +
    stripModule(s12Js) + "\n" + stripModule(inlineModule[1]);
  const testHtml = pageHtml
    .replace(inlineModule[0], "")
    .replace("</body>", `<script>${classic}</script>\n</body>`);
  check("実画面: ページのモジュール import を解決できる", testHtml.includes("createS12Session"));

  async function makeDom() {
    const vc = new VirtualConsole();
    const jsdomErrors = [];
    vc.on("jsdomError", (e) => jsdomErrors.push(String(e && e.detail ? e.detail : e)));
    const dom = new JSDOM(testHtml, {
      url: base + "/s12-revoke",
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
        window.__revokeCalls = [];
        window.__verifyCalls = [];
        window.__revokeQueue = [];
        window.__verifyQueue = [];
        window.__revokeShouldThrow = false;
        window.__verifyShouldThrow = false;
        window.__senderNonceCounter = 0;
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
          if (url.includes("/s12/nonces")) {
            const u = new URL(url);
            window.__nonceCalls.push({
              url,
              slot: u.searchParams.get("slot"),
              trialId: u.searchParams.get("trial_id"),
              session: (init.headers || {})["x-s12-session"],
            });
            window.__senderNonceCounter += 1;
            return new Response(JSON.stringify({ nonce: `sender-nonce-${window.__senderNonceCounter}` }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (url.includes("/s12/send-revoke") || url.includes("/s12/send-verify-only")) {
            const isRevoke = url.includes("/s12/send-revoke");
            let body = null;
            try {
              body = JSON.parse(init.body);
            } catch { /* 本体が読めなければ null のまま */ }
            const record = {
              url,
              method,
              session: (init.headers || {})["x-s12-session"],
              contentType: (init.headers || {})["content-type"],
              body,
            };
            if (isRevoke) {
              window.__revokeCalls.push(record);
              if (window.__revokeShouldThrow) throw new Error("network down (test)");
              const next = window.__revokeQueue.shift() ||
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
            window.__verifyCalls.push(record);
            if (window.__verifyShouldThrow) throw new Error("network down (test)");
            const next = window.__verifyQueue.shift() ||
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
  // スロットの捕捉。prep は送信器から nonce を取得してからボタン
  // を描くため、GIS コールバックの登録を待つ。
  async function captureSlot(window, prepId, sub) {
    const before = window.__gis.callbacks.length;
    el(window, prepId).click();
    const ok = await waitFor(() => window.__gis.callbacks.length > before);
    if (!ok) throw new Error(`${prepId} の準備で GIS コールバックが登録されませんでした`);
    return invokeLatestCallback(window, sub);
  }
  // 手順2の凍結まで進める共通の運転。
  async function driveToFrozen(window) {
    await newTrial(window);
    const heldToken = await captureSlot(window, "prepHeldB", SUB_B);
    checkBox(window, "heldBConfirmed");
    el(window, "completeHeldB").click();
    const tokenA = await captureSlot(window, "prepA", SUB_A);
    checkBox(window, "aConfirmed");
    el(window, "completeA").click();
    el(window, "freezeRevoke").click();
    return { heldToken, tokenA };
  }
  // 失効の送信まで進める共通の運転。
  async function driveToRevokeSent(window) {
    const tokens = await driveToFrozen(window);
    checkBox(window, "preRead");
    window.__revokeQueue.push({ status: 200, error: null, generation: 5 });
    el(window, "sendRevoke").click();
    const ok = await waitFor(() => logText(window).includes("手順2の失効送信 -> 200 ok"));
    if (!ok) throw new Error("失効の送信が記録されませんでした: " + logText(window).slice(-300));
    return tokens;
  }

  // ===== 場面1：正常系（保持→失効→新しいB拒否→失効前トークン拒否→C成功） =====
  {
    const { window } = await makeDom();
    const trialId = await newTrial(window);
    check("場面1: 試行開始直後は失効送信・保持トークン提示が無効",
      el(window, "sendRevoke").disabled === true && el(window, "sendHeldB").disabled === true);
    const heldToken = await captureSlot(window, "prepHeldB", SUB_B);
    check("場面1: 手順1の B の主体ハッシュが画面に表示される",
      el(window, "heldBHash").textContent === HASH_B);
    check("場面1: nonce 取得はスロット heldB で送信器へ行き、セッションが付く",
      window.__nonceCalls.length === 1 && window.__nonceCalls[0].slot === "heldB" &&
      window.__nonceCalls[0].trialId === trialId && window.__nonceCalls[0].session === SERVED_SESSION);
    checkBox(window, "heldBConfirmed");
    el(window, "completeHeldB").click();
    check("場面1: 保持の完了で段階が held-captured になる", phaseOf(window) === "held-captured");
    check("場面1: 保持トークンの状態表示が「保持中（未提示）」になる",
      el(window, "heldStatus").textContent.includes("保持中（未提示）"));
    // 失効前の保持トークン提示は、合成イベントでも塞がれる。
    dispatchClick(window, "sendHeldB");
    await sleep(300);
    check("場面1: 失効前に保持トークンは提示されない（合成イベントでも）",
      window.__verifyCalls.length === 0 && phaseOf(window) === "held-captured");
    const tokenA = await captureSlot(window, "prepA", SUB_A);
    check("場面1: 認可者が B と異なることが表示で確認済みになる",
      el(window, "aFacts").textContent.includes("確認済み"));
    checkBox(window, "aConfirmed");
    el(window, "completeA").click();
    check("場面1: 認可の完了で段階が authorizer-captured になる",
      phaseOf(window) === "authorizer-captured");
    el(window, "freezeRevoke").click();
    const frozenText = el(window, "frozenRevoke").textContent;
    check("場面1: 凍結表示が凍結内容（revoke・B のハッシュ・期待世代4・送信先）から作られる",
      frozenText.includes("action: revoke") && frozenText.includes(HASH_B) &&
      frozenText.includes("期待世代: 4") && frozenText.includes("/admin/registry/revoke"),
      frozenText);
    check("場面1: 凍結表示に保持トークンの鮮度が含まれる",
      frozenText.includes("保持トークンの鮮度"));
    check("場面1: 読み戻し未確認では失効送信ボタンが無効",
      el(window, "sendRevoke").disabled === true);
    checkBox(window, "preRead");
    check("場面1: 読み戻し確認で失効送信ボタンが有効になる",
      el(window, "sendRevoke").disabled === false);
    window.__revokeQueue.push({ status: 200, error: null, generation: 5 });
    el(window, "sendRevoke").click();
    await waitFor(() => logText(window).includes("手順2の失効送信 -> 200 ok"));
    check("場面1: 失効の送信指示が1回だけ送信器へ行く",
      window.__revokeCalls.length === 1);
    const revokeBody = window.__revokeCalls[0].body;
    check("場面1: 失効の送信引数が凍結内容と A のトークンである",
      revokeBody.trial_id === trialId && revokeBody.request.subject_hash === HASH_B &&
      revokeBody.request.expected_generation === 4 && revokeBody.request.id_token === tokenA);
    check("場面1: 失効後に段階が revoke-sent になり、保持トークンはまだ保持中",
      phaseOf(window) === "revoke-sent" &&
      el(window, "heldStatus").textContent.includes("保持中（未提示）"));
    const freshToken = await captureSlot(window, "prepFreshB", SUB_B);
    check("場面1: 新しい B が失効対象と同一であることが表示で確認済みになる",
      el(window, "freshBFacts").textContent.includes("確認済み"));
    checkBox(window, "freshBConfirmed");
    el(window, "completeFreshB").click();
    window.__verifyQueue.push({ status: 403, error: "not_operator", generation: null });
    el(window, "sendFreshB").click();
    await waitFor(() => logText(window).includes("手順3（新しい B）の提示 -> 403 not_operator"));
    check("場面1: 手順3の提示はスロット freshB で新しい B のトークンを使う",
      window.__verifyCalls.length === 1 && window.__verifyCalls[0].body.slot === "freshB" &&
      window.__verifyCalls[0].body.request.id_token === freshToken);
    window.__verifyQueue.push({ status: 403, error: "not_operator", generation: null });
    el(window, "sendHeldB").click();
    await waitFor(() => logText(window).includes("手順4（保持した失効前トークン）の提示 -> 403 not_operator"));
    check("場面1: 手順4の提示はスロット heldB で手順1のトークンそのものを使う",
      window.__verifyCalls.length === 2 && window.__verifyCalls[1].body.slot === "heldB" &&
      window.__verifyCalls[1].body.request.id_token === heldToken);
    check("場面1: 提示の順序が freshB → heldB である",
      window.__verifyCalls.map((c) => c.body.slot).join(",") === "freshB,heldB");
    const tokenC = await captureSlot(window, "prepC", SUB_C);
    check("場面1: C が A・B のどちらとも異なることが表示で確認済みになる",
      el(window, "cFacts").textContent.includes("確認済み"));
    checkBox(window, "cConfirmed");
    el(window, "completeC").click();
    window.__verifyQueue.push({ status: 200, error: null, generation: 5 });
    el(window, "sendC").click();
    await waitFor(() => phaseOf(window) === "completed");
    check("場面1: 全手順が完了し、完了の記録がログに出る",
      logText(window).includes("S12 の全手順が期待どおりに終わりました"));
    check("場面1: 提示の順序が freshB → heldB → checkC で終わる",
      window.__verifyCalls.map((c) => c.body.slot).join(",") === "freshB,heldB,checkC" &&
      window.__verifyCalls[2].body.request.id_token === tokenC);
    const allLog = logText(window);
    check("場面1: ログにトークン・主体ハッシュ・nonce の値が出ない",
      !allLog.includes(heldToken) && !allLog.includes(tokenA) && !allLog.includes(tokenC) &&
      !allLog.includes(HASH_A) && !allLog.includes(HASH_B) && !allLog.includes(HASH_C) &&
      !allLog.includes("sender-nonce-"));
    check("場面1: 主体ハッシュ表示は消去されている（完了時の消去）",
      el(window, "heldBHash").textContent === "（消去されました）" &&
      el(window, "cHash").textContent === "（消去されました）");
    window.close();
  }

  // ===== 場面2：新しい B が別人（subject_mismatch）で停止 =====
  {
    const { window } = await makeDom();
    await driveToRevokeSent(window);
    await captureSlot(window, "prepFreshB", SUB_X);
    checkBox(window, "freshBConfirmed");
    el(window, "completeFreshB").click();
    await sleep(200);
    check("場面2: 新しい B が失効対象と異なれば subject_mismatch で停止する",
      logText(window).includes("subject_mismatch") && phaseOf(window) === "halted",
      logText(window).slice(-300));
    check("場面2: 停止後は提示が送られない", window.__verifyCalls.length === 0);
    window.close();
  }

  // ===== 場面3：失効が 409 で拒否されたら停止し、後段へ進めない =====
  {
    const { window } = await makeDom();
    await driveToFrozen(window);
    checkBox(window, "preRead");
    window.__revokeQueue.push({ status: 409, error: "stale_generation", generation: null });
    el(window, "sendRevoke").click();
    await waitFor(() => logText(window).includes("手順2の失効送信 -> 409 stale_generation"));
    check("場面3: 失効の 409 で段階が halted になる", phaseOf(window) === "halted");
    const gisBefore = window.__gis.callbacks.length;
    dispatchClick(window, "prepFreshB");
    await sleep(300);
    check("場面3: 停止後は手順3の準備が始まらない",
      window.__gis.callbacks.length === gisBefore && window.__verifyCalls.length === 0);
    window.close();
  }

  // ===== 場面4：失効の送信指示が失敗したら状態未確定で停止 =====
  {
    const { window } = await makeDom();
    await driveToFrozen(window);
    checkBox(window, "preRead");
    window.__revokeShouldThrow = true;
    el(window, "sendRevoke").click();
    await waitFor(() => logText(window).includes("状態未確定、再送しません"));
    check("場面4: 送信指示の失敗は状態未確定として記録され、段階は halted",
      phaseOf(window) === "halted" && stateText(window).includes('"undetermined": true'),
      stateText(window));
    check("場面4: 送信指示は1回だけ試みられた（再送なし）",
      window.__revokeCalls.length === 1);
    window.close();
  }

  // ===== 場面5：認可者が B 本人（wrong_authorizer）で停止 =====
  {
    const { window } = await makeDom();
    await newTrial(window);
    await captureSlot(window, "prepHeldB", SUB_B);
    checkBox(window, "heldBConfirmed");
    el(window, "completeHeldB").click();
    await captureSlot(window, "prepA", SUB_B);
    checkBox(window, "aConfirmed");
    el(window, "completeA").click();
    await sleep(200);
    check("場面5: 認可者が B と同一なら wrong_authorizer で停止する",
      logText(window).includes("wrong_authorizer"), logText(window).slice(-300));
    check("場面5: 停止後は凍結できない",
      el(window, "freezeRevoke").disabled === true && window.__revokeCalls.length === 0);
    window.close();
  }

  // ===== 場面6：送信器の事前確認エラー（1件も送信されていない） =====
  {
    const { window } = await makeDom();
    await driveToFrozen(window);
    checkBox(window, "preRead");
    window.__revokeQueue.push({ instructionError: "s12_held_token_stale", instructionStatus: 410 });
    el(window, "sendRevoke").click();
    await waitFor(() => logText(window).includes("1件も送信されていません"));
    check("場面6: 事前確認エラーでは試行が破棄され、再送手段がない",
      logText(window).includes("s12_held_token_stale") &&
      el(window, "sendRevoke").disabled === true,
      logText(window).slice(-300));
    window.close();
  }
} finally {
  child.kill("SIGTERM");
  relayClose();
}

function relayClose() {
  // Miniflare の終了と永続化ディレクトリーの削除。
  mf.dispose().catch(() => {});
  rmSync(path.join(ROOT, ".persist-screen-s12"), { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n===== 実画面結果: ${results.length - failed.length} PASS / ${failed.length} FAIL =====`);
if (failed.length > 0) {
  process.exitCode = 1;
}
