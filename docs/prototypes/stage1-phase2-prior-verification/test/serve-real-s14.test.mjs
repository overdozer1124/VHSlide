// 提供サーバー（tools/serve-real.mjs）の S14 入口（/s14-rotate・
// /s14-rotate.mjs・/s14/nonces・/s14/send-*）の実行試験。
// 実行: node --test test/serve-real-s14.test.mjs
// 実 Google・実 Worker とは通信しない。serve-real.mjs を子プロセスで
// 起動し、配信（クライアント ID と S14 セッションの差し込み・内容・
// 種別）と、/s14/nonces の呼び出し元境界（セッションなしは 403 で
// 状態を変更しない）、送信経路（偽の中継に対するローテーションと
// 提示2件の往復と事前確認エラーの写像）を HTTP 層で確認する。秘密の
// 値は使わない。/s14/nonces の正常系は、偽の中継（/nonce に nonce と
// Set-Cookie を返す）で確認する（ctx は応答に出ない）。
// 偽の中継のローテーション応答は 200（generation 7）であり、
// verify-only は、トークンの主体がローテーション元（sub-a）なら
// 403 not_operator、それ以外は 200（generation 7）であり、S14 の
// 期待の形を模す。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_PORT = 8908;
const CLIENT_ID = "serve-s14-client-id.apps.googleusercontent.com";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

// 偽の JWT（署名検証はしない。ペイロードの nonce クレームだけを
// 送信器が読む）。実トークンではない。
function fakeToken(sub, nonce) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT", kid: "fake" })}.${b64({ sub, nonce })}.fakesig`;
}

// 偽の中継。/nonce には nonce と op2_nonce_ctx の Set-Cookie を
// 返し、/admin/* への送信を記録して S14 の期待の形の応答を返す。
let nonceCounter = 0;
const relayCalls = { rotate: [], verifyOnly: [] };
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
  if (req.url === "/admin/registry/rotate" || req.url === "/admin/verify-only") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const record = {
        headers: req.headers,
        body: body ? JSON.parse(body) : null,
      };
      if (req.url === "/admin/registry/rotate") {
        relayCalls.rotate.push(record);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, generation: 7 }));
      } else {
        relayCalls.verifyOnly.push(record);
        const payload = JSON.parse(
          Buffer.from(record.body.id_token.split(".")[1], "base64url").toString("utf8")
        );
        if (payload.sub === "sub-a") {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not_operator" }));
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, generation: 7 }));
        }
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

// 配信された画面から S14 セッションの値を取り出す（試験内だけの
// 扱いであり、値そのものは検証の対象にしない）。
let s14Session = null;

test("S14 入口：/s14-rotate は画面を返し、クライアント ID とセッションが差し込まれる", async () => {
  const r = await fetch(base + "/s14-rotate");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const body = await r.text();
  assert.equal(body.includes("REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID"), false);
  assert.equal(body.includes("REPLACE_WITH_S14_SESSION"), false);
  assert.equal(body.includes(CLIENT_ID), true);
  const m = body.match(/const S14_SESSION = "([^"]+)"/);
  assert.ok(m, "S14 セッションの差し込みが見つかりません");
  s14Session = m[1];
  // S14 ローテーション画面であること（手順0〜3と送信器への言及を含む）。
  assert.equal(body.includes("手順0"), true);
  assert.equal(body.includes("手順1"), true);
  assert.equal(body.includes("手順2"), true);
  assert.equal(body.includes("手順3"), true);
  assert.equal(body.includes("rotate"), true);
  assert.equal(body.includes("not_operator"), true);
  assert.equal(body.includes("/s14/nonces"), true);
  assert.equal(body.includes("/s14/freeze-rotate"), true);
  assert.equal(body.includes("/s14/send-rotate"), true);
  assert.equal(body.includes("/s14/send-verify-only"), true);
  // 主体ハッシュ・世代・トークンの入力欄がないこと（チェックだけ）。
  assert.equal(body.includes('type="text"'), false);
  assert.equal(body.includes('type="url"'), false);
  assert.equal(body.includes('type="password"'), false);
});

test("S14 入口：/s14-rotate.mjs は純粋モジュールを返す", async () => {
  const r = await fetch(base + "/s14-rotate.mjs");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /javascript/);
  const body = await r.text();
  assert.equal(body.includes("createS14Session"), true);
  assert.equal(body.includes("freezeRotateRequest"), true);
  assert.equal(body.includes("recordCheckAVerifyOnly"), true);
  assert.equal(body.includes("recordCheckBVerifyOnly"), true);
  assert.equal(body.includes("not_operator"), true);
  assert.equal(body.includes("S14_TOKEN_ERASE_TRIGGERS"), true);
  // 画面が import する検証モジュールも配信されていること。
  const verify = await fetch(base + "/subject-hash-verify.mjs");
  assert.equal(verify.status, 200);
  assert.equal((await verify.text()).includes("verifyIdTokenLocal"), true);
  const s9 = await fetch(base + "/s9-negative.mjs");
  assert.equal(s9.status, 200);
  assert.equal((await s9.text()).includes("assertLogHasNoSecrets"), true);
});

test("S14 入口：/s14/nonces はセッションなしでは 403 で、発行もされない", async () => {
  const beforeCount = nonceCounter;
  const r = await fetch(base + "/s14/nonces?trial_id=t-entry&slot=rotateAB");
  assert.equal(r.status, 403);
  const data = await r.json();
  assert.equal(data.error, "s14_bad_session");
  assert.equal(nonceCounter, beforeCount);
});

test("S14 入口：/s14/nonces はセッション付きで nonce だけを返し、ctx は出ない", async () => {
  const r = await fetch(base + "/s14/nonces?trial_id=t-entry&slot=rotateAB", {
    headers: { "x-s14-session": s14Session },
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.nonce, "fake-nonce-1");
  assert.equal(JSON.stringify(data).includes("fake-ctx"), false);
});

test("S14 入口：/s14/nonces は未知のスロット（対象取得を含む）を 400 で拒否する", async () => {
  for (const slot of ["other", "targetA", "targetB"]) {
    const r = await fetch(base + `/s14/nonces?trial_id=t-entry&slot=${slot}`, {
      headers: { "x-s14-session": s14Session },
    });
    assert.equal(r.status, 400);
  }
});

test("S14 入口：/s14/send-* はセッションなしでは 403 になる", async () => {
  for (const p of ["/s14/freeze-rotate", "/s14/send-rotate", "/s14/send-verify-only"]) {
    const r = await fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trial_id: "t-entry", slot: "rotateAB", request: {} }),
    });
    assert.equal(r.status, 403);
    const data = await r.json();
    assert.equal(data.error, "s14_bad_session");
  }
});

test("S14 入口：送信経路（ローテーション→A提示の拒否→B提示）が偽の中継と往復し、スロットの ctx と固定 Origin が付く", async () => {
  const trial = "t-flow";
  const get = async (slot) => {
    const r = await fetch(base + `/s14/nonces?trial_id=${trial}&slot=${slot}`, {
      headers: { "x-s14-session": s14Session },
    });
    assert.equal(r.status, 200);
    return (await r.json()).nonce;
  };
  const rotateNonce = await get("rotateAB");
  const checkANonce = await get("checkA");
  const checkBNonce = await get("checkB");
  const post = async (p, payload) => {
    const r = await fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json", "x-s14-session": s14Session },
      body: JSON.stringify(payload),
    });
    return { status: r.status, json: await r.json() };
  };
  // 凍結した対象の組（旧主体 A・新主体 B）を送信器に固定する。
  // 応答は ok だけで、固定値そのものは返らない。
  const freeze = await post("/s14/freeze-rotate", {
    trial_id: trial, old_subject_hash: HASH_A, new_subject_hash: HASH_B,
  });
  assert.equal(freeze.status, 200);
  assert.deepEqual(freeze.json, { ok: true });
  // 固定した組と異なるローテーション要求は、送信器の境界で 409 に
  // なり、中継へは送られない（スロットも消費されない）。
  const mismatch = await post("/s14/send-rotate", {
    trial_id: trial,
    slot: "rotateAB",
    request: {
      id_token: fakeToken("sub-a", rotateNonce),
      old_subject_hash: HASH_A,
      new_subject_hash: HASH_C,
      expected_generation: 6,
    },
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.json.error, "s14_rotate_target_mismatch");
  assert.equal(relayCalls.rotate.length, 0);
  // 手順1：A→B のローテーションの送信。
  const rotate = await post("/s14/send-rotate", {
    trial_id: trial,
    slot: "rotateAB",
    request: {
      id_token: fakeToken("sub-a", rotateNonce),
      old_subject_hash: HASH_A,
      new_subject_hash: HASH_B,
      expected_generation: 6,
    },
  });
  assert.equal(rotate.status, 200);
  assert.deepEqual(rotate.json, { status: 200, error: null, generation: 7 });
  assert.equal(relayCalls.rotate.length, 1);
  // rotateAB は全体で2番目に発行されたスロットであり、その ctx が付く。
  assert.equal(relayCalls.rotate[0].headers.cookie, "op2_nonce_ctx=fake-ctx-2");
  assert.equal(relayCalls.rotate[0].headers.origin, "http://localhost:8787");
  assert.equal(relayCalls.rotate[0].body.old_subject_hash, HASH_A);
  assert.equal(relayCalls.rotate[0].body.new_subject_hash, HASH_B);
  assert.equal(relayCalls.rotate[0].body.expected_generation, 6);
  // 手順2：A の提示。中継は 403 not_operator を返し、その応答が
  // そのまま画面側へ返る（期待結果＝合格の形）。
  const verifyA = await post("/s14/send-verify-only", {
    trial_id: trial,
    slot: "checkA",
    request: { id_token: fakeToken("sub-a", checkANonce) },
  });
  assert.equal(verifyA.status, 200);
  assert.deepEqual(verifyA.json, { status: 403, error: "not_operator", generation: null });
  assert.equal(relayCalls.verifyOnly.length, 1);
  assert.equal(relayCalls.verifyOnly[0].headers.cookie, "op2_nonce_ctx=fake-ctx-3");
  // 手順3：B の提示。
  const verifyB = await post("/s14/send-verify-only", {
    trial_id: trial,
    slot: "checkB",
    request: { id_token: fakeToken("sub-b", checkBNonce) },
  });
  assert.equal(verifyB.status, 200);
  assert.deepEqual(verifyB.json, { status: 200, error: null, generation: 7 });
  assert.equal(relayCalls.verifyOnly.length, 2);
  assert.equal(relayCalls.verifyOnly[1].headers.cookie, "op2_nonce_ctx=fake-ctx-4");
  assert.equal(relayCalls.verifyOnly[1].headers.origin, "http://localhost:8787");
});

test("S14 入口：送信器の事前確認エラーは理由コードだけが 409 で返り、送信されない", async () => {
  const beforeRotate = relayCalls.rotate.length;
  const r = await fetch(base + "/s14/send-rotate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-s14-session": s14Session },
    body: JSON.stringify({
      trial_id: "t-flow",
      slot: "rotateAB",
      request: {
        id_token: fakeToken("sub-a", "nonce-mismatch"),
        old_subject_hash: HASH_A,
        new_subject_hash: HASH_B,
        expected_generation: 6,
      },
    }),
  });
  // rotateAB は消費済みのため s14_not_prepared（409）。いずれにせよ
  // 中継へは送られていない。
  assert.equal(r.status, 409);
  const data = await r.json();
  assert.equal(typeof data.error, "string");
  assert.equal(relayCalls.rotate.length, beforeRotate);
});

test("S14 入口：未知のパスは 404 になる", async () => {
  const r = await fetch(base + "/s14-unknown");
  assert.equal(r.status, 404);
});

after(() => {
  child.kill("SIGTERM");
  relay.close();
});
