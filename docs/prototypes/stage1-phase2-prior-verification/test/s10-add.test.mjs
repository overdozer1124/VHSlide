// S10 追加専用モジュール（tools/s10-add.mjs）の単体試験。
// 実行: node test/s10-add.test.mjs
// （npm run test:s10-add でも実行できる）
//
// 目的：Codex レビュー Issue #3 コメント 6758375470 の指摘1〜3に
// 対応する状態機械・ガードを、実 Google・実 Worker を使わずに検証する。
// - 順序：B の主体取得 → A の認可 → 凍結 → 送信の固定順であること。
// - 本人確認：署名検証が不完全な捕捉は拒否されること。A と B の主体
//   ハッシュが同一の場合は same_subject で試行が停止すること。
// - 凍結要求：実際の送信に使う値（B 取得で保持した主体ハッシュと手順
//   の固定値である期待世代 2）から生成されること。手入力の値は使わない。
// - 送信は一度だけであること。期待外れ応答・応答なしでは試行が停止し、
//   再送ができないこと。期待は 200 ok かつ返された generation が 3
//   であること。
// - nonce の取得：役割ごとに閉じ込められ、取得中の再取得・取得済みの
//   再取得が拒否され、遅れて戻った旧応答が破棄されること。期限は要求
//   開始時刻＋5分であること。
// - 古い試行のコールバックは拒否されること。
// - GIS コールバックは試行・役割・段階が一致するときにだけ有効で
//   あること（Codex レビュー Issue #3 コメント 6758648104 の指摘1：
//   B は b-preparing、A は b-captured のときにだけ有効。重複
//   コールバックも段階で拒否される）。
// - ログ記録には ID トークン・Cookie・nonce・主体ハッシュが含まれないこと。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import {
  createAddSession,
  makeAddLogEntry,
  ADD_ACTION,
  ADD_PATH,
  EXPECTED_GENERATION,
  S10_TOKEN_ERASE_TRIGGERS,
} from "../tools/s10-add.mjs";
import {
  nonceDeadline,
  isNonceExpired,
  NONCE_TTL_MS,
} from "../tools/s9-negative.mjs";

const HASH_B = "b".repeat(64);
const HASH_A = "a".repeat(64);
const VERIFIED = { signature: true, iss: true, aud: true, exp: true, nonce: true };

// B の主体取得まで進めた試行を返す（nonce 取得＋捕捉完了）。
function trialWithBCaptured() {
  const session = createAddSession();
  const { trialId, generation } = session.beginTrial();
  session.beginNonceFetch(trialId, generation, "B", 1000);
  const applied = session.finishNonceFetch(trialId, generation, "B", "nonce-b");
  assert.equal(applied.nonce, "nonce-b");
  assert.equal(applied.issuedAtMs, 1000);
  session.markBCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED });
  return { session, trialId, generation };
}

// B の主体取得と A の認可まで進めた試行を返す。
function trialWithACaptured() {
  const { session, trialId, generation } = trialWithBCaptured();
  session.beginNonceFetch(trialId, generation, "A", 2000);
  session.finishNonceFetch(trialId, generation, "A", "nonce-a");
  session.markACaptured(trialId, generation, { subjectHash: HASH_A, verified: VERIFIED });
  return { session, trialId, generation };
}

test("S10: 試行の開始直後は B の主体取得の準備中である", () => {
  const session = createAddSession();
  const { trialId, generation } = session.beginTrial();
  assert.equal(session.snapshot().phase, "b-preparing");
  assert.equal(session.currentTrialId(), trialId);
  assert.equal(session.snapshot().generation, generation);
});

test("S10: A の nonce 取得は B の主体取得が完了する前は拒否される", () => {
  const session = createAddSession();
  const { trialId, generation } = session.beginTrial();
  assert.throws(
    () => session.beginNonceFetch(trialId, generation, "A", 1000),
    (e) => e.code === "trial_order"
  );
});

test("S10: B の nonce 取得は取得中の再取得と取得済みの再取得を拒否する", () => {
  const session = createAddSession();
  const { trialId, generation } = session.beginTrial();
  session.beginNonceFetch(trialId, generation, "B", 1000);
  assert.throws(
    () => session.beginNonceFetch(trialId, generation, "B", 1001),
    (e) => e.code === "nonce_fetch_busy"
  );
  session.finishNonceFetch(trialId, generation, "B", "nonce-b");
  assert.throws(
    () => session.beginNonceFetch(trialId, generation, "B", 1002),
    (e) => e.code === "nonce_already_issued"
  );
});

test("S10: 遅れて戻った旧試行の nonce 応答は破棄される", () => {
  const session = createAddSession();
  const first = session.beginTrial();
  session.beginNonceFetch(first.trialId, first.generation, "B", 1000);
  const second = session.beginTrial();
  // 旧試行の応答は null で破棄される（期限・nonce を上書きしない）。
  assert.equal(session.finishNonceFetch(first.trialId, first.generation, "B", "nonce-old"), null);
  assert.equal(session.nonceIssuedAt(second.trialId, second.generation, "B"), null);
  // 現行試行の応答は適用される。
  session.beginNonceFetch(second.trialId, second.generation, "B", 2000);
  const applied = session.finishNonceFetch(second.trialId, second.generation, "B", "nonce-new");
  assert.equal(applied.nonce, "nonce-new");
  assert.equal(applied.issuedAtMs, 2000);
});

test("S10: B の捕捉は nonce 未取得・形式不正・検証不完全を拒否する", () => {
  const session = createAddSession();
  const { trialId, generation } = session.beginTrial();
  assert.throws(
    () => session.markBCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED }),
    (e) => e.code === "trial_order"
  );
  session.beginNonceFetch(trialId, generation, "B", 1000);
  session.finishNonceFetch(trialId, generation, "B", "nonce-b");
  assert.throws(
    () => session.markBCaptured(trialId, generation, { subjectHash: "not-a-hash", verified: VERIFIED }),
    (e) => e.code === "bad_trial_input"
  );
  assert.throws(
    () =>
      session.markBCaptured(trialId, generation, {
        subjectHash: HASH_B,
        verified: { ...VERIFIED, nonce: false },
      }),
    (e) => e.code === "verification_incomplete"
  );
  assert.throws(
    () => session.markBCaptured(trialId, generation, { subjectHash: HASH_B, verified: null }),
    (e) => e.code === "verification_incomplete"
  );
});

test("S10: A と B の主体ハッシュが同一の場合は same_subject で試行が停止する", () => {
  const { session, trialId, generation } = trialWithBCaptured();
  session.beginNonceFetch(trialId, generation, "A", 2000);
  session.finishNonceFetch(trialId, generation, "A", "nonce-a");
  assert.throws(
    () => session.markACaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED }),
    (e) => e.code === "same_subject"
  );
  assert.equal(session.snapshot().phase, "halted");
  assert.equal(session.snapshot().undetermined, false);
  // 停止した試行は凍結できない。
  assert.throws(
    () => session.freezeRequest(trialId, generation),
    (e) => e.code === "trial_order"
  );
});

test("S10: 凍結要求は B 取得で保持した主体ハッシュと固定値の期待世代から生成される", () => {
  const { session, trialId, generation } = trialWithACaptured();
  assert.equal(session.canSend(trialId, generation), false);
  const frozen = session.freezeRequest(trialId, generation);
  assert.equal(frozen.action, ADD_ACTION);
  assert.equal(frozen.path, ADD_PATH);
  assert.equal(frozen.targetSubjectHash, HASH_B);
  assert.equal(frozen.expectedGeneration, EXPECTED_GENERATION);
  assert.equal(frozen.expectedGeneration, 2);
  // displayData は凍結内容と同一である（入力欄の値からは作らない）。
  const display = session.displayData(trialId, generation);
  assert.deepEqual(display, frozen);
  assert.equal(session.canSend(trialId, generation), true);
});

test("S10: 凍結は A の認可が完了する前はできない", () => {
  const { session, trialId, generation } = trialWithBCaptured();
  assert.throws(
    () => session.freezeRequest(trialId, generation),
    (e) => e.code === "trial_order"
  );
});

test("S10: 期待どおりの応答（200 ok・generation 3）で追加が完了する", () => {
  const { session, trialId, generation } = trialWithACaptured();
  session.freezeRequest(trialId, generation);
  const outcome = session.recordSend(trialId, generation, {
    status: 200,
    error: null,
    ok: true,
    generation: 3,
  });
  assert.equal(outcome.matched, true);
  assert.equal(outcome.state, "completed");
  assert.equal(outcome.generation, 3);
  assert.equal(session.snapshot().phase, "completed");
  assert.equal(session.canSend(trialId, generation), false);
});

test("S10: 期待外れ応答では試行が停止し、再送できない", () => {
  const cases = [
    { status: 409, error: "stale_generation", ok: false, generation: null },
    { status: 409, error: "already_member", ok: false, generation: null },
    { status: 403, error: "not_operator", ok: false, generation: null },
    // 200 でも返された generation が 3 でなければ不一致である。
    { status: 200, error: null, ok: true, generation: 2 },
  ];
  for (const response of cases) {
    const { session, trialId, generation } = trialWithACaptured();
    session.freezeRequest(trialId, generation);
    const outcome = session.recordSend(trialId, generation, response);
    assert.equal(outcome.matched, false, JSON.stringify(response));
    assert.equal(outcome.state, "halted");
    assert.equal(outcome.undetermined, false);
    assert.equal(session.canSend(trialId, generation), false);
    assert.throws(
      () => session.recordSend(trialId, generation, response),
      (e) => e.code === "trial_order"
    );
  }
});

test("S10: 応答なしでは状態未確定として停止し、再送できない", () => {
  const { session, trialId, generation } = trialWithACaptured();
  session.freezeRequest(trialId, generation);
  const outcome = session.recordNoResponse(trialId, generation);
  assert.equal(outcome.matched, false);
  assert.equal(outcome.state, "halted");
  assert.equal(outcome.undetermined, true);
  assert.equal(session.canSend(trialId, generation), false);
});

test("S10: GIS コールバックは試行・役割・段階が一致するときにだけ有効である", () => {
  const session = createAddSession();
  const { trialId, generation } = session.beginTrial();
  // b-preparing：B は有効、A は段階外。
  assert.equal(session.isCallbackCurrent(trialId, generation, "B"), true);
  assert.equal(session.isCallbackCurrent(trialId, generation, "A"), false);
  assert.equal(session.isCallbackCurrent(trialId, generation, "X"), false);
  session.beginNonceFetch(trialId, generation, "B", 1000);
  session.finishNonceFetch(trialId, generation, "B", "nonce-b");
  session.markBCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED });
  // b-captured：B は重複（段階外）、A は有効。
  assert.equal(session.isCallbackCurrent(trialId, generation, "B"), false);
  assert.equal(session.isCallbackCurrent(trialId, generation, "A"), true);
  session.beginNonceFetch(trialId, generation, "A", 2000);
  session.finishNonceFetch(trialId, generation, "A", "nonce-a");
  session.markACaptured(trialId, generation, { subjectHash: HASH_A, verified: VERIFIED });
  // a-captured：両方の役割とも段階外。
  assert.equal(session.isCallbackCurrent(trialId, generation, "B"), false);
  assert.equal(session.isCallbackCurrent(trialId, generation, "A"), false);
  // 古い試行は世代で拒否される。
  const old = session.beginTrial();
  assert.equal(session.isCallbackCurrent(trialId, generation, "B"), false);
  assert.equal(session.isCallbackCurrent(trialId, generation, "A"), false);
  // 新しい試行は b-preparing に戻る。
  assert.equal(session.isCallbackCurrent(old.trialId, old.generation, "B"), true);
  assert.equal(session.isCallbackCurrent(old.trialId, old.generation, "A"), false);
  // 破棄後はどちらの役割も無効になる。
  assert.equal(session.discard(old.trialId, old.generation), true);
  assert.equal(session.isCallbackCurrent(old.trialId, old.generation, "B"), false);
  assert.equal(session.isCallbackCurrent(old.trialId, old.generation, "A"), false);
});

test("S10: 古い試行のコールバックは拒否される", () => {
  const session = createAddSession();
  const first = session.beginTrial();
  const second = session.beginTrial();
  assert.equal(session.isCurrent(first.trialId, first.generation), false);
  assert.equal(session.isCurrent(second.trialId, second.generation), true);
  assert.throws(
    () => session.beginNonceFetch(first.trialId, first.generation, "B", 1000),
    (e) => e.code === "stale_attempt"
  );
  assert.throws(
    () => session.markBCaptured(first.trialId, first.generation, { subjectHash: HASH_B, verified: VERIFIED }),
    (e) => e.code === "stale_attempt"
  );
});

test("S10: 試行の破棄は現行の試行だけを無効化する", () => {
  const session = createAddSession();
  const { trialId, generation } = session.beginTrial();
  assert.equal(session.discard(trialId, generation), true);
  assert.equal(session.snapshot(), null);
  assert.equal(session.currentTrialId(), null);
  assert.equal(session.discard(trialId, generation), false);
});

test("S10: nonce の期限は要求開始時刻＋5分である", () => {
  assert.equal(NONCE_TTL_MS, 5 * 60 * 1000);
  assert.equal(nonceDeadline(1000), 1000 + 5 * 60 * 1000);
  assert.equal(isNonceExpired(1000 + 5 * 60 * 1000 - 1, 1000), false);
  // 期限ちょうどは期限切れとする。
  assert.equal(isNonceExpired(1000 + 5 * 60 * 1000, 1000), true);
});

test("S10: トークン消去の契機は4つである", () => {
  assert.deepEqual([...S10_TOKEN_ERASE_TRIGGERS], [
    "add-completed",
    "add-halted",
    "trial-discarded",
    "new-trial-begun",
  ]);
});

test("S10: ログ記録には秘密が含まれず、一覧にない理由コードは置き換えられる", () => {
  const entry = makeAddLogEntry({
    trialId: "trial-1",
    step: "sent",
    response: { status: 409, error: "stale_generation", generation: null },
  });
  assert.equal(entry.trial_id, "trial-1");
  assert.equal(entry.step, "sent");
  assert.equal(entry.response.status, 409);
  assert.equal(entry.response.error, "stale_generation");
  // 秘密らしい値はどの欄にも含まれない。
  assert.equal(JSON.stringify(entry).includes(HASH_B), false);
  const unknown = makeAddLogEntry({
    trialId: "trial-1",
    step: "sent",
    response: { status: 500, error: "something_strange", generation: null },
  });
  assert.equal(unknown.response.error, "unexpected_error");
  // 成功応答は error が null のまま通る。
  const ok = makeAddLogEntry({
    trialId: "trial-1",
    step: "sent",
    response: { status: 200, error: null, generation: 3 },
  });
  assert.equal(ok.response.error, null);
  assert.equal(ok.response.generation, 3);
});
