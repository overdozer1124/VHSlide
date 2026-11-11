// S11 ガード試験（項目6 手順3・4、ローカル模擬）。
// 実行: node --test test/s11-guard.test.mjs
// （npm run test:s11-guard でも実行できる）
//
// 目的：Codex の手順レビュー（SwarmChat seq 691）で合意した S11 の
// 手順3・手順4を、実際の通常ビルド（ローカル模擬）と実際の送信器
// （tools/s11-sender.mjs）で通し、次を確認する。
// - 手順3：追加 C を expected_generation = 2（過去世代）で送ると
//   409 stale_generation で拒否され、登録簿は generation 3・
//   {A, B} のまま変わらないこと。
// - 手順4：同一の追加 C（期待世代 3）を、別々の nonce・別々の
//   トークンで並行に2件送ると、正確に1件だけが 200 ok
//   （generation 4）で成功し、もう1件は 409 stale_generation で
//   拒否されること。最終状態は generation 4・{A, B, C} である
//   こと（世代チェックが既存メンバー判定より先であるため、負け
//   側は already_member ではない）。
// - 手順3→手順4の順序を1つの実行で通すこと（手順3で状態が変わ
//   らないことが手順4の前提）。
// - 送信器の結び付け確認が外れた要求は、実 Worker へ1件も送られ
//   ずに拒否されること。送信済みの枠は再送できないこと。
//
// 開始状態は S11 の開始前（generation 3・登録簿 {A, B}）であり、
// プラットフォーム経路の bootstrap（世代1）と full-replace
// （世代2）と、S10 と同じ管理ルートの追加（世代3）で作る。
// 実 Google・実 Cloudflare には接続しない。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createS11Sender } from "../tools/s11-sender.mjs";
import { buildS11Request, buildS11Requests } from "../tools/s11-parallel.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "http://localhost:8787";
const ENV_ID = "stage1-phase2-verification-local";
const CLIENT_ID = "dummy-client-id.apps.googleusercontent.com";
const DIAG_KEY = "test-diag-key";
const ISS = "https://accounts.google.com";
const PERSIST = ".persist-s11-guard";

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

async function issueNonce(base) {
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

let normal = null;
let sender = null;

before(async () => {
  rmSync(path.join(ROOT, PERSIST), { recursive: true, force: true });
  // bootstrap：generation 1・登録簿 {A}。
  let platform = await startBuild("platform-worker.js", PERSIST, approvalBindings({
    operationId: "op-s11-guard-001",
    purpose: "bootstrap",
    subjectHash: HASH_A,
    oneTime: "one-time-s11-guard-001",
    expiresAtMs: FUTURE(),
  }));
  let r = await platformApplyDirect(platform.mf, SUB_A, {
    purpose: "bootstrap",
    env_id: ENV_ID,
    one_time_value: "one-time-s11-guard-001",
  });
  assert.equal(r.status, 201, `bootstrap failed: ${JSON.stringify(r.json)}`);
  await platform.mf.dispose();
  // full-replace：generation 2・登録簿 {A}。
  platform = await startBuild("platform-worker.js", PERSIST, approvalBindings({
    operationId: "op-s11-guard-002",
    purpose: "full-replace",
    subjectHash: HASH_A,
    oneTime: "one-time-s11-guard-002",
    expiresAtMs: FUTURE(),
  }));
  r = await platformApplyDirect(platform.mf, SUB_A, {
    purpose: "full-replace",
    env_id: ENV_ID,
    one_time_value: "one-time-s11-guard-002",
  });
  assert.equal(r.status, 201, `full-replace failed: ${JSON.stringify(r.json)}`);
  await platform.mf.dispose();
  // 通常ビルドで B を追加：generation 3・登録簿 {A, B}（S11 の開始前状態。
  // S10 と同じ管理ルートの追加）。
  normal = await startBuild("worker.js", PERSIST);
  const { nonce, cookie } = await issueNonce(normal.base);
  const add = await call(normal.base, "POST", "/admin/registry/add", {
    body: {
      id_token: mockToken(SUB_A, nonce),
      subject_hash: HASH_B,
      expected_generation: 2,
    },
    cookie,
  });
  assert.equal(add.status, 200, `add B failed: ${JSON.stringify(add.json)}`);
  assert.equal(add.json.generation, 3);
  const before = await readRegistry(normal.base);
  assert.equal(before.generation, 3);
  assert.deepEqual(operatorHashes(before), [HASH_A, HASH_B].sort());
  sender = createS11Sender({ relayUrl: normal.base });
});

after(async () => {
  if (normal) await normal.mf.dispose();
  rmSync(path.join(ROOT, PERSIST), { recursive: true, force: true });
});

test("S11ガード: 結び付けが外れた並行要求は実 Worker へ送られず拒否される", async () => {
  const nonces = await sender.issueNonces({ trialId: "s11-guard-bind", procedure: "concurrent" });
  // スロットを取り違えたトークン（nonce が逆）。
  const requests = buildS11Requests({
    tokens: [mockToken(SUB_A, nonces[1]), mockToken(SUB_A, nonces[0])],
    subjectHash: HASH_C,
    expectedGeneration: 3,
  });
  await assert.rejects(
    () => sender.sendConcurrent({ trialId: "s11-guard-bind", requests }),
    (e) => e.code === "slot_nonce_mismatch"
  );
  sender.clear();
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 3);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_B].sort());
});

test("S11ガード: 手順3（期待世代 2 の追加 C）は 409 stale_generation で拒否され、状態は変わらない", async () => {
  const nonces = await sender.issueNonces({ trialId: "s11-guard-p3", procedure: "stale" });
  assert.equal(nonces.length, 1);
  const request = buildS11Request({
    idToken: mockToken(SUB_A, nonces[0]),
    subjectHash: HASH_C,
    expectedGeneration: 2,
  });
  const out = await sender.sendStale({ trialId: "s11-guard-p3", request });
  assert.equal(out.result.status, 409);
  assert.equal(out.result.error, "stale_generation");
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 3);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_B].sort());
});

test("S11ガード: 手順4（同一の追加 C の並行2件）は成功ちょうど1件で、最終状態は世代4・{A, B, C}", async () => {
  const nonces = await sender.issueNonces({ trialId: "s11-guard-p4", procedure: "concurrent" });
  assert.equal(nonces.length, 2);
  assert.notEqual(nonces[0], nonces[1]);
  const requests = buildS11Requests({
    tokens: [mockToken(SUB_A, nonces[0]), mockToken(SUB_A, nonces[1])],
    subjectHash: HASH_C,
    expectedGeneration: 3,
  });
  const out = await sender.sendConcurrent({ trialId: "s11-guard-p4", requests });
  assert.equal(out.results.length, 2);
  const successes = out.results.filter(
    (r) => r.status === 200 && r.generation === 4
  );
  const stales = out.results.filter(
    (r) => r.status === 409 && r.error === "stale_generation"
  );
  assert.equal(successes.length, 1, `results=${JSON.stringify(out.results)}`);
  assert.equal(stales.length, 1, `results=${JSON.stringify(out.results)}`);
  assert.equal(out.aggregate.ok, true);
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 4);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_B, HASH_C].sort());
});

test("S11ガード: 送信済みの枠は再送できず、状態は変わらない", async () => {
  await assert.rejects(
    () =>
      sender.sendConcurrent({
        trialId: "s11-guard-p4",
        requests: buildS11Requests({
          tokens: [mockToken(SUB_A, "nonce-x"), mockToken(SUB_A, "nonce-y")],
          subjectHash: HASH_C,
          expectedGeneration: 3,
        }),
      }),
    (e) => e.code === "s11_not_prepared"
  );
  await assert.rejects(
    () =>
      sender.sendStale({
        trialId: "s11-guard-p3",
        request: buildS11Request({
          idToken: mockToken(SUB_A, "nonce-z"),
          subjectHash: HASH_C,
          expectedGeneration: 2,
        }),
      }),
    (e) => e.code === "s11_not_prepared"
  );
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 4);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_B, HASH_C].sort());
});
