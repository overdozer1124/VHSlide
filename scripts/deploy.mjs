import { spawnSync } from "node:child_process";
import { checkDeployment } from "./deploy-guard.mjs";

// Node reads this setting on startup. Restart so Cloudflare is reachable in
// managed environments using an HTTP proxy; direct connections work too.
if (process.env.NODE_USE_ENV_PROXY !== "1") {
  const child = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(child.status ?? 1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw Error(`${command} が失敗しました。`);
}

try {
  const before = await checkDeployment();
  console.log(
    `デプロイ検査: ${before.current.version} → ${before.version} (${before.head.slice(0, 8)})`,
  );
  if (!process.argv.includes("--check")) {
    run("npm", ["run", "build"]);
    run("npx", ["tsc", "-p", "tsconfig.cloudflare.json"]);
    const after = await checkDeployment();
    if (before.head !== after.head || before.current.id !== after.current.id)
      throw Error(
        "ビルド中に正本または本番が更新されました。もう一度確認してください。",
      );
    run("npx", [
      "wrangler",
      "deploy",
      "--name",
      "vhslide",
      "--message",
      `Deploy ${after.version}: ${after.head}`,
    ]);
  }
} catch (error) {
  console.error(`デプロイを中止しました: ${error.message}`);
  process.exitCode = 1;
}
