// S11 並行送信専用モジュール（tools/s11-parallel.mjs）の単体試験。
// 実行: node --test test/s11-parallel.test.mjs
// （npm run test:s11 でも実行できる）
//
// 目的：Codex の手順レビュー（SwarmChat seq 691）で合意した S11 の
// 状態機械・機械確認を、実 Google・実 Worker を使わずに検証する。
// - 順序：C の主体取得 → B の参照取得 → 手順3の A 認可 → 手順3の
//   凍結 → 手順3の送信 → 手順4の A 認可×2 → 手順4の凍結 → 手順4
//   の送信の固定順であること。手順4は手順3が期待どおり拒否された
//   場合にだけ始められること。
// - 機械確認：C が B・A と同一なら停止すること。手順4の2件の
//   認可が同一主体（A）で手順3の認可者とも同一でなければ停止する
//   こと。凍結した2件の要求が同一であること。
// - 手順3の期待は 409 stale_generation であり、それ以外では停止
//   して手順4へ進めないこと。応答なしは状態未確定として停止し、
//   再送できないこと。
// - 手順4の期待は成功ちょうど1件（200・generation 4）と
//   409 stale_generation 1件であること。成功2件・成功0件・応答
//   なしでは停止すること。
// - nonce の取得は役割ごとに閉じ込められ、取得中の再取得・取得
//   済みの再取得が拒否され、遅れて戻った旧応答が破棄されること。
// - 各役割の捕捉は1回だけ受け付けること。古い試行のコールバック
//   は拒否されること。
// - ログ記録には ID トークン・Cookie・nonce・主体ハッシュが含ま
//   れないこと。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import {
  createS11Session,
  buildS11Request,
  buildS11Requests,
  verifyS11RequestsIdentical,
  verifyNoncesDistinct,
  aggregateS11ConcurrentResults,
  makeS11LogEntry,
  makeS11ConcurrentLogEntry,
  ADD_ACTION,
  ADD_PATH,
  STALE_EXPECTED_GENERATION,
  CONCURRENT_EXPECTED_GENERATION,
  EXPECTED_CONCURRENT_FINAL_GENERATION,
  S11_TOKEN_ERASE_TRIGGERS,
} from "../tools/s11-parallel.mjs";

const HASH_C = "c".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_A = "a".repeat(64);
const HASH_X = "d".repeat(64);
const VERIFIED = { signature: true, iss: true, aud: true, exp: true, nonce: true };

// nonce 取得を済ませて役割の捕捉を完了させる補助。
function capture(session, trialId, generation, role, hash, atMs) {
  session.beginNonceFetch(trialId, generation, role, atMs);
  session.finishNonceFetch(trialId, generation, role, `nonce-${role.toLowerCase()}`);
  if (role === "C") session.markCCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
  else if (role === "B") session.markBCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
  else if (role === "P3") session.markP3Captured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
  else if (role === "P4-1") session.markP4Captured(trialId, generation, 0, { subjectHash: hash, verified: VERIFIED });
  else if (role === "P4-2") session.markP4Captured(trialId, generation, 1, { subjectHash: hash, verified: VERIFIED });
}

// 手順3の送信が期待どおり拒否されるまで進めた試行を返す。
function trialThroughStale() {
  const session = createS11Session();
  const { trialId, generation } = session.beginTrial();
  capture(session, trialId, generation, "C", HASH_C, 1000);
  capture(session, trialId, generation, "B", HASH_B, 2000);
  capture(session, trialId, generation, "P3", HASH_A, 3000);
  session.freezeStaleRequest(trialId, generation);
  const outcome = session.recordStaleSend(trialId, generation, {
    status: 409,
    error: "stale_generation",
    generation: null,
  });
  assert.equal(outcome.matched, true);
  return { session, trialId, generation };
}

// 手順4の凍結まで進めた試行を返す。
function trialThroughConcurrentFreeze() {
  const ctx = trialThroughStale();
  const { session, trialId, generation } = ctx;
  capture(session, trialId, generation, "P4-1", HASH_A, 4000);
  capture(session, trialId, generation, "P4-2", HASH_A, 5000);
  session.freezeConcurrentRequests(trialId, generation);
  return ctx;
}

test("S11: 試行の開始直後は C の主体取得の準備中である", () => {
  const session = createS11Session();
  const { trialId, generation } = session.beginTrial();
  assert.equal(session.snapshot().phase, "c-preparing");
  assert.equal(session.currentTrialId(), trialId);
  assert.equal(session.snapshot().generation, generation);
});

test("S11: 順序外の nonce 取得は拒否される（B は C の後、手順3は参照の後、手順4は手順3の後）", () => {
  const session = createS11Session();
  const { trialId, generation } = session.beginTrial();
  assert.throws(
    () => session.beginNonceFetch(trialId, generation, "B", 1000),
    (e) => e.code === "trial_order"
  );
  assert.throws(
    () => session.beginNonceFetch(trialId, generation, "P3", 1000),
    (e) => e.code === "trial_order"
  );
  assert.throws(
    () => session.beginNonceFetch(trialId, generation, "P4-1", 1000),
    (e) => e.code === "trial_order"
  );
  capture(session, trialId, generation, "C", HASH_C, 1000);
  assert.throws(
    () => session.beginNonceFetch(trialId, generation, "P3", 2000),
    (e) => e.code === "trial_order"
  );
  capture(session, trialId, generation, "B", HASH_B, 2000);
  capture(session, trialId, generation, "P3", HASH_A, 3000);
  // 手順3の送信前は手順4の取得を始められない。
  assert.throws(
    () => session.beginNonceFetch(trialId, generation, "P4-1", 4000),
    (e) => e.code === "trial_order"
  );
});

test("S11: nonce 取得は取得中の再取得と取得済みの再取得を拒否する", () => {
  const session = createS11Session();
  const { trialId, generation } = session.beginTrial();
  session.beginNonceFetch(trialId, generation, "C", 1000);
  assert.throws(
    () => session.beginNonceFetch(trialId, generation, "C", 1001),
    (e) => e.code === "nonce_fetch_busy"
  );
  session.finishNonceFetch(trialId, generation, "C", "nonce-c");
  assert.throws(
    () => session.beginNonceFetch(trialId, generation, "C", 1002),
    (e) => e.code === "nonce_already_issued"
  );
});

test("S11: 遅れて戻った旧試行の nonce 応答は破棄される", () => {
  const session = createS11Session();
  const first = session.beginTrial();
  session.beginNonceFetch(first.trialId, first.generation, "C", 1000);
  const second = session.beginTrial();
  assert.equal(session.finishNonceFetch(first.trialId, first.generation, "C", "nonce-old"), null);
  assert.equal(session.nonceIssuedAt(second.trialId, second.generation, "C"), null);
  session.beginNonceFetch(second.trialId, second.generation, "C", 2000);
  const applied = session.finishNonceFetch(second.trialId, second.generation, "C", "nonce-new");
  assert.equal(applied.nonce, "nonce-new");
  assert.equal(applied.issuedAtMs, 2000);
});

test("S11: C の捕捉は nonce 未取得・形式不正・検証不完全を拒否する", () => {
  const session = createS11Session();
  const { trialId, generation } = session.beginTrial();
  assert.throws(
    () => session.markCCaptured(trialId, generation, { subjectHash: HASH_C, verified: VERIFIED }),
    (e) => e.code === "trial_order"
  );
  session.beginNonceFetch(trialId, generation, "C", 1000);
  session.finishNonceFetch(trialId, generation, "C", "nonce-c");
  assert.throws(
    () => session.markCCaptured(trialId, generation, { subjectHash: "not-a-hash", verified: VERIFIED }),
    (e) => e.code === "bad_trial_input"
  );
  assert.throws(
    () =>
      session.markCCaptured(trialId, generation, {
        subjectHash: HASH_C,
        verified: { ...VERIFIED, nonce: false },
      }),
    (e) => e.code === "verification_incomplete"
  );
});

test("S11: C と B の主体ハッシュが同一の場合は target_matches_operator で試行が停止する", () => {
  const session = createS11Session();
  const { trialId, generation } = session.beginTrial();
  capture(session, trialId, generation, "C", HASH_C, 1000);
  session.beginNonceFetch(trialId, generation, "B", 2000);
  session.finishNonceFetch(trialId, generation, "B", "nonce-b");
  assert.throws(
    () => session.markBCaptured(trialId, generation, { subjectHash: HASH_C, verified: VERIFIED }),
    (e) => e.code === "target_matches_operator"
  );
  assert.equal(session.snapshot().phase, "halted");
  assert.throws(
    () => session.beginNonceFetch(trialId, generation, "P3", 3000),
    (e) => e.code === "trial_order"
  );
});

test("S11: 手順3の認可者が B または C の場合は wrong_authorizer で試行が停止する", () => {
  for (const badHash of [HASH_B, HASH_C]) {
    const session = createS11Session();
    const { trialId, generation } = session.beginTrial();
    capture(session, trialId, generation, "C", HASH_C, 1000);
    capture(session, trialId, generation, "B", HASH_B, 2000);
    session.beginNonceFetch(trialId, generation, "P3", 3000);
    session.finishNonceFetch(trialId, generation, "P3", "nonce-p3");
    assert.throws(
      () => session.markP3Captured(trialId, generation, { subjectHash: badHash, verified: VERIFIED }),
      (e) => e.code === "wrong_authorizer"
    );
    assert.equal(session.snapshot().phase, "halted");
  }
});

test("S11: 手順3の凍結要求は C の主体ハッシュと固定値の期待世代 2 から生成される", () => {
  const session = createS11Session();
  const { trialId, generation } = session.beginTrial();
  capture(session, trialId, generation, "C", HASH_C, 1000);
  capture(session, trialId, generation, "B", HASH_B, 2000);
  capture(session, trialId, generation, "P3", HASH_A, 3000);
  assert.equal(session.canSendStale(trialId, generation), false);
  const frozen = session.freezeStaleRequest(trialId, generation);
  assert.equal(frozen.action, ADD_ACTION);
  assert.equal(frozen.path, ADD_PATH);
  assert.equal(frozen.targetSubjectHash, HASH_C);
  assert.equal(frozen.expectedGeneration, STALE_EXPECTED_GENERATION);
  assert.equal(frozen.expectedGeneration, 2);
  const display = session.staleDisplayData(trialId, generation);
  assert.deepEqual(display, frozen);
  assert.equal(session.canSendStale(trialId, generation), true);
});

test("S11: 手順3が期待どおり 409 stale_generation なら手順4を始められる", () => {
  const { session, trialId, generation } = trialThroughStale();
  assert.equal(session.snapshot().phase, "p3-completed");
  assert.equal(session.canSendStale(trialId, generation), false);
  // 手順4の取得を始められる。
  session.beginNonceFetch(trialId, generation, "P4-1", 4000);
  session.finishNonceFetch(trialId, generation, "P4-1", "nonce-p4-1");
});

test("S11: 手順3が期待外れ応答なら試行が停止し、手順4へ進めず再送もできない", () => {
  const cases = [
    { status: 200, error: null, generation: 3 },
    { status: 409, error: "already_member", generation: null },
    { status: 403, error: "not_operator", generation: null },
  ];
  for (const response of cases) {
    const session = createS11Session();
    const { trialId, generation } = session.beginTrial();
    capture(session, trialId, generation, "C", HASH_C, 1000);
    capture(session, trialId, generation, "B", HASH_B, 2000);
    capture(session, trialId, generation, "P3", HASH_A, 3000);
    session.freezeStaleRequest(trialId, generation);
    const outcome = session.recordStaleSend(trialId, generation, response);
    assert.equal(outcome.matched, false, JSON.stringify(response));
    assert.equal(outcome.state, "halted");
    assert.equal(outcome.undetermined, false);
    assert.equal(session.canSendStale(trialId, generation), false);
    assert.throws(
      () => session.beginNonceFetch(trialId, generation, "P4-1", 4000),
      (e) => e.code === "trial_order"
    );
    assert.throws(
      () => session.recordStaleSend(trialId, generation, response),
      (e) => e.code === "trial_order"
    );
  }
});

test("S11: 手順3の応答なしは状態未確定として停止し、再送できない", () => {
  const session = createS11Session();
  const { trialId, generation } = session.beginTrial();
  capture(session, trialId, generation, "C", HASH_C, 1000);
  capture(session, trialId, generation, "B", HASH_B, 2000);
  capture(session, trialId, generation, "P3", HASH_A, 3000);
  session.freezeStaleRequest(trialId, generation);
  const outcome = session.recordStaleSend(trialId, generation, null);
  assert.equal(outcome.matched, false);
  assert.equal(outcome.state, "halted");
  assert.equal(outcome.undetermined, true);
  assert.equal(session.snapshot().undetermined, true);
});

test("S11: 手順4の認可者が手順3の認可者と異なる場合は authorizer_mismatch で停止する", () => {
  const { session, trialId, generation } = trialThroughStale();
  capture(session, trialId, generation, "P4-1", HASH_A, 4000);
  session.beginNonceFetch(trialId, generation, "P4-2", 5000);
  session.finishNonceFetch(trialId, generation, "P4-2", "nonce-p4-2");
  assert.throws(
    () => session.markP4Captured(trialId, generation, 1, { subjectHash: HASH_X, verified: VERIFIED }),
    (e) => e.code === "authorizer_mismatch"
  );
  assert.equal(session.snapshot().phase, "halted");
});

test("S11: 手順4の認可者が B の場合は wrong_authorizer で停止する", () => {
  const { session, trialId, generation } = trialThroughStale();
  session.beginNonceFetch(trialId, generation, "P4-1", 4000);
  session.finishNonceFetch(trialId, generation, "P4-1", "nonce-p4-1");
  assert.throws(
    () => session.markP4Captured(trialId, generation, 0, { subjectHash: HASH_B, verified: VERIFIED }),
    (e) => e.code === "wrong_authorizer"
  );
  assert.equal(session.snapshot().phase, "halted");
});

test("S11: 手順4の凍結は2件とも C の主体ハッシュと期待世代 3 で同一である", () => {
  const { session, trialId, generation } = trialThroughStale();
  capture(session, trialId, generation, "P4-1", HASH_A, 4000);
  capture(session, trialId, generation, "P4-2", HASH_A, 5000);
  assert.equal(session.snapshot().phase, "p4-captured");
  assert.equal(session.canSendConcurrent(trialId, generation), false);
  const frozen = session.freezeConcurrentRequests(trialId, generation);
  assert.equal(frozen.requests.length, 2);
  for (const r of frozen.requests) {
    assert.equal(r.action, ADD_ACTION);
    assert.equal(r.path, ADD_PATH);
    assert.equal(r.targetSubjectHash, HASH_C);
    assert.equal(r.expectedGeneration, CONCURRENT_EXPECTED_GENERATION);
    assert.equal(r.expectedGeneration, 3);
  }
  const display = session.concurrentDisplayData(trialId, generation);
  assert.deepEqual(display, frozen);
  assert.equal(session.canSendConcurrent(trialId, generation), true);
});

test("S11: 手順4は成功ちょうど1件（200・generation 4）と stale 1件で完了する（順序は問わない）", () => {
  const orders = [
    [
      { status: 200, error: null, generation: 4 },
      { status: 409, error: "stale_generation", generation: null },
    ],
    [
      { status: 409, error: "stale_generation", generation: null },
      { status: 200, error: null, generation: 4 },
    ],
  ];
  for (const results of orders) {
    const { session, trialId, generation } = trialThroughConcurrentFreeze();
    const outcome = session.recordConcurrentSend(trialId, generation, results);
    assert.equal(outcome.matched, true);
    assert.equal(outcome.state, "completed");
    assert.equal(outcome.aggregate.ok, true);
    assert.equal(session.snapshot().phase, "completed");
    assert.equal(session.canSendConcurrent(trialId, generation), false);
  }
});

test("S11: 手順4の成功2件・成功0件・負け側が stale 以外では停止する", () => {
  const cases = [
    [
      { status: 200, error: null, generation: 4 },
      { status: 200, error: null, generation: 4 },
    ],
    [
      { status: 409, error: "stale_generation", generation: null },
      { status: 409, error: "stale_generation", generation: null },
    ],
    [
      { status: 200, error: null, generation: 4 },
      { status: 409, error: "already_member", generation: null },
    ],
    // 200 でも返された generation が 4 でなければ成功に数えない。
    [
      { status: 200, error: null, generation: 3 },
      { status: 409, error: "stale_generation", generation: null },
    ],
  ];
  for (const results of cases) {
    const { session, trialId, generation } = trialThroughConcurrentFreeze();
    const outcome = session.recordConcurrentSend(trialId, generation, results);
    assert.equal(outcome.matched, false, JSON.stringify(results));
    assert.equal(outcome.state, "halted");
    assert.equal(outcome.undetermined, false);
    assert.equal(session.canSendConcurrent(trialId, generation), false);
  }
});

test("S11: 手順4に応答なしがあれば状態未確定として停止する", () => {
  const { session, trialId, generation } = trialThroughConcurrentFreeze();
  const outcome = session.recordConcurrentSend(trialId, generation, [
    { status: 200, error: null, generation: 4 },
    null,
  ]);
  assert.equal(outcome.matched, false);
  assert.equal(outcome.state, "halted");
  assert.equal(outcome.undetermined, true);
  assert.equal(outcome.aggregate.no_response, 1);
});

test("S11: GIS コールバックは試行・役割・段階が一致するときにだけ有効である", () => {
  const session = createS11Session();
  const { trialId, generation } = session.beginTrial();
  assert.equal(session.isCallbackCurrent(trialId, generation, "C"), true);
  assert.equal(session.isCallbackCurrent(trialId, generation, "B"), false);
  assert.equal(session.isCallbackCurrent(trialId, generation, "P3"), false);
  assert.equal(session.isCallbackCurrent(trialId, generation, "P4-1"), false);
  assert.equal(session.isCallbackCurrent(trialId, generation, "X"), false);
  capture(session, trialId, generation, "C", HASH_C, 1000);
  assert.equal(session.isCallbackCurrent(trialId, generation, "C"), false);
  assert.equal(session.isCallbackCurrent(trialId, generation, "B"), true);
  capture(session, trialId, generation, "B", HASH_B, 2000);
  assert.equal(session.isCallbackCurrent(trialId, generation, "P3"), true);
  capture(session, trialId, generation, "P3", HASH_A, 3000);
  session.freezeStaleRequest(trialId, generation);
  session.recordStaleSend(trialId, generation, { status: 409, error: "stale_generation", generation: null });
  assert.equal(session.isCallbackCurrent(trialId, generation, "P4-1"), true);
  assert.equal(session.isCallbackCurrent(trialId, generation, "P4-2"), true);
  capture(session, trialId, generation, "P4-1", HASH_A, 4000);
  // 捕捉済みスロットのコールバックは無効になる。
  assert.equal(session.isCallbackCurrent(trialId, generation, "P4-1"), false);
  assert.equal(session.isCallbackCurrent(trialId, generation, "P4-2"), true);
  // 古い試行は世代で拒否される。
  const old = session.beginTrial();
  assert.equal(session.isCallbackCurrent(trialId, generation, "C"), false);
  assert.equal(session.isCallbackCurrent(old.trialId, old.generation, "C"), true);
  assert.equal(session.discard(old.trialId, old.generation), true);
  assert.equal(session.isCallbackCurrent(old.trialId, old.generation, "C"), false);
});

test("S11: GIS コールバックの捕捉は役割ごとに1回だけ受け付ける", () => {
  const session = createS11Session();
  const { trialId, generation } = session.beginTrial();
  assert.equal(session.claimCallbackCapture(trialId, generation, "B"), false);
  assert.equal(session.claimCallbackCapture(trialId, generation, "C"), true);
  assert.equal(session.claimCallbackCapture(trialId, generation, "C"), false);
  capture(session, trialId, generation, "C", HASH_C, 1000);
  assert.equal(session.claimCallbackCapture(trialId, generation, "C"), false);
  assert.equal(session.claimCallbackCapture(trialId, generation, "B"), true);
  assert.equal(session.claimCallbackCapture(trialId, generation, "B"), false);
  // 古い試行の claim は新しい試行を妨げない。
  const next = session.beginTrial();
  assert.equal(session.claimCallbackCapture(trialId, generation, "C"), false);
  assert.equal(session.claimCallbackCapture(next.trialId, next.generation, "C"), true);
  assert.equal(session.discard(next.trialId, next.generation), true);
  assert.equal(session.claimCallbackCapture(next.trialId, next.generation, "C"), false);
});

test("S11: 要求の組み立てと同一性・nonce の相異の確認", () => {
  const req = buildS11Request({ idToken: "token-1", subjectHash: HASH_C, expectedGeneration: 2 });
  assert.deepEqual(
    { ...req },
    { id_token: "token-1", subject_hash: HASH_C, expected_generation: 2 }
  );
  assert.equal(Object.isFrozen(req), true);
  const requests = buildS11Requests({
    tokens: ["token-1", "token-2"],
    subjectHash: HASH_C,
    expectedGeneration: 3,
  });
  assert.equal(verifyS11RequestsIdentical(requests), true);
  const differ = [
    { id_token: "token-1", subject_hash: HASH_C, expected_generation: 3 },
    { id_token: "token-2", subject_hash: HASH_B, expected_generation: 3 },
  ];
  assert.throws(
    () => verifyS11RequestsIdentical(differ),
    (e) => e.code === "s11_requests_differ"
  );
  assert.equal(verifyNoncesDistinct(["n1", "n2"], 2), true);
  assert.throws(
    () => verifyNoncesDistinct(["n1", "n1"], 2),
    (e) => e.code === "bad_trial_input"
  );
  assert.throws(
    () => buildS11Requests({ tokens: ["only-one"], subjectHash: HASH_C, expectedGeneration: 3 }),
    (e) => e.code === "bad_trial_input"
  );
});

test("S11: 集計は成功・stale・応答なしを数え、期待世代＋1 を成功の条件にする", () => {
  assert.equal(EXPECTED_CONCURRENT_FINAL_GENERATION, 4);
  const agg = aggregateS11ConcurrentResults([
    { status: 200, error: null, generation: 4 },
    { status: 409, error: "stale_generation", generation: null },
  ]);
  assert.equal(agg.ok, true);
  assert.equal(agg.success, 1);
  assert.equal(agg.stale, 1);
  const aggNull = aggregateS11ConcurrentResults([null, { status: 409, error: "stale_generation", generation: null }]);
  assert.equal(aggNull.ok, false);
  assert.equal(aggNull.no_response, 1);
});

test("S11: トークン消去の契機は5つである", () => {
  assert.deepEqual([...S11_TOKEN_ERASE_TRIGGERS], [
    "stale-sent",
    "s11-completed",
    "s11-halted",
    "trial-discarded",
    "new-trial-begun",
  ]);
});

test("S11: ログ記録には秘密が含まれず、一覧にない理由コードは置き換えられる", () => {
  const entry = makeS11LogEntry({
    trialId: "trial-1",
    step: "p3-sent",
    response: { status: 409, error: "stale_generation", generation: null },
  });
  assert.equal(entry.trial_id, "trial-1");
  assert.equal(entry.step, "p3-sent");
  assert.equal(entry.response.status, 409);
  assert.equal(entry.response.error, "stale_generation");
  assert.equal(JSON.stringify(entry).includes(HASH_C), false);
  const unknown = makeS11LogEntry({
    trialId: "trial-1",
    step: "p3-sent",
    response: { status: 500, error: "something_strange", generation: null },
  });
  assert.equal(unknown.response.error, "unexpected_error");
  const conc = makeS11ConcurrentLogEntry({
    trialId: "trial-1",
    results: [
      { status: 200, error: null, generation: 4 },
      null,
    ],
  });
  assert.equal(conc.step, "p4-sent");
  assert.equal(conc.slots[0].response.status, 200);
  assert.equal(conc.slots[1].response.status, null);
  assert.equal(conc.slots[1].response.error, "no_response");
  assert.equal(conc.aggregate.no_response, 1);
  assert.equal(JSON.stringify(conc).includes(HASH_C), false);
});
