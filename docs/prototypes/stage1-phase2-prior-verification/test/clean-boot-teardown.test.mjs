// 終了順序試験：clean-boot.test.mjs の after() と同じ手順
// （kill → 子プロセスの exit → 中継の閉鎖完了 → rm）がその順序で
// 起きることを、イベントの記録と照合で確認する（Codex レビュー
// 6737085464 への対応）。Linux では EBUSY は再現しないため、順序
// そのものを検証する。実 Google・実 Worker とは通信しない。
// 秘密は使わない（子プロセスはダミーの待機プロセス）。
//
// 実行: node --test test/clean-boot-teardown.test.mjs
// （npm test にも組み込んである）
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeServer, stopChild } from "./teardown-helper.mjs";

// シグナルで終了した子プロセスは exitCode が null、signalCode が
// シグナル名になる。終了の判定は両方を見る。
function isDead(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

// 待機だけするダミーの子プロセス。SIGTERM で通常終了する。
function spawnWaiter() {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
    stdio: "ignore",
  });
}

// SIGTERM を無視するダミーの子プロセス。SIGKILL でのみ終了する。
// 起動直後に SIGTERM を送るとハンドラの登録前に届いて既定動作で
// 終了してしまうため、ハンドラ登録後に "ready" を標準出力へ出し、
// 呼び出し元はそれを待ってから SIGTERM を送る。
function spawnSigtermIgnorer() {
  return spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);"],
    { stdio: ["ignore", "pipe", "ignore"] }
  );
}

// 子プロセスの "ready" 出力を待つ（SIGTERM 無視の準備完了）。
async function waitReady(child) {
  if (child.stdout) {
    await new Promise((resolve) => child.stdout.once("data", resolve));
  }
}

async function startRelay() {
  const relay = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  await new Promise((resolve) => relay.listen(0, "127.0.0.1", resolve));
  return relay;
}

test("終了順序：kill → 子プロセス exit → 中継の閉鎖完了 → rm の順に起きる", async () => {
  const events = [];
  const dir = await mkdtemp(path.join(tmpdir(), "vhslide-teardown-order-"));
  // 対象外のディレクトリ。終了処理で削除されてはならない。
  const sibling = await mkdtemp(path.join(tmpdir(), "vhslide-teardown-sibling-"));
  await writeFile(path.join(dir, "probe.txt"), "probe");
  await writeFile(path.join(sibling, "keep.txt"), "keep");
  const relay = await startRelay();
  const child = spawnWaiter();
  // exit イベント自体を記録する（stopChild の復帰とは別の観測）。
  child.once("exit", () => events.push("child-exit"));
  try {
    events.push("kill-sent");
    const stopResult = await stopChild(child);
    assert.equal(stopResult, "exited");
    // stopChild の復帰時点で子プロセスが実際に終了していること。
    assert.equal(isDead(child), true, "子プロセスの終了を待ってから次へ進むこと");
    const closeResult = await closeServer(relay);
    events.push("relay-closed");
    assert.equal(closeResult, "closed");
    assert.equal(relay.listening, false, "中継の閉鎖完了を待ってから次へ進むこと");
    await rm(dir, { recursive: true, force: true });
    events.push("rm-done");

    assert.deepEqual(events, ["kill-sent", "child-exit", "relay-closed", "rm-done"]);
    await assert.rejects(access(dir), /ENOENT/, "対象ディレクトリが削除されること");
    // 対象以外は削除されないこと。
    await access(path.join(sibling, "keep.txt"));
  } finally {
    // 失敗時も後片付けする（子プロセスが残っていれば強制終了）。
    if (!isDead(child)) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* 既に終了 */
      }
    }
    if (relay.listening) closeServer(relay);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await rm(sibling, { recursive: true, force: true }).catch(() => {});
  }
});

test("SIGTERM を無視する子プロセスはタイムアウト後に SIGKILL で終了し、無限待ちにならない", async () => {
  const child = spawnSigtermIgnorer();
  try {
    await waitReady(child);
    const started = Date.now();
    const result = await stopChild(child, { exitTimeoutMs: 200, killTimeoutMs: 2000 });
    const elapsed = Date.now() - started;
    assert.equal(result, "killed");
    assert.equal(child.signalCode, "SIGKILL", "SIGKILL で子プロセスが終了すること");
    assert.ok(elapsed >= 200, `SIGTERM の待ち時間を経てから SIGKILL すること（実測 ${elapsed}ms）`);
    assert.ok(elapsed < 5000, `無限待ちにならないこと（実測 ${elapsed}ms）`);
  } finally {
    if (!isDead(child)) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* 既に終了 */
      }
    }
  }
});

test("子プロセスが存在しない・既に終了している場合も先へ進める", async () => {
  assert.equal(await stopChild(null), "no-child");
  assert.equal(await stopChild(undefined), "no-child");
  const child = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(await stopChild(child), "already-exited");
  assert.equal(await closeServer(null), "no-server");
  const relay = await startRelay();
  assert.equal(await closeServer(relay), "closed");
  assert.equal(await closeServer(relay), "already-closed");
});

test("中継の閉鎖待ちは keep-alive 接続が残っても所定時間内に終わる", async () => {
  const relay = await startRelay();
  const port = relay.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(r.status, 200);
  await r.text();
  // fetch の keep-alive 接続が残った状態で閉鎖する。
  const started = Date.now();
  const result = await closeServer(relay);
  const elapsed = Date.now() - started;
  assert.equal(result, "closed");
  assert.ok(elapsed < 5000, `閉鎖待ちが所定時間内に終わること（実測 ${elapsed}ms）`);
  assert.equal(relay.listening, false);
});

test("子プロセスの終了待ちの上限は既定で 5 秒である", async () => {
  // 既定値の確認：SIGTERM を無視する子プロセスで、既定の待ち時間
  // （5秒）を経て SIGKILL されることを、経過時間で確認する。
  // 遅い試験のため上限の確認だけに留め、実測は 4.5〜10 秒の範囲とする。
  const { CHILD_EXIT_TIMEOUT_MS, CHILD_KILL_TIMEOUT_MS } = await import(
    "./teardown-helper.mjs"
  );
  assert.equal(CHILD_EXIT_TIMEOUT_MS, 5000);
  assert.equal(CHILD_KILL_TIMEOUT_MS, 5000);
  const child = spawnSigtermIgnorer();
  try {
    await waitReady(child);
    const started = Date.now();
    const result = await stopChild(child);
    const elapsed = Date.now() - started;
    assert.equal(result, "killed");
    assert.equal(child.signalCode, "SIGKILL", "SIGKILL で子プロセスが終了すること");
    assert.ok(elapsed >= 4500, `既定の待ち時間（5秒）を経てから SIGKILL すること（実測 ${elapsed}ms）`);
    assert.ok(elapsed < 10000, `SIGKILL 後の待ちも上限付きであること（実測 ${elapsed}ms）`);
  } finally {
    if (!isDead(child)) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* 既に終了 */
      }
    }
  }
});
