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
  "public/login-real.html",
  "tools/serve-real.mjs",
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
const loginLines = readRel("public/login-real.html").split("\n");

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
  login_page_placeholder: {
    found: findLines(loginLines, /REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID/),
    expect: "present",
  },
  login_page_gis: {
    found: findLines(loginLines, /accounts\.google\.com\/gsi\/client/),
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
];
const mustNotBeSet = [
  { name: "MOCK_AUTH", reason: "tier=verify では設定検証が全経路を拒否する" },
  { name: "ALLOW_TEST_HOOKS", reason: "tier=verify では設定検証が全経路を拒否する。故障の注入はフックではなく故障版ビルドで行う" },
  { name: "TOKENINFO_URL", reason: "tier=verify では設定検証が全経路を拒否し、既定の Google tokeninfo だけを使う" },
  { name: "DIAG_KEY", reason: "診断読み取りは local-mock＋フック有効時のみ。実環境の読み戻しはプラットフォーム経路（Data Studio 等）で行う" },
];

const manifest = {
  generated_by: "tools/build-realenv-manifest.mjs",
  generated_for: "段階①フェーズ2 先行検証 実環境試験（手順書 v0.2）",
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
  },
  pc_side: {
    login_page: "public/login-real.html（tools/serve-real.mjs が GOOGLE_CLIENT_ID をメモリ上で差し込んで配信する）",
    serve: "tools/serve-real.mjs（127.0.0.1 のみバインド。RELAY_URL はループバック＋ポート明示のみ許可）",
  },
  source_checks: checks,
};

console.log(JSON.stringify(manifest, null, 2));
