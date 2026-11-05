// 実ログイン画面（public/login-real.html）と提供サーバー
// （tools/serve-real.mjs）のローカル疎通確認（スモーク）。
//
// 目的は「画面の配信・クライアントIDの差し込み・中継への転送
// （メソッド・Origin・Cookie・ボディの素通し）」という配管部分を
// ローカルで確認することであり、実 Google ログインの確認ではない
// （実 GIS の経路は実環境で確認する。模擬と実測を混同しない）。
//
// 構成: Miniflare で通常ビルド（local-mock）を起動し、その URL を
// RELAY_URL として serve-real.mjs を子プロセスで起動する。本物の
// 中継（remote service binding）の代わりに Miniflare の URL を
// 向ける点だけが実環境と異なる。
//
// 実行: node test/real-ui.smoke.mjs
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。
// ※ test/run.mjs の件数には含めない（別枠のローカル確認）。

import { Miniflare } from "miniflare";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_PORT = 8899;
const CLIENT_ID = "smoke-client-id.apps.googleusercontent.com";
const ENV_ID = "stage1-phase2-verification-local";

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -- " + detail}`);
}

const mf = new Miniflare({
  modules: true,
  scriptPath: path.join(ROOT, "src", "worker.js"),
  compatibilityDate: "2025-01-01",
  durableObjects: { REGISTRY: { className: "RegistryDO", useSQLite: true } },
  durableObjectsPersist: path.join(ROOT, ".persist-smoke"),
  bindings: {
    DEPLOYMENT_TIER: "local-mock",
    MOCK_AUTH: "1",
    ALLOW_TEST_HOOKS: "1",
    GOOGLE_CLIENT_ID: CLIENT_ID,
    ENV_ID,
    DIAG_KEY: "smoke-diag-key",
  },
});
const mfUrl = (await mf.ready).toString().replace(/\/$/, "");

const child = spawn("node", [path.join(ROOT, "tools", "serve-real.mjs")], {
  env: {
    ...process.env,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    RELAY_URL: mfUrl,
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

try {
  const ready = await waitReady();
  check("スモーク: serve-real が起動し、画面を返す", ready, childLog.slice(-400));
  if (ready) {
    const html = await (await fetch(base + "/")).text();
    check(
      "スモーク: クライアントIDが差し込まれ、プレースホルダが残らない",
      html.includes(CLIENT_ID) &&
        !html.includes("REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID") &&
        html.includes("accounts.google.com/gsi/client")
    );

    const nonceRes = await fetch(base + "/nonce");
    const nonceJson = await nonceRes.json().catch(() => null);
    const setCookie = nonceRes.headers.get("set-cookie") || "";
    check(
      "スモーク: /nonce が中継経由で届き、ctx Cookie が素通しで返る",
      nonceRes.status === 200 &&
        !!(nonceJson && nonceJson.nonce) &&
        setCookie.includes("op2_nonce_ctx="),
      `status=${nonceRes.status} set-cookie=${setCookie}`
    );

    // 登録簿が空の状態での verify-only は、配管が通れば
    // not_operator で拒否される（Origin・Cookie・ボディの素通しの確認）。
    const cookie = setCookie.split(";")[0];
    const exp = String(Math.floor(Date.now() / 1000) + 600);
    const token = `mockop|smoke-subject|${nonceJson.nonce}|https://accounts.google.com|${CLIENT_ID}|${exp}`;
    const voRes = await fetch(base + "/admin/verify-only", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: "http://localhost:8787",
        Cookie: cookie,
      },
      body: JSON.stringify({ id_token: token }),
    });
    const voJson = await voRes.json().catch(() => null);
    check(
      "スモーク: /admin/verify-only が中継経由で届き、未登録主体は 403 not_operator",
      voRes.status === 403 && voJson && voJson.error === "not_operator",
      `status=${voRes.status} body=${JSON.stringify(voJson)}`
    );

    const nf = await fetch(base + "/no-such-path");
    check("スモーク: 転送対象外のパスは提供サーバーが 404 を返す", nf.status === 404);
  }
} finally {
  child.kill("SIGTERM");
  await mf.dispose();
}

const pass = results.filter((r) => r.pass).length;
const fail = results.length - pass;
console.log(`\n===== スモーク結果: ${pass} PASS / ${fail} FAIL（全 ${results.length} 件） =====`);
process.exitCode = fail > 0 ? 1 : 0;
