// tools/s14-sender.mjs の検証（ローカルのみ）。
// 実行: node --test test/s14-sender.test.mjs
// （npm run test:s14 でも実行できる）
// 実 Google・実 Worker とは通信しない。偽の fetch で中継先を
// 模し、名前付きスロットごとの Cookie jar の分離・対象の組の
// 結び付け・固定世代・no-resend・送信窓・排他を確認する。
// 実 Worker との結線は test/s14-guard.test.mjs で確認する。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import { createS14Sender } from "../tools/s14-sender.mjs";
import {
  buildS14RotateRequest,
  buildS14VerifyOnlyRequest,
} from "../tools/s14-rotate.mjs";

const RELAY = "http://127.0.0.1:8799";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

// 偽の JWT（署名検証はしない。ペイロードの nonce クレームだけを
// 送信器が読む）。実トークンではない。
function fakeToken(sub, nonce) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT", kid: "fake" })}.${b64({ sub, nonce })}.fakesig`;
}

function jsonResponse(status, body, setCookie) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      getSetCookie: () => (setCookie ? [setCookie] : []),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// 偽の中継。/nonce は呼び出しごとに異なる nonce と ctx を返し、
// /admin/* への送信を記録する。handlers で応答を場面ごとに
// 差し替える。verify-only の既定応答は、トークンの sub が
// ローテーション元（sub-a）なら 403 not_operator、それ以外は
// 200（S14 の期待の形：A は拒否され、B は通る）。
function makeFakeRelay(handlers = {}) {
  const calls = { nonce: 0, rotate: [], verifyOnly: [] };
  let counter = 0;
  const fetchImpl = async (url, init = {}) => {
    if (url === RELAY + "/nonce") {
      counter += 1;
      calls.nonce += 1;
      const n = counter;
      if (handlers.nonce) return handlers.nonce(n);
      return jsonResponse(200, { nonce: `nonce-${n}` }, `op2_nonce_ctx=ctx-${n}; Path=/; HttpOnly`);
    }
    if (url === RELAY + "/admin/registry/rotate" || url === RELAY + "/admin/verify-only") {
      const record = {
        url,
        method: init.method,
        headers: init.headers,
        redirect: init.redirect,
        body: JSON.parse(init.body),
      };
      const list = url.endsWith("/rotate") ? calls.rotate : calls.verifyOnly;
      list.push(record);
      const handler = url.endsWith("/rotate") ? handlers.rotate : handlers.verifyOnly;
      if (handler) return handler(record, list.length);
      if (url.endsWith("/rotate")) {
        return jsonResponse(200, { ok: true, generation: 7 });
      }
      const payload = JSON.parse(
        Buffer.from(record.body.id_token.split(".")[1], "base64url").toString("utf8")
      );
      return payload.sub === "sub-a"
        ? jsonResponse(403, { error: "not_operator" })
        : jsonResponse(200, { ok: true, generation: 7 });
    }
    throw new Error(`unexpected url: ${url}`);
  };
  return { calls, fetchImpl };
}

// 時計を注入できる送信器を作る補助。
function makeSender(handlers) {
  const relay = makeFakeRelay(handlers);
  let clock = 1000000;
  const sender = createS14Sender({
    relayUrl: RELAY,
    fetchImpl: relay.fetchImpl,
    now: () => clock,
  });
  return {
    ...relay,
    sender,
    setClock: (v) => {
      clock = v;
    },
    getClock: () => clock,
  };
}

async function assertRejectsCode(promise, code) {
  await assert.rejects(promise, (e) => e && e.code === code);
}

test("発行：スロットごとに nonce だけが返り、ctx は漏れない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const first = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
  assert.deepEqual(Object.keys(first), ["nonce"]);
  assert.equal(first.nonce, "nonce-1");
  assert.equal(JSON.stringify(first).includes("ctx-"), false);
  assert.equal(sender.slotIssuedAt("t1", "rotateAB"), 1000000);
  assert.equal(sender.slotConsumed("t1", "rotateAB"), false);
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "rotateAB" }), "s14_slot_already_issued");
  await assertRejectsCode(sender.issueNonce({ trialId: "other", slot: "checkA" }), "s14_trial_mismatch");
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "bogus" }), "s14_bad_slot");
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "targetA" }), "s14_bad_slot");
  assert.equal(calls.nonce, 1);
});

test("発行の失敗：スロットは空に戻り s14_nonce_issuance_failed", async () => {
  const { sender } = makeSender({ nonce: () => jsonResponse(500, { error: "boom" }) });
  sender.beginTrial("t1");
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "rotateAB" }), "s14_nonce_issuance_failed");
  assert.equal(sender.slotIssuedAt("t1", "rotateAB"), null);
});

test("ローテーション送信：rotateAB の ctx だけで1回だけ送り、再送できない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
  sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_B });
  const request = buildS14RotateRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    oldSubjectHash: HASH_A,
    newSubjectHash: HASH_B,
    expectedGeneration: 6,
  });
  const out = await sender.sendRotate({ trialId: "t1", slot: "rotateAB", request });
  assert.deepEqual(out, { status: 200, error: null, generation: 7 });
  assert.equal(calls.rotate.length, 1);
  assert.equal(calls.rotate[0].url, RELAY + "/admin/registry/rotate");
  assert.equal(calls.rotate[0].headers.Cookie, "op2_nonce_ctx=ctx-1");
  assert.equal(calls.rotate[0].headers.Origin, "http://localhost:8787");
  assert.equal(calls.rotate[0].redirect, "manual");
  assert.equal(calls.rotate[0].body.old_subject_hash, HASH_A);
  assert.equal(calls.rotate[0].body.new_subject_hash, HASH_B);
  assert.equal(calls.rotate[0].body.expected_generation, 6);
  assert.equal(sender.slotConsumed("t1", "rotateAB"), true);
  await assertRejectsCode(sender.sendRotate({ trialId: "t1", slot: "rotateAB", request }), "s14_not_prepared");
  assert.equal(calls.rotate.length, 1);
});

test("対象の結び付け：固定が無ければローテーションを送らない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
  const request = buildS14RotateRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    oldSubjectHash: HASH_A,
    newSubjectHash: HASH_B,
    expectedGeneration: 6,
  });
  await assertRejectsCode(sender.sendRotate({ trialId: "t1", slot: "rotateAB", request }), "s14_rotate_not_frozen");
  assert.equal(calls.rotate.length, 0);
  assert.equal(sender.slotConsumed("t1", "rotateAB"), false);
});

test("対象の結び付け：固定した組と異なる要求（旧主体違い・新主体違い）は送らず、スロットも消費しない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
  sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_B });
  // 新主体だけが異なる要求。nonce・世代は正しい。
  const wrongNew = buildS14RotateRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    oldSubjectHash: HASH_A,
    newSubjectHash: HASH_C,
    expectedGeneration: 6,
  });
  await assertRejectsCode(sender.sendRotate({ trialId: "t1", slot: "rotateAB", request: wrongNew }), "s14_rotate_target_mismatch");
  // 旧主体だけが異なる要求。
  const wrongOld = buildS14RotateRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    oldSubjectHash: HASH_C,
    newSubjectHash: HASH_B,
    expectedGeneration: 6,
  });
  await assertRejectsCode(sender.sendRotate({ trialId: "t1", slot: "rotateAB", request: wrongOld }), "s14_rotate_target_mismatch");
  assert.equal(calls.rotate.length, 0);
  assert.equal(sender.slotConsumed("t1", "rotateAB"), false);
  // 拒否は送信ではない。固定した組の要求はそのまま送れる。
  const right = buildS14RotateRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    oldSubjectHash: HASH_A,
    newSubjectHash: HASH_B,
    expectedGeneration: 6,
  });
  const out = await sender.sendRotate({ trialId: "t1", slot: "rotateAB", request: right });
  assert.equal(out.status, 200);
  assert.equal(calls.rotate.length, 1);
  assert.equal(calls.rotate[0].body.new_subject_hash, HASH_B);
});

test("対象の固定：同じ組の再登録は冪等、異なる組と形式違いは拒否、固定値は漏れない", async () => {
  const { sender } = makeSender();
  sender.beginTrial("t1");
  // rotateAB の発行前には固定できない。
  assert.throws(
    () => sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_B }),
    (e) => e && e.code === "s14_not_prepared"
  );
  await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
  // 形式が違う値は固定できない。
  assert.throws(
    () => sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: "xyz", newSubjectHash: HASH_B }),
    (e) => e && e.code === "s14_rotate_target_fixed"
  );
  assert.throws(
    () => sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: "xyz" }),
    (e) => e && e.code === "s14_rotate_target_fixed"
  );
  assert.equal(sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_B }), true);
  assert.equal(sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_B }), true);
  assert.throws(
    () => sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_C }),
    (e) => e && e.code === "s14_rotate_target_mismatch"
  );
  // snapshot には固定値そのものは出ない（固定済みかどうかだけ）。
  const snap = sender.snapshot();
  assert.equal(snap.rotateTargetsFrozen, true);
  assert.equal(JSON.stringify(snap).includes(HASH_A), false);
  assert.equal(JSON.stringify(snap).includes(HASH_B), false);
});

test("ローテーション送信：固定値の確認（期待世代は固定値 6・対象・nonce 一致・送信窓）", async () => {
  // 世代 5 や 7 を指定すると固定値（6）ではない。
  for (const gen of [5, 7]) {
    const { sender, calls } = makeSender();
    sender.beginTrial("t1");
    const auth = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
    sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_B });
    const request = buildS14RotateRequest({
      idToken: fakeToken("sub-a", auth.nonce),
      oldSubjectHash: HASH_A,
      newSubjectHash: HASH_B,
      expectedGeneration: gen,
    });
    await assertRejectsCode(sender.sendRotate({ trialId: "t1", slot: "rotateAB", request }), "s14_unexpected_generation");
    assert.equal(calls.rotate.length, 0);
  }
  // 対象が空。
  {
    const { sender, calls } = makeSender();
    sender.beginTrial("t1");
    const auth = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
    await assertRejectsCode(
      sender.sendRotate({
        trialId: "t1",
        slot: "rotateAB",
        request: {
          id_token: fakeToken("sub-a", auth.nonce),
          old_subject_hash: "",
          new_subject_hash: HASH_B,
          expected_generation: 6,
        },
      }),
      "s14_rotate_target_fixed"
    );
    assert.equal(calls.rotate.length, 0);
  }
  // トークンの nonce がスロットと一致しない。
  {
    const { sender, calls } = makeSender();
    sender.beginTrial("t1");
    const auth = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
    sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_B });
    const request = buildS14RotateRequest({
      idToken: fakeToken("sub-a", "nonce-999"),
      oldSubjectHash: HASH_A,
      newSubjectHash: HASH_B,
      expectedGeneration: 6,
    });
    await assertRejectsCode(sender.sendRotate({ trialId: "t1", slot: "rotateAB", request }), "s14_slot_nonce_mismatch");
    assert.equal(calls.rotate.length, 0);
    assert.ok(auth.nonce);
  }
  // 送信窓を過ぎている。
  {
    const { sender, calls, setClock, getClock } = makeSender();
    sender.beginTrial("t1");
    const t0 = getClock();
    const auth = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
    sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_B });
    const request = buildS14RotateRequest({
      idToken: fakeToken("sub-a", auth.nonce),
      oldSubjectHash: HASH_A,
      newSubjectHash: HASH_B,
      expectedGeneration: 6,
    });
    setClock(t0 + 240000);
    await assertRejectsCode(sender.sendRotate({ trialId: "t1", slot: "rotateAB", request }), "s14_nonces_expired");
    assert.equal(calls.rotate.length, 0);
    assert.equal(sender.slotConsumed("t1", "rotateAB"), false);
  }
});

test("提示送信：checkA は 403 not_operator が、checkB は 200 がそのまま返り、ローテーションスロットは使えない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const checkA = await sender.issueNonce({ trialId: "t1", slot: "checkA" });
  const outA = await sender.sendVerifyOnly({
    trialId: "t1",
    slot: "checkA",
    request: buildS14VerifyOnlyRequest({ idToken: fakeToken("sub-a", checkA.nonce) }),
  });
  assert.deepEqual(outA, { status: 403, error: "not_operator", generation: null });
  assert.equal(calls.verifyOnly.length, 1);
  assert.equal(calls.verifyOnly[0].url, RELAY + "/admin/verify-only");
  assert.equal(calls.verifyOnly[0].headers.Cookie, "op2_nonce_ctx=ctx-1");
  assert.deepEqual(Object.keys(calls.verifyOnly[0].body), ["id_token"]);
  const checkB = await sender.issueNonce({ trialId: "t1", slot: "checkB" });
  const outB = await sender.sendVerifyOnly({
    trialId: "t1",
    slot: "checkB",
    request: buildS14VerifyOnlyRequest({ idToken: fakeToken("sub-b", checkB.nonce) }),
  });
  assert.deepEqual(outB, { status: 200, error: null, generation: 7 });
  assert.equal(calls.verifyOnly.length, 2);
  assert.equal(calls.verifyOnly[1].headers.Cookie, "op2_nonce_ctx=ctx-2");
  // 消費済みスロットの再送はできない。
  await assertRejectsCode(
    sender.sendVerifyOnly({
      trialId: "t1",
      slot: "checkA",
      request: buildS14VerifyOnlyRequest({ idToken: fakeToken("sub-a", checkA.nonce) }),
    }),
    "s14_not_prepared"
  );
  assert.equal(calls.verifyOnly.length, 2);
  // rotateAB は verify-only に使えない。
  const auth = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
  await assertRejectsCode(
    sender.sendVerifyOnly({
      trialId: "t1",
      slot: "rotateAB",
      request: buildS14VerifyOnlyRequest({ idToken: fakeToken("sub-a", auth.nonce) }),
    }),
    "s14_bad_slot"
  );
  // checkA / checkB はローテーションに使えない。
  await assertRejectsCode(
    sender.sendRotate({
      trialId: "t1",
      slot: "checkA",
      request: buildS14RotateRequest({
        idToken: fakeToken("sub-a", checkA.nonce),
        oldSubjectHash: HASH_A,
        newSubjectHash: HASH_B,
        expectedGeneration: 6,
      }),
    }),
    "s14_bad_slot"
  );
});

test("提示送信：送信窓超過は s14_nonces_expired で送信自体を拒否し、nonce 不一致は送らない", async () => {
  const { sender, calls, setClock, getClock } = makeSender();
  sender.beginTrial("t1");
  const t0 = getClock();
  const check = await sender.issueNonce({ trialId: "t1", slot: "checkB" });
  const req = buildS14VerifyOnlyRequest({ idToken: fakeToken("sub-b", check.nonce) });
  setClock(t0 + 240000);
  await assertRejectsCode(
    sender.sendVerifyOnly({ trialId: "t1", slot: "checkB", request: req }),
    "s14_nonces_expired"
  );
  assert.equal(calls.verifyOnly.length, 0);
  assert.equal(sender.slotConsumed("t1", "checkB"), false);
  const bad = buildS14VerifyOnlyRequest({ idToken: fakeToken("sub-b", "nonce-999") });
  await assertRejectsCode(
    sender.sendVerifyOnly({ trialId: "t1", slot: "checkB", request: bad }),
    "s14_slot_nonce_mismatch"
  );
  assert.equal(calls.verifyOnly.length, 0);
});

test("応答の正規化：例外は no_response、3xx は redirect_not_followed、未知コードは unexpected_error", async () => {
  // fetch 例外。
  {
    const { sender } = makeSender({
      rotate: () => {
        throw new Error("network down");
      },
    });
    sender.beginTrial("t1");
    const auth = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
    sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_B });
    const out = await sender.sendRotate({
      trialId: "t1",
      slot: "rotateAB",
      request: buildS14RotateRequest({
        idToken: fakeToken("sub-a", auth.nonce),
        oldSubjectHash: HASH_A,
        newSubjectHash: HASH_B,
        expectedGeneration: 6,
      }),
    });
    assert.deepEqual(out, { status: null, error: "no_response", generation: null });
  }
  // 3xx。
  {
    const { sender } = makeSender({
      verifyOnly: () => ({
        ok: false,
        status: 302,
        headers: { getSetCookie: () => [] },
        json: async () => ({}),
        text: async () => "",
      }),
    });
    sender.beginTrial("t1");
    const check = await sender.issueNonce({ trialId: "t1", slot: "checkB" });
    const out = await sender.sendVerifyOnly({
      trialId: "t1",
      slot: "checkB",
      request: buildS14VerifyOnlyRequest({ idToken: fakeToken("sub-b", check.nonce) }),
    });
    assert.deepEqual(out, { status: 302, error: "redirect_not_followed", generation: null });
  }
  // 未知の理由コード。
  {
    const { sender } = makeSender({
      verifyOnly: () => jsonResponse(500, { error: "internal_detail_xyz" }),
    });
    sender.beginTrial("t1");
    const check = await sender.issueNonce({ trialId: "t1", slot: "checkB" });
    const out = await sender.sendVerifyOnly({
      trialId: "t1",
      slot: "checkB",
      request: buildS14VerifyOnlyRequest({ idToken: fakeToken("sub-b", check.nonce) }),
    });
    assert.equal(out.status, 500);
    assert.equal(out.error, "unexpected_error");
  }
});

test("Cookie の分離：3スロットはそれぞれ別の ctx を持ち、送信は自分の ctx だけを使う", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
  const checkA = await sender.issueNonce({ trialId: "t1", slot: "checkA" });
  const checkB = await sender.issueNonce({ trialId: "t1", slot: "checkB" });
  const snap = sender.snapshot();
  assert.equal(snap.slots.rotateAB.ctxLen > 0, true);
  sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_B });
  await sender.sendRotate({
    trialId: "t1",
    slot: "rotateAB",
    request: buildS14RotateRequest({
      idToken: fakeToken("sub-a", auth.nonce),
      oldSubjectHash: HASH_A,
      newSubjectHash: HASH_B,
      expectedGeneration: 6,
    }),
  });
  await sender.sendVerifyOnly({
    trialId: "t1",
    slot: "checkA",
    request: buildS14VerifyOnlyRequest({ idToken: fakeToken("sub-a", checkA.nonce) }),
  });
  await sender.sendVerifyOnly({
    trialId: "t1",
    slot: "checkB",
    request: buildS14VerifyOnlyRequest({ idToken: fakeToken("sub-b", checkB.nonce) }),
  });
  assert.equal(calls.rotate[0].headers.Cookie, "op2_nonce_ctx=ctx-1");
  assert.equal(calls.verifyOnly[0].headers.Cookie, "op2_nonce_ctx=ctx-2");
  assert.equal(calls.verifyOnly[1].headers.Cookie, "op2_nonce_ctx=ctx-3");
});

test("排他：送信の飛行中は別の送信・発行ができない", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { sender } = makeSender({
    rotate: async () => {
      await gate;
      return jsonResponse(200, { ok: true, generation: 7 });
    },
  });
  sender.beginTrial("t1");
  const auth = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
  sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_B });
  const pending = sender.sendRotate({
    trialId: "t1",
    slot: "rotateAB",
    request: buildS14RotateRequest({
      idToken: fakeToken("sub-a", auth.nonce),
      oldSubjectHash: HASH_A,
      newSubjectHash: HASH_B,
      expectedGeneration: 6,
    }),
  });
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "checkA" }), "s14_sender_busy");
  release();
  const out = await pending;
  assert.equal(out.status, 200);
});

test("破棄：discard で状態が消え、旧試行の送信はできない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth = await sender.issueNonce({ trialId: "t1", slot: "rotateAB" });
  sender.freezeRotateTargets({ trialId: "t1", oldSubjectHash: HASH_A, newSubjectHash: HASH_B });
  sender.discard();
  assert.equal(sender.snapshot(), null);
  await assertRejectsCode(
    sender.sendRotate({
      trialId: "t1",
      slot: "rotateAB",
      request: buildS14RotateRequest({
        idToken: fakeToken("sub-a", auth.nonce),
        oldSubjectHash: HASH_A,
        newSubjectHash: HASH_B,
        expectedGeneration: 6,
      }),
    }),
    "s14_trial_mismatch"
  );
  assert.equal(calls.rotate.length, 0);
});
