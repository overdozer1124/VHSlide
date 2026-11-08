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
import { createHash } from "node:crypto";
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

    // 対象主体ハッシュ取得ページの配信確認（Codex レビュー 6714139864
    // への対応で追加）。実 GIS の確認ではなく、配管（配信・クライアント
    // ID 差し込み・検証モジュールの配信）だけを確認する。
    const shRes = await fetch(base + "/subject-hash");
    const shHtml = await shRes.text();
    check(
      "スモーク: /subject-hash が取得ページを返し、クライアントIDが差し込まれ、外部検証への送信がない",
      shRes.status === 200 &&
        shHtml.includes(CLIENT_ID) &&
        !shHtml.includes("REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID") &&
        shHtml.includes("oauth2/v3/certs") &&
        !/tokeninfo/i.test(shHtml)
    );
    const shJsRes = await fetch(base + "/subject-hash-verify.mjs");
    const shJs = await shJsRes.text();
    check(
      "スモーク: /subject-hash-verify.mjs が検証モジュールを返し、署名検証を含む",
      shJsRes.status === 200 &&
        shJs.includes("RSASSA-PKCS1-v1_5") &&
        shJs.includes("verifyIdTokenLocal") &&
        !/tokeninfo/i.test(shJs)
    );

    // 不一致試験専用画面の配信確認（Codex 再レビュー 6715453178 への
    // 対応で追加）。実 GIS の確認ではなく、配管（配信・クライアント
    // ID 差し込み・検証モジュールの配信）と、画面に秘密の項目名そのもの
    // が現れないことだけを確認する。
    const taRes = await fetch(base + "/trial-apply");
    const taHtml = await taRes.text();
    check(
      "スモーク: /trial-apply が専用画面を返し、クライアントIDが差し込まれ、秘密の項目名がない",
      taRes.status === 200 &&
        taHtml.includes(CLIENT_ID) &&
        !taHtml.includes("REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID") &&
        taHtml.includes("oauth2/v3/certs") &&
        !/tokeninfo/i.test(taHtml) &&
        !taHtml.includes("id_token") &&
        !taHtml.includes("one_time_value")
    );
    const taJsRes = await fetch(base + "/trial-apply.mjs");
    const taJs = await taJsRes.text();
    check(
      "スモーク: /trial-apply.mjs が検証モジュールを返し、要求の凍結と表示・実送信の同一性確認を含む",
      taJsRes.status === 200 &&
        taJs.includes("buildTrialRequest") &&
        taJs.includes("verifyDisplayMatchesSent") &&
        taJs.includes("Object.freeze")
    );
    check(
      "スモーク: /trial-apply が環境条件の機械検証と試行ごとの世代管理の配線を含む",
      taRes.status === 200 &&
        taHtml.includes("verifyEnvCondition") &&
        taHtml.includes("createTrialSession") &&
        taHtml.includes("stage1-verification-only-20261101")
    );
    check(
      "スモーク: /trial-apply.mjs が環境条件・世代管理・応答エラー正規化を含む",
      taJsRes.status === 200 &&
        taJs.includes("verifyEnvCondition") &&
        taJs.includes("createTrialSession") &&
        taJs.includes("normalizeResponseError")
    );

    // 故障マーカーの素通し確認（手順書 v0.3 の実証前確認）:
    // 故障版ビルドを中継先にして /platform/apply を提供サーバー経由で
    // 実施し、500 の応答本文（detail のマーカー）が欠落せず届くことを
    // 確認する。値はすべてダミーであり、秘密は含まれない。これで
    // 「提供サーバーが応答本文を素通しする」ことまでをローカルで
    // 確認し、実環境では PC 側で応答本文を直接取得する手順につなぐ。
    const mfF = new Miniflare({
      modules: true,
      scriptPath: path.join(ROOT, "fault-builds", "apply-after-writes", "worker.js"),
      compatibilityDate: "2025-01-01",
      durableObjects: { REGISTRY: { className: "RegistryDO", useSQLite: true } },
      durableObjectsPersist: path.join(ROOT, ".persist-smoke-fault"),
      bindings: {
        DEPLOYMENT_TIER: "local-mock",
        MOCK_AUTH: "1",
        ALLOW_TEST_HOOKS: "1",
        GOOGLE_CLIENT_ID: CLIENT_ID,
        ENV_ID,
        DIAG_KEY: "smoke-diag-key",
        APPROVAL_ENV_ID: ENV_ID,
        APPROVAL_PURPOSE: "bootstrap",
        APPROVAL_SUBJECT_HASH: createHash("sha256").update("smoke-fault-subject", "utf8").digest("hex"),
        APPROVAL_EXPIRES_AT: String(Date.now() + 600000),
        APPROVAL_ONE_TIME: "smoke-one-time-value",
        APPROVAL_OPERATION_ID: "op-smoke-fault",
      },
    });
    const mfFUrl = (await mfF.ready).toString().replace(/\/$/, "");
    const childF = spawn("node", [path.join(ROOT, "tools", "serve-real.mjs")], {
      env: {
        ...process.env,
        GOOGLE_CLIENT_ID: CLIENT_ID,
        RELAY_URL: mfFUrl,
        PORT: "8898",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const baseF = "http://127.0.0.1:8898";
      let readyF = false;
      for (let i = 0; i < 50 && !readyF; i++) {
        try {
          const r = await fetch(baseF + "/");
          if (r.status === 200) readyF = true;
        } catch { /* 起動待ち */ }
        if (!readyF) await new Promise((r) => setTimeout(r, 200));
      }
      let markerSeen = false;
      let detailF = "";
      if (readyF) {
        const nRes = await fetch(baseF + "/nonce");
        const nJson = await nRes.json().catch(() => null);
        const cookieF = (nRes.headers.get("set-cookie") || "").split(";")[0];
        const expF = String(Math.floor(Date.now() / 1000) + 600);
        const tokenF = `mockop|smoke-fault-subject|${nJson && nJson.nonce}|https://accounts.google.com|${CLIENT_ID}|${expF}`;
        const aRes = await fetch(baseF + "/platform/apply", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Origin: "http://localhost:8787",
            Cookie: cookieF,
          },
          body: JSON.stringify({
            purpose: "bootstrap",
            env_id: ENV_ID,
            one_time_value: "smoke-one-time-value",
            id_token: tokenF,
          }),
        });
        const aText = await aRes.text();
        markerSeen = aRes.status === 500 && aText.includes("injected_fault_apply_after_writes");
        detailF = `status=${aRes.status} body=${aText.slice(0, 200)}`;
      } else {
        detailF = "serve-real（故障版用）が起動しなかった";
      }
      check(
        "スモーク: 故障マーカーが提供サーバー経由の応答本文で観察できる（500・detail 素通し）",
        markerSeen,
        detailF
      );
    } finally {
      childF.kill("SIGTERM");
      await mfF.dispose();
    }
  }
} finally {
  child.kill("SIGTERM");
  await mf.dispose();
}

const pass = results.filter((r) => r.pass).length;
const fail = results.length - pass;
console.log(`\n===== スモーク結果: ${pass} PASS / ${fail} FAIL（全 ${results.length} 件） =====`);
process.exitCode = fail > 0 ? 1 : 0;
