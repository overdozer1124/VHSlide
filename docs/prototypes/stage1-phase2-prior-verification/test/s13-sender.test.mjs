// tools/s13-sender.mjs の検証（ローカルのみ）。
// 実行: node --test test/s13-sender.test.mjs
// （npm run test:s13 でも実行できる）
// 実 Google・実 Worker とは通信しない。偽の fetch で中継先を
// 模し、名前付きスロットごとの Cookie jar の分離・手順ごとの
// 対象の結び付け・スロットごとの固定世代・no-resend・送信窓・
// 排他を確認する。実 Worker との結線は test/s13-guard.test.mjs
// で確認する。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import { createS13Sender } from "../tools/s13-sender.mjs";
import {
  buildS13RevokeRequest,
  buildS13VerifyOnlyRequest,
} from "../tools/s13-revoke.mjs";

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
// 差し替える。失効の既定応答はスロットの世代で出し分ける
// （revokeC の対象 C は 200・世代6、revokeA の対象 A は 409
// last_operator を模すため、本体で判定する）。
function makeFakeRelay(handlers = {}) {
  const calls = { nonce: 0, revoke: [], verifyOnly: [] };
  let counter = 0;
  const fetchImpl = async (url, init = {}) => {
    if (url === RELAY + "/nonce") {
      counter += 1;
      calls.nonce += 1;
      const n = counter;
      if (handlers.nonce) return handlers.nonce(n);
      return jsonResponse(200, { nonce: `nonce-${n}` }, `op2_nonce_ctx=ctx-${n}; Path=/; HttpOnly`);
    }
    if (url === RELAY + "/admin/registry/revoke" || url === RELAY + "/admin/verify-only") {
      const record = {
        url,
        method: init.method,
        headers: init.headers,
        redirect: init.redirect,
        body: JSON.parse(init.body),
      };
      const list = url.endsWith("/revoke") ? calls.revoke : calls.verifyOnly;
      list.push(record);
      const handler = url.endsWith("/revoke") ? handlers.revoke : handlers.verifyOnly;
      if (handler) return handler(record, list.length);
      if (url.endsWith("/revoke")) {
        return record.body.subject_hash === HASH_A
          ? jsonResponse(409, { error: "last_operator" })
          : jsonResponse(200, { ok: true, generation: 6 });
      }
      return jsonResponse(200, { ok: true, generation: 6 });
    }
    throw new Error(`unexpected url: ${url}`);
  };
  return { calls, fetchImpl };
}

// 時計を注入できる送信器を作る補助。
function makeSender(handlers) {
  const relay = makeFakeRelay(handlers);
  let clock = 1000000;
  const sender = createS13Sender({
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
  const first = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
  assert.deepEqual(Object.keys(first), ["nonce"]);
  assert.equal(first.nonce, "nonce-1");
  assert.equal(JSON.stringify(first).includes("ctx-"), false);
  assert.equal(sender.slotIssuedAt("t1", "revokeC"), 1000000);
  assert.equal(sender.slotConsumed("t1", "revokeC"), false);
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "revokeC" }), "s13_slot_already_issued");
  await assertRejectsCode(sender.issueNonce({ trialId: "other", slot: "revokeA" }), "s13_trial_mismatch");
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "bogus" }), "s13_bad_slot");
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "targetC" }), "s13_bad_slot");
  assert.equal(calls.nonce, 1);
});

test("発行の失敗：スロットは空に戻り s13_nonce_issuance_failed", async () => {
  const { sender } = makeSender({ nonce: () => jsonResponse(500, { error: "boom" }) });
  sender.beginTrial("t1");
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "revokeC" }), "s13_nonce_issuance_failed");
  assert.equal(sender.slotIssuedAt("t1", "revokeC"), null);
});

test("失効送信（手順1）：revokeC の ctx だけで1回だけ送り、再送できない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
  sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C });
  const request = buildS13RevokeRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    subjectHash: HASH_C,
    expectedGeneration: 5,
  });
  const out = await sender.sendRevoke({ trialId: "t1", slot: "revokeC", request });
  assert.deepEqual(out, { status: 200, error: null, generation: 6 });
  assert.equal(calls.revoke.length, 1);
  assert.equal(calls.revoke[0].url, RELAY + "/admin/registry/revoke");
  assert.equal(calls.revoke[0].headers.Cookie, "op2_nonce_ctx=ctx-1");
  assert.equal(calls.revoke[0].headers.Origin, "http://localhost:8787");
  assert.equal(calls.revoke[0].redirect, "manual");
  assert.equal(calls.revoke[0].body.subject_hash, HASH_C);
  assert.equal(calls.revoke[0].body.expected_generation, 5);
  assert.equal(sender.slotConsumed("t1", "revokeC"), true);
  await assertRejectsCode(sender.sendRevoke({ trialId: "t1", slot: "revokeC", request }), "s13_not_prepared");
  assert.equal(calls.revoke.length, 1);
});

test("失効送信（手順2）：手順1の後にだけ固定でき、対象 A・世代 6 で送ると 409 last_operator が返る", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth1 = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
  const auth2 = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
  // 手順1の失効が送信される前は、手順2の対象は固定できない。
  assert.throws(
    () => sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeA", subjectHash: HASH_A }),
    (e) => e && e.code === "s13_not_prepared"
  );
  sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C });
  const out1 = await sender.sendRevoke({
    trialId: "t1",
    slot: "revokeC",
    request: buildS13RevokeRequest({
      idToken: fakeToken("sub-a", auth1.nonce),
      subjectHash: HASH_C,
      expectedGeneration: 5,
    }),
  });
  assert.equal(out1.status, 200);
  // 手順1の送信後なら手順2の対象を固定できる。
  sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeA", subjectHash: HASH_A });
  const out2 = await sender.sendRevoke({
    trialId: "t1",
    slot: "revokeA",
    request: buildS13RevokeRequest({
      idToken: fakeToken("sub-a", auth2.nonce),
      subjectHash: HASH_A,
      expectedGeneration: 6,
    }),
  });
  assert.deepEqual(out2, { status: 409, error: "last_operator", generation: null });
  assert.equal(calls.revoke.length, 2);
  assert.equal(calls.revoke[1].headers.Cookie, "op2_nonce_ctx=ctx-2");
  assert.equal(calls.revoke[1].body.subject_hash, HASH_A);
  assert.equal(calls.revoke[1].body.expected_generation, 6);
});

test("対象の結び付け：固定が無ければ失効を送らない（手順ごと）", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
  const request = buildS13RevokeRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    subjectHash: HASH_C,
    expectedGeneration: 5,
  });
  await assertRejectsCode(sender.sendRevoke({ trialId: "t1", slot: "revokeC", request }), "s13_revoke_not_frozen");
  assert.equal(calls.revoke.length, 0);
  assert.equal(sender.slotConsumed("t1", "revokeC"), false);
});

test("対象の結び付け：固定した対象と異なる要求は送らず、スロットも消費しない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
  sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C });
  // 対象だけが異なる要求（B の主体ハッシュ）。nonce・世代は正しい。
  const wrong = buildS13RevokeRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    subjectHash: HASH_B,
    expectedGeneration: 5,
  });
  await assertRejectsCode(sender.sendRevoke({ trialId: "t1", slot: "revokeC", request: wrong }), "s13_revoke_target_mismatch");
  assert.equal(calls.revoke.length, 0);
  assert.equal(sender.slotConsumed("t1", "revokeC"), false);
  // 拒否は送信ではない。固定した対象の要求はそのまま送れる。
  const right = buildS13RevokeRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    subjectHash: HASH_C,
    expectedGeneration: 5,
  });
  const out = await sender.sendRevoke({ trialId: "t1", slot: "revokeC", request: right });
  assert.equal(out.status, 200);
  assert.equal(calls.revoke.length, 1);
  assert.equal(calls.revoke[0].body.subject_hash, HASH_C);
});

test("対象の結び付け：手順1の固定は手順2に流用できない（手順ごとに独立）", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth1 = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
  const auth2 = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
  sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C });
  await sender.sendRevoke({
    trialId: "t1",
    slot: "revokeC",
    request: buildS13RevokeRequest({
      idToken: fakeToken("sub-a", auth1.nonce),
      subjectHash: HASH_C,
      expectedGeneration: 5,
    }),
  });
  // 手順2は未固定のため、対象が A で正しくても送られない。
  await assertRejectsCode(
    sender.sendRevoke({
      trialId: "t1",
      slot: "revokeA",
      request: buildS13RevokeRequest({
        idToken: fakeToken("sub-a", auth2.nonce),
        subjectHash: HASH_A,
        expectedGeneration: 6,
      }),
    }),
    "s13_revoke_not_frozen"
  );
  assert.equal(calls.revoke.length, 1);
  assert.equal(sender.slotConsumed("t1", "revokeA"), false);
});

test("対象の固定：同じ値の再登録は冪等、異なる値と形式違いは拒否、固定値は漏れない", async () => {
  const { sender } = makeSender();
  sender.beginTrial("t1");
  // revokeC の発行前には固定できない。
  assert.throws(
    () => sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C }),
    (e) => e && e.code === "s13_not_prepared"
  );
  await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
  // 形式が違う値は固定できない。
  assert.throws(
    () => sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: "xyz" }),
    (e) => e && e.code === "s13_revoke_target_fixed"
  );
  // checkA は失効に使わないため固定の対象外。
  assert.throws(
    () => sender.freezeRevokeTarget({ trialId: "t1", slot: "checkA", subjectHash: HASH_A }),
    (e) => e && e.code === "s13_bad_slot"
  );
  assert.equal(sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C }), true);
  assert.equal(sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C }), true);
  assert.throws(
    () => sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_A }),
    (e) => e && e.code === "s13_revoke_target_mismatch"
  );
  // snapshot には固定値そのものは出ない（固定済みかどうかだけ）。
  const snap = sender.snapshot();
  assert.equal(snap.revokeTargetsFrozen.revokeC, true);
  assert.equal(snap.revokeTargetsFrozen.revokeA, false);
  assert.equal(JSON.stringify(snap).includes(HASH_C), false);
});

test("失効送信：固定値の確認（期待世代はスロットごと・対象・nonce 一致・送信窓）", async () => {
  // 手順1で世代 6 を指定すると固定値（5）ではない。
  {
    const { sender, calls } = makeSender();
    sender.beginTrial("t1");
    const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
    sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C });
    const request = buildS13RevokeRequest({
      idToken: fakeToken("sub-a", auth.nonce),
      subjectHash: HASH_C,
      expectedGeneration: 6,
    });
    await assertRejectsCode(sender.sendRevoke({ trialId: "t1", slot: "revokeC", request }), "s13_unexpected_generation");
    assert.equal(calls.revoke.length, 0);
  }
  // 手順2で世代 5 を指定すると固定値（6）ではない。
  {
    const { sender, calls } = makeSender();
    sender.beginTrial("t1");
    const auth1 = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
    const auth2 = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
    sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C });
    await sender.sendRevoke({
      trialId: "t1",
      slot: "revokeC",
      request: buildS13RevokeRequest({
        idToken: fakeToken("sub-a", auth1.nonce),
        subjectHash: HASH_C,
        expectedGeneration: 5,
      }),
    });
    sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeA", subjectHash: HASH_A });
    const request = buildS13RevokeRequest({
      idToken: fakeToken("sub-a", auth2.nonce),
      subjectHash: HASH_A,
      expectedGeneration: 5,
    });
    await assertRejectsCode(sender.sendRevoke({ trialId: "t1", slot: "revokeA", request }), "s13_unexpected_generation");
    assert.equal(calls.revoke.length, 1);
  }
  // 対象が空。
  {
    const { sender, calls } = makeSender();
    sender.beginTrial("t1");
    const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
    await assertRejectsCode(
      sender.sendRevoke({
        trialId: "t1",
        slot: "revokeC",
        request: { id_token: fakeToken("sub-a", auth.nonce), subject_hash: "", expected_generation: 5 },
      }),
      "s13_revoke_target_fixed"
    );
    assert.equal(calls.revoke.length, 0);
  }
  // トークンの nonce がスロットと一致しない。
  {
    const { sender, calls } = makeSender();
    sender.beginTrial("t1");
    const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
    sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C });
    const request = buildS13RevokeRequest({
      idToken: fakeToken("sub-a", "nonce-999"),
      subjectHash: HASH_C,
      expectedGeneration: 5,
    });
    await assertRejectsCode(sender.sendRevoke({ trialId: "t1", slot: "revokeC", request }), "s13_slot_nonce_mismatch");
    assert.equal(calls.revoke.length, 0);
    assert.ok(auth.nonce);
  }
  // 送信窓を過ぎている。
  {
    const { sender, calls, setClock, getClock } = makeSender();
    sender.beginTrial("t1");
    const t0 = getClock();
    const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
    sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C });
    const request = buildS13RevokeRequest({
      idToken: fakeToken("sub-a", auth.nonce),
      subjectHash: HASH_C,
      expectedGeneration: 5,
    });
    setClock(t0 + 240000);
    await assertRejectsCode(sender.sendRevoke({ trialId: "t1", slot: "revokeC", request }), "s13_nonces_expired");
    assert.equal(calls.revoke.length, 0);
    assert.equal(sender.slotConsumed("t1", "revokeC"), false);
  }
});

test("提示送信：checkA の ctx で1回だけ送り、失効スロットは使えない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const check = await sender.issueNonce({ trialId: "t1", slot: "checkA" });
  const req = buildS13VerifyOnlyRequest({ idToken: fakeToken("sub-a", check.nonce) });
  const out = await sender.sendVerifyOnly({ trialId: "t1", slot: "checkA", request: req });
  assert.deepEqual(out, { status: 200, error: null, generation: 6 });
  assert.equal(calls.verifyOnly.length, 1);
  assert.equal(calls.verifyOnly[0].url, RELAY + "/admin/verify-only");
  assert.equal(calls.verifyOnly[0].headers.Cookie, "op2_nonce_ctx=ctx-1");
  assert.deepEqual(Object.keys(calls.verifyOnly[0].body), ["id_token"]);
  await assertRejectsCode(
    sender.sendVerifyOnly({ trialId: "t1", slot: "checkA", request: req }),
    "s13_not_prepared"
  );
  assert.equal(calls.verifyOnly.length, 1);
  // 失効スロットは verify-only に使えない。
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
  await assertRejectsCode(
    sender.sendVerifyOnly({
      trialId: "t1",
      slot: "revokeC",
      request: buildS13VerifyOnlyRequest({ idToken: fakeToken("sub-a", auth.nonce) }),
    }),
    "s13_bad_slot"
  );
  // checkA は失効に使えない。
  await assertRejectsCode(
    sender.sendRevoke({
      trialId: "t1",
      slot: "checkA",
      request: buildS13RevokeRequest({
        idToken: fakeToken("sub-a", check.nonce),
        subjectHash: HASH_C,
        expectedGeneration: 5,
      }),
    }),
    "s13_bad_slot"
  );
});

test("提示送信：送信窓超過は s13_nonces_expired で送信自体を拒否し、nonce 不一致は送らない", async () => {
  const { sender, calls, setClock, getClock } = makeSender();
  sender.beginTrial("t1");
  const t0 = getClock();
  const check = await sender.issueNonce({ trialId: "t1", slot: "checkA" });
  const req = buildS13VerifyOnlyRequest({ idToken: fakeToken("sub-a", check.nonce) });
  setClock(t0 + 240000);
  await assertRejectsCode(
    sender.sendVerifyOnly({ trialId: "t1", slot: "checkA", request: req }),
    "s13_nonces_expired"
  );
  assert.equal(calls.verifyOnly.length, 0);
  assert.equal(sender.slotConsumed("t1", "checkA"), false);
  const bad = buildS13VerifyOnlyRequest({ idToken: fakeToken("sub-a", "nonce-999") });
  await assertRejectsCode(
    sender.sendVerifyOnly({ trialId: "t1", slot: "checkA", request: bad }),
    "s13_slot_nonce_mismatch"
  );
  assert.equal(calls.verifyOnly.length, 0);
});

test("応答の正規化：例外は no_response、3xx は redirect_not_followed、未知コードは unexpected_error", async () => {
  // fetch 例外。
  {
    const { sender } = makeSender({
      revoke: () => {
        throw new Error("network down");
      },
    });
    sender.beginTrial("t1");
    const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
    sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C });
    const out = await sender.sendRevoke({
      trialId: "t1",
      slot: "revokeC",
      request: buildS13RevokeRequest({
        idToken: fakeToken("sub-a", auth.nonce),
        subjectHash: HASH_C,
        expectedGeneration: 5,
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
    const check = await sender.issueNonce({ trialId: "t1", slot: "checkA" });
    const out = await sender.sendVerifyOnly({
      trialId: "t1",
      slot: "checkA",
      request: buildS13VerifyOnlyRequest({ idToken: fakeToken("sub-a", check.nonce) }),
    });
    assert.deepEqual(out, { status: 302, error: "redirect_not_followed", generation: null });
  }
  // 未知の理由コード。
  {
    const { sender } = makeSender({
      verifyOnly: () => jsonResponse(500, { error: "internal_detail_xyz" }),
    });
    sender.beginTrial("t1");
    const check = await sender.issueNonce({ trialId: "t1", slot: "checkA" });
    const out = await sender.sendVerifyOnly({
      trialId: "t1",
      slot: "checkA",
      request: buildS13VerifyOnlyRequest({ idToken: fakeToken("sub-a", check.nonce) }),
    });
    assert.equal(out.status, 500);
    assert.equal(out.error, "unexpected_error");
  }
});

test("Cookie の分離：3スロットはそれぞれ別の ctx を持ち、送信は自分の ctx だけを使う", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth1 = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
  const auth2 = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
  const check = await sender.issueNonce({ trialId: "t1", slot: "checkA" });
  const snap = sender.snapshot();
  assert.equal(snap.slots.revokeC.ctxLen > 0, true);
  sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C });
  await sender.sendRevoke({
    trialId: "t1",
    slot: "revokeC",
    request: buildS13RevokeRequest({
      idToken: fakeToken("sub-a", auth1.nonce),
      subjectHash: HASH_C,
      expectedGeneration: 5,
    }),
  });
  sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeA", subjectHash: HASH_A });
  await sender.sendRevoke({
    trialId: "t1",
    slot: "revokeA",
    request: buildS13RevokeRequest({
      idToken: fakeToken("sub-a", auth2.nonce),
      subjectHash: HASH_A,
      expectedGeneration: 6,
    }),
  });
  await sender.sendVerifyOnly({
    trialId: "t1",
    slot: "checkA",
    request: buildS13VerifyOnlyRequest({ idToken: fakeToken("sub-a", check.nonce) }),
  });
  assert.equal(calls.revoke[0].headers.Cookie, "op2_nonce_ctx=ctx-1");
  assert.equal(calls.revoke[1].headers.Cookie, "op2_nonce_ctx=ctx-2");
  assert.equal(calls.verifyOnly[0].headers.Cookie, "op2_nonce_ctx=ctx-3");
});

test("排他：送信の飛行中は別の送信・発行ができない", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { sender } = makeSender({
    revoke: async () => {
      await gate;
      return jsonResponse(200, { ok: true, generation: 6 });
    },
  });
  sender.beginTrial("t1");
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
  sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C });
  const pending = sender.sendRevoke({
    trialId: "t1",
    slot: "revokeC",
    request: buildS13RevokeRequest({
      idToken: fakeToken("sub-a", auth.nonce),
      subjectHash: HASH_C,
      expectedGeneration: 5,
    }),
  });
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "revokeA" }), "s13_sender_busy");
  release();
  const out = await pending;
  assert.equal(out.status, 200);
});

test("破棄：discard で状態が消え、旧試行の送信はできない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeC" });
  sender.freezeRevokeTarget({ trialId: "t1", slot: "revokeC", subjectHash: HASH_C });
  sender.discard();
  assert.equal(sender.snapshot(), null);
  await assertRejectsCode(
    sender.sendRevoke({
      trialId: "t1",
      slot: "revokeC",
      request: buildS13RevokeRequest({
        idToken: fakeToken("sub-a", auth.nonce),
        subjectHash: HASH_C,
        expectedGeneration: 5,
      }),
    }),
    "s13_trial_mismatch"
  );
  assert.equal(calls.revoke.length, 0);
});
