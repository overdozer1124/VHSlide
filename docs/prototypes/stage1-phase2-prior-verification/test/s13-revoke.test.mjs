// S13 最後の運営者の保護専用モジュール（tools/s13-revoke.mjs）の単体試験。
// 実行: node --test test/s13-revoke.test.mjs
// （npm run test:s13 でも実行できる）
//
// 目的：S13 の状態機械・機械確認を、実 Google・実 Worker を
// 使わずに検証する。
// - 順序：C の対象取得 → A の取得（手順1）→ 失効C の凍結 →
//   失効C の送信 → A の取得（手順2）→ 失効A の凍結 → 失効A の
//   送信 → A の取得（手順3）→ A の提示の固定順であること。
//   手順2は手順1が 200 で記録されるまで始められず、手順3は
//   手順2の結果が記録されるまで始められないこと（手順の負の
//   分岐）。
// - 期待値の分類：手順1は 200 ok・generation 6 のみが期待
//   どおり。手順2は 409 last_operator が期待どおり（合格）で
//   あり、200 の成功は期待外れとして停止すること。手順3は
//   200 ok のみが期待どおり。それ以外・応答なしでは停止して
//   後段へ進めないこと。各送信の再送手段がないこと。
// - 機械確認：認可者が C と同一なら停止すること。手順2・手順3
//   の A が手順1の認可者と異なれば停止すること。
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
  createS13Session,
  buildS13RevokeRequest,
  buildS13VerifyOnlyRequest,
  makeS13LogEntry,
  REVOKE_ACTION,
  REVOKE_PATH,
  VERIFY_ONLY_PATH,
  REVOKEC_EXPECTED_GENERATION,
  EXPECTED_REVOKEC_FINAL_GENERATION,
  REVOKEA_EXPECTED_GENERATION,
  EXPECTED_LAST_OPERATOR_RESPONSE,
  REVOKE_EXPECTED_GENERATION_BY_SLOT,
  S13_SLOTS,
  S13_ROLES,
  S13_NONCE_TTL_MS,
  SLOT_SEND_WINDOW_MS,
  S13_TOKEN_ERASE_TRIGGERS,
} from "../tools/s13-revoke.mjs";

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

function captureTargetC(session, trialId, generation, atMs = 1000, hash = HASH_C) {
  issue(session, trialId, generation, "targetC", atMs);
  session.markTargetCCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

function captureRevokeC(session, trialId, generation, atMs = 2000, hash = HASH_A) {
  issue(session, trialId, generation, "revokeC", atMs);
  session.markRevokeCCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

function captureRevokeA(session, trialId, generation, atMs = 4000, hash = HASH_A) {
  issue(session, trialId, generation, "revokeA", atMs);
  session.markRevokeACaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

function captureCheckA(session, trialId, generation, atMs = 6000, hash = HASH_A) {
  issue(session, trialId, generation, "checkA", atMs);
  session.markCheckACaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

// 失効C が期待どおり成功するまで進めた試行を返す。
function throughRevokeCSent() {
  const session = createS13Session();
  const { trialId, generation } = session.beginTrial();
  captureTargetC(session, trialId, generation);
  captureRevokeC(session, trialId, generation);
  session.freezeRevokeCRequest(trialId, generation);
  const outcome = session.recordRevokeCSend(trialId, generation, {
    status: 200,
    error: null,
    generation: 6,
  });
  assert.equal(outcome.matched, true);
  return { session, trialId, generation };
}

// 失効A の試行が期待どおり last_operator で拒否されるまで進めた試行を返す。
function throughRevokeARecorded() {
  const ctx = throughRevokeCSent();
  captureRevokeA(ctx.session, ctx.trialId, ctx.generation);
  ctx.session.freezeRevokeARequest(ctx.trialId, ctx.generation);
  const outcome = ctx.session.recordRevokeASend(ctx.trialId, ctx.generation, {
    status: 409,
    error: "last_operator",
    generation: null,
  });
  assert.equal(outcome.matched, true);
  return ctx;
}

test("固定値：失効の対象世代・期待世代・パス・タイミング定数", () => {
  assert.equal(REVOKE_ACTION, "revoke");
  assert.equal(REVOKE_PATH, "/admin/registry/revoke");
  assert.equal(VERIFY_ONLY_PATH, "/admin/verify-only");
  assert.equal(REVOKEC_EXPECTED_GENERATION, 5);
  assert.equal(EXPECTED_REVOKEC_FINAL_GENERATION, 6);
  assert.equal(REVOKEA_EXPECTED_GENERATION, 6);
  assert.equal(EXPECTED_LAST_OPERATOR_RESPONSE.status, 409);
  assert.equal(EXPECTED_LAST_OPERATOR_RESPONSE.error, "last_operator");
  assert.deepEqual({ ...REVOKE_EXPECTED_GENERATION_BY_SLOT }, { revokeC: 5, revokeA: 6 });
  assert.deepEqual([...S13_SLOTS], ["revokeC", "revokeA", "checkA"]);
  assert.deepEqual([...S13_ROLES], ["targetC", "revokeC", "revokeA", "checkA"]);
  assert.equal(S13_NONCE_TTL_MS, 5 * 60 * 1000);
  assert.equal(SLOT_SEND_WINDOW_MS, 4 * 60 * 1000);
  assert.ok(S13_TOKEN_ERASE_TRIGGERS.includes("revokec-sent"));
  assert.ok(S13_TOKEN_ERASE_TRIGGERS.includes("revokea-recorded"));
  assert.ok(S13_TOKEN_ERASE_TRIGGERS.includes("s13-completed"));
  assert.ok(S13_TOKEN_ERASE_TRIGGERS.includes("s13-halted"));
});

test("正常系：全手順が固定順に進み completed になる", () => {
  const { session, trialId, generation } = throughRevokeARecorded();
  assert.equal(session.snapshot().phase, "revokea-recorded");
  captureCheckA(session, trialId, generation);
  const outcome = session.recordCheckAVerifyOnly(trialId, generation, {
    status: 200,
    error: null,
    generation: 6,
  });
  assert.equal(outcome.matched, true);
  const snap = session.snapshot();
  assert.equal(snap.phase, "completed");
  assert.equal(snap.targetCaptured, true);
  assert.equal(snap.authorizerCaptured, true);
  assert.equal(snap.revokeCFrozen, true);
  assert.equal(snap.revokeACaptured, true);
  assert.equal(snap.revokeAFrozen, true);
  assert.equal(snap.checkACaptured, true);
  assert.equal(snap.undetermined, false);
});

test("凍結内容：手順1は対象 C・期待世代 5、手順2は対象 A 自身・期待世代 6", () => {
  const session = createS13Session();
  const { trialId, generation } = session.beginTrial();
  captureTargetC(session, trialId, generation);
  captureRevokeC(session, trialId, generation);
  const frozenC = session.freezeRevokeCRequest(trialId, generation);
  assert.equal(frozenC.action, "revoke");
  assert.equal(frozenC.targetSubjectHash, HASH_C);
  assert.equal(frozenC.expectedGeneration, 5);
  assert.equal(frozenC.path, "/admin/registry/revoke");
  const displayC = session.revokeCDisplayData(trialId, generation);
  assert.equal(displayC.targetSubjectHash, frozenC.targetSubjectHash);
  assert.equal(displayC.expectedGeneration, frozenC.expectedGeneration);
  assert.ok(Object.isFrozen(frozenC));
  assert.ok(Object.isFrozen(displayC));
  session.recordRevokeCSend(trialId, generation, { status: 200, error: null, generation: 6 });
  captureRevokeA(session, trialId, generation);
  const frozenA = session.freezeRevokeARequest(trialId, generation);
  assert.equal(frozenA.targetSubjectHash, HASH_A);
  assert.equal(frozenA.expectedGeneration, 6);
  const displayA = session.revokeADisplayData(trialId, generation);
  assert.equal(displayA.targetSubjectHash, HASH_A);
  assert.ok(Object.isFrozen(frozenA));
});

test("順序違反：対象取得より前に認可・凍結はできない", () => {
  const session = createS13Session();
  const { trialId, generation } = session.beginTrial();
  assertCode(
    () => session.markRevokeCCaptured(trialId, generation, { subjectHash: HASH_A, verified: VERIFIED }),
    "trial_order"
  );
  assertCode(() => session.freezeRevokeCRequest(trialId, generation), "trial_order");
  assertCode(
    () => session.recordRevokeCSend(trialId, generation, { status: 200, error: null, generation: 6 }),
    "trial_order"
  );
});

test("順序違反（負の分岐）：手順2は手順1が 200 で記録されるまで始められない", () => {
  const session = createS13Session();
  const { trialId, generation } = session.beginTrial();
  captureTargetC(session, trialId, generation);
  captureRevokeC(session, trialId, generation);
  // 凍結前。
  assertCode(
    () => session.markRevokeACaptured(trialId, generation, { subjectHash: HASH_A, verified: VERIFIED }),
    "trial_order"
  );
  session.freezeRevokeCRequest(trialId, generation);
  // 凍結後・送信前でも手順2の取得はできない。
  assertCode(
    () => session.beginNonceFetch(trialId, generation, "revokeA", 3000),
    "trial_order"
  );
  assertCode(() => session.freezeRevokeARequest(trialId, generation), "trial_order");
  assertCode(
    () =>
      session.recordRevokeASend(trialId, generation, {
        status: 409,
        error: "last_operator",
        generation: null,
      }),
    "trial_order"
  );
});

test("順序違反（負の分岐）：手順3は手順2の結果が記録されるまで始められない", () => {
  const { session, trialId, generation } = throughRevokeCSent();
  captureRevokeA(session, trialId, generation);
  session.freezeRevokeARequest(trialId, generation);
  // 手順2の送信前。
  assertCode(
    () => session.markCheckACaptured(trialId, generation, { subjectHash: HASH_A, verified: VERIFIED }),
    "trial_order"
  );
  assertCode(
    () => session.recordCheckAVerifyOnly(trialId, generation, { status: 200, error: null, generation: 6 }),
    "trial_order"
  );
});

test("機械確認：認可者が C と同一なら wrong_authorizer で停止", () => {
  const session = createS13Session();
  const { trialId, generation } = session.beginTrial();
  captureTargetC(session, trialId, generation);
  assertCode(() => captureRevokeC(session, trialId, generation, 2000, HASH_C), "wrong_authorizer");
  assert.equal(session.snapshot().phase, "halted");
});

test("機械確認：手順2の A が手順1の認可者と異なれば wrong_authorizer で停止", () => {
  const { session, trialId, generation } = throughRevokeCSent();
  assertCode(() => captureRevokeA(session, trialId, generation, 4000, HASH_B), "wrong_authorizer");
  assert.equal(session.snapshot().phase, "halted");
});

test("機械確認：手順3の A が手順1の認可者と異なれば wrong_authorizer で停止", () => {
  const { session, trialId, generation } = throughRevokeARecorded();
  assertCode(() => captureCheckA(session, trialId, generation, 6000, HASH_C), "wrong_authorizer");
  assert.equal(session.snapshot().phase, "halted");
});

test("手順1の応答照合：期待外れと応答なしで停止し、後段へ進めない", () => {
  // 409 stale_generation（世代不一致）は停止。
  const s1 = createS13Session();
  const t1 = s1.beginTrial();
  captureTargetC(s1, t1.trialId, t1.generation);
  captureRevokeC(s1, t1.trialId, t1.generation);
  s1.freezeRevokeCRequest(t1.trialId, t1.generation);
  assert.equal(s1.canSendRevokeC(t1.trialId, t1.generation), true);
  const o1 = s1.recordRevokeCSend(t1.trialId, t1.generation, {
    status: 409,
    error: "stale_generation",
    generation: null,
  });
  assert.equal(o1.matched, false);
  assert.equal(o1.undetermined, false);
  assert.equal(s1.snapshot().phase, "halted");
  assert.equal(s1.canSendRevokeC(t1.trialId, t1.generation), false);
  assertCode(
    () => s1.markRevokeACaptured(t1.trialId, t1.generation, { subjectHash: HASH_A, verified: VERIFIED }),
    "trial_order"
  );
  // 応答なしは状態未確定として停止。
  const s2 = createS13Session();
  const t2 = s2.beginTrial();
  captureTargetC(s2, t2.trialId, t2.generation);
  captureRevokeC(s2, t2.trialId, t2.generation);
  s2.freezeRevokeCRequest(t2.trialId, t2.generation);
  const o2 = s2.recordRevokeCSend(t2.trialId, t2.generation, null);
  assert.equal(o2.matched, false);
  assert.equal(o2.undetermined, true);
  assert.equal(s2.snapshot().phase, "halted");
  // 200 でも generation が 6 でなければ停止。
  const s3 = createS13Session();
  const t3 = s3.beginTrial();
  captureTargetC(s3, t3.trialId, t3.generation);
  captureRevokeC(s3, t3.trialId, t3.generation);
  s3.freezeRevokeCRequest(t3.trialId, t3.generation);
  const o3 = s3.recordRevokeCSend(t3.trialId, t3.generation, {
    status: 200,
    error: null,
    generation: 5,
  });
  assert.equal(o3.matched, false);
  assert.equal(s3.snapshot().phase, "halted");
});

test("手順2の応答照合：409 last_operator が合格、200 の成功は期待外れで停止", () => {
  // 合格形は throughRevokeARecorded が確認済み。ここでは失敗形。
  const { session, trialId, generation } = throughRevokeCSent();
  captureRevokeA(session, trialId, generation);
  session.freezeRevokeARequest(trialId, generation);
  assert.equal(session.canSendRevokeA(trialId, generation), true);
  // 最後の運営者保護が効かず 200 で成功してしまった場合は停止。
  const o = session.recordRevokeASend(trialId, generation, {
    status: 200,
    error: null,
    generation: 7,
  });
  assert.equal(o.matched, false);
  assert.equal(o.undetermined, false);
  assert.equal(session.snapshot().phase, "halted");
  // 停止後は手順3へ進めない。
  assertCode(
    () => session.markCheckACaptured(trialId, generation, { subjectHash: HASH_A, verified: VERIFIED }),
    "trial_order"
  );
  // 409 でも理由コードが last_operator でなければ停止。
  const ctx2 = throughRevokeCSent();
  captureRevokeA(ctx2.session, ctx2.trialId, ctx2.generation);
  ctx2.session.freezeRevokeARequest(ctx2.trialId, ctx2.generation);
  const o2 = ctx2.session.recordRevokeASend(ctx2.trialId, ctx2.generation, {
    status: 409,
    error: "stale_generation",
    generation: null,
  });
  assert.equal(o2.matched, false);
  assert.equal(ctx2.session.snapshot().phase, "halted");
  // 応答なしは状態未確定として停止。
  const ctx3 = throughRevokeCSent();
  captureRevokeA(ctx3.session, ctx3.trialId, ctx3.generation);
  ctx3.session.freezeRevokeARequest(ctx3.trialId, ctx3.generation);
  const o3 = ctx3.session.recordRevokeASend(ctx3.trialId, ctx3.generation, null);
  assert.equal(o3.matched, false);
  assert.equal(o3.undetermined, true);
});

test("手順3の応答照合：403 や応答なしでは停止する", () => {
  const ctx = throughRevokeARecorded();
  captureCheckA(ctx.session, ctx.trialId, ctx.generation);
  const o = ctx.session.recordCheckAVerifyOnly(ctx.trialId, ctx.generation, {
    status: 403,
    error: "not_operator",
    generation: null,
  });
  assert.equal(o.matched, false);
  assert.equal(ctx.session.snapshot().phase, "halted");
  const ctx2 = throughRevokeARecorded();
  captureCheckA(ctx2.session, ctx2.trialId, ctx2.generation);
  const o2 = ctx2.session.recordCheckAVerifyOnly(ctx2.trialId, ctx2.generation, null);
  assert.equal(o2.undetermined, true);
  assert.equal(ctx2.session.snapshot().phase, "halted");
});

test("各送信の再送手段がない：送信記録は1回だけ", () => {
  const { session, trialId, generation } = throughRevokeARecorded();
  assertCode(
    () => session.recordRevokeCSend(trialId, generation, { status: 200, error: null, generation: 6 }),
    "trial_order"
  );
  assertCode(
    () =>
      session.recordRevokeASend(trialId, generation, {
        status: 409,
        error: "last_operator",
        generation: null,
      }),
    "trial_order"
  );
});

test("nonce 取得：段階・二重取得・旧試行の応答破棄", () => {
  const session = createS13Session();
  const { trialId, generation } = session.beginTrial();
  // revokeC の nonce は start では取得できない。
  assertCode(() => session.beginNonceFetch(trialId, generation, "revokeC", 1000), "trial_order");
  session.beginNonceFetch(trialId, generation, "targetC", 1000);
  assert.equal(session.isNonceFetchPending(trialId, generation, "targetC"), true);
  assertCode(() => session.beginNonceFetch(trialId, generation, "targetC", 1100), "nonce_fetch_busy");
  const applied = session.finishNonceFetch(trialId, generation, "targetC", "nonce-targetC");
  assert.equal(applied.issuedAtMs, 1000);
  assert.equal(session.nonceIssuedAt(trialId, generation, "targetC"), 1000);
  assertCode(() => session.beginNonceFetch(trialId, generation, "targetC", 1200), "nonce_already_issued");
  session.markTargetCCaptured(trialId, generation, { subjectHash: HASH_C, verified: VERIFIED });
  // 新しい試行では旧試行の応答は破棄される。
  const next = session.beginTrial();
  assert.equal(session.isCurrent(trialId, generation), false);
  assert.equal(session.finishNonceFetch(trialId, generation, "targetC", "nonce-old"), null);
  assertCode(() => session.nonceIssuedAt(trialId, generation, "targetC"), "stale_attempt");
  assert.ok(next.trialId);
});

test("捕捉の claim：同一試行・役割では1回だけ", () => {
  const session = createS13Session();
  const { trialId, generation } = session.beginTrial();
  assert.equal(session.isCallbackCurrent(trialId, generation, "targetC"), true);
  assert.equal(session.isCallbackCurrent(trialId, generation, "revokeC"), false);
  assert.equal(session.claimCallbackCapture(trialId, generation, "targetC"), true);
  assert.equal(session.claimCallbackCapture(trialId, generation, "targetC"), false);
  assert.equal(session.claimCallbackCapture(trialId, generation, "revokeC"), false);
});

test("検証不完全・形式不正の捕捉は拒否される", () => {
  const session = createS13Session();
  const { trialId, generation } = session.beginTrial();
  issue(session, trialId, generation, "targetC", 1000);
  assertCode(
    () =>
      session.markTargetCCaptured(trialId, generation, {
        subjectHash: HASH_C,
        verified: { signature: true, iss: true, aud: true, exp: true, nonce: false },
      }),
    "verification_incomplete"
  );
  assertCode(
    () => session.markTargetCCaptured(trialId, generation, { subjectHash: "zz", verified: VERIFIED }),
    "bad_trial_input"
  );
  // nonce 未取得の捕捉は段階エラー。
  const s2 = createS13Session();
  const t2 = s2.beginTrial();
  assertCode(
    () => s2.markTargetCCaptured(t2.trialId, t2.generation, { subjectHash: HASH_C, verified: VERIFIED }),
    "trial_order"
  );
});

test("要求ビルダー：凍結され、値は検証される", () => {
  const req = buildS13RevokeRequest({
    idToken: "token-a",
    subjectHash: HASH_C,
    expectedGeneration: 5,
  });
  assert.deepEqual(
    { ...req },
    { id_token: "token-a", subject_hash: HASH_C, expected_generation: 5 }
  );
  assert.ok(Object.isFrozen(req));
  assertCode(
    () => buildS13RevokeRequest({ idToken: "t", subjectHash: "nope", expectedGeneration: 5 }),
    "bad_trial_input"
  );
  assertCode(
    () => buildS13RevokeRequest({ idToken: "", subjectHash: HASH_C, expectedGeneration: 5 }),
    "bad_trial_input"
  );
  const vo = buildS13VerifyOnlyRequest({ idToken: "token-a" });
  assert.deepEqual({ ...vo }, { id_token: "token-a" });
  assert.deepEqual(Object.keys(vo), ["id_token"]);
  assert.ok(Object.isFrozen(vo));
});

test("ログ記録：秘密を含まず、理由コードだけが残る", () => {
  const entry = makeS13LogEntry({
    trialId: "trial-1",
    step: "revokec-sent",
    response: { status: 200, error: null, generation: 6 },
  });
  assert.deepEqual(
    { ...entry, response: { ...entry.response } },
    { trial_id: "trial-1", step: "revokec-sent", response: { status: 200, error: null, generation: 6 } }
  );
  const refused = makeS13LogEntry({
    trialId: "trial-1",
    step: "revokea-recorded",
    response: { status: 409, error: "last_operator", generation: null },
  });
  assert.equal(refused.response.error, "last_operator");
  const unknown = makeS13LogEntry({
    trialId: "trial-1",
    step: "revokec-sent",
    response: { status: 500, error: "some_internal_detail", generation: null },
  });
  assert.equal(unknown.response.error, "unexpected_error");
  const noResp = makeS13LogEntry({
    trialId: "trial-1",
    step: "revokec-sent",
    response: { status: 0, error: "no_response", generation: null },
  });
  assert.equal(noResp.response.error, "no_response");
  const json = JSON.stringify([entry, refused, unknown]);
  assert.ok(!json.includes(HASH_C));
  assert.ok(!json.includes("token"));
  assertCode(
    () => makeS13LogEntry({ trialId: "t", step: "bogus", response: { status: 200 } }),
    "bad_trial_input"
  );
});

test("破棄：現行試行だけが無効化され、旧試行の操作は stale_attempt", () => {
  const session = createS13Session();
  const { trialId, generation } = session.beginTrial();
  assert.equal(session.discard("other", generation), false);
  assert.equal(session.discard(trialId, generation), true);
  assert.equal(session.snapshot(), null);
  assertCode(
    () => session.markTargetCCaptured(trialId, generation, { subjectHash: HASH_C, verified: VERIFIED }),
    "stale_attempt"
  );
  assert.equal(session.discard(trialId, generation), false);
});
