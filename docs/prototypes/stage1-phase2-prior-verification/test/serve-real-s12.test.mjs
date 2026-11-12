// 提供サーバー（tools/serve-real.mjs）の S12 入口（/s12-revoke・
// /s12-revoke.mjs・/s12/nonces・/s12/send-*）の実行試験。
// 実行: node --test test/serve-real-s12.test.mjs
// 実 Google・実 Worker とは通信しない。serve-real.mjs を子プロセスで
// 起動し、配信（クライアント ID と S12 セッションの差し込み・内容・
// 種別）と、/s12/nonces の呼び出し元境界（セッションなしは 403 で
// 状態を変更しない）、送信経路（偽の中継に対する失効・提示の往復と
// 事前確認エラーの写像）を HTTP 層で確認する。秘密の値は使わない。
// /s12/nonces の正常系は、偽の中継（/nonce に nonce と Set-Cookie
// を返す）で確認する（ctx は応答に出ない）。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_PORT = 8904;
const CLIENT_ID = "serve-s12-client-id.apps.googleusercontent.com";
const HASH_B = "b".repeat(64);

// 偽の JWT（署名検証はしない。ペイロードの nonce クレームだけを
// 送信器が読む）。実トークンではない。
function fakeToken(sub, nonce) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT", kid: "fake" })}.${b64({ sub, nonce })}.fakesig`;
}

// 偽の中継。/nonce には nonce と op2_nonce_ctx の Set-Cookie を
// 返し、/admin/* への送信を記録して固定の応答を返す。
let nonceCounter = 0;
const relayCalls = { revoke: [], verifyOnly: [] };
const relay = http.createServer((req, res) => {
  if (req.url === "/nonce") {
    nonceCounter += 1;
    res.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": `op2_nonce_ctx=fake-ctx-${nonceCounter}; Path=/; HttpOnly`,
    });
    res.end(JSON.stringify({ nonce: `fake-nonce-${nonceCounter}` }));
    return;
  }
  if (req.url === "/admin/registry/revoke" || req.url === "/admin/verify-only") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const record = {
        headers: req.headers,
        body: body ? JSON.parse(body) : null,
      };
      if (req.url === "/admin/registry/revoke") {
        relayCalls.revoke.push(record);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, generation: 5 }));
      } else {
        relayCalls.verifyOnly.push(record);
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_operator" }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
const relayPort = relay.address().port;

const child = spawn("node", [path.join(ROOT, "tools", "serve-real.mjs")], {
  env: {
    ...process.env,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    RELAY_URL: `http://127.0.0.1:${relayPort}`,
    PORT: String(SERVE_PORT),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let childLog = "";
child.stdout.on("data", (d) => { childLog += d; });
child.stderr.on("data", (d) => { childLog += d; });

const base = `http://127.0.0.1:${SERVE_PORT}`;

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(base + "/");
      if (r.status === 200) return true;
    } catch { /* 起動待ち */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const ready = await waitReady();
assert.equal(ready, true, `serve-real が起動しませんでした: ${childLog.slice(-400)}`);

// 配信された画面から S12 セッションの値を取り出す（試験内だけの
// 扱いであり、値そのものは検証の対象にしない）。
let s12Session = null;

test("S12 入口：/s12-revoke は画面を返し、クライアント ID とセッションが差し込まれる", async () => {
  const r = await fetch(base + "/s12-revoke");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const body = await r.text();
  assert.equal(body.includes("REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID"), false);
  assert.equal(body.includes("REPLACE_WITH_S12_SESSION"), false);
  assert.equal(body.includes(CLIENT_ID), true);
  const m = body.match(/const S12_SESSION = "([^"]+)"/);
  assert.ok(m, "S12 セッションの差し込みが見つかりません");
  s12Session = m[1];
  // S12 失効画面であること（手順1〜5と送信器への言及を含む）。
  assert.equal(body.includes("手順1"), true);
  assert.equal(body.includes("手順4"), true);
  assert.equal(body.includes("手順5"), true);
  assert.equal(body.includes("/s12/nonces"), true);
  assert.equal(body.includes("/s12/freeze-revoke"), true);
  assert.equal(body.includes("/s12/send-revoke"), true);
  assert.equal(body.includes("/s12/send-verify-only"), true);
  // 主体ハッシュ・世代・トークンの入力欄がないこと（チェックだけ）。
  assert.equal(body.includes('type="text"'), false);
  assert.equal(body.includes('type="url"'), false);
  assert.equal(body.includes('type="password"'), false);
});

test("S12 入口：/s12-revoke.mjs は純粋モジュールを返す", async () => {
  const r = await fetch(base + "/s12-revoke.mjs");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /javascript/);
  const body = await r.text();
  assert.equal(body.includes("createS12Session"), true);
  assert.equal(body.includes("freezeRevokeRequest"), true);
  assert.equal(body.includes("heldTokenFreshness"), true);
  assert.equal(body.includes("s12_held_token_stale"), true);
  assert.equal(body.includes("S12_TOKEN_ERASE_TRIGGERS"), true);
  assert.equal(body.includes("recordHeldBVerifyOnly"), true);
  // 画面が import する検証モジュールも配信されていること。
  const verify = await fetch(base + "/subject-hash-verify.mjs");
  assert.equal(verify.status, 200);
  assert.equal((await verify.text()).includes("verifyIdTokenLocal"), true);
  const s9 = await fetch(base + "/s9-negative.mjs");
  assert.equal(s9.status, 200);
  assert.equal((await s9.text()).includes("assertLogHasNoSecrets"), true);
});

test("S12 入口：/s12/nonces はセッションなしでは 403 で、発行もされない", async () => {
  const beforeCount = nonceCounter;
  const r = await fetch(base + "/s12/nonces?trial_id=t-entry&slot=heldB");
  assert.equal(r.status, 403);
  const data = await r.json();
  assert.equal(data.error, "s12_bad_session");
  assert.equal(nonceCounter, beforeCount);
});

test("S12 入口：/s12/nonces はセッション付きで nonce だけを返し、ctx は出ない", async () => {
  const r = await fetch(base + "/s12/nonces?trial_id=t-entry&slot=heldB", {
    headers: { "x-s12-session": s12Session },
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.nonce, "fake-nonce-1");
  assert.equal(JSON.stringify(data).includes("fake-ctx"), false);
});

test("S12 入口：/s12/nonces は未知のスロットを 400 で拒否する", async () => {
  const r = await fetch(base + "/s12/nonces?trial_id=t-entry&slot=other", {
    headers: { "x-s12-session": s12Session },
  });
  assert.equal(r.status, 400);
});

test("S12 入口：/s12/send-* はセッションなしでは 403 になる", async () => {
  for (const p of ["/s12/freeze-revoke", "/s12/send-revoke", "/s12/send-verify-only"]) {
    const r = await fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trial_id: "t-entry", request: {} }),
    });
    assert.equal(r.status, 403);
    const data = await r.json();
    assert.equal(data.error, "s12_bad_session");
  }
});

test("S12 入口：送信経路（失効→提示）が偽の中継と往復し、スロットの ctx と固定 Origin が付く", async () => {
  const trial = "t-flow";
  const get = async (slot) => {
    const r = await fetch(base + `/s12/nonces?trial_id=${trial}&slot=${slot}`, {
      headers: { "x-s12-session": s12Session },
    });
    assert.equal(r.status, 200);
    return (await r.json()).nonce;
  };
  const heldNonce = await get("heldB");
  const authNonce = await get("revokeA");
  const freshNonce = await get("freshB");
  // 凍結した対象（B）を送信器に固定する。応答は ok だけで、
  // 固定値そのものは返らない。
  const freezeRes = await fetch(base + "/s12/freeze-revoke", {
    method: "POST",
    headers: { "content-type": "application/json", "x-s12-session": s12Session },
    body: JSON.stringify({ trial_id: trial, subject_hash: HASH_B }),
  });
  assert.equal(freezeRes.status, 200);
  assert.deepEqual(await freezeRes.json(), { ok: true });
  // 固定した対象と異なる失効要求は、送信器の境界で 409 に
  // なり、中継へは送られない（スロットも消費されない）。
  const mismatchRes = await fetch(base + "/s12/send-revoke", {
    method: "POST",
    headers: { "content-type": "application/json", "x-s12-session": s12Session },
    body: JSON.stringify({
      trial_id: trial,
      request: {
        id_token: fakeToken("sub-a", authNonce),
        subject_hash: "a".repeat(64),
        expected_generation: 4,
      },
    }),
  });
  assert.equal(mismatchRes.status, 409);
  assert.equal((await mismatchRes.json()).error, "s12_revoke_target_mismatch");
  assert.equal(relayCalls.revoke.length, 0);
  // 失効の送信。
  const revokeRes = await fetch(base + "/s12/send-revoke", {
    method: "POST",
    headers: { "content-type": "application/json", "x-s12-session": s12Session },
    body: JSON.stringify({
      trial_id: trial,
      request: {
        id_token: fakeToken("sub-a", authNonce),
        subject_hash: HASH_B,
        expected_generation: 4,
      },
    }),
  });
  assert.equal(revokeRes.status, 200);
  const revokeOut = await revokeRes.json();
  assert.deepEqual(revokeOut, { status: 200, error: null, generation: 5 });
  assert.equal(relayCalls.revoke.length, 1);
  // revokeA は2番目に発行されたスロットであり、その ctx が付く。
  assert.equal(relayCalls.revoke[0].headers.cookie, "op2_nonce_ctx=fake-ctx-3");
  assert.equal(relayCalls.revoke[0].headers.origin, "http://localhost:8787");
  assert.equal(relayCalls.revoke[0].body.subject_hash, HASH_B);
  // 新しい B の提示。
  const verifyRes = await fetch(base + "/s12/send-verify-only", {
    method: "POST",
    headers: { "content-type": "application/json", "x-s12-session": s12Session },
    body: JSON.stringify({
      trial_id: trial,
      slot: "freshB",
      request: { id_token: fakeToken("sub-b", freshNonce) },
    }),
  });
  assert.equal(verifyRes.status, 200);
  const verifyOut = await verifyRes.json();
  assert.deepEqual(verifyOut, { status: 403, error: "not_operator", generation: null });
  assert.equal(relayCalls.verifyOnly.length, 1);
  assert.equal(relayCalls.verifyOnly[0].headers.cookie, "op2_nonce_ctx=fake-ctx-4");
  assert.ok(heldNonce);
});

test("S12 入口：送信器の事前確認エラーは理由コードだけが 409 で返り、送信されない", async () => {
  const beforeRevoke = relayCalls.revoke.length;
  const r = await fetch(base + "/s12/send-revoke", {
    method: "POST",
    headers: { "content-type": "application/json", "x-s12-session": s12Session },
    body: JSON.stringify({
      trial_id: "t-flow",
      request: {
        id_token: fakeToken("sub-a", "nonce-mismatch"),
        subject_hash: HASH_B,
        expected_generation: 4,
      },
    }),
  });
  // revokeA は消費済みのため s12_not_prepared（409）。いずれにせよ
  // 中継へは送られていない。
  assert.equal(r.status, 409);
  const data = await r.json();
  assert.equal(typeof data.error, "string");
  assert.equal(relayCalls.revoke.length, beforeRevoke);
});

test("S12 入口：未知のパスは 404 になる", async () => {
  const r = await fetch(base + "/s12-unknown");
  assert.equal(r.status, 404);
});

after(() => {
  child.kill("SIGTERM");
  relay.close();
});
