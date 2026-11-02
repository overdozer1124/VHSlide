// VHSlide 段階①フェーズ1 次期試作ハーネス 試験ランナー（手順1・ローカル模擬）
//
// Miniflare をプログラムから起動してハーネスを載せ、計画 v0.2 第6節
// 手順3〜6の試験項目を自動で確認する。実 Google・実 Cloudflare には接続しない。
// 模擬 ID トークン（mock.<sub>.<nonce>）とダミーのシークレットだけを使う。
//
// 実行: npm test  （= node test/run.mjs）
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "http://localhost:8787";
const ENV_ID = "stage1-verification-only-20261101";
const BOOTSTRAP_SECRET = "test-bootstrap-secret";
const RECOVERY_KEY = "test-recovery-key";
const RESTART_KEY = "test-restart-key";

const SUB_A = "mock-subject-alpha-001"; // 初期登録・復旧元
const SUB_B = "mock-subject-beta-002"; // 復旧先
const SUB_C = "mock-subject-gamma-003"; // 並行登録用
const SUB_D = "mock-subject-delta-004"; // 並行登録用
const SUB_X = "mock-subject-xray-005"; // 失敗注入・未知 nonce 用
const SUB_T = "mock-subject-ttl-006"; // 期限切れ nonce 用
const SUB_W = "mock-subject-wrongsec-000"; // 誤シークレット用

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// ---------- 結果集計 ----------
const results = [];
function check(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -- " + detail}`);
}
function section(title) {
  console.log(`\n== ${title} ==`);
}

// ---------- Miniflare 起動 ----------
async function startHarness(persistName, extraBindings = {}) {
  const persist = path.join(ROOT, persistName);
  const mf = new Miniflare({
    modules: true,
    scriptPath: path.join(ROOT, "src", "worker.js"),
    compatibilityDate: "2025-01-01",
    durableObjects: {
      VERIFY_ONLY: { className: "VerificationDO", useSQLite: true },
    },
    durableObjectsPersist: persist,
    bindings: {
      BOOTSTRAP_SECRET,
      RECOVERY_KEY,
      RESTART_KEY,
      MOCK_AUTH: "1",
      ALLOW_TEST_HOOKS: "1",
      ENV_ID,
      ...extraBindings,
    },
  });
  const url = await mf.ready;
  return { mf, base: url.toString().replace(/\/$/, "") };
}

// ---------- HTTP ヘルパ ----------
async function call(base, method, p, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.origin === undefined) {
    if (method === "POST") headers["Origin"] = ORIGIN;
  } else if (opts.origin !== null) {
    headers["Origin"] = opts.origin;
  }
  let body;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  if (opts.csrf !== undefined && opts.csrf !== null) headers["X-CSRF"] = opts.csrf;
  const res = await fetch(base + p, { method, headers, body });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* JSON でない応答 */
  }
  const setCookie =
    typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return { status: res.status, json, setCookie, text };
}

async function getNonce(base) {
  const r = await call(base, "GET", "/nonce", { origin: ORIGIN });
  if (r.status !== 200 || !r.json || !r.json.nonce) {
    throw new Error(`nonce 取得に失敗: ${r.status} ${r.text}`);
  }
  return r.json.nonce;
}

const mockToken = (sub, nonce) => `mock.${sub}.${nonce}`;

function sessionCookieFrom(setCookie) {
  const found = (setCookie || []).find((v) => v.startsWith("session="));
  return found ? found.split(";")[0] : null;
}

async function getState(base) {
  const r = await call(base, "GET", "/test/state", { origin: null });
  if (r.status !== 200) throw new Error(`/test/state 取得に失敗: ${r.status}`);
  return r.json;
}

// 「状態」の中核（資格・完了・復旧・セッション）。nonce 記録は試行ごとに
// 正当に増えるため不変確認の対象から外す。
function coreOf(state) {
  const t = state.tables;
  return JSON.stringify({
    credentials: t.mtrial_credentials,
    completion: t.mtrial_completion,
    recovery: t.mtrial_recovery,
    sessions: t.mtrial_sessions,
  });
}

// ---------- 本体 ----------
for (const d of [".persist-main", ".persist-aux", ".persist-ttl"]) {
  rmSync(path.join(ROOT, d), { recursive: true, force: true });
}

let main = null;
let main2 = null;
try {
  // ================= メイン系列（登録→操作→復旧→照合） =================
  section("メイン系列: 登録・操作・復旧");
  main = await startHarness(".persist-main");
  const B = main.base;

  // 誤った初回用シークレット → 403・状態不変
  {
    const before = coreOf(await getState(B));
    const nonce = await getNonce(B);
    const r = await call(B, "POST", "/register", {
      body: { id_token: mockToken(SUB_W, nonce), bootstrap_secret: "wrong-secret" },
    });
    const after = coreOf(await getState(B));
    check(
      "誤った初回用シークレットで 403・状態不変",
      r.status === 403 && before === after,
      `status=${r.status}`
    );
  }

  // 不正 Origin / Origin 欠落（/register） → 拒否・状態不変
  for (const [label, originOpt] of [
    ["不正 Origin", { origin: "http://evil.example" }],
    ["Origin 欠落", { origin: null }],
  ]) {
    const before = coreOf(await getState(B));
    const nonce = await getNonce(B);
    const r = await call(B, "POST", "/register", {
      ...originOpt,
      body: { id_token: mockToken(SUB_A, nonce), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const after = coreOf(await getState(B));
    check(
      `${label} で /register 拒否・状態不変`,
      r.status === 403 && before === after,
      `status=${r.status}`
    );
  }

  // 通常登録 → 201、完了記録の必須項目
  let sessionA = null;
  let nonceA = null;
  {
    nonceA = await getNonce(B);
    const r = await call(B, "POST", "/register", {
      body: { id_token: mockToken(SUB_A, nonceA), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const st = await getState(B);
    const comp = st.tables.mtrial_completion[0] || {};
    check(
      "通常登録が 201 で完了記録に env_id・subject_hash・registered_at がそろう",
      r.status === 201 &&
        comp.env_id === ENV_ID &&
        comp.subject_hash === sha256(SUB_A) &&
        !!comp.registered_at,
      `status=${r.status} completion=${JSON.stringify(comp)}`
    );
    const cookieHeader = (r.setCookie || []).join("; ");
    check(
      "登録応答に受け取った Origin が含まれ、Cookie 属性が仕様どおり（HttpOnly/SameSite=Strict/Path=/ /Max-Age=1800）",
      r.json && r.json.origin === ORIGIN &&
        cookieHeader.includes("HttpOnly") &&
        cookieHeader.includes("SameSite=Strict") &&
        cookieHeader.includes("Path=/") &&
        cookieHeader.includes("Max-Age=1800"),
      `origin=${r.json && r.json.origin} set-cookie=${cookieHeader}`
    );
    sessionA = { cookie: sessionCookieFrom(r.setCookie), csrf: r.json && r.json.csrf_token };
    if (!sessionA.cookie || !sessionA.csrf) throw new Error("登録応答からセッションを取得できませんでした");
  }

  // 再登録 → 409・状態不変
  {
    const before = coreOf(await getState(B));
    const nonce = await getNonce(B);
    const r = await call(B, "POST", "/register", {
      body: { id_token: mockToken(SUB_A, nonce), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const after = coreOf(await getState(B));
    check("再登録が 409 で状態が変わらない", r.status === 409 && before === after, `status=${r.status}`);
  }

  // /operate: 有効セッションで 200
  {
    const r = await call(B, "POST", "/operate", { cookie: sessionA.cookie, csrf: sessionA.csrf, body: {} });
    check("/operate が有効セッションで 200", r.status === 200 && r.json && r.json.ok === true, `status=${r.status}`);
  }
  // /operate: CSRF 欠落 → 403
  {
    const r = await call(B, "POST", "/operate", { cookie: sessionA.cookie, body: {} });
    check("/operate は CSRF 欠落で 403", r.status === 403, `status=${r.status}`);
  }
  // /operate: CSRF 不一致 → 403
  {
    const r = await call(B, "POST", "/operate", { cookie: sessionA.cookie, csrf: "deadbeef", body: {} });
    check("/operate は CSRF 不一致で 403", r.status === 403, `status=${r.status}`);
  }
  // /operate: 不正 Origin → 403
  {
    const r = await call(B, "POST", "/operate", {
      origin: "http://evil.example",
      cookie: sessionA.cookie,
      csrf: sessionA.csrf,
      body: {},
    });
    check("/operate は不正 Origin で 403", r.status === 403, `status=${r.status}`);
  }

  // nonce 再利用の拒否（登録で消費済みの nonce を復旧試行で再利用）
  {
    const before = coreOf(await getState(B));
    const r = await call(B, "POST", "/recover", {
      body: { id_token: mockToken(SUB_B, nonceA), recovery_key: RECOVERY_KEY },
    });
    const after = coreOf(await getState(B));
    check(
      "nonce の再利用が拒否される・状態不変",
      r.status === 401 && before === after,
      `status=${r.status}`
    );
  }

  // 誤った復旧キー → 403・旧資格維持
  {
    const before = coreOf(await getState(B));
    const nonce = await getNonce(B);
    const r = await call(B, "POST", "/recover", {
      body: { id_token: mockToken(SUB_B, nonce), recovery_key: "wrong-key" },
    });
    const after = coreOf(await getState(B));
    const op = await call(B, "POST", "/operate", { cookie: sessionA.cookie, csrf: sessionA.csrf, body: {} });
    check(
      "誤った復旧キーで 403・旧資格が維持される",
      r.status === 403 && before === after && op.status === 200,
      `status=${r.status} operate=${op.status}`
    );
  }

  // 復旧キーだけ（新しい ID トークンなし） → 復旧できない
  {
    const before = coreOf(await getState(B));
    const r = await call(B, "POST", "/recover", { body: { recovery_key: RECOVERY_KEY } });
    const after = coreOf(await getState(B));
    check(
      "復旧キーだけ（新しい ID トークンなし）では復旧できない",
      (r.status === 400 || r.status === 401 || r.status === 403) && before === after,
      `status=${r.status}`
    );
  }
  // ID トークンだけ（復旧キーなし） → 復旧できない
  {
    const before = coreOf(await getState(B));
    const nonce = await getNonce(B);
    const r = await call(B, "POST", "/recover", { body: { id_token: mockToken(SUB_B, nonce) } });
    const after = coreOf(await getState(B));
    check(
      "ID トークンだけ（復旧キーなし）では復旧できない",
      r.status === 403 && before === after,
      `status=${r.status}`
    );
  }

  // 復旧途中の失敗注入 → 旧資格維持・新資格なし
  {
    const before = coreOf(await getState(B));
    const nonce = await getNonce(B);
    const r = await call(B, "POST", "/recover", {
      headers: { "X-Test-Fail": "recover-mid" },
      body: { id_token: mockToken(SUB_B, nonce), recovery_key: RECOVERY_KEY },
    });
    const after = coreOf(await getState(B));
    const op = await call(B, "POST", "/operate", { cookie: sessionA.cookie, csrf: sessionA.csrf, body: {} });
    check(
      "復旧途中の失敗注入で旧資格が維持され新資格が付かない",
      r.status === 500 && before === after && op.status === 200,
      `status=${r.status} operate=${op.status}`
    );
  }

  // 正常な復旧 → 201、復旧記録に旧新の対応と日時
  let sessionB = null;
  {
    const nonce = await getNonce(B);
    const r = await call(B, "POST", "/recover", {
      body: { id_token: mockToken(SUB_B, nonce), recovery_key: RECOVERY_KEY },
    });
    const st = await getState(B);
    const rec = st.tables.mtrial_recovery[0] || {};
    check(
      "正常な復旧が 201 で復旧記録に旧新の対応と日時が残る",
      r.status === 201 &&
        st.tables.mtrial_recovery.length === 1 &&
        rec.old_subject_hash === sha256(SUB_A) &&
        rec.new_subject_hash === sha256(SUB_B) &&
        !!rec.recovered_at,
      `status=${r.status} recovery=${JSON.stringify(rec)}`
    );
    sessionB = { cookie: sessionCookieFrom(r.setCookie), csrf: r.json && r.json.csrf_token };
    if (!sessionB.cookie || !sessionB.csrf) throw new Error("復旧応答からセッションを取得できませんでした");
  }

  // 復旧前の旧セッション → 403、新セッション → 200
  {
    const oldOp = await call(B, "POST", "/operate", { cookie: sessionA.cookie, csrf: sessionA.csrf, body: {} });
    const newOp = await call(B, "POST", "/operate", { cookie: sessionB.cookie, csrf: sessionB.csrf, body: {} });
    check(
      "復旧前に発行された旧セッションは /operate で 403・新セッションは 200",
      oldOp.status === 403 && newOp.status === 200,
      `old=${oldOp.status} new=${newOp.status}`
    );
  }

  // 再ログイン: 旧 ID トークン拒否・新 ID トークン許可
  let sessionB2 = null;
  {
    const n1 = await getNonce(B);
    const oldLogin = await call(B, "POST", "/login", { body: { id_token: mockToken(SUB_A, n1) } });
    const n2 = await getNonce(B);
    const newLogin = await call(B, "POST", "/login", { body: { id_token: mockToken(SUB_B, n2) } });
    sessionB2 = { cookie: sessionCookieFrom(newLogin.setCookie), csrf: newLogin.json && newLogin.json.csrf_token };
    check(
      "復旧後に旧 ID トークンは拒否され新 ID トークンは許可される（再ログイン）",
      oldLogin.status === 403 && newLogin.status === 200 && !!sessionB2.cookie,
      `old=${oldLogin.status} new=${newLogin.status}`
    );
  }

  // 事後照合: ハッシュ再計算と記録の一致
  {
    const st = await getState(B);
    const comp = st.tables.mtrial_completion[0] || {};
    const rec = st.tables.mtrial_recovery[0] || {};
    check(
      "事後照合: 完了記録は初代（A）のまま不変で、復旧記録の旧新（A→B）と現在の資格（B）に一致する",
      comp.subject_hash === sha256(SUB_A) &&
        rec.old_subject_hash === sha256(SUB_A) &&
        rec.new_subject_hash === sha256(SUB_B) &&
        st.tables.mtrial_credentials.length === 1 &&
        st.tables.mtrial_credentials[0].subject_hash === sha256(SUB_B),
      `completion=${comp.subject_hash} recovery=${JSON.stringify(rec)} credentials=${JSON.stringify(st.tables.mtrial_credentials)}`
    );
  }

  // 生の sub が保存内容のどこにも現れない
  {
    const st = await getState(B);
    const dump = JSON.stringify(st);
    const leaked = [SUB_A, SUB_B, SUB_C, SUB_D, SUB_X, SUB_T, SUB_W].filter((s) => dump.includes(s));
    check(
      "生の sub が DO の保存内容のどこにも現れない",
      leaked.length === 0,
      `leaked=${leaked.join(",")}`
    );
  }

  // ================= 中継（変形Bひな形）の素通し確認 =================
  section("中継: ヘッダー素通し");
  {
    const relayMf = new Miniflare({
      modules: true,
      scriptPath: path.join(ROOT, "relay", "worker.js"),
      compatibilityDate: "2025-01-01",
      bindings: { HARNESS_URL: B },
    });
    const relayUrl = await relayMf.ready;
    const RB = relayUrl.toString().replace(/\/$/, "");
    const viaRelay = await call(RB, "GET", "/nonce", { origin: ORIGIN });
    check(
      "[extra] 中継経由でも Origin が素通しされ応答に echo される",
      viaRelay.status === 200 && viaRelay.json && viaRelay.json.origin === ORIGIN,
      `status=${viaRelay.status} origin=${viaRelay.json && viaRelay.json.origin}`
    );
    const op = await call(RB, "POST", "/operate", { cookie: sessionB.cookie, csrf: sessionB.csrf, body: {} });
    check(
      "[extra] 中継経由の /operate で Cookie・CSRF・Origin が素通しされる",
      op.status === 200,
      `status=${op.status}`
    );
    await relayMf.dispose();
  }

  // ================= 再起動（dispose → 同じ永続化先で再生成） =================
  section("再起動: dispose → 再生成");
  const bootBefore = (await getState(B)).boot_count;
  await main.mf.dispose();
  main2 = await startHarness(".persist-main");
  const B2 = main2.base;
  {
    const st = await getState(B2);
    check(
      "boot_count の変化で再起動を検出できる",
      typeof st.boot_count === "number" && st.boot_count > bootBefore,
      `before=${bootBefore} after=${st.boot_count}`
    );
    const comp = st.tables.mtrial_completion[0] || {};
    const nonce = await getNonce(B2);
    const reReg = await call(B2, "POST", "/register", {
      body: { id_token: mockToken(SUB_B, nonce), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const oldOp = await call(B2, "POST", "/operate", { cookie: sessionA.cookie, csrf: sessionA.csrf, body: {} });
    const newOp = await call(B2, "POST", "/operate", { cookie: sessionB.cookie, csrf: sessionB.csrf, body: {} });
    check(
      "DO 再起動後も資格状態・再登録拒否・旧セッション拒否が維持される",
      comp.subject_hash === sha256(SUB_A) &&
        st.tables.mtrial_credentials.length === 1 &&
        st.tables.mtrial_credentials[0].subject_hash === sha256(SUB_B) &&
        reReg.status === 409 &&
        oldOp.status === 403 &&
        newOp.status === 200,
      `completion=${comp.subject_hash} reRegister=${reReg.status} oldSession=${oldOp.status} newSession=${newOp.status}`
    );
  }

  // /admin/restart フック
  // 注意（模擬層の制約）: ローカルの workerd/Miniflare では、DO の fetch で
  // 例外を投げてもインスタンスは破棄・再生成されない（本番 Cloudflare では
  // 例外時に DO が再起動する）。そのためここでは「鍵の照合」と「一致時に
  // 例外が DO の外へ伝播すること（500）」までを確認し、実際の再起動検出は
  // 上の dispose → 再生成＋ boot_count の項目で確認する。
  {
    const wrong = await call(B2, "POST", "/admin/restart", {
      headers: { "X-Restart-Key": "wrong-key" },
      body: {},
    });
    let threw = false;
    try {
      const r = await call(B2, "POST", "/admin/restart", {
        headers: { "X-Restart-Key": RESTART_KEY },
        body: {},
      });
      threw = r.status >= 500;
    } catch {
      threw = true; // 接続が切れる形で例外が伝播した場合
    }
    const st = await getState(B2);
    const comp = st.tables.mtrial_completion[0] || {};
    check(
      "[extra] /admin/restart は鍵不一致で 403・一致で例外を投げる",
      wrong.status === 403 && threw && comp.subject_hash === sha256(SUB_A),
      `wrongKey=${wrong.status} threw=${threw}`
    );
  }

  // ================= 補助系列（失敗注入・未知 nonce・並行登録） =================
  section("補助系列: 失敗注入・並行登録");
  {
    const aux = await startHarness(".persist-aux");
    const AB = aux.base;
    // 未知の nonce → 拒否
    {
      const r = await call(AB, "POST", "/register", {
        body: { id_token: mockToken(SUB_X, "no-such-nonce"), bootstrap_secret: BOOTSTRAP_SECRET },
      });
      const st = await getState(AB);
      check(
        "未知の nonce が拒否される",
        r.status === 401 && st.tables.mtrial_credentials.length === 0 && st.tables.mtrial_completion.length === 0,
        `status=${r.status}`
      );
    }
    // 登録途中の失敗注入 → 資格も完了記録も残らない
    {
      const nonce = await getNonce(AB);
      const r = await call(AB, "POST", "/register", {
        headers: { "X-Test-Fail": "register-mid" },
        body: { id_token: mockToken(SUB_X, nonce), bootstrap_secret: BOOTSTRAP_SECRET },
      });
      const st = await getState(AB);
      check(
        "登録途中の失敗注入で資格も完了記録も残らない（ロールバック）",
        r.status === 500 && st.tables.mtrial_credentials.length === 0 && st.tables.mtrial_completion.length === 0,
        `status=${r.status} credentials=${st.tables.mtrial_credentials.length} completion=${st.tables.mtrial_completion.length}`
      );
    }
    // 並行登録（同時2件） → 成功1・拒否1
    {
      const [nC, nD] = [await getNonce(AB), await getNonce(AB)];
      const [rC, rD] = await Promise.all([
        call(AB, "POST", "/register", {
          body: { id_token: mockToken(SUB_C, nC), bootstrap_secret: BOOTSTRAP_SECRET },
        }),
        call(AB, "POST", "/register", {
          body: { id_token: mockToken(SUB_D, nD), bootstrap_secret: BOOTSTRAP_SECRET },
        }),
      ]);
      const statuses = [rC.status, rD.status].sort((a, b) => a - b);
      const st = await getState(AB);
      const winner = st.tables.mtrial_completion[0] || {};
      check(
        "並行登録（同時2件）で成功1・拒否1",
        statuses[0] === 201 && statuses[1] === 409 &&
          (winner.subject_hash === sha256(SUB_C) || winner.subject_hash === sha256(SUB_D)),
        `statuses=${statuses.join(",")} winner=${winner.subject_hash}`
      );
    }
    await aux.mf.dispose();
  }

  // ================= 期限切れ nonce =================
  section("期限切れ nonce");
  {
    const ttl = await startHarness(".persist-ttl", { NONCE_TTL_SECONDS: "0" });
    const TB = ttl.base;
    const nonce = await getNonce(TB);
    const r = await call(TB, "POST", "/register", {
      body: { id_token: mockToken(SUB_T, nonce), bootstrap_secret: BOOTSTRAP_SECRET },
    });
    const st = await getState(TB);
    check(
      "期限切れ nonce が拒否される",
      r.status === 401 && st.tables.mtrial_credentials.length === 0,
      `status=${r.status}`
    );
    await ttl.mf.dispose();
  }
} catch (e) {
  check("ランナー実行が最後まで到達する", false, String(e && e.stack || e));
} finally {
  try {
    if (main) await main.mf.dispose();
  } catch { /* dispose 済みの場合がある */ }
  try {
    if (main2) await main2.mf.dispose();
  } catch { /* dispose 済みの場合がある */ }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n== 結果 ==`);
console.log(`合計 ${results.length} 件: PASS ${results.length - failed.length} / FAIL ${failed.length}`);
if (failed.length) {
  for (const f of failed) console.log(`  FAIL: ${f.name} -- ${f.detail}`);
}
process.exit(failed.length ? 1 : 0);
