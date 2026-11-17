// tools/s12-sender.mjs の検証（ローカルのみ）。
// 実行: node --test test/s12-sender.test.mjs
// （npm run test:s12 でも実行できる）
// 実 Google・実 Worker とは通信しない。偽の fetch で中継先を
// 模し、名前付きスロットごとの Cookie jar の分離・保持トークン
// の鮮度ゲート・no-resend・送信窓・排他を確認する。実 Worker
// との結線は test/s12-guard.test.mjs で確認する。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import { createS12Sender } from "../tools/s12-sender.mjs";
import {
  buildS12RevokeRequest,
  buildS12VerifyOnlyRequest,
} from "../tools/s12-revoke.mjs";

const RELAY = "http://127.0.0.1:8799";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

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
// 差し替える。
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
      if (url.endsWith("/revoke")) return jsonResponse(200, { ok: true, generation: 5 });
      return jsonResponse(403, { error: "not_operator" });
    }
    throw new Error(`unexpected url: ${url}`);
  };
  return { calls, fetchImpl };
}

// 時計を注入できる送信器を作る補助。
function makeSender(handlers) {
  const relay = makeFakeRelay(handlers);
  let clock = 1000000;
  const sender = createS12Sender({
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
  const held = await sender.issueNonce({ trialId: "t1", slot: "heldB" });
  assert.deepEqual(Object.keys(held), ["nonce"]);
  assert.equal(held.nonce, "nonce-1");
  assert.equal(JSON.stringify(held).includes("ctx-"), false);
  assert.equal(sender.slotIssuedAt("t1", "heldB"), 1000000);
  assert.equal(sender.slotConsumed("t1", "heldB"), false);
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "heldB" }), "s12_slot_already_issued");
  await assertRejectsCode(sender.issueNonce({ trialId: "other", slot: "freshB" }), "s12_trial_mismatch");
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "bogus" }), "s12_bad_slot");
  assert.equal(calls.nonce, 1);
});

test("発行の失敗：スロットは空に戻り s12_nonce_issuance_failed", async () => {
  const { sender } = makeSender({ nonce: () => jsonResponse(500, { error: "boom" }) });
  sender.beginTrial("t1");
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "heldB" }), "s12_nonce_issuance_failed");
  assert.equal(sender.slotIssuedAt("t1", "heldB"), null);
});

test("失効送信：revokeA の ctx だけで1回だけ送り、再送できない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const held = await sender.issueNonce({ trialId: "t1", slot: "heldB" });
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
  assert.equal(held.nonce, "nonce-1");
  assert.equal(auth.nonce, "nonce-2");
  sender.freezeRevokeTarget({ trialId: "t1", subjectHash: HASH_B });
  const request = buildS12RevokeRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    subjectHash: HASH_B,
    expectedGeneration: 4,
  });
  const out = await sender.sendRevoke({ trialId: "t1", request });
  assert.deepEqual(out, { status: 200, error: null, generation: 5 });
  assert.equal(calls.revoke.length, 1);
  assert.equal(calls.revoke[0].url, RELAY + "/admin/registry/revoke");
  assert.equal(calls.revoke[0].headers.Cookie, "op2_nonce_ctx=ctx-2");
  assert.equal(calls.revoke[0].headers.Origin, "http://localhost:8787");
  assert.equal(calls.revoke[0].redirect, "manual");
  assert.equal(calls.revoke[0].body.subject_hash, HASH_B);
  assert.equal(calls.revoke[0].body.expected_generation, 4);
  assert.equal(sender.slotConsumed("t1", "revokeA"), true);
  assert.equal(sender.slotConsumed("t1", "heldB"), false);
  await assertRejectsCode(sender.sendRevoke({ trialId: "t1", request }), "s12_not_prepared");
  assert.equal(calls.revoke.length, 1);
});

test("失効送信：保持トークン未確保では送らない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
  const request = buildS12RevokeRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    subjectHash: HASH_B,
    expectedGeneration: 4,
  });
  await assertRejectsCode(sender.sendRevoke({ trialId: "t1", request }), "s12_not_prepared");
  assert.equal(calls.revoke.length, 0);
});

test("保持トークンの鮮度ゲート：上限超過では失効を送らず、境界では送る", async () => {
  const { sender, calls, setClock, getClock } = makeSender();
  sender.beginTrial("t1");
  const t0 = getClock();
  await sender.issueNonce({ trialId: "t1", slot: "heldB" });
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
  sender.freezeRevokeTarget({ trialId: "t1", subjectHash: HASH_B });
  const request = buildS12RevokeRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    subjectHash: HASH_B,
    expectedGeneration: 4,
  });
  setClock(t0 + 120001);
  await assertRejectsCode(sender.sendRevoke({ trialId: "t1", request }), "s12_held_token_stale");
  assert.equal(calls.revoke.length, 0);
  // 拒否は送信ではない。時計を境界に戻せば同じ要求を送れる
  // （実運用では破棄して再取得するが、送信器の消費は起きて
  // いないことの確認）。
  setClock(t0 + 120000);
  const out = await sender.sendRevoke({ trialId: "t1", request });
  assert.equal(out.status, 200);
  assert.equal(calls.revoke.length, 1);
});

test("失効送信：固定値の確認（期待世代・対象・nonce 一致・送信窓）", async () => {
  // 期待世代が固定値でない。
  {
    const { sender, calls } = makeSender();
    sender.beginTrial("t1");
    await sender.issueNonce({ trialId: "t1", slot: "heldB" });
    const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
    sender.freezeRevokeTarget({ trialId: "t1", subjectHash: HASH_B });
    const request = buildS12RevokeRequest({
      idToken: fakeToken("sub-a", auth.nonce),
      subjectHash: HASH_B,
      expectedGeneration: 3,
    });
    await assertRejectsCode(sender.sendRevoke({ trialId: "t1", request }), "s12_unexpected_generation");
    assert.equal(calls.revoke.length, 0);
  }
  // 対象が空。
  {
    const { sender, calls } = makeSender();
    sender.beginTrial("t1");
    await sender.issueNonce({ trialId: "t1", slot: "heldB" });
    const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
    await assertRejectsCode(
      sender.sendRevoke({
        trialId: "t1",
        request: { id_token: fakeToken("sub-a", auth.nonce), subject_hash: "", expected_generation: 4 },
      }),
      "s12_revoke_target_fixed"
    );
    assert.equal(calls.revoke.length, 0);
  }
  // トークンの nonce がスロットと一致しない。
  {
    const { sender, calls } = makeSender();
    sender.beginTrial("t1");
    await sender.issueNonce({ trialId: "t1", slot: "heldB" });
    const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
    const request = buildS12RevokeRequest({
      idToken: fakeToken("sub-a", "nonce-999"),
      subjectHash: HASH_B,
      expectedGeneration: 4,
    });
    await assertRejectsCode(sender.sendRevoke({ trialId: "t1", request }), "s12_slot_nonce_mismatch");
    assert.equal(calls.revoke.length, 0);
    assert.ok(auth.nonce);
  }
  // revokeA の送信窓を過ぎている（保持トークンは新しい）。
  {
    const { sender, calls, setClock, getClock } = makeSender();
    sender.beginTrial("t1");
    const t0 = getClock();
    const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
    setClock(t0 + 130000);
    await sender.issueNonce({ trialId: "t1", slot: "heldB" });
    sender.freezeRevokeTarget({ trialId: "t1", subjectHash: HASH_B });
    const request = buildS12RevokeRequest({
      idToken: fakeToken("sub-a", auth.nonce),
      subjectHash: HASH_B,
      expectedGeneration: 4,
    });
    setClock(t0 + 240000);
    await assertRejectsCode(sender.sendRevoke({ trialId: "t1", request }), "s12_nonces_expired");
    assert.equal(calls.revoke.length, 0);
  }
});

test("対象の結び付け：固定が無ければ失効を送らない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  await sender.issueNonce({ trialId: "t1", slot: "heldB" });
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
  const request = buildS12RevokeRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    subjectHash: HASH_B,
    expectedGeneration: 4,
  });
  // freezeRevokeTarget を呼んでいないため、要求の形が正しくても
  // 送信器の境界で拒否され、1件も送られない。
  await assertRejectsCode(sender.sendRevoke({ trialId: "t1", request }), "s12_revoke_not_frozen");
  assert.equal(calls.revoke.length, 0);
  assert.equal(sender.slotConsumed("t1", "revokeA"), false);
});

test("対象の結び付け：固定した対象と異なる要求は送らず、スロットも消費しない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  await sender.issueNonce({ trialId: "t1", slot: "heldB" });
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
  sender.freezeRevokeTarget({ trialId: "t1", subjectHash: HASH_B });
  // 対象だけが異なる要求（A の主体ハッシュ）。nonce・世代は正しい。
  const wrong = buildS12RevokeRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    subjectHash: HASH_A,
    expectedGeneration: 4,
  });
  await assertRejectsCode(sender.sendRevoke({ trialId: "t1", request: wrong }), "s12_revoke_target_mismatch");
  assert.equal(calls.revoke.length, 0);
  assert.equal(sender.slotConsumed("t1", "revokeA"), false);
  // 拒否は送信ではない。固定した対象の要求はそのまま送れる。
  const right = buildS12RevokeRequest({
    idToken: fakeToken("sub-a", auth.nonce),
    subjectHash: HASH_B,
    expectedGeneration: 4,
  });
  const out = await sender.sendRevoke({ trialId: "t1", request: right });
  assert.equal(out.status, 200);
  assert.equal(calls.revoke.length, 1);
  assert.equal(calls.revoke[0].body.subject_hash, HASH_B);
});

test("対象の固定：同じ値の再登録は冪等、異なる値と形式違いは拒否、固定値は漏れない", async () => {
  const { sender } = makeSender();
  sender.beginTrial("t1");
  // heldB の発行前には固定できない。
  assert.throws(
    () => sender.freezeRevokeTarget({ trialId: "t1", subjectHash: HASH_B }),
    (e) => e && e.code === "s12_not_prepared"
  );
  await sender.issueNonce({ trialId: "t1", slot: "heldB" });
  // 形式が違う値は固定できない。
  assert.throws(
    () => sender.freezeRevokeTarget({ trialId: "t1", subjectHash: "xyz" }),
    (e) => e && e.code === "s12_revoke_target_fixed"
  );
  assert.equal(sender.freezeRevokeTarget({ trialId: "t1", subjectHash: HASH_B }), true);
  assert.equal(sender.freezeRevokeTarget({ trialId: "t1", subjectHash: HASH_B }), true);
  assert.throws(
    () => sender.freezeRevokeTarget({ trialId: "t1", subjectHash: HASH_A }),
    (e) => e && e.code === "s12_revoke_target_mismatch"
  );
  // snapshot には固定値そのものは出ない（固定済みかどうかだけ）。
  const snap = sender.snapshot();
  assert.equal(snap.revokeTargetFrozen, true);
  assert.equal(JSON.stringify(snap).includes(HASH_B), false);
});

test("提示送信：スロットの ctx で1回だけ送り、revokeA は使えない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const held = await sender.issueNonce({ trialId: "t1", slot: "heldB" });
  const fresh = await sender.issueNonce({ trialId: "t1", slot: "freshB" });
  const freshReq = buildS12VerifyOnlyRequest({ idToken: fakeToken("sub-b", fresh.nonce) });
  const out = await sender.sendVerifyOnly({ trialId: "t1", slot: "freshB", request: freshReq });
  assert.deepEqual(out, { status: 403, error: "not_operator", generation: null });
  assert.equal(calls.verifyOnly.length, 1);
  assert.equal(calls.verifyOnly[0].url, RELAY + "/admin/verify-only");
  assert.equal(calls.verifyOnly[0].headers.Cookie, "op2_nonce_ctx=ctx-2");
  assert.deepEqual(Object.keys(calls.verifyOnly[0].body), ["id_token"]);
  await assertRejectsCode(
    sender.sendVerifyOnly({ trialId: "t1", slot: "freshB", request: freshReq }),
    "s12_not_prepared"
  );
  assert.equal(calls.verifyOnly.length, 1);
  // revokeA は失効専用。
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
  await assertRejectsCode(
    sender.sendVerifyOnly({
      trialId: "t1",
      slot: "revokeA",
      request: buildS12VerifyOnlyRequest({ idToken: fakeToken("sub-a", auth.nonce) }),
    }),
    "s12_bad_slot"
  );
  // heldB は保持のまま残っている（手順4で使う）。
  assert.equal(sender.slotConsumed("t1", "heldB"), false);
  assert.ok(held.nonce);
});

test("提示送信：保持トークンの送信窓超過は s12_nonces_expired で送信自体を拒否", async () => {
  const { sender, calls, setClock, getClock } = makeSender();
  sender.beginTrial("t1");
  const t0 = getClock();
  const held = await sender.issueNonce({ trialId: "t1", slot: "heldB" });
  const req = buildS12VerifyOnlyRequest({ idToken: fakeToken("sub-b", held.nonce) });
  setClock(t0 + 240000);
  await assertRejectsCode(
    sender.sendVerifyOnly({ trialId: "t1", slot: "heldB", request: req }),
    "s12_nonces_expired"
  );
  assert.equal(calls.verifyOnly.length, 0);
  assert.equal(sender.slotConsumed("t1", "heldB"), false);
});

test("提示送信：nonce 不一致は送らない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  await sender.issueNonce({ trialId: "t1", slot: "freshB" });
  const req = buildS12VerifyOnlyRequest({ idToken: fakeToken("sub-b", "nonce-999") });
  await assertRejectsCode(
    sender.sendVerifyOnly({ trialId: "t1", slot: "freshB", request: req }),
    "s12_slot_nonce_mismatch"
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
    await sender.issueNonce({ trialId: "t1", slot: "heldB" });
    const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
    sender.freezeRevokeTarget({ trialId: "t1", subjectHash: HASH_B });
    const out = await sender.sendRevoke({
      trialId: "t1",
      request: buildS12RevokeRequest({
        idToken: fakeToken("sub-a", auth.nonce),
        subjectHash: HASH_B,
        expectedGeneration: 4,
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
    const fresh = await sender.issueNonce({ trialId: "t1", slot: "freshB" });
    const out = await sender.sendVerifyOnly({
      trialId: "t1",
      slot: "freshB",
      request: buildS12VerifyOnlyRequest({ idToken: fakeToken("sub-b", fresh.nonce) }),
    });
    assert.deepEqual(out, { status: 302, error: "redirect_not_followed", generation: null });
  }
  // 未知の理由コード。
  {
    const { sender } = makeSender({
      verifyOnly: () => jsonResponse(500, { error: "internal_detail_xyz" }),
    });
    sender.beginTrial("t1");
    const fresh = await sender.issueNonce({ trialId: "t1", slot: "freshB" });
    const out = await sender.sendVerifyOnly({
      trialId: "t1",
      slot: "freshB",
      request: buildS12VerifyOnlyRequest({ idToken: fakeToken("sub-b", fresh.nonce) }),
    });
    assert.equal(out.status, 500);
    assert.equal(out.error, "unexpected_error");
  }
});

test("Cookie の分離：4スロットはそれぞれ別の ctx を持ち、送信は自分の ctx だけを使う", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  const held = await sender.issueNonce({ trialId: "t1", slot: "heldB" });
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
  const fresh = await sender.issueNonce({ trialId: "t1", slot: "freshB" });
  const check = await sender.issueNonce({ trialId: "t1", slot: "checkC" });
  const snap = sender.snapshot();
  assert.equal(snap.slots.heldB.ctxLen > 0, true);
  sender.freezeRevokeTarget({ trialId: "t1", subjectHash: HASH_B });
  await sender.sendRevoke({
    trialId: "t1",
    request: buildS12RevokeRequest({
      idToken: fakeToken("sub-a", auth.nonce),
      subjectHash: HASH_B,
      expectedGeneration: 4,
    }),
  });
  await sender.sendVerifyOnly({
    trialId: "t1",
    slot: "freshB",
    request: buildS12VerifyOnlyRequest({ idToken: fakeToken("sub-b", fresh.nonce) }),
  });
  await sender.sendVerifyOnly({
    trialId: "t1",
    slot: "heldB",
    request: buildS12VerifyOnlyRequest({ idToken: fakeToken("sub-b", held.nonce) }),
  });
  await sender.sendVerifyOnly({
    trialId: "t1",
    slot: "checkC",
    request: buildS12VerifyOnlyRequest({ idToken: fakeToken("sub-c", check.nonce) }),
  });
  assert.equal(calls.revoke[0].headers.Cookie, "op2_nonce_ctx=ctx-2");
  assert.equal(calls.verifyOnly[0].headers.Cookie, "op2_nonce_ctx=ctx-3");
  assert.equal(calls.verifyOnly[1].headers.Cookie, "op2_nonce_ctx=ctx-1");
  assert.equal(calls.verifyOnly[2].headers.Cookie, "op2_nonce_ctx=ctx-4");
});

test("排他：送信の飛行中は別の送信・発行ができない", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { sender } = makeSender({
    revoke: async () => {
      await gate;
      return jsonResponse(200, { ok: true, generation: 5 });
    },
  });
  sender.beginTrial("t1");
  await sender.issueNonce({ trialId: "t1", slot: "heldB" });
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
  sender.freezeRevokeTarget({ trialId: "t1", subjectHash: HASH_B });
  const pending = sender.sendRevoke({
    trialId: "t1",
    request: buildS12RevokeRequest({
      idToken: fakeToken("sub-a", auth.nonce),
      subjectHash: HASH_B,
      expectedGeneration: 4,
    }),
  });
  await assertRejectsCode(sender.issueNonce({ trialId: "t1", slot: "freshB" }), "s12_sender_busy");
  release();
  const out = await pending;
  assert.equal(out.status, 200);
});

test("破棄：discard で状態が消え、旧試行の送信はできない", async () => {
  const { sender, calls } = makeSender();
  sender.beginTrial("t1");
  await sender.issueNonce({ trialId: "t1", slot: "heldB" });
  const auth = await sender.issueNonce({ trialId: "t1", slot: "revokeA" });
  sender.discard();
  assert.equal(sender.snapshot(), null);
  await assertRejectsCode(
    sender.sendRevoke({
      trialId: "t1",
      request: buildS12RevokeRequest({
        idToken: fakeToken("sub-a", auth.nonce),
        subjectHash: HASH_B,
        expectedGeneration: 4,
      }),
    }),
    "s12_trial_mismatch"
  );
  assert.equal(calls.revoke.length, 0);
});
