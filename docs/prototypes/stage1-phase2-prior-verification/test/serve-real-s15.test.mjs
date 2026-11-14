// 提供サーバー（tools/serve-real.mjs）の S15 入口（/s15-apply.mjs・
// /s15/nonces・/s15/freeze-approval・/s15/send-discard・
// /s15/record-judgment）の実行試験。
// 実行: node --test test/serve-real-s15.test.mjs
// 実 Google・実 Worker とは通信しない。serve-real.mjs を子プロセスで
// 起動し、次を HTTP 層で確認する。
// - /s15-apply.mjs が状態機械モジュールをそのまま返すこと。
// - S15 入口の呼び出し元境界：試験単位セッション（x-s15-session）
//   を示さない呼び出しは 403 で拒否され、中継へは何も送られず、
//   送信器の状態も変わらないこと。S15 には専用画面がなく、
//   セッション値はどの配信ページにも差し込まれないため、正当な
//   セッションを示す往復はここでは行わない（送信器の往復は
//   test/s15-sender.test.mjs と test/s15-guard.test.mjs が実
//   ビルドで確認する。セッション値の受け渡し方法は実施手順の
//   提案で確定する開いた点であり、DESIGN.md の S15 付録に
//   記録する）。
// - 未知の経路は 404 であること。
// 秘密の値は使わない。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_PORT = 8910;
const CLIENT_ID = "serve-s15-client-id.apps.googleusercontent.com";
const HASH_B = "b".repeat(64);
const ENV_ID = "stage1-phase2-verification-local";

// 偽の中継。/nonce と /platform/apply への呼び出しを数えるだけ
// であり、S15 入口の境界が正しければどちらも呼ばれない。
const relayCalls = { nonce: 0, apply: 0 };
const relay = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    if (req.url === "/nonce") {
      relayCalls.nonce += 1;
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "op2_nonce_ctx=fake-ctx; Path=/; HttpOnly",
      });
      res.end(JSON.stringify({ nonce: "fake-nonce" }));
      return;
    }
    if (req.url === "/platform/apply") {
      relayCalls.apply += 1;
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
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

after(async () => {
  child.kill();
  relay.close();
});

test("S15 入口：/s15-apply.mjs は状態機械モジュールを返す", async () => {
  const r = await fetch(base + "/s15-apply.mjs");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") || "", /javascript/);
  const text = await r.text();
  assert.ok(text.includes("createS15Session"));
  assert.ok(text.includes("judgeS15ReadBack"));
  assert.ok(text.includes("recordNormalRestored"));
});

test("S15 入口：セッションなしの /s15/nonces は 403 で、中継の /nonce は呼ばれない", async () => {
  const before = relayCalls.nonce;
  const r = await fetch(base + "/s15/nonces?trial_id=t1&attempt=1");
  assert.equal(r.status, 403);
  const json = await r.json();
  assert.equal(json.error, "s15_bad_session");
  // 誤ったセッション値でも同じく拒否される。
  const r2 = await fetch(base + "/s15/nonces?trial_id=t1&attempt=1", {
    headers: { "x-s15-session": "not-the-session" },
  });
  assert.equal(r2.status, 403);
  assert.equal(relayCalls.nonce, before);
});

test("S15 入口：セッションなしの POST 群は 403 で、何も送られない", async () => {
  const before = { ...relayCalls };
  const post = (p, body) =>
    fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const freeze = await post("/s15/freeze-approval", {
    trial_id: "t1",
    attempt: 1,
    operation_id: "op-fixture-005",
    purpose: "full-replace",
    subject_hash: HASH_B,
    env_id: ENV_ID,
    one_time_value: "one-time-x",
  });
  assert.equal(freeze.status, 403);
  assert.equal((await freeze.json()).error, "s15_bad_session");
  const send = await post("/s15/send-discard", {
    trial_id: "t1",
    attempt: 1,
    request: {
      id_token: "token",
      one_time_value: "one-time-x",
      purpose: "full-replace",
      env_id: ENV_ID,
    },
  });
  assert.equal(send.status, 403);
  const judge = await post("/s15/record-judgment", {
    trial_id: "t1",
    attempt: 1,
    outcome: "uncommitted",
  });
  assert.equal(judge.status, 403);
  assert.deepEqual(relayCalls, before);
});

test("S15 入口：セッション値はどの配信ページにも差し込まれない", async () => {
  // S15 専用画面はなく、既存画面の配信にも S15 セッションの
  // プレースホルダは存在しない。境界の確認として、トップと
  // S14 画面の配信に x-s15-session の手がかりが含まれないこと
  // だけを見る（値そのものは試験側にも分からない設計である）。
  const top = await (await fetch(base + "/")).text();
  assert.ok(!top.includes("REPLACE_WITH_S15_SESSION"));
  const s14 = await (await fetch(base + "/s14-rotate")).text();
  assert.ok(!s14.includes("REPLACE_WITH_S15_SESSION"));
});

test("S15 入口：未知の経路は 404", async () => {
  const r = await fetch(base + "/s15-unknown");
  assert.equal(r.status, 404);
});
