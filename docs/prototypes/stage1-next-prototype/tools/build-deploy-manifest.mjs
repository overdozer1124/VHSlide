// 配置用マニフェストの生成（VHSlide 段階①フェーズ1 次期試作ハーネス）。
//
// 使い方:
//   node tools/build-deploy-manifest.mjs --tier verify
//
// - 対象形態（--tier）を明示した場合にだけ、配置に使うバインディングの
//   一覧を JSON で標準出力へ出す。未指定・verify 以外はエラーで終了する
//   （形態の取り違えを防ぐため、既定値では生成しない）。
// - シークレットと環境固有の設定は「名前と種別」だけを列挙し、値は含めない。
//   実際の値は PC 側で設定する。
// - あわせて src/worker.js のソースを静的に検査し、配置防護の根拠を
//   マニフェストに含める:
//   1) tier の既定値フォールバック（未設定を local-mock に読み替える
//      仕組み）が残っていないこと
//   2) MOCK_AUTH の分岐が tier=verify では到達不能である根拠
//      （validateConfig が入口で verify + MOCK_AUTH を拒否する箇所）
//   検査で問題が見つかればマニフェストを出さず、終了コード 1 で終わる。
//
// このスクリプト自体はデプロイを行わない。生成された一覧を見て、
// 配置する側が対象（検証用 Worker）とバインディングを照合するための資料。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = path.join(root, "src", "worker.js");

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

// ---------- ソース検査 ----------
const source = readFileSync(workerPath, "utf8");
const lines = source.split("\n");
function findLines(re) {
  const out = [];
  lines.forEach((line, i) => {
    if (re.test(line)) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}

// 1) tier の既定値フォールバックが残っていないこと。
//    検出対象: `DEPLOYMENT_TIER || ...`、`|| "local-mock"` の読み替え、
//    tier を返すヘルパー関数の定義。
const fallbackPatterns = [
  { pattern: String.raw`DEPLOYMENT_TIER\s*\|\|`, re: /DEPLOYMENT_TIER\s*\|\|/ },
  { pattern: String.raw`\|\|\s*"local-mock"`, re: /\|\|\s*"local-mock"/ },
  { pattern: "function deploymentTier", re: /function\s+deploymentTier\b/ },
];
const fallbackFindings = fallbackPatterns.map(({ pattern, re }) => ({
  pattern,
  matched_lines: findLines(re),
}));

// 2) MOCK 分岐が tier=verify では到達不能である根拠。
//    - validateConfig が verify 形態での MOCK_AUTH / ALLOW_TEST_HOOKS /
//      TOKENINFO_URL 上書きを config_refused にする箇所
//    - validateConfig が Worker 本体と DO の双方の入口で呼ばれる箇所
//    - 拒否をすり抜けた場合でも MOCK 分岐が env.MOCK_AUTH を条件とする箇所
const guardFindings = {
  verify_rejects_mock_auth: findLines(/config_mock_in_verify/),
  verify_rejects_test_hooks: findLines(/config_hooks_in_verify/),
  verify_rejects_tokeninfo_override: findLines(/config_tokeninfo_override_in_verify/),
  config_gate_call_sites: findLines(/validateConfig\(/),
  mock_branch_condition: findLines(/env\.MOCK_AUTH === "1"/),
};

const problems = [];
for (const f of fallbackFindings) {
  if (f.matched_lines.length) {
    problems.push(
      `tier の既定値フォールバックらしき記述が残っています: ${f.pattern} -> ${f.matched_lines
        .map((m) => `L${m.line}`)
        .join(", ")}`
    );
  }
}
if (!guardFindings.verify_rejects_mock_auth.length) {
  problems.push("verify 形態で MOCK_AUTH を拒否する箇所（config_mock_in_verify）が見つかりません");
}
if (guardFindings.config_gate_call_sites.length < 3) {
  // 定義1箇所＋Worker 本体＋DO の入口の計3箇所以上を期待する。
  problems.push(
    `validateConfig の呼び出し箇所が不足しています（${guardFindings.config_gate_call_sites.length} 箇所）`
  );
}
if (problems.length) {
  console.error("error: ソース検査で問題が見つかったため、マニフェストを生成しません");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

// ---------- マニフェスト ----------
const manifest = {
  generated_by: "tools/build-deploy-manifest.mjs",
  target: {
    worker_name: "vhslide-stage1-verify-20261101-a",
    do_namespace_id: "ef29957c85744eccaea6db64af433868",
    do_binding: "VERIFY_ONLY",
    do_class: "VerificationDO",
    note: "配置前に対象（アカウント・Worker 名・名前空間 ID）を照合すること（計画 手順0）",
  },
  bindings: [
    {
      name: "DEPLOYMENT_TIER",
      kind: "plain_text",
      value: "verify",
      note: "明示指定が必須。未設定・空・想定外はハーネス側が全経路を拒否する",
    },
    {
      name: "ENV_ID",
      kind: "plain_text",
      value: "<set-on-pc: stage1-verification-only-20261101>",
      note: "値はここに含めない。完了・復旧記録の対象環境識別子。未設定はハーネス側が拒否する",
    },
    {
      name: "GOOGLE_CLIENT_ID",
      kind: "plain_text",
      value: "<set-on-pc: verification OAuth client id>",
      note: "値はここに含めない。aud 照合の基準。未設定はハーネス側が全経路を拒否する",
    },
    {
      name: "INSTANCE_NAME",
      kind: "plain_text",
      value: "stage1-verification-only-20261101",
      note: "DO インスタンス名（対象照合の要素）",
    },
    { name: "BOOTSTRAP_SECRET", kind: "secret", note: "値は含めない。PC 側で生成し Wrangler から設定する" },
    { name: "RECOVERY_KEY", kind: "secret", note: "値は含めない。PC 側で生成し Wrangler から設定する。Muse は保持しない" },
  ],
  must_not_be_set: [
    { name: "MOCK_AUTH", reason: "tier=verify では設定検証が全経路を拒否する" },
    { name: "ALLOW_TEST_HOOKS", reason: "tier=verify では設定検証が全経路を拒否する" },
    { name: "TOKENINFO_URL", reason: "tier=verify では設定検証が全経路を拒否し、既定の Google tokeninfo だけを使う" },
    { name: "DIAG_KEY", reason: "診断経路は tier=verify では無効（鍵があっても 404）" },
    { name: "RESTART_KEY", reason: "再起動フックは tier=verify では無効（鍵があっても 404）" },
  ],
  source_checks: {
    worker_js: "src/worker.js",
    tier_default_fallback_absent: fallbackFindings,
    mock_branch_unreachable_in_verify: guardFindings,
    note: "設定の値だけで環境を独立証明したことにはならない。対象の独立照合（手順0）と、配置後のカナリア確認（模擬形式トークンが拒否されること）を併せて行う",
  },
};

console.log(JSON.stringify(manifest, null, 2));
