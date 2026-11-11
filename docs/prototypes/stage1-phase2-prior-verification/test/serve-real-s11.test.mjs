// 提供サーバー（tools/serve-real.mjs）の S11 入口（/s11-parallel・
// /s11-parallel.mjs・/s11/nonces）の実行試験。
// 実行: node --test test/serve-real-s11.test.mjs
// 実 Google・実 Worker とは通信しない。serve-real.mjs を子プロセスで
// 起動し、配信（クライアント ID と S11 セッションの差し込み・内容・
// 種別）と、/s11/nonces の呼び出し元境界（セッションなしは 403 で
// 状態を変更しない）を HTTP 層で確認する。秘密の値は使わない。
// /s11/nonces の正常系は、偽の中継（/nonce に nonce と Set-Cookie
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
const SERVE_PORT = 8902;
const CLIENT_ID = "serve-s11-client-id.apps.googleusercontent.com";

// 偽の中継。/nonce には nonce と op2_nonce_ctx の Set-Cookie を返す。
let nonceCounter = 0;
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

// 配信された画面から S11 セッションの値を取り出す（試験内だけの
// 扱いであり、値そのものは検証の対象にしない）。
let s11Session = null;

test("S11 入口：/s11-parallel は画面を返し、クライアント ID とセッションが差し込まれる", async () => {
  const r = await fetch(base + "/s11-parallel");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const body = await r.text();
  assert.equal(body.includes("REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID"), false);
  assert.equal(body.includes("REPLACE_WITH_S11_SESSION"), false);
  assert.equal(body.includes(CLIENT_ID), true);
  const m = body.match(/const S11_SESSION = "([^"]+)"/);
  assert.ok(m, "S11 セッションの差し込みが見つかりません");
  s11Session = m[1];
  // S11 並行送信画面であること（手順3・手順4と送信器への言及を含む）。
  assert.equal(body.includes("手順3"), true);
  assert.equal(body.includes("手順4"), true);
  assert.equal(body.includes("/s11/nonces"), true);
  assert.equal(body.includes("/s11/send-concurrent"), true);
  // 主体ハッシュ・世代・トークンの入力欄がないこと（チェックだけ）。
  assert.equal(body.includes('type="text"'), false);
  assert.equal(body.includes('type="url"'), false);
  assert.equal(body.includes('type="password"'), false);
});

test("S11 入口：/s11-parallel.mjs は純粋モジュールを返す", async () => {
  const r = await fetch(base + "/s11-parallel.mjs");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /javascript/);
  const body = await r.text();
  assert.equal(body.includes("createS11Session"), true);
  assert.equal(body.includes("freezeStaleRequest"), true);
  assert.equal(body.includes("freezeConcurrentRequests"), true);
  assert.equal(body.includes("target_matches_operator"), true);
  assert.equal(body.includes("authorizer_mismatch"), true);
  assert.equal(body.includes("aggregateS11ConcurrentResults"), true);
  assert.equal(body.includes("makeS11ConcurrentLogEntry"), true);
  // 画面が import する検証モジュールも配信されていること。
  const verify = await fetch(base + "/subject-hash-verify.mjs");
  assert.equal(verify.status, 200);
  assert.equal((await verify.text()).includes("verifyIdTokenLocal"), true);
  const s9 = await fetch(base + "/s9-negative.mjs");
  assert.equal(s9.status, 200);
  assert.equal((await s9.text()).includes("assertLogHasNoSecrets"), true);
});

test("S11 入口：/s11/nonces はセッションなしでは 403 で、発行もされない", async () => {
  const beforeCount = nonceCounter;
  const r = await fetch(base + "/s11/nonces?trial_id=t-entry&procedure=stale");
  assert.equal(r.status, 403);
  const data = await r.json();
  assert.equal(data.error, "s11_bad_session");
  assert.equal(nonceCounter, beforeCount);
});

test("S11 入口：/s11/nonces はセッション付きで nonce だけを返し、ctx は出ない", async () => {
  const r = await fetch(base + "/s11/nonces?trial_id=t-entry&procedure=concurrent", {
    headers: { "x-s11-session": s11Session },
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(Array.isArray(data.nonces), true);
  assert.equal(data.nonces.length, 2);
  assert.notEqual(data.nonces[0], data.nonces[1]);
  assert.equal(JSON.stringify(data).includes("fake-ctx"), false);
});

test("S11 入口：/s11/nonces は未知の手順を 400 で拒否する", async () => {
  const r = await fetch(base + "/s11/nonces?trial_id=t-entry&procedure=other", {
    headers: { "x-s11-session": s11Session },
  });
  assert.equal(r.status, 400);
});

test("S11 入口：/s11/send-* はセッションなしでは 403 になる", async () => {
  const r = await fetch(base + "/s11/send-stale", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trial_id: "t-entry", request: {} }),
  });
  assert.equal(r.status, 403);
  const data = await r.json();
  assert.equal(data.error, "s11_bad_session");
});

test("S11 入口：未知のパスは 404 になる", async () => {
  const r = await fetch(base + "/s11-unknown");
  assert.equal(r.status, 404);
});

after(() => {
  child.kill("SIGTERM");
  relay.close();
});
