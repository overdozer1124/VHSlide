// S15 応答破棄ドリル送信器（tools/s15-sender.mjs）の単体試験。
// 実行: node --test test/s15-sender.test.mjs
// （npm run test:s15 でも実行できる）
//
// 目的：破棄送信の規律と判定ゲートを、実 Google・実 Worker を
// 使わずに検証する。
// - 破棄の証明：偽の応答について、状態（status）・ok・
//   ヘッダー（headers／getSetCookie）に触れ、本文の取得
//   （json／text）を試みると例外になるように仕掛ける。送信
//   結果は { sent: true, outcome: "discarded" } だけであり、
//   触れられた回数は 0、json／text の呼び出し回数も 0 である
//   こと（応答は本文の cancel で閉じられるだけ）。3xx の応答
//   も追従せずに破棄すること。
// - 例外・タイムアウト：fetch が投げた場合（通信例外）と、
//   AbortError で拒否された場合（タイムアウト）でも、戻り値
//   は同じ破棄記録であり、例外は外へ伝播せず、送信はちょうど
//   1回だけであること（自動再送がないこと）。
// - 再送経路の不在：送信の入口は sendDiscard だけで、消費済み
//   の試行枠は s15_not_prepared で拒否されること。
// - 判定ゲート：先行試行が未確定（判定未記録）の間は次の試行
//   の発行・固定・送信が拒否され、未成立の判定の記録で開く
//   こと。committed の判定の後は永久に拒否されること。
// - 承認固定の関門：固定なしの送信の拒否。用途・環境ID・
//   一回値の不一致の拒否（拒否されても試行枠は消費されず、
//   送信もされない）。再実施では承認内容が先行試行と一致する
//   こと（一回値だけが新しい値でよい）。
// - 送信前確認：試行枠の nonce とトークンの nonce 主張の一致、
//   送信窓（発行開始＋4分）の期限、busy の重複拒否。
// - snapshot() に一回値・Cookie・nonce・ID トークンが含まれ
//   ないこと。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import { createS15Sender } from "../tools/s15-sender.mjs";

const RELAY = "http://127.0.0.1:18087";
const ENV_ID = "stage1-phase2-verification-local";
const HASH_B = "b".repeat(64);
const OP5 = "op-fixture-005";
const ONE_TIME_1 = "one-time-value-attempt-1";
const ONE_TIME_2 = "one-time-value-attempt-2";
const NONCE_1 = "nonce-attempt-1";
const NONCE_2 = "nonce-attempt-2";

function assertCodeAsync(promise, code) {
  return assert.rejects(promise, (e) => e && e.code === code);
}
function assertCode(fn, code) {
  assert.throws(fn, (e) => e && e.code === code);
}

function tokenFor(nonce) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "subject-b", nonce, iss: "https://accounts.google.com", aud: "dummy", exp: 9999999999 })
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

// 触れられた回数を数え、本文取得で例外になる偽の応答。
// 破棄送信が正しく動けば、status／ok／headers へのアクセスは
// 0、json／text の呼び出しは 0、body.cancel だけが1回呼ばれる。
function recordingResponse() {
  const access = { status: 0, ok: 0, headers: 0, json: 0, text: 0, cancel: 0 };
  const body = {
    async cancel() {
      access.cancel++;
    },
  };
  const res = {};
  Object.defineProperty(res, "status", {
    configurable: true,
    get() {
      access.status++;
      return 200;
    },
  });
  Object.defineProperty(res, "ok", {
    configurable: true,
    get() {
      access.ok++;
      return true;
    },
  });
  Object.defineProperty(res, "headers", {
    get() {
      access.headers++;
      throw new Error("headers must not be read");
    },
  });
  res.json = async () => {
    access.json++;
    throw new Error("body must not be read");
  };
  res.text = async () => {
    access.text++;
    throw new Error("body must not be read");
  };
  res.body = body;
  return { res, access };
}

// 中継の /nonce を再現する fetch 偽装。attempt ごとに distinct な
// nonce／ctx を返し、/platform/apply への送信は呼び出し側の
// applyImpl へ委ねる。
function makeRelayFetch({ applyImpl }) {
  const calls = [];
  let nonceSeq = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/nonce")) {
      nonceSeq++;
      return {
        status: 200,
        ok: true,
        async json() {
          return { nonce: `nonce-attempt-${nonceSeq}` };
        },
        headers: {
          getSetCookie() {
            return [`op2_nonce_ctx=ctx-attempt-${nonceSeq}; Path=/; HttpOnly; SameSite=Lax`];
          },
        },
      };
    }
    return applyImpl(url, init);
  };
  return { calls, fetchImpl };
}

function applyCallsOf(calls) {
  return calls.filter((c) => c.url.endsWith("/platform/apply"));
}

// 1つの試行を送信器に載せ、試行枠 attempt を送信直前まで整える
// （発行＋固定）。送信は呼び出し側が行う。
async function preparedAttempt(sender, { trialId, attempt, oneTimeValue }) {
  const issued = await sender.issueNonce({ trialId, attempt });
  sender.freezeApproval({
    trialId,
    attempt,
    operationId: OP5,
    purpose: "full-replace",
    subjectHash: HASH_B,
    envId: ENV_ID,
    oneTimeValue,
  });
  return issued;
}

function requestFor({ nonce, oneTimeValue, purpose = "full-replace", envId = ENV_ID, token }) {
  return {
    id_token: token ?? tokenFor(nonce),
    one_time_value: oneTimeValue,
    purpose,
    env_id: envId,
  };
}

test("破棄の証明：応答の状態・ヘッダー・本文に触れずに送信を完了する", async () => {
  const { res, access } = recordingResponse();
  const { calls, fetchImpl } = makeRelayFetch({ applyImpl: async () => res });
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl });
  sender.beginTrial("t1");
  const { nonce } = await preparedAttempt(sender, { trialId: "t1", attempt: 1, oneTimeValue: ONE_TIME_1 });
  assert.equal(nonce, NONCE_1);
  const result = await sender.sendDiscard({
    trialId: "t1",
    attempt: 1,
    request: requestFor({ nonce: NONCE_1, oneTimeValue: ONE_TIME_1 }),
  });
  // 戻り値は破棄記録だけ（状態・理由・世代の欄がない）。
  assert.deepEqual({ ...result }, { sent: true, outcome: "discarded" });
  assert.deepEqual(Object.keys(result).sort(), ["outcome", "sent"]);
  // 応答には本文の cancel のほか一切触れていない。
  assert.equal(access.status, 0);
  assert.equal(access.ok, 0);
  assert.equal(access.headers, 0);
  assert.equal(access.json, 0);
  assert.equal(access.text, 0);
  assert.equal(access.cancel, 1);
  // 送信はちょうど1回、正しい宛先と固定値で行われた。
  const applies = applyCallsOf(calls);
  assert.equal(applies.length, 1);
  assert.equal(applies[0].url, `${RELAY}/platform/apply`);
  assert.equal(applies[0].init.method, "POST");
  assert.equal(applies[0].init.redirect, "manual");
  assert.equal(applies[0].init.headers.Origin, "http://localhost:8787");
  assert.equal(applies[0].init.headers.Cookie, "op2_nonce_ctx=ctx-attempt-1");
  assert.equal(sender.slotConsumed("t1", 1), true);
});

test("3xx は追従せず、応答を読まずに破棄する", async () => {
  const { res, access } = recordingResponse();
  Object.defineProperty(res, "status", {
    configurable: true,
    get() {
      access.status++;
      return 302;
    },
  });
  const { calls, fetchImpl } = makeRelayFetch({ applyImpl: async () => res });
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl });
  sender.beginTrial("t1");
  await preparedAttempt(sender, { trialId: "t1", attempt: 1, oneTimeValue: ONE_TIME_1 });
  const result = await sender.sendDiscard({
    trialId: "t1",
    attempt: 1,
    request: requestFor({ nonce: NONCE_1, oneTimeValue: ONE_TIME_1 }),
  });
  assert.deepEqual({ ...result }, { sent: true, outcome: "discarded" });
  assert.equal(applyCallsOf(calls).length, 1); // 転送先への追加送信はない
  assert.equal(access.json, 0);
  assert.equal(access.text, 0);
  assert.equal(access.headers, 0);
});

test("通信例外：fetch が投げても破棄記録が返り、送信はちょうど1回（自動再送なし）", async () => {
  const { calls, fetchImpl } = makeRelayFetch({
    applyImpl: async () => {
      throw new Error("connection reset");
    },
  });
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl });
  sender.beginTrial("t1");
  await preparedAttempt(sender, { trialId: "t1", attempt: 1, oneTimeValue: ONE_TIME_1 });
  const result = await sender.sendDiscard({
    trialId: "t1",
    attempt: 1,
    request: requestFor({ nonce: NONCE_1, oneTimeValue: ONE_TIME_1 }),
  });
  assert.deepEqual({ ...result }, { sent: true, outcome: "discarded" });
  assert.equal(applyCallsOf(calls).length, 1);
  assert.equal(sender.slotConsumed("t1", 1), true);
  // 再送の経路はない：同じ試行枠の再送信は拒否される。
  await assertCodeAsync(
    sender.sendDiscard({ trialId: "t1", attempt: 1, request: requestFor({ nonce: NONCE_1, oneTimeValue: ONE_TIME_1 }) }),
    "s15_not_prepared"
  );
  assert.equal(applyCallsOf(calls).length, 1);
});

test("タイムアウト：AbortError でも破棄記録が返り、送信はちょうど1回", async () => {
  const { calls, fetchImpl } = makeRelayFetch({
    applyImpl: async () => {
      const e = new Error("The operation was aborted");
      e.name = "AbortError";
      throw e;
    },
  });
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl });
  sender.beginTrial("t1");
  await preparedAttempt(sender, { trialId: "t1", attempt: 1, oneTimeValue: ONE_TIME_1 });
  const result = await sender.sendDiscard({
    trialId: "t1",
    attempt: 1,
    request: requestFor({ nonce: NONCE_1, oneTimeValue: ONE_TIME_1 }),
  });
  assert.deepEqual({ ...result }, { sent: true, outcome: "discarded" });
  assert.equal(applyCallsOf(calls).length, 1);
});

test("判定ゲート：未確定の間の次の試行は拒否され、未成立の判定で開き、committed で閉じる", async () => {
  const { res } = recordingResponse();
  const { calls, fetchImpl } = makeRelayFetch({ applyImpl: async () => res });
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl });
  sender.beginTrial("t1");
  // 試行を飛ばすことはできない（試行2は試行1の前に始められない）。
  await assertCodeAsync(sender.issueNonce({ trialId: "t1", attempt: 2 }), "s15_attempt_gate");
  await preparedAttempt(sender, { trialId: "t1", attempt: 1, oneTimeValue: ONE_TIME_1 });
  await sender.sendDiscard({
    trialId: "t1",
    attempt: 1,
    request: requestFor({ nonce: NONCE_1, oneTimeValue: ONE_TIME_1 }),
  });
  // 未確定（判定未記録）：発行・固定・送信のすべてが拒否される。
  await assertCodeAsync(sender.issueNonce({ trialId: "t1", attempt: 2 }), "s15_attempt_gate");
  assertCode(
    () =>
      sender.freezeApproval({
        trialId: "t1",
        attempt: 2,
        operationId: OP5,
        purpose: "full-replace",
        subjectHash: HASH_B,
        envId: ENV_ID,
        oneTimeValue: ONE_TIME_2,
      }),
    "s15_attempt_gate"
  );
  await assertCodeAsync(
    sender.sendDiscard({ trialId: "t1", attempt: 2, request: requestFor({ nonce: NONCE_2, oneTimeValue: ONE_TIME_2 }) }),
    "s15_attempt_gate"
  );
  // 未成立の判定を記録すると、試行2が開く。
  assert.equal(sender.recordJudgment({ trialId: "t1", attempt: 1, outcome: "uncommitted" }), true);
  await preparedAttempt(sender, { trialId: "t1", attempt: 2, oneTimeValue: ONE_TIME_2 });
  await sender.sendDiscard({
    trialId: "t1",
    attempt: 2,
    request: requestFor({ nonce: NONCE_2, oneTimeValue: ONE_TIME_2 }),
  });
  // committed の判定の後は試行3が永久に拒否される。
  assert.equal(sender.recordJudgment({ trialId: "t1", attempt: 2, outcome: "committed" }), true);
  await assertCodeAsync(sender.issueNonce({ trialId: "t1", attempt: 3 }), "s15_already_committed");
  await assertCodeAsync(
    sender.sendDiscard({ trialId: "t1", attempt: 3, request: requestFor({ nonce: "n", oneTimeValue: ONE_TIME_1 }) }),
    "s15_already_committed"
  );
  assert.equal(applyCallsOf(calls).length, 2);
  // 判定の記録は送信済みの最新試行に1回だけ。
  assertCode(() => sender.recordJudgment({ trialId: "t1", attempt: 2, outcome: "committed" }), "s15_judgment_order");
  assertCode(() => sender.recordJudgment({ trialId: "t1", attempt: 3, outcome: "uncommitted" }), "s15_judgment_order");
});

test("承認固定なしの送信は拒否され、送信も消費もされない", async () => {
  const { res } = recordingResponse();
  const { calls, fetchImpl } = makeRelayFetch({ applyImpl: async () => res });
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl });
  sender.beginTrial("t1");
  await sender.issueNonce({ trialId: "t1", attempt: 1 });
  await assertCodeAsync(
    sender.sendDiscard({ trialId: "t1", attempt: 1, request: requestFor({ nonce: NONCE_1, oneTimeValue: ONE_TIME_1 }) }),
    "s15_approval_not_frozen"
  );
  assert.equal(applyCallsOf(calls).length, 0);
  assert.equal(sender.slotConsumed("t1", 1), false);
});

test("承認内容との不一致：用途・環境ID・一回値は送信前に拒否される", async () => {
  const { res } = recordingResponse();
  const { calls, fetchImpl } = makeRelayFetch({ applyImpl: async () => res });
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl });
  sender.beginTrial("t1");
  await preparedAttempt(sender, { trialId: "t1", attempt: 1, oneTimeValue: ONE_TIME_1 });
  await assertCodeAsync(
    sender.sendDiscard({ trialId: "t1", attempt: 1, request: requestFor({ nonce: NONCE_1, oneTimeValue: ONE_TIME_1, purpose: "bootstrap" }) }),
    "s15_purpose_mismatch"
  );
  await assertCodeAsync(
    sender.sendDiscard({ trialId: "t1", attempt: 1, request: requestFor({ nonce: NONCE_1, oneTimeValue: ONE_TIME_1, envId: "other-env" }) }),
    "s15_env_mismatch"
  );
  await assertCodeAsync(
    sender.sendDiscard({ trialId: "t1", attempt: 1, request: requestFor({ nonce: NONCE_1, oneTimeValue: "wrong-value" }) }),
    "s15_one_time_mismatch"
  );
  // 一回値の不一致は、拒否理由にも値そのものを残さない。
  await assert.rejects(
    sender.sendDiscard({ trialId: "t1", attempt: 1, request: requestFor({ nonce: NONCE_1, oneTimeValue: "wrong-value" }) }),
    (e) => e.code === "s15_one_time_mismatch" && !e.message.includes("wrong-value") && !e.message.includes(ONE_TIME_1)
  );
  assert.equal(applyCallsOf(calls).length, 0);
  assert.equal(sender.slotConsumed("t1", 1), false);
});

test("nonce 不一致は送信前に拒否される", async () => {
  const { res } = recordingResponse();
  const { calls, fetchImpl } = makeRelayFetch({ applyImpl: async () => res });
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl });
  sender.beginTrial("t1");
  await preparedAttempt(sender, { trialId: "t1", attempt: 1, oneTimeValue: ONE_TIME_1 });
  await assertCodeAsync(
    sender.sendDiscard({ trialId: "t1", attempt: 1, request: requestFor({ nonce: "other-nonce", oneTimeValue: ONE_TIME_1 }) }),
    "s15_slot_nonce_mismatch"
  );
  assert.equal(applyCallsOf(calls).length, 0);
  assert.equal(sender.slotConsumed("t1", 1), false);
});

test("送信窓：発行開始＋4分を過ぎた試行枠は送信されない", async () => {
  const { res } = recordingResponse();
  const { calls, fetchImpl } = makeRelayFetch({ applyImpl: async () => res });
  const base = 1_700_000_000_000;
  let nowMs = base;
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl, now: () => nowMs });
  sender.beginTrial("t1");
  await preparedAttempt(sender, { trialId: "t1", attempt: 1, oneTimeValue: ONE_TIME_1 });
  assert.equal(sender.slotIssuedAt("t1", 1), base);
  nowMs = base + 4 * 60 * 1000; // 境界そのものは窓の外
  await assertCodeAsync(
    sender.sendDiscard({ trialId: "t1", attempt: 1, request: requestFor({ nonce: NONCE_1, oneTimeValue: ONE_TIME_1 }) }),
    "s15_nonces_expired"
  );
  assert.equal(applyCallsOf(calls).length, 0);
  assert.equal(sender.slotConsumed("t1", 1), false);
});

test("busy：飛行中の送信と重なる発行・送信は拒否される", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { res } = recordingResponse();
  const { fetchImpl } = makeRelayFetch({
    applyImpl: async () => {
      await gate;
      return res;
    },
  });
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl });
  sender.beginTrial("t1");
  await preparedAttempt(sender, { trialId: "t1", attempt: 1, oneTimeValue: ONE_TIME_1 });
  const sending = sender.sendDiscard({
    trialId: "t1",
    attempt: 1,
    request: requestFor({ nonce: NONCE_1, oneTimeValue: ONE_TIME_1 }),
  });
  await assertCodeAsync(sender.issueNonce({ trialId: "t1", attempt: 2 }), "s15_sender_busy");
  release();
  const result = await sending;
  assert.deepEqual({ ...result }, { sent: true, outcome: "discarded" });
});

test("固定の冪等性と再実施の内容一致：操作IDが変われば拒否、一回値だけが新しい値でよい", async () => {
  const { res } = recordingResponse();
  const { fetchImpl } = makeRelayFetch({ applyImpl: async () => res });
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl });
  sender.beginTrial("t1");
  await sender.issueNonce({ trialId: "t1", attempt: 1 });
  sender.freezeApproval({
    trialId: "t1",
    attempt: 1,
    operationId: OP5,
    purpose: "full-replace",
    subjectHash: HASH_B,
    envId: ENV_ID,
    oneTimeValue: ONE_TIME_1,
  });
  // 同じ内容の再固定は冪等。異なる内容は拒否。
  assert.equal(
    sender.freezeApproval({
      trialId: "t1",
      attempt: 1,
      operationId: OP5,
      purpose: "full-replace",
      subjectHash: HASH_B,
      envId: ENV_ID,
      oneTimeValue: ONE_TIME_1,
    }),
    true
  );
  assertCode(
    () =>
      sender.freezeApproval({
        trialId: "t1",
        attempt: 1,
        operationId: OP5,
        purpose: "full-replace",
        subjectHash: HASH_B,
        envId: ENV_ID,
        oneTimeValue: ONE_TIME_2,
      }),
    "s15_approval_mismatch"
  );
  assertCode(
    () =>
      sender.freezeApproval({
        trialId: "t1",
        attempt: 1,
        operationId: OP5,
        purpose: "bootstrap",
        subjectHash: HASH_B,
        envId: ENV_ID,
        oneTimeValue: ONE_TIME_1,
      }),
    "s15_purpose_mismatch"
  );
  await sender.sendDiscard({
    trialId: "t1",
    attempt: 1,
    request: requestFor({ nonce: NONCE_1, oneTimeValue: ONE_TIME_1 }),
  });
  sender.recordJudgment({ trialId: "t1", attempt: 1, outcome: "uncommitted" });
  // 再実施の試行枠では、操作IDが先行試行と異なれば拒否される。
  await sender.issueNonce({ trialId: "t1", attempt: 2 });
  assertCode(
    () =>
      sender.freezeApproval({
        trialId: "t1",
        attempt: 2,
        operationId: "op-fixture-999",
        purpose: "full-replace",
        subjectHash: HASH_B,
        envId: ENV_ID,
        oneTimeValue: ONE_TIME_2,
      }),
    "s15_approval_mismatch"
  );
  assert.equal(
    sender.freezeApproval({
      trialId: "t1",
      attempt: 2,
      operationId: OP5,
      purpose: "full-replace",
      subjectHash: HASH_B,
      envId: ENV_ID,
      oneTimeValue: ONE_TIME_2,
    }),
    true
  );
});

test("snapshot には一回値・Cookie・nonce・ID トークンが含まれない", async () => {
  const { res } = recordingResponse();
  const { fetchImpl } = makeRelayFetch({ applyImpl: async () => res });
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl });
  sender.beginTrial("t1");
  await preparedAttempt(sender, { trialId: "t1", attempt: 1, oneTimeValue: ONE_TIME_1 });
  const json = JSON.stringify(sender.snapshot());
  for (const secret of [ONE_TIME_1, "ctx-attempt-1", NONCE_1, "subject-b"]) {
    assert.ok(!json.includes(secret), `snapshot に秘密が含まれます: ${secret}`);
  }
  const snap = sender.snapshot();
  assert.equal(snap.attempts[1].approvalFrozen, true);
  assert.equal(snap.attempts[1].consumed, false);
  assert.equal(snap.attemptsSent, 0);
  // discard で状態は消える。
  assert.equal(sender.discard(), true);
  assert.equal(sender.snapshot(), null);
});

test("送信の入口は sendDiscard だけであり、試行枠の再発行はできない", async () => {
  const { res } = recordingResponse();
  const { fetchImpl } = makeRelayFetch({ applyImpl: async () => res });
  const sender = createS15Sender({ relayUrl: RELAY, fetchImpl });
  assert.deepEqual(Object.keys(sender).sort(), [
    "beginTrial",
    "discard",
    "freezeApproval",
    "issueNonce",
    "recordJudgment",
    "sendDiscard",
    "slotConsumed",
    "slotIssuedAt",
    "snapshot",
  ]);
  sender.beginTrial("t1");
  await sender.issueNonce({ trialId: "t1", attempt: 1 });
  await assertCodeAsync(sender.issueNonce({ trialId: "t1", attempt: 1 }), "s15_slot_already_issued");
  await assertCodeAsync(sender.issueNonce({ trialId: "t1", attempt: 4 }), "s15_bad_attempt");
  assertCode(
    () =>
      sender.freezeApproval({
        trialId: "other-trial",
        attempt: 1,
        operationId: OP5,
        purpose: "full-replace",
        subjectHash: HASH_B,
        envId: ENV_ID,
        oneTimeValue: ONE_TIME_1,
      }),
    "s15_trial_mismatch"
  );
});
