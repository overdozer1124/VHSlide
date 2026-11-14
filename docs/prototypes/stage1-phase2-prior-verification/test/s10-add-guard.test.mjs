// S10 変更 POST の二重配信ガード試験（ローカル模擬）。
// 実行: node test/s10-add-guard.test.mjs
// （npm run test:s10-add-guard でも実行できる）
//
// 目的：Codex レビュー Issue #3 コメント 6758375470 の指摘5への対応。
// 先行 S9 で remote preview の ProxyWorker が失敗時に 3回試行した
// 記録があるため、登録変更 POST（/admin/registry/add）が自動再試行
// で二重配信された場合でも、変更が二重に適用されないことを、実際の
// Worker（通常ビルド・ローカル模擬）で確認する。
// - 同一要求の再送（同じ nonce・同じトークン・同じ Cookie・同じ body）：
//   403 nonce_replayed で拒否される（nonce 消費が先に効く）。
// - 新しい nonce での再送（同じ期待世代 2・同じ対象 B）：
//   409 stale_generation で拒否される（成功後は世代が 3 になっている）。
// - 新しい nonce・期待世代 3 での同じ対象 B の追加：
//   409 already_member で拒否される（二重登録にならない）。
// - いずれの再送の後も、登録簿は {A, B}・generation 3 のままである。
//
// 開始状態は S10 の開始前（generation 2・登録簿 {A}）であり、
// プラットフォーム経路の bootstrap（世代1）と full-replace（世代2）
// で作る（test/run.mjs と同じ手順）。実 Google・実 Cloudflare には
// 接続しない。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeDirWithRetry } from "./teardown-helper.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "http://localhost:8787";
const ENV_ID = "stage1-phase2-verification-local";
const CLIENT_ID = "dummy-client-id.apps.googleusercontent.com";
const DIAG_KEY = "test-diag-key";
const ISS = "https://accounts.google.com";
// 永続化先は実行ごとに一意にする（pid 付き）。固定名だと、中断
// された前回実行の workerd が残っていた場合に、その削除・起動が
// Windows のファイルロック（EBUSY／EPERM）で塞がれる
// （Codex レビュー 6873611386 への対応）。
const PERSIST = `.persist-s10-guard-${process.pid}`;

const SUB_A = "operator-subject-alpha";
const SUB_B = "operator-subject-beta";
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const HASH_A = sha256(SUB_A);
const HASH_B = sha256(SUB_B);

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

function mockToken(sub, nonce, overrides = {}) {
  const iss = overrides.iss !== undefined ? overrides.iss : ISS;
  const aud = overrides.aud !== undefined ? overrides.aud : CLIENT_ID;
  const exp =
    overrides.exp !== undefined
      ? overrides.exp
      : String(Math.floor(Date.now() / 1000) + 600);
  return `mockop|${sub}|${nonce}|${iss}|${aud}|${exp}`;
}

async function attempt(base, sub, overrides = {}) {
  const { nonce, cookie } = await issueNonce(base);
  return { token: mockToken(sub, nonce, overrides), cookie };
}

async function adminCall(base, pathName, sub, body = {}, overrides = {}) {
  const { token, cookie } = await attempt(base, sub, overrides);
  return {
    response: await call(base, "POST", pathName, {
      body: { ...body, id_token: token },
      cookie,
    }),
    token,
    cookie,
    body: { ...body, id_token: token },
  };
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

// 応答の形だけを表す診断表記（値は一切含めない）。応答 JSON の
// キー名をソートして並べるか、JSON でなければ no-json を返す。
function responseShape(json) {
  if (!json || typeof json !== "object") return "no-json";
  return `keys=[${Object.keys(json).sort().join(",")}]`;
}

// DO 直接入口の nonce 発行は、輸送層の一時的な失敗
// （ECONNRESET 等で stub.fetch 自体が投げる場合）と、状態は
// 200 だが nonce／ctx を欠く応答に対してだけ、上限付きで再試
// 行する（test/run.mjs の issueNonceDirect と同じ意味論。
// Windows ではガード単独実行でもこの不安定さが再現したため、
// ガード側にも同じ堅牢化を入れる。Codex 判断 6880709295）。
// 再試行で未使用の nonce が増えることはあるが、この経路の確
// 認項目（運営者集合・消費済み操作・完了記録・初期化の有無）
// は未使用 nonce の件数に依存しない。200 以外の状態は意味の
// ある応答として再試行しない。/do/apply 等の変更要求は再送
// になるため再試行しない。最終的に失敗した場合は、状態と応
// 答の形（キー名のみで値は含めない）、輸送失敗なら例外の名前
// だけをエラーに含め、値・nonce・トークンは決して含めない。
async function issueNonceDoDirect(mf) {
  let last = null;
  let lastError = null;
  for (let i = 0; i < 5; i++) {
    try {
      last = await doDirect(mf, "/do/nonce", {});
      if (last.status === 200 && last.json && last.json.nonce && last.json.ctx) {
        return last;
      }
      if (last.status !== 200) return last;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (last) return last;
  throw new Error(
    `direct nonce issuance failed: transport=${lastError ? lastError.name || "Error" : "Error"}`
  );
}

async function platformApplyDirect(mf, sub, body, extraBody = {}) {
  const n = await issueNonceDoDirect(mf);
  if (n.status !== 200 || !n.json || !n.json.nonce) {
    throw new Error(
      `direct nonce issuance failed: status=${n.status} ${responseShape(n.json)}`
    );
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
let firstAdd = null; // 最初の追加の { token, cookie, body }（同一要求の再送用）

before(async () => {
  await removeDirWithRetry(path.join(ROOT, PERSIST));
  // bootstrap：generation 1・登録簿 {A}。
  // dispose は finally で行い、途中の assert 失敗で workerd を
  // 残さない（残るとプロセスが終了できず全体実行が止まる）。
  let platform = await startBuild("platform-worker.js", PERSIST, approvalBindings({
    operationId: "op-guard-001",
    purpose: "bootstrap",
    subjectHash: HASH_A,
    oneTime: "one-time-guard-001",
    expiresAtMs: FUTURE(),
  }));
  try {
    let r = await platformApplyDirect(platform.mf, SUB_A, {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-guard-001",
    });
    assert.equal(r.status, 201, `bootstrap failed: ${JSON.stringify(r.json)}`);
  } finally {
    await platform.mf.dispose();
  }
  // full-replace：generation 2・登録簿 {A}（S10 の開始前状態）。
  platform = await startBuild("platform-worker.js", PERSIST, approvalBindings({
    operationId: "op-guard-002",
    purpose: "full-replace",
    subjectHash: HASH_A,
    oneTime: "one-time-guard-002",
    expiresAtMs: FUTURE(),
  }));
  try {
    const r = await platformApplyDirect(platform.mf, SUB_A, {
      purpose: "full-replace",
      env_id: ENV_ID,
      one_time_value: "one-time-guard-002",
    });
    assert.equal(r.status, 201, `full-replace failed: ${JSON.stringify(r.json)}`);
  } finally {
    await platform.mf.dispose();
  }
  normal = await startBuild("worker.js", PERSIST);
  const before = await readRegistry(normal.base);
  assert.equal(before.generation, 2);
  assert.deepEqual(operatorHashes(before), [HASH_A]);
});

after(async () => {
  try {
    if (normal) await normal.mf.dispose();
  } finally {
    // dispose 直後は Windows でファイルハンドルが短時間残る
    // ことがあるため、削除は上限付きで再試行する。削除でき
    // なくても永続化先は実行ごとに一意なので、次回実行とは
    // 衝突しない（失敗を after フックの例外にしない）。
    await removeDirWithRetry(path.join(ROOT, PERSIST));
  }
});

test("S10ガード: B の追加は 200 で世代が 3 に進み、登録簿が {A, B} になる", async () => {
  firstAdd = await adminCall(normal.base, "/admin/registry/add", SUB_A, {
    subject_hash: HASH_B,
    expected_generation: 2,
  });
  assert.equal(firstAdd.response.status, 200);
  assert.equal(firstAdd.response.json.generation, 3);
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 3);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_B].sort());
});

test("S10ガード: 同一要求の再送（同じ nonce・トークン・Cookie・body）は 403 nonce_replayed で拒否される", async () => {
  assert.ok(firstAdd, "最初の追加が完了していること");
  const replay = await call(normal.base, "POST", "/admin/registry/add", {
    body: firstAdd.body,
    cookie: firstAdd.cookie,
  });
  assert.equal(replay.status, 403);
  assert.equal(replay.json.error, "nonce_replayed");
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 3);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_B].sort());
});

test("S10ガード: 新しい nonce での再送（同じ期待世代 2・同じ対象 B）は 409 stale_generation で拒否される", async () => {
  const r = await adminCall(normal.base, "/admin/registry/add", SUB_A, {
    subject_hash: HASH_B,
    expected_generation: 2,
  });
  assert.equal(r.response.status, 409);
  assert.equal(r.response.json.error, "stale_generation");
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 3);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_B].sort());
});

test("S10ガード: 新しい nonce・期待世代 3 での同じ対象 B の追加は 409 already_member で拒否される", async () => {
  const r = await adminCall(normal.base, "/admin/registry/add", SUB_A, {
    subject_hash: HASH_B,
    expected_generation: 3,
  });
  assert.equal(r.response.status, 409);
  assert.equal(r.response.json.error, "already_member");
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 3);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_B].sort());
});
