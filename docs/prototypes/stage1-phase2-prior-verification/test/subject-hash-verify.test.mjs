// tools/subject-hash-verify.mjs の検証ロジックの試験（ローカルのみ）。
// 実行: node --test test/subject-hash-verify.test.mjs
// 実 Google とは通信しない。RSA 鍵をその場で生成し、JWT に署名して検証する。
// 負例（改ざん・aud/iss/期限/nonce/鍵の不一致）がすべて拒否されることを確認する。

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  verifyIdTokenLocal,
  sha256hex,
  parseJwt,
} from "../tools/subject-hash-verify.mjs";

const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const AUD = "test-client-id.apps.googleusercontent.com";
const NONCE = "test-nonce-0123456789";
const NOW = 1794000000;

function base64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function makeToken({ header = {}, payload = {}, key, kid = "test-key-1" }) {
  const h = { alg: "RS256", typ: "JWT", kid, ...header };
  const p = {
    sub: "test-subject-123",
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

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "test-key-1";
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

test("sha256hex: 既知のベクトル", async () => {
  assert.equal(
    await sha256hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  const h = await sha256hex("test-subject-123");
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("正しいトークン: 検証を通り sub を返す", async () => {
  const { privateKey, opts } = fixture();
  const token = makeToken({ key: privateKey });
  const out = await verifyIdTokenLocal(token, opts);
  assert.equal(out.sub, "test-subject-123");
  const parsed = parseJwt(token);
  assert.equal(parsed.header.alg, "RS256");
  assert.equal(parsed.payload.nonce, NONCE);
});

test("負例: ペイロードの改ざんは署名で拒否される", async () => {
  const { privateKey, opts } = fixture();
  const token = makeToken({ key: privateKey });
  const [h, p, s] = token.split(".");
  const tampered = JSON.parse(Buffer.from(p, "base64url").toString());
  tampered.sub = "other-subject";
  const forged = `${h}.${base64url(JSON.stringify(tampered))}.${s}`;
  await assert.rejects(verifyIdTokenLocal(forged, opts), (e) => e.code === "bad_signature");
});

test("負例: aud の不一致は拒否される", async () => {
  const { privateKey, opts } = fixture();
  const token = makeToken({ key: privateKey, payload: { aud: "other-client.apps.googleusercontent.com" } });
  await assert.rejects(verifyIdTokenLocal(token, opts), (e) => e.code === "bad_aud");
});

test("負例: iss の不一致は拒否される", async () => {
  const { privateKey, opts } = fixture();
  const token = makeToken({ key: privateKey, payload: { iss: "https://evil.example.com" } });
  await assert.rejects(verifyIdTokenLocal(token, opts), (e) => e.code === "bad_iss");
});

test("負例: 期限切れは拒否される", async () => {
  const { privateKey, opts } = fixture();
  const token = makeToken({ key: privateKey, payload: { exp: NOW - 1 } });
  await assert.rejects(verifyIdTokenLocal(token, opts), (e) => e.code === "token_expired");
});

test("負例: nonce の不一致は拒否される", async () => {
  const { privateKey, opts } = fixture();
  const token = makeToken({ key: privateKey, payload: { nonce: "different-nonce" } });
  await assert.rejects(verifyIdTokenLocal(token, opts), (e) => e.code === "nonce_mismatch");
});

test("負例: 未知の kid は拒否される", async () => {
  const { privateKey, opts } = fixture();
  const token = makeToken({ key: privateKey, kid: "unknown-key" });
  await assert.rejects(verifyIdTokenLocal(token, opts), (e) => e.code === "unknown_kid");
});

test("負例: 別の鍵で署名されたトークンは拒否される", async () => {
  const { privateKey, opts } = fixture();
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = makeToken({ key: other.privateKey });
  await assert.rejects(verifyIdTokenLocal(token, opts), (e) => e.code === "bad_signature");
});

test("負例: RS256 以外は拒否される", async () => {
  const { privateKey, opts } = fixture();
  const token = makeToken({ key: privateKey, header: { alg: "none" } });
  await assert.rejects(verifyIdTokenLocal(token, opts), (e) => e.code === "unsupported_alg");
});

test("別主体は別ハッシュになる（差し替えの検出）", async () => {
  const a = await sha256hex("subject-A");
  const b = await sha256hex("subject-B");
  assert.notEqual(a, b);
});
