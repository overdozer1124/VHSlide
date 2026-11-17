// tools/s11-sender.mjs の検証（ローカルのみ）。
// 実行: node --test test/s11-sender.test.mjs
// （npm run test:s11 でも実行できる）
// 実 Google・実 Worker とは通信しない。偽の fetch で中継先を模し、
// スロットごとの Cookie jar の分離・同時送信・結び付け確認・
// no-resend・期限・排他を確認する。実 Worker との結線は
// test/s11-guard.test.mjs で確認する。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import { createS11Sender } from "../tools/s11-sender.mjs";
import { buildS11Request, buildS11Requests } from "../tools/s11-parallel.mjs";

const RELAY = "http://127.0.0.1:8798";
const HASH_C = "c".repeat(64);

// 偽の JWT（署名検証はしない。ペイロードの nonce クレームだけを
// 送信器が読む）。実トークンではない。
function fakeToken(sub, nonce) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT", kid: "fake" })}.${b64({ sub, nonce })}.fakesig`;
}

// 偽の中継。/nonce は呼び出しごとに異なる nonce と ctx を返し、
// /admin/registry/add への送信を記録する。addHandler で応答を
// 場面ごとに差し替える。
function makeFakeRelay({ addHandler } = {}) {
  const calls = { nonce: 0, add: [] };
  let counter = 0;
  const fetchImpl = async (url, init = {}) => {
    if (url === RELAY + "/nonce") {
      counter += 1;
      const n = counter;
      calls.nonce += 1;
      return {
        ok: true,
        status: 200,
        headers: {
          getSetCookie: () => [`op2_nonce_ctx=ctx-${n}; Path=/; HttpOnly`],
        },
        json: async () => ({ nonce: `nonce-${n}` }),
      };
    }
    if (url === RELAY + "/admin/registry/add") {
      const record = {
        url,
        method: init.method,
        headers: init.headers,
        redirect: init.redirect,
        body: JSON.parse(init.body),
      };
      calls.add.push(record);
      if (addHandler) return addHandler(record, calls.add.length);
      // 既定は手順3の期待応答（409 stale_generation）。
      return {
        ok: false,
        status: 409,
        headers: { getSetCookie: () => [] },
        json: async () => ({ error: "stale_generation" }),
      };
    }
    throw new Error(`unexpected url: ${url}`);
  };
  return { calls, fetchImpl };
}

test("送信器：stale の発行は nonce だけを返し、送信はそのスロットの ctx だけで行う", async () => {
  const { calls, fetchImpl } = makeFakeRelay();
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl });
  const nonces = await sender.issueNonces({ trialId: "t1", procedure: "stale" });
  assert.deepEqual(nonces, ["nonce-1"]);
  assert.equal(JSON.stringify(nonces).includes("ctx-"), false);
  assert.equal(sender.isPrepared(), true);
  const request = buildS11Request({
    idToken: fakeToken("sub-a", "nonce-1"),
    subjectHash: HASH_C,
    expectedGeneration: 2,
  });
  const out = await sender.sendStale({ trialId: "t1", request });
  assert.equal(out.procedure, "stale");
  assert.equal(out.result.status, 409);
  assert.equal(out.result.error, "stale_generation");
  assert.equal(calls.add.length, 1);
  assert.equal(calls.add[0].headers.Cookie, "op2_nonce_ctx=ctx-1");
  assert.equal(calls.add[0].headers.Origin, "http://localhost:8787");
  assert.equal(calls.add[0].redirect, "manual");
  assert.equal(calls.add[0].body.subject_hash, HASH_C);
  assert.equal(calls.add[0].body.expected_generation, 2);
  // 送信後は保持が破棄され、同じ枠は再送できない。
  assert.equal(sender.isPrepared(), false);
  await assert.rejects(
    () => sender.sendStale({ trialId: "t1", request }),
    (e) => e.code === "s11_not_prepared"
  );
  assert.equal(calls.add.length, 1);
});

test("送信器：concurrent の2件は別々の ctx で同時に送信され、片方だけの先行送信は起きない", async () => {
  const started = [];
  const resolvers = [];
  const { calls, fetchImpl } = makeFakeRelay({
    addHandler: (record) => {
      started.push(record.headers.Cookie);
      // 勝者はスロット0（nonce-1 を含むトークン）とする。
      const winner = record.headers.Cookie === "op2_nonce_ctx=ctx-1";
      return new Promise((resolve) => {
        resolvers.push(() =>
          resolve({
            ok: winner,
            status: winner ? 200 : 409,
            headers: { getSetCookie: () => [] },
            json: async () =>
              winner ? { ok: true, generation: 4 } : { error: "stale_generation" },
          })
        );
      });
    },
  });
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl });
  const nonces = await sender.issueNonces({ trialId: "t2", procedure: "concurrent" });
  assert.deepEqual(nonces, ["nonce-1", "nonce-2"]);
  const requests = buildS11Requests({
    tokens: [fakeToken("sub-a", nonces[0]), fakeToken("sub-a", nonces[1])],
    subjectHash: HASH_C,
    expectedGeneration: 3,
  });
  const sendPromise = sender.sendConcurrent({ trialId: "t2", requests });
  // 両件の fetch が、どちらの応答も返す前に開始されていること
  // （同時送信の担保：片方の結果を見てから他方を送る逐次化がない）。
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(started.length, 2);
  assert.deepEqual([...started].sort(), ["op2_nonce_ctx=ctx-1", "op2_nonce_ctx=ctx-2"]);
  for (const resolve of resolvers) resolve();
  const out = await sendPromise;
  assert.equal(calls.add.length, 2);
  // スロット0の Cookie は ctx-1、スロット1は ctx-2（取り違えなし）。
  assert.equal(calls.add[0].headers.Cookie, "op2_nonce_ctx=ctx-1");
  assert.equal(calls.add[1].headers.Cookie, "op2_nonce_ctx=ctx-2");
  const ok = out.results.filter((r) => r.status === 200 && r.generation === 4);
  const stale = out.results.filter((r) => r.status === 409 && r.error === "stale_generation");
  assert.equal(ok.length, 1);
  assert.equal(stale.length, 1);
  assert.equal(out.aggregate.ok, true);
  assert.equal(sender.isPrepared(), false);
});

test("送信器：トークンとスロットの nonce 結び付けが異なれば送信しない", async () => {
  const { calls, fetchImpl } = makeFakeRelay();
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl });
  const nonces = await sender.issueNonces({ trialId: "t3", procedure: "concurrent" });
  // スロットを取り違えたトークン（nonce が逆）。
  const requests = buildS11Requests({
    tokens: [fakeToken("sub-a", nonces[1]), fakeToken("sub-a", nonces[0])],
    subjectHash: HASH_C,
    expectedGeneration: 3,
  });
  await assert.rejects(
    () => sender.sendConcurrent({ trialId: "t3", requests }),
    (e) => e.code === "slot_nonce_mismatch"
  );
  assert.equal(calls.add.length, 0);
  // 発行状態は消費されていない（再準備なしで正しい送信ができる）。
  assert.equal(sender.isPrepared(), true);
});

test("送信器：2件の要求が同一でなければ送信しない", async () => {
  const { calls, fetchImpl } = makeFakeRelay();
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl });
  const nonces = await sender.issueNonces({ trialId: "t4", procedure: "concurrent" });
  const requests = [
    { id_token: fakeToken("sub-a", nonces[0]), subject_hash: HASH_C, expected_generation: 3 },
    { id_token: fakeToken("sub-a", nonces[1]), subject_hash: "b".repeat(64), expected_generation: 3 },
  ];
  await assert.rejects(
    () => sender.sendConcurrent({ trialId: "t4", requests }),
    (e) => e.code === "s11_requests_differ"
  );
  assert.equal(calls.add.length, 0);
});

test("送信器：同一トークンの2件は送信しない（nonce の交絡防止）", async () => {
  const { calls, fetchImpl } = makeFakeRelay();
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl });
  const nonces = await sender.issueNonces({ trialId: "t5", procedure: "concurrent" });
  const same = fakeToken("sub-a", nonces[0]);
  const requests = [
    { id_token: same, subject_hash: HASH_C, expected_generation: 3 },
    { id_token: same, subject_hash: HASH_C, expected_generation: 3 },
  ];
  await assert.rejects(
    () => sender.sendConcurrent({ trialId: "t5", requests }),
    (e) => e.code === "s11_tokens_not_distinct"
  );
  assert.equal(calls.add.length, 0);
});

test("送信器：期待世代が手順の固定値でなければ送信しない", async () => {
  const { calls, fetchImpl } = makeFakeRelay();
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl });
  await sender.issueNonces({ trialId: "t6", procedure: "stale" });
  const badStale = buildS11Request({
    idToken: fakeToken("sub-a", "nonce-1"),
    subjectHash: HASH_C,
    expectedGeneration: 3,
  });
  await assert.rejects(
    () => sender.sendStale({ trialId: "t6", request: badStale }),
    (e) => e.code === "s11_bad_expected_generation"
  );
  assert.equal(calls.add.length, 0);
  const sender2 = createS11Sender({ relayUrl: RELAY, fetchImpl });
  const nonces = await sender2.issueNonces({ trialId: "t6b", procedure: "concurrent" });
  const badConc = buildS11Requests({
    tokens: [fakeToken("sub-a", nonces[0]), fakeToken("sub-a", nonces[1])],
    subjectHash: HASH_C,
    expectedGeneration: 2,
  });
  await assert.rejects(
    () => sender2.sendConcurrent({ trialId: "t6b", requests: badConc }),
    (e) => e.code === "s11_bad_expected_generation"
  );
  assert.equal(calls.add.length, 0);
});

test("送信器：試行 ID・手順が発行と一致しなければ送信しない", async () => {
  const { calls, fetchImpl } = makeFakeRelay();
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl });
  await sender.issueNonces({ trialId: "t7", procedure: "stale" });
  const request = buildS11Request({
    idToken: fakeToken("sub-a", "nonce-1"),
    subjectHash: HASH_C,
    expectedGeneration: 2,
  });
  await assert.rejects(
    () => sender.sendStale({ trialId: "other-trial", request }),
    (e) => e.code === "s11_trial_mismatch"
  );
  await assert.rejects(
    () =>
      sender.sendConcurrent({
        trialId: "t7",
        requests: buildS11Requests({
          tokens: [fakeToken("sub-a", "nonce-1"), fakeToken("sub-a", "nonce-2")],
          subjectHash: HASH_C,
          expectedGeneration: 3,
        }),
      }),
    (e) => e.code === "s11_procedure_mismatch"
  );
  assert.equal(calls.add.length, 0);
});

test("送信器：発行開始から4分を過ぎた送信は拒否し、Worker の状態は消費されない", async () => {
  const { calls, fetchImpl } = makeFakeRelay();
  let clock = 1_000_000;
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl, now: () => clock });
  await sender.issueNonces({ trialId: "t8", procedure: "stale" });
  clock += 4 * 60 * 1000 + 1;
  const request = buildS11Request({
    idToken: fakeToken("sub-a", "nonce-1"),
    subjectHash: HASH_C,
    expectedGeneration: 2,
  });
  await assert.rejects(
    () => sender.sendStale({ trialId: "t8", request }),
    (e) => e.code === "s11_nonces_expired"
  );
  assert.equal(calls.add.length, 0);
  assert.equal(sender.isPrepared(), false);
});

test("送信器：発行中・送信中は並行する発行・送信を拒否する", async () => {
  let releaseNonce;
  const gate = new Promise((r) => { releaseNonce = r; });
  let nonceCount = 0;
  const fetchImpl = async (url) => {
    if (url === RELAY + "/nonce") {
      nonceCount += 1;
      await gate;
      return {
        ok: true,
        status: 200,
        headers: { getSetCookie: () => ["op2_nonce_ctx=ctx-g; Path=/; HttpOnly"] },
        json: async () => ({ nonce: "nonce-g" }),
      };
    }
    throw new Error("unexpected");
  };
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl });
  const issuing = sender.issueNonces({ trialId: "t9", procedure: "stale" });
  await assert.rejects(
    () => sender.issueNonces({ trialId: "t9", procedure: "stale" }),
    (e) => e.code === "s11_busy"
  );
  await assert.rejects(
    () =>
      sender.sendStale({
        trialId: "t9",
        request: buildS11Request({
          idToken: fakeToken("sub-a", "nonce-g"),
          subjectHash: HASH_C,
          expectedGeneration: 2,
        }),
      }),
    (e) => e.code === "s11_busy"
  );
  releaseNonce();
  const nonces = await issuing;
  assert.deepEqual(nonces, ["nonce-g"]);
  assert.equal(nonceCount, 1);
});

test("送信器：3xx の応答は追従せず redirect_not_followed として記録する", async () => {
  const { fetchImpl } = makeFakeRelay({
    addHandler: () => ({
      ok: false,
      status: 307,
      headers: { getSetCookie: () => [] },
      body: { cancel: async () => {} },
      json: async () => ({}),
    }),
  });
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl });
  await sender.issueNonces({ trialId: "t10", procedure: "stale" });
  const out = await sender.sendStale({
    trialId: "t10",
    request: buildS11Request({
      idToken: fakeToken("sub-a", "nonce-1"),
      subjectHash: HASH_C,
      expectedGeneration: 2,
    }),
  });
  assert.equal(out.result.status, 307);
  assert.equal(out.result.error, "redirect_not_followed");
});

test("送信器：応答が返らなかったスロットは no_response として記録し、再送しない", async () => {
  const { calls, fetchImpl } = makeFakeRelay({
    addHandler: (record, n) => {
      if (n === 1) throw new Error("network down");
      return {
        ok: false,
        status: 409,
        headers: { getSetCookie: () => [] },
        json: async () => ({ error: "stale_generation" }),
      };
    },
  });
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl });
  const nonces = await sender.issueNonces({ trialId: "t11", procedure: "concurrent" });
  const requests = buildS11Requests({
    tokens: [fakeToken("sub-a", nonces[0]), fakeToken("sub-a", nonces[1])],
    subjectHash: HASH_C,
    expectedGeneration: 3,
  });
  const out = await sender.sendConcurrent({ trialId: "t11", requests });
  const noResp = out.results.filter((r) => r.status === null && r.error === "no_response");
  assert.equal(noResp.length, 1);
  assert.equal(out.aggregate.ok, false);
  assert.equal(out.aggregate.no_response, 1);
  assert.equal(calls.add.length, 2);
  assert.equal(sender.isPrepared(), false);
});

test("送信器：/nonce の 3xx は発行失敗として扱い、送信できない状態にする", async () => {
  const fetchImpl = async (url) => {
    if (url === RELAY + "/nonce") {
      return {
        ok: false,
        status: 302,
        headers: { getSetCookie: () => [] },
        body: { cancel: async () => {} },
        json: async () => ({}),
      };
    }
    throw new Error("unexpected");
  };
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl });
  await assert.rejects(
    () => sender.issueNonces({ trialId: "t12", procedure: "stale" }),
    (e) => e.code === "s11_nonce_issuance_failed"
  );
  assert.equal(sender.isPrepared(), false);
});

test("送信器：未知の手順は発行を拒否する", async () => {
  const { fetchImpl } = makeFakeRelay();
  const sender = createS11Sender({ relayUrl: RELAY, fetchImpl });
  await assert.rejects(
    () => sender.issueNonces({ trialId: "t13", procedure: "other" }),
    (e) => e.code === "s11_bad_procedure"
  );
});
