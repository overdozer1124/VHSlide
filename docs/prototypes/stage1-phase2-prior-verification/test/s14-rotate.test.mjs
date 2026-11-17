// S14 ローテーション専用モジュール（tools/s14-rotate.mjs）の単体試験。
// 実行: node --test test/s14-rotate.test.mjs
// （npm run test:s14 でも実行できる）
//
// 目的：S14 の状態機械・機械確認を、実 Google・実 Worker を
// 使わずに検証する。
// - 順序：A の対象取得 → B の対象取得 → A の取得（手順1）→
//   ローテーションの凍結 → ローテーションの送信 → A の取得
//   （手順2）→ A の提示 → B の取得（手順3）→ B の提示の固定順
//   であること。手順2は手順1が 200・generation 7 で記録される
//   まで始められず、手順3は手順2の結果が記録されるまで始め
//   られないこと（手順の負の分岐）。
// - 期待値の分類：手順1は 200 ok・generation 7 のみが期待
//   どおり。手順2は 403 not_operator が期待どおり（合格）で
//   あり、200 の成功は期待外れとして停止すること。手順3は
//   200 ok のみが期待どおり。それ以外・応答なしでは停止して
//   後段へ進めないこと。各送信の再送手段がないこと。
// - 機械確認：ローテーション先 B が A と同一なら停止すること。
//   手順1の呼び出し元・手順2の A がローテーション元 A と異な
//   れば停止すること。手順3の B がローテーション先と異なれば
//   停止すること。
// - nonce の取得は役割ごとに閉じ込められ、取得中の再取得・
//   取得済みの再取得が拒否され、遅れて戻った旧応答が破棄される
//   こと。各役割の捕捉は1回だけ受け付けること。
// - ログ記録には ID トークン・Cookie・nonce・主体ハッシュが
//   含まれないこと。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import {
  createS14Session,
  buildS14RotateRequest,
  buildS14VerifyOnlyRequest,
  makeS14LogEntry,
  ROTATE_ACTION,
  ROTATE_PATH,
  VERIFY_ONLY_PATH,
  ROTATE_EXPECTED_GENERATION,
  EXPECTED_ROTATE_FINAL_GENERATION,
  EXPECTED_ROTATE_RESPONSE,
  EXPECTED_CHECKA_REFUSAL_RESPONSE,
  ROTATE_EXPECTED_GENERATION_BY_SLOT,
  S14_SLOTS,
  S14_ROLES,
  S14_NONCE_TTL_MS,
  SLOT_SEND_WINDOW_MS,
  S14_TOKEN_ERASE_TRIGGERS,
} from "../tools/s14-rotate.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const VERIFIED = { signature: true, iss: true, aud: true, exp: true, nonce: true };

function assertCode(fn, code) {
  assert.throws(fn, (e) => e && e.code === code);
}

// nonce 取得を済ませる補助。
function issue(session, trialId, generation, role, atMs) {
  session.beginNonceFetch(trialId, generation, role, atMs);
  session.finishNonceFetch(trialId, generation, role, `nonce-${role}`);
}

function captureTargetA(session, trialId, generation, atMs = 1000, hash = HASH_A) {
  issue(session, trialId, generation, "targetA", atMs);
  session.markTargetACaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

function captureTargetB(session, trialId, generation, atMs = 2000, hash = HASH_B) {
  issue(session, trialId, generation, "targetB", atMs);
  session.markTargetBCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

function captureRotateAB(session, trialId, generation, atMs = 3000, hash = HASH_A) {
  issue(session, trialId, generation, "rotateAB", atMs);
  session.markRotateABCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

function captureCheckA(session, trialId, generation, atMs = 5000, hash = HASH_A) {
  issue(session, trialId, generation, "checkA", atMs);
  session.markCheckACaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

function captureCheckB(session, trialId, generation, atMs = 7000, hash = HASH_B) {
  issue(session, trialId, generation, "checkB", atMs);
  session.markCheckBCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

// ローテーションが期待どおり成功するまで進めた試行を返す。
function throughRotateSent() {
  const session = createS14Session();
  const { trialId, generation } = session.beginTrial();
  captureTargetA(session, trialId, generation);
  captureTargetB(session, trialId, generation);
  captureRotateAB(session, trialId, generation);
  session.freezeRotateRequest(trialId, generation);
  const outcome = session.recordRotateSend(trialId, generation, {
    status: 200,
    error: null,
    generation: 7,
  });
  assert.equal(outcome.matched, true);
  return { session, trialId, generation };
}

// 手順2の A の提示が期待どおり not_operator で拒否されるまで
// 進めた試行を返す。
function throughCheckARecorded() {
  const ctx = throughRotateSent();
  captureCheckA(ctx.session, ctx.trialId, ctx.generation);
  const outcome = ctx.session.recordCheckAVerifyOnly(ctx.trialId, ctx.generation, {
    status: 403,
    error: "not_operator",
    generation: null,
  });
  assert.equal(outcome.matched, true);
  return ctx;
}

test("固定値：ローテーションの期待世代・期待応答の分類・パス・タイミング定数", () => {
  assert.equal(ROTATE_ACTION, "rotate");
  assert.equal(ROTATE_PATH, "/admin/registry/rotate");
  assert.equal(VERIFY_ONLY_PATH, "/admin/verify-only");
  assert.equal(ROTATE_EXPECTED_GENERATION, 6);
  assert.equal(EXPECTED_ROTATE_FINAL_GENERATION, 7);
  assert.equal(EXPECTED_ROTATE_RESPONSE.status, 200);
  assert.equal(EXPECTED_ROTATE_RESPONSE.generation, 7);
  assert.equal(EXPECTED_CHECKA_REFUSAL_RESPONSE.status, 403);
  assert.equal(EXPECTED_CHECKA_REFUSAL_RESPONSE.error, "not_operator");
  assert.deepEqual({ ...ROTATE_EXPECTED_GENERATION_BY_SLOT }, { rotateAB: 6 });
  assert.deepEqual([...S14_SLOTS], ["rotateAB", "checkA", "checkB"]);
  assert.deepEqual([...S14_ROLES], ["targetA", "targetB", "rotateAB", "checkA", "checkB"]);
  assert.equal(S14_NONCE_TTL_MS, 5 * 60 * 1000);
  assert.equal(SLOT_SEND_WINDOW_MS, 4 * 60 * 1000);
  assert.ok(S14_TOKEN_ERASE_TRIGGERS.includes("rotateab-sent"));
  assert.ok(S14_TOKEN_ERASE_TRIGGERS.includes("checka-recorded"));
  assert.ok(S14_TOKEN_ERASE_TRIGGERS.includes("s14-completed"));
  assert.ok(S14_TOKEN_ERASE_TRIGGERS.includes("s14-halted"));
});

test("正常系：全手順が固定順に進み completed になる", () => {
  const { session, trialId, generation } = throughCheckARecorded();
  assert.equal(session.snapshot().phase, "checka-recorded");
  captureCheckB(session, trialId, generation);
  const outcome = session.recordCheckBVerifyOnly(trialId, generation, {
    status: 200,
    error: null,
    generation: 7,
  });
  assert.equal(outcome.matched, true);
  const snap = session.snapshot();
  assert.equal(snap.phase, "completed");
  assert.equal(snap.targetACaptured, true);
  assert.equal(snap.targetBCaptured, true);
  assert.equal(snap.authorizerCaptured, true);
  assert.equal(snap.rotateFrozen, true);
  assert.equal(snap.checkACaptured, true);
  assert.equal(snap.checkBCaptured, true);
  assert.equal(snap.undetermined, false);
});

test("凍結内容：旧主体は取得した A・新主体は取得した B・期待世代 6", () => {
  const session = createS14Session();
  const { trialId, generation } = session.beginTrial();
  captureTargetA(session, trialId, generation);
  captureTargetB(session, trialId, generation);
  captureRotateAB(session, trialId, generation);
  const frozen = session.freezeRotateRequest(trialId, generation);
  assert.equal(frozen.action, "rotate");
  assert.equal(frozen.oldSubjectHash, HASH_A);
  assert.equal(frozen.newSubjectHash, HASH_B);
  assert.equal(frozen.expectedGeneration, 6);
  assert.equal(frozen.path, "/admin/registry/rotate");
  const display = session.rotateDisplayData(trialId, generation);
  assert.equal(display.oldSubjectHash, frozen.oldSubjectHash);
  assert.equal(display.newSubjectHash, frozen.newSubjectHash);
  assert.equal(display.expectedGeneration, frozen.expectedGeneration);
  assert.ok(Object.isFrozen(frozen));
  assert.ok(Object.isFrozen(display));
});

test("順序違反：対象取得より前に認可・凍結はできない", () => {
  const session = createS14Session();
  const { trialId, generation } = session.beginTrial();
  assertCode(
    () => session.markTargetBCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED }),
    "trial_order"
  );
  assertCode(
    () => session.markRotateABCaptured(trialId, generation, { subjectHash: HASH_A, verified: VERIFIED }),
    "trial_order"
  );
  assertCode(() => session.freezeRotateRequest(trialId, generation), "trial_order");
  assertCode(
    () => session.recordRotateSend(trialId, generation, { status: 200, error: null, generation: 7 }),
    "trial_order"
  );
});

test("順序違反（負の分岐）：手順2は手順1が 200・世代7 で記録されるまで始められない", () => {
  const session = createS14Session();
  const { trialId, generation } = session.beginTrial();
  captureTargetA(session, trialId, generation);
  captureTargetB(session, trialId, generation);
  captureRotateAB(session, trialId, generation);
  // 凍結前。
  assertCode(
    () => session.markCheckACaptured(trialId, generation, { subjectHash: HASH_A, verified: VERIFIED }),
    "trial_order"
  );
  session.freezeRotateRequest(trialId, generation);
  // 凍結後・送信前でも手順2の取得はできない。
  assertCode(
    () => session.beginNonceFetch(trialId, generation, "checkA", 4000),
    "trial_order"
  );
  assertCode(
    () =>
      session.recordCheckAVerifyOnly(trialId, generation, {
        status: 403,
        error: "not_operator",
        generation: null,
      }),
    "trial_order"
  );
});

test("順序違反（負の分岐）：手順3は手順2の結果が記録されるまで始められない", () => {
  const { session, trialId, generation } = throughRotateSent();
  captureCheckA(session, trialId, generation);
  // 手順2の提示前。
  assertCode(
    () => session.markCheckBCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED }),
    "trial_order"
  );
  assertCode(
    () => session.recordCheckBVerifyOnly(trialId, generation, { status: 200, error: null, generation: 7 }),
    "trial_order"
  );
});

test("機械確認：ローテーション先 B が A と同一なら wrong_subject で停止", () => {
  const session = createS14Session();
  const { trialId, generation } = session.beginTrial();
  captureTargetA(session, trialId, generation);
  assertCode(() => captureTargetB(session, trialId, generation, 2000, HASH_A), "wrong_subject");
  assert.equal(session.snapshot().phase, "halted");
});

test("機械確認：手順1の呼び出し元がローテーション元 A と異なれば wrong_authorizer で停止", () => {
  const session = createS14Session();
  const { trialId, generation } = session.beginTrial();
  captureTargetA(session, trialId, generation);
  captureTargetB(session, trialId, generation);
  assertCode(() => captureRotateAB(session, trialId, generation, 3000, HASH_B), "wrong_authorizer");
  assert.equal(session.snapshot().phase, "halted");
});

test("機械確認：手順2の A がローテーション元と異なれば wrong_authorizer で停止", () => {
  const { session, trialId, generation } = throughRotateSent();
  assertCode(() => captureCheckA(session, trialId, generation, 5000, HASH_B), "wrong_authorizer");
  assert.equal(session.snapshot().phase, "halted");
});

test("機械確認：手順3の B がローテーション先と異なれば wrong_subject で停止", () => {
  const { session, trialId, generation } = throughCheckARecorded();
  assertCode(() => captureCheckB(session, trialId, generation, 7000, HASH_C), "wrong_subject");
  assert.equal(session.snapshot().phase, "halted");
});

test("手順1の応答照合：期待外れと応答なしで停止し、後段へ進めない", () => {
  // 409 stale_generation（世代不一致）は停止。
  const s1 = createS14Session();
  const t1 = s1.beginTrial();
  captureTargetA(s1, t1.trialId, t1.generation);
  captureTargetB(s1, t1.trialId, t1.generation);
  captureRotateAB(s1, t1.trialId, t1.generation);
  s1.freezeRotateRequest(t1.trialId, t1.generation);
  assert.equal(s1.canSendRotate(t1.trialId, t1.generation), true);
  const o1 = s1.recordRotateSend(t1.trialId, t1.generation, {
    status: 409,
    error: "stale_generation",
    generation: null,
  });
  assert.equal(o1.matched, false);
  assert.equal(o1.undetermined, false);
  assert.equal(s1.snapshot().phase, "halted");
  assert.equal(s1.canSendRotate(t1.trialId, t1.generation), false);
  assertCode(
    () => s1.markCheckACaptured(t1.trialId, t1.generation, { subjectHash: HASH_A, verified: VERIFIED }),
    "trial_order"
  );
  // 応答なしは状態未確定として停止。
  const s2 = createS14Session();
  const t2 = s2.beginTrial();
  captureTargetA(s2, t2.trialId, t2.generation);
  captureTargetB(s2, t2.trialId, t2.generation);
  captureRotateAB(s2, t2.trialId, t2.generation);
  s2.freezeRotateRequest(t2.trialId, t2.generation);
  const o2 = s2.recordRotateSend(t2.trialId, t2.generation, null);
  assert.equal(o2.matched, false);
  assert.equal(o2.undetermined, true);
  assert.equal(s2.snapshot().phase, "halted");
  // 200 でも generation が 7 でなければ停止。
  const s3 = createS14Session();
  const t3 = s3.beginTrial();
  captureTargetA(s3, t3.trialId, t3.generation);
  captureTargetB(s3, t3.trialId, t3.generation);
  captureRotateAB(s3, t3.trialId, t3.generation);
  s3.freezeRotateRequest(t3.trialId, t3.generation);
  const o3 = s3.recordRotateSend(t3.trialId, t3.generation, {
    status: 200,
    error: null,
    generation: 6,
  });
  assert.equal(o3.matched, false);
  assert.equal(s3.snapshot().phase, "halted");
});

test("手順2の応答照合：403 not_operator が合格、200 の成功は期待外れで停止", () => {
  // 合格形は throughCheckARecorded が確認済み。ここでは失敗形。
  const { session, trialId, generation } = throughRotateSent();
  captureCheckA(session, trialId, generation);
  // ローテーションが在籍に反映されず 200 で通ってしまった場合は停止。
  const o = session.recordCheckAVerifyOnly(trialId, generation, {
    status: 200,
    error: null,
    generation: 7,
  });
  assert.equal(o.matched, false);
  assert.equal(o.undetermined, false);
  assert.equal(session.snapshot().phase, "halted");
  // 停止後は手順3へ進めない。
  assertCode(
    () => session.markCheckBCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED }),
    "trial_order"
  );
  // 403 でも理由コードが not_operator でなければ停止。
  const ctx2 = throughRotateSent();
  captureCheckA(ctx2.session, ctx2.trialId, ctx2.generation);
  const o2 = ctx2.session.recordCheckAVerifyOnly(ctx2.trialId, ctx2.generation, {
    status: 403,
    error: "nonce_replayed",
    generation: null,
  });
  assert.equal(o2.matched, false);
  assert.equal(ctx2.session.snapshot().phase, "halted");
  // 応答なしは状態未確定として停止。
  const ctx3 = throughRotateSent();
  captureCheckA(ctx3.session, ctx3.trialId, ctx3.generation);
  const o3 = ctx3.session.recordCheckAVerifyOnly(ctx3.trialId, ctx3.generation, null);
  assert.equal(o3.matched, false);
  assert.equal(o3.undetermined, true);
});

test("手順3の応答照合：403 や応答なしでは停止する", () => {
  const ctx = throughCheckARecorded();
  captureCheckB(ctx.session, ctx.trialId, ctx.generation);
  const o = ctx.session.recordCheckBVerifyOnly(ctx.trialId, ctx.generation, {
    status: 403,
    error: "not_operator",
    generation: null,
  });
  assert.equal(o.matched, false);
  assert.equal(ctx.session.snapshot().phase, "halted");
  const ctx2 = throughCheckARecorded();
  captureCheckB(ctx2.session, ctx2.trialId, ctx2.generation);
  const o2 = ctx2.session.recordCheckBVerifyOnly(ctx2.trialId, ctx2.generation, null);
  assert.equal(o2.undetermined, true);
  assert.equal(ctx2.session.snapshot().phase, "halted");
});

test("各送信の再送手段がない：送信・提示の記録は1回だけ", () => {
  const { session, trialId, generation } = throughCheckARecorded();
  assertCode(
    () => session.recordRotateSend(trialId, generation, { status: 200, error: null, generation: 7 }),
    "trial_order"
  );
  assertCode(
    () =>
      session.recordCheckAVerifyOnly(trialId, generation, {
        status: 403,
        error: "not_operator",
        generation: null,
      }),
    "trial_order"
  );
});

test("nonce 取得：段階・二重取得・旧試行の応答破棄", () => {
  const session = createS14Session();
  const { trialId, generation } = session.beginTrial();
  // rotateAB の nonce は start では取得できない。
  assertCode(() => session.beginNonceFetch(trialId, generation, "rotateAB", 1000), "trial_order");
  session.beginNonceFetch(trialId, generation, "targetA", 1000);
  assert.equal(session.isNonceFetchPending(trialId, generation, "targetA"), true);
  assertCode(() => session.beginNonceFetch(trialId, generation, "targetA", 1100), "nonce_fetch_busy");
  const applied = session.finishNonceFetch(trialId, generation, "targetA", "nonce-targetA");
  assert.equal(applied.issuedAtMs, 1000);
  assert.equal(session.nonceIssuedAt(trialId, generation, "targetA"), 1000);
  assertCode(() => session.beginNonceFetch(trialId, generation, "targetA", 1200), "nonce_already_issued");
  session.markTargetACaptured(trialId, generation, { subjectHash: HASH_A, verified: VERIFIED });
  // 新しい試行では旧試行の応答は破棄される。
  const next = session.beginTrial();
  assert.equal(session.isCurrent(trialId, generation), false);
  assert.equal(session.finishNonceFetch(trialId, generation, "targetA", "nonce-old"), null);
  assertCode(() => session.nonceIssuedAt(trialId, generation, "targetA"), "stale_attempt");
  assert.ok(next.trialId);
});

test("捕捉の claim：同一試行・役割では1回だけ", () => {
  const session = createS14Session();
  const { trialId, generation } = session.beginTrial();
  assert.equal(session.isCallbackCurrent(trialId, generation, "targetA"), true);
  assert.equal(session.isCallbackCurrent(trialId, generation, "rotateAB"), false);
  assert.equal(session.claimCallbackCapture(trialId, generation, "targetA"), true);
  assert.equal(session.claimCallbackCapture(trialId, generation, "targetA"), false);
  assert.equal(session.claimCallbackCapture(trialId, generation, "rotateAB"), false);
});

test("検証不完全・形式不正の捕捉は拒否される", () => {
  const session = createS14Session();
  const { trialId, generation } = session.beginTrial();
  issue(session, trialId, generation, "targetA", 1000);
  assertCode(
    () =>
      session.markTargetACaptured(trialId, generation, {
        subjectHash: HASH_A,
        verified: { signature: true, iss: true, aud: true, exp: true, nonce: false },
      }),
    "verification_incomplete"
  );
  assertCode(
    () => session.markTargetACaptured(trialId, generation, { subjectHash: "zz", verified: VERIFIED }),
    "bad_trial_input"
  );
  // nonce 未取得の捕捉は段階エラー。
  const s2 = createS14Session();
  const t2 = s2.beginTrial();
  assertCode(
    () => s2.markTargetACaptured(t2.trialId, t2.generation, { subjectHash: HASH_A, verified: VERIFIED }),
    "trial_order"
  );
});

test("要求ビルダー：凍結され、値は検証される", () => {
  const req = buildS14RotateRequest({
    idToken: "token-a",
    oldSubjectHash: HASH_A,
    newSubjectHash: HASH_B,
    expectedGeneration: 6,
  });
  assert.deepEqual(
    { ...req },
    {
      id_token: "token-a",
      old_subject_hash: HASH_A,
      new_subject_hash: HASH_B,
      expected_generation: 6,
    }
  );
  assert.ok(Object.isFrozen(req));
  assertCode(
    () =>
      buildS14RotateRequest({
        idToken: "t",
        oldSubjectHash: "nope",
        newSubjectHash: HASH_B,
        expectedGeneration: 6,
      }),
    "bad_trial_input"
  );
  assertCode(
    () =>
      buildS14RotateRequest({
        idToken: "",
        oldSubjectHash: HASH_A,
        newSubjectHash: HASH_B,
        expectedGeneration: 6,
      }),
    "bad_trial_input"
  );
  const vo = buildS14VerifyOnlyRequest({ idToken: "token-a" });
  assert.deepEqual({ ...vo }, { id_token: "token-a" });
  assert.deepEqual(Object.keys(vo), ["id_token"]);
  assert.ok(Object.isFrozen(vo));
});

test("ログ記録：秘密を含まず、理由コードだけが残る", () => {
  const entry = makeS14LogEntry({
    trialId: "trial-1",
    step: "rotateab-sent",
    response: { status: 200, error: null, generation: 7 },
  });
  assert.deepEqual(
    { ...entry, response: { ...entry.response } },
    { trial_id: "trial-1", step: "rotateab-sent", response: { status: 200, error: null, generation: 7 } }
  );
  const refused = makeS14LogEntry({
    trialId: "trial-1",
    step: "checka-refused",
    response: { status: 403, error: "not_operator", generation: null },
  });
  assert.equal(refused.response.error, "not_operator");
  const unknown = makeS14LogEntry({
    trialId: "trial-1",
    step: "rotateab-sent",
    response: { status: 500, error: "some_internal_detail", generation: null },
  });
  assert.equal(unknown.response.error, "unexpected_error");
  const noResp = makeS14LogEntry({
    trialId: "trial-1",
    step: "rotateab-sent",
    response: { status: 0, error: "no_response", generation: null },
  });
  assert.equal(noResp.response.error, "no_response");
  const json = JSON.stringify([entry, refused, unknown]);
  assert.ok(!json.includes(HASH_A));
  assert.ok(!json.includes(HASH_B));
  assert.ok(!json.includes("token"));
  assertCode(
    () => makeS14LogEntry({ trialId: "t", step: "bogus", response: { status: 200 } }),
    "bad_trial_input"
  );
});

test("破棄：現行試行だけが無効化され、旧試行の操作は stale_attempt", () => {
  const session = createS14Session();
  const { trialId, generation } = session.beginTrial();
  assert.equal(session.discard("other", generation), false);
  assert.equal(session.discard(trialId, generation), true);
  assert.equal(session.snapshot(), null);
  assertCode(
    () => session.markTargetACaptured(trialId, generation, { subjectHash: HASH_A, verified: VERIFIED }),
    "stale_attempt"
  );
  assert.equal(session.discard(trialId, generation), false);
});
