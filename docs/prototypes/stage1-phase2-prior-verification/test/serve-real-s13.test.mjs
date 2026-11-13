// 提供サーバー（tools/serve-real.mjs）の S13 入口（/s13-revoke・
// /s13-revoke.mjs・/s13/nonces・/s13/send-*）の実行試験。
// 実行: node --test test/serve-real-s13.test.mjs
// 実 Google・実 Worker とは通信しない。serve-real.mjs を子プロセスで
// 起動し、配信（クライアント ID と S13 セッションの差し込み・内容・
// 種別）と、/s13/nonces の呼び出し元境界（セッションなしは 403 で
// 状態を変更しない）、送信経路（偽の中継に対する失効2件と提示の
// 往復と事前確認エラーの写像）を HTTP 層で確認する。秘密の値は
// 使わない。/s13/nonces の正常系は、偽の中継（/nonce に nonce と
// Set-Cookie を返す）で確認する（ctx は応答に出ない）。
// 偽の中継の失効応答は、対象が A 自身なら 409 last_operator、
// それ以外は 200（generation 6）であり、S13 の期待の形を模す。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_PORT = 8906;
const CLIENT_ID = "serve-s13-client-id.apps.googleusercontent.com";
const HASH_A = "a".repeat(64);
const HASH_C = "c".repeat(64);

// 偽の JWT（署名検証はしない。ペイロードの nonce クレームだけを
// 送信器が読む）。実トークンではない。
function fakeToken(sub, nonce) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT", kid: "fake" })}.${b64({ sub, nonce })}.fakesig`;
}

// 偽の中継。/nonce には nonce と op2_nonce_ctx の Set-Cookie を
// 返し、/admin/* への送信を記録して S13 の期待の形の応答を返す。
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
        if (record.body && record.body.subject_hash === HASH_A) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "last_operator" }));
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, generation: 6 }));
        }
      } else {
        relayCalls.verifyOnly.push(record);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, generation: 6 }));
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

// 配信された画面から S13 セッションの値を取り出す（試験内だけの
// 扱いであり、値そのものは検証の対象にしない）。
let s13Session = null;

test("S13 入口：/s13-revoke は画面を返し、クライアント ID とセッションが差し込まれる", async () => {
  const r = await fetch(base + "/s13-revoke");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const body = await r.text();
  assert.equal(body.includes("REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID"), false);
  assert.equal(body.includes("REPLACE_WITH_S13_SESSION"), false);
  assert.equal(body.includes(CLIENT_ID), true);
  const m = body.match(/const S13_SESSION = "([^"]+)"/);
  assert.ok(m, "S13 セッションの差し込みが見つかりません");
  s13Session = m[1];
  // S13 失効画面であること（手順0〜3と送信器への言及を含む）。
  assert.equal(body.includes("手順0"), true);
  assert.equal(body.includes("手順1"), true);
  assert.equal(body.includes("手順2"), true);
  assert.equal(body.includes("手順3"), true);
  assert.equal(body.includes("last_operator"), true);
  assert.equal(body.includes("/s13/nonces"), true);
  assert.equal(body.includes("/s13/freeze-revoke"), true);
  assert.equal(body.includes("/s13/send-revoke"), true);
  assert.equal(body.includes("/s13/send-verify-only"), true);
  // 主体ハッシュ・世代・トークンの入力欄がないこと（チェックだけ）。
  assert.equal(body.includes('type="text"'), false);
  assert.equal(body.includes('type="url"'), false);
  assert.equal(body.includes('type="password"'), false);
});

test("S13 入口：/s13-revoke.mjs は純粋モジュールを返す", async () => {
  const r = await fetch(base + "/s13-revoke.mjs");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /javascript/);
  const body = await r.text();
  assert.equal(body.includes("createS13Session"), true);
  assert.equal(body.includes("freezeRevokeCRequest"), true);
  assert.equal(body.includes("freezeRevokeARequest"), true);
  assert.equal(body.includes("recordRevokeASend"), true);
  assert.equal(body.includes("last_operator"), true);
  assert.equal(body.includes("S13_TOKEN_ERASE_TRIGGERS"), true);
  // 画面が import する検証モジュールも配信されていること。
  const verify = await fetch(base + "/subject-hash-verify.mjs");
  assert.equal(verify.status, 200);
  assert.equal((await verify.text()).includes("verifyIdTokenLocal"), true);
  const s9 = await fetch(base + "/s9-negative.mjs");
  assert.equal(s9.status, 200);
  assert.equal((await s9.text()).includes("assertLogHasNoSecrets"), true);
});

test("S13 入口：/s13/nonces はセッションなしでは 403 で、発行もされない", async () => {
  const beforeCount = nonceCounter;
  const r = await fetch(base + "/s13/nonces?trial_id=t-entry&slot=revokeC");
  assert.equal(r.status, 403);
  const data = await r.json();
  assert.equal(data.error, "s13_bad_session");
  assert.equal(nonceCounter, beforeCount);
});

test("S13 入口：/s13/nonces はセッション付きで nonce だけを返し、ctx は出ない", async () => {
  const r = await fetch(base + "/s13/nonces?trial_id=t-entry&slot=revokeC", {
    headers: { "x-s13-session": s13Session },
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.nonce, "fake-nonce-1");
  assert.equal(JSON.stringify(data).includes("fake-ctx"), false);
});

test("S13 入口：/s13/nonces は未知のスロット（対象取得を含む）を 400 で拒否する", async () => {
  for (const slot of ["other", "targetC"]) {
    const r = await fetch(base + `/s13/nonces?trial_id=t-entry&slot=${slot}`, {
      headers: { "x-s13-session": s13Session },
    });
    assert.equal(r.status, 400);
  }
});

test("S13 入口：/s13/send-* はセッションなしでは 403 になる", async () => {
  for (const p of ["/s13/freeze-revoke", "/s13/send-revoke", "/s13/send-verify-only"]) {
    const r = await fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trial_id: "t-entry", slot: "revokeC", request: {} }),
    });
    assert.equal(r.status, 403);
    const data = await r.json();
    assert.equal(data.error, "s13_bad_session");
  }
});

test("S13 入口：送信経路（失効C→失効A試行→提示）が偽の中継と往復し、スロットの ctx と固定 Origin が付く", async () => {
  const trial = "t-flow";
  const get = async (slot) => {
    const r = await fetch(base + `/s13/nonces?trial_id=${trial}&slot=${slot}`, {
      headers: { "x-s13-session": s13Session },
    });
    assert.equal(r.status, 200);
    return (await r.json()).nonce;
  };
  const revokeCNonce = await get("revokeC");
  const revokeANonce = await get("revokeA");
  const checkANonce = await get("checkA");
  const post = async (p, payload) => {
    const r = await fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json", "x-s13-session": s13Session },
      body: JSON.stringify(payload),
    });
    return { status: r.status, json: await r.json() };
  };
  // 手順1の凍結した対象（C）を送信器に固定する。応答は ok だけ
  // で、固定値そのものは返らない。
  const freezeC = await post("/s13/freeze-revoke", {
    trial_id: trial, slot: "revokeC", subject_hash: HASH_C,
  });
  assert.equal(freezeC.status, 200);
  assert.deepEqual(freezeC.json, { ok: true });
  // 固定した対象と異なる失効要求は、送信器の境界で 409 になり、
  // 中継へは送られない（スロットも消費されない）。
  const mismatch = await post("/s13/send-revoke", {
    trial_id: trial,
    slot: "revokeC",
    request: {
      id_token: fakeToken("sub-a", revokeCNonce),
      subject_hash: HASH_A,
      expected_generation: 5,
    },
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.json.error, "s13_revoke_target_mismatch");
  assert.equal(relayCalls.revoke.length, 0);
  // 手順1：C の失効の送信。
  const revokeC = await post("/s13/send-revoke", {
    trial_id: trial,
    slot: "revokeC",
    request: {
      id_token: fakeToken("sub-a", revokeCNonce),
      subject_hash: HASH_C,
      expected_generation: 5,
    },
  });
  assert.equal(revokeC.status, 200);
  assert.deepEqual(revokeC.json, { status: 200, error: null, generation: 6 });
  assert.equal(relayCalls.revoke.length, 1);
  // revokeC は全体で2番目に発行されたスロットであり、その ctx が付く。
  assert.equal(relayCalls.revoke[0].headers.cookie, "op2_nonce_ctx=fake-ctx-2");
  assert.equal(relayCalls.revoke[0].headers.origin, "http://localhost:8787");
  assert.equal(relayCalls.revoke[0].body.subject_hash, HASH_C);
  assert.equal(relayCalls.revoke[0].body.expected_generation, 5);
  // 手順2の凍結した対象（A 自身）を送信器に固定する。
  const freezeA = await post("/s13/freeze-revoke", {
    trial_id: trial, slot: "revokeA", subject_hash: HASH_A,
  });
  assert.equal(freezeA.status, 200);
  assert.deepEqual(freezeA.json, { ok: true });
  // 手順2：A 自身の失効試行。中継は 409 last_operator を返し、
  // その応答がそのまま画面側へ返る（期待結果＝合格の形）。
  const revokeA = await post("/s13/send-revoke", {
    trial_id: trial,
    slot: "revokeA",
    request: {
      id_token: fakeToken("sub-a", revokeANonce),
      subject_hash: HASH_A,
      expected_generation: 6,
    },
  });
  assert.equal(revokeA.status, 200);
  assert.deepEqual(revokeA.json, { status: 409, error: "last_operator", generation: null });
  assert.equal(relayCalls.revoke.length, 2);
  assert.equal(relayCalls.revoke[1].headers.cookie, "op2_nonce_ctx=fake-ctx-3");
  assert.equal(relayCalls.revoke[1].body.expected_generation, 6);
  // 手順3：A の提示。
  const verify = await post("/s13/send-verify-only", {
    trial_id: trial,
    slot: "checkA",
    request: { id_token: fakeToken("sub-a", checkANonce) },
  });
  assert.equal(verify.status, 200);
  assert.deepEqual(verify.json, { status: 200, error: null, generation: 6 });
  assert.equal(relayCalls.verifyOnly.length, 1);
  assert.equal(relayCalls.verifyOnly[0].headers.cookie, "op2_nonce_ctx=fake-ctx-4");
  assert.equal(relayCalls.verifyOnly[0].headers.origin, "http://localhost:8787");
});

test("S13 入口：送信器の事前確認エラーは理由コードだけが 409 で返り、送信されない", async () => {
  const beforeRevoke = relayCalls.revoke.length;
  const r = await fetch(base + "/s13/send-revoke", {
    method: "POST",
    headers: { "content-type": "application/json", "x-s13-session": s13Session },
    body: JSON.stringify({
      trial_id: "t-flow",
      slot: "revokeC",
      request: {
        id_token: fakeToken("sub-a", "nonce-mismatch"),
        subject_hash: HASH_C,
        expected_generation: 5,
      },
    }),
  });
  // revokeC は消費済みのため s13_not_prepared（409）。いずれにせよ
  // 中継へは送られていない。
  assert.equal(r.status, 409);
  const data = await r.json();
  assert.equal(typeof data.error, "string");
  assert.equal(relayCalls.revoke.length, beforeRevoke);
});

test("S13 入口：未知のパスは 404 になる", async () => {
  const r = await fetch(base + "/s13-unknown");
  assert.equal(r.status, 404);
});

after(() => {
  child.kill("SIGTERM");
  relay.close();
});
