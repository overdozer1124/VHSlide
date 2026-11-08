// tools/trial-apply.mjs の検証（ローカルのみ）。
// 実行: node --test test/trial-apply.test.mjs
// 実 Google・実 Worker とは通信しない。表示と実送信の同一性、秘密の
// 不出力を、ダミー値で確認する。

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrialRequest,
  compareOneTime,
  preSendView,
  verifyDisplayMatchesSent,
  makeTrialLogEntry,
  assertNoSecrets,
  assertDisplayKeys,
} from "../tools/trial-apply.mjs";

// ダミー値。秘密の体裁を持つが、試験のためだけの値である。
const DUMMY_TOKEN = "dummy-id-token.aaa.bbb";
const DUMMY_FIXED_ONE_TIME = "fixed-one-time-dummy";
const DUMMY_TRIAL_ONE_TIME = "trial-one-time-dummy";
const DUMMY_NONCE = "dummy-nonce-0123456789";
const DUMMY_SUBJECT_HASH = "0123456789abcdef".repeat(4);
const DUMMY_COOKIE = "op2_nonce_ctx=dummy-context-hash";
const SECRETS = [
  DUMMY_TOKEN,
  DUMMY_FIXED_ONE_TIME,
  DUMMY_TRIAL_ONE_TIME,
  DUMMY_NONCE,
  DUMMY_SUBJECT_HASH,
  DUMMY_COOKIE,
];

function dummyRequest() {
  return buildTrialRequest({
    idToken: DUMMY_TOKEN,
    oneTimeValue: DUMMY_TRIAL_ONE_TIME,
    purpose: "full-replace",
    envId: "wrong-env-id-dummy",
  });
}

test("要求オブジェクトは深く凍結され、書き換えると失敗する", () => {
  const req = dummyRequest();
  assert.equal(Object.isFrozen(req), true);
  assert.throws(() => {
    req.env_id = "tampered";
  }, TypeError);
  assert.equal(req.env_id, "wrong-env-id-dummy");
  assert.throws(() => {
    req.one_time_value = "tampered";
  }, TypeError);
});

test("表示記録は許された鍵だけで、秘密を含まない", () => {
  const req = dummyRequest();
  const display = preSendView(req, {
    trialId: "trial-001",
    kind: "env-mismatch",
    subjectConfirmed: true,
    oneTimeFact: compareOneTime(DUMMY_TRIAL_ONE_TIME, DUMMY_FIXED_ONE_TIME),
  });
  assert.equal(Object.isFrozen(display), true);
  assertDisplayKeys(display);
  assert.equal(display.env_id, "wrong-env-id-dummy");
  assert.equal(display.purpose, "full-replace");
  assert.equal(display.one_time, "不一致");
  assert.equal(display.subject, "主体Aとして確認（署名・iss・aud・exp・nonce 通過）");
  const shown = JSON.stringify(display);
  assertNoSecrets(shown, SECRETS);
  // 表示に秘密の項目名そのものも現れない（「nonce」という語そのものは
  // 確認の観点名として主体の文言に含まれるため、値の検査は
  // assertNoSecrets（ダミー nonce 値）で行う）。
  assert.equal(shown.includes("id_token"), false);
  assert.equal(shown.includes("one_time_value"), false);
});

test("一回値の比較は真偽だけを返し、値を含まない", () => {
  assert.equal(compareOneTime("same-value", "same-value"), "一致");
  assert.equal(compareOneTime("trial-value", "fixed-value"), "不一致");
  const fact = compareOneTime(DUMMY_TRIAL_ONE_TIME, DUMMY_FIXED_ONE_TIME);
  assert.equal(fact.includes(DUMMY_TRIAL_ONE_TIME), false);
  assert.equal(fact.includes(DUMMY_FIXED_ONE_TIME), false);
});

test("表示と実送信の同一性：一致すれば通り、改ざんされれば拒否される", () => {
  const req = dummyRequest();
  const display = preSendView(req, {
    trialId: "trial-002",
    kind: "env-mismatch",
    subjectConfirmed: true,
    oneTimeFact: "不一致",
  });
  // 画面の送信は、表示の元と同一のオブジェクトをそのまま送る。
  const sentBody = JSON.parse(JSON.stringify(req));
  assert.equal(verifyDisplayMatchesSent(display, sentBody), true);

  const tamperedEnv = { ...sentBody, env_id: "another-env-id" };
  assert.throws(() => verifyDisplayMatchesSent(display, tamperedEnv), (e) => e.code === "display_sent_mismatch");
  const tamperedPurpose = { ...sentBody, purpose: "bootstrap" };
  assert.throws(() => verifyDisplayMatchesSent(display, tamperedPurpose), (e) => e.code === "display_sent_mismatch");
});

test("表示の元と送信する本体が同一のオブジェクトであること", () => {
  const req = dummyRequest();
  const display = preSendView(req, {
    trialId: "trial-003",
    kind: "one-time-mismatch",
    subjectConfirmed: true,
    oneTimeFact: "不一致",
  });
  // 画面は表示に使った req と同じ参照を JSON.stringify して送る。
  // 参照が同一なら、表示後に差し替えが起きても送る側は凍結済みの
  // 同一オブジェクトであり、表示値と送信値の食い違いは起きない。
  const toSend = req;
  assert.equal(Object.is(toSend, req), true);
  assert.equal(verifyDisplayMatchesSent(display, toSend), true);
  assert.equal(toSend.env_id, display.env_id);
  assert.equal(toSend.purpose, display.purpose);
});

test("試験ログは表示と応答を同一の試験 ID で結び、秘密を含まない", () => {
  const req = dummyRequest();
  const display = preSendView(req, {
    trialId: "trial-004",
    kind: "env-mismatch",
    subjectConfirmed: true,
    oneTimeFact: "一致",
  });
  const entry = makeTrialLogEntry({
    display,
    response: { status: 403, error: "env_mismatch" },
  });
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(entry.trial_id, "trial-004");
  assert.equal(entry.response.status, 403);
  assert.equal(entry.response.error, "env_mismatch");
  assertNoSecrets(JSON.stringify(entry), SECRETS);
});

test("主体の確認は真偽だけを示し、ハッシュや sub を含まない", () => {
  const req = dummyRequest();
  const ok = preSendView(req, {
    trialId: "trial-005",
    kind: "env-mismatch",
    subjectConfirmed: true,
    oneTimeFact: "一致",
  });
  const ng = preSendView(req, {
    trialId: "trial-006",
    kind: "env-mismatch",
    subjectConfirmed: false,
    oneTimeFact: "一致",
  });
  assert.equal(ok.subject, "主体Aとして確認（署名・iss・aud・exp・nonce 通過）");
  assert.equal(ng.subject, "未確認");
  assertNoSecrets(JSON.stringify(ok) + JSON.stringify(ng), [DUMMY_SUBJECT_HASH]);
});

test("不正な入力は拒否される", () => {
  assert.throws(() => buildTrialRequest({
    idToken: "", oneTimeValue: "x", purpose: "full-replace", envId: "e",
  }), (e) => e.code === "bad_trial_input");
  assert.throws(() => preSendView(dummyRequest(), {
    trialId: "t", kind: "full-match", subjectConfirmed: true, oneTimeFact: "一致",
  }), (e) => e.code === "bad_trial_input");
  assert.throws(() => preSendView(dummyRequest(), {
    trialId: "t", kind: "env-mismatch", subjectConfirmed: true, oneTimeFact: "たぶん一致",
  }), (e) => e.code === "bad_trial_input");
  assert.throws(() => makeTrialLogEntry({
    display: { trial_id: "t" }, response: { status: "403" },
  }), (e) => e.code === "bad_trial_input");
});

test("assertNoSecrets は秘密を含む文字列を検出し、例外文に秘密を含めない", () => {
  assertNoSecrets("env_id=wrong-env-id-dummy", SECRETS);
  assert.throws(() => assertNoSecrets(`token=${DUMMY_TOKEN}`, SECRETS), (e) => {
    assert.equal(e.code, "secret_leaked");
    assert.equal(e.message.includes(DUMMY_TOKEN), false);
    return true;
  });
});

test("表示記録に許されない鍵があれば拒否される", () => {
  const bad = { trial_id: "t", kind: "env-mismatch", id_token: DUMMY_TOKEN };
  assert.throws(() => assertDisplayKeys(bad), (e) => e.code === "bad_display");
});
