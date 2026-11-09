// tools/s9-negative.mjs の検証（ローカルのみ）。
// 実行: node --test test/s9-negative.test.mjs
// 実 Google・実 Worker とは通信しない。署名改変の識別力は、ローカルで
// 鍵を生成して署名した試験用 JWT で確認する（subject-hash-verify.test.mjs
// の方式を踏襲）。秘密はダミー値だけを使う。

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  base64urlEncode,
  base64urlDecode,
  tamperSignature,
  verifyTamperPreservesStructure,
  createChainSession,
  expectedResponse,
  expectedSteps,
  makeTrialLogEntry,
  nonceDeadline,
  isNonceExpired,
  assertLogHasNoSecrets,
  NONCE_TTL_MS,
  TOKEN_ERASE_TRIGGERS,
} from "../tools/s9-negative.mjs";
import { verifyIdTokenLocal } from "../tools/subject-hash-verify.mjs";
import { assertNoSecrets } from "../tools/trial-apply.mjs";

// ダミー値。秘密の体裁を持つが、試験のためだけの値である。
const DUMMY_TOKEN = "dummy-id-token.aaa.bbb";
const DUMMY_NONCE = "dummy-nonce-0123456789";
const DUMMY_COOKIE = "op2_nonce_ctx=dummy-context-hash";
const SECRETS = [DUMMY_TOKEN, DUMMY_NONCE, DUMMY_COOKIE];

function base64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

// ローカルで鍵を生成して署名した試験用 JWT を作る。実 Google トークン
// は使わない。subject-hash-verify.test.mjs の方式を踏襲する。
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const AUD = "s9-test-client-id.apps.googleusercontent.com";
const NONCE = "s9-test-nonce-0123456789";
const NOW = 1794000000;

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "s9-test-key-1";
  jwk.use = "sig";
  jwk.alg = "RS256";
  const jwks = { keys: [jwk] };
  const opts = {
    jwks,
    expectedAud: AUD,
    expectedIssuers: ISSUERS,
    expectedNonce: NONCE,
    nowSec: NOW,
  };
  return { privateKey, jwks, opts };
}

function mintToken(key, { payload = {} } = {}) {
  const h = { alg: "RS256", typ: "JWT", kid: "s9-test-key-1" };
  const p = {
    sub: "s9-test-subject",
    aud: AUD,
    iss: "https://accounts.google.com",
    exp: NOW + 3600,
    iat: NOW,
    nonce: NONCE,
    ...payload,
  };
  const signingInput = `${base64url(JSON.stringify(h))}.${base64url(JSON.stringify(p))}`;
  const sig = sign("sha256", Buffer.from(signingInput), key);
  return `${signingInput}.${base64url(sig)}`;
}

function differingBits(a, b) {
  assert.equal(a.length, b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i] ^ b[i];
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n;
}

test("base64url: 変換は往復し、不正な文字・長さは拒否される", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const encoded = base64urlEncode(bytes);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.equal(encoded.includes("="), false);
  assert.equal(encoded.includes("+"), false);
  assert.equal(encoded.includes("/"), false);
  assert.deepEqual(base64urlDecode(encoded), bytes);
  // 既知の値：0xfb 0xff は base64url で "-_8" になる。
  assert.equal(base64urlEncode(new Uint8Array([0xfb, 0xff])), "-_8");
  assert.deepEqual(base64urlDecode("-_8"), new Uint8Array([0xfb, 0xff]));
  assert.throws(() => base64urlDecode("ab+c"), (e) => e.code === "bad_trial_input");
  assert.throws(() => base64urlDecode("ab/c"), (e) => e.code === "bad_trial_input");
  assert.throws(() => base64urlDecode(""), (e) => e.code === "bad_trial_input");
  assert.throws(() => base64urlDecode("a"), (e) => e.code === "bad_trial_input");
  assert.throws(() => base64urlEncode("not-bytes"), (e) => e.code === "bad_trial_input");
});

test("tamperSignature: header・payload は同一、3分割維持、署名はちょうど1ビットだけ異なる", () => {
  const { privateKey } = fixture();
  const original = mintToken(privateKey);
  const tampered = tamperSignature(original);
  assert.notEqual(tampered, original);
  const [oh, op, os] = original.split(".");
  const [th, tp, ts] = tampered.split(".");
  assert.equal(th, oh);
  assert.equal(tp, op);
  // 正規の base64url 再符号化：復号して再符号化すると同一になる。
  assert.equal(base64urlEncode(base64urlDecode(ts)), ts);
  assert.match(ts, /^[A-Za-z0-9_-]+$/);
  assert.equal(ts.includes("="), false);
  // 署名バイト列の差はちょうど1ビット。
  assert.equal(differingBits(base64urlDecode(os), base64urlDecode(ts)), 1);
  // 先頭バイトの1ビットだけが反転している（XOR 0x01）。
  const a = base64urlDecode(os);
  const b = base64urlDecode(ts);
  assert.equal(b[0], a[0] ^ 0x01);
  for (let i = 1; i < a.length; i++) assert.equal(b[i], a[i]);
  // 構造確認もすべて真になる。
  const check = verifyTamperPreservesStructure(original, tampered);
  assert.equal(Object.isFrozen(check), true);
  assert.deepEqual(check, {
    sameHeader: true,
    samePayload: true,
    threeParts: true,
    validBase64url: true,
    signatureDiffersByOneBit: true,
  });
});

test("tamperSignature: 不正入力は bad_trial_input で拒否される", () => {
  assert.throws(() => tamperSignature("only-one-part"), (e) => e.code === "bad_trial_input");
  assert.throws(() => tamperSignature("a.b.c.d"), (e) => e.code === "bad_trial_input");
  assert.throws(() => tamperSignature(""), (e) => e.code === "bad_trial_input");
  assert.throws(() => tamperSignature(null), (e) => e.code === "bad_trial_input");
  assert.throws(() => tamperSignature("a.b."), (e) => e.code === "bad_trial_input");
  assert.throws(() => tamperSignature("a.b.!!!"), (e) => e.code === "bad_trial_input");
});

test("verifyTamperPreservesStructure: 改変以外・別トークンは偽になる", () => {
  const { privateKey } = fixture();
  const original = mintToken(privateKey);
  const tampered = tamperSignature(original);
  // ペイロードを変えたものは samePayload が偽。
  const [h, p, s] = original.split(".");
  const otherPayload = base64url(JSON.stringify({ sub: "other" }));
  const payloadChanged = verifyTamperPreservesStructure(original, `${h}.${otherPayload}.${s}`);
  assert.equal(payloadChanged.samePayload, false);
  assert.equal(payloadChanged.signatureDiffersByOneBit, false);
  // 署名を2ビット変えたものは signatureDiffersByOneBit が偽。
  const sigBytes = base64urlDecode(s);
  sigBytes[0] ^= 0x03;
  const twoBit = verifyTamperPreservesStructure(
    original,
    `${h}.${p}.${base64urlEncode(sigBytes)}`
  );
  assert.equal(twoBit.sameHeader, true);
  assert.equal(twoBit.samePayload, true);
  assert.equal(twoBit.signatureDiffersByOneBit, false);
  // 3分割でないものは threeParts が偽。
  const notThree = verifyTamperPreservesStructure(original, "a.b");
  assert.equal(notThree.threeParts, false);
  assert.equal(notThree.sameHeader, false);
  // 文字列でない入力は例外。
  assert.throws(
    () => verifyTamperPreservesStructure(original, null),
    (e) => e.code === "bad_trial_input"
  );
});

test("識別力：改変トークンはローカル署名検証で拒否され、元トークンは通過する", async () => {
  const { privateKey, opts } = fixture();
  const original = mintToken(privateKey);
  const out = await verifyIdTokenLocal(original, opts);
  assert.equal(out.sub, "s9-test-subject");
  const tampered = tamperSignature(original);
  // 改変前後で header・payload が同一なのに、署名だけが通らない。
  const check = verifyTamperPreservesStructure(original, tampered);
  assert.equal(check.sameHeader, true);
  assert.equal(check.samePayload, true);
  assert.equal(check.signatureDiffersByOneBit, true);
  await assert.rejects(verifyIdTokenLocal(tampered, opts), (e) => e.code === "bad_signature");
});

test("期待応答：各ステップの期待値が仕様どおりである", () => {
  assert.deepEqual(expectedResponse("tampered"), { status: 401, error: "tokeninfo_rejected" });
  assert.deepEqual(expectedResponse("control"), { status: 200, error: null, ok: true });
  assert.deepEqual(expectedResponse("resend"), { status: 403, error: "nonce_replayed" });
  assert.deepEqual(expectedResponse("no-cookie"), { status: 403, error: "nonce_context_mismatch" });
  assert.equal(Object.isFrozen(expectedResponse("tampered")), true);
  assert.deepEqual(expectedSteps("A"), ["tampered", "control", "resend"]);
  assert.deepEqual(expectedSteps("B"), ["no-cookie", "control"]);
  assert.throws(() => expectedResponse("unknown-step"), (e) => e.code === "bad_trial_input");
  assert.throws(() => expectedSteps("C"), (e) => e.code === "bad_trial_input");
});

test("チェーンA：順序どおりに進み、control の 200 の後でのみ resend が送れる", () => {
  const session = createChainSession();
  const attempt = session.beginChain("A");
  assert.equal(attempt.chain, "A");
  assert.equal(typeof attempt.trialId, "string");
  assert.ok(attempt.trialId.length > 0);
  // 捕捉前は送れない。
  assert.equal(session.canSend(attempt.trialId, attempt.generation, "tampered"), false);
  assert.equal(session.markCaptured(attempt.trialId, attempt.generation), true);
  // 最初は tampered だけが送れる。
  assert.equal(session.canSend(attempt.trialId, attempt.generation, "tampered"), true);
  assert.equal(session.canSend(attempt.trialId, attempt.generation, "control"), false);
  assert.equal(session.canSend(attempt.trialId, attempt.generation, "resend"), false);
  assert.equal(session.nextStep(attempt.trialId, attempt.generation), "tampered");
  // 順序外の記録は拒否される。
  assert.throws(
    () => session.recordStep(attempt.trialId, attempt.generation, "control", { status: 200, error: null }),
    (e) => e.code === "chain_order"
  );
  // tampered が期待どおり 401 なら次は control。
  const r1 = session.recordStep(attempt.trialId, attempt.generation, "tampered", { status: 401, error: "tokeninfo_rejected" });
  assert.equal(r1.matched, true);
  assert.equal(r1.state, "active");
  assert.equal(r1.nextStep, "control");
  assert.equal(session.canSend(attempt.trialId, attempt.generation, "resend"), false);
  assert.equal(session.canSend(attempt.trialId, attempt.generation, "control"), true);
  // control が期待どおり 200 ok なら次は resend。
  const r2 = session.recordStep(attempt.trialId, attempt.generation, "control", { status: 200, error: null });
  assert.equal(r2.matched, true);
  assert.equal(r2.state, "active");
  assert.equal(r2.nextStep, "resend");
  assert.equal(session.canSend(attempt.trialId, attempt.generation, "resend"), true);
  // resend が期待どおり 403 なら完了。
  const r3 = session.recordStep(attempt.trialId, attempt.generation, "resend", { status: 403, error: "nonce_replayed" });
  assert.equal(r3.matched, true);
  assert.equal(r3.state, "completed");
  assert.equal(r3.nextStep, null);
  assert.equal(session.nextStep(attempt.trialId, attempt.generation), null);
  // 完了後はどのステップも送れない。
  for (const step of ["tampered", "control", "resend"]) {
    assert.equal(session.canSend(attempt.trialId, attempt.generation, step), false);
  }
  assert.throws(
    () => session.recordStep(attempt.trialId, attempt.generation, "resend", { status: 403, error: "nonce_replayed" }),
    (e) => e.code === "chain_state"
  );
});

test("チェーンB：no-cookie → control の順序で進み、完了する", () => {
  const session = createChainSession();
  const attempt = session.beginChain("B");
  session.markCaptured(attempt.trialId, attempt.generation);
  assert.equal(session.canSend(attempt.trialId, attempt.generation, "no-cookie"), true);
  assert.equal(session.canSend(attempt.trialId, attempt.generation, "tampered"), false);
  const r1 = session.recordStep(attempt.trialId, attempt.generation, "no-cookie", { status: 403, error: "nonce_context_mismatch" });
  assert.equal(r1.matched, true);
  assert.equal(r1.nextStep, "control");
  const r2 = session.recordStep(attempt.trialId, attempt.generation, "control", { status: 200, error: null });
  assert.equal(r2.matched, true);
  assert.equal(r2.state, "completed");
});

test("期待外れの応答：チェーンが停止し、それ以上の送信が不可になる", () => {
  const session = createChainSession();
  const attempt = session.beginChain("A");
  session.markCaptured(attempt.trialId, attempt.generation);
  // tampered に 200 が返る（期待は 401）→ 停止。
  const r = session.recordStep(attempt.trialId, attempt.generation, "tampered", { status: 200, error: null });
  assert.equal(r.matched, false);
  assert.equal(r.state, "halted");
  assert.equal(r.undetermined, false);
  assert.equal(r.nextStep, null);
  for (const step of ["tampered", "control", "resend"]) {
    assert.equal(session.canSend(attempt.trialId, attempt.generation, step), false);
  }
  assert.equal(session.nextStep(attempt.trialId, attempt.generation), null);
  const snap = session.snapshot();
  assert.equal(snap.state, "halted");
  assert.equal(snap.undetermined, false);
  // 停止した試行への記録は拒否される。
  assert.throws(
    () => session.recordStep(attempt.trialId, attempt.generation, "control", { status: 200, error: null }),
    (e) => e.code === "chain_state"
  );
  // Cookie 欠落の期待外れ（no-cookie に 200）でも同様に停止する。
  const sessionB = createChainSession();
  const b = sessionB.beginChain("B");
  sessionB.markCaptured(b.trialId, b.generation);
  const rb = sessionB.recordStep(b.trialId, b.generation, "no-cookie", { status: 200, error: null });
  assert.equal(rb.matched, false);
  assert.equal(rb.state, "halted");
  assert.equal(sessionB.canSend(b.trialId, b.generation, "control"), false);
});

test("レスポンスなし：状態未確定として停止し、再送は許可されない", () => {
  const session = createChainSession();
  const attempt = session.beginChain("A");
  session.markCaptured(attempt.trialId, attempt.generation);
  // fetch の例外（レスポンスなし）は null で記録する。
  const r = session.recordStep(attempt.trialId, attempt.generation, "tampered", null);
  assert.equal(r.matched, false);
  assert.equal(r.state, "halted");
  assert.equal(r.undetermined, true);
  assert.equal(r.nextStep, null);
  // 再送は許可されない（同じステップも次のステップも送れない）。
  for (const step of ["tampered", "control", "resend"]) {
    assert.equal(session.canSend(attempt.trialId, attempt.generation, step), false);
  }
  const snap = session.snapshot();
  assert.equal(snap.state, "halted");
  assert.equal(snap.undetermined, true);
  // recordNoResponse も同じ扱いである。
  const session2 = createChainSession();
  const a2 = session2.beginChain("B");
  session2.markCaptured(a2.trialId, a2.generation);
  const r2 = session2.recordNoResponse(a2.trialId, a2.generation, "no-cookie");
  assert.equal(r2.state, "halted");
  assert.equal(r2.undetermined, true);
  assert.equal(session2.canSend(a2.trialId, a2.generation, "no-cookie"), false);
  assert.equal(session2.canSend(a2.trialId, a2.generation, "control"), false);
});

test("古い世代の拒否：新しい試行の開始が旧試行を無効化する", () => {
  const session = createChainSession();
  const first = session.beginChain("A");
  const second = session.beginChain("B");
  assert.notEqual(first.trialId, second.trialId);
  assert.notEqual(first.generation, second.generation);
  assert.equal(session.isCurrent(first.trialId, first.generation), false);
  assert.equal(session.isCurrent(second.trialId, second.generation), true);
  assert.equal(session.canSend(first.trialId, first.generation, "tampered"), false);
  assert.throws(
    () => session.markCaptured(first.trialId, first.generation),
    (e) => e.code === "stale_attempt"
  );
  assert.throws(
    () => session.recordStep(first.trialId, first.generation, "tampered", { status: 401, error: "tokeninfo_rejected" }),
    (e) => e.code === "stale_attempt"
  );
  assert.throws(
    () => session.nextStep(first.trialId, first.generation),
    (e) => e.code === "stale_attempt"
  );
  // 新試行は進める。
  session.markCaptured(second.trialId, second.generation);
  assert.equal(session.canSend(second.trialId, second.generation, "no-cookie"), true);
  // 破棄は現行の試行だけを無効化し、古い試行には無害である。
  assert.equal(session.discard(first.trialId, first.generation), false);
  assert.equal(session.isCurrent(second.trialId, second.generation), true);
  assert.equal(session.discard(second.trialId, second.generation), true);
  assert.equal(session.currentTrialId(), null);
  assert.equal(session.snapshot(), null);
  assert.equal(session.canSend(second.trialId, second.generation, "no-cookie"), false);
});

test("不正なチェーン種別・不正な応答は拒否される", () => {
  const session = createChainSession();
  assert.throws(() => session.beginChain("C"), (e) => e.code === "bad_trial_input");
  assert.throws(() => session.beginChain("chain-a"), (e) => e.code === "bad_trial_input");
  const attempt = session.beginChain("A");
  session.markCaptured(attempt.trialId, attempt.generation);
  assert.throws(
    () => session.recordStep(attempt.trialId, attempt.generation, "tampered", { status: "401" }),
    (e) => e.code === "bad_trial_input"
  );
  assert.throws(
    () => session.recordStep(attempt.trialId, attempt.generation, "unknown-step", { status: 401 }),
    (e) => e.code === "chain_order"
  );
});

test("nonce 期限：発行時刻＋5分が期限で、期限ちょうどは期限切れ", () => {
  assert.equal(NONCE_TTL_MS, 5 * 60 * 1000);
  const issued = 1794000000000;
  assert.equal(nonceDeadline(issued), issued + 300000);
  assert.equal(isNonceExpired(issued + 299999, issued), false);
  assert.equal(isNonceExpired(issued + 300000, issued), true);
  assert.equal(isNonceExpired(issued + 300001, issued), true);
  assert.equal(isNonceExpired(issued, issued), false);
  assert.throws(() => nonceDeadline("not-a-number"), (e) => e.code === "bad_trial_input");
  assert.throws(() => isNonceExpired(Date.now(), NaN), (e) => e.code === "bad_trial_input");
});

test("トークン消去の契機が4つ明記されている", () => {
  assert.deepEqual([...TOKEN_ERASE_TRIGGERS], [
    "chain-completed",
    "chain-halted",
    "trial-discarded",
    "new-trial-begun",
  ]);
  assert.equal(Object.isFrozen(TOKEN_ERASE_TRIGGERS), true);
});

test("試験ログは試験 ID・チェーン・ステップ・応答だけを含み、秘密を含まない", () => {
  const entry = makeTrialLogEntry({
    trialId: "trial-s9-001",
    chain: "A",
    step: "tampered",
    response: { status: 401, error: "tokeninfo_rejected" },
  });
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(entry.trial_id, "trial-s9-001");
  assert.equal(entry.chain, "A");
  assert.equal(entry.step, "tampered");
  assert.equal(entry.response.status, 401);
  assert.equal(entry.response.error, "tokeninfo_rejected");
  assertNoSecrets(JSON.stringify(entry), SECRETS);
  // 成功応答（control の 200 ok）は error が null のまま通る。
  const okEntry = makeTrialLogEntry({
    trialId: "trial-s9-002",
    chain: "A",
    step: "control",
    response: { status: 200, error: null },
  });
  assert.equal(okEntry.response.status, 200);
  assert.equal(okEntry.response.error, null);
  // 一覧にない理由コードは unexpected_error へ置き換える。
  const unknownEntry = makeTrialLogEntry({
    trialId: "trial-s9-003",
    chain: "B",
    step: "no-cookie",
    response: { status: 500, error: "internal boom" },
  });
  assert.equal(unknownEntry.response.error, "unexpected_error");
  assertNoSecrets(JSON.stringify(unknownEntry), SECRETS);
  // 秘密らしい値を含む理由コードも置き換える。
  const leakEntry = makeTrialLogEntry({
    trialId: "trial-s9-004",
    chain: "B",
    step: "no-cookie",
    response: { status: 403, error: `x ${DUMMY_TOKEN}` },
  });
  assert.equal(leakEntry.response.error, "unexpected_error");
  assertNoSecrets(JSON.stringify(leakEntry), SECRETS);
  // 不正な入力は拒否される。
  assert.throws(() => makeTrialLogEntry({
    trialId: "t", chain: "C", step: "control", response: { status: 200, error: null },
  }), (e) => e.code === "bad_trial_input");
  assert.throws(() => makeTrialLogEntry({
    trialId: "t", chain: "A", step: "unknown", response: { status: 200, error: null },
  }), (e) => e.code === "bad_trial_input");
  assert.throws(() => makeTrialLogEntry({
    trialId: "t", chain: "A", step: "control", response: { status: "200" },
  }), (e) => e.code === "bad_trial_input");
});

test("assertLogHasNoSecrets は秘密を含むログ文字列を検出する", () => {
  assertLogHasNoSecrets("試験ログ: {\"trial_id\":\"trial-s9-001\"}", SECRETS);
  assert.throws(() => assertLogHasNoSecrets(`token=${DUMMY_TOKEN}`, SECRETS), (e) => {
    assert.equal(e.code, "secret_leaked");
    assert.equal(e.message.includes(DUMMY_TOKEN), false);
    return true;
  });
  assert.throws(() => assertLogHasNoSecrets(`nonce=${DUMMY_NONCE}`, SECRETS), (e) => e.code === "secret_leaked");
});
