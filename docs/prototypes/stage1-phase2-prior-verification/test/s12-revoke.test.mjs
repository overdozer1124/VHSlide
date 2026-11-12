// S12 失効専用モジュール（tools/s12-revoke.mjs）の単体試験。
// 実行: node --test test/s12-revoke.test.mjs
// （npm run test:s12 でも実行できる）
//
// 目的：S12 の状態機械・機械確認を、実 Google・実 Worker を
// 使わずに検証する。
// - 順序：B の保持トークン取得 → A の認可 → 失効の凍結 → 失効の
//   送信 → 新しい B の取得 → 新しい B の提示 → 保持トークンの
//   提示 → C の取得 → C の提示の固定順であること。保持トークン
//   の提示は、失効と新しい B の提示より前にはできないこと
//   （手順の負の分岐）。
// - 保持トークンの鮮度：失効の凍結・送信可否は、保持トークンの
//   発行開始からの経過が HELD_MAX_AGE_AT_REVOKE_MS（2分）を
//   超えたら拒否され、試行が停止すること。境界（ちょうど2分）
//   では送れること。
// - 機械確認：認可者が B と同一なら停止すること。新しい B が
//   失効対象と異なれば停止すること。C が A・B のどちらかと
//   同一なら停止すること。
// - 失効の期待は 200 ok・generation 5 であり、それ以外・応答
//   なしでは停止して後段へ進めないこと。失効の再送手段がない
//   こと。
// - 手順3・4の期待は 403 not_operator、手順5の期待は 200 ok
//   であり、それ以外・応答なしでは停止すること。
// - nonce の取得はスロットごとに閉じ込められ、取得中の再取得・
//   取得済みの再取得が拒否され、遅れて戻った旧応答が破棄される
//   こと。各スロットの捕捉は1回だけ受け付けること。
// - ログ記録には ID トークン・Cookie・nonce・主体ハッシュが
//   含まれないこと。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import {
  createS12Session,
  buildS12RevokeRequest,
  buildS12VerifyOnlyRequest,
  heldTokenFreshness,
  makeS12LogEntry,
  REVOKE_ACTION,
  REVOKE_PATH,
  VERIFY_ONLY_PATH,
  REVOKE_EXPECTED_GENERATION,
  EXPECTED_REVOKE_FINAL_GENERATION,
  EXPECTED_NOT_OPERATOR_RESPONSE,
  S12_SLOTS,
  SLOT_SEND_WINDOW_MS,
  POST_REVOKE_RESERVE_MS,
  HELD_MAX_AGE_AT_REVOKE_MS,
  S12_NONCE_TTL_MS,
  S12_TOKEN_ERASE_TRIGGERS,
} from "../tools/s12-revoke.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_X = "d".repeat(64);
const VERIFIED = { signature: true, iss: true, aud: true, exp: true, nonce: true };

function assertCode(fn, code) {
  assert.throws(fn, (e) => e && e.code === code);
}

// nonce 取得を済ませる補助。
function issue(session, trialId, generation, slot, atMs) {
  session.beginNonceFetch(trialId, generation, slot, atMs);
  session.finishNonceFetch(trialId, generation, slot, `nonce-${slot}`);
}

function captureHeldB(session, trialId, generation, atMs = 1000, hash = HASH_B) {
  issue(session, trialId, generation, "heldB", atMs);
  session.markHeldBCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

function captureA(session, trialId, generation, atMs = 2000, hash = HASH_A) {
  issue(session, trialId, generation, "revokeA", atMs);
  session.markAuthorizerCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

function captureFreshB(session, trialId, generation, atMs = 4000, hash = HASH_B) {
  issue(session, trialId, generation, "freshB", atMs);
  session.markFreshBCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

function captureC(session, trialId, generation, atMs = 6000, hash = HASH_C) {
  issue(session, trialId, generation, "checkC", atMs);
  session.markCCaptured(trialId, generation, { subjectHash: hash, verified: VERIFIED });
}

// 失効が期待どおり成功するまで進めた試行を返す。
function throughRevokeSent() {
  const session = createS12Session();
  const { trialId, generation } = session.beginTrial();
  captureHeldB(session, trialId, generation);
  captureA(session, trialId, generation);
  session.freezeRevokeRequest(trialId, generation, 3000);
  const outcome = session.recordRevokeSend(trialId, generation, {
    status: 200,
    error: null,
    generation: 5,
  });
  assert.equal(outcome.matched, true);
  return { session, trialId, generation };
}

// 新しい B の提示が期待どおり拒否されるまで進めた試行を返す。
function throughFreshBPresented() {
  const ctx = throughRevokeSent();
  captureFreshB(ctx.session, ctx.trialId, ctx.generation);
  const outcome = ctx.session.recordFreshBVerifyOnly(ctx.trialId, ctx.generation, {
    status: 403,
    error: "not_operator",
    generation: null,
  });
  assert.equal(outcome.matched, true);
  return ctx;
}

// 保持トークンの提示が期待どおり拒否されるまで進めた試行を返す。
function throughHeldPresented() {
  const ctx = throughFreshBPresented();
  const outcome = ctx.session.recordHeldBVerifyOnly(ctx.trialId, ctx.generation, {
    status: 403,
    error: "not_operator",
    generation: null,
  });
  assert.equal(outcome.matched, true);
  return ctx;
}

test("固定値：失効の対象世代・期待世代・パス・タイミング定数", () => {
  assert.equal(REVOKE_ACTION, "revoke");
  assert.equal(REVOKE_PATH, "/admin/registry/revoke");
  assert.equal(VERIFY_ONLY_PATH, "/admin/verify-only");
  assert.equal(REVOKE_EXPECTED_GENERATION, 4);
  assert.equal(EXPECTED_REVOKE_FINAL_GENERATION, 5);
  assert.equal(EXPECTED_NOT_OPERATOR_RESPONSE.status, 403);
  assert.equal(EXPECTED_NOT_OPERATOR_RESPONSE.error, "not_operator");
  assert.deepEqual([...S12_SLOTS], ["heldB", "revokeA", "freshB", "checkC"]);
  assert.equal(S12_NONCE_TTL_MS, 5 * 60 * 1000);
  assert.equal(SLOT_SEND_WINDOW_MS, 4 * 60 * 1000);
  assert.equal(POST_REVOKE_RESERVE_MS, 2 * 60 * 1000);
  assert.equal(HELD_MAX_AGE_AT_REVOKE_MS, SLOT_SEND_WINDOW_MS - POST_REVOKE_RESERVE_MS);
  assert.equal(HELD_MAX_AGE_AT_REVOKE_MS, 120000);
  assert.ok(S12_TOKEN_ERASE_TRIGGERS.includes("revoke-sent"));
  assert.ok(S12_TOKEN_ERASE_TRIGGERS.includes("held-presented"));
  assert.ok(S12_TOKEN_ERASE_TRIGGERS.includes("s12-completed"));
  assert.ok(S12_TOKEN_ERASE_TRIGGERS.includes("s12-halted"));
});

test("保持トークンの鮮度：境界と残り時間", () => {
  const issuedAt = 10000;
  const at0 = heldTokenFreshness(issuedAt, issuedAt);
  assert.equal(at0.ageMs, 0);
  assert.equal(at0.remainingMs, SLOT_SEND_WINDOW_MS);
  assert.equal(at0.enoughForRevoke, true);
  assert.equal(at0.withinWindow, true);
  // ちょうど上限（2分）では失効を送れる。
  const atBoundary = heldTokenFreshness(issuedAt, issuedAt + HELD_MAX_AGE_AT_REVOKE_MS);
  assert.equal(atBoundary.enoughForRevoke, true);
  assert.equal(atBoundary.remainingMs, POST_REVOKE_RESERVE_MS);
  // 上限を1ms過ぎたら送れない。
  const pastBoundary = heldTokenFreshness(issuedAt, issuedAt + HELD_MAX_AGE_AT_REVOKE_MS + 1);
  assert.equal(pastBoundary.enoughForRevoke, false);
  // 送信窓の終わりでは残り0で窓の外。
  const atWindowEnd = heldTokenFreshness(issuedAt, issuedAt + SLOT_SEND_WINDOW_MS);
  assert.equal(atWindowEnd.remainingMs, 0);
  assert.equal(atWindowEnd.withinWindow, false);
  assertCode(() => heldTokenFreshness(NaN, 0), "bad_trial_input");
});

test("正常系：全手順が固定順に進み completed になる", () => {
  const { session, trialId, generation } = throughHeldPresented();
  assert.equal(session.snapshot().phase, "heldb-presented");
  captureC(session, trialId, generation);
  const outcome = session.recordCVerifyOnly(trialId, generation, {
    status: 200,
    error: null,
    generation: 5,
  });
  assert.equal(outcome.matched, true);
  const snap = session.snapshot();
  assert.equal(snap.phase, "completed");
  assert.equal(snap.heldCaptured, true);
  assert.equal(snap.authorizerCaptured, true);
  assert.equal(snap.revokeFrozen, true);
  assert.equal(snap.freshBCaptured, true);
  assert.equal(snap.cCaptured, true);
  assert.equal(snap.undetermined, false);
});

test("凍結内容：対象は保持した B、期待世代は固定値 4", () => {
  const session = createS12Session();
  const { trialId, generation } = session.beginTrial();
  captureHeldB(session, trialId, generation);
  captureA(session, trialId, generation);
  const frozen = session.freezeRevokeRequest(trialId, generation, 3000);
  assert.equal(frozen.action, "revoke");
  assert.equal(frozen.targetSubjectHash, HASH_B);
  assert.equal(frozen.expectedGeneration, 4);
  assert.equal(frozen.path, "/admin/registry/revoke");
  const display = session.revokeDisplayData(trialId, generation);
  assert.equal(display.action, frozen.action);
  assert.equal(display.targetSubjectHash, frozen.targetSubjectHash);
  assert.equal(display.expectedGeneration, frozen.expectedGeneration);
  assert.equal(display.path, frozen.path);
  assert.ok(Object.isFrozen(frozen));
  assert.ok(Object.isFrozen(display));
});

test("順序違反：保持トークン取得より前に認可・凍結はできない", () => {
  const session = createS12Session();
  const { trialId, generation } = session.beginTrial();
  assertCode(
    () => session.markAuthorizerCaptured(trialId, generation, { subjectHash: HASH_A, verified: VERIFIED }),
    "trial_order"
  );
  assertCode(() => session.freezeRevokeRequest(trialId, generation, 1000), "trial_order");
  assertCode(
    () => session.recordRevokeSend(trialId, generation, { status: 200, error: null, generation: 5 }),
    "trial_order"
  );
});

test("順序違反（負の分岐）：保持トークンは失効より前に提示できない", () => {
  const session = createS12Session();
  const { trialId, generation } = session.beginTrial();
  captureHeldB(session, trialId, generation);
  // 保持直後（失効前）。
  assertCode(
    () => session.recordHeldBVerifyOnly(trialId, generation, { status: 403, error: "not_operator" }),
    "trial_order"
  );
  captureA(session, trialId, generation);
  session.freezeRevokeRequest(trialId, generation, 3000);
  // 凍結後・送信前でも提示できない。
  assertCode(
    () => session.recordHeldBVerifyOnly(trialId, generation, { status: 403, error: "not_operator" }),
    "trial_order"
  );
  session.recordRevokeSend(trialId, generation, { status: 200, error: null, generation: 5 });
  // 失効後でも、手順3（新しい B の提示）より前には提示できない。
  assertCode(
    () => session.recordHeldBVerifyOnly(trialId, generation, { status: 403, error: "not_operator" }),
    "trial_order"
  );
});

test("鮮度不足：凍結時に保持トークンが古ければ s12_held_token_stale で停止", () => {
  const session = createS12Session();
  const { trialId, generation } = session.beginTrial();
  captureHeldB(session, trialId, generation, 1000);
  captureA(session, trialId, generation, 2000);
  assertCode(
    () => session.freezeRevokeRequest(trialId, generation, 1000 + HELD_MAX_AGE_AT_REVOKE_MS + 1),
    "s12_held_token_stale"
  );
  assert.equal(session.snapshot().phase, "halted");
  assert.equal(session.snapshot().undetermined, false);
});

test("鮮度境界：ちょうど上限の凍結は通り、送信可否は時刻で変わる", () => {
  const session = createS12Session();
  const { trialId, generation } = session.beginTrial();
  captureHeldB(session, trialId, generation, 1000);
  captureA(session, trialId, generation, 2000);
  session.freezeRevokeRequest(trialId, generation, 1000 + HELD_MAX_AGE_AT_REVOKE_MS);
  assert.equal(session.canSendRevoke(trialId, generation, 1000 + HELD_MAX_AGE_AT_REVOKE_MS), true);
  assert.equal(session.canSendRevoke(trialId, generation, 1000 + HELD_MAX_AGE_AT_REVOKE_MS + 1), false);
  // 鮮度は保持トークンの発行開始時刻（1000）で測る。
  const fresh = session.heldFreshness(trialId, generation, 61000);
  assert.equal(fresh.ageMs, 60000);
});

test("機械確認：認可者が B と同一なら wrong_authorizer で停止", () => {
  const session = createS12Session();
  const { trialId, generation } = session.beginTrial();
  captureHeldB(session, trialId, generation);
  assertCode(() => captureA(session, trialId, generation, 2000, HASH_B), "wrong_authorizer");
  assert.equal(session.snapshot().phase, "halted");
});

test("機械確認：新しい B が失効対象と異なれば subject_mismatch で停止", () => {
  const { session, trialId, generation } = throughRevokeSent();
  assertCode(() => captureFreshB(session, trialId, generation, 4000, HASH_X), "subject_mismatch");
  assert.equal(session.snapshot().phase, "halted");
});

test("機械確認：C が A または B と同一なら wrong_subject で停止", () => {
  const ctxA = throughHeldPresented();
  assertCode(() => captureC(ctxA.session, ctxA.trialId, ctxA.generation, 6000, HASH_A), "wrong_subject");
  assert.equal(ctxA.session.snapshot().phase, "halted");
  const ctxB = throughHeldPresented();
  assertCode(() => captureC(ctxB.session, ctxB.trialId, ctxB.generation, 6000, HASH_B), "wrong_subject");
  assert.equal(ctxB.session.snapshot().phase, "halted");
});

test("失効の応答照合：期待外れと応答なしで停止し、再送できない", () => {
  // 409 stale_generation（世代不一致）は停止。
  const s1 = createS12Session();
  const t1 = s1.beginTrial();
  captureHeldB(s1, t1.trialId, t1.generation);
  captureA(s1, t1.trialId, t1.generation);
  s1.freezeRevokeRequest(t1.trialId, t1.generation, 3000);
  const o1 = s1.recordRevokeSend(t1.trialId, t1.generation, {
    status: 409,
    error: "stale_generation",
    generation: null,
  });
  assert.equal(o1.matched, false);
  assert.equal(o1.undetermined, false);
  assert.equal(s1.snapshot().phase, "halted");
  // 停止後は後段へ進めない。
  assertCode(
    () => s1.markFreshBCaptured(t1.trialId, t1.generation, { subjectHash: HASH_B, verified: VERIFIED }),
    "trial_order"
  );
  // 応答なしは状態未確定として停止。
  const s2 = createS12Session();
  const t2 = s2.beginTrial();
  captureHeldB(s2, t2.trialId, t2.generation);
  captureA(s2, t2.trialId, t2.generation);
  s2.freezeRevokeRequest(t2.trialId, t2.generation, 3000);
  const o2 = s2.recordRevokeSend(t2.trialId, t2.generation, null);
  assert.equal(o2.matched, false);
  assert.equal(o2.undetermined, true);
  assert.equal(s2.snapshot().phase, "halted");
  // 200 でも generation が 5 でなければ停止。
  const s3 = createS12Session();
  const t3 = s3.beginTrial();
  captureHeldB(s3, t3.trialId, t3.generation);
  captureA(s3, t3.trialId, t3.generation);
  s3.freezeRevokeRequest(t3.trialId, t3.generation, 3000);
  const o3 = s3.recordRevokeSend(t3.trialId, t3.generation, {
    status: 200,
    error: null,
    generation: 4,
  });
  assert.equal(o3.matched, false);
  assert.equal(s3.snapshot().phase, "halted");
});

test("失効の再送手段がない：送信記録は1回だけ", () => {
  const { session, trialId, generation } = throughRevokeSent();
  assertCode(
    () => session.recordRevokeSend(trialId, generation, { status: 200, error: null, generation: 5 }),
    "trial_order"
  );
});

test("手順3の応答照合：200 や応答なしでは停止する", () => {
  const ctx = throughRevokeSent();
  captureFreshB(ctx.session, ctx.trialId, ctx.generation);
  const o = ctx.session.recordFreshBVerifyOnly(ctx.trialId, ctx.generation, {
    status: 200,
    error: null,
    generation: 5,
  });
  assert.equal(o.matched, false);
  assert.equal(ctx.session.snapshot().phase, "halted");
  const ctx2 = throughRevokeSent();
  captureFreshB(ctx2.session, ctx2.trialId, ctx2.generation);
  const o2 = ctx2.session.recordFreshBVerifyOnly(ctx2.trialId, ctx2.generation, null);
  assert.equal(o2.undetermined, true);
  assert.equal(ctx2.session.snapshot().phase, "halted");
});

test("手順4の応答照合：失効前トークンが通ってしまったら停止する", () => {
  const ctx = throughFreshBPresented();
  const o = ctx.session.recordHeldBVerifyOnly(ctx.trialId, ctx.generation, {
    status: 200,
    error: null,
    generation: 5,
  });
  assert.equal(o.matched, false);
  assert.equal(ctx.session.snapshot().phase, "halted");
  const ctx2 = throughFreshBPresented();
  const o2 = ctx2.session.recordHeldBVerifyOnly(ctx2.trialId, ctx2.generation, null);
  assert.equal(o2.undetermined, true);
});

test("手順5の応答照合：403 では停止する", () => {
  const ctx = throughHeldPresented();
  captureC(ctx.session, ctx.trialId, ctx.generation);
  const o = ctx.session.recordCVerifyOnly(ctx.trialId, ctx.generation, {
    status: 403,
    error: "not_operator",
    generation: null,
  });
  assert.equal(o.matched, false);
  assert.equal(ctx.session.snapshot().phase, "halted");
});

test("nonce 取得：段階・二重取得・旧試行の応答破棄", () => {
  const session = createS12Session();
  const { trialId, generation } = session.beginTrial();
  // revokeA の nonce は start では取得できない。
  assertCode(() => session.beginNonceFetch(trialId, generation, "revokeA", 1000), "trial_order");
  session.beginNonceFetch(trialId, generation, "heldB", 1000);
  assert.equal(session.isNonceFetchPending(trialId, generation, "heldB"), true);
  assertCode(() => session.beginNonceFetch(trialId, generation, "heldB", 1100), "nonce_fetch_busy");
  const applied = session.finishNonceFetch(trialId, generation, "heldB", "nonce-heldB");
  assert.equal(applied.issuedAtMs, 1000);
  assert.equal(session.nonceIssuedAt(trialId, generation, "heldB"), 1000);
  assertCode(() => session.beginNonceFetch(trialId, generation, "heldB", 1200), "nonce_already_issued");
  // 捕捉は nonce 取得済みのときにだけ進む。
  session.markHeldBCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED });
  // 新しい試行では旧試行の応答は破棄される。
  const next = session.beginTrial();
  assert.equal(session.isCurrent(trialId, generation), false);
  assert.equal(session.finishNonceFetch(trialId, generation, "heldB", "nonce-old"), null);
  assertCode(() => session.nonceIssuedAt(trialId, generation, "heldB"), "stale_attempt");
  assert.ok(next.trialId);
});

test("捕捉の claim：同一試行・役割では1回だけ", () => {
  const session = createS12Session();
  const { trialId, generation } = session.beginTrial();
  assert.equal(session.isCallbackCurrent(trialId, generation, "heldB"), true);
  assert.equal(session.isCallbackCurrent(trialId, generation, "revokeA"), false);
  assert.equal(session.claimCallbackCapture(trialId, generation, "heldB"), true);
  assert.equal(session.claimCallbackCapture(trialId, generation, "heldB"), false);
  assert.equal(session.claimCallbackCapture(trialId, generation, "revokeA"), false);
});

test("検証不完全・形式不正の捕捉は拒否される", () => {
  const session = createS12Session();
  const { trialId, generation } = session.beginTrial();
  issue(session, trialId, generation, "heldB", 1000);
  assertCode(
    () =>
      session.markHeldBCaptured(trialId, generation, {
        subjectHash: HASH_B,
        verified: { signature: true, iss: true, aud: true, exp: true, nonce: false },
      }),
    "verification_incomplete"
  );
  assertCode(
    () => session.markHeldBCaptured(trialId, generation, { subjectHash: "zz", verified: VERIFIED }),
    "bad_trial_input"
  );
  // nonce 未取得の捕捉は段階エラー。
  const s2 = createS12Session();
  const t2 = s2.beginTrial();
  assertCode(
    () => s2.markHeldBCaptured(t2.trialId, t2.generation, { subjectHash: HASH_B, verified: VERIFIED }),
    "trial_order"
  );
});

test("要求ビルダー：凍結され、値は検証される", () => {
  const req = buildS12RevokeRequest({
    idToken: "token-a",
    subjectHash: HASH_B,
    expectedGeneration: 4,
  });
  assert.deepEqual(
    { ...req },
    { id_token: "token-a", subject_hash: HASH_B, expected_generation: 4 }
  );
  assert.ok(Object.isFrozen(req));
  assertCode(
    () => buildS12RevokeRequest({ idToken: "t", subjectHash: "nope", expectedGeneration: 4 }),
    "bad_trial_input"
  );
  assertCode(
    () => buildS12RevokeRequest({ idToken: "", subjectHash: HASH_B, expectedGeneration: 4 }),
    "bad_trial_input"
  );
  const vo = buildS12VerifyOnlyRequest({ idToken: "token-b" });
  assert.deepEqual({ ...vo }, { id_token: "token-b" });
  assert.deepEqual(Object.keys(vo), ["id_token"]);
  assert.ok(Object.isFrozen(vo));
});

test("ログ記録：秘密を含まず、理由コードだけが残る", () => {
  const entry = makeS12LogEntry({
    trialId: "trial-1",
    step: "revoke-sent",
    response: { status: 200, error: null, generation: 5 },
  });
  assert.deepEqual(
    { ...entry, response: { ...entry.response } },
    { trial_id: "trial-1", step: "revoke-sent", response: { status: 200, error: null, generation: 5 } }
  );
  const refused = makeS12LogEntry({
    trialId: "trial-1",
    step: "heldb-presented",
    response: { status: 403, error: "not_operator", generation: null },
  });
  assert.equal(refused.response.error, "not_operator");
  const unknown = makeS12LogEntry({
    trialId: "trial-1",
    step: "revoke-sent",
    response: { status: 500, error: "some_internal_detail", generation: null },
  });
  assert.equal(unknown.response.error, "unexpected_error");
  const noResp = makeS12LogEntry({
    trialId: "trial-1",
    step: "revoke-sent",
    response: { status: 0, error: "no_response", generation: null },
  });
  assert.equal(noResp.response.error, "no_response");
  const json = JSON.stringify([entry, refused, unknown]);
  assert.ok(!json.includes(HASH_B));
  assert.ok(!json.includes("token"));
  assertCode(
    () => makeS12LogEntry({ trialId: "t", step: "bogus", response: { status: 200 } }),
    "bad_trial_input"
  );
});

test("破棄：現行試行だけが無効化され、旧試行の操作は stale_attempt", () => {
  const session = createS12Session();
  const { trialId, generation } = session.beginTrial();
  assert.equal(session.discard("other", generation), false);
  assert.equal(session.discard(trialId, generation), true);
  assert.equal(session.snapshot(), null);
  assertCode(
    () => session.markHeldBCaptured(trialId, generation, { subjectHash: HASH_B, verified: VERIFIED }),
    "stale_attempt"
  );
  assert.equal(session.discard(trialId, generation), false);
});
