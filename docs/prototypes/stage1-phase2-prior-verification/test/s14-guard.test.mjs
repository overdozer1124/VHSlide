// S14 ガード試験（項目6 手順7：ローテーション A→B、ローカル模擬）。
// 実行: node --test test/s14-guard.test.mjs
// （npm run test:s14-guard でも実行できる）
//
// 目的：S14 の手順を、実際の通常ビルド（ローカル模擬）と実際の
// 送信器（tools/s14-sender.mjs）で通し、次を確認する。
// - 開始状態は S14 の開始前（generation 6・登録簿 {A}・
//   consumed=2・completion=2）であり、プラットフォーム経路の
//   bootstrap（世代1）と full-replace（世代2）と、管理ルートの
//   追加（世代3 で B、世代4 で C）と失効（世代5 で B、世代6 で
//   C）で作る（S13 の終了状態と同じ作り方）。
// - 負の分岐：ローテーションを誤った期待世代で送るとサーバー
//   が 409 stale_generation で拒否すること。旧主体が不在の
//   ローテーションは 404 target_not_member、新主体が既に在籍
//   するローテーションは 409 already_member で拒否され、いず
//   れも状態が変わらないこと（実ビルドのローテーションの対象
//   照合の順序どおり）。
// - 本手順：A の認可で A→B のローテーション（200 ok・
//   generation 7・登録簿 {B}。削除＋追加が同一トランザクション）
//   → A の verify-only が 403 not_operator で拒否されること
//   （この拒否が合格）→ B の verify-only が 200 ok。最終状態
//   は generation 7・登録簿 {B}・consumed=2・completion=2 で
//   あること。
// - 送信済みのスロットは再送できないこと。結び付けが外れた
//   要求は実 Worker へ1件も送られずに拒否されること。
//
// 状態機械側の順序強制（手順2が手順1より前に送れないこと等）は
// test/s14-rotate.test.mjs で確認する。実 Google・実 Cloudflare
// には接続しない。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createS14Sender } from "../tools/s14-sender.mjs";
import {
  buildS14RotateRequest,
  buildS14VerifyOnlyRequest,
} from "../tools/s14-rotate.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "http://localhost:8787";
const ENV_ID = "stage1-phase2-verification-local";
const CLIENT_ID = "dummy-client-id.apps.googleusercontent.com";
const DIAG_KEY = "test-diag-key";
const ISS = "https://accounts.google.com";
const PERSIST = ".persist-s14-guard";

const SUB_A = "operator-subject-alpha";
const SUB_B = "operator-subject-beta";
const SUB_C = "operator-subject-gamma";
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const HASH_A = sha256(SUB_A);
const HASH_B = sha256(SUB_B);
const HASH_C = sha256(SUB_C);

const COMMON_BINDINGS = {
  DEPLOYMENT_TIER: "local-mock",
  MOCK_AUTH: "1",
  ALLOW_TEST_HOOKS: "1",
  GOOGLE_CLIENT_ID: CLIENT_ID,
  ENV_ID,
  DIAG_KEY,
};

const FUTURE = () => Date.now() + 10 * 60 * 1000;

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

async function startBuild(scriptName, persistName, extraBindings = {}) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: path.join(ROOT, "src", scriptName),
    compatibilityDate: "2025-01-01",
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

async function platformApplyDirect(mf, sub, body, extraBody = {}) {
  const n = await doDirect(mf, "/do/nonce", {});
  if (n.status !== 200 || !n.json || !n.json.nonce) {
    throw new Error(`direct nonce issuance failed: status=${n.status}`);
  }
  return doDirect(mf, "/do/apply", {
    body: { ...body, id_token: mockToken(sub, n.json.nonce), ...extraBody },
    ctx: n.json.ctx,
  });
}

async function readRegistry(base) {
  const r = await call(base, "GET", "/test/registry", { diag: true, origin: null });
  return r.json;
}

function operatorHashes(state) {
  return (state.operators || []).map((o) => o.subject_hash).sort();
}

async function adminAdd(base, targetHash, expectedGeneration) {
  const { nonce, cookie } = await issueNonceDirect(base);
  const add = await call(base, "POST", "/admin/registry/add", {
    body: {
      id_token: mockToken(SUB_A, nonce),
      subject_hash: targetHash,
      expected_generation: expectedGeneration,
    },
    cookie,
  });
  assert.equal(add.status, 200, `add failed: ${JSON.stringify(add.json)}`);
  return add.json.generation;
}

async function adminRevoke(base, targetHash, expectedGeneration) {
  const { nonce, cookie } = await issueNonceDirect(base);
  const revoke = await call(base, "POST", "/admin/registry/revoke", {
    body: {
      id_token: mockToken(SUB_A, nonce),
      subject_hash: targetHash,
      expected_generation: expectedGeneration,
    },
    cookie,
  });
  assert.equal(revoke.status, 200, `revoke failed: ${JSON.stringify(revoke.json)}`);
  return revoke.json.generation;
}

async function adminRotateDirect(base, oldHash, newHash, expectedGeneration) {
  const { nonce, cookie } = await issueNonceDirect(base);
  return call(base, "POST", "/admin/registry/rotate", {
    body: {
      id_token: mockToken(SUB_A, nonce),
      old_subject_hash: oldHash,
      new_subject_hash: newHash,
      expected_generation: expectedGeneration,
    },
    cookie,
  });
}

let normal = null;
let sender = null;

before(async () => {
  rmSync(path.join(ROOT, PERSIST), { recursive: true, force: true });
  // bootstrap：generation 1・登録簿 {A}。
  let platform = await startBuild("platform-worker.js", PERSIST, approvalBindings({
    operationId: "op-s14-guard-001",
    purpose: "bootstrap",
    subjectHash: HASH_A,
    oneTime: "one-time-s14-guard-001",
    expiresAtMs: FUTURE(),
  }));
  let r = await platformApplyDirect(platform.mf, SUB_A, {
    purpose: "bootstrap",
    env_id: ENV_ID,
    one_time_value: "one-time-s14-guard-001",
  });
  assert.equal(r.status, 201, `bootstrap failed: ${JSON.stringify(r.json)}`);
  await platform.mf.dispose();
  // full-replace：generation 2・登録簿 {A}。
  platform = await startBuild("platform-worker.js", PERSIST, approvalBindings({
    operationId: "op-s14-guard-002",
    purpose: "full-replace",
    subjectHash: HASH_A,
    oneTime: "one-time-s14-guard-002",
    expiresAtMs: FUTURE(),
  }));
  r = await platformApplyDirect(platform.mf, SUB_A, {
    purpose: "full-replace",
    env_id: ENV_ID,
    one_time_value: "one-time-s14-guard-002",
  });
  assert.equal(r.status, 201, `full-replace failed: ${JSON.stringify(r.json)}`);
  await platform.mf.dispose();
  // 通常ビルドで B を追加（世代3）、C を追加（世代4）、B を失効
  // （世代5）、C を失効（世代6）して、S14 の開始状態（世代6・
  // {A}）を作る（S13 の終了状態と同じ）。
  normal = await startBuild("worker.js", PERSIST);
  assert.equal(await adminAdd(normal.base, HASH_B, 2), 3);
  assert.equal(await adminAdd(normal.base, HASH_C, 3), 4);
  assert.equal(await adminRevoke(normal.base, HASH_B, 4), 5);
  assert.equal(await adminRevoke(normal.base, HASH_C, 5), 6);
  sender = createS14Sender({ relayUrl: normal.base });
});

after(async () => {
  if (normal) await normal.mf.dispose();
  rmSync(path.join(ROOT, PERSIST), { recursive: true, force: true });
});

test("S14ガード：開始状態は generation 6・登録簿 {A}・consumed=2・completion=2", async () => {
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 6);
  assert.deepEqual(operatorHashes(state), [HASH_A]);
  assert.equal(state.consumed_ops.length, 2);
  assert.equal(state.completion.length, 2);
});

test("S14ガード（負の分岐）：誤った期待世代・不在の旧主体・在籍する新主体のローテーションは拒否され、状態は変わらない", async () => {
  // 期待世代が現在世代（6）と異なる場合は世代照合が先に立ち、
  // 409 stale_generation になる。
  const wrongGen = await adminRotateDirect(normal.base, HASH_A, HASH_B, 5);
  assert.equal(wrongGen.status, 409);
  assert.equal(wrongGen.json.error, "stale_generation");
  // 旧主体が登録簿に不在の場合は 404 target_not_member。
  const oldMissing = await adminRotateDirect(normal.base, HASH_C, HASH_B, 6);
  assert.equal(oldMissing.status, 404);
  assert.equal(oldMissing.json.error, "target_not_member");
  // 新主体が既に在籍する場合は 409 already_member（旧主体＝
  // 新主体の形もここに含まれる）。
  const newMember = await adminRotateDirect(normal.base, HASH_A, HASH_A, 6);
  assert.equal(newMember.status, 409);
  assert.equal(newMember.json.error, "already_member");
  // 呼び出し元が運営者でない場合は、在籍照合が世代・対象の
  // 照合より前に立ち、403 not_operator になる。
  const { nonce, cookie } = await issueNonceDirect(normal.base);
  const notOperator = await call(normal.base, "POST", "/admin/registry/rotate", {
    body: {
      id_token: mockToken(SUB_B, nonce),
      old_subject_hash: HASH_A,
      new_subject_hash: HASH_B,
      expected_generation: 6,
    },
    cookie,
  });
  assert.equal(notOperator.status, 403);
  assert.equal(notOperator.json.error, "not_operator");
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 6);
  assert.deepEqual(operatorHashes(state), [HASH_A]);
  assert.equal(state.consumed_ops.length, 2);
  assert.equal(state.completion.length, 2);
});

test("S14ガード：本手順（A→B のローテーション→A の提示は not_operator で拒否→B の提示成功）を通し、最終状態は世代7・{B}", async () => {
  const trialId = "s14-guard-main";
  sender.beginTrial(trialId);
  // 手順1：A の認可で A→B のローテーションを送る。
  const auth = await sender.issueNonce({ trialId, slot: "rotateAB" });
  sender.freezeRotateTargets({ trialId, oldSubjectHash: HASH_A, newSubjectHash: HASH_B });
  const rotateOut = await sender.sendRotate({
    trialId,
    slot: "rotateAB",
    request: buildS14RotateRequest({
      idToken: mockToken(SUB_A, auth.nonce),
      oldSubjectHash: HASH_A,
      newSubjectHash: HASH_B,
      expectedGeneration: 6,
    }),
  });
  assert.deepEqual(rotateOut, { status: 200, error: null, generation: 7 });
  const mid = await readRegistry(normal.base);
  assert.equal(mid.generation, 7);
  assert.deepEqual(operatorHashes(mid), [HASH_B]);
  // ローテーションで追加された B の行は、呼び出し元 A が
  // added_by である（実ビルドの仕様）。
  assert.equal(mid.operators[0].added_by, HASH_A);
  // 手順2：A の verify-only は 403 not_operator で拒否される
  // （ローテーション元の次回操作の拒否。この拒否が合格）。
  const checkA = await sender.issueNonce({ trialId, slot: "checkA" });
  const checkAOut = await sender.sendVerifyOnly({
    trialId,
    slot: "checkA",
    request: buildS14VerifyOnlyRequest({ idToken: mockToken(SUB_A, checkA.nonce) }),
  });
  assert.deepEqual(checkAOut, { status: 403, error: "not_operator", generation: null });
  // 手順3：B の verify-only は成功する（ローテーション先が
  // 運営者として通ることの確認）。
  const checkB = await sender.issueNonce({ trialId, slot: "checkB" });
  const checkBOut = await sender.sendVerifyOnly({
    trialId,
    slot: "checkB",
    request: buildS14VerifyOnlyRequest({ idToken: mockToken(SUB_B, checkB.nonce) }),
  });
  assert.equal(checkBOut.status, 200);
  assert.equal(checkBOut.error, null);
  assert.equal(checkBOut.generation, 7);
  // 最終状態。
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 7);
  assert.deepEqual(operatorHashes(state), [HASH_B]);
  assert.equal(state.consumed_ops.length, 2);
  assert.equal(state.completion.length, 2);
});

test("S14ガード: 送信済みのスロットは再送できず、状態は変わらない", async () => {
  const trialId = "s14-guard-main";
  await assert.rejects(
    () =>
      sender.sendRotate({
        trialId,
        slot: "rotateAB",
        request: buildS14RotateRequest({
          idToken: mockToken(SUB_A, "nonce-x"),
          oldSubjectHash: HASH_A,
          newSubjectHash: HASH_B,
          expectedGeneration: 6,
        }),
      }),
    (e) => e.code === "s14_not_prepared"
  );
  await assert.rejects(
    () =>
      sender.sendVerifyOnly({
        trialId,
        slot: "checkB",
        request: buildS14VerifyOnlyRequest({ idToken: mockToken(SUB_B, "nonce-y") }),
      }),
    (e) => e.code === "s14_not_prepared"
  );
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 7);
  assert.deepEqual(operatorHashes(state), [HASH_B]);
});

test("S14ガード: 結び付けが外れたローテーションは実 Worker へ送られず拒否される", async () => {
  const trialId = "s14-guard-bind";
  sender.beginTrial(trialId);
  const issued = await sender.issueNonce({ trialId, slot: "rotateAB" });
  // 対象の組を固定していないため、形の正しい要求でも送られない。
  await assert.rejects(
    () =>
      sender.sendRotate({
        trialId,
        slot: "rotateAB",
        request: buildS14RotateRequest({
          idToken: mockToken(SUB_B, issued.nonce),
          oldSubjectHash: HASH_B,
          newSubjectHash: HASH_A,
          expectedGeneration: 6,
        }),
      }),
    (e) => e.code === "s14_rotate_not_frozen"
  );
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 7);
  assert.deepEqual(operatorHashes(state), [HASH_B]);
});
