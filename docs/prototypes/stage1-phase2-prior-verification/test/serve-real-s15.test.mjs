// 提供サーバー（tools/serve-real.mjs）の S15 入口（/s15-apply.mjs・
// /s15/nonces・/s15/freeze-approval・/s15/send-discard・
// /s15/record-judgment）の実行試験。
// 実行: node --test test/serve-real-s15.test.mjs
// 実 Google・実 Worker とは通信しない。次を HTTP 層で確認する。
// - /s15-apply.mjs が状態機械モジュールをそのまま返すこと。
// - S15 入口の呼び出し元境界（子プロセスで起動した提供サーバー）：
//   試験単位セッション（x-s15-session）を示さない呼び出しは 403
//   で拒否され、中継へは何も送られず、送信器の状態も変わらない
//   こと。未知の経路は 404 であること。
// - 正当なセッションの往復（プロセス内で生成した提供サーバー＋
//   運転コード tools/s15-driver.mjs）：セッション値は
//   createRealServer の戻り値としてプロセス内だけで受け取り
//   （HTTP 応答からは得ない）、nonce 発行 → 承認固定 → 破棄
//   送信（中継が受けた送信はちょうど1件で、応答は破棄記録だけ
//   が返る）→ 判定記録の往復ができること。セッションなし・
//   誤ったセッションは 403 で、中継へ何も届かないこと。
// - 試行切替関門の HTTP 層回帰（Codex レビュー 6879152477）：
//   送信済み・判定前の間は、(a) 新しい試行 ID でも (b) 同じ
//   試行 ID でも、新規の nonce 発行と送信がどちらも 409 で
//   拒否され、中継の発行・送信件数が増えないこと。送信中
//   （飛行中）の新しい試行の開始も 409 で拒否されること。
//   判定の記録後は同じ試行の再実施が開き、committed の判定
//   の後は新しい試行を開始できること。
// - S15 専用画面（GET /s15-apply）の配信（Codex 再レビュー
//   6879462050）：クライアント ID と S15 セッションがメモリ
//   上で差し込まれて配信され、他の画面には S15 セッションの
//   プレースホルダが現れないこと。
// - 判定記録の競合の HTTP 層回帰（Codex 再レビュー
//   6879462050）：送信が飛行中（中継の応答を保留）の間は、
//   判定の記録が 409 s15_send_in_flight で拒否され、再実施
//   の発行も開かず、中継の発行・送信件数も増えないこと。
//   応答を解放して送信が確定した後は、判定を記録できること。
// 秘密の値は使わない。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createS15Driver } from "../tools/s15-driver.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_PORT = 8910;
const CLIENT_ID = "serve-s15-client-id.apps.googleusercontent.com";
const HASH_B = "b".repeat(64);
const ENV_ID = "stage1-phase2-verification-local";

// 偽の中継。/nonce と /platform/apply への呼び出しを数えるだけ
// であり、S15 入口の境界が正しければどちらも呼ばれない。
const relayCalls = { nonce: 0, apply: 0 };
const relay = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    if (req.url === "/nonce") {
      relayCalls.nonce += 1;
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "op2_nonce_ctx=fake-ctx; Path=/; HttpOnly",
      });
      res.end(JSON.stringify({ nonce: "fake-nonce" }));
      return;
    }
    if (req.url === "/platform/apply") {
      relayCalls.apply += 1;
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
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
      const r = await fetch(base + "/");
      if (r.status === 200) return true;
    } catch { /* 起動待ち */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const ready = await waitReady();
assert.equal(ready, true, `serve-real が起動しませんでした: ${childLog.slice(-400)}`);

after(async () => {
  child.kill();
  relay.close();
});

test("S15 入口：/s15-apply.mjs は状態機械モジュールを返す", async () => {
  const r = await fetch(base + "/s15-apply.mjs");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /javascript/);
  const text = await r.text();
  assert.ok(text.includes("createS15Session"));
  assert.ok(text.includes("judgeS15ReadBack"));
  assert.ok(text.includes("recordNormalRestored"));
});

test("S15 入口：セッションなしの /s15/nonces は 403 で、中継の /nonce は呼ばれない", async () => {
  const before = relayCalls.nonce;
  const r = await fetch(base + "/s15/nonces?trial_id=t1&attempt=1");
  assert.equal(r.status, 403);
  const json = await r.json();
  assert.equal(json.error, "s15_bad_session");
  // 誤ったセッション値でも同じく拒否される。
  const r2 = await fetch(base + "/s15/nonces?trial_id=t1&attempt=1", {
    headers: { "x-s15-session": "not-the-session" },
  });
  assert.equal(r2.status, 403);
  assert.equal(relayCalls.nonce, before);
});

test("S15 入口：セッションなしの POST 群は 403 で、何も送られない", async () => {
  const before = { ...relayCalls };
  const post = (p, body) =>
    fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const freeze = await post("/s15/freeze-approval", {
    trial_id: "t1",
    attempt: 1,
    operation_id: "op-fixture-005",
    purpose: "full-replace",
    subject_hash: HASH_B,
    env_id: ENV_ID,
    one_time_value: "one-time-x",
  });
  assert.equal(freeze.status, 403);
  assert.equal((await freeze.json()).error, "s15_bad_session");
  const send = await post("/s15/send-discard", {
    trial_id: "t1",
    attempt: 1,
    request: {
      id_token: "token",
      one_time_value: "one-time-x",
      purpose: "full-replace",
      env_id: ENV_ID,
    },
  });
  assert.equal(send.status, 403);
  const judge = await post("/s15/record-judgment", {
    trial_id: "t1",
    attempt: 1,
    outcome: "uncommitted",
  });
  assert.equal(judge.status, 403);
  assert.deepEqual(relayCalls, before);
});

test("S15 画面：/s15-apply は専用画面を、クライアント ID とセッションを差し込んで返す", async () => {
  // S15 専用画面（public/s15-apply.html）へは、S14 画面と同じ
  // 型で、クライアント ID と S15 セッションがメモリ上で差し
  // 込まれる（ファイル自体は書き換えない）。配信後の画面に
  // プレースホルダは残らず、他の画面には S15 セッションの
  // プレースホルダは現れない（値そのものは試験側にも分から
  // ない設計である）。
  const r = await fetch(base + "/s15-apply");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /text\/html/);
  const page = await r.text();
  assert.ok(page.includes(CLIENT_ID));
  assert.ok(!page.includes("REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID"));
  assert.ok(!page.includes("REPLACE_WITH_S15_SESSION"));
  // 画面は状態機械モジュールを import し、/s15/* 入口を
  // x-s15-session ヘッダーで呼ぶ。送信先へ直接送る経路は
  // 画面内に存在しない（画面自体の実動確認は
  // test/s15-apply.screen.mjs が担う）。
  assert.ok(page.includes("./s15-apply.mjs"));
  assert.ok(page.includes("x-s15-session"));
  assert.ok(page.includes("/s15/send-discard"));
  const top = await (await fetch(base + "/")).text();
  assert.ok(!top.includes("REPLACE_WITH_S15_SESSION"));
  const s14 = await (await fetch(base + "/s14-rotate")).text();
  assert.ok(!s14.includes("REPLACE_WITH_S15_SESSION"));
});

test("S15 入口：未知の経路は 404", async () => {
  const r = await fetch(base + "/s15-unknown");
  assert.equal(r.status, 404);
});

// ---- ここから、正当なセッションの往復と試行切替関門の回帰 ----
// 提供サーバーは子プロセスではなくプロセス内で生成し、
// セッション値は createRealServer の戻り値から運転コード
// （tools/s15-driver.mjs）がプロセス内だけで受け取る。
// HTTP 応答からセッション値を得る経路は存在しない。

const DRIVER_PORT_A = 8911;
const DRIVER_PORT_B = 8912;
const DRIVER_PORT_C = 8913;
const OP5 = "op-fixture-005";
const ONE_TIME_A1 = "one-time-driver-a1";
const ONE_TIME_A2 = "one-time-driver-a2";

function tokenFor(nonce) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "subject-b", nonce, iss: "https://accounts.google.com", aud: "dummy", exp: 9999999999 })
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

function requestFor({ nonce, oneTimeValue }) {
  return {
    id_token: tokenFor(nonce),
    one_time_value: oneTimeValue,
    purpose: "full-replace",
    env_id: ENV_ID,
  };
}

// 往復確認用の偽の中継。/nonce は呼び出しごとに異なる nonce／
// ctx を返し、/platform/apply は件数だけを数える。hangApply が
// 真の間は /platform/apply の応答を保留し、releaseApply() で
// 解放する（送信中の競合の確認用）。waitApplySeen() は次の
// /platform/apply の到着を待つ。
function makeRoundTripRelay() {
  const calls = { nonce: 0, apply: 0 };
  const state = { hangApply: false };
  let releaseCurrent = null;
  let seenResolve = null;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (req.url === "/nonce") {
        calls.nonce += 1;
        const n = calls.nonce;
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": `op2_nonce_ctx=rt-ctx-${n}; Path=/; HttpOnly`,
        });
        res.end(JSON.stringify({ nonce: `rt-nonce-${n}` }));
        return;
      }
      if (req.url === "/platform/apply") {
        calls.apply += 1;
        if (seenResolve) {
          const r = seenResolve;
          seenResolve = null;
          r();
        }
        const respond = () => {
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        };
        if (state.hangApply) {
          releaseCurrent = respond;
        } else {
          respond();
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return {
    calls,
    state,
    server,
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return server.address().port;
    },
    waitApplySeen() {
      return new Promise((resolve) => {
        seenResolve = resolve;
      });
    },
    releaseApply() {
      if (releaseCurrent) {
        const r = releaseCurrent;
        releaseCurrent = null;
        r();
      }
    },
    close() {
      server.close();
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    },
  };
}

test("S15 往復：正当なセッションで nonce→凍結→破棄送信→判定が HTTP 層で往復し、未判定の間は新旧どちらの試行 ID でも発行・送信が増えない", async () => {
  const rt = makeRoundTripRelay();
  const rtPort = await rt.listen();
  const driver = await createS15Driver({
    clientId: CLIENT_ID,
    relayUrl: `http://127.0.0.1:${rtPort}`,
    port: DRIVER_PORT_A,
  });
  try {
    // 運転コードはセッションを保持していることだけが分かり、
    // 値そのものは snapshot にも結果にも含まれない。
    assert.deepEqual(driver.snapshot(), { baseUrl: driver.baseUrl, sessionHeld: true });
    // nonce 発行 → 承認固定 → 破棄送信。
    const issued = await driver.issueNonce({ trialId: "rt1", attempt: 1 });
    assert.equal(issued.status, 200);
    assert.equal(issued.nonce, "rt-nonce-1");
    assert.equal(rt.calls.nonce, 1);
    const frozen = await driver.freezeApproval({
      trialId: "rt1",
      attempt: 1,
      operationId: OP5,
      purpose: "full-replace",
      subjectHash: HASH_B,
      envId: ENV_ID,
      oneTimeValue: ONE_TIME_A1,
    });
    assert.equal(frozen.status, 200);
    assert.equal(frozen.ok, true);
    const sent = await driver.sendDiscard({
      trialId: "rt1",
      attempt: 1,
      request: requestFor({ nonce: "rt-nonce-1", oneTimeValue: ONE_TIME_A1 }),
    });
    assert.equal(sent.status, 200);
    // 返すのは破棄記録だけ（実応答の状態・理由・世代はない）。
    assert.deepEqual(Object.keys(sent).sort(), ["outcome", "sent", "status"]);
    assert.equal(sent.sent, true);
    assert.equal(sent.outcome, "discarded");
    // 中継が受けた送信はちょうど1件。
    assert.equal(rt.calls.apply, 1);

    // 未判定の間：(a) 新しい試行 ID では発行も送信もできない。
    const otherNonce = await driver.issueNonce({ trialId: "rt-other", attempt: 1 });
    assert.equal(otherNonce.status, 409);
    assert.equal(otherNonce.error, "s15_trial_unjudged");
    const otherSend = await driver.sendDiscard({
      trialId: "rt-other",
      attempt: 1,
      request: requestFor({ nonce: "rt-nonce-1", oneTimeValue: ONE_TIME_A1 }),
    });
    assert.equal(otherSend.status, 409);
    assert.equal(otherSend.error, "s15_trial_unjudged");
    // 未判定の間：(b) 同じ試行 ID でも、次の試行枠の発行と
    // 送信済み試行枠の再送はできない。
    const nextNonce = await driver.issueNonce({ trialId: "rt1", attempt: 2 });
    assert.equal(nextNonce.status, 409);
    assert.equal(nextNonce.error, "s15_attempt_gate");
    const resend = await driver.sendDiscard({
      trialId: "rt1",
      attempt: 1,
      request: requestFor({ nonce: "rt-nonce-1", oneTimeValue: ONE_TIME_A1 }),
    });
    assert.equal(resend.status, 409);
    assert.equal(resend.error, "s15_not_prepared");
    // どちらの拒否でも、中継の発行・送信件数は増えていない。
    assert.equal(rt.calls.nonce, 1);
    assert.equal(rt.calls.apply, 1);

    // 判定（未成立）を記録すると、同じ試行の再実施が開く。
    const judged = await driver.recordJudgment({ trialId: "rt1", attempt: 1, outcome: "uncommitted" });
    assert.equal(judged.status, 200);
    const issued2 = await driver.issueNonce({ trialId: "rt1", attempt: 2 });
    assert.equal(issued2.status, 200);
    assert.equal(issued2.nonce, "rt-nonce-2");
    const frozen2 = await driver.freezeApproval({
      trialId: "rt1",
      attempt: 2,
      operationId: OP5,
      purpose: "full-replace",
      subjectHash: HASH_B,
      envId: ENV_ID,
      oneTimeValue: ONE_TIME_A2,
    });
    assert.equal(frozen2.status, 200);
    const sent2 = await driver.sendDiscard({
      trialId: "rt1",
      attempt: 2,
      request: requestFor({ nonce: "rt-nonce-2", oneTimeValue: ONE_TIME_A2 }),
    });
    assert.equal(sent2.status, 200);
    assert.equal(rt.calls.apply, 2);
    const judged2 = await driver.recordJudgment({ trialId: "rt1", attempt: 2, outcome: "committed" });
    assert.equal(judged2.status, 200);

    // committed の判定（終端）の後は、新しい試行を開始できる。
    const next = await driver.issueNonce({ trialId: "rt-next", attempt: 1 });
    assert.equal(next.status, 200);
    assert.equal(rt.calls.nonce, 3);

    // 同じ提供サーバーでも、セッションなし・誤ったセッション
    // は 403 で、中継へは何も届かない。
    const before = { ...rt.calls };
    const noSession = await fetch(
      `${driver.baseUrl}/s15/nonces?trial_id=rt-next&attempt=2`
    );
    assert.equal(noSession.status, 403);
    assert.equal((await noSession.json()).error, "s15_bad_session");
    const wrongSession = await fetch(
      `${driver.baseUrl}/s15/nonces?trial_id=rt-next&attempt=2`,
      { headers: { "x-s15-session": "not-the-session" } }
    );
    assert.equal(wrongSession.status, 403);
    assert.deepEqual(rt.calls, before);
  } finally {
    await driver.close();
    rt.close();
  }
});

test("S15 競合：送信中（飛行中）の新しい試行の開始は 409 で拒否され、送信はちょうど1件だけが中継へ届く", async () => {
  const rt = makeRoundTripRelay();
  const rtPort = await rt.listen();
  const driver = await createS15Driver({
    clientId: CLIENT_ID,
    relayUrl: `http://127.0.0.1:${rtPort}`,
    port: DRIVER_PORT_B,
  });
  try {
    const issued = await driver.issueNonce({ trialId: "rc1", attempt: 1 });
    assert.equal(issued.status, 200);
    const frozen = await driver.freezeApproval({
      trialId: "rc1",
      attempt: 1,
      operationId: OP5,
      purpose: "full-replace",
      subjectHash: HASH_B,
      envId: ENV_ID,
      oneTimeValue: ONE_TIME_A1,
    });
    assert.equal(frozen.status, 200);
    // 中継の応答を保留し、破棄送信を飛行中のままにする。
    rt.state.hangApply = true;
    const seen = rt.waitApplySeen();
    const sending = driver.sendDiscard({
      trialId: "rc1",
      attempt: 1,
      request: requestFor({ nonce: "rt-nonce-1", oneTimeValue: ONE_TIME_A1 }),
    });
    await seen; // 中継が送信を受けた＝送信器は送信中
    assert.equal(rt.calls.apply, 1);
    // 送信中に新しい試行 ID で開始しようとしても 409 で、
    // nonce は発行されない。同じ試行の次の試行枠も開かない。
    const other = await driver.issueNonce({ trialId: "rc-other", attempt: 1 });
    assert.equal(other.status, 409);
    assert.equal(other.error, "s15_sender_busy");
    const next = await driver.issueNonce({ trialId: "rc1", attempt: 2 });
    assert.equal(next.status, 409);
    assert.equal(next.error, "s15_sender_busy");
    assert.equal(rt.calls.nonce, 1);
    // 保留を解放すると、送信は破棄記録で完了する（再送はない）。
    rt.releaseApply();
    const sent = await sending;
    assert.equal(sent.status, 200);
    assert.equal(sent.sent, true);
    assert.equal(sent.outcome, "discarded");
    assert.equal(rt.calls.apply, 1);
    // 送信が終わっても未判定の間は、新しい試行は開始できない。
    const afterSend = await driver.issueNonce({ trialId: "rc-other", attempt: 1 });
    assert.equal(afterSend.status, 409);
    assert.equal(afterSend.error, "s15_trial_unjudged");
    assert.equal(rt.calls.nonce, 1);
    // 判定を記録すれば、運転は続けられる。
    const judged = await driver.recordJudgment({ trialId: "rc1", attempt: 1, outcome: "uncommitted" });
    assert.equal(judged.status, 200);
  } finally {
    rt.releaseApply();
    await driver.close();
    rt.close();
  }
});

test("S15 競合：送信中（飛行中）の判定記録は 409 s15_send_in_flight で拒否され、確定後に記録できる", async () => {
  const rt = makeRoundTripRelay();
  const rtPort = await rt.listen();
  const driver = await createS15Driver({
    clientId: CLIENT_ID,
    relayUrl: `http://127.0.0.1:${rtPort}`,
    port: DRIVER_PORT_C,
  });
  try {
    const issued = await driver.issueNonce({ trialId: "rj1", attempt: 1 });
    assert.equal(issued.status, 200);
    const frozen = await driver.freezeApproval({
      trialId: "rj1",
      attempt: 1,
      operationId: OP5,
      purpose: "full-replace",
      subjectHash: HASH_B,
      envId: ENV_ID,
      oneTimeValue: ONE_TIME_A1,
    });
    assert.equal(frozen.status, 200);
    // 中継の応答を保留し、破棄送信を飛行中のままにする。送信は
    // まだ到達・コミット中の可能性がある状態である。
    rt.state.hangApply = true;
    const seen = rt.waitApplySeen();
    const sending = driver.sendDiscard({
      trialId: "rj1",
      attempt: 1,
      request: requestFor({ nonce: "rt-nonce-1", oneTimeValue: ONE_TIME_A1 }),
    });
    await seen; // 中継が送信を受けた＝送信器は送信中
    assert.equal(rt.calls.apply, 1);
    // 飛行中の判定記録は、区分によらず 409 s15_send_in_flight
    // で拒否される（Codex 再レビュー 6879462050 の再現への
    // 対応）。この時点の読み戻しを未成立として記録できては
    // ならない。
    const judgedEarly = await driver.recordJudgment({
      trialId: "rj1",
      attempt: 1,
      outcome: "uncommitted",
    });
    assert.equal(judgedEarly.status, 409);
    assert.equal(judgedEarly.error, "s15_send_in_flight");
    const judgedEarly2 = await driver.recordJudgment({
      trialId: "rj1",
      attempt: 1,
      outcome: "committed",
    });
    assert.equal(judgedEarly2.status, 409);
    assert.equal(judgedEarly2.error, "s15_send_in_flight");
    // 判定が記録されていないため、再実施の発行は開かない。
    // 中継の発行・送信件数も増えていない。
    const reattempt = await driver.issueNonce({ trialId: "rj1", attempt: 2 });
    assert.equal(reattempt.status, 409);
    assert.equal(rt.calls.nonce, 1);
    assert.equal(rt.calls.apply, 1);
    // 応答を解放して送信の Promise が確定すれば（送信試行の
    // 完了）、判定を記録できる。
    rt.releaseApply();
    const sent = await sending;
    assert.equal(sent.status, 200);
    assert.equal(sent.sent, true);
    assert.equal(sent.outcome, "discarded");
    const judged = await driver.recordJudgment({
      trialId: "rj1",
      attempt: 1,
      outcome: "uncommitted",
    });
    assert.equal(judged.status, 200);
    assert.equal(judged.ok, true);
    // 判定の後は通常どおり再実施が開く。
    const issued2 = await driver.issueNonce({ trialId: "rj1", attempt: 2 });
    assert.equal(issued2.status, 200);
    assert.equal(rt.calls.nonce, 2);
  } finally {
    rt.releaseApply();
    await driver.close();
    rt.close();
  }
});
