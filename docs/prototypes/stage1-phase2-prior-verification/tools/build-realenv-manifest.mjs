// 実環境試験用マニフェストの生成（VHSlide 段階①フェーズ2 先行検証）。
// フェーズ1の tools/build-deploy-manifest.mjs の型。
//
// 使い方:
//   node tools/build-realenv-manifest.mjs --tier verify > realenv-manifest.json
//
// - 対象形態（--tier）を明示した場合にだけ生成する。未指定・verify
//   以外はエラーで終了する（形態の取り違えを防ぐため）。
// - 成果物（通常ビルド／一時ビルド／故障版ビルド／実ログイン画面／
//   提供サーバー）の SHA-256 ハッシュとサイズを一覧にし、版と差分を
//   固定できる形にする。配置前に両者がこの一覧と照合する。
// - バインディングは「名前と種別」だけを列挙し、値は含めない
//   （承認内容・秘密はアカウント保有者／PC 側で設定する）。
// - あわせてソースを静的に検査し、配置防護の根拠をマニフェストに
//   含める。検査で問題が見つかればマニフェストを出さず、終了
//   コード 1 で終わる:
//   1) クリーンな一時ビルドに故障版のマーカーが含まれないこと
//   2) 故障版にマーカーと「書込み後」の配置が含まれ、差分ファイルが
//      存在すること
//   3) 両ビルドで verify 構成がフック・モック・検証先上書きを拒否
//      する箇所があること
//   4) 両ビルドの /nonce が verify 構成で Secure を付ける箇所がある
//      こと
//   5) 実ログイン画面にクライアントIDのプレースホルダと GIS の
//      読み込みがあること
//   6) クリーン起動試験の終了処理が、子プロセスの終了待ち →
//      中継の閉鎖待ち → ミラーの削除の順であること（Windows の
//      EBUSY 対策。Codex レビュー 6737085464 への対応）
//   7) 成果物のバイト列に行末の CR が含まれないこと（行末 LF
//      固定の担保。チェックアウト変換で CRLF 化した作業ツリー
//      では生成を拒否する）。あわせて、サブツリー全体の行末を
//      LF に固定する .gitattributes が成果物に含まれ、その固定
//      行があることを検査する（Codex レビュー 6873611386 への
//      対応。PC 側 core.autocrlf=true のチェックアウト変換で
//      全成果物のハッシュ・サイズがずれたことへの対策）
//
// このスクリプト自体はデプロイを行わない。対象同一性の確認は、
// このマニフェストや成果物自身の設定の読み返しでは行わない
// （手順書 手順0: ダッシュボードと API の2経路で独立に照合する）。

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseTierArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tier" && i + 1 < argv.length) return argv[i + 1];
    if (argv[i].startsWith("--tier=")) return argv[i].slice("--tier=".length);
  }
  return null;
}

const tier = parseTierArg(process.argv.slice(2));
if (tier !== "verify") {
  console.error(
    "error: 対象形態を --tier verify で明示してください（未指定・verify 以外では生成しません）"
  );
  process.exit(1);
}

const ARTIFACTS = [
  "src/worker.js",
  "src/platform-worker.js",
  "fault-builds/apply-after-writes/worker.js",
  "fault-builds/apply-after-writes.diff",
  "fallback-builds/baseline-passive/worker.js",
  "public/login-real.html",
  "public/subject-hash.html",
  "tools/subject-hash-verify.mjs",
  "tools/serve-real.mjs",
  "test/subject-hash-verify.test.mjs",
  "public/trial-apply.html",
  "tools/trial-apply.mjs",
  "test/trial-apply.test.mjs",
  "test/trial-apply.screen.mjs",
  "public/s5-apply.html",
  "tools/s5-apply.mjs",
  "tools/s5-sender.mjs",
  "test/s5-apply.test.mjs",
  "test/s5-sender.test.mjs",
  "test/s5-apply.screen.mjs",
  "test/serve-real-s5.test.mjs",
  "public/s9-negative.html",
  "tools/s9-negative.mjs",
  "test/s9-negative.test.mjs",
  "test/s9-negative.screen.mjs",
  "test/serve-real-s9.test.mjs",
  "public/s10-add-operator.html",
  "tools/s10-add.mjs",
  "test/s10-add.test.mjs",
  "test/s10-add-guard.test.mjs",
  "test/s10-add.screen.mjs",
  "test/serve-real-s10.test.mjs",
  "public/s11-parallel.html",
  "tools/s11-parallel.mjs",
  "tools/s11-sender.mjs",
  "test/s11-parallel.test.mjs",
  "test/s11-sender.test.mjs",
  "test/s11-guard.test.mjs",
  "test/s11-parallel.screen.mjs",
  "test/serve-real-s11.test.mjs",
  "public/s12-revoke.html",
  "tools/s12-revoke.mjs",
  "tools/s12-sender.mjs",
  "test/s12-revoke.test.mjs",
  "test/s12-sender.test.mjs",
  "test/s12-guard.test.mjs",
  "test/s12-revoke.screen.mjs",
  "test/serve-real-s12.test.mjs",
  "public/s13-revoke.html",
  "tools/s13-revoke.mjs",
  "tools/s13-sender.mjs",
  "test/s13-revoke.test.mjs",
  "test/s13-sender.test.mjs",
  "test/s13-guard.test.mjs",
  "test/s13-revoke.screen.mjs",
  "test/serve-real-s13.test.mjs",
  "public/s14-rotate.html",
  "tools/s14-rotate.mjs",
  "tools/s14-sender.mjs",
  "test/s14-rotate.test.mjs",
  "test/s14-sender.test.mjs",
  "test/s14-guard.test.mjs",
  "test/s14-rotate.screen.mjs",
  "test/serve-real-s14.test.mjs",
  "tools/s15-apply.mjs",
  "tools/s15-sender.mjs",
  "tools/s15-driver.mjs",
  "test/s15-apply.test.mjs",
  "test/s15-sender.test.mjs",
  "test/s15-guard.test.mjs",
  "test/serve-real-s15.test.mjs",
  "test/clean-boot.test.mjs",
  "test/teardown-helper.mjs",
  "test/clean-boot-teardown.test.mjs",
  ".gitattributes",
];

function readRel(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}
function findLines(lines, re) {
  const out = [];
  lines.forEach((line, i) => {
    if (re.test(line)) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}

const problems = [];
const artifacts = ARTIFACTS.map((rel) => {
  const p = path.join(root, rel);
  if (!existsSync(p)) {
    problems.push(`成果物が存在しません: ${rel}`);
    return { path: rel, missing: true };
  }
  const buf = readFileSync(p);
  // 行末は LF 固定（.gitattributes）。CR バイトを含む成果物は、
  // チェックアウト変換（core.autocrlf）でバイト列が変わった
  // 作業ツリーとみなし、マニフェストを生成しない（検査 7）。
  if (buf.includes(0x0d)) {
    problems.push(`成果物に行末の CR が含まれます（LF 固定違反）: ${rel}`);
  }
  return {
    path: rel,
    sha256: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
  };
});

// ---------- ソース検査 ----------
const normalLines = readRel("src/worker.js").split("\n");
const platformLines = readRel("src/platform-worker.js").split("\n");
const faultLines = readRel("fault-builds/apply-after-writes/worker.js").split("\n");
const fallbackLines = readRel("fallback-builds/baseline-passive/worker.js").split("\n");
const loginLines = readRel("public/login-real.html").split("\n");
const subjectHashLines = readRel("public/subject-hash.html").split("\n");
const subjectHashVerifyLines = readRel("tools/subject-hash-verify.mjs").split("\n");
const serveRealLines = readRel("tools/serve-real.mjs").split("\n");
const trialApplyLines = readRel("public/trial-apply.html").split("\n");
const trialApplyModuleLines = readRel("tools/trial-apply.mjs").split("\n");
const s5ApplyLines = readRel("public/s5-apply.html").split("\n");
const s5ApplyModuleLines = readRel("tools/s5-apply.mjs").split("\n");
const s5SenderLines = readRel("tools/s5-sender.mjs").split("\n");
const s5ScreenLines = readRel("test/s5-apply.screen.mjs").split("\n");
const s9NegativeLines = readRel("public/s9-negative.html").split("\n");
const s9NegativeModuleLines = readRel("tools/s9-negative.mjs").split("\n");
const s10AddLines = readRel("public/s10-add-operator.html").split("\n");
const s10AddModuleLines = readRel("tools/s10-add.mjs").split("\n");
const s10AddGuardLines = readRel("test/s10-add-guard.test.mjs").split("\n");
const s11ParallelLines = readRel("public/s11-parallel.html").split("\n");
const s11ModuleLines = readRel("tools/s11-parallel.mjs").split("\n");
const s11SenderLines = readRel("tools/s11-sender.mjs").split("\n");
const s11GuardLines = readRel("test/s11-guard.test.mjs").split("\n");
const s11ScreenLines = readRel("test/s11-parallel.screen.mjs").split("\n");
const s12RevokeLines = readRel("public/s12-revoke.html").split("\n");
const s12ModuleLines = readRel("tools/s12-revoke.mjs").split("\n");
const s12SenderLines = readRel("tools/s12-sender.mjs").split("\n");
const s12GuardLines = readRel("test/s12-guard.test.mjs").split("\n");
const s12ScreenLines = readRel("test/s12-revoke.screen.mjs").split("\n");
const s13RevokeLines = readRel("public/s13-revoke.html").split("\n");
const s13ModuleLines = readRel("tools/s13-revoke.mjs").split("\n");
const s13SenderLines = readRel("tools/s13-sender.mjs").split("\n");
const s13GuardLines = readRel("test/s13-guard.test.mjs").split("\n");
const s13ScreenLines = readRel("test/s13-revoke.screen.mjs").split("\n");
const s14RotateLines = readRel("public/s14-rotate.html").split("\n");
const s14ModuleLines = readRel("tools/s14-rotate.mjs").split("\n");
const s14SenderLines = readRel("tools/s14-sender.mjs").split("\n");
const s14GuardLines = readRel("test/s14-guard.test.mjs").split("\n");
const s14ScreenLines = readRel("test/s14-rotate.screen.mjs").split("\n");
const s15ModuleLines = readRel("tools/s15-apply.mjs").split("\n");
const s15SenderLines = readRel("tools/s15-sender.mjs").split("\n");
const s15DriverLines = readRel("tools/s15-driver.mjs").split("\n");
const s15GuardLines = readRel("test/s15-guard.test.mjs").split("\n");
const gitattributesLines = readRel(".gitattributes").split("\n");
const cleanBootLines = readRel("test/clean-boot.test.mjs").split("\n");
const teardownHelperLines = readRel("test/teardown-helper.mjs").split("\n");
const teardownTestLines = readRel("test/clean-boot-teardown.test.mjs").split("\n");

// 行番号を返す（見つからなければ -1）。終了順序の構造検査で使う。
function firstLineIndex(lines, re) {
  return lines.findIndex((l) => re.test(l));
}

const checks = {
  // 行末の LF 固定（.gitattributes がサブツリー全体を対象に
  // eol=lf を宣言していること）。成果物そのものの CR 混入は
  // 上の成果物走査で生成自体を拒否する（検査 7）。
  gitattributes_pins_lf: {
    found: findLines(gitattributesLines, /^\* text eol=lf$/),
    expect: "present",
  },
  clean_platform_has_no_fault_marker: {
    found: findLines(platformLines, /injected_fault_apply_after_writes/),
    expect: "absent",
  },
  fault_build_has_marker: {
    found: findLines(faultLines, /injected_fault_apply_after_writes/),
    expect: "present",
  },
  fault_diff_exists: {
    found: existsSync(path.join(root, "fault-builds", "apply-after-writes.diff"))
      ? [{ line: 0, text: "fault-builds/apply-after-writes.diff" }]
      : [],
    expect: "present",
  },
  normal_verify_rejects_hooks: {
    found: findLines(normalLines, /config_hooks_in_verify/),
    expect: "present",
  },
  platform_verify_rejects_hooks: {
    found: findLines(platformLines, /config_hooks_in_verify/),
    expect: "present",
  },
  normal_secure_cookie_in_verify: {
    found: findLines(normalLines, /DEPLOYMENT_TIER === "verify" \? "; Secure"/),
    expect: "present",
  },
  platform_secure_cookie_in_verify: {
    found: findLines(platformLines, /DEPLOYMENT_TIER === "verify" \? "; Secure"/),
    expect: "present",
  },
  normal_has_no_platform_apply: {
    found: findLines(normalLines, /\/do\/apply/),
    expect: "absent",
  },
  normal_exports_verificationdo_stub: {
    found: findLines(normalLines, /export class VerificationDO/),
    expect: "present",
  },
  platform_exports_verificationdo_stub: {
    found: findLines(platformLines, /export class VerificationDO/),
    expect: "present",
  },
  fallback_exports_registrydo: {
    found: findLines(fallbackLines, /export class RegistryDO/),
    expect: "present",
  },
  fallback_exports_verificationdo: {
    found: findLines(fallbackLines, /export class VerificationDO/),
    expect: "present",
  },
  fallback_returns_verification_only: {
    found: findLines(fallbackLines, /"verification-only"/),
    expect: "present",
  },
  fallback_has_no_platform_apply: {
    found: findLines(fallbackLines, /\/platform\/apply/),
    expect: "absent",
  },
  login_page_placeholder: {
    found: findLines(loginLines, /REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID/),
    expect: "present",
  },
  login_page_gis: {
    found: findLines(loginLines, /accounts\.google\.com\/gsi\/client/),
    expect: "present",
  },
  // 主体ハッシュ取得ページは、ID トークンを外部の検証サービスへ送らない
  // （公開鍵・JWKS による PC 内署名検証）。検証用エンドポイントへの送信
  // が残っていないことを、ページと検証モジュールの両方で確認する。
  subject_hash_page_no_tokeninfo: {
    found: findLines(subjectHashLines, /tokeninfo/i),
    expect: "absent",
  },
  subject_hash_verify_no_tokeninfo: {
    found: findLines(subjectHashVerifyLines, /tokeninfo/i),
    expect: "absent",
  },
  subject_hash_page_uses_jwks: {
    found: findLines(subjectHashLines, /oauth2\/v3\/certs/),
    expect: "present",
  },
  subject_hash_verify_local_signature: {
    found: findLines(subjectHashVerifyLines, /RSASSA-PKCS1-v1_5/),
    expect: "present",
  },
  serve_real_subject_hash_route: {
    found: findLines(serveRealLines, /\/subject-hash/),
    expect: "present",
  },
  // 不一致試験専用画面は、送信する JSON の全文表示をしない（ID トークン
  // と一回値が含まれるため）。画面のソースに秘密の項目名そのものが
  // 現れないこと、要求の凍結と表示・実送信の同一性確認があること、
  // 提供サーバーが配信することを確認する。
  trial_apply_page_no_secret_field_names: {
    found: findLines(trialApplyLines, /id_token|one_time_value/),
    expect: "absent",
  },
  trial_apply_page_no_tokeninfo: {
    found: findLines(trialApplyLines, /tokeninfo/i),
    expect: "absent",
  },
  trial_apply_page_placeholder: {
    found: findLines(trialApplyLines, /REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID/),
    expect: "present",
  },
  trial_apply_page_gis: {
    found: findLines(trialApplyLines, /accounts\.google\.com\/gsi\/client/),
    expect: "present",
  },
  trial_apply_page_uses_jwks: {
    found: findLines(trialApplyLines, /oauth2\/v3\/certs/),
    expect: "present",
  },
  trial_apply_module_freezes_request: {
    found: findLines(trialApplyModuleLines, /Object\.freeze/),
    expect: "present",
  },
  trial_apply_module_checks_display_sent: {
    found: findLines(trialApplyModuleLines, /verifyDisplayMatchesSent/),
    expect: "present",
  },
  trial_apply_module_compares_one_time_fact_only: {
    found: findLines(trialApplyModuleLines, /compareOneTime/),
    expect: "present",
  },
  // 環境条件の機械検証・試行ごとの世代管理・応答エラーの正規化
  // （Codex レビュー 6715525086 への対応）。
  trial_apply_module_env_condition: {
    found: findLines(trialApplyModuleLines, /verifyEnvCondition/),
    expect: "present",
  },
  trial_apply_module_session_guard: {
    found: findLines(trialApplyModuleLines, /createTrialSession/),
    expect: "present",
  },
  trial_apply_module_error_normalize: {
    found: findLines(trialApplyModuleLines, /normalizeResponseError/),
    expect: "present",
  },
  trial_apply_page_fixed_env_id: {
    found: findLines(trialApplyLines, /stage1-verification-only-20261101/),
    expect: "present",
  },
  trial_apply_page_session_guard: {
    found: findLines(trialApplyLines, /createTrialSession/),
    expect: "present",
  },
  trial_apply_page_env_condition: {
    found: findLines(trialApplyLines, /verifyEnvCondition/),
    expect: "present",
  },
  // 試行ごとの閉じ込みコールバックと共有状態の現行世代ガード
  // （Codex レビュー 6715565254 への対応）。
  trial_apply_page_attempt_closure: {
    found: findLines(trialApplyLines, /callback: \(response\) => onGoogleSignIn\(response, snap\)/),
    expect: "present",
  },
  trial_apply_page_guarded_finally: {
    found: findLines(trialApplyLines, /isCurrent\(snap\.trialId, snap\.generation\)/),
    expect: "present",
  },
  trial_apply_page_send_guard: {
    found: findLines(trialApplyLines, /sending = true/),
    expect: "present",
  },
  // 現行の失敗時は無効化の前に password 欄を消す
  // （Codex レビュー 6715858226 への対応）。
  trial_apply_page_clear_before_invalidate: {
    found: findLines(trialApplyLines, /無効化の前に password 欄を消す/),
    expect: "present",
  },
  trial_apply_screen_fake_gis: {
    found: findLines(readRel("test/trial-apply.screen.mjs").split("\n"), /__gis/),
    expect: "present",
  },
  trial_apply_screen_jsdom: {
    found: findLines(readRel("test/trial-apply.screen.mjs").split("\n"), /jsdom/),
    expect: "present",
  },
  trial_apply_screen_delayed_finally: {
    found: findLines(readRel("test/trial-apply.screen.mjs").split("\n"), /__jwksDelayMs/),
    expect: "present",
  },
  trial_apply_screen_password_checks: {
    found: findLines(readRel("test/trial-apply.screen.mjs").split("\n"), /fixedOneTime"\)\.value === ""/),
    expect: "present",
  },
  serve_real_trial_apply_route: {
    found: findLines(serveRealLines, /\/trial-apply/),
    expect: "present",
  },
  // S4 の試験種別（消費済み・初期化済み）は trial-apply 画面の拡張
  // （Codex レビュー 6720499137 への対応）。
  trial_apply_module_s4_kinds: {
    found: findLines(trialApplyModuleLines, /operation-consumed/),
    expect: "present",
  },
  trial_apply_module_s4_purpose: {
    found: findLines(trialApplyModuleLines, /purposeForKind/),
    expect: "present",
  },
  trial_apply_page_s4_kinds: {
    found: findLines(trialApplyLines, /operation-consumed/),
    expect: "present",
  },
  // S5 並行試験専用画面は、送信する JSON の全文表示をしない（ID トークン
  // と一回値が含まれるため）。画面のソースに秘密の項目名そのものが
  // 現れないこと、6件の要求の組み立て・nonce の相異・集計があること、
  // 送信器がスロットごとに Cookie を分けて並行送信し、送信後に保持を
  // 破棄すること、提供サーバーが配信することを確認する。
  s5_apply_page_no_secret_field_names: {
    found: findLines(s5ApplyLines, /id_token|one_time_value/),
    expect: "absent",
  },
  s5_apply_page_no_tokeninfo: {
    found: findLines(s5ApplyLines, /tokeninfo/i),
    expect: "absent",
  },
  s5_apply_page_placeholder: {
    found: findLines(s5ApplyLines, /REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID/),
    expect: "present",
  },
  s5_apply_page_gis: {
    found: findLines(s5ApplyLines, /accounts\.google\.com\/gsi\/client/),
    expect: "present",
  },
  s5_apply_page_uses_jwks: {
    found: findLines(s5ApplyLines, /oauth2\/v3\/certs/),
    expect: "present",
  },
  s5_apply_module_builds_requests: {
    found: findLines(s5ApplyModuleLines, /buildS5Requests/),
    expect: "present",
  },
  s5_apply_module_checks_nonces_distinct: {
    found: findLines(s5ApplyModuleLines, /verifyNoncesDistinct/),
    expect: "present",
  },
  s5_apply_module_checks_slots_equal: {
    found: findLines(s5ApplyModuleLines, /verifyS5RequestsEqual/),
    expect: "present",
  },
  s5_apply_module_aggregates: {
    found: findLines(s5ApplyModuleLines, /aggregateS5Results/),
    expect: "present",
  },
  s5_sender_per_slot_cookie: {
    found: findLines(s5SenderLines, /\$\{slots\[i\]\.ctx\}/),
    expect: "present",
  },
  s5_sender_parallel_send: {
    found: findLines(s5SenderLines, /Promise\.allSettled/),
    expect: "present",
  },
  s5_sender_slot_binding: {
    found: findLines(s5SenderLines, /slot_nonce_mismatch/),
    expect: "present",
  },
  s5_sender_clears_after_send: {
    found: findLines(s5SenderLines, /issued = null/),
    expect: "present",
  },
  s5_sender_no_response_local_code: {
    found: findLines(s5SenderLines, /S5_NO_RESPONSE/),
    expect: "present",
  },
  // S5 送信器の修正（Codex レビュー 6720755818 への対応）。
  // 1) リダイレクト非追従、2) 発行中・送信中の排他と試行の結び付け、
  // 4) nonce 寿命の起点は最初のスロットの発行時刻。
  s5_sender_redirect_manual: {
    found: findLines(s5SenderLines, /redirect: "manual"/),
    expect: "present",
  },
  s5_sender_redirect_not_followed: {
    found: findLines(s5SenderLines, /S5_REDIRECT_NOT_FOLLOWED/),
    expect: "present",
  },
  s5_sender_busy_guard: {
    found: findLines(s5SenderLines, /s5_busy/),
    expect: "present",
  },
  s5_sender_trial_binding: {
    found: findLines(s5SenderLines, /s5_trial_mismatch/),
    expect: "present",
  },
  s5_sender_per_slot_issued_at: {
    found: findLines(s5SenderLines, /issuedAt/),
    expect: "present",
  },
  // S5 入口の呼び出し元境界（Codex レビュー 6720755818 の指摘3）。
  // 試験単位セッション・Host・Origin・JSON content-type・本体サイズ上限。
  serve_real_s5_session_guard: {
    found: findLines(serveRealLines, /x-s5-session/),
    expect: "present",
  },
  serve_real_s5_session_placeholder: {
    found: findLines(serveRealLines, /REPLACE_WITH_S5_SESSION/),
    expect: "present",
  },
  serve_real_s5_origin_guard: {
    found: findLines(serveRealLines, /s5_bad_origin/),
    expect: "present",
  },
  serve_real_s5_body_limit: {
    found: findLines(serveRealLines, /S5_MAX_BODY_BYTES/),
    expect: "present",
  },
  s5_apply_page_session_placeholder: {
    found: findLines(s5ApplyLines, /REPLACE_WITH_S5_SESSION/),
    expect: "present",
  },
  s5_apply_page_sends_session: {
    found: findLines(s5ApplyLines, /x-s5-session/),
    expect: "present",
  },
  s5_apply_page_trial_binding: {
    found: findLines(s5ApplyLines, /trial_id=\$\{encodeURIComponent/),
    expect: "present",
  },
  serve_real_s5_apply_route: {
    found: findLines(serveRealLines, /\/s5-apply/),
    expect: "present",
  },
  serve_real_s5_nonces_route: {
    found: findLines(serveRealLines, /\/s5\/nonces/),
    expect: "present",
  },
  serve_real_s5_send_route: {
    found: findLines(serveRealLines, /\/s5\/send/),
    expect: "present",
  },
  s5_screen_fake_gis: {
    found: findLines(s5ScreenLines, /__gis/),
    expect: "present",
  },
  s5_screen_jsdom: {
    found: findLines(s5ScreenLines, /jsdom/),
    expect: "present",
  },
  s5_screen_send_posts: {
    found: findLines(s5ScreenLines, /__s5SendPosts/),
    expect: "present",
  },
  // admin-negative は合意された設計に存在しない未報告の追加であり、
  // 除去した（Codex レビュー 6734640413 の指摘1）。提供サーバー・
  // 画面・試験のいずれにも参照が残っていないこと。
  serve_real_no_admin_negative: {
    found: findLines(serveRealLines, /admin-negative/),
    expect: "absent",
  },
  s9_page_no_admin_negative: {
    found: findLines(s9NegativeLines, /admin-negative/),
    expect: "absent",
  },
  // S9 の nonce 期限の起点は /nonce 要求の開始時刻であり、応答の
  // 受信時刻ではない（Codex レビュー 6734640413 の指摘2）。画面は
  // 要求開始を試行に閉じ込め、取得中の再取得を拒否する。
  s9_page_nonce_request_start: {
    found: findLines(s9NegativeLines, /beginNonceFetch/),
    expect: "present",
  },
  s9_page_nonce_fetch_guard: {
    found: findLines(s9NegativeLines, /isNonceFetchPending/),
    expect: "present",
  },
  s9_page_no_receive_time_origin: {
    found: findLines(s9NegativeLines, /nonceIssuedAtMs = Date\.now/),
    expect: "absent",
  },
  s9_module_nonce_fetch_busy: {
    found: findLines(s9NegativeModuleLines, /nonce_fetch_busy/),
    expect: "present",
  },
  s9_module_nonce_stale_returns_null: {
    found: findLines(s9NegativeModuleLines, /finishNonceFetch/),
    expect: "present",
  },
  // S10 専用画面：凍結要求は B 取得で保持した主体ハッシュと手順の
  // 固定値（期待世代 2）から生成し、手入力欄は作らないこと。A と B
  // の主体ハッシュが同一の場合は same_subject で試行を停止すること。
  // 応答なしは状態未確定として停止し、再送しないこと。期待は 200 ok
  // かつ返された generation が期待世代＋1（3）であること。送信は
  // redirect: "manual" で行うこと。提供サーバーは /s10-add-operator
  // と /s10-add.mjs を返すこと。二重配信ガード試験は、同一要求の
  // 再送が nonce_replayed で拒否されることを確認すること
  // （Codex レビュー 6758375470）。
  s10_module_frozen_request: {
    found: findLines(s10AddModuleLines, /freezeRequest/),
    expect: "present",
  },
  s10_module_same_subject: {
    found: findLines(s10AddModuleLines, /same_subject/),
    expect: "present",
  },
  s10_module_no_resend_on_no_response: {
    found: findLines(s10AddModuleLines, /recordNoResponse/),
    expect: "present",
  },
  s10_module_expected_generation_plus_one: {
    found: findLines(s10AddModuleLines, /EXPECTED_GENERATION \+ 1/),
    expect: "present",
  },
  s10_page_pre_send_display: {
    found: findLines(s10AddLines, /frozenReq/),
    expect: "present",
  },
  s10_page_no_text_input: {
    found: findLines(s10AddLines, /type="text"/),
    expect: "absent",
  },
  s10_page_redirect_manual: {
    found: findLines(s10AddLines, /redirect: "manual"/),
    expect: "present",
  },
  s10_serve_route: {
    found: findLines(serveRealLines, /s10-add-operator/),
    expect: "present",
  },
  s10_guard_double_delivery: {
    found: findLines(s10AddGuardLines, /nonce_replayed/),
    expect: "present",
  },
  // S10 専用画面の再修正（Codex レビュー 6758648104）：GIS
  // コールバックは試行・役割・段階が一致するときにだけ有効で
  // （isCallbackCurrent）、画面は sha256hex 後にも再照合すること。
  // 新規試行・破棄のハンドラーは nonce 取得中も拒否すること。
  s10_module_callback_current: {
    found: findLines(s10AddModuleLines, /isCallbackCurrent/),
    expect: "present",
  },
  s10_page_recheck_after_hash: {
    found: findLines(s10AddLines, /hashRejection/),
    expect: "present",
  },
  s10_page_reject_while_fetching: {
    found: findLines(s10AddLines, /isAnyNonceFetchPending/),
    expect: "present",
  },
  // S10 専用画面の再々修正（Codex レビュー 6758817319）：各役割の
  // 捕捉は claimCallbackCapture で1回に固定し、画面は受付時点で
  // claim を取ること。
  s10_module_one_capture_claim: {
    found: findLines(s10AddModuleLines, /claimCallbackCapture/),
    expect: "present",
  },
  s10_page_claims_capture: {
    found: findLines(s10AddLines, /claimCallbackCapture/),
    expect: "present",
  },
  // S11 並行送信ツール（Codex の手順レビュー seq 691 への対応）：
  // 手順3の凍結（期待世代 2）と手順4の凍結（期待世代 3）が固定値
  // から生成されること。対象 C が既存運営者と同一なら停止する
  // こと。手順4の認可者が手順3の認可者と異なれば停止すること。
  // 集計が成功ちょうど1件を要求すること。送信器がスロットごとに
  // Cookie を分けて並行送信し、結び付け確認と redirect: "manual"
  // を持つこと。画面にテキスト入力欄がなく、セッションの
  // プレースホルダを持つこと。提供サーバーが S11 の経路を返す
  // こと。ガード試験が実際の送信器で手順3・手順4を通すこと。
  s11_module_freeze_stale: {
    found: findLines(s11ModuleLines, /freezeStaleRequest/),
    expect: "present",
  },
  s11_module_freeze_concurrent: {
    found: findLines(s11ModuleLines, /freezeConcurrentRequests/),
    expect: "present",
  },
  s11_module_target_guard: {
    found: findLines(s11ModuleLines, /target_matches_operator/),
    expect: "present",
  },
  s11_module_authorizer_mismatch: {
    found: findLines(s11ModuleLines, /authorizer_mismatch/),
    expect: "present",
  },
  s11_module_aggregate: {
    found: findLines(s11ModuleLines, /aggregateS11ConcurrentResults/),
    expect: "present",
  },
  s11_module_one_capture_claim: {
    found: findLines(s11ModuleLines, /claimCallbackCapture/),
    expect: "present",
  },
  s11_sender_per_slot_cookie: {
    found: findLines(s11SenderLines, /postAdd\(slots\[i\]\.ctx/),
    expect: "present",
  },
  s11_sender_parallel_send: {
    found: findLines(s11SenderLines, /Promise\.allSettled/),
    expect: "present",
  },
  s11_sender_slot_binding: {
    found: findLines(s11SenderLines, /slot_nonce_mismatch/),
    expect: "present",
  },
  s11_sender_redirect_manual: {
    found: findLines(s11SenderLines, /redirect: "manual"/),
    expect: "present",
  },
  s11_sender_no_resend_consume: {
    found: findLines(s11SenderLines, /issued = null/),
    expect: "present",
  },
  s11_page_no_text_input: {
    found: findLines(s11ParallelLines, /type="text"/),
    expect: "absent",
  },
  s11_page_session_placeholder: {
    found: findLines(s11ParallelLines, /REPLACE_WITH_S11_SESSION/),
    expect: "present",
  },
  s11_page_sends_session: {
    found: findLines(s11ParallelLines, /x-s11-session/),
    expect: "present",
  },
  s11_serve_route: {
    found: findLines(serveRealLines, /s11-parallel/),
    expect: "present",
  },
  s11_serve_nonces_route: {
    found: findLines(serveRealLines, /\/s11\/nonces/),
    expect: "present",
  },
  s11_serve_send_route: {
    found: findLines(serveRealLines, /\/s11\/send-concurrent/),
    expect: "present",
  },
  s11_guard_uses_sender: {
    found: findLines(s11GuardLines, /createS11Sender/),
    expect: "present",
  },
  s11_screen_fake_gis: {
    found: findLines(s11ScreenLines, /__gis/),
    expect: "present",
  },
  s11_screen_jsdom: {
    found: findLines(s11ScreenLines, /jsdom/),
    expect: "present",
  },
  // S12 失効専用モジュール・送信器・画面：失効要求が凍結でき、
  // 保持トークンの鮮度（heldTokenFreshness）が失効の送信前に
  // 機械確認されること（s12_held_token_stale）。保持トークンの
  // 提示が状態機械の段階で失効後に限られること
  // （recordHeldBVerifyOnly）。新しい B が失効対象と異なれば
  // 停止すること（subject_mismatch）。送信器がスロットごとに
  // Cookie を分け、保持トークンの鮮度ゲートと送信窓と
  // redirect: "manual" を持つこと。画面にテキスト入力欄がなく、
  // セッションのプレースホルダを持つこと。提供サーバーが S12 の
  // 経路を返すこと。ガード試験が実際の送信器で本手順を通すこと。
  s12_module_freeze_revoke: {
    found: findLines(s12ModuleLines, /freezeRevokeRequest/),
    expect: "present",
  },
  s12_module_held_freshness: {
    found: findLines(s12ModuleLines, /heldTokenFreshness/),
    expect: "present",
  },
  s12_module_held_stale_guard: {
    found: findLines(s12ModuleLines, /s12_held_token_stale/),
    expect: "present",
  },
  s12_module_held_order: {
    found: findLines(s12ModuleLines, /recordHeldBVerifyOnly/),
    expect: "present",
  },
  s12_module_subject_mismatch: {
    found: findLines(s12ModuleLines, /subject_mismatch/),
    expect: "present",
  },
  s12_module_one_capture_claim: {
    found: findLines(s12ModuleLines, /claimCallbackCapture/),
    expect: "present",
  },
  s12_module_revoke_path: {
    found: findLines(s12ModuleLines, /\/admin\/registry\/revoke/),
    expect: "present",
  },
  s12_sender_per_slot_cookie: {
    found: findLines(s12SenderLines, /op2_nonce_ctx=\$\{slotState\.ctx\}/),
    expect: "present",
  },
  s12_sender_held_gate: {
    found: findLines(s12SenderLines, /s12_held_token_stale/),
    expect: "present",
  },
  s12_sender_redirect_manual: {
    found: findLines(s12SenderLines, /redirect: "manual"/),
    expect: "present",
  },
  s12_sender_window: {
    found: findLines(s12SenderLines, /s12_nonces_expired/),
    expect: "present",
  },
  s12_page_no_text_input: {
    found: findLines(s12RevokeLines, /type="text"/),
    expect: "absent",
  },
  s12_page_session_placeholder: {
    found: findLines(s12RevokeLines, /REPLACE_WITH_S12_SESSION/),
    expect: "present",
  },
  s12_page_sends_session: {
    found: findLines(s12RevokeLines, /x-s12-session/),
    expect: "present",
  },
  s12_serve_route: {
    found: findLines(serveRealLines, /s12-revoke/),
    expect: "present",
  },
  s12_serve_nonces_route: {
    found: findLines(serveRealLines, /\/s12\/nonces/),
    expect: "present",
  },
  s12_serve_send_route: {
    found: findLines(serveRealLines, /\/s12\/send-revoke/),
    expect: "present",
  },
  s12_guard_uses_sender: {
    found: findLines(s12GuardLines, /createS12Sender/),
    expect: "present",
  },
  s12_screen_fake_gis: {
    found: findLines(s12ScreenLines, /__gis/),
    expect: "present",
  },
  s12_screen_jsdom: {
    found: findLines(s12ScreenLines, /jsdom/),
    expect: "present",
  },
  // S13 失効専用モジュール・送信器・画面：2つの失効要求が手順
  // ごとに凍結できること（freezeRevokeCRequest /
  // freezeRevokeARequest）。手順2の期待が 409 last_operator で
  // あること（EXPECTED_LAST_OPERATOR_RESPONSE。この拒否が合格）。
  // 手順2の記録が状態機械の段階で手順1の後段に限られること
  // （recordRevokeASend）。認可者・手順間主体の機械確認
  // （wrong_authorizer）。送信器がスロットごとに Cookie を分け、
  // 対象の結び付け（s13_revoke_not_frozen /
  // s13_revoke_target_mismatch）とスロット固定の期待世代
  // （REVOKE_EXPECTED_GENERATION_BY_SLOT）と送信窓と
  // redirect: "manual" を持つこと。画面にテキスト入力欄がなく、
  // セッションのプレースホルダを持つこと。提供サーバーが S13 の
  // 経路を返すこと。ガード試験が実際の送信器で本手順を通すこと。
  s13_module_freeze_revokec: {
    found: findLines(s13ModuleLines, /freezeRevokeCRequest/),
    expect: "present",
  },
  s13_module_freeze_revokea: {
    found: findLines(s13ModuleLines, /freezeRevokeARequest/),
    expect: "present",
  },
  s13_module_last_operator_expectation: {
    found: findLines(s13ModuleLines, /EXPECTED_LAST_OPERATOR_RESPONSE/),
    expect: "present",
  },
  s13_module_revokea_order: {
    found: findLines(s13ModuleLines, /recordRevokeASend/),
    expect: "present",
  },
  s13_module_wrong_authorizer: {
    found: findLines(s13ModuleLines, /wrong_authorizer/),
    expect: "present",
  },
  s13_module_one_capture_claim: {
    found: findLines(s13ModuleLines, /claimCallbackCapture/),
    expect: "present",
  },
  s13_module_revoke_path: {
    found: findLines(s13ModuleLines, /\/admin\/registry\/revoke/),
    expect: "present",
  },
  s13_sender_per_slot_cookie: {
    found: findLines(s13SenderLines, /op2_nonce_ctx=\$\{slotState\.ctx\}/),
    expect: "present",
  },
  s13_sender_target_not_frozen: {
    found: findLines(s13SenderLines, /s13_revoke_not_frozen/),
    expect: "present",
  },
  s13_sender_target_mismatch: {
    found: findLines(s13SenderLines, /s13_revoke_target_mismatch/),
    expect: "present",
  },
  s13_sender_fixed_generation: {
    found: findLines(s13SenderLines, /REVOKE_EXPECTED_GENERATION_BY_SLOT/),
    expect: "present",
  },
  s13_sender_redirect_manual: {
    found: findLines(s13SenderLines, /redirect: "manual"/),
    expect: "present",
  },
  s13_sender_window: {
    found: findLines(s13SenderLines, /s13_nonces_expired/),
    expect: "present",
  },
  s13_page_no_text_input: {
    found: findLines(s13RevokeLines, /type="text"/),
    expect: "absent",
  },
  s13_page_session_placeholder: {
    found: findLines(s13RevokeLines, /REPLACE_WITH_S13_SESSION/),
    expect: "present",
  },
  s13_page_sends_session: {
    found: findLines(s13RevokeLines, /x-s13-session/),
    expect: "present",
  },
  s13_serve_route: {
    found: findLines(serveRealLines, /s13-revoke/),
    expect: "present",
  },
  s13_serve_nonces_route: {
    found: findLines(serveRealLines, /\/s13\/nonces/),
    expect: "present",
  },
  s13_serve_freeze_route: {
    found: findLines(serveRealLines, /\/s13\/freeze-revoke/),
    expect: "present",
  },
  s13_serve_send_route: {
    found: findLines(serveRealLines, /\/s13\/send-revoke/),
    expect: "present",
  },
  s13_guard_uses_sender: {
    found: findLines(s13GuardLines, /createS13Sender/),
    expect: "present",
  },
  s13_screen_fake_gis: {
    found: findLines(s13ScreenLines, /__gis/),
    expect: "present",
  },
  s13_screen_jsdom: {
    found: findLines(s13ScreenLines, /jsdom/),
    expect: "present",
  },
  // S14 ローテーション専用モジュール・送信器・画面：ローテーション
  // 要求が対象の組つきで凍結できること（freezeRotateRequest）。
  // 手順1の期待が 200 ok・generation 7 であること
  // （EXPECTED_ROTATE_RESPONSE）。手順2の期待が 403 not_operator
  // であること（EXPECTED_CHECKA_REFUSAL_RESPONSE。この拒否が合格）。
  // 手順3の記録が状態機械の段階で手順2の後段に限られること
  // （recordCheckBVerifyOnly）。認可者・対象主体の機械確認
  // （wrong_authorizer / wrong_subject）。送信器がスロットごとに
  // Cookie を分け、対象の組の結び付け（s14_rotate_not_frozen /
  // s14_rotate_target_mismatch）と固定の期待世代
  // （ROTATE_EXPECTED_GENERATION）と送信窓と redirect: "manual" を
  // 持つこと。画面にテキスト入力欄がなく、セッションのプレース
  // ホルダを持つこと。提供サーバーが S14 の経路を返すこと。
  // ガード試験が実際の送信器で本手順を通すこと。
  s14_module_freeze_rotate: {
    found: findLines(s14ModuleLines, /freezeRotateRequest/),
    expect: "present",
  },
  s14_module_rotate_expectation: {
    found: findLines(s14ModuleLines, /EXPECTED_ROTATE_RESPONSE/),
    expect: "present",
  },
  s14_module_checka_refusal_expectation: {
    found: findLines(s14ModuleLines, /EXPECTED_CHECKA_REFUSAL_RESPONSE/),
    expect: "present",
  },
  s14_module_checkb_order: {
    found: findLines(s14ModuleLines, /recordCheckBVerifyOnly/),
    expect: "present",
  },
  s14_module_wrong_authorizer: {
    found: findLines(s14ModuleLines, /wrong_authorizer/),
    expect: "present",
  },
  s14_module_wrong_subject: {
    found: findLines(s14ModuleLines, /wrong_subject/),
    expect: "present",
  },
  s14_module_one_capture_claim: {
    found: findLines(s14ModuleLines, /claimCallbackCapture/),
    expect: "present",
  },
  s14_module_rotate_path: {
    found: findLines(s14ModuleLines, /\/admin\/registry\/rotate/),
    expect: "present",
  },
  s14_sender_per_slot_cookie: {
    found: findLines(s14SenderLines, /op2_nonce_ctx=\$\{slotState\.ctx\}/),
    expect: "present",
  },
  s14_sender_target_not_frozen: {
    found: findLines(s14SenderLines, /s14_rotate_not_frozen/),
    expect: "present",
  },
  s14_sender_target_mismatch: {
    found: findLines(s14SenderLines, /s14_rotate_target_mismatch/),
    expect: "present",
  },
  s14_sender_fixed_generation: {
    found: findLines(s14SenderLines, /ROTATE_EXPECTED_GENERATION/),
    expect: "present",
  },
  s14_sender_redirect_manual: {
    found: findLines(s14SenderLines, /redirect: "manual"/),
    expect: "present",
  },
  s14_sender_window: {
    found: findLines(s14SenderLines, /s14_nonces_expired/),
    expect: "present",
  },
  s14_page_no_text_input: {
    found: findLines(s14RotateLines, /type="text"/),
    expect: "absent",
  },
  s14_page_session_placeholder: {
    found: findLines(s14RotateLines, /REPLACE_WITH_S14_SESSION/),
    expect: "present",
  },
  s14_page_sends_session: {
    found: findLines(s14RotateLines, /x-s14-session/),
    expect: "present",
  },
  s14_serve_route: {
    found: findLines(serveRealLines, /s14-rotate/),
    expect: "present",
  },
  s14_serve_nonces_route: {
    found: findLines(serveRealLines, /\/s14\/nonces/),
    expect: "present",
  },
  s14_serve_freeze_route: {
    found: findLines(serveRealLines, /\/s14\/freeze-rotate/),
    expect: "present",
  },
  s14_serve_send_route: {
    found: findLines(serveRealLines, /\/s14\/send-rotate/),
    expect: "present",
  },
  s14_guard_uses_sender: {
    found: findLines(s14GuardLines, /createS14Sender/),
    expect: "present",
  },
  s14_screen_fake_gis: {
    found: findLines(s14ScreenLines, /__gis/),
    expect: "present",
  },
  s14_screen_jsdom: {
    found: findLines(s14ScreenLines, /jsdom/),
    expect: "present",
  },
  // S15（項目7 手順1：応答破棄を伴う全面復旧）。状態機械は
  // 凍結・判定・再実施の数え方・通常版復帰の記録による締めを
  // 持ち、送信器は破棄送信（応答を読まない）・判定ゲート・
  // redirect: "manual" を持つこと。破棄送信の本体（番兵
  // コメントの間）に応答の状態・ok・ヘッダー・本文取得への
  // アクセスが存在しないことも構造検査する。
  s15_module_freeze: {
    found: findLines(s15ModuleLines, /freezeApproval/),
    expect: "present",
  },
  s15_module_judge: {
    found: findLines(s15ModuleLines, /judgeS15ReadBack/),
    expect: "present",
  },
  s15_module_max_reattempts: {
    found: findLines(s15ModuleLines, /MAX_REATTEMPTS/),
    expect: "present",
  },
  s15_module_normal_restored: {
    found: findLines(s15ModuleLines, /recordNormalRestored/),
    expect: "present",
  },
  s15_module_already_committed: {
    found: findLines(s15ModuleLines, /s15_already_committed/),
    expect: "present",
  },
  s15_module_attempts_exhausted: {
    found: findLines(s15ModuleLines, /s15_attempts_exhausted/),
    expect: "present",
  },
  s15_module_undetermined_state: {
    found: findLines(s15ModuleLines, /sent-undetermined/),
    expect: "present",
  },
  s15_module_discarded_outcome: {
    found: findLines(s15ModuleLines, /S15_DISCARDED_OUTCOME/),
    expect: "present",
  },
  s15_sender_freeze: {
    found: findLines(s15SenderLines, /freezeApproval/),
    expect: "present",
  },
  s15_sender_attempt_gate: {
    found: findLines(s15SenderLines, /s15_attempt_gate/),
    expect: "present",
  },
  s15_sender_redirect_manual: {
    found: findLines(s15SenderLines, /redirect: "manual"/),
    expect: "present",
  },
  s15_sender_per_attempt_cookie: {
    found: findLines(s15SenderLines, /op2_nonce_ctx=\$\{slot\.ctx\}/),
    expect: "present",
  },
  s15_sender_discard_block_clean: {
    found: (() => {
      const begin = s15SenderLines.findIndex((l) => l.includes("[discard-send-begin]"));
      const end = s15SenderLines.findIndex((l) => l.includes("[discard-send-end]"));
      if (begin < 0 || end < 0 || end <= begin) return [];
      const forbidden = /\.status|\.ok\b|\.headers|\.json\(|\.text\(/;
      const dirty = s15SenderLines.slice(begin, end + 1).some((l) => forbidden.test(l));
      return dirty ? [] : [{ line: begin + 1, text: "discard block free of response access" }];
    })(),
    expect: "present",
  },
  s15_serve_module_route: {
    found: findLines(serveRealLines, /\/s15-apply\.mjs/),
    expect: "present",
  },
  s15_serve_nonces_route: {
    found: findLines(serveRealLines, /\/s15\/nonces/),
    expect: "present",
  },
  s15_serve_send_route: {
    found: findLines(serveRealLines, /\/s15\/send-discard/),
    expect: "present",
  },
  s15_guard_uses_sender: {
    found: findLines(s15GuardLines, /createS15Sender/),
    expect: "present",
  },
  s15_guard_records_judgment: {
    found: findLines(s15GuardLines, /recordReadBackJudgment/),
    expect: "present",
  },
  // S15 修正（Codex レビュー 6879152477）：試行切替関門は状態
  // 機械と送信器の両層に s15_trial_unjudged／
  // s15_trial_not_closed として存在すること。提供サーバーは
  // createRealServer ファクトリーで生成され、S15 セッション
  // （s15Session）をプロセス内だけで戻り値に含めること。
  // 運転コード（tools/s15-driver.mjs）はファクトリーを
  // import し、セッションを x-s15-session ヘッダーで示すこと。
  s15_module_trial_unjudged_gate: {
    found: findLines(s15ModuleLines, /s15_trial_unjudged/),
    expect: "present",
  },
  s15_module_trial_not_closed_gate: {
    found: findLines(s15ModuleLines, /s15_trial_not_closed/),
    expect: "present",
  },
  s15_sender_trial_unjudged_gate: {
    found: findLines(s15SenderLines, /s15_trial_unjudged/),
    expect: "present",
  },
  s15_sender_trial_not_closed_gate: {
    found: findLines(s15SenderLines, /s15_trial_not_closed/),
    expect: "present",
  },
  s15_serve_factory: {
    found: findLines(serveRealLines, /createRealServer/),
    expect: "present",
  },
  s15_serve_factory_returns_session: {
    found: findLines(serveRealLines, /s15Session/),
    expect: "present",
  },
  s15_driver_uses_factory: {
    found: findLines(s15DriverLines, /createRealServer/),
    expect: "present",
  },
  s15_driver_sends_session_header: {
    found: findLines(s15DriverLines, /x-s15-session/),
    expect: "present",
  },
  // クリーン起動試験はミラー対象ファイルだけを一時ディレクトリへ
  // 複写し、未追跡ファイルに依存しないことを確認する（指摘1）。
  clean_boot_mirror_list: {
    found: findLines(cleanBootLines, /MIRROR_FILES/),
    expect: "present",
  },
  clean_boot_no_persist: {
    found: findLines(cleanBootLines, /\.persist-/),
    expect: "present",
  },
  // 終了処理の共通手順は、SIGTERM で終了しない子プロセスに
  // SIGKILL を送り、待ち時間は上限付きであること（指摘 6737085464）。
  teardown_helper_sigkill_fallback: {
    found: findLines(teardownHelperLines, /SIGKILL/),
    expect: "present",
  },
  teardown_helper_no_child_guard: {
    found: findLines(teardownHelperLines, /no-child/),
    expect: "present",
  },
  teardown_helper_bounded_wait: {
    found: findLines(teardownHelperLines, /kill-timeout/),
    expect: "present",
  },
  // クリーン起動試験の終了処理は、共通手順 teardownAndRemove に
  // 委ね、終了を確認できなかった場合は失敗として報告すること
  // （Codex レビュー 6754717703）。
  clean_boot_uses_teardown_and_remove: {
    found: findLines(cleanBootLines, /await teardownAndRemove\(/),
    expect: "present",
  },
  clean_boot_reports_teardown_failure: {
    found: findLines(cleanBootLines, /!result\.removed/),
    expect: "present",
  },
  // 終了順序の構造検査：teardownAndRemove 内で stopChild →
  // closeServer → rm の順に行番号が並ぶこと。Windows では子
  // プロセスがミラー内のファイルを開いたまま削除すると EBUSY に
  // なるため、削除は必ず子プロセスの終了確認の後でなければ
  // ならない。
  teardown_helper_order: {
    found: (() => {
      const iStop = firstLineIndex(teardownHelperLines, /await stopChild\(/);
      const iClose = firstLineIndex(teardownHelperLines, /await closeServer\(/);
      const iRm = firstLineIndex(teardownHelperLines, /await rm\(/);
      return iStop !== -1 && iClose !== -1 && iRm !== -1 && iStop < iClose && iClose < iRm
        ? [{ line: 0, text: "stopChild < closeServer < rm" }]
        : [];
    })(),
    expect: "present",
  },
  // 削除は、終了・閉鎖の確認が取れた場合に限ること。未確認の
  // 場合は削除せず、removed: false と failure を返すこと。
  teardown_helper_fail_closed_removal: {
    found: findLines(teardownHelperLines, /removed: false/),
    expect: "present",
  },
  teardown_helper_confirmed_values: {
    found: findLines(teardownHelperLines, /CHILD_STOP_CONFIRMED|SERVER_CLOSE_CONFIRMED/),
    expect: "present",
  },
  // 終了順序試験は、実プロセスの挙動（プラットフォーム別）と
  // モックによる分岐検証を分けて持つこと（Codex レビュー
  // 6754717703）。
  teardown_test_uses_mock_child: {
    found: findLines(teardownTestLines, /EventEmitter/),
    expect: "present",
  },
  teardown_test_platform_split: {
    found: findLines(teardownTestLines, /win32/),
    expect: "present",
  },
  // 終了順序試験は、kill → 子プロセス exit → 中継の閉鎖完了 → rm
  // の順をイベントの記録と照合で確認すること。
  teardown_test_checks_event_order: {
    found: findLines(teardownTestLines, /kill-sent.*child-exit.*relay-closed.*rm-done/),
    expect: "present",
  },
};
for (const [name, c] of Object.entries(checks)) {
  const ok = c.expect === "present" ? c.found.length > 0 : c.found.length === 0;
  if (!ok) {
    problems.push(
      `ソース検査に失敗しました: ${name}（期待: ${c.expect}、検出: ${c.found.length} 件）`
    );
  }
}
if (problems.length) {
  console.error("error: 検査で問題が見つかったため、マニフェストを生成しません");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

// ---------- マニフェスト ----------
const commonBindings = [
  { name: "DEPLOYMENT_TIER", kind: "plain_text", value: "verify", note: "明示指定が必須。未設定・想定外はハーネス側が全経路を拒否する" },
  { name: "ENV_ID", kind: "plain_text", value: "<set-on-pc>", note: "値は含めない。対象環境の識別子。手順0で2経路照合した値を使う" },
  { name: "GOOGLE_CLIENT_ID", kind: "plain_text", value: "<set-on-pc: verification OAuth client id>", note: "値は含めない。aud 照合の基準" },
  { name: "REGISTRY", kind: "durable_object", note: "RegistryDO へのバインディング。名前空間 ID は手順0で2経路照合する" },
  { name: "VERIFY_ONLY", kind: "durable_object", note: "VerificationDO へのバインディング。既存名前空間 ef29957c85744eccaea6db64af433868 を引き継ぐ。このスクリプトの版は既存名前空間が依存する VerificationDO クラスを export し続けなければ作成できない（プラットフォームの検査、エラー 10064）。各ビルドは受動スタブを export する" },
];
const mustNotBeSet = [
  { name: "MOCK_AUTH", reason: "tier=verify では設定検証が全経路を拒否する" },
  { name: "ALLOW_TEST_HOOKS", reason: "tier=verify では設定検証が全経路を拒否する。故障の注入はフックではなく故障版ビルドで行う" },
  { name: "TOKENINFO_URL", reason: "tier=verify では設定検証が全経路を拒否し、既定の Google tokeninfo だけを使う" },
  { name: "DIAG_KEY", reason: "診断読み取りは local-mock＋フック有効時のみ。実環境の読み戻しはプラットフォーム経路（Data Studio 等）で行う" },
];

const manifest = {
  generated_by: "tools/build-realenv-manifest.mjs",
  generated_for: "段階①フェーズ2 先行検証 実環境試験（手順書 v0.4）",
  target: {
    worker_name: "vhslide-stage1-verify-20261101-a",
    note: "アカウント ID・Worker 名・DO 名前空間 ID の同一性確認は、このマニフェストや成果物自身の設定の読み返しでは行わない。ダッシュボード（PC 側）と API（Muse）の2経路で独立に読み取り、事前合意した値と照合する（手順書 手順0）",
  },
  artifacts,
  builds: {
    normal: {
      artifact: "src/worker.js",
      role: "通常ビルド（アプリ内管理ルート）",
      bindings: commonBindings,
      must_not_be_set: mustNotBeSet,
    },
    platform: {
      artifact: "src/platform-worker.js",
      role: "プラットフォーム経路の一時ビルド（操作ごとに配置し、直後に通常ビルドへ復帰させる）",
      bindings: [
        ...commonBindings,
        { name: "APPROVAL_ENV_ID", kind: "plain_text", value: "<fixed-by-account-holder>", note: "値は含めない。ENV_ID と一致が必須" },
        { name: "APPROVAL_PURPOSE", kind: "plain_text", value: "<fixed-by-account-holder: bootstrap | full-replace>", note: "値は含めない" },
        { name: "APPROVAL_SUBJECT_HASH", kind: "plain_text", value: "<fixed-by-account-holder>", note: "値は含めない。対象主体の SHA-256" },
        { name: "APPROVAL_EXPIRES_AT", kind: "plain_text", value: "<fixed-by-account-holder>", note: "値は含めない。分単位の短さに保つ" },
        { name: "APPROVAL_ONE_TIME", kind: "secret", note: "値は含めない。アカウント保有者が生成し、PC 側で設定する。Muse は保持しない" },
        { name: "APPROVAL_OPERATION_ID", kind: "plain_text", value: "<fixed-by-account-holder>", note: "値は含めない。操作ごとに新規発行し、再利用しない" },
      ],
      must_not_be_set: mustNotBeSet,
    },
    fault: {
      artifact: "fault-builds/apply-after-writes/worker.js",
      diff: "fault-builds/apply-after-writes.diff",
      role: "故障版ビルド（検証専用・非公開）。計画 2.7 項目9の途中失敗ドリルでのみ一時ビルドとして配置し、直後に通常ビルドへ復帰させる。通常の操作には決して使わない",
      bindings: "platform と同じ",
      must_not_be_set: mustNotBeSet,
    },
    fallback: {
      artifact: "fallback-builds/baseline-passive/worker.js",
      role: "復旧用受動ビルド（ベースライン相当）。RegistryDO 移行の適用後は移行前の版へロールバックできない（Cloudflare Rollbacks 仕様）ため、初回配置はこのビルドと移行を同時に単一配置し、移行直後の受動状態をそのまま確保する。通常ビルドの異常時の復旧先でもある（移行後の版として 100% 配置できる）",
      bindings: [
        { name: "REGISTRY", kind: "durable_object", note: "RegistryDO へのバインディング。新規クラスを保持するため（スタブは状態に触れない）" },
        { name: "VERIFY_ONLY", kind: "durable_object", note: "VerificationDO へのバインディング。既存クラス・名前空間・データを保持するため（スタブは状態に触れない）" },
      ],
      must_not_be_set: mustNotBeSet,
    },
  },
  first_deployment: {
    order: "受動版＋RegistryDO 追加移行を先に単一配置し、受動状態と両名前空間を実測で確認してから、通常版を未配信で作り照合して有効化する",
    artifact: "fallback-builds/baseline-passive/worker.js",
    method: "非バージョニング配置（PUT /workers/scripts/<検証用Worker>）。移行は版アップロードでは適用できない（エラー 10211）ため、移行と有効化を同時に行う",
    compatibility_date: "2026-08-01",
    migrations: {
      tag: "stage1-phase2-registrydo",
      new_sqlite_classes: ["RegistryDO"],
      deleted_classes: [],
      renamed_classes: [],
      transferred_classes: [],
      note: "追加のみ。既存 VerificationDO の名前空間・データは削除・置換しない。適用時の前提タグ（old_tag）は verify-v1（2026-11-08 の初回適用時に API の前提条件エラー 10079 が提示した現行タグ）。適用後の現行タグは stage1-phase2-registrydo（版リソースの migration_tag で読み戻し確認済み）",
    },
    bindings: [
      { name: "REGISTRY", kind: "durable_object", class_name: "RegistryDO", note: "名前空間 ID は配置時に新規採番され、読み戻しで記録する" },
      { name: "VERIFY_ONLY", kind: "durable_object", class_name: "VerificationDO", namespace_id: "ef29957c85744eccaea6db64af433868", note: "既存名前空間をそのまま引き継ぐ" },
    ],
    must_not_be_set: mustNotBeSet,
  },
  pc_side: {
    login_page: "public/login-real.html（tools/serve-real.mjs が GOOGLE_CLIENT_ID をメモリ上で差し込んで配信する）",
    subject_hash_page: "public/subject-hash.html（tools/serve-real.mjs が /subject-hash で配信。GOOGLE_CLIENT_ID をメモリ上で差し込む。ID トークンを外部へ送らず、公開鍵・JWKS による PC 内署名検証で SHA-256(sub) だけを表示する。検証モジュール tools/subject-hash-verify.mjs は Node 試験と共用）",
    trial_apply_page: "public/trial-apply.html（tools/serve-real.mjs が /trial-apply で配信。GOOGLE_CLIENT_ID をメモリ上で差し込む。送信に使う単一の要求を凍結し、送信直前に非秘密項目と一致／不一致の事実だけを表示して、その同じ要求を /platform/apply へ送る。送信する JSON の全文表示はしない。検証モジュール tools/trial-apply.mjs は Node 試験 test/trial-apply.test.mjs と共用し、主体の確認は署名検証と tools/subject-hash-verify.mjs を再利用する。S4 の消費済み・初期化済み試験も同じ画面で行う（用途は試験種別で決まる固定値。不一致試験は full-replace、S4 の2試験は bootstrap）」",
    s5_apply_page: "public/s5-apply.html（tools/serve-real.mjs が /s5-apply で配信。GOOGLE_CLIENT_ID をメモリ上で差し込む。6件の実トークンを集めて凍結した要求を作り、送信直前に6件の条件が等しいことと nonce が異なることを表示して、その同じ6件の要求を送信指示として送信器へ渡す。送信する JSON の全文表示はしない。検証モジュール tools/s5-apply.mjs は Node 試験 test/s5-apply.test.mjs と共用する。並行送信は提供サーバー側の tools/s5-sender.mjs（Node）が行う。スロットごとに Cookie jar を分け、6件を Promise.all で並行送信する。送信器の試験は test/s5-sender.test.mjs、画面の実画面試験は test/s5-apply.screen.mjs）",
    s11_parallel_page: "public/s11-parallel.html（tools/serve-real.mjs が /s11-parallel で配信。GOOGLE_CLIENT_ID と S11 セッションをメモリ上で差し込む。項目6 手順3・手順4の専用画面。C の主体ハッシュと A の実トークンを集めて凍結した要求を作り、送信直前に表示して、その送信指示を送信器へ渡す。送信はブラウザーから直接行わない。検証モジュール tools/s11-parallel.mjs は Node 試験 test/s11-parallel.test.mjs と共用する。並行送信は提供サーバー側の tools/s11-sender.mjs（Node）が行う。スロットごとに Cookie jar を分け、手順4の2件を Promise.allSettled で並行送信する。手順3の単発送信も送信器経由とする。送信器の試験は test/s11-sender.test.mjs、実 Worker との結線は test/s11-guard.test.mjs、画面の実画面試験は test/s11-parallel.screen.mjs）",
    s12_revoke_page: "public/s12-revoke.html（tools/serve-real.mjs が /s12-revoke で配信。GOOGLE_CLIENT_ID と S12 セッションをメモリ上で差し込む。項目6 手順5（運営者 B の失効）の専用画面。B のトークンを未使用のまま保持し、A の認可で失効を送り、新しい B と保持した失効前トークンの提示拒否（not_operator）と C の提示成功を確認する。送信はブラウザーから直接行わない。検証モジュール tools/s12-revoke.mjs は Node 試験 test/s12-revoke.test.mjs と共用する。送信は提供サーバー側の tools/s12-sender.mjs（Node）が行う。名前付きスロット（heldB / revokeA / freshB / checkC）ごとに Cookie jar を分け、保持トークンの鮮度を失効の送信前に機械確認する。送信器の試験は test/s12-sender.test.mjs、実 Worker との結線は test/s12-guard.test.mjs、画面の実画面試験は test/s12-revoke.screen.mjs）",
    s13_revoke_page: "public/s13-revoke.html（tools/serve-real.mjs が /s13-revoke で配信。GOOGLE_CLIENT_ID と S13 セッションをメモリ上で差し込む。項目6 手順6（最後の運営者の保護）の専用画面。対象 C の主体ハッシュを取得し、A の認可で C の失効を送り（generation 5→6・登録簿 {A}）、A 自身の失効試行が 409 last_operator で拒否されること（この拒否が合格。状態は変わらない）と A の提示成功を確認する。順序は状態機械が強制し、手順2は手順1が期待どおり終わるまで、手順3は手順2の結果が記録されるまで始められない。送信はブラウザーから直接行わない。検証モジュール tools/s13-revoke.mjs は Node 試験 test/s13-revoke.test.mjs と共用する。送信は提供サーバー側の tools/s13-sender.mjs（Node）が行う。名前付きスロット（revokeC / revokeA / checkA）ごとに Cookie jar を分け、失効の対象は手順ごとに送信器の境界でも結び付け、期待世代はスロットごとに固定する（revokeC = 5、revokeA = 6）。対象取得の nonce は画面が /nonce から直接取得する。送信器の試験は test/s13-sender.test.mjs、実 Worker との結線は test/s13-guard.test.mjs、画面の実画面試験は test/s13-revoke.screen.mjs）",
    s14_rotate_page: "public/s14-rotate.html（tools/serve-real.mjs が /s14-rotate で配信。GOOGLE_CLIENT_ID と S14 セッションをメモリ上で差し込む。項目6 手順7（ローテーション A→B）の専用画面。対象 A・B の主体ハッシュを取得し、A の認可でローテーションを送り（generation 6→7・登録簿 {A}→{B}。削除と追加は同一トランザクション）、A の次回操作が 403 not_operator で拒否されること（この拒否が合格。状態は変わらない）と B の提示成功を確認する。順序は状態機械が強制し、手順2は手順1が期待どおり終わるまで、手順3は手順2の結果が記録されるまで始められない。送信はブラウザーから直接行わない。検証モジュール tools/s14-rotate.mjs は Node 試験 test/s14-rotate.test.mjs と共用する。送信は提供サーバー側の tools/s14-sender.mjs（Node）が行う。名前付きスロット（rotateAB / checkA / checkB）ごとに Cookie jar を分け、ローテーションの対象は旧主体・新主体の組で送信器の境界でも結び付け、期待世代は固定する（rotateAB = 6）。対象取得の nonce は画面が /nonce から直接取得する。送信器の試験は test/s14-sender.test.mjs、実 Worker との結線は test/s14-guard.test.mjs、画面の実画面試験は test/s14-rotate.screen.mjs）",
    serve: "tools/serve-real.mjs（127.0.0.1 のみバインド。RELAY_URL はループバック＋ポート明示のみ許可）",
    s15_driver: "tools/s15-driver.mjs（S15 の PC 側運転コード。tools/serve-real.mjs を同一プロセスで生成し、S15 入口の試験単位セッションを createRealServer の戻り値としてメモリー内だけで受け取り、x-s15-session ヘッダーで示す。値はログ・URL・応答・ファイルに出ない。S15 専用画面は設けない）",
  },
  source_checks: checks,
};

console.log(JSON.stringify(manifest, null, 2));
