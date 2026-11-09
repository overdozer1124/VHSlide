// 提供サーバー（tools/serve-real.mjs）の S9 入口（/s9-negative・
// /s9-negative.mjs）の実行試験。
// 実行: node --test test/serve-real-s9.test.mjs
// 実 Google・実 Worker とは通信しない。serve-real.mjs を子プロセスで
// 起動し、2経路の配信（クライアント ID の差し込み・内容・種別）を
// HTTP 層で確認する。秘密の値は使わない。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_PORT = 8899;
const CLIENT_ID = "serve-s9-client-id.apps.googleusercontent.com";

// 偽の中継。S9 画面の配信には使わないが、serve-real の起動に
// RELAY_URL が必要であり、/nonce 等の転送先として用意する。
// この試験では転送経路を呼ばない。
const relay = http.createServer((req, res) => {
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

test("S9 入口：/s9-negative は画面を返し、クライアント ID が差し込まれる", async () => {
  const r = await fetch(base + "/s9-negative");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const body = await r.text();
  assert.equal(body.includes("REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID"), false);
  assert.equal(body.includes(CLIENT_ID), true);
  // S9 負例画面であること（固定の送信先とチェーン選択を含む）。
  assert.equal(body.includes("/admin/verify-only"), true);
  assert.equal(body.includes("tampered"), true);
  assert.equal(body.includes("no-cookie"), true);
  assert.equal(body.includes("resend"), true);
  // URL 入力欄がないこと（入力はチェーン選択とアカウント確認だけ）。
  assert.equal(body.includes('type="text"'), false);
  assert.equal(body.includes('type="url"'), false);
});

test("S9 入口：/s9-negative.mjs は純粋モジュールを返す", async () => {
  const r = await fetch(base + "/s9-negative.mjs");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /javascript/);
  const body = await r.text();
  assert.equal(body.includes("tamperSignature"), true);
  assert.equal(body.includes("createChainSession"), true);
  assert.equal(body.includes("verifyTamperPreservesStructure"), true);
  assert.equal(body.includes("nonceDeadline"), true);
  // 画面が import する検証モジュールも配信されていること。
  const verify = await fetch(base + "/subject-hash-verify.mjs");
  assert.equal(verify.status, 200);
  assert.equal((await verify.text()).includes("verifyIdTokenLocal"), true);
});

test("S9 入口：未知のパスは 404 になる", async () => {
  const r = await fetch(base + "/s9-unknown");
  assert.equal(r.status, 404);
});

after(() => {
  child.kill("SIGTERM");
  relay.close();
});
