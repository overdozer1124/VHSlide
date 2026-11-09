// tools/s5-apply.mjs の検証（ローカルのみ）。
// 実行: node --test test/s5-apply.test.mjs
// 実 Google・実 Worker とは通信しない。6件の要求の条件の等しさ、
// nonce の相異、表示・ログの秘密不出力、集計の判定を、ダミー値で確認する。

import test from "node:test";
import assert from "node:assert/strict";
import {
  S5_SLOT_COUNT,
  S5_NO_RESPONSE,
  buildS5Requests,
  verifyNoncesDistinct,
  verifyS5RequestsEqual,
  buildS5SlotDisplay,
  assertS5DisplayKeys,
  verifyS5DisplayMatchesSent,
  makeS5LogEntry,
  aggregateS5Results,
  normalizeS5ResponseError,
} from "../tools/s5-apply.mjs";

// ダミー値。秘密の体裁を持つが、試験のためだけの値である。
const DUMMY_TOKENS = Array.from({ length: 6 }, (_, i) => `dummy-id-token-${i}.aaa.bbb`);
const DUMMY_FIXED_ONE_TIME = "fixed-one-time-dummy";
const DUMMY_NONCES = Array.from({ length: 6 }, (_, i) => `dummy-nonce-${i}-0123456789`);
const DUMMY_SUBJECT_HASH = "0123456789abcdef".repeat(4);
const DUMMY_COOKIE = "op2_nonce_ctx=dummy-context-hash";
const SECRETS = [
  ...DUMMY_TOKENS,
  DUMMY_FIXED_ONE_TIME,
  ...DUMMY_NONCES,
  DUMMY_SUBJECT_HASH,
  DUMMY_COOKIE,
];

function dummyRequests() {
  return buildS5Requests({
    tokens: DUMMY_TOKENS,
    oneTimeValue: DUMMY_FIXED_ONE_TIME,
    purpose: "full-replace",
    envId: "stage1-verification-only-20261101",
  });
}

function dummyDisplays() {
  const requests = dummyRequests();
  return requests.map((request, i) =>
    buildS5SlotDisplay(request, {
      trialId: "trial-s5-001",
      slot: i,
      subjectConfirmed: true,
    })
  );
}

test("6件の要求は深く凍結され、ID トークンだけがスロットごとに異なる", () => {
  const requests = dummyRequests();
  assert.equal(requests.length, S5_SLOT_COUNT);
  assert.equal(Object.isFrozen(requests), true);
  for (const r of requests) {
    assert.equal(Object.isFrozen(r), true);
    assert.equal(r.env_id, "stage1-verification-only-20261101");
    assert.equal(r.purpose, "full-replace");
    assert.equal(r.one_time_value, DUMMY_FIXED_ONE_TIME);
  }
  assert.equal(new Set(requests.map((r) => r.id_token)).size, 6);
  assert.throws(() => {
    requests[0].env_id = "tampered";
  }, TypeError);
  assert.throws(
    () => buildS5Requests({
      tokens: DUMMY_TOKENS.slice(0, 5),
      oneTimeValue: DUMMY_FIXED_ONE_TIME,
      purpose: "full-replace",
      envId: "e",
    }),
    (e) => e.code === "bad_trial_input"
  );
});

test("nonce の相異：6件とも異なれば通り、重複・空があれば拒否される", () => {
  assert.equal(verifyNoncesDistinct(DUMMY_NONCES), true);
  const dup = [...DUMMY_NONCES];
  dup[3] = dup[1];
  assert.throws(() => verifyNoncesDistinct(dup), (e) => {
    assert.equal(e.code, "bad_trial_input");
    // 失敗時の例外文に nonce の値を含まない。
    assert.equal(e.message.includes(DUMMY_NONCES[1]), false);
    return true;
  });
  const empty = [...DUMMY_NONCES];
  empty[2] = "";
  assert.throws(() => verifyNoncesDistinct(empty), (e) => e.code === "bad_trial_input");
  assert.throws(() => verifyNoncesDistinct(DUMMY_NONCES.slice(0, 5)), (e) => e.code === "bad_trial_input");
});

test("6件の条件の等しさ：env_id・purpose・一回値がすべて同一なら通り、1件でも異なれば拒否される", () => {
  assert.equal(verifyS5RequestsEqual(dummyRequests()), true);
  const diffEnv = dummyRequests().map((r) => ({ ...r }));
  diffEnv[4] = { ...diffEnv[4], env_id: "another-env-id" };
  assert.throws(() => verifyS5RequestsEqual(diffEnv), (e) => {
    assert.equal(e.code, "s5_slots_differ");
    assert.equal(e.message.includes("another-env-id"), false);
    return true;
  });
  const diffPurpose = dummyRequests().map((r) => ({ ...r }));
  diffPurpose[2] = { ...diffPurpose[2], purpose: "bootstrap" };
  assert.throws(() => verifyS5RequestsEqual(diffPurpose), (e) => e.code === "s5_slots_differ");
  const diffOneTime = dummyRequests().map((r) => ({ ...r }));
  diffOneTime[0] = { ...diffOneTime[0], one_time_value: "another-one-time" };
  assert.throws(() => verifyS5RequestsEqual(diffOneTime), (e) => e.code === "s5_slots_differ");
  assert.throws(() => verifyS5RequestsEqual(dummyRequests().slice(0, 5)), (e) => e.code === "bad_trial_input");
});

test("スロットごとの表示記録は許された鍵だけで、秘密を含まない", () => {
  const displays = dummyDisplays();
  assert.equal(displays.length, 6);
  for (let i = 0; i < 6; i++) {
    const d = displays[i];
    assert.equal(Object.isFrozen(d), true);
    assertS5DisplayKeys(d);
    assert.equal(d.slot, i);
    assert.equal(d.env_id, "stage1-verification-only-20261101");
    assert.equal(d.purpose, "full-replace");
    assert.equal(d.one_time, "固定の一回値を6件で共用");
    assert.equal(d.nonce, "発行済み・他スロットと異なる");
    assert.equal(
      d.subject,
      "アカウント選択でA（所有者の申告）・署名検証通過（subと承認主体ハッシュの機械的照合ではない）"
    );
    assertNoSecretsCheck(JSON.stringify(d));
  }
  // 主体が未確認の場合は「未確認」と表示する。
  const requests = dummyRequests();
  const ng = buildS5SlotDisplay(requests[0], {
    trialId: "trial-s5-002",
    slot: 0,
    subjectConfirmed: false,
  });
  assert.equal(ng.subject, "未確認");
  function assertNoSecretsCheck(shown) {
    for (const s of SECRETS) assert.equal(shown.includes(s), false);
    assert.equal(shown.includes("id_token"), false);
    assert.equal(shown.includes("one_time_value"), false);
  }
  assert.throws(() => buildS5SlotDisplay(requests[0], {
    trialId: "t", slot: 6, subjectConfirmed: true,
  }), (e) => e.code === "bad_trial_input");
});

test("表示と実送信の同一性：一致すれば通り、改ざんされれば拒否される", () => {
  const requests = dummyRequests();
  const displays = dummyDisplays();
  assert.equal(verifyS5DisplayMatchesSent(displays, requests), true);
  const tampered = displays.map((d) => ({ ...d }));
  tampered[3] = { ...tampered[3], env_id: "another-env-id" };
  assert.throws(() => verifyS5DisplayMatchesSent(tampered, requests), (e) => e.code === "display_sent_mismatch");
  const wrongOrder = [...displays].reverse();
  assert.throws(() => verifyS5DisplayMatchesSent(wrongOrder, requests), (e) => e.code === "display_sent_mismatch");
});

test("試験ログは6件の表示と応答を同一の試験 ID で結び、秘密を含まない", () => {
  const displays = dummyDisplays();
  const entry = makeS5LogEntry({
    trialId: "trial-s5-003",
    slots: displays.map((display, i) => ({
      display,
      response: i === 0
        ? { status: 201, error: null }
        : { status: 409, error: "operation_consumed" },
    })),
  });
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(entry.trial_id, "trial-s5-003");
  assert.equal(entry.slots.length, 6);
  assert.equal(entry.slots[0].response.status, 201);
  // 成功応答は理由コードを持たない。null が unexpected_error へ変換
  // されてはならない（S5 実環境試験 seq 558 の誤表示の回帰）。
  assert.equal(entry.slots[0].response.error, null);
  assert.equal(entry.slots[5].response.error, "operation_consumed");
  const shown = JSON.stringify(entry);
  for (const s of SECRETS) assert.equal(shown.includes(s), false);
  // 応答なしのスロットは status null・error "no_response" として記録する。
  const entryLost = makeS5LogEntry({
    trialId: "trial-s5-004",
    slots: displays.map((display, i) => ({
      display,
      response: i === 2
        ? { status: null, error: "no_response" }
        : { status: 409, error: "operation_consumed" },
    })),
  });
  assert.equal(entryLost.slots[2].response.status, null);
  assert.equal(entryLost.slots[2].response.error, "no_response");
  // 許可一覧にない理由コードは unexpected_error へ置き換える。
  const entryBad = makeS5LogEntry({
    trialId: "trial-s5-005",
    slots: displays.map((display) => ({
      display,
      response: { status: 500, error: "internal boom" },
    })),
  });
  assert.equal(entryBad.slots[0].response.error, "unexpected_error");
  assert.equal(normalizeS5ResponseError("no_response"), S5_NO_RESPONSE);
  assert.equal(normalizeS5ResponseError("operation_consumed"), "operation_consumed");
  // 成功の error は null のまま通す（undefined も同様）。
  assert.equal(normalizeS5ResponseError(null), null);
  assert.equal(normalizeS5ResponseError(undefined), null);
});

test("集計：201 が正確に1件で残りがすべて 409 operation_consumed のときにだけ ok になる", () => {
  const okResults = [
    { slot: 0, status: 201, error: null },
    ...[1, 2, 3, 4, 5].map((slot) => ({ slot, status: 409, error: "operation_consumed" })),
  ];
  const aggOk = aggregateS5Results(okResults);
  assert.equal(aggOk.success, 1);
  assert.equal(aggOk.consumed, 5);
  assert.equal(aggOk.no_response, 0);
  assert.equal(aggOk.ok, true);
  // 成功が2件なら ok ではない。
  const twoOk = okResults.map((r) => (r.slot === 1 ? { slot: 1, status: 201, error: null } : r));
  assert.equal(aggregateS5Results(twoOk).ok, false);
  // 成功が0件なら ok ではない。
  const zeroOk = okResults.map((r) => (r.slot === 0 ? { slot: 0, status: 409, error: "operation_consumed" } : r));
  assert.equal(aggregateS5Results(zeroOk).ok, false);
  // 応答なしがあれば ok ではない。
  const lost = okResults.map((r) => (r.slot === 3 ? { slot: 3, status: null, error: "no_response" } : r));
  const aggLost = aggregateS5Results(lost);
  assert.equal(aggLost.no_response, 1);
  assert.equal(aggLost.ok, false);
  // 409 でも operation_consumed 以外は other になる。
  const other = okResults.map((r) => (r.slot === 4 ? { slot: 4, status: 409, error: "already_initialized" } : r));
  const aggOther = aggregateS5Results(other);
  assert.equal(aggOther.consumed, 4);
  assert.equal(aggOther.other.length, 1);
  assert.equal(aggOther.ok, false);
});
