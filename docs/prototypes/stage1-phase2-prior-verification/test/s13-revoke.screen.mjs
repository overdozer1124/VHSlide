// S13 失効専用画面（public/s13-revoke.html）の実画面試験。
// 実行: node test/s13-revoke.screen.mjs
// （npm run test:screen:s13 でも実行できる）
//
// 目的：文字列の存在確認ではなく、ページ自体を DOM で実行し、
// 対象 C の取得 → A の認可 → 失効C の凍結 → 失効C の送信指示 →
// A 自身の失効試行（409 last_operator が期待結果＝合格）→ A の
// 提示の gating・送信引数・順序の強制・ログの秘密不出力を検証
// する。実 Google・実 Worker は使わない。
//
// 実行環境の制約：この VM では実ブラウザーの起動ができないため
// jsdom でページを実行する（s12-revoke.screen.mjs と同じ方式）。
// - GIS は偽物（beforeParse で window.google を差し替え、本物の
//   gsi/client は空の応答を返す）。
// - JWKS はインターセプターで偽物の公開鍵集合を返す。ID トークン
//   はその場で生成した RSA 鍵で署名した RS256 JWT で、ページ内の
//   JWKS 署名検証を通る。A・C・X は異なる sub で発行する。
// - /s13/nonces・/s13/freeze-revoke・/s13/send-revoke・
//   /s13/send-verify-only はインターセプターで要求を記録し、
//   場面ごとに用意した応答を返す。対象取得の /nonce も
//   インターセプターで偽の nonce を返す。送信器と実 Worker へは
//   送らない（送信器の実物確認は test/s13-sender.test.mjs と
//   test/s13-guard.test.mjs、入口の実物確認は
//   test/serve-real-s13.test.mjs）。
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
const SERVE_PORT = 8907;
const CLIENT_ID = "screen-s13-client-id.apps.googleusercontent.com";
const ENV_ID = "stage1-phase2-verification-local";
const NOW = Math.floor(Date.now() / 1000);
const SUB_A = "screen-subject-A";
const SUB_C = "screen-subject-C";
const SUB_X = "screen-subject-X";
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const HASH_A = sha256hex(SUB_A);
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

rmSync(path.join(ROOT, ".persist-screen-s13"), { recursive: true, force: true });
const mf = new Miniflare({
  modules: true,
  scriptPath: path.join(ROOT, "src", "worker.js"),
  compatibilityDate: "2025-01-01",
  durableObjects: { REGISTRY: { className: "RegistryDO", useSQLite: true } },
  durableObjectsPersist: path.join(ROOT, ".persist-screen-s13"),
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
      const r = await fetch(base + "/s13-revoke");
      if (r.status === 200) return true;
    } catch { /* 起動待ち */ }
    await sleep(200);
  }
  return false;
}

try {
  const ready = await waitReady();
  check("実画面: serve-real が起動し、s13-revoke 画面を返す", ready, childLog.slice(-400));
  if (!ready) throw new Error("serve-real が起動しませんでした");

  // ページと検証モジュールの実ソースを取得し、インライン・
  // モジュールの import を解決して古典スクリプト化する。
  const pageHtml = await (await fetch(base + "/s13-revoke")).text();
  const s13Js = await (await fetch(base + "/s13-revoke.mjs")).text();
  const s9Js = await (await fetch(base + "/s9-negative.mjs")).text();
  const trialJs = await (await fetch(base + "/trial-apply.mjs")).text();
  const verifyJs = await (await fetch(base + "/subject-hash-verify.mjs")).text();
  const sessionMatch = pageHtml.match(/const S13_SESSION = "([^"]+)"/);
  const SERVED_SESSION = sessionMatch ? sessionMatch[1] : null;
  const inlineModule = pageHtml.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!inlineModule) throw new Error("ページ内にインライン・モジュールが見つかりません");
  const classic =
    stripModule(verifyJs) + "\n" + stripModule(trialJs) + "\n" + stripModule(s9Js) + "\n" +
    stripModule(s13Js) + "\n" + stripModule(inlineModule[1]);
  const testHtml = pageHtml
    .replace(inlineModule[0], "")
    .replace("</body>", `<script>${classic}</script>\n</body>`);
  check("実画面: ページのモジュール import を解決できる", testHtml.includes("createS13Session"));

  async function makeDom() {
    const vc = new VirtualConsole();
    const jsdomErrors = [];
    vc.on("jsdomError", (e) => jsdomErrors.push(String(e && e.detail ? e.detail : e)));
    const dom = new JSDOM(testHtml, {
      url: base + "/s13-revoke",
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
        window.__revokeCalls = [];
        window.__verifyCalls = [];
        window.__revokeQueue = [];
        window.__verifyQueue = [];
        window.__revokeShouldThrow = false;
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
          if (pathname === "/s13/nonces") {
            const u = new URL(url);
            window.__nonceCalls.push({
              url,
              slot: u.searchParams.get("slot"),
              trialId: u.searchParams.get("trial_id"),
              session: (init.headers || {})["x-s13-session"],
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
          if (pathname === "/s13/freeze-revoke") {
            let body = null;
            try {
              body = JSON.parse(init.body);
            } catch { /* 本体が読めなければ null のまま */ }
            window.__freezeCalls.push({
              url,
              method,
              session: (init.headers || {})["x-s13-session"],
              body,
            });
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (pathname === "/s13/send-revoke" || pathname === "/s13/send-verify-only") {
            const isRevoke = pathname === "/s13/send-revoke";
            let body = null;
            try {
              body = JSON.parse(init.body);
            } catch { /* 本体が読めなければ null のまま */ }
            const record = {
              url,
              method,
              session: (init.headers || {})["x-s13-session"],
              contentType: (init.headers || {})["content-type"],
              body,
            };
            const queue = isRevoke ? window.__revokeQueue : window.__verifyQueue;
            if (isRevoke) {
              window.__revokeCalls.push(record);
              if (window.__revokeShouldThrow) throw new Error("network down (test)");
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
  async function driveToFrozenC(window) {
    await newTrial(window);
    await captureSlot(window, "prepTargetC", SUB_C);
    checkBox(window, "targetCConfirmed");
    el(window, "completeTargetC").click();
    const tokenA = await captureSlot(window, "prepRevokeC", SUB_A);
    checkBox(window, "revokeCConfirmed");
    el(window, "completeRevokeC").click();
    el(window, "freezeRevokeC").click();
    // 凍結した対象の送信器への固定が済むまで待つ（固定の完了前は
    // 送信ボタンが有効にならない）。
    const froze = await waitFor(() => logText(window).includes("手順1の失効要求を凍結しました"));
    if (!froze) throw new Error("失効Cの要求が凍結されませんでした: " + logText(window).slice(-300));
    return { tokenA };
  }
  // 手順1の送信まで進める共通の運転。
  async function driveToRevokeCSent(window) {
    const tokens = await driveToFrozenC(window);
    checkBox(window, "preRead");
    window.__revokeQueue.push({ status: 200, error: null, generation: 6 });
    el(window, "sendRevokeC").click();
    const ok = await waitFor(() => logText(window).includes("手順1の送信 -> 200 ok"));
    if (!ok) throw new Error("失効Cの送信が記録されませんでした: " + logText(window).slice(-300));
    return tokens;
  }
  // 手順2の凍結まで進める共通の運転。
  async function driveToFrozenA(window) {
    const tokens = await driveToRevokeCSent(window);
    const tokenA2 = await captureSlot(window, "prepRevokeA", SUB_A);
    checkBox(window, "revokeAConfirmed");
    el(window, "completeRevokeA").click();
    el(window, "freezeRevokeA").click();
    const froze = await waitFor(() => logText(window).includes("手順2の失効要求を凍結しました"));
    if (!froze) throw new Error("失効Aの要求が凍結されませんでした: " + logText(window).slice(-300));
    return { ...tokens, tokenA2 };
  }

  // ===== 場面1：正常系（対象取得→失効C→失効A試行の拒否→A提示） =====
  {
    const { window } = await makeDom();
    const trialId = await newTrial(window);
    check("場面1: 試行開始直後は失効送信・提示が無効",
      el(window, "sendRevokeC").disabled === true && el(window, "sendRevokeA").disabled === true &&
      el(window, "sendCheckA").disabled === true);
    const tokenC = await captureSlot(window, "prepTargetC", SUB_C);
    check("場面1: 手順0の C の主体ハッシュが画面に表示される",
      el(window, "targetCHash").textContent === HASH_C);
    check("場面1: 対象取得の nonce は /nonce から直接取得され、送信器の nonce はまだ使われない",
      window.__directNonceCalls.length === 1 && window.__nonceCalls.length === 0);
    checkBox(window, "targetCConfirmed");
    el(window, "completeTargetC").click();
    check("場面1: 対象取得の完了で段階が target-captured になる", phaseOf(window) === "target-captured");
    const tokenA = await captureSlot(window, "prepRevokeC", SUB_A);
    check("場面1: 手順1の nonce 取得はスロット revokeC で送信器へ行き、セッションが付く",
      window.__nonceCalls.length === 1 && window.__nonceCalls[0].slot === "revokeC" &&
      window.__nonceCalls[0].trialId === trialId && window.__nonceCalls[0].session === SERVED_SESSION);
    check("場面1: 認可者が C と異なることが表示で確認済みになる",
      el(window, "revokeCFacts").textContent.includes("確認済み"));
    checkBox(window, "revokeCConfirmed");
    el(window, "completeRevokeC").click();
    check("場面1: 認可の完了で段階が revokec-captured になる",
      phaseOf(window) === "revokec-captured");
    el(window, "freezeRevokeC").click();
    await waitFor(() => logText(window).includes("手順1の失効要求を凍結しました"));
    const frozenCText = el(window, "frozenRevokeC").textContent;
    check("場面1: 凍結表示が凍結内容（revoke・C のハッシュ・期待世代5・送信先）から作られる",
      frozenCText.includes("revoke") && frozenCText.includes(HASH_C) &&
      frozenCText.includes("期待世代： 5") && frozenCText.includes("/admin/registry/revoke"),
      frozenCText);
    check("場面1: 凍結した対象（C のハッシュ）がスロット revokeC で送信器へ固定として送られる",
      window.__freezeCalls.length === 1 &&
      window.__freezeCalls[0].body.trial_id === trialId &&
      window.__freezeCalls[0].body.slot === "revokeC" &&
      window.__freezeCalls[0].body.subject_hash === HASH_C &&
      window.__freezeCalls[0].session === SERVED_SESSION);
    check("場面1: 読み戻し未確認では失効C送信ボタンが無効",
      el(window, "sendRevokeC").disabled === true);
    checkBox(window, "preRead");
    check("場面1: 読み戻し確認で失効C送信ボタンが有効になる",
      el(window, "sendRevokeC").disabled === false);
    window.__revokeQueue.push({ status: 200, error: null, generation: 6 });
    el(window, "sendRevokeC").click();
    await waitFor(() => logText(window).includes("手順1の送信 -> 200 ok"));
    check("場面1: 失効Cの送信指示が1回だけ送信器へ行く",
      window.__revokeCalls.length === 1);
    const revokeCBody = window.__revokeCalls[0].body;
    check("場面1: 失効Cの送信引数が凍結内容と A のトークンである",
      revokeCBody.trial_id === trialId && revokeCBody.slot === "revokeC" &&
      revokeCBody.request.subject_hash === HASH_C &&
      revokeCBody.request.expected_generation === 5 && revokeCBody.request.id_token === tokenA);
    check("場面1: 失効Cの後に段階が revokec-sent になる", phaseOf(window) === "revokec-sent");
    const tokenA2 = await captureSlot(window, "prepRevokeA", SUB_A);
    check("場面1: 手順2のAが手順1の認可者Aと同一であることが表示で確認済みになる",
      el(window, "revokeAFacts").textContent.includes("確認済み"));
    checkBox(window, "revokeAConfirmed");
    el(window, "completeRevokeA").click();
    el(window, "freezeRevokeA").click();
    await waitFor(() => logText(window).includes("手順2の失効要求を凍結しました"));
    const frozenAText = el(window, "frozenRevokeA").textContent;
    check("場面1: 手順2の凍結表示の対象は A 自身・期待世代6である",
      frozenAText.includes(HASH_A) && frozenAText.includes("期待世代： 6"), frozenAText);
    check("場面1: 凍結した対象（A のハッシュ）がスロット revokeA で送信器へ固定として送られる",
      window.__freezeCalls.length === 2 &&
      window.__freezeCalls[1].body.slot === "revokeA" &&
      window.__freezeCalls[1].body.subject_hash === HASH_A);
    window.__revokeQueue.push({ status: 409, error: "last_operator", generation: null });
    el(window, "sendRevokeA").click();
    await waitFor(() => logText(window).includes("手順2の送信 -> 409 last_operator"));
    check("場面1: 手順2の 409 last_operator は期待結果として記録され、段階が revokea-recorded になる",
      phaseOf(window) === "revokea-recorded" &&
      logText(window).includes("最後の運営者は失効できません"));
    const revokeABody = window.__revokeCalls[1].body;
    check("場面1: 失効Aの送信引数は A 自身・期待世代6・手順2のトークンである",
      window.__revokeCalls.length === 2 && revokeABody.slot === "revokeA" &&
      revokeABody.request.subject_hash === HASH_A &&
      revokeABody.request.expected_generation === 6 && revokeABody.request.id_token === tokenA2);
    const tokenA3 = await captureSlot(window, "prepCheckA", SUB_A);
    checkBox(window, "checkAConfirmed");
    el(window, "completeCheckA").click();
    window.__verifyQueue.push({ status: 200, error: null, generation: 6 });
    el(window, "sendCheckA").click();
    await waitFor(() => phaseOf(window) === "completed");
    check("場面1: 全手順が完了し、完了の記録がログに出る",
      logText(window).includes("S13 完了です"));
    check("場面1: 手順3の提示はスロット checkA で手順3のトークンを使う",
      window.__verifyCalls.length === 1 && window.__verifyCalls[0].body.slot === "checkA" &&
      window.__verifyCalls[0].body.request.id_token === tokenA3);
    const allLog = logText(window);
    check("場面1: ログにトークン・主体ハッシュ・nonce の値が出ない",
      !allLog.includes(tokenC) && !allLog.includes(tokenA) && !allLog.includes(tokenA2) &&
      !allLog.includes(tokenA3) &&
      !allLog.includes(HASH_A) && !allLog.includes(HASH_C) &&
      !allLog.includes("sender-nonce-") && !allLog.includes("direct-nonce-"));
    check("場面1: 主体ハッシュ表示は消去されている（完了時の消去）",
      el(window, "targetCHash").textContent === "（消去されました）" &&
      el(window, "checkAHash").textContent === "（消去されました）");
    window.close();
  }

  // ===== 場面2：失効C が 409 で拒否されたら停止し、手順2へ進めない =====
  {
    const { window } = await makeDom();
    await driveToFrozenC(window);
    checkBox(window, "preRead");
    window.__revokeQueue.push({ status: 409, error: "stale_generation", generation: null });
    el(window, "sendRevokeC").click();
    await waitFor(() => logText(window).includes("手順1の送信 -> 409 stale_generation"));
    check("場面2: 失効Cの 409 で段階が halted になる", phaseOf(window) === "halted");
    const gisBefore = window.__gis.callbacks.length;
    dispatchClick(window, "prepRevokeA");
    await sleep(300);
    check("場面2: 停止後は手順2の準備が始まらない",
      window.__gis.callbacks.length === gisBefore && window.__revokeCalls.length === 1);
    window.close();
  }

  // ===== 場面3：手順2で 200 が返ったら（保護が効かなかったら）停止する =====
  {
    const { window } = await makeDom();
    await driveToFrozenA(window);
    window.__revokeQueue.push({ status: 200, error: null, generation: 7 });
    el(window, "sendRevokeA").click();
    await waitFor(() => logText(window).includes("手順2の結果は期待と一致しませんでした"));
    check("場面3: 手順2の 200 は期待外れとして halted になる", phaseOf(window) === "halted");
    const gisBefore = window.__gis.callbacks.length;
    dispatchClick(window, "prepCheckA");
    await sleep(300);
    check("場面3: 停止後は手順3の準備が始まらず、提示も送られない",
      window.__gis.callbacks.length === gisBefore && window.__verifyCalls.length === 0);
    window.close();
  }

  // ===== 場面4：失効Cの送信指示が失敗したら状態未確定で停止 =====
  {
    const { window } = await makeDom();
    await driveToFrozenC(window);
    checkBox(window, "preRead");
    window.__revokeShouldThrow = true;
    el(window, "sendRevokeC").click();
    await waitFor(() => logText(window).includes("状態未確定"));
    check("場面4: 送信指示の失敗は状態未確定として記録され、段階は halted",
      phaseOf(window) === "halted" && stateText(window).includes('"undetermined": true'),
      stateText(window));
    check("場面4: 送信指示は1回だけ試みられた（再送なし）",
      window.__revokeCalls.length === 1);
    window.close();
  }

  // ===== 場面5：認可者が C 本人（wrong_authorizer）で停止 =====
  {
    const { window } = await makeDom();
    await newTrial(window);
    await captureSlot(window, "prepTargetC", SUB_C);
    checkBox(window, "targetCConfirmed");
    el(window, "completeTargetC").click();
    await captureSlot(window, "prepRevokeC", SUB_C);
    checkBox(window, "revokeCConfirmed");
    el(window, "completeRevokeC").click();
    await sleep(200);
    check("場面5: 認可者が C と同一なら停止し、案内が出る",
      phaseOf(window) === "halted" &&
      logText(window).includes("この試行は停止しました"),
      logText(window).slice(-300));
    check("場面5: 停止後は凍結できず、送信もされない",
      el(window, "freezeRevokeC").disabled === true && window.__revokeCalls.length === 0);
    window.close();
  }

  // ===== 場面6：送信器の事前確認エラー（1件も送信されていない） =====
  {
    const { window } = await makeDom();
    await driveToFrozenC(window);
    checkBox(window, "preRead");
    window.__revokeQueue.push({ instructionError: "s13_revoke_target_mismatch", instructionStatus: 409 });
    el(window, "sendRevokeC").click();
    await waitFor(() => logText(window).includes("送信器の事前確認で拒否されました"));
    check("場面6: 事前確認エラーでは理由コードが出て、再送手段がない",
      logText(window).includes("s13_revoke_target_mismatch") &&
      el(window, "sendRevokeC").disabled === true,
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
  rmSync(path.join(ROOT, ".persist-screen-s13"), { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n===== 実画面結果: ${results.length - failed.length} PASS / ${failed.length} FAIL =====`);
if (failed.length > 0) {
  process.exitCode = 1;
}
