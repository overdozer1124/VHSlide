// S13 ガード試験（項目6 手順6：最後の運営者の保護、ローカル模擬）。
// 実行: node --test test/s13-guard.test.mjs
// （npm run test:s13-guard でも実行できる）
//
// 目的：S13 の手順を、実際の通常ビルド（ローカル模擬）と実際の
// 送信器（tools/s13-sender.mjs）で通し、次を確認する。
// - 開始状態は S13 の開始前（generation 5・登録簿 {A, C}・
//   consumed=2・completion=2）であり、プラットフォーム経路の
//   bootstrap（世代1）と full-replace（世代2）と、管理ルートの
//   追加（世代3 で B、世代4 で C）と失効（世代5 で B）で作る
//   （S12 の終了状態と同じ作り方）。
// - 本手順：A の認可で C の失効（200 ok・generation 6・登録簿
//   {A}）→ A 自身の失効試行（409 last_operator で拒否され、
//   状態は変わらない。この拒否が合格）→ A の verify-only が
//   200 ok。最終状態は generation 6・登録簿 {A}・consumed=2・
//   completion=2 であること。
// - 送信済みのスロットは再送できないこと。結び付けが外れた
//   要求は実 Worker へ1件も送られずに拒否されること。
//
// 状態機械側の順序強制（手順2が手順1より前に送れないこと等）は
// test/s13-revoke.test.mjs で確認する。実 Google・実 Cloudflare
// には接続しない。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeDirWithRetry } from "./teardown-helper.mjs";
import { createS13Sender } from "../tools/s13-sender.mjs";
import {
  buildS13RevokeRequest,
  buildS13VerifyOnlyRequest,
} from "../tools/s13-revoke.mjs";

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
const PERSIST = `.persist-s13-guard-${process.pid}`;

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

let normal = null;
let sender = null;

before(async () => {
  await removeDirWithRetry(path.join(ROOT, PERSIST));
  // bootstrap：generation 1・登録簿 {A}。
  // dispose は finally で行い、途中の assert 失敗で workerd を
  // 残さない（残るとプロセスが終了できず全体実行が止まる）。
  let platform = await startBuild("platform-worker.js", PERSIST, approvalBindings({
    operationId: "op-s13-guard-001",
    purpose: "bootstrap",
    subjectHash: HASH_A,
    oneTime: "one-time-s13-guard-001",
    expiresAtMs: FUTURE(),
  }));
  try {
    let r = await platformApplyDirect(platform.mf, SUB_A, {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-s13-guard-001",
    });
    assert.equal(r.status, 201, `bootstrap failed: ${JSON.stringify(r.json)}`);
  } finally {
    await platform.mf.dispose();
  }
  // full-replace：generation 2・登録簿 {A}。
  platform = await startBuild("platform-worker.js", PERSIST, approvalBindings({
    operationId: "op-s13-guard-002",
    purpose: "full-replace",
    subjectHash: HASH_A,
    oneTime: "one-time-s13-guard-002",
    expiresAtMs: FUTURE(),
  }));
  try {
    const r = await platformApplyDirect(platform.mf, SUB_A, {
      purpose: "full-replace",
      env_id: ENV_ID,
      one_time_value: "one-time-s13-guard-002",
    });
    assert.equal(r.status, 201, `full-replace failed: ${JSON.stringify(r.json)}`);
  } finally {
    await platform.mf.dispose();
  }
  // 通常ビルドで B を追加（世代3）、C を追加（世代4）、B を失効
  // （世代5）して、S13 の開始状態（世代5・{A, C}）を作る。
  normal = await startBuild("worker.js", PERSIST);
  assert.equal(await adminAdd(normal.base, HASH_B, 2), 3);
  assert.equal(await adminAdd(normal.base, HASH_C, 3), 4);
  assert.equal(await adminRevoke(normal.base, HASH_B, 4), 5);
  sender = createS13Sender({ relayUrl: normal.base });
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

test("S13ガード（堅牢化）：DO直接nonceが200だが nonce／ctx 欠落なら再試行して成功し、/do/apply はちょうど1回だけ送る", async () => {
  // 偽の Miniflare／DO スタブ。1回目の /do/nonce は 200 だが
  // nonce／ctx を欠く応答（Windows で観測された一過性異常の
  // 形）を返し、2回目で正しい発行応答を返す。/do/apply は
  // 受けた要求を記録し、再送されていないことを数で確認する。
  const calls = [];
  let nonceCalls = 0;
  const stub = {
    async fetch(url, opts) {
      const pathName = new URL(url).pathname;
      calls.push(pathName);
      if (pathName === "/do/nonce") {
        nonceCalls += 1;
        if (nonceCalls === 1) {
          return { status: 200, json: async () => ({ ok: true }) };
        }
        return {
          status: 200,
          json: async () => ({ nonce: "nonce-retry-demo", ctx: "ctx-retry-demo" }),
        };
      }
      if (pathName === "/do/apply") {
        const payload = JSON.parse(opts.body);
        // 2回目の発行で得た nonce と ctx で送られていること。
        assert.equal(payload.ctx, "ctx-retry-demo");
        assert.ok(payload.body.id_token.includes("|nonce-retry-demo|"));
        return { status: 201, json: async () => ({ ok: true }) };
      }
      throw new Error("unexpected path: " + pathName);
    },
  };
  const fakeMf = {
    async getDurableObjectNamespace(name) {
      assert.equal(name, "REGISTRY");
      return { idFromName: (n) => n, get: () => stub };
    },
  };
  const r = await platformApplyDirect(fakeMf, SUB_A, {
    purpose: "bootstrap",
    env_id: ENV_ID,
    one_time_value: "one-time-retry-demo",
  });
  assert.equal(r.status, 201);
  assert.equal(nonceCalls, 2);
  assert.equal(calls.filter((p) => p === "/do/apply").length, 1);
});

test("S13ガード（堅牢化）：再試行の上限・非200の即時失敗・輸送失敗の診断は、値を含まない形だけを出す", async () => {
  const makeFakeMf = (handler) => ({
    async getDurableObjectNamespace() {
      return {
        idFromName: (n) => n,
        get: () => ({ fetch: handler }),
      };
    },
  });
  // (a) 200 だが nonce／ctx 欠落が続く場合：上限（5回）まで
  // 再試行し、エラーは状態とキー名だけを含む（値は含めない）。
  let callsA = 0;
  const mfA = makeFakeMf(async () => {
    callsA += 1;
    return { status: 200, json: async () => ({ ok: true, detail: "shape-only" }) };
  });
  await assert.rejects(
    () =>
      platformApplyDirect(mfA, SUB_A, {
        purpose: "bootstrap",
        env_id: ENV_ID,
        one_time_value: "one-time-retry-demo",
      }),
    (e) => {
      assert.ok(e.message.includes("status=200"), e.message);
      assert.ok(e.message.includes("keys=[detail,ok]"), e.message);
      assert.ok(!e.message.includes("shape-only"), e.message);
      return true;
    }
  );
  assert.equal(callsA, 5);
  // (b) 200 以外の状態は意味のある応答として再試行しない。
  let callsB = 0;
  const mfB = makeFakeMf(async () => {
    callsB += 1;
    return { status: 403, json: async () => ({ error: "forbidden" }) };
  });
  await assert.rejects(
    () =>
      platformApplyDirect(mfB, SUB_A, {
        purpose: "bootstrap",
        env_id: ENV_ID,
        one_time_value: "one-time-retry-demo",
      }),
    (e) => {
      assert.ok(e.message.includes("status=403"), e.message);
      assert.ok(e.message.includes("keys=[error]"), e.message);
      return true;
    }
  );
  assert.equal(callsB, 1);
  // (c) 輸送失敗が続く場合：上限まで再試行し、エラーには例外
  // の名前だけを含める（例外のメッセージ文は含めない）。
  let callsC = 0;
  const mfC = makeFakeMf(async () => {
    callsC += 1;
    throw new TypeError("simulated transport detail");
  });
  await assert.rejects(
    () =>
      platformApplyDirect(mfC, SUB_A, {
        purpose: "bootstrap",
        env_id: ENV_ID,
        one_time_value: "one-time-retry-demo",
      }),
    (e) => {
      assert.ok(e.message.includes("transport=TypeError"), e.message);
      assert.ok(!e.message.includes("simulated transport detail"), e.message);
      return true;
    }
  );
  assert.equal(callsC, 5);
});

test("S13ガード：開始状態は generation 5・登録簿 {A, C}・consumed=2・completion=2", async () => {
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 5);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_C].sort());
  assert.equal(state.consumed_ops.length, 2);
  assert.equal(state.completion.length, 2);
});

test("S13ガード（負の分岐）：世代5で手順2の固定値（世代6）の失効Aを送るとサーバーが 409 stale_generation で拒否し、状態は変わらない", async () => {
  // 開始状態（世代5）で手順2の形（対象 A・期待世代 6）を直接
  // 送ると、サーバー側の世代照合が先に立ち stale_generation に
  // なる（手順1を飛ばすと last_operator には到達しない）。
  const { nonce, cookie } = await issueNonceDirect(normal.base);
  const direct = await call(normal.base, "POST", "/admin/registry/revoke", {
    body: {
      id_token: mockToken(SUB_A, nonce),
      subject_hash: HASH_A,
      expected_generation: 6,
    },
    cookie,
  });
  assert.equal(direct.status, 409);
  assert.equal(direct.json.error, "stale_generation");
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 5);
  assert.deepEqual(operatorHashes(state), [HASH_A, HASH_C].sort());
});

test("S13ガード：本手順（C の失効→A 自身の失効試行は last_operator で拒否→A の提示成功）を通し、最終状態は世代6・{A}", async () => {
  const trialId = "s13-guard-main";
  sender.beginTrial(trialId);
  // 手順1：A の認可で C の失効を送る。
  const auth1 = await sender.issueNonce({ trialId, slot: "revokeC" });
  sender.freezeRevokeTarget({ trialId, slot: "revokeC", subjectHash: HASH_C });
  const revokeCOut = await sender.sendRevoke({
    trialId,
    slot: "revokeC",
    request: buildS13RevokeRequest({
      idToken: mockToken(SUB_A, auth1.nonce),
      subjectHash: HASH_C,
      expectedGeneration: 5,
    }),
  });
  assert.deepEqual(revokeCOut, { status: 200, error: null, generation: 6 });
  const mid = await readRegistry(normal.base);
  assert.equal(mid.generation, 6);
  assert.deepEqual(operatorHashes(mid), [HASH_A]);
  // 手順2：A 自身の失効を試行する。409 last_operator で拒否
  // され、状態は変わらない（この拒否が合格）。
  const auth2 = await sender.issueNonce({ trialId, slot: "revokeA" });
  sender.freezeRevokeTarget({ trialId, slot: "revokeA", subjectHash: HASH_A });
  const revokeAOut = await sender.sendRevoke({
    trialId,
    slot: "revokeA",
    request: buildS13RevokeRequest({
      idToken: mockToken(SUB_A, auth2.nonce),
      subjectHash: HASH_A,
      expectedGeneration: 6,
    }),
  });
  assert.deepEqual(revokeAOut, { status: 409, error: "last_operator", generation: null });
  const afterAttempt = await readRegistry(normal.base);
  assert.equal(afterAttempt.generation, 6);
  assert.deepEqual(operatorHashes(afterAttempt), [HASH_A]);
  // 手順3：A の verify-only は成功する（唯一の運営者が残って
  // 操作できることの確認）。
  const check = await sender.issueNonce({ trialId, slot: "checkA" });
  const checkOut = await sender.sendVerifyOnly({
    trialId,
    slot: "checkA",
    request: buildS13VerifyOnlyRequest({ idToken: mockToken(SUB_A, check.nonce) }),
  });
  assert.equal(checkOut.status, 200);
  assert.equal(checkOut.error, null);
  assert.equal(checkOut.generation, 6);
  // 最終状態。
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 6);
  assert.deepEqual(operatorHashes(state), [HASH_A]);
  assert.equal(state.consumed_ops.length, 2);
  assert.equal(state.completion.length, 2);
});

test("S13ガード: 送信済みのスロットは再送できず、状態は変わらない", async () => {
  const trialId = "s13-guard-main";
  await assert.rejects(
    () =>
      sender.sendRevoke({
        trialId,
        slot: "revokeC",
        request: buildS13RevokeRequest({
          idToken: mockToken(SUB_A, "nonce-x"),
          subjectHash: HASH_C,
          expectedGeneration: 5,
        }),
      }),
    (e) => e.code === "s13_not_prepared"
  );
  await assert.rejects(
    () =>
      sender.sendVerifyOnly({
        trialId,
        slot: "checkA",
        request: buildS13VerifyOnlyRequest({ idToken: mockToken(SUB_A, "nonce-y") }),
      }),
    (e) => e.code === "s13_not_prepared"
  );
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 6);
  assert.deepEqual(operatorHashes(state), [HASH_A]);
});

test("S13ガード: 結び付けが外れた失効は実 Worker へ送られず拒否される", async () => {
  const trialId = "s13-guard-bind";
  sender.beginTrial(trialId);
  const issued = await sender.issueNonce({ trialId, slot: "revokeC" });
  // 対象を固定していないため、形の正しい要求でも送られない。
  await assert.rejects(
    () =>
      sender.sendRevoke({
        trialId,
        slot: "revokeC",
        request: buildS13RevokeRequest({
          idToken: mockToken(SUB_A, issued.nonce),
          subjectHash: HASH_A,
          expectedGeneration: 5,
        }),
      }),
    (e) => e.code === "s13_revoke_not_frozen"
  );
  const state = await readRegistry(normal.base);
  assert.equal(state.generation, 6);
  assert.deepEqual(operatorHashes(state), [HASH_A]);
});
