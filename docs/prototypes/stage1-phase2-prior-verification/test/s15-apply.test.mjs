// S15 応答破棄ドリル専用モジュール（tools/s15-apply.mjs）の単体試験。
// 実行: node --test test/s15-apply.test.mjs
// （npm run test:s15 でも実行できる）
//
// 目的：S15 の状態機械・判定を、実 Google・実 Worker を使わずに検証する。
// - 固定値：送信先・用途（full-replace）・台帳番号 5・開始状態
//   （generation 7・完了 2件）と committed の状態（generation 8・
//   完了 3件）、再実施は最大2回（送信は合計3回）。
// - 順序：対象 B の取得 → 承認内容の凍結 → 試行の取得 → 破棄送信
//   → 読み戻し判定の固定順であること。未確定（送信済み・判定前）
//   の間は次の試行の取得・送信が始められないこと。
// - 凍結内容：操作ID・用途・内容 {B}・対象 B が、取得した対象と
//   試行に固定した値から作られ、手入力では変えられないこと。
// - 破棄記録の形：recordSendDiscard は破棄記録
//   { sent: true, outcome: "discarded" } だけを受け付け、応答由来
//   の項目（HTTP 状態・理由コード・世代）を含む記録を拒否する
//   こと（応答の内容は状態機械に入らない）。
// - 判定：judgeS15ReadBack が committed／uncommitted／
//   discrepancy を手順書 §4.4 の基準で区分すること。再実施の
//   ゲートは、未成立の判定が記録された場合にだけ開き、回数を
//   明示的に数えること。committed の後は送信手段がないこと。
//   3回目の未成立で uncommitted-final になり、4回目は拒否
//   されること。
// - 締め：判定確定後も、通常版復帰の記録（版確認・バインディ
//   ング確認の両方）がなければ closed にならないこと。
// - 読み戻しの正規化：RegistryDO の snapshot の形と正規形の
//   両方を受け、形式不正を拒否すること。
// - ログ記録には ID トークン・一回値・Cookie・nonce・主体
//   ハッシュが含まれないこと。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import {
  createS15Session,
  buildS15ApplyRequest,
  normalizeS15Snapshot,
  judgeS15ReadBack,
  makeS15LogEntry,
  APPLY_PATH,
  APPLY_PURPOSE,
  S15_OPERATION_NUMBER,
  START_GENERATION,
  START_COMPLETION_COUNT,
  START_CONSUMED_COUNT,
  COMMITTED_GENERATION,
  COMMITTED_COMPLETION_COUNT,
  MAX_REATTEMPTS,
  MAX_SENDS,
  S15_DISCARDED_OUTCOME,
  S15_ROLES,
  S15_NONCE_TTL_MS,
  ATTEMPT_SEND_WINDOW_MS,
  S15_TOKEN_ERASE_TRIGGERS,
} from "../tools/s15-apply.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const ENV_ID = "stage1-phase2-verification-local";
const OP1 = "op-fixture-001";
const OP3 = "op-fixture-003";
const OP5 = "op-fixture-005";
const VERIFIED = { signature: true, iss: true, aud: true, exp: true, nonce: true };
const DISCARDED = { sent: true, outcome: "discarded" };

function assertCode(fn, code) {
  assert.throws(fn, (e) => e && e.code === code);
}

function beginSession() {
  const session = createS15Session();
  const { trialId, generation } = session.beginTrial({
    operationId: OP5,
    envId: ENV_ID,
    startConsumedOperationIds: [OP1, OP3],
  });
  return { session, trialId, generation };
}

function issue(session, trialId, generation, role, atMs) {
  session.beginNonceFetch(trialId, generation, role, atMs);
  session.finishNonceFetch(trialId, generation, role, `nonce-${role}`);
}

function captureTarget(session, trialId, generation, atMs = 1000, hash = HASH_B) {
  issue(session, trialId, generation, "target", atMs);
  session.markTargetCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

function freeze(session, trialId, generation) {
  captureTarget(session, trialId, generation);
  return session.freezeApproval(trialId, generation);
}

function captureAttempt(session, trialId, generation, attempt, atMs = 3000, hash = HASH_B) {
  issue(session, trialId, generation, `attempt${attempt}`, atMs);
  session.markAttemptCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

// 読み戻しの正規形を作る補助（開始状態が既定）。
function readBack({ generation = 7, operators = [HASH_B], consumed = [OP1, OP3], completion = 2 } = {}) {
  return {
    generation,
    operatorHashes: operators,
    consumedOperationIds: consumed,
    completionCount: completion,
  };
}

const COMMITTED_RB = () =>
  readBack({ generation: 8, consumed: [OP1, OP3, OP5], completion: 3 });

// 破棄送信まで進めた試行を返す。
function throughSent() {
  const ctx = beginSession();
  freeze(ctx.session, ctx.trialId, ctx.generation);
  captureAttempt(ctx.session, ctx.trialId, ctx.generation, 1);
  const rec = ctx.session.recordSendDiscard(ctx.trialId, ctx.generation, { ...DISCARDED });
  assert.equal(rec.state, "sent-undetermined");
  return ctx;
}

test("固定値：送信先・用途・台帳番号・開始／committed の状態・再実施上限", () => {
  assert.equal(APPLY_PATH, "/platform/apply");
  assert.equal(APPLY_PURPOSE, "full-replace");
  assert.equal(S15_OPERATION_NUMBER, 5);
  assert.equal(START_GENERATION, 7);
  assert.equal(START_COMPLETION_COUNT, 2);
  assert.equal(START_CONSUMED_COUNT, 2);
  assert.equal(COMMITTED_GENERATION, 8);
  assert.equal(COMMITTED_COMPLETION_COUNT, 3);
  assert.equal(MAX_REATTEMPTS, 2);
  assert.equal(MAX_SENDS, 3);
  assert.deepEqual([...S15_ROLES], ["target", "attempt1", "attempt2", "attempt3"]);
  assert.equal(S15_NONCE_TTL_MS, 5 * 60 * 1000);
  assert.equal(ATTEMPT_SEND_WINDOW_MS, 4 * 60 * 1000);
  assert.equal(S15_DISCARDED_OUTCOME, "discarded");
  assert.ok(S15_TOKEN_ERASE_TRIGGERS.includes("send-discarded"));
  assert.ok(S15_TOKEN_ERASE_TRIGGERS.includes("s15-closed"));
  assert.ok(S15_TOKEN_ERASE_TRIGGERS.includes("s15-halted"));
});

test("試行の開始：開始消費集合の検証（2件・重複なし・操作IDを含まない）", () => {
  const session = createS15Session();
  assertCode(
    () => session.beginTrial({ operationId: OP5, envId: ENV_ID, startConsumedOperationIds: [OP1] }),
    "bad_trial_input"
  );
  assertCode(
    () => session.beginTrial({ operationId: OP5, envId: ENV_ID, startConsumedOperationIds: [OP1, OP1] }),
    "bad_trial_input"
  );
  assertCode(
    () => session.beginTrial({ operationId: OP5, envId: ENV_ID, startConsumedOperationIds: [OP1, OP5] }),
    "bad_trial_input"
  );
  assertCode(
    () => session.beginTrial({ operationId: "", envId: ENV_ID, startConsumedOperationIds: [OP1, OP3] }),
    "bad_trial_input"
  );
});

test("凍結内容：操作ID・用途・内容 {B}・対象 B は取得した対象と固定値から作られる", () => {
  const { session, trialId, generation } = beginSession();
  const frozen = freeze(session, trialId, generation);
  assert.equal(frozen.operationNumber, 5);
  assert.equal(frozen.operationId, OP5);
  assert.equal(frozen.purpose, "full-replace");
  assert.deepEqual([...frozen.contentOperatorHashes], [HASH_B]);
  assert.equal(frozen.targetSubjectHash, HASH_B);
  assert.equal(frozen.envId, ENV_ID);
  assert.equal(frozen.path, "/platform/apply");
  assert.equal(frozen.startGeneration, 7);
  assert.equal(frozen.startCompletionCount, 2);
  assert.ok(Object.isFrozen(frozen));
  const display = session.approvalDisplayData(trialId, generation);
  assert.equal(display.operationId, frozen.operationId);
  assert.equal(display.targetSubjectHash, frozen.targetSubjectHash);
  // 凍結は1回だけであり、対象取得より前にはできない。
  assertCode(() => session.freezeApproval(trialId, generation), "trial_order");
  const s2 = beginSession();
  assertCode(() => s2.session.freezeApproval(s2.trialId, s2.generation), "trial_order");
});

test("順序違反：対象取得より前に試行の取得・送信・判定はできない", () => {
  const { session, trialId, generation } = beginSession();
  assertCode(
    () => session.markAttemptCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED }),
    "trial_order"
  );
  assertCode(() => session.recordSendDiscard(trialId, generation, { ...DISCARDED }), "trial_order");
  assertCode(() => session.recordReadBackJudgment(trialId, generation, readBack()), "trial_order");
  assertCode(() => session.beginNonceFetch(trialId, generation, "attempt1", 1000), "trial_order");
});

test("未確定の関門：送信後は判定が記録されるまで次の試行を始められない", () => {
  const { session, trialId, generation } = throughSent();
  assert.equal(session.snapshot().undetermined, true);
  assertCode(() => session.beginNonceFetch(trialId, generation, "attempt2", 4000), "trial_order");
  assertCode(
    () => session.markAttemptCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED }),
    "trial_order"
  );
  assertCode(() => session.recordSendDiscard(trialId, generation, { ...DISCARDED }), "trial_order");
  // 判定を記録すれば関門が開く（未成立の場合）。
  const j = session.recordReadBackJudgment(trialId, generation, readBack());
  assert.equal(j.outcome, "uncommitted");
  assert.equal(session.snapshot().phase, "reattempt-ready");
  assert.equal(session.snapshot().undetermined, false);
});

test("破棄記録の形：応答由来の項目を含む記録は受け付けない", () => {
  const { session, trialId, generation } = beginSession();
  freeze(session, trialId, generation);
  captureAttempt(session, trialId, generation, 1);
  // HTTP 状態を含む記録（応答を読んだ形）は拒否される。
  assertCode(
    () => session.recordSendDiscard(trialId, generation, { sent: true, outcome: "discarded", status: 201 }),
    "bad_trial_input"
  );
  assertCode(
    () =>
      session.recordSendDiscard(trialId, generation, {
        sent: true,
        outcome: "discarded",
        error: null,
        generation: 8,
      }),
    "bad_trial_input"
  );
  assertCode(() => session.recordSendDiscard(trialId, generation, { status: 201, error: null }), "bad_trial_input");
  assertCode(() => session.recordSendDiscard(trialId, generation, null), "bad_trial_input");
  assertCode(
    () => session.recordSendDiscard(trialId, generation, { sent: false, outcome: "discarded" }),
    "bad_trial_input"
  );
  // 拒否は送信として数えない。正しい破棄記録は受け付けられる。
  assert.equal(session.snapshot().sendCount, 0);
  const rec = session.recordSendDiscard(trialId, generation, { sent: true, outcome: "discarded" });
  assert.equal(rec.attempt, 1);
  assert.equal(session.snapshot().sendCount, 1);
});

test("判定（純粋関数）：committed／uncommitted／discrepancy の区分", () => {
  const judge = (snapshot) =>
    judgeS15ReadBack({
      snapshot,
      operationId: OP5,
      targetSubjectHash: HASH_B,
      startConsumedOperationIds: [OP1, OP3],
    });
  assert.equal(judge(readBack()), "uncommitted");
  assert.equal(judge(COMMITTED_RB()), "committed");
  // 世代だけが進んでいる（操作は未消費）。
  assert.equal(judge(readBack({ generation: 8 })), "discrepancy");
  // 操作は消費されたが完了記録が増えていない。
  assert.equal(judge(readBack({ generation: 8, consumed: [OP1, OP3, OP5], completion: 2 })), "discrepancy");
  // 操作は消費されたが世代が進んでいない。
  assert.equal(judge(readBack({ consumed: [OP1, OP3, OP5], completion: 3 })), "discrepancy");
  // 登録簿が対象以外を含む。
  assert.equal(
    judge(readBack({ generation: 8, operators: [HASH_B, HASH_C], consumed: [OP1, OP3, OP5], completion: 3 })),
    "discrepancy"
  );
  // 登録簿が空。
  assert.equal(judge(readBack({ operators: [] })), "discrepancy");
  // 消費集合に想定外の操作が混ざっている。
  assert.equal(
    judge(readBack({ generation: 8, consumed: [OP1, OP3, OP5, "op-other"], completion: 3 })),
    "discrepancy"
  );
  // 開始消費集合の一部が欠けている。
  assert.equal(judge(readBack({ consumed: [OP1] })), "discrepancy");
  // 対象主体が A に差し替わっている。
  assert.equal(judge(readBack({ operators: [HASH_A] })), "discrepancy");
});

test("判定の記録：committed の後は送信手段がなく、締めの記録で closed になる", () => {
  const { session, trialId, generation } = throughSent();
  const j = session.recordReadBackJudgment(trialId, generation, COMMITTED_RB());
  assert.equal(j.outcome, "committed");
  assert.equal(j.state, "committed");
  // 以後の取得・送信は s15_already_committed で拒否される。
  assertCode(() => session.beginNonceFetch(trialId, generation, "attempt2", 4000), "s15_already_committed");
  assertCode(
    () => session.markAttemptCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED }),
    "s15_already_committed"
  );
  assertCode(() => session.recordSendDiscard(trialId, generation, { ...DISCARDED }), "s15_already_committed");
  // 締め：確認がそろわなければ closed にならない。
  assertCode(
    () => session.recordNormalRestored(trialId, generation, { versionVerified: true, bindingsVerified: false }),
    "restore_unverified"
  );
  assert.equal(session.snapshot().phase, "committed");
  const closed = session.recordNormalRestored(trialId, generation, {
    versionVerified: true,
    bindingsVerified: true,
  });
  assert.equal(closed.state, "closed");
  assert.equal(session.snapshot().closed, true);
  assert.equal(session.snapshot().normalRestored, true);
});

test("再実施の数え方：未成立の判定の後だけ開き、最大2回で締まる", () => {
  const { session, trialId, generation } = beginSession();
  freeze(session, trialId, generation);
  // 試行1 → 未成立。
  captureAttempt(session, trialId, generation, 1);
  session.recordSendDiscard(trialId, generation, { ...DISCARDED });
  let j = session.recordReadBackJudgment(trialId, generation, readBack());
  assert.equal(j.outcome, "uncommitted");
  assert.equal(j.reattemptsUsed, 0);
  assert.equal(j.uncommittedJudgments, 1);
  assert.equal(j.state, "reattempt-ready");
  // 試行2（再実施1回目）→ 未成立。
  captureAttempt(session, trialId, generation, 2, 5000);
  session.recordSendDiscard(trialId, generation, { ...DISCARDED });
  j = session.recordReadBackJudgment(trialId, generation, readBack());
  assert.equal(j.outcome, "uncommitted");
  assert.equal(j.reattemptsUsed, 1);
  assert.equal(j.uncommittedJudgments, 2);
  // 試行3（再実施2回目）→ 未成立で締まる。
  captureAttempt(session, trialId, generation, 3, 9000);
  session.recordSendDiscard(trialId, generation, { ...DISCARDED });
  j = session.recordReadBackJudgment(trialId, generation, readBack());
  assert.equal(j.outcome, "uncommitted");
  assert.equal(j.reattemptsUsed, 2);
  assert.equal(j.state, "uncommitted-final");
  // 4回目の送信は s15_attempts_exhausted で拒否される。
  assertCode(() => session.beginNonceFetch(trialId, generation, "attempt3", 12000), "s15_attempts_exhausted");
  assertCode(
    () => session.markAttemptCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED }),
    "s15_attempts_exhausted"
  );
  // 未成立のまま閉じた場合も、締めは通常版復帰の記録である。
  const closed = session.recordNormalRestored(trialId, generation, {
    versionVerified: true,
    bindingsVerified: true,
  });
  assert.equal(closed.state, "closed");
  assert.equal(session.snapshot().sendCount, 3);
});

test("再実施での committed：2回目の送信でコミットすれば committed として確定する", () => {
  const { session, trialId, generation } = beginSession();
  freeze(session, trialId, generation);
  captureAttempt(session, trialId, generation, 1);
  session.recordSendDiscard(trialId, generation, { ...DISCARDED });
  session.recordReadBackJudgment(trialId, generation, readBack());
  captureAttempt(session, trialId, generation, 2, 5000);
  session.recordSendDiscard(trialId, generation, { ...DISCARDED });
  const j = session.recordReadBackJudgment(trialId, generation, COMMITTED_RB());
  assert.equal(j.outcome, "committed");
  assert.equal(j.attempt, 2);
  assert.equal(session.snapshot().phase, "committed");
});

test("discrepancy：停止して記録し、成功としても未成立としても扱わない", () => {
  const { session, trialId, generation } = throughSent();
  const j = session.recordReadBackJudgment(trialId, generation, readBack({ generation: 8 }));
  assert.equal(j.outcome, "discrepancy");
  const snap = session.snapshot();
  assert.equal(snap.phase, "halted");
  assert.equal(snap.discrepancy, true);
  assert.equal(snap.uncommittedJudgments, 0);
  // 復帰の記録は受け付けるが、closed にはならない。
  const r = session.recordNormalRestored(trialId, generation, {
    versionVerified: true,
    bindingsVerified: true,
  });
  assert.equal(r.state, "halted");
  assert.equal(session.snapshot().normalRestored, true);
  assert.equal(session.snapshot().closed, false);
});

test("締めの順序：判定が確定する前に通常版復帰は記録できない", () => {
  const { session, trialId, generation } = beginSession();
  freeze(session, trialId, generation);
  assertCode(
    () => session.recordNormalRestored(trialId, generation, { versionVerified: true, bindingsVerified: true }),
    "trial_order"
  );
  captureAttempt(session, trialId, generation, 1);
  session.recordSendDiscard(trialId, generation, { ...DISCARDED });
  // 未確定の間も記録できない。
  assertCode(
    () => session.recordNormalRestored(trialId, generation, { versionVerified: true, bindingsVerified: true }),
    "trial_order"
  );
});

test("機械確認：試行の主体が対象 B と異なれば wrong_subject で停止", () => {
  const { session, trialId, generation } = beginSession();
  freeze(session, trialId, generation);
  assertCode(() => captureAttempt(session, trialId, generation, 1, 3000, HASH_A), "wrong_subject");
  assert.equal(session.snapshot().phase, "halted");
});

test("読み戻しの正規化：DO の形・正規形の両方を受け、形式不正を拒否する", () => {
  const doShape = {
    env_id: ENV_ID,
    generation: 8,
    initialized: true,
    operators: [{ subject_hash: HASH_B, added_at: "t", added_by: "platform:" + OP5 }],
    consumed_ops: [
      { operation_id: OP1, purpose: "bootstrap", env_id: ENV_ID, subject_hash: HASH_A, consumed_at: "t" },
      { operation_id: OP3, purpose: "full-replace", env_id: ENV_ID, subject_hash: HASH_A, consumed_at: "t" },
      { operation_id: OP5, purpose: "full-replace", env_id: ENV_ID, subject_hash: HASH_B, consumed_at: "t" },
    ],
    completion: [
      { operation_id: OP1, env_id: ENV_ID, subject_hash: HASH_A, purpose: "bootstrap", applied_at: "t" },
      { operation_id: OP3, env_id: ENV_ID, subject_hash: HASH_A, purpose: "full-replace", applied_at: "t" },
      { operation_id: OP5, env_id: ENV_ID, subject_hash: HASH_B, purpose: "full-replace", applied_at: "t" },
    ],
    pending_nonces: { total: 9, used: 4, unused: 5 },
  };
  const normalized = normalizeS15Snapshot(doShape);
  assert.equal(normalized.generation, 8);
  assert.deepEqual([...normalized.operatorHashes], [HASH_B]);
  assert.deepEqual([...normalized.consumedOperationIds], [OP1, OP3, OP5]);
  assert.equal(normalized.completionCount, 3);
  // added_by・added_at・nonce 内訳は判定の正規形に含まれない。
  assert.deepEqual(Object.keys(normalized).sort(), [
    "completionCount",
    "consumedOperationIds",
    "generation",
    "operatorHashes",
  ]);
  const again = normalizeS15Snapshot(normalized);
  assert.deepEqual({ ...again }, { ...normalized });
  assertCode(() => normalizeS15Snapshot({ generation: "8", operators: [], consumed_ops: [], completion: [] }), "bad_trial_input");
  assertCode(() => normalizeS15Snapshot({ generation: 8, operators: [{ subject_hash: "zz" }], consumed_ops: [], completion: [] }), "bad_trial_input");
  assertCode(() => normalizeS15Snapshot({ generation: 8 }), "bad_trial_input");
  assertCode(() => normalizeS15Snapshot(null), "bad_trial_input");
});

test("nonce 取得：段階・二重取得・旧試行の応答破棄と claim の1回性", () => {
  const { session, trialId, generation } = beginSession();
  // attempt1 の nonce は start では取得できない。
  assertCode(() => session.beginNonceFetch(trialId, generation, "attempt1", 1000), "trial_order");
  assert.equal(session.isCallbackCurrent(trialId, generation, "target"), true);
  assert.equal(session.isCallbackCurrent(trialId, generation, "attempt1"), false);
  assert.equal(session.claimCallbackCapture(trialId, generation, "target"), true);
  assert.equal(session.claimCallbackCapture(trialId, generation, "target"), false);
  session.beginNonceFetch(trialId, generation, "target", 1000);
  assert.equal(session.isNonceFetchPending(trialId, generation, "target"), true);
  assertCode(() => session.beginNonceFetch(trialId, generation, "target", 1100), "nonce_fetch_busy");
  const applied = session.finishNonceFetch(trialId, generation, "target", "nonce-target");
  assert.equal(applied.issuedAtMs, 1000);
  assert.equal(session.nonceIssuedAt(trialId, generation, "target"), 1000);
  assertCode(() => session.beginNonceFetch(trialId, generation, "target", 1200), "nonce_already_issued");
  // 新しい試行では旧試行の応答は破棄される。
  const next = session.beginTrial({
    operationId: OP5,
    envId: ENV_ID,
    startConsumedOperationIds: [OP1, OP3],
  });
  assert.equal(session.isCurrent(trialId, generation), false);
  assert.equal(session.finishNonceFetch(trialId, generation, "target", "nonce-old"), null);
  assertCode(() => session.nonceIssuedAt(trialId, generation, "target"), "stale_attempt");
  assert.ok(next.trialId);
});

test("検証不完全・形式不正の捕捉は拒否される", () => {
  const { session, trialId, generation } = beginSession();
  issue(session, trialId, generation, "target", 1000);
  assertCode(
    () =>
      session.markTargetCaptured(trialId, generation, {
        subjectHash: HASH_B,
        verified: { signature: true, iss: true, aud: true, exp: true, nonce: false },
      }),
    "verification_incomplete"
  );
  assertCode(
    () => session.markTargetCaptured(trialId, generation, { subjectHash: "zz", verified: VERIFIED }),
    "bad_trial_input"
  );
  const s2 = beginSession();
  assertCode(
    () => s2.session.markTargetCaptured(s2.trialId, s2.generation, { subjectHash: HASH_B, verified: VERIFIED }),
    "trial_order"
  );
});

test("要求ビルダー：用途は固定値 full-replace で凍結される", () => {
  const req = buildS15ApplyRequest({ idToken: "token-b", oneTimeValue: "one-time-x", envId: ENV_ID });
  assert.deepEqual(
    { ...req },
    { id_token: "token-b", one_time_value: "one-time-x", purpose: "full-replace", env_id: ENV_ID }
  );
  assert.ok(Object.isFrozen(req));
  assertCode(() => buildS15ApplyRequest({ idToken: "", oneTimeValue: "v", envId: ENV_ID }), "bad_trial_input");
  assertCode(() => buildS15ApplyRequest({ idToken: "t", oneTimeValue: "", envId: ENV_ID }), "bad_trial_input");
});

test("ログ記録：破棄送信は outcome だけを含み、秘密は含まれない", () => {
  const sent = makeS15LogEntry({ trialId: "trial-1", step: "send-discarded", attempt: 1 });
  assert.deepEqual(
    { ...sent },
    { trial_id: "trial-1", step: "send-discarded", attempt: 1, judgment: null, outcome: "discarded" }
  );
  // 応答の状態・理由コードを記録する欄そのものがない。
  assert.equal("status" in sent, false);
  assert.equal("error" in sent, false);
  assert.equal("response" in sent, false);
  const judged = makeS15LogEntry({ trialId: "trial-1", step: "judged-committed", attempt: 1, judgment: "committed" });
  assert.equal(judged.judgment, "committed");
  assert.equal(judged.outcome, null);
  assertCode(
    () => makeS15LogEntry({ trialId: "t", step: "judged-committed", attempt: 1, judgment: "uncommitted" }),
    "bad_trial_input"
  );
  assertCode(() => makeS15LogEntry({ trialId: "t", step: "send-discarded" }), "bad_trial_input");
  assertCode(() => makeS15LogEntry({ trialId: "t", step: "bogus" }), "bad_trial_input");
  const json = JSON.stringify([sent, judged]);
  assert.ok(!json.includes(HASH_B));
  assert.ok(!json.includes("token"));
  assert.ok(!json.includes("one_time"));
});

test("破棄：現行試行だけが無効化され、旧試行の操作は stale_attempt", () => {
  const { session, trialId, generation } = beginSession();
  assert.equal(session.discard("other", generation), false);
  assert.equal(session.discard(trialId, generation), true);
  assert.equal(session.snapshot(), null);
  assertCode(
    () => session.markTargetCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED }),
    "stale_attempt"
  );
  assert.equal(session.discard(trialId, generation), false);
});
