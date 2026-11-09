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
  "test/clean-boot.test.mjs",
  "test/teardown-helper.mjs",
  "test/clean-boot-teardown.test.mjs",
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
const cleanBootLines = readRel("test/clean-boot.test.mjs").split("\n");
const teardownHelperLines = readRel("test/teardown-helper.mjs").split("\n");
const teardownTestLines = readRel("test/clean-boot-teardown.test.mjs").split("\n");

// 行番号を返す（見つからなければ -1）。終了順序の構造検査で使う。
function firstLineIndex(lines, re) {
  return lines.findIndex((l) => re.test(l));
}

const checks = {
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
  // クリーン起動試験の終了処理は、子プロセスの終了待ちと中継の
  // 閉鎖待ちを await し、その後でミラーを削除すること。
  clean_boot_waits_child_exit: {
    found: findLines(cleanBootLines, /await stopChild\(child\)/),
    expect: "present",
  },
  clean_boot_waits_relay_close: {
    found: findLines(cleanBootLines, /await closeServer\(relay\)/),
    expect: "present",
  },
  // 終了順序の構造検査：after() 内で stopChild → closeServer → rm
  // の順に行番号が並ぶこと。Windows では子プロセスがミラー内の
  // ファイルを開いたまま削除すると EBUSY になるため、削除は必ず
  // 子プロセスの終了確認の後でなければならない。
  clean_boot_teardown_order: {
    found: (() => {
      const iStop = firstLineIndex(cleanBootLines, /await stopChild\(child\)/);
      const iClose = firstLineIndex(cleanBootLines, /await closeServer\(relay\)/);
      const iRm = firstLineIndex(cleanBootLines, /await rm\(mirrorDir/);
      return iStop !== -1 && iClose !== -1 && iRm !== -1 && iStop < iClose && iClose < iRm
        ? [{ line: 0, text: "stopChild < closeServer < rm" }]
        : [];
    })(),
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
    serve: "tools/serve-real.mjs（127.0.0.1 のみバインド。RELAY_URL はループバック＋ポート明示のみ許可）",
  },
  source_checks: checks,
};

console.log(JSON.stringify(manifest, null, 2));
