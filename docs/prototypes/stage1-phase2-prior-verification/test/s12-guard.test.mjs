// S12 ガード試験（項目6 手順5：運営者 B の失効、ローカル模擬）。
// 実行: node --test test/s12-guard.test.mjs
// （npm run test:s12-guard でも実行できる）
//
// 目的：S12 の手順を、実際の通常ビルド（ローカル模擬）と実際の
// 送信器（tools/s12-sender.mjs）で通し、次を確認する。
// - 開始状態は S12 の開始前（generation 4・登録簿 {A, B, C}・
//   consumed=2・completion=2）であり、プラットフォーム経路の
//   bootstrap（世代1）と full-replace（世代2）と、管理ルートの
//   追加（世代3 で B、世代4 で C）で作る。
// - 負の分岐（サーバー側）：世代3の時点で、S12 の固定値である
//   expected_generation = 4 の失効を送ると 409 stale_generation
//   で拒否され、登録簿は変わらないこと。
// - 本手順：B のトークンを保持（未提示）→ A の認可で B の失効
//   （200 ok・generation 5）→ 新しい B の verify-only が
//   403 not_operator → 保持した失効前トークンの verify-only が
//   403 not_operator（提示時点の登録簿で判定される）→ C の
//   verify-only が 200 ok。最終状態は generation 5・登録簿
//   {A, C}・consumed=2・completion=2 であること。
// - 送信済みのスロットは再送できないこと。結び付けが外れた
//   要求は実 Worker へ1件も送られずに拒否されること。
//
// 状態機械側の順序強制（保持トークンを失効より前に提示できない
// こと等）は test/s12-revoke.test.mjs で確認する。実 Google・
// 実 Cloudflare には接続しない。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createS12Sender } from "../tools/s12-sender.mjs";
import {
  buildS12RevokeRequest,
  buildS12VerifyOnlyRequest,
} from "../tools/s12-revoke.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "http://localhost:8787";
const ENV_ID = "stage1-phase2-verification-local";
const CLIENT_ID = "dummy-client-id.apps.googleusercontent.com";
const DIAG_KEY = "test-diag-key";
const ISS = "https://accounts.google.com";
const PERSIST = ".persist-s12-guard";

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

let normal = null;
let sender = null;

before(async () => {
  rmSync(path.join(ROOT, PERSIST), { recursive: true, force: true });
  // bootstrap：generation 1・登録簿 {A}。
  let platform = await startBuild("platform-worker.js", PERSIST, approvalBindings({
    operationId: "op-s12-guard-001",
    purpose: "bootstrap",
    subjectHash: HASH_A,
    oneTime: "one-time-s12-guard-001",
    expiresAtMs: FUTURE(),
  }));
  let r = await platformApplyDirect(platform.mf, SUB_A, {
    purpose: "bootstrap",
    env_id: ENV_ID,
    one_time_value: "one-time-s12-guard-001",
  });
  assert.equal(r.status, 201, `bootstrap failed: ${JSON.stringify(r.json)}`);
  await platform.mf.dispose();
  // full-replace：generation 2・登録簿 {A}。
  platform = await startBuild("platform-worker.js", PERSIST, approvalBindings({
    operationId: "op-s12-guard-002",
    purpose: "full-replace",
    subjectHash: HASH_A,
    oneTime: "one-time-s12-guard-002",
    expiresAtMs: FUTURE(),
  }));
  r = await platformApplyDirect(platform.mf, SUB_A, {
    purpose: "full-replace",
    env_id: ENV_ID,
    one_time_value: "one-time-s12-guard-002",
  });
  assert.equal(r.status, 201, `full-replace failed: ${JSON.stringify(r.json)}`);
  await platform.mf.dispose();
  // 通常ビルドで B を追加：generation 3・登録簿 {A, B}。
  normal = await startBuild("worker.js", PERSIST);
  const gen = await adminAdd(normal.base, HASH_B, 2);
  assert.equal(gen, 3);
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 3);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_B].sort());
  assert.equal(state.consumed_ops.length, 2);
  assert.equal(state.completion.length, 2);
  sender = createS12Sender({ relayUrl: normal.base });
});

after(async () => {
  if (normal) await normal.mf.dispose();
  rmSync(path.join(ROOT, PERSIST), { recursive: true, force: true });
});

test("S12ガード（負の分岐）：世代3で固定値4の失効を送るとサーバーが 409 stale_generation で拒否し、状態は変わらない", async () => {
  const trialId = "s12-guard-stale";
  sender.beginTrial(trialId);
  const held = await sender.issueNonce({ trialId, slot: "heldB" });
  const auth = await sender.issueNonce({ trialId, slot: "revokeA" });
  assert.ok(held.nonce && auth.nonce);
  sender.freezeRevokeTarget({ trialId, subjectHash: HASH_B });
  const out = await sender.sendRevoke({
    trialId,
    request: buildS12RevokeRequest({
      idToken: mockToken(SUB_A, auth.nonce),
      subjectHash: HASH_B,
      expectedGeneration: 4,
    }),
  });
  assert.equal(out.status, 409);
  assert.equal(out.error, "stale_generation");
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 3);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_B].sort());
});

test("S12ガード：C を追加して開始状態（generation 4・{A, B, C}・consumed=2・completion=2）を作る", async () => {
  const gen = await adminAdd(normal.base, HASH_C, 3);
  assert.equal(gen, 4);
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 4);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_B, HASH_C].sort());
  assert.equal(state.consumed_ops.length, 2);
  assert.equal(state.completion.length, 2);
});

test("S12ガード：本手順（保持→失効→新しいB拒否→失効前トークン拒否→C成功）を通し、最終状態は世代5・{A, C}", async () => {
  const trialId = "s12-guard-main";
  sender.beginTrial(trialId);
  // 手順1：B のトークンを保持する（提示しない）。
  const held = await sender.issueNonce({ trialId, slot: "heldB" });
  const heldToken = mockToken(SUB_B, held.nonce);
  // 手順2：A の認可で B の失効を送る。
  const auth = await sender.issueNonce({ trialId, slot: "revokeA" });
  sender.freezeRevokeTarget({ trialId, subjectHash: HASH_B });
  const revokeOut = await sender.sendRevoke({
    trialId,
    request: buildS12RevokeRequest({
      idToken: mockToken(SUB_A, auth.nonce),
      subjectHash: HASH_B,
      expectedGeneration: 4,
    }),
  });
  assert.deepEqual(revokeOut, { status: 200, error: null, generation: 5 });
  const mid = await readRegistry(normal.base);
  assert.equal(mid.generation, 5);
  assert.deepEqual(operatorHashes(mid), [HASH_A, HASH_C].sort());
  // 手順3：新しい B の提示は not_operator で拒否される。
  const fresh = await sender.issueNonce({ trialId, slot: "freshB" });
  const freshOut = await sender.sendVerifyOnly({
    trialId,
    slot: "freshB",
    request: buildS12VerifyOnlyRequest({ idToken: mockToken(SUB_B, fresh.nonce) }),
  });
  assert.equal(freshOut.status, 403);
  assert.equal(freshOut.error, "not_operator");
  // 手順4：保持した失効前トークンの提示も not_operator で拒否
  // される（提示時点の登録簿で判定される）。
  const heldOut = await sender.sendVerifyOnly({
    trialId,
    slot: "heldB",
    request: buildS12VerifyOnlyRequest({ idToken: heldToken }),
  });
  assert.equal(heldOut.status, 403);
  assert.equal(heldOut.error, "not_operator");
  // 手順5：C の提示は成功する（登録簿 {A, C} の健全性確認）。
  const check = await sender.issueNonce({ trialId, slot: "checkC" });
  const cOut = await sender.sendVerifyOnly({
    trialId,
    slot: "checkC",
    request: buildS12VerifyOnlyRequest({ idToken: mockToken(SUB_C, check.nonce) }),
  });
  assert.equal(cOut.status, 200);
  assert.equal(cOut.error, null);
  assert.equal(cOut.generation, 5);
  // 最終状態。
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 5);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_C].sort());
  assert.equal(state.consumed_ops.length, 2);
  assert.equal(state.completion.length, 2);
});

test("S12ガード: 送信済みのスロットは再送できず、状態は変わらない", async () => {
  const trialId = "s12-guard-main";
  await assert.rejects(
    () =>
      sender.sendRevoke({
        trialId,
        request: buildS12RevokeRequest({
          idToken: mockToken(SUB_A, "nonce-x"),
          subjectHash: HASH_B,
          expectedGeneration: 4,
        }),
      }),
    (e) => e.code === "s12_not_prepared"
  );
  await assert.rejects(
    () =>
      sender.sendVerifyOnly({
        trialId,
        slot: "heldB",
        request: buildS12VerifyOnlyRequest({ idToken: mockToken(SUB_B, "nonce-y") }),
      }),
    (e) => e.code === "s12_not_prepared"
  );
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 5);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_C].sort());
});

test("S12ガード: 結び付けが外れた提示は実 Worker へ送られず拒否される", async () => {
  const trialId = "s12-guard-bind";
  sender.beginTrial(trialId);
  await sender.issueNonce({ trialId, slot: "freshB" });
  await assert.rejects(
    () =>
      sender.sendVerifyOnly({
        trialId,
        slot: "freshB",
        request: buildS12VerifyOnlyRequest({ idToken: mockToken(SUB_B, "nonce-other") }),
      }),
    (e) => e.code === "s12_slot_nonce_mismatch"
  );
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 5);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_C].sort());
});
