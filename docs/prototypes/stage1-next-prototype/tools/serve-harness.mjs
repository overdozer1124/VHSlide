// ハーネスを固定ポートで起動する手動確認用ランチャー（ローカル模擬）。
//
// 使い方:
//   node tools/serve-harness.mjs     # http://127.0.0.1:8799 で待ち受け
// そのうえで別ターミナルで:
//   node tools/serve-login.mjs       # ログイン画面 http://localhost:8787/
//
// 永続化先は .persist-manual/（再起動で状態が残ることの目視確認にも使える）。
// Ctrl+C で終了。

import { Miniflare } from "miniflare";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || "8799");

const mf = new Miniflare({
  modules: true,
  scriptPath: path.join(root, "src", "worker.js"),
  compatibilityDate: "2025-01-01",
  host: "127.0.0.1",
  port: PORT,
  durableObjects: {
    VERIFY_ONLY: { className: "VerificationDO", useSQLite: true },
  },
  durableObjectsPersist: path.join(root, ".persist-manual"),
  bindings: {
    BOOTSTRAP_SECRET: "test-bootstrap-secret",
    RECOVERY_KEY: "test-recovery-key",
    RESTART_KEY: "test-restart-key",
    MOCK_AUTH: "1",
    ALLOW_TEST_HOOKS: "1",
    ENV_ID: "stage1-verification-only-20261101",
  },
});

const url = await mf.ready;
console.log(`harness: ${url}  (Ctrl+C で終了)`);
