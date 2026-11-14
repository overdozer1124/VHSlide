// クリーン起動試験：クリーンなチェックアウトだけで serve-real が起動し、
// 全画面が 200 を返すことを確認する（Codex レビュー 6734640413 の指摘1）。
// 実行: node --test test/clean-boot.test.mjs
// （npm test にも組み込んである）
//
// 方法：ミラー対象ファイルだけを一時ディレクトリへ複写し、ダミーの
// GOOGLE_CLIENT_ID で serve-real.mjs を起動して、各経路が 200 を返す
// ことを確認する。ミラーには .persist-*・node_modules・ローカル専用
// ファイルを含めない。serve-real.mjs の起動・配信が個別環境の未追跡
// ファイルに依存していれば、この試験は起動不能（ENOENT）または 404
// で失敗する。実 Google・実 Worker とは通信しない。秘密の値は使わない
// （GOOGLE_CLIENT_ID・RELAY_URL はダミー値）。
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { teardownAndRemove } from "./teardown-helper.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE_PORT = 8896;
const CLIENT_ID = "clean-boot-client-id.apps.googleusercontent.com";

// ミラー対象：serve-real.mjs の起動・配信に必要なファイルだけ。
// serve-real.mjs が起動時に読むのは public/*.html と tools/*.mjs
// （s5-sender.mjs が import する tools 配下を含む）であり、src・
// test・node_modules・.persist-* は読まない。
const MIRROR_FILES = [
  "tools/serve-real.mjs",
  "tools/s5-sender.mjs",
  "tools/s5-apply.mjs",
  "tools/s9-negative.mjs",
  "tools/s10-add.mjs",
  "tools/s11-sender.mjs",
  "tools/s11-parallel.mjs",
  "tools/s12-sender.mjs",
  "tools/s12-revoke.mjs",
  "tools/s13-sender.mjs",
  "tools/s13-revoke.mjs",
  "tools/s14-sender.mjs",
  "tools/s14-rotate.mjs",
  "tools/trial-apply.mjs",
  "tools/subject-hash-verify.mjs",
  "public/login-real.html",
  "public/subject-hash.html",
  "public/trial-apply.html",
  "public/s5-apply.html",
  "public/s9-negative.html",
  "public/s10-add-operator.html",
  "public/s11-parallel.html",
  "public/s12-revoke.html",
  "public/s13-revoke.html",
  "public/s14-rotate.html",
];

// 一時ディレクトリへミラー対象だけを複写する。親ディレクトリも作る。
const mirrorDir = await mkdtemp(path.join(tmpdir(), "vhslide-clean-boot-"));
for (const rel of MIRROR_FILES) {
  const dest = path.join(mirrorDir, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(path.join(ROOT, rel), dest);
}

// ミラー内の全ファイルを相対パスで列挙する。
async function listMirror(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listMirror(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

// 偽の中継。画面の配信には使わないが、serve-real の起動に RELAY_URL
// が必要であり、/nonce 等の転送先として用意する。この試験では転送
// 経路を呼ばない。
const relay = http.createServer((req, res) => {
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
const relayPort = relay.address().port;

const child = spawn("node", [path.join(mirrorDir, "tools", "serve-real.mjs")], {
  cwd: mirrorDir,
  env: {
    ...process.env,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    RELAY_URL: `http://127.0.0.1:${relayPort}`,
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

test("クリーン起動：ミラーには対象ファイルだけが含まれ、未追跡ファイルに依存しない", async () => {
  const listed = await listMirror(mirrorDir);
  assert.deepEqual(listed, [...MIRROR_FILES].sort());
  // node_modules・.persist-* がミラーに含まれないこと。
  assert.equal(listed.some((f) => f.includes("node_modules")), false);
  assert.equal(listed.some((f) => f.includes(".persist-")), false);
});

test("クリーン起動：ミラーだけで serve-real が起動する", async () => {
  const ready = await waitReady();
  assert.equal(ready, true, `serve-real が起動しませんでした: ${childLog.slice(-400)}`);
});

// ログイン画面は / で配信される（/login-real という経路はない）。
// 200 を返す経路の一覧は、実画面試験・経路試験と同じ範囲である。
const PAGE_ROUTES = [
  { path: "/", marker: "accounts.google.com/gsi/client" },
  { path: "/subject-hash", marker: "subject-hash" },
  { path: "/trial-apply", marker: "/platform/apply" },
  { path: "/s5-apply", marker: "s5-apply" },
  { path: "/s9-negative", marker: "/admin/verify-only" },
];

test("クリーン起動：全画面が 200 を返し、クライアント ID が差し込まれる", async () => {
  assert.equal(await waitReady(), true, `serve-real が起動しませんでした: ${childLog.slice(-400)}`);
  for (const route of PAGE_ROUTES) {
    const r = await fetch(base + route.path);
    assert.equal(r.status, 200, `${route.path} が ${r.status} を返した`);
    assert.match(r.headers.get("content-type"), /text\/html/);
    const body = await r.text();
    assert.equal(body.includes("REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID"), false);
    assert.equal(body.includes(CLIENT_ID), true);
    assert.equal(body.includes(route.marker), true, `${route.path} に目印が見つからない`);
  }
});

test("クリーン起動：検証モジュールが 200 を返す", async () => {
  assert.equal(await waitReady(), true, `serve-real が起動しませんでした: ${childLog.slice(-400)}`);
  for (const mod of ["/s9-negative.mjs", "/trial-apply.mjs", "/s5-apply.mjs", "/subject-hash-verify.mjs"]) {
    const r = await fetch(base + mod);
    assert.equal(r.status, 200, `${mod} が ${r.status} を返した`);
    assert.match(r.headers.get("content-type"), /javascript/);
  }
  const s9 = await (await fetch(base + "/s9-negative.mjs")).text();
  assert.equal(s9.includes("beginNonceFetch"), true);
  assert.equal(s9.includes("finishNonceFetch"), true);
});

test("クリーン起動：未知のパスは 404 になる", async () => {
  assert.equal(await waitReady(), true, `serve-real が起動しませんでした: ${childLog.slice(-400)}`);
  const r = await fetch(base + "/no-such-page");
  assert.equal(r.status, 404);
});

after(async () => {
  // 終了順序：子プロセスの終了待ち → 中継サーバーの閉鎖待ち →
  // 両方の確認が取れた場合のみミラー（mirrorDir）を削除する。
  // Windows では子プロセスがミラー内のファイルを開いたまま削除
  // すると EBUSY になるため、削除は必ず終了確認の後で行う
  // （Codex レビュー 6737085464 への対応）。さらに、終了を確認
  // できなかった場合（kill-timeout・kill-failed・error・
  // close-timeout）は削除せず、失敗として報告する（Codex
  // レビュー 6754717703 への対応）。対象以外は削除しない。
  // 待ち時間は上限付きで無限待ちにならない。
  const result = await teardownAndRemove({ child, server: relay, dir: mirrorDir });
  if (!result.removed) {
    throw new Error(
      `終了を確認できなかったためミラーを削除しませんでした（stop=${result.stopResult}, close=${result.closeResult}）`
    );
  }
});
