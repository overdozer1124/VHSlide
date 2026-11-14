// S15 応答破棄ドリル専用画面（public/s15-apply.html）の実画面試験。
// 実行: node test/s15-apply.screen.mjs
// （npm run test:screen:s15 でも実行できる）
//
// 目的：文字列の存在確認ではなく、ページ自体を DOM で実行し、
// 対象 B の取得 → 承認内容の凍結 → 試行1の B の取得 → 承認
// 内容の送信器への固定 → 破棄送信 → 読み戻し判定（未成立）→
// 試行2の再実施 → 読み戻し判定（実測）→ 通常版復帰の記録 →
// closed の gating・送信引数・順序の強制・ログの秘密不出力を
// 検証する。実 Google・実 Worker は使わない。
//
// あわせて、Codex 再レビュー 6879462050 の指摘2（PC 運転
// コードと実 Google 画面の要求が接続されていない）への対応
// として次を確認する。
// - 画面は送信先へ直接 fetch しない。配信された画面のソース
//   に送信先パスの文字列そのものが存在せず、実行中の fetch
//   記録にも送信先への要求が0件であること（実送信は提供層の
//   送信器だけが行い、画面が受け取るのは破棄記録だけ）。
// - B の実ログインで作るトークン・nonce・凍結要求が、
//   /s15/nonces と /s15/freeze-approval と /s15/send-discard
//   を経て送信器へ渡ること（引数の一致で確認する）。
//
// あわせて、Codex 再レビュー 6880300681（修正4）の復旧手順を、
// 実画面の停止状態から確認する。
// - 送信指示の応答喪失（/s15/send-discard の応答を場面制御で
//   落とす）で画面が attempt-captured のまま停止し、復旧ボタン
//   だけが有効になること。復旧前の判定は拒否されること。
// - 復旧（送信を結果不明として記録）は何も送信せず、判定 →
//   未成立なら同じ画面から再実施 → 実測 → 復帰記録 → closed
//   まで進めること（場面A）。実測を直接判定しても締められる
//   こと（場面B）。鏡像が記録済み（already_recorded）を返す
//   場合（ランチャーの judge が先に記録した担い手ルール）も
//   復旧は失敗しないこと（場面B）。
//
// 実行環境の制約：この VM では実ブラウザーの起動ができないため
// jsdom でページを実行する（s14-rotate.screen.mjs と同じ方式）。
// - GIS は偽物（beforeParse で window.google を差し替え、本物の
//   gsi/client は空の応答を返す）。
// - JWKS はインターセプターで偽物の公開鍵集合を返す。ID トークン
//   はその場で生成した RSA 鍵で署名した RS256 JWT で、ページ内の
//   JWKS 署名検証を通る。対象・試行とも B の sub で発行する。
// - /nonce・/s15/nonces・/s15/freeze-approval・
//   /s15/send-discard・/s15/record-judgment はインターセプター
//   で要求を記録し、場面ごとに用意した応答を返す。送信器と実
//   Worker へは送らない（送信器の実物確認は
//   test/s15-sender.test.mjs、入口の実物確認は
//   test/serve-real-s15.test.mjs、実ビルドでの結びは
//   test/s15-guard.test.mjs が担う）。
// - 送信窓の時間切れは、実時間では再現に時間がかかるため画面
//   試験では扱わない（状態機械と送信器の単体試験で境界を確認
//   する）。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。
// ※ test/run.mjs の件数には含めない（別枠のローカル確認）。

import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign, webcrypto } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "jsdom";
const { JSDOM, VirtualConsole, requestInterceptor } = pkg;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_PORT = 8914;
const CLIENT_ID = "screen-s15-client-id.apps.googleusercontent.com";
const ENV_ID = "stage1-phase2-verification-local";
const NOW = Math.floor(Date.now() / 1000);
const SUB_B = "screen-subject-B";
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const HASH_B = sha256hex(SUB_B);
const OP5 = "op-screen-005";
const OP1 = "op-screen-001";
const OP3 = "op-screen-003";
const ONE_TIME_1 = "one-time-screen-attempt-1";
const ONE_TIME_2 = "one-time-screen-attempt-2";

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

// 偽の中継。提供サーバーの起動に RELAY_URL が必要であり、転送先
// として用意する。この試験では転送経路を呼ばない（呼ばれた場合
// は件数で検出する）。
const relayHits = { total: 0, apply: 0 };
const relay = http.createServer((req, res) => {
  relayHits.total += 1;
  if (req.url === "/platform/apply") relayHits.apply += 1;
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
const relayPort = relay.address().port;

const child = spawn("node", [path.join(ROOT, "tools", "serve-real.mjs")], {
  env: {
    ...process.env,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    RELAY_URL: `http://127.0.0.1:${relayPort}`,
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
      const r = await fetch(base + "/s15-apply");
      if (r.status === 200) return true;
    } catch { /* 起動待ち */ }
    await sleep(200);
  }
  return false;
}

try {
  const ready = await waitReady();
  check("実画面: serve-real が起動し、s15-apply 画面を返す", ready, childLog.slice(-400));
  if (!ready) throw new Error("serve-real が起動しませんでした");

  // ページと検証モジュールの実ソースを取得し、インライン・
  // モジュールの import を解決して古典スクリプト化する。
  const pageHtml = await (await fetch(base + "/s15-apply")).text();
  const s15Js = await (await fetch(base + "/s15-apply.mjs")).text();
  const s9Js = await (await fetch(base + "/s9-negative.mjs")).text();
  const trialJs = await (await fetch(base + "/trial-apply.mjs")).text();
  const verifyJs = await (await fetch(base + "/subject-hash-verify.mjs")).text();
  const sessionMatch = pageHtml.match(/const S15_SESSION = "([^"]+)"/);
  const SERVED_SESSION = sessionMatch ? sessionMatch[1] : null;
  check(
    "実画面: 配信画面にプレースホルダが残らず、クライアント ID とセッションが差し込まれている",
    pageHtml.includes(CLIENT_ID) &&
      !pageHtml.includes("REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID") &&
      !pageHtml.includes("REPLACE_WITH_S15_SESSION") &&
      SERVED_SESSION !== null &&
      SERVED_SESSION.length > 0
  );
  check(
    "実画面: 画面ソースに送信先パスの文字列が存在しない（直接送信の経路がない）",
    !pageHtml.includes("/platform/apply")
  );
  const inlineModule = pageHtml.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!inlineModule) throw new Error("ページ内にインライン・モジュールが見つかりません");
  const classic =
    stripModule(verifyJs) + "\n" + stripModule(trialJs) + "\n" + stripModule(s9Js) + "\n" +
    stripModule(s15Js) + "\n" + stripModule(inlineModule[1]);
  const testHtml = pageHtml
    .replace(inlineModule[0], "")
    .replace("</body>", `<script>${classic}</script>\n</body>`);
  check("実画面: ページのモジュール import を解決できる", testHtml.includes("createS15Session"));

  async function makeDom() {
    const vc = new VirtualConsole();
    const jsdomErrors = [];
    vc.on("jsdomError", (e) => jsdomErrors.push(String(e && e.detail ? e.detail : e)));
    const dom = new JSDOM(testHtml, {
      url: base + "/s15-apply",
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
        // 入口の記録と場面ごとの応答。
        window.__directNonceCalls = [];
        window.__nonceCalls = [];
        window.__freezeCalls = [];
        window.__sendCalls = [];
        window.__judgeCalls = [];
        window.__applyCalls = [];
        window.__senderNonceCounter = 0;
        window.__directNonceCounter = 0;
        // 復旧場面（修正4）の制御：__dropSendResponses が正の間、
        // /s15/send-discard の呼び出しは記録だけして応答を失わせる
        // （送信器側の送信は完了したのに、画面が破棄記録を受け取れ
        // なかった状態の再現）。__judgeAlreadyRecorded が真の間、
        // /s15/record-judgment は記録済み（already_recorded）を返す
        // （ランチャーの judge が先に記録した担い手ルールの再現）。
        window.__dropSendResponses = 0;
        window.__judgeAlreadyRecorded = false;
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
          if (pathname === "/platform/apply") {
            // 画面が送信先へ直接送ることは決してない。万一呼ばれ
            // たら記録し、失敗として返す（件数で検出する）。
            window.__applyCalls.push({ url, method });
            return new Response(JSON.stringify({ error: "direct_apply_forbidden" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (pathname === "/s15/nonces") {
            const u = new URL(url);
            window.__nonceCalls.push({
              url,
              attempt: u.searchParams.get("attempt"),
              trialId: u.searchParams.get("trial_id"),
              session: (init.headers || {})["x-s15-session"],
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
          if (
            pathname === "/s15/freeze-approval" ||
            pathname === "/s15/send-discard" ||
            pathname === "/s15/record-judgment"
          ) {
            let body = null;
            try {
              body = JSON.parse(init.body);
            } catch { /* 本体が読めなければ null のまま */ }
            const record = {
              url,
              method,
              session: (init.headers || {})["x-s15-session"],
              contentType: (init.headers || {})["content-type"],
              body,
            };
            if (pathname === "/s15/freeze-approval") {
              window.__freezeCalls.push(record);
              return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
            if (pathname === "/s15/send-discard") {
              window.__sendCalls.push(record);
              if (window.__dropSendResponses > 0) {
                window.__dropSendResponses -= 1;
                // 送信器側の送信は完了しているが、画面への応答が
                // 失われた状態を再現する（fetch が例外になる）。
                throw new TypeError("応答喪失（試験用の再現）");
              }
              // 提供層が返すのは破棄記録だけである。
              return new Response(JSON.stringify({ sent: true, outcome: "discarded" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
            window.__judgeCalls.push(record);
            if (window.__judgeAlreadyRecorded) {
              return new Response(JSON.stringify({ ok: true, already_recorded: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
            return new Response(JSON.stringify({ ok: true }), {
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
  function setChecked(window, id) {
    const box = el(window, id);
    box.checked = true;
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
  }
  function setValue(window, id, value, eventType = null) {
    const input = el(window, id);
    input.value = value;
    if (eventType) input.dispatchEvent(new window.Event(eventType, { bubbles: true }));
  }
  function logText(window) {
    return el(window, "log").textContent;
  }
  function phase(window) {
    const text = el(window, "state").textContent;
    const m = text.match(/"phase": "([^"]+)"/);
    return m ? m[1] : null;
  }
  function tokenNonceClaim(token) {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.nonce;
  }

  const { window } = await makeDom();
  const mintedTokens = [];

  // 試行開始前の gating：準備ボタンを押しても何も起きない。
  dispatchClick(window, "prepTarget");
  await sleep(300);
  check(
    "実画面: 試行開始前は対象取得を押しても nonce 取得も GIS 登録も起きない",
    window.__directNonceCalls.length === 0 &&
      window.__nonceCalls.length === 0 &&
      window.__gis.callbacks.length === 0
  );

  // ① 試行の開始。
  setValue(window, "operationId", OP5);
  setValue(window, "envId", ENV_ID);
  setValue(window, "startConsumed1", OP1);
  setValue(window, "startConsumed2", OP3);
  dispatchClick(window, "newTrial");
  await waitFor(() => phase(window) === "start");
  const trialIdShown = el(window, "trialId").textContent;
  check(
    "実画面: 試行を開始でき、試験IDが表示され phase=start になる",
    trialIdShown.length > 0 && !trialIdShown.includes("始めてください") && phase(window) === "start",
    `trialId=${trialIdShown} phase=${phase(window)}`
  );
  check(
    "実画面: 開始直後は凍結・送信・判定のボタンが無効である",
    el(window, "freezeApproval").disabled === true &&
      el(window, "sendDiscard").disabled === true &&
      el(window, "recordJudgment").disabled === true
  );

  // ② 対象 B の取得（直接 /nonce、送信器は経由しない）。
  dispatchClick(window, "prepTarget");
  await waitFor(() => window.__gis.callbacks.length === 1);
  check(
    "実画面: 対象取得は直接 /nonce を1回だけ使い、送信器の /s15/nonces は使わない",
    window.__directNonceCalls.length === 1 && window.__nonceCalls.length === 0
  );
  const targetToken = mintToken("direct-nonce-1", SUB_B);
  mintedTokens.push(targetToken);
  window.__gis.callbacks[0]({ credential: targetToken });
  await waitFor(() => el(window, "targetHash").textContent === HASH_B);
  check(
    "実画面: 対象 B の署名検証が通り、主体ハッシュが画面だけに表示される",
    el(window, "targetEvidence").textContent.includes("署名 ok") &&
      el(window, "targetHash").textContent === HASH_B
  );
  check(
    "実画面: 所有者の確認チェック前は対象取得の完了ボタンが無効である",
    el(window, "completeTarget").disabled === true
  );
  setChecked(window, "targetConfirmed");
  dispatchClick(window, "completeTarget");
  await waitFor(() => phase(window) === "target-captured");
  check("実画面: 対象取得を完了でき phase=target-captured になる", phase(window) === "target-captured");

  // ③ 承認内容の凍結。
  dispatchClick(window, "freezeApproval");
  await waitFor(() => phase(window) === "approval-frozen");
  const frozenText = el(window, "frozenApproval").textContent;
  check(
    "実画面: 凍結の表示に操作番号5・操作ID・対象 B・開始世代7が含まれる",
    frozenText.includes("操作番号： 5") &&
      frozenText.includes(OP5) &&
      frozenText.includes(HASH_B) &&
      frozenText.includes("開始世代： 7"),
    frozenText.slice(0, 200)
  );

  // ④ 試行1：送信器 nonce → B の取得 → 固定 → 破棄送信。
  dispatchClick(window, "prepAttempt");
  await waitFor(() => window.__gis.callbacks.length === 2);
  check(
    "実画面: 試行1の nonce は /s15/nonces（attempt=1・試行ID・セッション付き）で取得される",
    window.__nonceCalls.length === 1 &&
      window.__nonceCalls[0].attempt === "1" &&
      window.__nonceCalls[0].trialId === trialIdShown &&
      window.__nonceCalls[0].session === SERVED_SESSION &&
      window.__gis.nonces[1] === "sender-nonce-1"
  );
  const attempt1Token = mintToken("sender-nonce-1", SUB_B);
  mintedTokens.push(attempt1Token);
  window.__gis.callbacks[1]({ credential: attempt1Token });
  await waitFor(() => el(window, "attemptHash").textContent === HASH_B);
  check(
    "実画面: 試行1の主体が対象 B と同一であることが表示される",
    el(window, "attemptFacts").textContent.includes("確認済み")
  );
  setChecked(window, "attemptConfirmed");
  dispatchClick(window, "completeAttempt");
  await waitFor(() => phase(window) === "attempt-captured");
  check("実画面: 試行1の取得を完了でき phase=attempt-captured になる", phase(window) === "attempt-captured");
  check(
    "実画面: 一回値の入力前は送信器への固定ボタンが無効である",
    el(window, "freezeSender").disabled === true
  );
  setValue(window, "oneTimeValue", ONE_TIME_1, "input");
  dispatchClick(window, "freezeSender");
  // 固定の記録だけでなく、画面側の固定処理が完了して送信ボタン
  // が有効になるまで待つ（非同期ハンドラーの完了前に次の操作を
  // 始めないため。以後の固定・判定でも同じ待ち方をする）。
  await waitFor(
    () => window.__freezeCalls.length === 1 && el(window, "sendDiscard").disabled === false
  );
  const freeze1 = window.__freezeCalls[0];
  check(
    "実画面: 送信器への固定の本体が凍結内容（操作ID・用途・対象・環境）と一回値に一致する",
    freeze1.session === SERVED_SESSION &&
      freeze1.body.trial_id === trialIdShown &&
      freeze1.body.attempt === 1 &&
      freeze1.body.operation_id === OP5 &&
      freeze1.body.purpose === "full-replace" &&
      freeze1.body.subject_hash === HASH_B &&
      freeze1.body.env_id === ENV_ID &&
      freeze1.body.one_time_value === ONE_TIME_1,
    JSON.stringify(freeze1.body)
  );
  dispatchClick(window, "sendDiscard");
  await waitFor(() => phase(window) === "sent-undetermined");
  const send1 = window.__sendCalls[0];
  check(
    "実画面: 破棄送信の本体が試行ID・試行番号・要求（nonce 主張・一回値・用途・環境）と一致する",
    window.__sendCalls.length === 1 &&
      send1.session === SERVED_SESSION &&
      send1.body.trial_id === trialIdShown &&
      send1.body.attempt === 1 &&
      send1.body.request.id_token === attempt1Token &&
      tokenNonceClaim(send1.body.request.id_token) === "sender-nonce-1" &&
      send1.body.request.one_time_value === ONE_TIME_1 &&
      send1.body.request.purpose === "full-replace" &&
      send1.body.request.env_id === ENV_ID
  );
  check(
    "実画面: 画面から送信先への直接要求は0件である",
    window.__applyCalls.length === 0 && relayHits.apply === 0
  );
  check(
    "実画面: 送信後のログにトークン・一回値・nonce・主体ハッシュが含まれない",
    !logText(window).includes(attempt1Token) &&
      !logText(window).includes(ONE_TIME_1) &&
      !logText(window).includes("sender-nonce-1") &&
      !logText(window).includes(HASH_B)
  );
  check(
    "実画面: 未確定の間は次の試行の準備ボタンが無効である",
    el(window, "prepAttempt").disabled === true
  );

  // ⑤ 判定（未成立）→ 試行2の再実施が開く。
  setValue(window, "judgeGeneration", "7");
  setValue(window, "judgeCompletion", "2");
  setValue(window, "judgeConsumed", `${OP1}, ${OP3}`);
  setValue(window, "judgeOperators", HASH_B);
  dispatchClick(window, "recordJudgment");
  await waitFor(() => phase(window) === "reattempt-ready" && window.__judgeCalls.length === 1);
  const judge1 = window.__judgeCalls[0];
  check(
    "実画面: 未成立の判定が送信器へ記録され（outcome=uncommitted・attempt=1）、再実施が開く",
    window.__judgeCalls.length === 1 &&
      judge1.session === SERVED_SESSION &&
      judge1.body.trial_id === trialIdShown &&
      judge1.body.attempt === 1 &&
      judge1.body.outcome === "uncommitted" &&
      el(window, "judgmentResult").textContent.includes("uncommitted"),
    JSON.stringify(judge1 && judge1.body)
  );

  // ④ 試行2：新しい nonce と新しい一回値で再実施する。
  dispatchClick(window, "prepAttempt");
  await waitFor(() => window.__gis.callbacks.length === 3);
  const attempt2Token = mintToken("sender-nonce-2", SUB_B);
  mintedTokens.push(attempt2Token);
  window.__gis.callbacks[2]({ credential: attempt2Token });
  await waitFor(() => el(window, "attemptHash").textContent === HASH_B);
  setChecked(window, "attemptConfirmed");
  dispatchClick(window, "completeAttempt");
  await waitFor(() => phase(window) === "attempt-captured");
  setValue(window, "oneTimeValue", ONE_TIME_2, "input");
  dispatchClick(window, "freezeSender");
  await waitFor(
    () => window.__freezeCalls.length === 2 && el(window, "sendDiscard").disabled === false
  );
  dispatchClick(window, "sendDiscard");
  await waitFor(() => phase(window) === "sent-undetermined");
  const send2 = window.__sendCalls[1];
  check(
    "実画面: 試行2は新しい nonce と新しい一回値で送信され、操作IDは同じである",
    window.__nonceCalls.length === 2 &&
      window.__nonceCalls[1].attempt === "2" &&
      window.__freezeCalls[1].body.attempt === 2 &&
      window.__freezeCalls[1].body.one_time_value === ONE_TIME_2 &&
      window.__freezeCalls[1].body.operation_id === OP5 &&
      send2.body.attempt === 2 &&
      tokenNonceClaim(send2.body.request.id_token) === "sender-nonce-2" &&
      send2.body.request.one_time_value === ONE_TIME_2 &&
      send2.body.request.id_token === attempt2Token
  );

  // ⑤ 判定（実測）→ committed。
  setValue(window, "judgeGeneration", "8");
  setValue(window, "judgeCompletion", "3");
  setValue(window, "judgeConsumed", `${OP1}, ${OP3}, ${OP5}`);
  setValue(window, "judgeOperators", HASH_B);
  dispatchClick(window, "recordJudgment");
  await waitFor(() => phase(window) === "committed" && window.__judgeCalls.length === 2);
  check(
    "実画面: 実測の判定が送信器へ記録され（outcome=committed・attempt=2）、phase=committed になる",
    window.__judgeCalls.length === 2 &&
      window.__judgeCalls[1].body.attempt === 2 &&
      window.__judgeCalls[1].body.outcome === "committed" &&
      el(window, "judgmentResult").textContent.includes("committed")
  );

  // ⑥ 通常版復帰の記録 → closed。
  check(
    "実画面: 両方の確認前は通常版復帰の記録ボタンが無効である",
    el(window, "recordRestore").disabled === true
  );
  setChecked(window, "versionVerified");
  setChecked(window, "bindingsVerified");
  dispatchClick(window, "recordRestore");
  await waitFor(() => phase(window) === "closed");
  check(
    "実画面: 通常版復帰を記録でき、試行が closed になる",
    phase(window) === "closed" && el(window, "state").textContent.includes('"closed": true')
  );

  // 経路と秘密の総括。
  const allS15Calls = [...window.__nonceCalls, ...window.__freezeCalls, ...window.__sendCalls, ...window.__judgeCalls];
  check(
    "実画面: すべての /s15/* 呼び出しに配信されたセッションが付いている",
    allS15Calls.length === 8 && allS15Calls.every((c) => c.session === SERVED_SESSION),
    `calls=${allS15Calls.length}`
  );
  check(
    "実画面: 直接 /nonce は対象取得の1回だけ、送信器 nonce は試行ごとに1回ずつである",
    window.__directNonceCalls.length === 1 && window.__nonceCalls.length === 2
  );
  const finalLog = logText(window);
  check(
    "実画面: 終了時のログ全体に秘密（トークン・一回値・nonce・主体ハッシュ・セッション）が含まれない",
    mintedTokens.every((t) => !finalLog.includes(t)) &&
      !finalLog.includes(ONE_TIME_1) &&
      !finalLog.includes(ONE_TIME_2) &&
      !finalLog.includes("sender-nonce-1") &&
      !finalLog.includes("sender-nonce-2") &&
      !finalLog.includes("direct-nonce-1") &&
      !finalLog.includes(HASH_B) &&
      !finalLog.includes(SERVED_SESSION)
  );
  check(
    "実画面: 最後まで画面から送信先への直接要求は0件である",
    window.__applyCalls.length === 0 && relayHits.apply === 0
  );

  // ---- 復旧場面（修正4、Codex 再レビュー 6880300681） ----
  // 送信指示の応答が失われた場合に、実画面の復旧手順で
  // attempt-captured の停止から再実施・締めまで進めることを、
  // 新しい DOM で確認する。補助関数は試行1の送信器固定までを
  // 駆動する（場面ごとに新しい DOM を使うため、カウンタは
  // その DOM 内で 0 から始まる）。
  async function driveToFrozenAttempt1(w) {
    setValue(w, "operationId", OP5);
    setValue(w, "envId", ENV_ID);
    setValue(w, "startConsumed1", OP1);
    setValue(w, "startConsumed2", OP3);
    dispatchClick(w, "newTrial");
    await waitFor(() => phase(w) === "start");
    dispatchClick(w, "prepTarget");
    await waitFor(() => w.__gis.callbacks.length === 1);
    w.__gis.callbacks[0]({ credential: mintToken("direct-nonce-1", SUB_B) });
    await waitFor(() => el(w, "targetHash").textContent === HASH_B);
    setChecked(w, "targetConfirmed");
    dispatchClick(w, "completeTarget");
    await waitFor(() => phase(w) === "target-captured");
    dispatchClick(w, "freezeApproval");
    await waitFor(() => phase(w) === "approval-frozen");
    dispatchClick(w, "prepAttempt");
    await waitFor(() => w.__gis.callbacks.length === 2);
    w.__gis.callbacks[1]({ credential: mintToken("sender-nonce-1", SUB_B) });
    await waitFor(() => el(w, "attemptHash").textContent === HASH_B);
    setChecked(w, "attemptConfirmed");
    dispatchClick(w, "completeAttempt");
    await waitFor(() => phase(w) === "attempt-captured");
    setValue(w, "oneTimeValue", ONE_TIME_1, "input");
    dispatchClick(w, "freezeSender");
    await waitFor(
      () => w.__freezeCalls.length === 1 && el(w, "sendDiscard").disabled === false
    );
    return el(w, "trialId").textContent;
  }
  function setJudgmentInputs(w, { generation, completion, consumed, operators }) {
    setValue(w, "judgeGeneration", String(generation));
    setValue(w, "judgeCompletion", String(completion));
    setValue(w, "judgeConsumed", consumed);
    setValue(w, "judgeOperators", operators);
  }

  // 場面A：応答喪失 → 停止 → 復旧 → 未成立 → 同じ画面から
  // 再実施 → 実測 → 復帰記録 → closed。
  {
    const { window: wA } = await makeDom();
    await driveToFrozenAttempt1(wA);
    wA.__dropSendResponses = 1;
    dispatchClick(wA, "sendDiscard");
    await waitFor(
      () => logText(wA).includes("状態未確定") && phase(wA) === "attempt-captured"
    );
    check(
      "復旧A: 送信指示の応答喪失で画面は attempt-captured のまま停止し、送信は1件だけ記録される",
      phase(wA) === "attempt-captured" &&
        wA.__sendCalls.length === 1 &&
        logText(wA).includes("再送はしません"),
      `phase=${phase(wA)} sends=${wA.__sendCalls.length}`
    );
    check(
      "復旧A: 停止中は復旧ボタンだけが有効で、判定・新規試行・破棄・送信は無効である",
      el(wA, "recoverUnknownSend").disabled === false &&
        el(wA, "recordJudgment").disabled === true &&
        el(wA, "newTrial").disabled === true &&
        el(wA, "discardTrial").disabled === true &&
        el(wA, "sendDiscard").disabled === true
    );
    // 復旧前に判定を押しても、状態機械が拒否し送信器へは何も
    // 記録されない（判定は sent-undetermined でのみ可能）。
    setJudgmentInputs(wA, {
      generation: 7,
      completion: 2,
      consumed: `${OP1}, ${OP3}`,
      operators: HASH_B,
    });
    dispatchClick(wA, "recordJudgment");
    await sleep(500);
    check(
      "復旧A: 復旧前の判定は拒否され、送信器への判定記録は0件のままである",
      phase(wA) === "attempt-captured" && wA.__judgeCalls.length === 0,
      `phase=${phase(wA)} judge=${wA.__judgeCalls.length}`
    );
    // 復旧：何も送信せず、画面の状態だけが sent-undetermined へ進む。
    dispatchClick(wA, "recoverUnknownSend");
    await waitFor(() => phase(wA) === "sent-undetermined");
    check(
      "復旧A: 復旧で phase=sent-undetermined になり、送信・発行・固定の件数は増えない",
      phase(wA) === "sent-undetermined" &&
        wA.__sendCalls.length === 1 &&
        wA.__nonceCalls.length === 1 &&
        wA.__freezeCalls.length === 1 &&
        el(wA, "recoverUnknownSend").disabled === true &&
        el(wA, "recordJudgment").disabled === false
    );
    // 判定（未成立）→ 同じ試行の再実施が画面で開く。
    dispatchClick(wA, "recordJudgment");
    await waitFor(() => phase(wA) === "reattempt-ready" && wA.__judgeCalls.length === 1);
    check(
      "復旧A: 未成立の判定が送信器へ鏡像され（attempt=1・uncommitted）、再実施が開く",
      wA.__judgeCalls.length === 1 &&
        wA.__judgeCalls[0].body.attempt === 1 &&
        wA.__judgeCalls[0].body.outcome === "uncommitted" &&
        phase(wA) === "reattempt-ready"
    );
    // 試行2を同じ画面から通常どおり実施する。
    dispatchClick(wA, "prepAttempt");
    await waitFor(() => wA.__gis.callbacks.length === 3);
    wA.__gis.callbacks[2]({ credential: mintToken("sender-nonce-2", SUB_B) });
    await waitFor(() => el(wA, "attemptHash").textContent === HASH_B);
    check(
      "復旧A: 再実施でも試行の主体が対象 B と同一であることが表示される（対象ハッシュは保持されている）",
      el(wA, "attemptFacts").textContent.includes("確認済み")
    );
    setChecked(wA, "attemptConfirmed");
    dispatchClick(wA, "completeAttempt");
    await waitFor(() => phase(wA) === "attempt-captured");
    setValue(wA, "oneTimeValue", ONE_TIME_2, "input");
    dispatchClick(wA, "freezeSender");
    await waitFor(
      () => wA.__freezeCalls.length === 2 && el(wA, "sendDiscard").disabled === false
    );
    dispatchClick(wA, "sendDiscard");
    await waitFor(() => phase(wA) === "sent-undetermined" && wA.__sendCalls.length === 2);
    setJudgmentInputs(wA, {
      generation: 8,
      completion: 3,
      consumed: `${OP1}, ${OP3}, ${OP5}`,
      operators: HASH_B,
    });
    dispatchClick(wA, "recordJudgment");
    await waitFor(() => phase(wA) === "committed" && wA.__judgeCalls.length === 2);
    setChecked(wA, "versionVerified");
    setChecked(wA, "bindingsVerified");
    dispatchClick(wA, "recordRestore");
    await waitFor(() => phase(wA) === "closed");
    check(
      "復旧A: 再実施→実測→復帰記録で closed になり、送信は計画どおり合計2件・直接要求は0件である",
      phase(wA) === "closed" &&
        wA.__sendCalls.length === 2 &&
        wA.__applyCalls.length === 0,
      `phase=${phase(wA)} sends=${wA.__sendCalls.length} apply=${wA.__applyCalls.length}`
    );
  }

  // 場面B：応答喪失 → 復旧 → 実測を直接判定して締める。
  // あわせて担い手ルール：ランチャーの judge が先に同じ区分を
  // 記録していた場合（鏡像が already_recorded を返す場合）も、
  // 画面の復旧は失敗せずに進む。
  {
    const { window: wB } = await makeDom();
    await driveToFrozenAttempt1(wB);
    wB.__dropSendResponses = 1;
    dispatchClick(wB, "sendDiscard");
    await waitFor(
      () => logText(wB).includes("状態未確定") && phase(wB) === "attempt-captured"
    );
    dispatchClick(wB, "recoverUnknownSend");
    await waitFor(() => phase(wB) === "sent-undetermined");
    wB.__judgeAlreadyRecorded = true;
    setJudgmentInputs(wB, {
      generation: 8,
      completion: 3,
      consumed: `${OP1}, ${OP3}, ${OP5}`,
      operators: HASH_B,
    });
    dispatchClick(wB, "recordJudgment");
    await waitFor(() => phase(wB) === "committed" && wB.__judgeCalls.length === 1);
    check(
      "復旧B: 実測の判定が記録され、鏡像の already_recorded は記録済みとして受け付けられる（復旧は失敗しない）",
      phase(wB) === "committed" &&
        wB.__judgeCalls.length === 1 &&
        wB.__judgeCalls[0].body.attempt === 1 &&
        wB.__judgeCalls[0].body.outcome === "committed" &&
        logText(wB).includes("記録済みとして受け付けました"),
      `phase=${phase(wB)} judge=${wB.__judgeCalls.length}`
    );
    setChecked(wB, "versionVerified");
    setChecked(wB, "bindingsVerified");
    dispatchClick(wB, "recordRestore");
    await waitFor(() => phase(wB) === "closed");
    check(
      "復旧B: 復帰記録で closed になり、送信は当初の1件だけ・直接要求は0件である",
      phase(wB) === "closed" &&
        wB.__sendCalls.length === 1 &&
        wB.__applyCalls.length === 0,
      `phase=${phase(wB)} sends=${wB.__sendCalls.length} apply=${wB.__applyCalls.length}`
    );
  }
} catch (e) {
  check(`実画面: 実行が完走する（例外: ${e.message}）`, false, String(e.stack || e).slice(0, 400));
} finally {
  child.kill();
  relay.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
