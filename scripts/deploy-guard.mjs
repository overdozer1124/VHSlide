import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const canonicalBranch = "codex/single-activity-entry-0.70.1";

export function parseVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw Error(`不正なバージョン: ${value}`);
  return value.split(".").map(Number);
}

export function assertNewer(local, deployed) {
  const a = parseVersion(local),
    b = parseVersion(deployed);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return;
    if (a[i] < b[i]) break;
  }
  throw Error(`公開予定 ${local} は本番 ${deployed} より新しくありません。`);
}

export function deployedVersion(payload) {
  if (!payload.success || !Array.isArray(payload.result?.deployments))
    throw Error("Cloudflareの本番デプロイ情報を取得できません。 ");
  const deployment = payload.result.deployments[0];
  if (
    !deployment ||
    deployment.versions?.length !== 1 ||
    deployment.versions[0].percentage !== 100
  )
    throw Error("本番が単一バージョンでないため確認できません。");
  const message = deployment.annotations?.["workers/message"];
  const match =
    typeof message === "string" &&
    /^Deploy (\d+\.\d+\.\d+)(?:\s|:|$)/.exec(message);
  if (!match) throw Error("本番バージョンをデプロイ情報から特定できません。");
  const commit = /^Deploy \d+\.\d+\.\d+: ([0-9a-f]{40})$/.exec(message)?.[1];
  return {
    version: match[1],
    id: deployment.id,
    ...(commit ? { commit } : {}),
  };
}

export function assertKnownRelease(history, version) {
  parseVersion(version);
  if (!history.includes(`version: "${version}"`))
    throw Error(
      `本番 ${version} の更新履歴が正本にありません。本番の変更を統合してください。`,
    );
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", timeout: 30000 }).trim();
}

export async function checkDeployment() {
  if (git("branch", "--show-current") !== canonicalBranch)
    throw Error(`本番への公開は正本 ${canonicalBranch} からのみ可能です。`);
  if (git("status", "--porcelain", "--untracked-files=normal"))
    throw Error(
      "未コミットの変更があります。正本にコミットしてから公開してください。",
    );
  const head = git("rev-parse", "HEAD");
  const remote = git(
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${canonicalBranch}`,
  ).split(/\s/)[0];
  if (!remote || head !== remote)
    throw Error(
      "ローカルの正本がリモートの最新コミットと一致しません。取得・統合・プッシュしてから再実行してください。",
    );
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  if (
    pkg.version !== lock.version ||
    pkg.version !== lock.packages?.[""].version
  )
    throw Error(
      "package.json と package-lock.json のバージョンが一致しません。",
    );
  parseVersion(pkg.version);
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } =
    process.env;
  if (!token || !account)
    throw Error("Cloudflareの公開状態を確認するための認証情報がありません。");
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/vhslide/deployments`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(
      `Cloudflareの公開状態を確認できません (HTTP ${response.status})。`,
    );
  const current = deployedVersion(await response.json());
  assertKnownRelease(
    readFileSync("src/releaseHistory.ts", "utf8"),
    current.version,
  );
  if (current.commit) {
    try {
      git("merge-base", "--is-ancestor", current.commit, head);
    } catch {
      throw Error(
        "本番に公開したコミットが正本の履歴にありません。本番の変更を統合してください。",
      );
    }
  }
  assertNewer(pkg.version, current.version);
  return { head, version: pkg.version, current };
}
