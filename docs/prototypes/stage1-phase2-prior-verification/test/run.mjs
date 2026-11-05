// VHSlide 段階①フェーズ2 先行検証ハーネス 試験ランナー（ローカル模擬）
//
// 実施計画 v0.5 の 2.7（先行検証9項目）のうち、ローカルで検証可能な
// 部分を自動確認する。実 Google・実 Cloudflare には接続しない。
// 各 check 名の先頭には対応する 2.7 の項目番号を付ける。
// 2.7 は全項目「検証環境での実測を必須」と定めており、本ランナーの
// PASS は「ローカル模擬での確認」であって受入条件の充足ではない
// （実環境必須の部分は DESIGN.md の対応表に明記する）。
//
// 一時ビルドと通常ビルドの切り替えは、同じ永続化ディレクトリに
// 対して Miniflare インスタンス（scriptPath が異なる）を差し替えて
// 再現する（配置→操作→復帰→読み戻し、という実際の手順の順序どおり）。
//
// 実行: npm test  （= node test/run.mjs）
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

{
  let mfVersion = "unknown";
  try {
    mfVersion = JSON.parse(
      readFileSync(path.join(ROOT, "node_modules", "miniflare", "package.json"), "utf8")
    ).version;
  } catch { /* バージョンが読めなくても試験は続ける */ }
  console.log(
    `実行環境: OS=${os.platform()} ${os.release()} (${os.arch()}) Node=${process.version} Miniflare=${mfVersion}`
  );
}

const ORIGIN = "http://localhost:8787";
const ENV_ID = "stage1-phase2-verification-local";
const CLIENT_ID = "dummy-client-id.apps.googleusercontent.com";
const DIAG_KEY = "test-diag-key";
const ISS = "https://accounts.google.com";

const SUB_A = "operator-subject-alpha";   // 初期投入の対象
const SUB_B = "operator-subject-beta";    // 追加・失効の対象／全面復旧の対象
const SUB_C = "operator-subject-gamma";   // 並行更新用
const SUB_D = "operator-subject-delta";   // 並行更新用
const SUB_E = "operator-subject-epsilon"; // ローテーション先
const SUB_X = "operator-subject-xray";    // 非運営者

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const HASH_A = sha256(SUB_A);
const HASH_B = sha256(SUB_B);
const HASH_C = sha256(SUB_C);
const HASH_D = sha256(SUB_D);
const HASH_E = sha256(SUB_E);

// ---------- 結果集計 ----------
const results = [];
function check(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -- " + detail}`);
}
function section(title) {
  console.log(`\n== ${title} ==`);
}

// ---------- Miniflare 起動 ----------
const COMMON_BINDINGS = {
  DEPLOYMENT_TIER: "local-mock",
  MOCK_AUTH: "1",
  ALLOW_TEST_HOOKS: "1",
  GOOGLE_CLIENT_ID: CLIENT_ID,
  ENV_ID,
  DIAG_KEY,
};

async function startBuild(scriptName, persistName, extraBindings = {}) {
  return startBuildPath(path.join("src", scriptName), persistName, extraBindings);
}

// 成果物の相対パスを指定して起動する（故障版ビルド用）。
async function startBuildPath(relScriptPath, persistName, extraBindings = {}) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: path.join(ROOT, relScriptPath),
    compatibilityDate: "2025-01-01",
    durableObjects: {
      REGISTRY: { className: "RegistryDO", useSQLite: true },
    },
    durableObjectsPersist: path.join(ROOT, persistName),
    bindings: Object.fromEntries(
      Object.entries({ ...COMMON_BINDINGS, ...extraBindings }).filter(
        ([, v]) => v !== undefined
      )
    ),
  });
  const url = await mf.ready;
  return { mf, base: url.toString().replace(/\/$/, "") };
}

function approvalBindings({
  operationId,
  purpose,
  subjectHash,
  oneTime,
  expiresAtMs,
}) {
  return {
    APPROVAL_ENV_ID: ENV_ID,
    APPROVAL_PURPOSE: purpose,
    APPROVAL_SUBJECT_HASH: subjectHash,
    APPROVAL_EXPIRES_AT: String(expiresAtMs),
    APPROVAL_ONE_TIME: oneTime,
    APPROVAL_OPERATION_ID: operationId,
  };
}

// ---------- HTTP ヘルパー ----------
async function call(base, method, p, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.origin !== null) headers["Origin"] = opts.origin || ORIGIN;
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  if (opts.diag) headers["X-Diag-Key"] = DIAG_KEY;
  let body;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(base + p, { method, headers, body });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

// nonce を取得し { nonce, cookie } を返す。
async function issueNonce(base) {
  const r = await call(base, "GET", "/nonce", { origin: null });
  if (r.status !== 200 || !r.json || !r.json.nonce) {
    throw new Error(`nonce issuance failed: status=${r.status}`);
  }
  const setCookie = r.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  return { nonce: r.json.nonce, cookie };
}

// モック ID トークンを組み立てる。検証項目を個別に壊せるよう上書き可能。
function mockToken(sub, nonce, overrides = {}) {
  const iss = overrides.iss !== undefined ? overrides.iss : ISS;
  const aud = overrides.aud !== undefined ? overrides.aud : CLIENT_ID;
  const exp =
    overrides.exp !== undefined
      ? overrides.exp
      : String(Math.floor(Date.now() / 1000) + 600);
  return `mockop|${sub}|${nonce}|${iss}|${aud}|${exp}`;
}

// nonce 取得＋トークン組立＋Cookie をまとめた「操作の試行」一式。
async function attempt(base, sub, overrides = {}) {
  const { nonce, cookie } = await issueNonce(base);
  return { token: mockToken(sub, nonce, overrides), cookie };
}

async function adminCall(base, pathName, sub, body = {}, overrides = {}) {
  const { token, cookie } = await attempt(base, sub, overrides);
  return call(base, "POST", pathName, {
    body: { ...body, id_token: token },
    cookie,
  });
}

async function platformApply(base, sub, body, opts = {}) {
  const { token, cookie } = await attempt(base, sub, opts.tokenOverrides || {});
  return call(base, "POST", "/platform/apply", {
    body: { ...body, id_token: token, ...(opts.extraBody || {}) },
    cookie,
    origin: opts.origin,
  });
}

async function inspectPlatform(base) {
  const r = await call(base, "GET", "/platform/inspect", { diag: true, origin: null });
  return r.json;
}

async function readRegistry(base) {
  const r = await call(base, "GET", "/test/registry", { diag: true, origin: null });
  return r.json;
}

function operatorHashes(state) {
  return (state.operators || []).map((o) => o.subject_hash).sort();
}

// ---------- DO への直接入口（Worker の fetch を経ない呼び出し） ----------
// 故障注入フックのゲートが、HTTP 入口での _fault 剥離に依存せず
// DO 自身でも効くことを確認するために使う。
async function doDirect(mf, pathName, payload) {
  const ns = await mf.getDurableObjectNamespace("REGISTRY");
  const stub = ns.get(ns.idFromName("registry:" + ENV_ID));
  const res = await stub.fetch("https://registry.internal" + pathName, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function platformApplyDirect(mf, sub, body, extraBody = {}) {
  const n = await doDirect(mf, "/do/nonce", {});
  if (n.status !== 200 || !n.json || !n.json.nonce) {
    throw new Error(`direct nonce issuance failed: status=${n.status}`);
  }
  return doDirect(mf, "/do/apply", {
    body: { ...body, id_token: mockToken(sub, n.json.nonce), ...extraBody },
    ctx: n.json.ctx,
  });
}

async function snapshotDirect(mf) {
  const r = await doDirect(mf, "/do/snapshot", {});
  return r.json;
}

const FUTURE = () => Date.now() + 10 * 60 * 1000;

// ---------- 本体 ----------
async function main() {
  for (const p of [
    ".persist-p1", ".persist-p2", ".persist-p3", ".persist-p4",
    ".persist-p5", ".persist-p6", ".persist-p7", ".persist-p8",
    ".persist-p9", ".persist-p10", ".persist-p11", ".persist-p12",
    ".persist-p13",
  ]) {
    rmSync(path.join(ROOT, p), { recursive: true, force: true });
  }

  // ===== 構成: ビルド成果物の分離（静的確認） =====
  section("構成 ビルド成果物の分離（静的確認）");
  {
    const normalSrc = readFileSync(path.join(ROOT, "src", "worker.js"), "utf8");
    const platformSrc = readFileSync(
      path.join(ROOT, "src", "platform-worker.js"),
      "utf8"
    );
    check(
      "構成: 通常ビルドの成果物に専用処理（/do/apply・固定値照合・消費判定）が含まれない",
      !normalSrc.includes("/do/apply") &&
        !normalSrc.includes("APPROVAL_ONE_TIME") &&
        !normalSrc.includes("operation_consumed")
    );
    check(
      "構成: 一時ビルドの成果物に専用処理は含まれ、管理処理（/do/admin）は含まれない",
      platformSrc.includes("/do/apply") && !platformSrc.includes("/do/admin")
    );
  }

  // ===== 設定検証（fail-closed） =====
  section("設定検証（fail-closed）");
  {
    const bad = await startBuild("worker.js", ".persist-p1", {
      DEPLOYMENT_TIER: undefined,
    });
    const r = await call(bad.base, "GET", "/nonce", { origin: null });
    check(
      "設定: DEPLOYMENT_TIER 未設定では全経路を 500 config_refused",
      r.status === 500 && r.json && r.json.error === "config_refused",
      `status=${r.status}`
    );
    await bad.mf.dispose();
  }

  // ===== 2.7-8（前段）: トークン検証項目（登録簿が空でも検証が先に効く） =====
  section("2.7-8 トークン検証（モック検証器による項目確認）");
  let normal = await startBuild("worker.js", ".persist-p1");
  {
    const cases = [
      ["iss 不一致", { iss: "https://evil.example.com" }, "bad_iss"],
      ["aud 不一致", { aud: "other-client" }, "bad_aud"],
      ["exp 期限切れ", { exp: String(Math.floor(Date.now() / 1000) - 60) }, "token_expired"],
      ["exp 非数値（有限数値検査）", { exp: "not-a-number" }, "token_expired"],
      ["nonce 欠落", null, "missing_nonce"],
    ];
    for (const [label, overrides, code] of cases) {
      let r;
      if (overrides === null) {
        // nonce を空にしたトークンを直接組み立てる
        const { cookie } = await issueNonce(normal.base);
        const token = `mockop|${SUB_A}||${ISS}|${CLIENT_ID}|${Math.floor(Date.now() / 1000) + 600}`;
        r = await call(normal.base, "POST", "/admin/verify-only", {
          body: { id_token: token },
          cookie,
        });
      } else {
        r = await adminCall(normal.base, "/admin/verify-only", SUB_A, {}, overrides);
      }
      check(
        `2.7-8: ${label} は 401 ${code}`,
        r.status === 401 && r.json && r.json.error === code,
        `status=${r.status} body=${JSON.stringify(r.json)}`
      );
    }
  }

  // ===== プラットフォーム経路: 初期投入（2.7-1/2/3） =====
  section("2.7-1/3 プラットフォーム経路・初期投入の固定値照合");
  await normal.mf.dispose();
  const approval1 = approvalBindings({
    operationId: "op-001",
    purpose: "bootstrap",
    subjectHash: HASH_A,
    oneTime: "one-time-value-001",
    expiresAtMs: FUTURE(),
  });
  let platform = await startBuild("platform-worker.js", ".persist-p1", approval1);
  const applyBody1 = {
    purpose: "bootstrap",
    env_id: ENV_ID,
    one_time_value: "one-time-value-001",
  };
  {
    let r = await platformApply(platform.base, SUB_A, {
      ...applyBody1,
      one_time_value: "wrong-value",
    });
    check(
      "2.7-1: 一回値の不一致は 403 bad_one_time_value",
      r.status === 403 && r.json.error === "bad_one_time_value",
      `status=${r.status} body=${JSON.stringify(r.json)}`
    );

    r = await platformApply(platform.base, SUB_A, {
      ...applyBody1,
      purpose: "full-replace",
    });
    check(
      "2.7-1: 用途の不一致は 403 purpose_mismatch",
      r.status === 403 && r.json.error === "purpose_mismatch",
      `status=${r.status}`
    );

    r = await platformApply(platform.base, SUB_A, {
      ...applyBody1,
      env_id: "some-other-env",
    });
    check(
      "2.7-1: 環境の不一致は 403 env_mismatch",
      r.status === 403 && r.json.error === "env_mismatch",
      `status=${r.status}`
    );

    // 項目3: 一回値を正しく知っていても、対象以外の主体は登録できない。
    r = await platformApply(platform.base, SUB_B, applyBody1);
    check(
      "2.7-3: 値が正しくても対象以外の主体は 403 subject_mismatch",
      r.status === 403 && r.json.error === "subject_mismatch",
      `status=${r.status}`
    );

    let state = await inspectPlatform(platform.base);
    check(
      "2.7-1/3: 拒否の連続では登録簿・消費・完了記録はすべて空のまま",
      state.operators.length === 0 &&
        state.consumed_ops.length === 0 &&
        state.completion.length === 0 &&
        state.initialized === false,
      JSON.stringify(state)
    );

    r = await platformApply(platform.base, SUB_A, applyBody1);
    check(
      "2.7-1: 固定値が完全一致すれば初期投入は 201",
      r.status === 201 && r.json.ok === true,
      `status=${r.status} body=${JSON.stringify(r.json)}`
    );

    state = await inspectPlatform(platform.base);
    const comp = state.completion[0] || {};
    check(
      "2.7-1: 登録簿は対象主体だけになり、完了記録が承認内容と一致する",
      operatorHashes(state).join() === HASH_A &&
        state.initialized === true &&
        state.generation === 1 &&
        comp.operation_id === "op-001" &&
        comp.purpose === "bootstrap" &&
        comp.env_id === ENV_ID &&
        comp.subject_hash === HASH_A,
      JSON.stringify(state)
    );
  }

  // ===== 2.7-2: 二重実施の拒否／旧ビルド再配置 =====
  section("2.7-2 原子的な一回消費（二重実施・旧ビルド再配置）");
  {
    const r = await platformApply(platform.base, SUB_A, applyBody1);
    check(
      "2.7-2: 同じ操作IDの二重実施は 409 operation_consumed",
      r.status === 409 && r.json.error === "operation_consumed",
      `status=${r.status}`
    );
  }
  await platform.mf.dispose();
  {
    // 期限切れビルド（2.7-4）: 期限が過去の承認では、apply 経路の
    // 要求がすべて approval_expired で拒否される。期限チェックは
    // apply 処理の入口にあり、他の固定値の照合より先に行われる
    // （確認範囲は apply 経路。それ以外の経路の扱いは手順書に明記）。
    const expired = await startBuild("platform-worker.js", ".persist-p1",
      approvalBindings({
        operationId: "op-009",
        purpose: "full-replace",
        subjectHash: HASH_A,
        oneTime: "one-time-value-009",
        expiresAtMs: Date.now() - 1000,
      })
    );
    const r = await platformApply(expired.base, SUB_A, {
      purpose: "full-replace",
      env_id: ENV_ID,
      one_time_value: "one-time-value-009",
    });
    check(
      "2.7-4: 期限切れの承認は 403 approval_expired",
      r.status === 403 && r.json.error === "approval_expired",
      `status=${r.status}`
    );
    const rWrong = await platformApply(expired.base, SUB_A, {
      purpose: "full-replace",
      env_id: ENV_ID,
      one_time_value: "wrong-value",
    });
    check(
      "2.7-4: 期限切れ後は一回値が不一致でも 403 approval_expired（期限チェックが apply の入口）",
      rWrong.status === 403 && rWrong.json.error === "approval_expired",
      `status=${rWrong.status} body=${JSON.stringify(rWrong.json)}`
    );
    const stateExp = await inspectPlatform(expired.base);
    check(
      "2.7-4: 期限切れ後の試行では登録簿・消費・完了記録は変わらない",
      operatorHashes(stateExp).join() === HASH_A &&
        stateExp.consumed_ops.length === 1 &&
        stateExp.completion.length === 1 &&
        stateExp.generation === 1,
      JSON.stringify(stateExp)
    );
    await expired.mf.dispose();
  }
  {
    // 新しい操作IDでも、初期投入は初期化済みで拒否される（2.3）。
    const again = await startBuild("platform-worker.js", ".persist-p1",
      approvalBindings({
        operationId: "op-002",
        purpose: "bootstrap",
        subjectHash: HASH_A,
        oneTime: "one-time-value-002",
        expiresAtMs: FUTURE(),
      })
    );
    const r = await platformApply(again.base, SUB_A, {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-value-002",
    });
    check(
      "2.7-2: 初期化済みの状態での初期投入（別操作ID）は 409 already_initialized",
      r.status === 409 && r.json.error === "already_initialized",
      `status=${r.status}`
    );
    await again.mf.dispose();
  }
  {
    // 旧い一時ビルドの再配置: 消費済み操作IDは再利用できない（2.6）。
    const old = await startBuild("platform-worker.js", ".persist-p1", approval1);
    const r = await platformApply(old.base, SUB_A, applyBody1);
    check(
      "2.7-2: 旧ビルド再配置でも消費済み操作IDは 409 operation_consumed",
      r.status === 409 && r.json.error === "operation_consumed",
      `status=${r.status}`
    );
    // 一時ビルドには管理ルートが存在しない。
    const r2 = await adminCall(old.base, "/admin/verify-only", SUB_A);
    check(
      "構成: 一時ビルドに /admin/* は存在しない（404）",
      r2.status === 404,
      `status=${r2.status}`
    );
    await old.mf.dispose();
  }

  // ===== 2.7-5（ローカル代替）: 復帰・経路消滅・読み戻し =====
  section("2.7-5 終了手順のローカル代替（復帰・404観察・読み戻し）");
  normal = await startBuild("worker.js", ".persist-p1");
  {
    const r = await platformApply(normal.base, SUB_A, applyBody1);
    check(
      "2.7-5: 通常ビルド復帰後、専用経路は 404（特定の要求条件での経路消滅の観察）",
      r.status === 404,
      `status=${r.status}`
    );
    const state = await readRegistry(normal.base);
    const comp = state.completion[0] || {};
    check(
      "2.7-5: 登録簿の読み戻しが承認内容と一致する",
      operatorHashes(state).join() === HASH_A &&
        state.initialized === true &&
        comp.operation_id === "op-001" &&
        comp.subject_hash === HASH_A &&
        comp.purpose === "bootstrap" &&
        comp.env_id === ENV_ID,
      JSON.stringify(state)
    );
  }

  // ===== 2.7-8（続き）: リプレイ／CSRF と 2.7-6: 失効と世代 =====
  section("2.7-8 リプレイ・CSRF / 2.7-6 失効と世代（アプリ側管理ルート）");
  {
    // 正常な verify-only
    let r = await adminCall(normal.base, "/admin/verify-only", SUB_A);
    check(
      "2.7-6: 運営者 A の verify-only は 200（世代1）",
      r.status === 200 && r.json.generation === 1,
      `status=${r.status} body=${JSON.stringify(r.json)}`
    );

    // リプレイ: 同じトークン（同じ nonce）の再提示
    const { token, cookie } = await attempt(normal.base, SUB_A);
    const r1 = await call(normal.base, "POST", "/admin/verify-only", {
      body: { id_token: token },
      cookie,
    });
    const r2 = await call(normal.base, "POST", "/admin/verify-only", {
      body: { id_token: token },
      cookie,
    });
    check(
      "2.7-8: 同一 nonce の再送は 403 nonce_replayed",
      r1.status === 200 && r2.status === 403 && r2.json.error === "nonce_replayed",
      `first=${r1.status} second=${r2.status}`
    );

    // CSRF: nonce の認証試行コンテキスト（Cookie）不一致
    const issued = await issueNonce(normal.base);
    const ctxToken = mockToken(SUB_A, issued.nonce);
    const rBad = await call(normal.base, "POST", "/admin/verify-only", {
      body: { id_token: ctxToken },
      cookie: "op2_nonce_ctx=deadbeefdeadbeef",
    });
    const rGood = await call(normal.base, "POST", "/admin/verify-only", {
      body: { id_token: ctxToken },
      cookie: issued.cookie,
    });
    check(
      "2.7-8: コンテキスト不一致は 403 で、拒否では nonce を消費しない",
      rBad.status === 403 &&
        rBad.json.error === "nonce_context_mismatch" &&
        rGood.status === 200,
      `bad=${rBad.status} good=${rGood.status}`
    );

    // CSRF: Origin 不一致
    const att = await attempt(normal.base, SUB_A);
    const rOrigin = await call(normal.base, "POST", "/admin/verify-only", {
      body: { id_token: att.token },
      cookie: att.cookie,
      origin: "http://evil.example.com",
    });
    check(
      "2.7-8: Origin 不一致は 403 bad_origin",
      rOrigin.status === 403 && rOrigin.json.error === "bad_origin",
      `status=${rOrigin.status}`
    );

    // 追加（世代1→2）
    r = await adminCall(normal.base, "/admin/registry/add", SUB_A, {
      subject_hash: HASH_B,
      expected_generation: 1,
    });
    check(
      "2.7-6: 追加は 200 で世代が 2 に進む",
      r.status === 200 && r.json.generation === 2,
      `status=${r.status} body=${JSON.stringify(r.json)}`
    );

    // 古い世代での更新は拒否
    r = await adminCall(normal.base, "/admin/registry/add", SUB_A, {
      subject_hash: HASH_C,
      expected_generation: 1,
    });
    check(
      "2.7-6: 古い世代に基づく更新は 409 stale_generation",
      r.status === 409 && r.json.error === "stale_generation",
      `status=${r.status}`
    );

    // 並行更新: 同じ世代への2件の追加は正確に1件だけ成功
    const [p1, p2] = await Promise.all([
      adminCall(normal.base, "/admin/registry/add", SUB_A, {
        subject_hash: HASH_C,
        expected_generation: 2,
      }),
      adminCall(normal.base, "/admin/registry/add", SUB_A, {
        subject_hash: HASH_D,
        expected_generation: 2,
      }),
    ]);
    const statuses = [p1.status, p2.status].sort();
    const stateAfter = await readRegistry(normal.base);
    check(
      "2.7-6: 同じ世代への並行更新は正確に1件だけ成功し、世代は 3",
      statuses.join() === "200,409" &&
        stateAfter.generation === 3 &&
        operatorHashes(stateAfter).length === 3,
      `statuses=${statuses} gen=${stateAfter.generation} ops=${operatorHashes(stateAfter)}`
    );
    const addedHash = operatorHashes(stateAfter).includes(HASH_C) ? HASH_C : HASH_D;
    const addedSub = addedHash === HASH_C ? SUB_C : SUB_D;

    // B のトークンを失効前に用意しておき、失効後に提示する
    const preIssued = await attempt(normal.base, SUB_B);
    r = await adminCall(normal.base, "/admin/registry/revoke", SUB_A, {
      subject_hash: HASH_B,
      expected_generation: 3,
    });
    check(
      "2.7-6: B の失効は 200 で世代が 4 に進む",
      r.status === 200 && r.json.generation === 4,
      `status=${r.status}`
    );
    const rPre = await call(normal.base, "POST", "/admin/verify-only", {
      body: { id_token: preIssued.token },
      cookie: preIssued.cookie,
    });
    check(
      "2.7-6: 失効後に、失効前に用意した同一トークンは 403 not_operator",
      rPre.status === 403 && rPre.json.error === "not_operator",
      `status=${rPre.status}`
    );
    r = await adminCall(normal.base, "/admin/verify-only", SUB_B);
    check(
      "2.7-6: 失効した運営者の次回操作（新しいトークン）も 403 not_operator",
      r.status === 403 && r.json.error === "not_operator",
      `status=${r.status}`
    );

    // ローテーション: 並行で追加された運営者を E に入れ替える
    r = await adminCall(normal.base, "/admin/registry/rotate", SUB_A, {
      old_subject_hash: addedHash,
      new_subject_hash: HASH_E,
      expected_generation: 4,
    });
    check(
      "2.7-6: ローテーションは 200 で世代が 5 に進む",
      r.status === 200 && r.json.generation === 5,
      `status=${r.status} body=${JSON.stringify(r.json)}`
    );
    const rOld = await adminCall(normal.base, "/admin/verify-only", addedSub);
    const rNew = await adminCall(normal.base, "/admin/verify-only", SUB_E);
    check(
      "2.7-6: ローテーション元は拒否され、移行先は通る",
      rOld.status === 403 && rNew.status === 200,
      `old=${rOld.status} new=${rNew.status}`
    );

    // 非運営者の操作は拒否（fail-closed）
    r = await adminCall(normal.base, "/admin/registry/add", SUB_X, {
      subject_hash: sha256(SUB_X + "-target"),
      expected_generation: 5,
    });
    check(
      "2.7-6: 非運営者による登録簿変更は 403 not_operator",
      r.status === 403 && r.json.error === "not_operator",
      `status=${r.status}`
    );
  }

  // ===== 全面復旧（プラットフォーム経路、別操作ID） =====
  section("プラットフォーム経路・全面復旧（2.3/2.7-1）");
  await normal.mf.dispose();
  {
    const replace = await startBuild("platform-worker.js", ".persist-p1",
      approvalBindings({
        operationId: "op-301",
        purpose: "full-replace",
        subjectHash: HASH_B,
        oneTime: "one-time-value-301",
        expiresAtMs: FUTURE(),
      })
    );
    const r = await platformApply(replace.base, SUB_B, {
      purpose: "full-replace",
      env_id: ENV_ID,
      one_time_value: "one-time-value-301",
    });
    check(
      "全面復旧: 新しい操作IDの承認で 201（復旧は繰り返せる形）",
      r.status === 201,
      `status=${r.status} body=${JSON.stringify(r.json)}`
    );
    const state = await inspectPlatform(replace.base);
    check(
      "全面復旧: 登録簿は新しい対象だけになり、完了記録が2件に増える",
      operatorHashes(state).join() === HASH_B &&
        state.completion.length === 2 &&
        state.completion[1].operation_id === "op-301" &&
        state.completion[1].purpose === "full-replace",
      JSON.stringify(state)
    );
    await replace.mf.dispose();

    normal = await startBuild("worker.js", ".persist-p1");
    const rA = await adminCall(normal.base, "/admin/verify-only", SUB_A);
    const rB = await adminCall(normal.base, "/admin/verify-only", SUB_B);
    check(
      "全面復旧: 旧運営者は拒否され、新しい運営者は通る",
      rA.status === 403 && rB.status === 200,
      `A=${rA.status} B=${rB.status}`
    );
    await normal.mf.dispose();
  }

  // ===== 2.7-2/9: 並行消費（正確に1件だけ成功） =====
  section("2.7-2/9 並行消費（初期投入への同時実施）");
  {
    const conc = await startBuild("platform-worker.js", ".persist-p2",
      approvalBindings({
        operationId: "op-101",
        purpose: "bootstrap",
        subjectHash: HASH_A,
        oneTime: "one-time-value-101",
        expiresAtMs: FUTURE(),
      })
    );
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => attempt(conc.base, SUB_A))
    );
    const rs = await Promise.all(
      attempts.map((a) =>
        call(conc.base, "POST", "/platform/apply", {
          body: {
            purpose: "bootstrap",
            env_id: ENV_ID,
            one_time_value: "one-time-value-101",
            id_token: a.token,
          },
          cookie: a.cookie,
        })
      )
    );
    const ok = rs.filter((x) => x.status === 201).length;
    const refused = rs.filter((x) => x.status === 409).length;
    const state = await inspectPlatform(conc.base);
    check(
      "2.7-2/9: 並行実施6件で成功は正確に1件、残りは 409",
      ok === 1 && refused === 5,
      `ok=${ok} refused=${refused} statuses=${rs.map((x) => x.status)}`
    );
    check(
      "2.7-2/9: 並行実施後の登録簿・完了記録は正確に1件分",
      operatorHashes(state).join() === HASH_A && state.completion.length === 1,
      JSON.stringify(state)
    );
    await conc.mf.dispose();
  }

  // ===== 2.7-9: 途中失敗のロールバック =====
  section("2.7-9 途中失敗時のロールバック（失敗注入・ローカル模擬のみ）");
  {
    const faultBuild = await startBuild("platform-worker.js", ".persist-p3",
      approvalBindings({
        operationId: "op-201",
        purpose: "bootstrap",
        subjectHash: HASH_A,
        oneTime: "one-time-value-201",
        expiresAtMs: FUTURE(),
      })
    );
    const body = {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-value-201",
    };
    const r = await platformApply(faultBuild.base, SUB_A, body, {
      extraBody: { _fault: "platform-mid" },
    });
    check(
      "2.7-9: 途中失敗の注入で 500",
      r.status === 500,
      `status=${r.status} body=${JSON.stringify(r.json)}`
    );
    const state = await inspectPlatform(faultBuild.base);
    check(
      "2.7-9: ロールバックで登録簿・消費・完了記録はすべて空に戻る",
      state.operators.length === 0 &&
        state.consumed_ops.length === 0 &&
        state.completion.length === 0 &&
        state.initialized === false &&
        state.generation === 0,
      JSON.stringify(state)
    );
    // 2.7-7 のローカル代替: 応答を失った想定でも再送せず、まず
    // 状態を読み戻して判断する。再送（リトライ）は消費されていない
    // ため安全に行えることが、読み戻しで確認できる。
    const r2 = await platformApply(faultBuild.base, SUB_A, body);
    check(
      "2.7-7: 読み戻しで未消費を確認した後の再実施は 201",
      r2.status === 201,
      `status=${r2.status}`
    );
    await faultBuild.mf.dispose();
  }

  // ===== 2.6: 旧ビルド再配置と「未消費・未期限」の操作ID =====
  // 現行の扱いの定義: サーバー側に発行済み承認の一覧がないため、
  // 未消費の操作IDを取り消す手段はない。旧い一時ビルドが再配置
  // されれば、その操作IDは引き続き実施可能になる（歯止めは有効
  // 期限のみ。再配置自体がプラットフォーム経路の行為であり、実施
  // できるのはアカウント保有者に限られる）。この振る舞いを、ここ
  // では「現行定義の確認」として記録する（取り消し手段の要否は
  // 未解決事項として DESIGN.md に残す）。
  section("2.6 旧ビルド再配置と未消費・未期限の操作ID（現行定義の確認）");
  {
    const bindings401 = approvalBindings({
      operationId: "op-401",
      purpose: "bootstrap",
      subjectHash: HASH_A,
      oneTime: "one-time-value-401",
      expiresAtMs: FUTURE(),
    });
    const body401 = {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-value-401",
    };
    // 承認を発行しただけで実施せず、通常ビルドへ差し替える。
    const issuedOnly = await startBuild("platform-worker.js", ".persist-p4", bindings401);
    await issuedOnly.mf.dispose();
    const normalP4 = await startBuild("worker.js", ".persist-p4");
    const r404 = await platformApply(normalP4.base, SUB_A, body401);
    check(
      "2.6: 未実施のまま通常ビルドへ戻れば、専用経路は 404",
      r404.status === 404,
      `status=${r404.status}`
    );
    await normalP4.mf.dispose();
    // 旧い一時ビルドを再配置すると、未消費・未期限の操作IDは
    // 引き続き実施可能になる（取り消し手段がないことの確認）。
    const redeployed = await startBuild("platform-worker.js", ".persist-p4", bindings401);
    const r = await platformApply(redeployed.base, SUB_A, body401);
    check(
      "2.6: 再配置された旧ビルドでは未消費・未期限の操作IDが実施可能（取り消し手段なし）",
      r.status === 201,
      `status=${r.status} body=${JSON.stringify(r.json)}`
    );
    const state = await inspectPlatform(redeployed.base);
    check(
      "2.6: 再配置後の実施でも完了記録は操作IDどおりに残る",
      state.completion.length === 1 &&
        state.completion[0].operation_id === "op-401" &&
        operatorHashes(state).join() === HASH_A,
      JSON.stringify(state)
    );
    await redeployed.mf.dispose();
  }

  // ===== 全面復旧は初期化前の状態では拒否する（2.1） =====
  section("プラットフォーム経路・全面復旧の初期化前拒否（2.1）");
  {
    const fr = await startBuild("platform-worker.js", ".persist-p6",
      approvalBindings({
        operationId: "op-403",
        purpose: "full-replace",
        subjectHash: HASH_A,
        oneTime: "one-time-value-403",
        expiresAtMs: FUTURE(),
      })
    );
    const r = await platformApply(fr.base, SUB_A, {
      purpose: "full-replace",
      env_id: ENV_ID,
      one_time_value: "one-time-value-403",
    });
    check(
      "全面復旧: 初期化前の状態では 409 not_initialized",
      r.status === 409 && r.json.error === "not_initialized",
      `status=${r.status} body=${JSON.stringify(r.json)}`
    );
    const state = await inspectPlatform(fr.base);
    check(
      "全面復旧: 拒否では登録簿・消費・完了記録は空で、未初期化のまま",
      state.operators.length === 0 &&
        state.consumed_ops.length === 0 &&
        state.completion.length === 0 &&
        state.initialized === false,
      JSON.stringify(state)
    );
    await fr.mf.dispose();
  }

  // ===== 2.7-6/2.1: 最後の運営者の失効拒否と並行削除 =====
  section("2.7-6/2.1 最後の運営者の保護（失効拒否・並行削除）");
  {
    const boot = await startBuild("platform-worker.js", ".persist-p5",
      approvalBindings({
        operationId: "op-402",
        purpose: "bootstrap",
        subjectHash: HASH_A,
        oneTime: "one-time-value-402",
        expiresAtMs: FUTURE(),
      })
    );
    const rb = await platformApply(boot.base, SUB_A, {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-value-402",
    });
    check(
      "準備: 初期投入で運営者 A が登録される（世代1）",
      rb.status === 201,
      `status=${rb.status}`
    );
    await boot.mf.dispose();

    const n5 = await startBuild("worker.js", ".persist-p5");
    let r = await adminCall(n5.base, "/admin/registry/add", SUB_A, {
      subject_hash: HASH_B,
      expected_generation: 1,
    });
    check(
      "準備: B の追加で世代が 2 に進む",
      r.status === 200 && r.json.generation === 2,
      `status=${r.status} body=${JSON.stringify(r.json)}`
    );

    // 並行削除: A が B を、B が A を、同じ世代（2）で同時に失効させる。
    // 直列化と世代照合により正確に1件だけ成功し、登録簿は空にならない。
    const [d1, d2] = await Promise.all([
      adminCall(n5.base, "/admin/registry/revoke", SUB_A, {
        subject_hash: HASH_B,
        expected_generation: 2,
      }),
      adminCall(n5.base, "/admin/registry/revoke", SUB_B, {
        subject_hash: HASH_A,
        expected_generation: 2,
      }),
    ]);
    const okCount = [d1, d2].filter((x) => x.status === 200).length;
    const refusedCount = [d1, d2].filter(
      (x) => x.status === 403 || x.status === 409
    ).length;
    const stateMid = await readRegistry(n5.base);
    check(
      "2.7-6: 並行する失効（互いの失効）は正確に1件だけ成功し、登録簿は空にならない",
      okCount === 1 &&
        refusedCount === 1 &&
        stateMid.generation === 3 &&
        operatorHashes(stateMid).length === 1,
      `d1=${d1.status} d2=${d2.status} gen=${stateMid.generation} ops=${operatorHashes(stateMid)}`
    );
    const survivorHash = operatorHashes(stateMid)[0];
    const survivorSub = survivorHash === HASH_A ? SUB_A : SUB_B;

    // 最後の運営者の失効（自己失効を含む）は同一トランザクションで拒否。
    r = await adminCall(n5.base, "/admin/registry/revoke", survivorSub, {
      subject_hash: survivorHash,
      expected_generation: 3,
    });
    check(
      "2.7-6/2.1: 最後の運営者の失効は 409 last_operator で拒否される",
      r.status === 409 && r.json.error === "last_operator",
      `status=${r.status} body=${JSON.stringify(r.json)}`
    );
    const stateEnd = await readRegistry(n5.base);
    const rVerify = await adminCall(n5.base, "/admin/verify-only", survivorSub);
    check(
      "2.7-6/2.1: 拒否後も最後の運営者は残り（世代3のまま）、操作できる",
      stateEnd.generation === 3 &&
        operatorHashes(stateEnd).length === 1 &&
        rVerify.status === 200,
      `gen=${stateEnd.generation} verify=${rVerify.status}`
    );
    await n5.mf.dispose();
  }

  // ===== 2.7-7: コミット後の応答喪失（再現）と読み戻し確認 =====
  section("2.7-7 コミット後の応答喪失（再現・ローカル模擬のみ）");
  {
    const loss = await startBuild("platform-worker.js", ".persist-p7",
      approvalBindings({
        operationId: "op-404",
        purpose: "bootstrap",
        subjectHash: HASH_A,
        oneTime: "one-time-value-404",
        expiresAtMs: FUTURE(),
      })
    );
    const r = await platformApply(loss.base, SUB_A, {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-value-404",
    }, { extraBody: { _fault: "platform-after-commit" } });
    check(
      "2.7-7: コミット後の応答喪失は 500 として観察される（応答からは成否を判断できない）",
      r.status === 500,
      `status=${r.status} body=${JSON.stringify(r.json)}`
    );
    // 計画 2.6: 再送しない。まず状態を読み戻して判断する。
    const state = await inspectPlatform(loss.base);
    const comp = state.completion[0] || {};
    check(
      "2.7-7: 読み戻しで実施済み（登録簿・消費・完了記録）が確認でき、再送不要と判断できる",
      operatorHashes(state).join() === HASH_A &&
        state.initialized === true &&
        state.generation === 1 &&
        state.consumed_ops.length === 1 &&
        state.consumed_ops[0].operation_id === "op-404" &&
        comp.operation_id === "op-404" &&
        comp.subject_hash === HASH_A,
      JSON.stringify(state)
    );
    await loss.mf.dispose();
  }

  // ===== 設定ゲート: 故障注入フックの制限 =====
  // フックは tier=local-mock かつ ALLOW_TEST_HOOKS=1 のときだけ働く。
  // ゲートは Worker の HTTP 入口での _fault 剥離だけでなく、DO 自身
  // （faultHooksEnabled）でも判定する。ここでは (a) フック無効の
  // local-mock での HTTP 入口、(b) フック無効での DO 直接入口、
  // (c) フック有効での DO 直接入口（従来どおり働くこと）、
  // (d) verify 設定、の4形態を確認する。
  section("設定ゲート 故障注入フックの制限（フック無効・DO直接入口・verify）");
  {
    // (a) フック無効（ALLOW_TEST_HOOKS 未設定）・HTTP 入口: 途中失敗
    const offMid = await startBuild("platform-worker.js", ".persist-p8", {
      ALLOW_TEST_HOOKS: undefined,
      ...approvalBindings({
        operationId: "op-501",
        purpose: "bootstrap",
        subjectHash: HASH_A,
        oneTime: "one-time-value-501",
        expiresAtMs: FUTURE(),
      }),
    });
    const rMid = await platformApply(offMid.base, SUB_A, {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-value-501",
    }, { extraBody: { _fault: "platform-mid" } });
    check(
      "設定ゲート: フック無効では _fault=platform-mid 付きでも 500 にならず通常処理される（201）",
      rMid.status === 201,
      `status=${rMid.status} body=${JSON.stringify(rMid.json)}`
    );
    await offMid.mf.dispose();
    const readP8a = await startBuild("worker.js", ".persist-p8");
    const stateP8a = await readRegistry(readP8a.base);
    check(
      "設定ゲート: フック無効時の途中失敗つき実施は、ロールバックではなく通常どおり確定している",
      operatorHashes(stateP8a).join() === HASH_A &&
        stateP8a.consumed_ops.length === 1 &&
        stateP8a.consumed_ops[0].operation_id === "op-501" &&
        stateP8a.completion.length === 1 &&
        stateP8a.generation === 1,
      JSON.stringify(stateP8a)
    );
    await readP8a.mf.dispose();

    // (a') フック無効・HTTP 入口: コミット後フック（全面復旧）
    const offAfter = await startBuild("platform-worker.js", ".persist-p8", {
      ALLOW_TEST_HOOKS: undefined,
      ...approvalBindings({
        operationId: "op-502",
        purpose: "full-replace",
        subjectHash: HASH_B,
        oneTime: "one-time-value-502",
        expiresAtMs: FUTURE(),
      }),
    });
    const rAfter = await platformApply(offAfter.base, SUB_B, {
      purpose: "full-replace",
      env_id: ENV_ID,
      one_time_value: "one-time-value-502",
    }, { extraBody: { _fault: "platform-after-commit" } });
    check(
      "設定ゲート: フック無効では _fault=platform-after-commit 付きでも成功後に意図的な 500 は返らない（201）",
      rAfter.status === 201,
      `status=${rAfter.status} body=${JSON.stringify(rAfter.json)}`
    );
    await offAfter.mf.dispose();
    const readP8b = await startBuild("worker.js", ".persist-p8");
    const stateP8b = await readRegistry(readP8b.base);
    check(
      "設定ゲート: フック無効時のコミット後フックつき全面復旧は通常どおり差し替わる",
      operatorHashes(stateP8b).join() === HASH_B &&
        stateP8b.completion.some((c) => c.operation_id === "op-502") &&
        stateP8b.generation === 2,
      JSON.stringify(stateP8b)
    );
    await readP8b.mf.dispose();
  }
  {
    // (b) フック無効・DO 直接入口: HTTP 入口の剥離を経なくても効かない
    const offDirect = await startBuild("platform-worker.js", ".persist-p9", {
      ALLOW_TEST_HOOKS: undefined,
      ...approvalBindings({
        operationId: "op-601",
        purpose: "bootstrap",
        subjectHash: HASH_A,
        oneTime: "one-time-value-601",
        expiresAtMs: FUTURE(),
      }),
    });
    const rDirectMid = await platformApplyDirect(offDirect.mf, SUB_A, {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-value-601",
    }, { _fault: "platform-mid" });
    const snapDirectMid = await snapshotDirect(offDirect.mf);
    check(
      "設定ゲート: DO 直接入口でもフック無効時は _fault=platform-mid が効かず 201 で確定する",
      rDirectMid.status === 201 &&
        operatorHashes(snapDirectMid).join() === HASH_A &&
        snapDirectMid.consumed_ops.length === 1 &&
        snapDirectMid.completion.length === 1,
      `status=${rDirectMid.status} state=${JSON.stringify(snapDirectMid)}`
    );
    await offDirect.mf.dispose();

    const offDirect2 = await startBuild("platform-worker.js", ".persist-p9", {
      ALLOW_TEST_HOOKS: undefined,
      ...approvalBindings({
        operationId: "op-602",
        purpose: "full-replace",
        subjectHash: HASH_B,
        oneTime: "one-time-value-602",
        expiresAtMs: FUTURE(),
      }),
    });
    const rDirectAfter = await platformApplyDirect(offDirect2.mf, SUB_B, {
      purpose: "full-replace",
      env_id: ENV_ID,
      one_time_value: "one-time-value-602",
    }, { _fault: "platform-after-commit" });
    const snapDirectAfter = await snapshotDirect(offDirect2.mf);
    check(
      "設定ゲート: DO 直接入口でもフック無効時は _fault=platform-after-commit が効かず 500 にならない（201）",
      rDirectAfter.status === 201 &&
        operatorHashes(snapDirectAfter).join() === HASH_B &&
        snapDirectAfter.completion.some((c) => c.operation_id === "op-602"),
      `status=${rDirectAfter.status} state=${JSON.stringify(snapDirectAfter)}`
    );
    await offDirect2.mf.dispose();
  }
  {
    // (c) フック有効（local-mock＋ALLOW_TEST_HOOKS=1）・DO 直接入口:
    // 従来どおりフックが働くことの回帰確認
    const onDirect = await startBuild("platform-worker.js", ".persist-p10",
      approvalBindings({
        operationId: "op-701",
        purpose: "bootstrap",
        subjectHash: HASH_A,
        oneTime: "one-time-value-701",
        expiresAtMs: FUTURE(),
      })
    );
    const body701 = {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-value-701",
    };
    const rOnMid = await platformApplyDirect(onDirect.mf, SUB_A, body701, {
      _fault: "platform-mid",
    });
    const snapOnMid = await snapshotDirect(onDirect.mf);
    check(
      "設定ゲート: DO 直接入口でもフック有効時は _fault=platform-mid が従来どおり働く（500・ロールバック）",
      rOnMid.status === 500 &&
        snapOnMid.operators.length === 0 &&
        snapOnMid.consumed_ops.length === 0 &&
        snapOnMid.completion.length === 0 &&
        snapOnMid.initialized === false,
      `status=${rOnMid.status} state=${JSON.stringify(snapOnMid)}`
    );
    const rOnAfter = await platformApplyDirect(onDirect.mf, SUB_A, body701, {
      _fault: "platform-after-commit",
    });
    const snapOnAfter = await snapshotDirect(onDirect.mf);
    check(
      "設定ゲート: DO 直接入口でもフック有効時は _fault=platform-after-commit が従来どおり働く（500・状態は確定済み）",
      rOnAfter.status === 500 &&
        operatorHashes(snapOnAfter).join() === HASH_A &&
        snapOnAfter.consumed_ops.length === 1 &&
        snapOnAfter.completion.length === 1,
      `status=${rOnAfter.status} state=${JSON.stringify(snapOnAfter)}`
    );
    await onDirect.mf.dispose();
  }
  {
    // (d) verify 設定: フックつき構成は構成自体を拒否し、正規の
    // verify 構成では _fault を含む要求で失敗注入は発火しない
    const badVerify = await startBuild("platform-worker.js", ".persist-p11", {
      DEPLOYMENT_TIER: "verify",
      MOCK_AUTH: undefined,
      ALLOW_TEST_HOOKS: "1",
      ...approvalBindings({
        operationId: "op-801",
        purpose: "bootstrap",
        subjectHash: HASH_A,
        oneTime: "one-time-value-801",
        expiresAtMs: FUTURE(),
      }),
    });
    const rBadVerify = await call(badVerify.base, "POST", "/platform/apply", {
      body: {
        purpose: "bootstrap",
        env_id: ENV_ID,
        one_time_value: "one-time-value-801",
        id_token: "dummy",
        _fault: "platform-after-commit",
      },
    });
    check(
      "設定ゲート: verify で ALLOW_TEST_HOOKS=1 の構成は全経路を 500 config_refused（fail-closed）",
      rBadVerify.status === 500 &&
        rBadVerify.json &&
        rBadVerify.json.error === "config_refused",
      `status=${rBadVerify.status} body=${JSON.stringify(rBadVerify.json)}`
    );
    await badVerify.mf.dispose();

    const verify = await startBuild("platform-worker.js", ".persist-p11", {
      DEPLOYMENT_TIER: "verify",
      MOCK_AUTH: undefined,
      ALLOW_TEST_HOOKS: undefined,
      ...approvalBindings({
        operationId: "op-801",
        purpose: "bootstrap",
        subjectHash: HASH_A,
        oneTime: "one-time-value-801",
        expiresAtMs: FUTURE(),
      }),
    });
    const rVerify = await platformApply(verify.base, SUB_A, {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-value-801",
    }, { extraBody: { _fault: "platform-after-commit" } });
    check(
      "設定ゲート: verify 設定では _fault 付き要求でも失敗注入は発火しない（injected_fault を含まず、成功にもならない）",
      rVerify.status !== 201 &&
        !JSON.stringify(rVerify.json || {}).includes("injected_fault"),
      `status=${rVerify.status} body=${JSON.stringify(rVerify.json)}`
    );
    await verify.mf.dispose();
    const readP11 = await startBuild("worker.js", ".persist-p11");
    const stateP11 = await readRegistry(readP11.base);
    check(
      "設定ゲート: verify 設定での _fault 付き要求では消費・登録は一切起きていない",
      stateP11.operators.length === 0 &&
        stateP11.consumed_ops.length === 0 &&
        stateP11.completion.length === 0 &&
        stateP11.initialized === false,
      JSON.stringify(stateP11)
    );
    await readP11.mf.dispose();
  }

  // ===== 実環境構成: Cookie の Secure 属性 =====
  // verify 構成では認証試行コンテキスト Cookie に Secure を付ける
  // （実環境での必須化）。ローカル模擬（http 起点）では付けない。
  // ここで確認するのは属性の有無までであり、変形Bでブラウザーが
  // 実際に送り返すかは実環境で実測する（手順書 項目8）。
  section("実環境構成 Cookie の Secure 属性（verify で必須）");
  {
    const verifyNormal = await startBuild("worker.js", ".persist-p12", {
      DEPLOYMENT_TIER: "verify",
      MOCK_AUTH: undefined,
      ALLOW_TEST_HOOKS: undefined,
    });
    const rVN = await call(verifyNormal.base, "GET", "/nonce", { origin: null });
    const scVN = rVN.headers.get("set-cookie") || "";
    check(
      "Secure: verify 構成の通常ビルドでは ctx Cookie に Secure; HttpOnly; SameSite=Strict が付く",
      rVN.status === 200 &&
        scVN.includes("Secure") &&
        scVN.includes("HttpOnly") &&
        scVN.includes("SameSite=Strict"),
      `status=${rVN.status} set-cookie=${scVN}`
    );
    await verifyNormal.mf.dispose();

    const verifyPlatform = await startBuild("platform-worker.js", ".persist-p12", {
      DEPLOYMENT_TIER: "verify",
      MOCK_AUTH: undefined,
      ALLOW_TEST_HOOKS: undefined,
      ...approvalBindings({
        operationId: "op-901",
        purpose: "bootstrap",
        subjectHash: HASH_A,
        oneTime: "one-time-value-901",
        expiresAtMs: FUTURE(),
      }),
    });
    const rVP = await call(verifyPlatform.base, "GET", "/nonce", { origin: null });
    const scVP = rVP.headers.get("set-cookie") || "";
    check(
      "Secure: verify 構成の一時ビルドでも ctx Cookie に Secure が付く",
      rVP.status === 200 && scVP.includes("Secure"),
      `status=${rVP.status} set-cookie=${scVP}`
    );
    await verifyPlatform.mf.dispose();

    const mockNormal = await startBuild("worker.js", ".persist-p12");
    const rMN = await call(mockNormal.base, "GET", "/nonce", { origin: null });
    const scMN = rMN.headers.get("set-cookie") || "";
    check(
      "Secure: local-mock 構成では Secure を付けない（ローカル http 起点のため）",
      rMN.status === 200 && scMN.includes("HttpOnly") && !scMN.includes("Secure"),
      `status=${rMN.status} set-cookie=${scMN}`
    );
    await mockNormal.mf.dispose();
  }

  // ===== 2.7-9（実環境手段）: 故障版ビルドによる途中失敗 =====
  // 現行の _fault=platform-mid は「nonce 消費後・登録簿書込み前」の
  // 注入であり、書込み済み内容のロールバックの実証にはならない。
  // 実環境では、別成果物として固定した故障版ビルド
  // （fault-builds/apply-after-writes/）を使う。ここではその故障版
  // 自体の振る舞いをローカルで確認する（実環境での実施は未実施）。
  section("2.7-9 故障版ビルド（書込み後の途中失敗・実環境手段のローカル確認）");
  {
    const cleanSrc = readFileSync(
      path.join(ROOT, "src", "platform-worker.js"),
      "utf8"
    );
    const faultSrc = readFileSync(
      path.join(ROOT, "fault-builds", "apply-after-writes", "worker.js"),
      "utf8"
    );
    check(
      "故障版: マーカー（injected_fault_apply_after_writes）は故障版にだけ含まれ、クリーン版には含まれない",
      !cleanSrc.includes("injected_fault_apply_after_writes") &&
        faultSrc.includes("injected_fault_apply_after_writes")
    );

    const faultApproval = approvalBindings({
      operationId: "op-F01",
      purpose: "bootstrap",
      subjectHash: HASH_A,
      oneTime: "one-time-value-f01",
      expiresAtMs: FUTURE(),
    });
    const fb = await startBuildPath(
      path.join("fault-builds", "apply-after-writes", "worker.js"),
      ".persist-p13",
      faultApproval
    );
    const pre = await inspectPlatform(fb.base);
    check(
      "故障版: 実施前の全状態は空（未初期化・世代0・記録なし）",
      pre.operators.length === 0 &&
        pre.consumed_ops.length === 0 &&
        pre.completion.length === 0 &&
        pre.initialized === false &&
        pre.generation === 0,
      JSON.stringify(pre)
    );

    const att = await attempt(fb.base, SUB_A);
    const bodyF = {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-value-f01",
      id_token: att.token,
    };
    const rF1 = await call(fb.base, "POST", "/platform/apply", {
      body: bodyF,
      cookie: att.cookie,
    });
    check(
      "故障版: 書込み後の途中失敗は 500 で、detail にマーカーを含む（例外到達の識別）",
      rF1.status === 500 &&
        JSON.stringify(rF1.json || {}).includes("injected_fault_apply_after_writes"),
      `status=${rF1.status} body=${JSON.stringify(rF1.json)}`
    );
    const rF2 = await call(fb.base, "POST", "/platform/apply", {
      body: bodyF,
      cookie: att.cookie,
    });
    check(
      "故障版: 同一トークン（同一 nonce）の再提示でも再びマーカーつき 500（nonce 消費も巻き戻っている傍証）",
      rF2.status === 500 &&
        JSON.stringify(rF2.json || {}).includes("injected_fault_apply_after_writes"),
      `status=${rF2.status} body=${JSON.stringify(rF2.json)}`
    );
    const post = await inspectPlatform(fb.base);
    check(
      "故障版: 実施後の全状態が実施前と完全一致する（書込み済み分を含むロールバック）",
      JSON.stringify(post) === JSON.stringify(pre),
      `pre=${JSON.stringify(pre)} post=${JSON.stringify(post)}`
    );
    await fb.mf.dispose();

    const clean = await startBuild("platform-worker.js", ".persist-p13", faultApproval);
    const rClean = await platformApply(clean.base, SUB_A, {
      purpose: "bootstrap",
      env_id: ENV_ID,
      one_time_value: "one-time-value-f01",
    });
    const stateClean = await inspectPlatform(clean.base);
    check(
      "故障版: クリーンな一時ビルドに差し替えれば同じ承認（未消費）で 201 になり、状態は正確に1件分だけ進む",
      rClean.status === 201 &&
        operatorHashes(stateClean).join() === HASH_A &&
        stateClean.generation === 1 &&
        stateClean.consumed_ops.length === 1 &&
        stateClean.completion.length === 1,
      `status=${rClean.status} state=${JSON.stringify(stateClean)}`
    );
    await clean.mf.dispose();
  }

  // ---------- 集計 ----------
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log(`\n===== 結果: ${pass} PASS / ${fail} FAIL（全 ${results.length} 件） =====`);
  if (fail > 0) {
    for (const r of results.filter((x) => !x.pass)) console.log(`FAIL: ${r.name}`);
  }
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("試験ランナー自体が異常終了しました:", e);
  process.exitCode = 2;
});
