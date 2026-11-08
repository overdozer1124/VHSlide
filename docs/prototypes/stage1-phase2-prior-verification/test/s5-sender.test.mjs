// tools/s5-sender.mjs の検証（ローカルのみ）。
// 実行: node --test test/s5-sender.test.mjs
// 実 Google・実 Worker とは通信しない。Miniflare の一時ビルド
// （local-mock、MOCK_AUTH）を相手に、6件の nonce・Cookie・トークンの
// 対応付けと並行送信を検証する。トークンはモック形式であり、実トークン
// ではない。並行送信の結果（201 が正確に1件）は、実環境の S5 と同じ
// サーバー側の判定経路で確認する。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createS5Sender, extractNonceCtx, tokenNonce } from "../tools/s5-sender.mjs";
import { buildS5Requests } from "../tools/s5-apply.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_ID = "stage1-phase2-verification-local";
const CLIENT_ID = "dummy-client-id.apps.googleusercontent.com";
const DIAG_KEY = "test-diag-key";
const ISS = "https://accounts.google.com";
const SUB_A = "operator-subject-alpha";
const HASH_A = createHash("sha256").update(SUB_A, "utf8").digest("hex");
const ONE_TIME = "one-time-value-s5";
const FUTURE = () => Date.now() + 10 * 60 * 1000;

const COMMON = {
  DEPLOYMENT_TIER: "local-mock",
  MOCK_AUTH: "1",
  ALLOW_TEST_HOOKS: "1",
  GOOGLE_CLIENT_ID: CLIENT_ID,
  ENV_ID,
  DIAG_KEY,
};

function approvalBindings({ operationId, purpose, subjectHash, oneTime, expiresAtMs }) {
  return {
    APPROVAL_ENV_ID: ENV_ID,
    APPROVAL_PURPOSE: purpose,
    APPROVAL_SUBJECT_HASH: subjectHash,
    APPROVAL_ONE_TIME: oneTime,
    APPROVAL_OPERATION_ID: operationId,
    APPROVAL_EXPIRES_AT: String(expiresAtMs),
  };
}

async function startPlatform(persistName, extraBindings) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: path.join(ROOT, "src", "platform-worker.js"),
    compatibilityDate: "2025-01-01",
    durableObjects: { REGISTRY: { className: "RegistryDO", useSQLite: true } },
    durableObjectsPersist: path.join(ROOT, persistName),
    bindings: { ...COMMON, ...extraBindings },
  });
  const base = (await mf.ready).toString().replace(/\/$/, "");
  return { mf, base };
}

async function issueNonce(base) {
  const res = await fetch(base + "/nonce", { method: "GET" });
  const data = await res.json().catch(() => null);
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookie = (extractNonceCtx(setCookies) || "").length
    ? `op2_nonce_ctx=${extractNonceCtx(setCookies)}`
    : "";
  if (!res.ok || !data || !data.nonce || !cookie) throw new Error("nonce issuance failed");
  return { nonce: data.nonce, cookie };
}

function mockToken(sub, nonce) {
  const exp = String(Math.floor(Date.now() / 1000) + 600);
  return `mockop|${sub}|${nonce}|${ISS}|${CLIENT_ID}|${exp}`;
}

async function applyOnce(base, { sub, purpose, envId, oneTime }) {
  const { nonce, cookie } = await issueNonce(base);
  const res = await fetch(base + "/platform/apply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: "http://localhost:8787",
      Cookie: cookie,
    },
    body: JSON.stringify({
      purpose,
      env_id: envId,
      one_time_value: oneTime,
      id_token: mockToken(sub, nonce),
    }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function inspect(base) {
  const res = await fetch(base + "/platform/inspect", {
    headers: { "X-Diag-Key": DIAG_KEY },
  });
  return res.json();
}

function persistDir(tag) {
  return `.persist-s5-${tag}-${randomUUID().slice(0, 8)}`;
}

// 初期化済みの登録簿（bootstrap op-001 実施済み）を用意し、
// full-replace 承認 op-101 の一時ビルドを起動して返す。
async function setupFullReplace(tag) {
  const dir = persistDir(tag);
  rmSync(path.join(ROOT, dir), { recursive: true, force: true });
  const boot = await startPlatform(
    dir,
    approvalBindings({
      operationId: "op-001",
      purpose: "bootstrap",
      subjectHash: HASH_A,
      oneTime: "one-time-value-001",
      expiresAtMs: FUTURE(),
    })
  );
  try {
    const r = await applyOnce(boot.base, {
      sub: SUB_A,
      purpose: "bootstrap",
      envId: ENV_ID,
      oneTime: "one-time-value-001",
    });
    assert.equal(r.status, 201, `bootstrap failed: ${JSON.stringify(r.json)}`);
  } finally {
    await boot.mf.dispose();
  }
  const full = await startPlatform(
    dir,
    approvalBindings({
      operationId: "op-101",
      purpose: "full-replace",
      subjectHash: HASH_A,
      oneTime: ONE_TIME,
      expiresAtMs: FUTURE(),
    })
  );
  return { dir, full };
}

async function teardown({ dir, full }) {
  await full.mf.dispose();
  rmSync(path.join(ROOT, dir), { recursive: true, force: true });
}

test("送信器：6件の並行送信で 201 が正確に1件、残りは 409 operation_consumed", async () => {
  const ctx = await setupFullReplace("conc");
  try {
    const sender = createS5Sender({ relayUrl: ctx.full.base });
    const nonces = await sender.issueNonces();
    assert.equal(nonces.length, 6);
    assert.equal(new Set(nonces).size, 6);
    assert.equal(sender.isPrepared(), true);
    const tokens = nonces.map((n) => mockToken(SUB_A, n));
    const requests = buildS5Requests({
      tokens,
      oneTimeValue: ONE_TIME,
      purpose: "full-replace",
      envId: ENV_ID,
    });
    const out = await sender.send({ trialId: "trial-s5-sender-001", requests });
    assert.equal(out.trial_id, "trial-s5-sender-001");
    assert.equal(out.results.length, 6);
    const ok = out.results.filter((r) => r.status === 201).length;
    const refused = out.results.filter(
      (r) => r.status === 409 && r.error === "operation_consumed"
    ).length;
    assert.equal(ok, 1, `statuses=${out.results.map((r) => r.status)}`);
    assert.equal(refused, 5);
    assert.equal(out.aggregate.ok, true);
    // 送信後は保持が破棄される。
    assert.equal(sender.isPrepared(), false);
    const state = await inspect(ctx.full.base);
    assert.equal(state.generation, 2);
    assert.equal(state.initialized, true);
    assert.equal(state.consumed_ops.length, 2);
    assert.equal(state.completion.length, 2);
    assert.equal(state.completion[1].operation_id, "op-101");
    assert.equal(state.completion[1].purpose, "full-replace");
    assert.equal(state.operators.length, 1);
    assert.equal(state.operators[0].subject_hash, HASH_A);
  } finally {
    await teardown(ctx);
  }
});

test("送信器：スロットとトークンの nonce が違えば1件も送らない", async () => {
  const ctx = await setupFullReplace("mismatch");
  try {
    const sender = createS5Sender({ relayUrl: ctx.full.base });
    const nonces = await sender.issueNonces();
    // スロット0のトークンに、スロット1の nonce を入れる（取り違え）。
    const tokens = nonces.map((n) => mockToken(SUB_A, n));
    tokens[0] = mockToken(SUB_A, nonces[1]);
    const requests = buildS5Requests({
      tokens,
      oneTimeValue: ONE_TIME,
      purpose: "full-replace",
      envId: ENV_ID,
    });
    await assert.rejects(
      () => sender.send({ trialId: "trial-s5-sender-002", requests }),
      (e) => e.code === "slot_nonce_mismatch"
    );
    // 1件も送られていないため、登録簿は初期化直後のままである。
    const state = await inspect(ctx.full.base);
    assert.equal(state.generation, 1);
    assert.equal(state.consumed_ops.length, 1);
    assert.equal(state.completion.length, 1);
  } finally {
    await teardown(ctx);
  }
});

test("送信器：6件の条件が等しくなければ1件も送らない", async () => {
  const ctx = await setupFullReplace("differ");
  try {
    const sender = createS5Sender({ relayUrl: ctx.full.base });
    const nonces = await sender.issueNonces();
    const tokens = nonces.map((n) => mockToken(SUB_A, n));
    const requests = buildS5Requests({
      tokens,
      oneTimeValue: ONE_TIME,
      purpose: "full-replace",
      envId: ENV_ID,
    });
    const tampered = requests.map((r) => ({ ...r }));
    tampered[3] = { ...tampered[3], one_time_value: "another-one-time-value" };
    await assert.rejects(
      () => sender.send({ trialId: "trial-s5-sender-003", requests: tampered }),
      (e) => e.code === "s5_slots_differ"
    );
    const state = await inspect(ctx.full.base);
    assert.equal(state.generation, 1);
    assert.equal(state.completion.length, 1);
  } finally {
    await teardown(ctx);
  }
});

test("送信器：発行から4分を過ぎれば送信せず、再準備が必要になる", async () => {
  const ctx = await setupFullReplace("expired");
  try {
    let fakeNow = Date.now();
    const sender = createS5Sender({
      relayUrl: ctx.full.base,
      now: () => fakeNow,
    });
    const nonces = await sender.issueNonces();
    assert.equal(sender.isPrepared(), true);
    fakeNow += 5 * 60 * 1000; // 5分進める
    const tokens = nonces.map((n) => mockToken(SUB_A, n));
    const requests = buildS5Requests({
      tokens,
      oneTimeValue: ONE_TIME,
      purpose: "full-replace",
      envId: ENV_ID,
    });
    await assert.rejects(
      () => sender.send({ trialId: "trial-s5-sender-004", requests }),
      (e) => e.code === "s5_nonces_expired"
    );
    assert.equal(sender.isPrepared(), false);
    const state = await inspect(ctx.full.base);
    assert.equal(state.generation, 1);
    assert.equal(state.completion.length, 1);
  } finally {
    await teardown(ctx);
  }
});

test("送信器：準備なしの送信と、送信後の再送は拒否される", async () => {
  const ctx = await setupFullReplace("noprep");
  try {
    const sender = createS5Sender({ relayUrl: ctx.full.base });
    const tokens = Array.from({ length: 6 }, (_, i) => mockToken(SUB_A, `dummy-nonce-${i}`));
    const requests = buildS5Requests({
      tokens,
      oneTimeValue: ONE_TIME,
      purpose: "full-replace",
      envId: ENV_ID,
    });
    await assert.rejects(
      () => sender.send({ trialId: "trial-s5-sender-005", requests }),
      (e) => e.code === "s5_not_prepared"
    );
    // 正常に送信したあと、同じ要求での再送は準備なしとして拒否される。
    const nonces = await sender.issueNonces();
    const realTokens = nonces.map((n) => mockToken(SUB_A, n));
    const realRequests = buildS5Requests({
      tokens: realTokens,
      oneTimeValue: ONE_TIME,
      purpose: "full-replace",
      envId: ENV_ID,
    });
    const out = await sender.send({ trialId: "trial-s5-sender-006", requests: realRequests });
    assert.equal(out.aggregate.ok, true);
    await assert.rejects(
      () => sender.send({ trialId: "trial-s5-sender-007", requests: realRequests }),
      (e) => e.code === "s5_not_prepared"
    );
  } finally {
    await teardown(ctx);
  }
});

test("送信器の純粋関数：ctx の取り出しとトークンの nonce クレーム", () => {
  assert.equal(
    extractNonceCtx(["op2_nonce_ctx=ctx-value-abc; HttpOnly; SameSite=Strict; Path=/; Max-Age=300"]),
    "ctx-value-abc"
  );
  assert.equal(extractNonceCtx(["other=1", "op2_nonce_ctx=second"]), "second");
  assert.equal(extractNonceCtx([]), null);
  assert.equal(extractNonceCtx(["op2_nonce_ctx="]), "");
  // モック形式のトークン（ローカル模擬）からは2番目の項目が nonce である。
  assert.equal(tokenNonce("mockop|sub|nonce-123|iss|aud|exp"), "nonce-123");
  assert.equal(tokenNonce("mockop|sub||iss|aud|exp"), null);
  // JWT 形式のトークンからは nonce クレームを取る（署名は検証しない）。
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "s", nonce: "jwt-nonce-xyz" })).toString("base64url");
  assert.equal(tokenNonce(`${header}.${payload}.sig`), "jwt-nonce-xyz");
  assert.equal(tokenNonce("not-a-jwt"), null);
});
