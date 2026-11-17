// 提供サーバー（tools/serve-real.mjs）の S5 入口（/s5/nonces・/s5/send）
// の呼び出し元境界の実行試験（Codex レビュー 6720755818 の指摘3）。
// 実行: node --test test/serve-real-s5.test.mjs
// 実 Google・実 Worker とは通信しない。偽の中継（ローカルの HTTP
// サーバー）を RELAY_URL に向け、serve-real.mjs を子プロセスで起動
// して、HTTP 層の検査（Host・Origin・試験単位セッション・JSON
// content-type・本体サイズ上限・試行の結び付け）を確認する。秘密の
// 値は使わない（セッションは起動時に発行される不可推測の値であり、
// 配信された画面から読み取る。値は表示・記録しない）。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildS5Requests } from "../tools/s5-apply.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_PORT = 8897;
const CLIENT_ID = "serve-s5-client-id.apps.googleusercontent.com";
const ENV_ID = "stage1-phase2-verification-local";
const FIXED_ENV_ID = "stage1-verification-only-20261101";

// 偽の中継。/nonce は呼び出しごとに異なる nonce・ctx を返し、
// /platform/apply は 200 の空応答を返す。届いた要求を記録する
// （ガードで拒否された呼び出しが中継へ届かないことの確認用）。
const relayRequests = [];
let nonceCounter = 0;
const relay = http.createServer((req, res) => {
  relayRequests.push({ method: req.method, url: req.url });
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  if (req.method === "GET" && pathname === "/nonce") {
    nonceCounter += 1;
    const n = nonceCounter;
    res.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": [
        `op2_nonce_ctx=fake-ctx-${n}; HttpOnly; SameSite=Strict; Path=/; Max-Age=300`,
      ],
    });
    res.end(JSON.stringify({ nonce: `fake-nonce-${n}` }));
    return;
  }
  if (req.method === "POST" && pathname === "/platform/apply") {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({}));
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

// http.request による呼び出し（fetch では設定できない Origin・Host を
// 含む任意のヘッダーを送れる）。応答の状態と本体だけを返す。
function httpRequest({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: SERVE_PORT, method, path, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

// 生ソケットによる呼び出し（Host ヘッダーを完全に制御する。
// DNS rebinding の模擬で、接続先は 127.0.0.1 のまま Host だけを
// 別名にする）。Connection: close で応答後に切断させる。
function rawRequest(raw) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SERVE_PORT, "127.0.0.1");
    let data = "";
    sock.on("data", (c) => { data += c.toString("utf8"); });
    sock.on("end", () => resolve(data));
    sock.on("error", reject);
    sock.write(raw);
  });
}

function parseStatus(raw) {
  const m = raw.match(/^HTTP\/\S+ (\d+)/);
  return m ? Number(m[1]) : null;
}

function mockToken(nonce) {
  const exp = String(Math.floor(Date.now() / 1000) + 600);
  return `mockop|serve-s5-subject|${nonce}|https://accounts.google.com|${CLIENT_ID}|${exp}`;
}

function buildRequests(nonces) {
  return buildS5Requests({
    tokens: nonces.map((n) => mockToken(n)),
    oneTimeValue: "serve-s5-one-time",
    purpose: "full-replace",
    envId: FIXED_ENV_ID,
  });
}

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

// 配信された画面から試験単位のセッションを読み取る（画面が受け取る
// 方法と同じ。値は表示・記録しない）。
const s5Page = await (await fetch(base + "/s5-apply")).text();
const sessionMatch = s5Page.match(/const S5_SESSION = "([^"]+)"/);
assert.ok(sessionMatch, "画面に S5 セッションが差し込まれていること");
assert.ok(!s5Page.includes("REPLACE_WITH_S5_SESSION"), "セッションのプレースホルダが残らないこと");
const SESSION = sessionMatch[1];
assert.ok(SESSION.length >= 20, "セッションが不可推測の長さであること");

const relayNonceCount = () => relayRequests.filter((r) => r.url === "/nonce").length;
const relayApplyCount = () =>
  relayRequests.filter((r) => r.url === "/platform/apply").length;

test("S5 入口：セッションなしの /s5/nonces は 403 で拒否され、中継へ届かない", async () => {
  const before = relayNonceCount();
  const r = await httpRequest({ method: "GET", path: "/s5/nonces?trial_id=trial-guard-1" });
  assert.equal(r.status, 403);
  assert.equal(JSON.parse(r.body).error, "s5_bad_session");
  assert.equal(relayNonceCount(), before, "拒否された呼び出しは中継へ届かないこと");
});

test("S5 入口：セッション不一致の /s5/nonces は 403 で拒否される", async () => {
  const before = relayNonceCount();
  const r = await httpRequest({
    method: "GET",
    path: "/s5/nonces?trial_id=trial-guard-2",
    headers: { "x-s5-session": "wrong-session-value" },
  });
  assert.equal(r.status, 403);
  assert.equal(JSON.parse(r.body).error, "s5_bad_session");
  assert.equal(relayNonceCount(), before);
});

test("S5 入口：別オリジンからの /s5/nonces は 403 で拒否される", async () => {
  const before = relayNonceCount();
  const r = await httpRequest({
    method: "GET",
    path: "/s5/nonces?trial_id=trial-guard-3",
    headers: {
      "x-s5-session": SESSION,
      Origin: "https://evil.example",
    },
  });
  assert.equal(r.status, 403);
  assert.equal(JSON.parse(r.body).error, "s5_bad_origin");
  assert.equal(relayNonceCount(), before);
});

test("S5 入口：Host が別名の要求（DNS rebinding の模擬）は 403 で拒否される", async () => {
  const before = relayNonceCount();
  const raw = await rawRequest(
    "GET /s5/nonces?trial_id=trial-guard-4 HTTP/1.1\r\n" +
      "Host: attacker.example\r\n" +
      `x-s5-session: ${SESSION}\r\n` +
      "Connection: close\r\n\r\n"
  );
  assert.equal(parseStatus(raw), 403);
  assert.ok(raw.includes("s5_bad_origin"));
  assert.equal(relayNonceCount(), before);
});

test("S5 入口：Host のポートが違う要求は 403 で拒否される", async () => {
  const before = relayNonceCount();
  const raw = await rawRequest(
    "GET /s5/nonces?trial_id=trial-guard-5 HTTP/1.1\r\n" +
      "Host: 127.0.0.1:9999\r\n" +
      `x-s5-session: ${SESSION}\r\n` +
      "Connection: close\r\n\r\n"
  );
  assert.equal(parseStatus(raw), 403);
  assert.ok(raw.includes("s5_bad_origin"));
  assert.equal(relayNonceCount(), before);
});

test("S5 入口：正しいセッション・試行 ID の /s5/nonces は 6件の異なる nonce を返す", async () => {
  const before = relayNonceCount();
  const r = await httpRequest({
    method: "GET",
    path: "/s5/nonces?trial_id=trial-serve-1",
    headers: {
      "x-s5-session": SESSION,
      Origin: `http://127.0.0.1:${SERVE_PORT}`,
    },
  });
  assert.equal(r.status, 200);
  const nonces = JSON.parse(r.body).nonces;
  assert.equal(nonces.length, 6);
  assert.equal(new Set(nonces).size, 6);
  assert.equal(relayNonceCount(), before + 6);
  // この試行の nonce を後の送信試験で使うため、グローバルに保持する。
  globalThis.__noncesTrial1 = nonces;
});

test("S5 入口：試行 ID が違う送信指示は s5_trial_mismatch で拒否され、状態は残る", async () => {
  const before = relayApplyCount();
  const requests = buildRequests(globalThis.__noncesTrial1);
  const r = await httpRequest({
    method: "POST",
    path: "/s5/send",
    headers: {
      "content-type": "application/json",
      "x-s5-session": SESSION,
      Origin: `http://127.0.0.1:${SERVE_PORT}`,
    },
    body: JSON.stringify({ trial_id: "trial-serve-other", requests }),
  });
  assert.equal(r.status, 409);
  assert.equal(JSON.parse(r.body).error, "s5_trial_mismatch");
  assert.equal(relayApplyCount(), before, "拒否された送信は中継へ届かないこと");
});

test("S5 入口：正しいセッション・試行 ID の送信指示は 6件を送信する", async () => {
  const before = relayApplyCount();
  const requests = buildRequests(globalThis.__noncesTrial1);
  const r = await httpRequest({
    method: "POST",
    path: "/s5/send",
    headers: {
      "content-type": "application/json",
      "x-s5-session": SESSION,
      Origin: `http://127.0.0.1:${SERVE_PORT}`,
    },
    body: JSON.stringify({ trial_id: "trial-serve-1", requests }),
  });
  assert.equal(r.status, 200);
  const out = JSON.parse(r.body);
  assert.equal(out.results.length, 6);
  assert.ok(out.results.every((x) => x.status === 200));
  assert.equal(relayApplyCount(), before + 6);
});

test("S5 入口：別試行の発行が先行試行の送信を無効化する（別画面との競合）", async () => {
  // 試行 trial-serve-2 を発行し、試行 trial-serve-1 の送信を試みる。
  const r2 = await httpRequest({
    method: "GET",
    path: "/s5/nonces?trial_id=trial-serve-2",
    headers: { "x-s5-session": SESSION },
  });
  assert.equal(r2.status, 200);
  const nonces2 = JSON.parse(r2.body).nonces;
  const requests1 = buildRequests(globalThis.__noncesTrial1);
  const rOld = await httpRequest({
    method: "POST",
    path: "/s5/send",
    headers: {
      "content-type": "application/json",
      "x-s5-session": SESSION,
    },
    body: JSON.stringify({ trial_id: "trial-serve-1", requests: requests1 }),
  });
  assert.equal(rOld.status, 409);
  assert.equal(JSON.parse(rOld.body).error, "s5_trial_mismatch");
  // 新しい試行では送信できる。
  const requests2 = buildRequests(nonces2);
  const rNew = await httpRequest({
    method: "POST",
    path: "/s5/send",
    headers: {
      "content-type": "application/json",
      "x-s5-session": SESSION,
    },
    body: JSON.stringify({ trial_id: "trial-serve-2", requests: requests2 }),
  });
  assert.equal(rNew.status, 200);
  assert.equal(JSON.parse(rNew.body).results.length, 6);
});

test("S5 入口：JSON 以外の content-type の /s5/send は 415 で拒否される", async () => {
  const before = relayApplyCount();
  const r = await httpRequest({
    method: "POST",
    path: "/s5/send",
    headers: {
      "content-type": "text/plain",
      "x-s5-session": SESSION,
    },
    body: "trial_id=trial-serve-3",
  });
  assert.equal(r.status, 415);
  assert.equal(JSON.parse(r.body).error, "bad_content_type");
  assert.equal(relayApplyCount(), before);
});

test("S5 入口：上限を超える本体の /s5/send は 413 で拒否される", async () => {
  const before = relayApplyCount();
  const big = JSON.stringify({ trial_id: "trial-serve-4", pad: "x".repeat(70 * 1024) });
  const r = await httpRequest({
    method: "POST",
    path: "/s5/send",
    headers: {
      "content-type": "application/json",
      "x-s5-session": SESSION,
    },
    body: big,
  });
  assert.equal(r.status, 413);
  assert.equal(JSON.parse(r.body).error, "body_too_large");
  assert.equal(relayApplyCount(), before);
});

test("S5 入口：セッションなしの /s5/send は 403 で拒否され、状態を変更しない", async () => {
  // まず正しいセッションで試行を発行しておく。
  const rIssue = await httpRequest({
    method: "GET",
    path: "/s5/nonces?trial_id=trial-serve-5",
    headers: { "x-s5-session": SESSION },
  });
  assert.equal(rIssue.status, 200);
  const nonces = JSON.parse(rIssue.body).nonces;
  const before = relayApplyCount();
  const requests = buildRequests(nonces);
  const r = await httpRequest({
    method: "POST",
    path: "/s5/send",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trial_id: "trial-serve-5", requests }),
  });
  assert.equal(r.status, 403);
  assert.equal(JSON.parse(r.body).error, "s5_bad_session");
  assert.equal(relayApplyCount(), before);
  // 拒否されても発行状態は残るため、正しいセッションでは送信できる。
  const rOk = await httpRequest({
    method: "POST",
    path: "/s5/send",
    headers: {
      "content-type": "application/json",
      "x-s5-session": SESSION,
    },
    body: JSON.stringify({ trial_id: "trial-serve-5", requests }),
  });
  assert.equal(rOk.status, 200);
  assert.equal(JSON.parse(rOk.body).results.length, 6);
});

after(() => {
  child.kill("SIGTERM");
  relay.close();
});
