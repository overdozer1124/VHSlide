// S15 ガード試験（項目7 手順1：応答破棄を伴う全面復旧、
// ローカル模擬）。
// 実行: node --test test/s15-guard.test.mjs
// （npm run test:s15-guard でも実行できる）
//
// 目的：S15 の手順を、実際のプラットフォームビルド／通常
// ビルド（ローカル模擬）と実際の状態機械・送信器
// （tools/s15-apply.mjs、tools/s15-sender.mjs）で通し、次を
// 確認する。
// - 開始状態は generation 7・登録簿 {B}・consumed=2・
//   completion=2 であり、プラットフォーム経路の bootstrap
//   （世代1）と full-replace（世代2）と、管理ルートの追加
//   （世代3 で B、世代4 で C）と失効（世代5 で B、世代6 で
//   C）とローテーション A→B（世代7）で作る（S14 の終了状態
//   と同じ作り方で、消費済みの操作は #1・#3 の形）。
// - committed の分岐：操作 #5 のプラットフォームビルドへの
//   破棄送信（応答は読まない）→ 独立した読み戻し
//   （/platform/inspect）で committed と判定されること
//   （generation 8・登録簿 {B}・consumed が {#1,#3,#5}・
//   completion 3、B の行の added_by が platform:<操作#5> で
//   あること）。判定の前は次の送信が両層で拒否されること。
//   committed の後は送信手段がないこと。最後に通常ビルドへ
//   戻して読み戻し、通常版復帰の記録で closed になること。
// - uncommitted の分岐：期限切れの承認を持つビルドへの破棄
//   送信はコミットせず、読み戻しは開始状態と完全一致して
//   未成立と判定されること。再実施のゲートが開き、新しい
//   一回値・同じ操作ID の再実施が committed になること。
// - 枯渇の分岐：3回とも未成立なら uncommitted-final になり、
//   4回目の送信は両層で拒否されること。その場合も通常版
//   復帰の記録で closed になること。
//
// 送信器はシナリオごとに固定ポートへ結び付け、ビルドの
// 差し替え（プラットフォーム→通常）をまたいでも同じ送信器
// が使えるようにする。実 Google・実 Cloudflare には接続
// しない。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeDirWithRetry } from "./teardown-helper.mjs";
import { createS15Sender } from "../tools/s15-sender.mjs";
import {
  createS15Session,
  buildS15ApplyRequest,
  normalizeS15Snapshot,
} from "../tools/s15-apply.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "http://localhost:8787";
const ENV_ID = "stage1-phase2-verification-local";
const CLIENT_ID = "dummy-client-id.apps.googleusercontent.com";
const DIAG_KEY = "test-diag-key";
const ISS = "https://accounts.google.com";

const SUB_A = "operator-subject-alpha";
const SUB_B = "operator-subject-beta";
const SUB_C = "operator-subject-gamma";
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const HASH_A = sha256(SUB_A);
const HASH_B = sha256(SUB_B);
const HASH_C = sha256(SUB_C);

const OP_G1 = "op-s15-guard-001";
const OP_G3 = "op-s15-guard-003";
const OP5 = "op-s15-guard-005";
const VERIFIED = { signature: true, iss: true, aud: true, exp: true, nonce: true };

const COMMON_BINDINGS = {
  DEPLOYMENT_TIER: "local-mock",
  MOCK_AUTH: "1",
  ALLOW_TEST_HOOKS: "1",
  GOOGLE_CLIENT_ID: CLIENT_ID,
  ENV_ID,
  DIAG_KEY,
};

const FUTURE = () => Date.now() + 10 * 60 * 1000;
const PAST = () => Date.now() - 60 * 1000;

function approvalBindings({ operationId, purpose, subjectHash, oneTime, expiresAtMs }) {
  return {
    APPROVAL_ENV_ID: ENV_ID,
    APPROVAL_PURPOSE: purpose,
    APPROVAL_SUBJECT_HASH: subjectHash,
    APPROVAL_EXPIRES_AT: String(expiresAtMs),
    APPROVAL_ONE_TIME: oneTime,
    APPROVAL_OPERATION_ID: operationId,
  };
}

async function startBuild(scriptName, persistName, port, extraBindings = {}) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: path.join(ROOT, "src", scriptName),
    compatibilityDate: "2025-01-01",
    port,
    durableObjects: { REGISTRY: { className: "RegistryDO", useSQLite: true } },
    durableObjectsPersist: path.join(ROOT, persistName),
    bindings: Object.fromEntries(
      Object.entries({ ...COMMON_BINDINGS, ...extraBindings }).filter(([, v]) => v !== undefined)
    ),
  });
  const url = await mf.ready;
  return { mf, base: url.toString().replace(/\/$/, "") };
}

async function call(base, method, p, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.origin !== null) headers["Origin"] = opts.origin || ORIGIN;
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  if (opts.diag) headers["X-Diag-Key"] = DIAG_KEY;
  let body;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(base + p, { method, headers, body });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

async function issueNonceDirect(base) {
  const r = await call(base, "GET", "/nonce", { origin: null });
  if (r.status !== 200 || !r.json || !r.json.nonce) {
    throw new Error(`nonce issuance failed: status=${r.status}`);
  }
  const setCookie = r.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  return { nonce: r.json.nonce, cookie };
}

function mockToken(sub, nonce) {
  const exp = String(Math.floor(Date.now() / 1000) + 600);
  return `mockop|${sub}|${nonce}|${ISS}|${CLIENT_ID}|${exp}`;
}

async function doDirect(mf, pathName, payload) {
  const ns = await mf.getDurableObjectNamespace("REGISTRY");
  const stub = ns.get(ns.idFromName("registry:" + ENV_ID));
  const res = await stub.fetch("https://registry.internal" + pathName, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function platformApplyDirect(mf, sub, body) {
  const n = await doDirect(mf, "/do/nonce", {});
  if (n.status !== 200 || !n.json || !n.json.nonce) {
    throw new Error(`direct nonce issuance failed: status=${n.status}`);
  }
  return doDirect(mf, "/do/apply", {
    body: { ...body, id_token: mockToken(sub, n.json.nonce) },
    ctx: n.json.ctx,
  });
}

// 読み戻しはビルドの種別によらず DO の snapshot の形で返す。
async function readStateOn(build, kind) {
  if (kind === "platform") {
    const r = await call(build.base, "GET", "/platform/inspect", { diag: true, origin: null });
    assert.equal(r.status, 200, `inspect failed: ${JSON.stringify(r.json)}`);
    return r.json;
  }
  const r = await call(build.base, "GET", "/test/registry", { diag: true, origin: null });
  assert.equal(r.status, 200, `registry read failed: ${JSON.stringify(r.json)}`);
  return r.json;
}

function operatorHashes(state) {
  return (state.operators || []).map((o) => o.subject_hash).sort();
}

async function adminCall(base, route, targetHash, expectedGeneration) {
  const { nonce, cookie } = await issueNonceDirect(base);
  const r = await call(base, "POST", route, {
    body: {
      id_token: mockToken(SUB_A, nonce),
      subject_hash: targetHash,
      expected_generation: expectedGeneration,
    },
    cookie,
  });
  assert.equal(r.status, 200, `${route} failed: ${JSON.stringify(r.json)}`);
  return r.json.generation;
}

async function adminRotate(base, expectedGeneration) {
  const { nonce, cookie } = await issueNonceDirect(base);
  const r = await call(base, "POST", "/admin/registry/rotate", {
    body: {
      id_token: mockToken(SUB_A, nonce),
      old_subject_hash: HASH_A,
      new_subject_hash: HASH_B,
      expected_generation: expectedGeneration,
    },
    cookie,
  });
  assert.equal(r.status, 200, `rotate failed: ${JSON.stringify(r.json)}`);
  return r.json.generation;
}

// S15 の開始状態（generation 7・{B}・consumed {#1,#3}・
// completion 2）を、確立済みの経路で作る。各ビルドは dispose
// を finally で行い、途中の失敗で workerd を残さない。
async function buildStartState(persist, port) {
  await removeDirWithRetry(path.join(ROOT, persist));
  let platform = await startBuild("platform-worker.js", persist, port, approvalBindings({
    operationId: OP_G1,
    purpose: "bootstrap",
    subjectHash: HASH_A,
    oneTime: "one-time-s15-guard-001",
    expiresAtMs: FUTURE(),
  }));
  try {
    const r = await platformApplyDirect(platform.mf, SUB_A, {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-s15-guard-001",
    });
    assert.equal(r.status, 201, `bootstrap failed: ${JSON.stringify(r.json)}`);
  } finally {
    await platform.mf.dispose();
  }
  platform = await startBuild("platform-worker.js", persist, port, approvalBindings({
    operationId: OP_G3,
    purpose: "full-replace",
    subjectHash: HASH_A,
    oneTime: "one-time-s15-guard-003",
    expiresAtMs: FUTURE(),
  }));
  try {
    const r = await platformApplyDirect(platform.mf, SUB_A, {
      purpose: "full-replace",
      env_id: ENV_ID,
      one_time_value: "one-time-s15-guard-003",
    });
    assert.equal(r.status, 201, `full-replace failed: ${JSON.stringify(r.json)}`);
  } finally {
    await platform.mf.dispose();
  }
  const normal = await startBuild("worker.js", persist, port);
  try {
    assert.equal(await adminCall(normal.base, "/admin/registry/add", HASH_B, 2), 3);
    assert.equal(await adminCall(normal.base, "/admin/registry/add", HASH_C, 3), 4);
    assert.equal(await adminCall(normal.base, "/admin/registry/revoke", HASH_B, 4), 5);
    assert.equal(await adminCall(normal.base, "/admin/registry/revoke", HASH_C, 5), 6);
    assert.equal(await adminRotate(normal.base, 6), 7);
    const state = await readStateOn(normal, "normal");
    assert.equal(state.generation, 7);
    assert.deepEqual(operatorHashes(state), [HASH_B]);
    assert.deepEqual(
      state.consumed_ops.map((c) => c.operation_id).sort(),
      [OP_G1, OP_G3].sort()
    );
    assert.equal(state.completion.length, 2);
  } finally {
    await normal.mf.dispose();
  }
}

// 状態機械側の取得を記録する（対象・試行）。実画面では実
// ログインの検証結果が入る場所であり、ガード試験では模擬の
// 検証済みとして記録する（S14 ガード試験と同じ流儀）。
function captureOnSession(session, trialId, generation, role, subjectHash) {
  const atMs = Date.now();
  session.beginNonceFetch(trialId, generation, role, atMs);
  session.finishNonceFetch(trialId, generation, role, `guard-nonce-${role}`);
  if (role === "target") {
    session.markTargetCaptured(trialId, generation, { subjectHash, verified: VERIFIED });
  } else {
    session.markAttemptCaptured(trialId, generation, { subjectHash, verified: VERIFIED });
  }
}

// 1回の試行を、送信器と状態機械の両方で破棄送信まで進める。
// 戻り値は破棄記録そのものである。
async function discardAttempt({ session, sender, trialId, generation, attempt, oneTimeValue }) {
  captureOnSession(session, trialId, generation, `attempt${attempt}`, HASH_B);
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
  const result = await sender.sendDiscard({
    trialId,
    attempt,
    request: buildS15ApplyRequest({
      idToken: mockToken(SUB_B, issued.nonce),
      oneTimeValue,
      envId: ENV_ID,
    }),
  });
  assert.deepEqual({ ...result }, { sent: true, outcome: "discarded" });
  session.recordSendDiscard(trialId, generation, result);
  return result;
}

function newTrial() {
  const session = createS15Session();
  const { trialId, generation } = session.beginTrial({
    operationId: OP5,
    envId: ENV_ID,
    startConsumedOperationIds: [OP_G1, OP_G3],
  });
  captureOnSession(session, trialId, generation, "target", HASH_B);
  session.freezeApproval(trialId, generation);
  return { session, trialId, generation };
}

function assertCode(fn, code) {
  assert.throws(fn, (e) => e && e.code === code);
}
function assertCodeAsync(promise, code) {
  return assert.rejects(promise, (e) => e && e.code === code);
}

test("S15ガード（committed）：破棄送信→読み戻しで committed→通常版復帰の記録で closed", async () => {
  const persist = `.persist-s15-guard-a-${process.pid}`;
  const port = 8941;
  await buildStartState(persist, port);
  const base = `http://127.0.0.1:${port}`;
  const sender = createS15Sender({ relayUrl: base });
  let platform = null;
  let normal = null;
  try {
    platform = await startBuild("platform-worker.js", persist, port, approvalBindings({
      operationId: OP5,
      purpose: "full-replace",
      subjectHash: HASH_B,
      oneTime: "one-time-s15-guard-005-a",
      expiresAtMs: FUTURE(),
    }));
    const { session, trialId, generation } = newTrial();
    sender.beginTrial(trialId);
    await discardAttempt({
      session, sender, trialId, generation, attempt: 1, oneTimeValue: "one-time-s15-guard-005-a",
    });
    // 未確定の間は、次の試行が両層で拒否される。
    assertCode(() => session.beginNonceFetch(trialId, generation, "attempt2", Date.now()), "trial_order");
    await assertCodeAsync(sender.issueNonce({ trialId, attempt: 2 }), "s15_attempt_gate");
    // 判定は独立した読み戻しだけによる。
    const readBack = await readStateOn(platform, "platform");
    const normalized = normalizeS15Snapshot(readBack);
    assert.equal(normalized.generation, 8);
    assert.deepEqual([...normalized.operatorHashes], [HASH_B]);
    assert.deepEqual([...normalized.consumedOperationIds].sort(), [OP_G1, OP_G3, OP5].sort());
    assert.equal(normalized.completionCount, 3);
    // 同値置換でも B の行はプラットフォーム経路で書き直される。
    assert.equal(readBack.operators[0].added_by, `platform:${OP5}`);
    const j = session.recordReadBackJudgment(trialId, generation, readBack);
    assert.equal(j.outcome, "committed");
    sender.recordJudgment({ trialId, attempt: 1, outcome: j.outcome });
    // committed の後は送信手段がない。
    assertCode(() => session.beginNonceFetch(trialId, generation, "attempt2", Date.now()), "s15_already_committed");
    await assertCodeAsync(sender.issueNonce({ trialId, attempt: 2 }), "s15_already_committed");
    await platform.mf.dispose();
    platform = null;
    // 締め：通常ビルドへ戻し、状態を読み戻してから復帰を記録する。
    normal = await startBuild("worker.js", persist, port);
    const finalState = await readStateOn(normal, "normal");
    assert.equal(finalState.generation, 8);
    assert.deepEqual(operatorHashes(finalState), [HASH_B]);
    const closed = session.recordNormalRestored(trialId, generation, {
      versionVerified: true,
      bindingsVerified: true,
    });
    assert.equal(closed.state, "closed");
    assert.equal(session.snapshot().closed, true);
  } finally {
    if (platform) await platform.mf.dispose();
    if (normal) await normal.mf.dispose();
    await removeDirWithRetry(path.join(ROOT, persist));
  }
});

test("S15ガード（uncommitted→再実施）：期限切れの承認は未成立となり、新しい一回値の再実施が committed になる", async () => {
  const persist = `.persist-s15-guard-b-${process.pid}`;
  const port = 8942;
  await buildStartState(persist, port);
  const base = `http://127.0.0.1:${port}`;
  const sender = createS15Sender({ relayUrl: base });
  let build = null;
  try {
    // 試行1：承認の期限が切れたビルド。送信は完了するが、
    // DO は期限切れで書き込まない。
    build = await startBuild("platform-worker.js", persist, port, approvalBindings({
      operationId: OP5,
      purpose: "full-replace",
      subjectHash: HASH_B,
      oneTime: "one-time-s15-guard-005-b1",
      expiresAtMs: PAST(),
    }));
    const { session, trialId, generation } = newTrial();
    sender.beginTrial(trialId);
    await discardAttempt({
      session, sender, trialId, generation, attempt: 1, oneTimeValue: "one-time-s15-guard-005-b1",
    });
    const readBack1 = await readStateOn(build, "platform");
    const j1 = session.recordReadBackJudgment(trialId, generation, readBack1);
    assert.equal(j1.outcome, "uncommitted");
    assert.equal(j1.uncommittedJudgments, 1);
    sender.recordJudgment({ trialId, attempt: 1, outcome: j1.outcome });
    await build.mf.dispose();
    build = null;
    // 試行2（再実施）：同じ操作ID・新しい一回値・有効な期限の
    // ビルドへ差し替えて送る。
    build = await startBuild("platform-worker.js", persist, port, approvalBindings({
      operationId: OP5,
      purpose: "full-replace",
      subjectHash: HASH_B,
      oneTime: "one-time-s15-guard-005-b2",
      expiresAtMs: FUTURE(),
    }));
    await discardAttempt({
      session, sender, trialId, generation, attempt: 2, oneTimeValue: "one-time-s15-guard-005-b2",
    });
    const readBack2 = await readStateOn(build, "platform");
    const j2 = session.recordReadBackJudgment(trialId, generation, readBack2);
    assert.equal(j2.outcome, "committed");
    assert.equal(j2.attempt, 2);
    sender.recordJudgment({ trialId, attempt: 2, outcome: j2.outcome });
    const snap = session.snapshot();
    assert.equal(snap.sendCount, 2);
    assert.equal(snap.reattemptsUsed, 1);
    await build.mf.dispose();
    build = null;
    // 締め：通常ビルドへ戻して読み戻し、復帰を記録する。
    build = await startBuild("worker.js", persist, port);
    const finalState = await readStateOn(build, "normal");
    assert.equal(finalState.generation, 8);
    assert.deepEqual(operatorHashes(finalState), [HASH_B]);
    const closed = session.recordNormalRestored(trialId, generation, {
      versionVerified: true,
      bindingsVerified: true,
    });
    assert.equal(closed.state, "closed");
  } finally {
    if (build) await build.mf.dispose();
    await removeDirWithRetry(path.join(ROOT, persist));
  }
});

test("S15ガード（枯渇）：3回とも未成立なら締まり、4回目は両層で拒否される", async () => {
  const persist = `.persist-s15-guard-d-${process.pid}`;
  const port = 8943;
  await buildStartState(persist, port);
  const base = `http://127.0.0.1:${port}`;
  const sender = createS15Sender({ relayUrl: base });
  let build = null;
  try {
    build = await startBuild("platform-worker.js", persist, port, approvalBindings({
      operationId: OP5,
      purpose: "full-replace",
      subjectHash: HASH_B,
      oneTime: "one-time-s15-guard-005-d",
      expiresAtMs: PAST(),
    }));
    const { session, trialId, generation } = newTrial();
    sender.beginTrial(trialId);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await discardAttempt({
        session, sender, trialId, generation, attempt, oneTimeValue: "one-time-s15-guard-005-d",
      });
      const readBack = await readStateOn(build, "platform");
      const j = session.recordReadBackJudgment(trialId, generation, readBack);
      assert.equal(j.outcome, "uncommitted");
      sender.recordJudgment({ trialId, attempt, outcome: j.outcome });
    }
    const snap = session.snapshot();
    assert.equal(snap.phase, "uncommitted-final");
    assert.equal(snap.sendCount, 3);
    assert.equal(snap.reattemptsUsed, 2);
    assert.equal(snap.uncommittedJudgments, 3);
    // 4回目の送信は両層で拒否される。
    assertCode(() => session.beginNonceFetch(trialId, generation, "attempt3", Date.now()), "s15_attempts_exhausted");
    await assertCodeAsync(sender.issueNonce({ trialId, attempt: 3 }), "s15_attempt_gate");
    await build.mf.dispose();
    build = null;
    // 未成立で締まった場合も、締めは通常版復帰の記録である。
    build = await startBuild("worker.js", persist, port);
    const finalState = await readStateOn(build, "normal");
    assert.equal(finalState.generation, 7);
    assert.deepEqual(operatorHashes(finalState), [HASH_B]);
    const closed = session.recordNormalRestored(trialId, generation, {
      versionVerified: true,
      bindingsVerified: true,
    });
    assert.equal(closed.state, "closed");
  } finally {
    if (build) await build.mf.dispose();
    await removeDirWithRetry(path.join(ROOT, persist));
  }
});
