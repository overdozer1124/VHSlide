// PC 内での ID トークン署名検証（公開鍵・JWKS 方式）と主体ハッシュ計算。
// 段階①フェーズ2 先行検証の、対象主体ハッシュ取得用の純粋モジュール。
//
// 位置づけ:
// - このモジュールはネットワーク通信を一切行わない。JWKS（Google 公開鍵集
//   合）の取得は呼び出し側（ブラウザーページ）が行い、ここへ渡す。
// - ID トークン・sub は、このモジュールの外へ送られない。検証は公開鍵に
//   よる署名検証だけで行い、トークンを外部の検証サービスへ送ることはない。
// - Node（テスト）とブラウザー（取得ページ）の両方から同じ実装を使うため、
//   依存するのは WebCrypto（globalThis.crypto.subtle）と atob だけである。
// - 検証する観点はサーバー側と同じである（署名・iss・aud・exp・nonce）。
//   ただしサーバー側は既定の外部検証経路を使うのに対し、ここでは取得側
//   が公開鍵で検証する。両者が同一のトークンに対して同じ結論になること
//   が、ハッシュ固定の前提である。
//
// 使い方:
//   const jwks = await (await fetch(JWKS_URL)).json();   // 呼び出し側で行う
//   const { sub } = await verifyIdTokenLocal(idToken, {
//     jwks,
//     expectedAud: GOOGLE_CLIENT_ID,
//     expectedIssuers: ["https://accounts.google.com", "accounts.google.com"],
//     expectedNonce: nonce,   // /nonce で取得した値。省略時は nonce の存在だけを確認する
//     nowSec: Math.floor(Date.now() / 1000),
//   });
//   const subjectHash = await sha256hex(sub);   // 64桁 hex。画面にはこれだけを表示する

const EXPECTED_ALG = "RS256";

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

// base64url 文字列をバイト列へ変換する。文字種・長さを検査し、不正なら失敗する。
export function base64urlDecode(input) {
  if (typeof input !== "string" || input.length === 0) {
    fail("malformed_token", "base64url 値が空です");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(input)) {
    fail("malformed_token", "base64url 値に不正な文字があります");
  }
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonPart(bytes, what) {
  let text;
  try {
    text = new TextDecoder().decode(bytes);
  } catch {
    fail("malformed_token", `${what} を文字列にできません`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail("malformed_token", `${what} が JSON ではありません`);
  }
}

// JWT を3部分に分け、ヘッダーとペイロードを復号する。署名の検証は行わない。
export function parseJwt(idToken) {
  if (typeof idToken !== "string") fail("malformed_token", "ID トークンが文字列ではありません");
  const parts = idToken.split(".");
  if (parts.length !== 3) fail("malformed_token", "ID トークンが3部分ではありません");
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeJsonPart(base64urlDecode(headerB64), "ヘッダー");
  const payload = decodeJsonPart(base64urlDecode(payloadB64), "ペイロード");
  const signature = base64urlDecode(signatureB64);
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  return { header, payload, signature, signingInput };
}

// 公開鍵（JWKS）で署名を検証し、クレームを確認する。すべて通れば { sub } を返す。
// 1つでも通らなければ code 付きの Error を投げる（呼び出し側は code だけを記録する）。
export async function verifyIdTokenLocal(idToken, opts) {
  const { jwks, expectedAud, expectedIssuers, expectedNonce, nowSec } = opts || {};
  if (!jwks || !Array.isArray(jwks.keys)) fail("bad_jwks", "JWKS が鍵の配列を含みません");
  if (typeof expectedAud !== "string" || !expectedAud) fail("bad_config", "期待する aud が未指定です");
  if (!Array.isArray(expectedIssuers) || expectedIssuers.length === 0) {
    fail("bad_config", "期待する iss が未指定です");
  }
  const now = Number.isInteger(nowSec) ? nowSec : Math.floor(Date.now() / 1000);

  const { header, payload, signature, signingInput } = parseJwt(idToken);
  if (header.alg !== EXPECTED_ALG) fail("unsupported_alg", "署名アルゴリズムが RS256 ではありません");
  if (typeof header.kid !== "string" || !header.kid) fail("unknown_kid", "鍵 ID がありません");
  const jwk = jwks.keys.find(
    (k) => k && k.kid === header.kid && k.kty === "RSA" && (!k.use || k.use === "sig")
  );
  if (!jwk) fail("unknown_kid", "JWKS に該当する鍵がありません");
  let key;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch {
    fail("bad_jwks", "公開鍵を読み込めません");
  }
  const signatureOk = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    signature,
    signingInput
  );
  if (!signatureOk) fail("bad_signature", "署名が検証できません");

  if (typeof payload.sub !== "string" || !payload.sub) fail("missing_sub", "sub がありません");
  if (payload.aud !== expectedAud && !(Array.isArray(payload.aud) && payload.aud.includes(expectedAud))) {
    fail("bad_aud", "aud が一致しません");
  }
  if (!expectedIssuers.includes(payload.iss)) fail("bad_iss", "iss が一致しません");
  if (!Number.isFinite(payload.exp) || payload.exp <= now) fail("token_expired", "トークンの期限が切れています");
  if (typeof payload.nonce !== "string" || !payload.nonce) fail("missing_nonce", "nonce がありません");
  if (expectedNonce !== undefined && expectedNonce !== null && payload.nonce !== expectedNonce) {
    fail("nonce_mismatch", "nonce が発行した値と一致しません");
  }
  return { sub: payload.sub };
}

export async function sha256hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
