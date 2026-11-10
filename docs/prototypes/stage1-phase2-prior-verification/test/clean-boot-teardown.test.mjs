// 終了順序試験：clean-boot.test.mjs の after() と同じ手順
// （kill → 子プロセスの exit → 中継の閉鎖完了 → rm）がその順序で
// 起きることを、イベントの記録と照合で確認する（Codex レビュー
// 6737085464 への対応）。Linux では EBUSY は再現しないため、順序
// そのものを検証する。実 Google・実 Worker とは通信しない。
// 秘密は使わない（子プロセスはダミーの待機プロセス）。
//
// Codex レビュー 6754717703 への対応で、試験を3つに分けた。
// (1) 実プロセスの挙動：プラットフォームで分ける。Windows には
// POSIX のシグナルハンドラ前提がなく、SIGTERM を無視する子でも
// kill("SIGTERM") でプロセス自体が終了する（戻り値は "exited"）。
// (2) 分岐の検証：SIGTERM 無視 → タイムアウト → SIGKILL 等の
// 分岐は、モックの子プロセスでプラットフォームに依らず検証する。
// (3) 削除の条件：終了・閉鎖を確認できない場合は対象を削除せず
// 失敗として返すこと（teardownAndRemove）を検証する。
//
// 実行: node --test test/clean-boot-teardown.test.mjs
// （npm test にも組み込んである）
//
// 終了コード: 全項目 PASS なら 0、FAIL があれば 1。

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  closeServer,
  stopChild,
  teardownAndRemove,
  CHILD_STOP_CONFIRMED,
  SERVER_CLOSE_CONFIRMED,
} from "./teardown-helper.mjs";

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

test("SIGTERM を無視する子プロセス：POSIX ではタイムアウト後に SIGKILL で終了し、Windows では SIGTERM で終了する", async () => {
  const child = spawnSigtermIgnorer();
  try {
    await waitReady(child);
    const started = Date.now();
    const result = await stopChild(child, { exitTimeoutMs: 200, killTimeoutMs: 2000 });
    const elapsed = Date.now() - started;
    if (process.platform === "win32") {
      // Windows には POSIX のシグナルハンドラ前提がなく、
      // kill("SIGTERM") でプロセス自体が終了する（無視できない）。
      // そのため戻り値は "killed" ではなく "exited" になる。
      // SIGTERM 無視 → タイムアウト → SIGKILL の分岐そのものは、
      // モックの試験（プラットフォーム非依存）で検証する。
      assert.equal(result, "exited");
      assert.equal(isDead(child), true, "子プロセスが終了していること");
    } else {
      assert.equal(result, "killed");
      assert.equal(child.signalCode, "SIGKILL", "SIGKILL で子プロセスが終了すること");
      assert.ok(elapsed >= 200, `SIGTERM の待ち時間を経てから SIGKILL すること（実測 ${elapsed}ms）`);
    }
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
    if (process.platform === "win32") {
      // Windows では SIGTERM で即座に終了するため、既定の待ち
      // 時間（5秒）は経過しない。既定値そのものは上の定数で
      // 確認し、待ち時間 → SIGKILL の分岐はモックの試験で
      // 検証する。
      assert.equal(result, "exited");
      assert.ok(elapsed < 5000, `SIGTERM で終了し、既定の待ち時間を経過しないこと（実測 ${elapsed}ms）`);
    } else {
      assert.equal(result, "killed");
      assert.equal(child.signalCode, "SIGKILL", "SIGKILL で子プロセスが終了すること");
      assert.ok(elapsed >= 4500, `既定の待ち時間（5秒）を経てから SIGKILL すること（実測 ${elapsed}ms）`);
      assert.ok(elapsed < 10000, `SIGKILL 後の待ちも上限付きであること（実測 ${elapsed}ms）`);
    }
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

// ---- モックによる分岐検証（プラットフォーム非依存） ----
//
// 実プロセスでは再現できない分岐（SIGTERM 無視・SIGKILL 後も
// 終了しない・kill の失敗）を、モックの子プロセスで検証する。
// exit / error の通知は、stopChild がリスナを付けた後に届くよう
// 非同期（setImmediate）にする。
function mockChild(onKill) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
    return onKill(child, signal);
  };
  return child;
}

function emitExit(child, signal) {
  child.signalCode = signal;
  setImmediate(() => child.emit("exit", null, signal));
}

test("モック：SIGTERM を無視する子は SIGKILL で終了し、送信順序は SIGTERM → SIGKILL である", async () => {
  const child = mockChild((c, signal) => {
    if (signal === "SIGKILL") emitExit(c, "SIGKILL");
    return true;
  });
  const result = await stopChild(child, { exitTimeoutMs: 30, killTimeoutMs: 1000 });
  assert.equal(result, "killed");
  assert.deepEqual(child.killCalls, ["SIGTERM", "SIGKILL"]);
});

test("モック：SIGTERM で終了する子には SIGKILL を送らず exited を返す", async () => {
  const child = mockChild((c, signal) => {
    if (signal === "SIGTERM") emitExit(c, "SIGTERM");
    return true;
  });
  const result = await stopChild(child, { exitTimeoutMs: 1000, killTimeoutMs: 1000 });
  assert.equal(result, "exited");
  assert.deepEqual(child.killCalls, ["SIGTERM"]);
});

test("モック：SIGKILL 後も終了しない子は kill-timeout を返す", async () => {
  const child = mockChild(() => true);
  const result = await stopChild(child, { exitTimeoutMs: 30, killTimeoutMs: 30 });
  assert.equal(result, "kill-timeout");
  assert.deepEqual(child.killCalls, ["SIGTERM", "SIGKILL"]);
});

test("モック：SIGTERM を送れない場合は kill-failed を返す", async () => {
  const child = mockChild(() => false);
  const result = await stopChild(child, { exitTimeoutMs: 30, killTimeoutMs: 30 });
  assert.equal(result, "kill-failed");
  assert.deepEqual(child.killCalls, ["SIGTERM"]);
});

test("モック：error で終わる子は error を返す", async () => {
  const child = mockChild((c) => {
    setImmediate(() => c.emit("error", new Error("mock error")));
    return true;
  });
  const result = await stopChild(child, { exitTimeoutMs: 1000, killTimeoutMs: 1000 });
  assert.equal(result, "error");
});

// ---- 削除の条件（teardownAndRemove、fail-closed） ----

test("終了未確認（kill-timeout）の場合は対象を削除せず、失敗として返す", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vhslide-teardown-stuck-"));
  await writeFile(path.join(dir, "probe.txt"), "probe");
  const child = mockChild(() => true); // 終了しない子プロセス
  try {
    const result = await teardownAndRemove({
      child,
      server: null,
      dir,
      stopOptions: { exitTimeoutMs: 30, killTimeoutMs: 30 },
    });
    assert.equal(result.stopResult, "kill-timeout");
    assert.equal(result.closeResult, "no-server");
    assert.equal(result.removed, false);
    assert.match(result.failure, /child:kill-timeout/);
    // 対象が削除されていないこと。
    await access(path.join(dir, "probe.txt"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test("閉鎖未確認（close-timeout）の場合は対象を削除せず、失敗として返す", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vhslide-teardown-close-"));
  await writeFile(path.join(dir, "probe.txt"), "probe");
  // close() のコールバックを決して呼ばないモックサーバー。
  const server = {
    listening: true,
    closeAllConnections() {},
    close() {},
  };
  try {
    const result = await teardownAndRemove({
      child: null,
      server,
      dir,
      closeOptions: { timeoutMs: 30 },
    });
    assert.equal(result.stopResult, "no-child");
    assert.equal(result.closeResult, "close-timeout");
    assert.equal(result.removed, false);
    assert.match(result.failure, /server:close-timeout/);
    // 対象が削除されていないこと。
    await access(path.join(dir, "probe.txt"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test("終了・閉鎖の両方を確認できた場合は対象を削除する", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vhslide-teardown-ok-"));
  await writeFile(path.join(dir, "probe.txt"), "probe");
  const relay = await startRelay();
  const child = spawnWaiter();
  const result = await teardownAndRemove({ child, server: relay, dir });
  assert.equal(result.stopResult, "exited");
  assert.equal(result.closeResult, "closed");
  assert.equal(result.removed, true);
  assert.equal(result.failure, null);
  await assert.rejects(access(dir), /ENOENT/, "対象ディレクトリが削除されること");
});

test("確認できたとみなす戻り値の一覧に、未確認の戻り値は含まれない", () => {
  assert.deepEqual(
    [...CHILD_STOP_CONFIRMED].sort(),
    ["already-exited", "exited", "killed", "no-child"]
  );
  assert.deepEqual(
    [...SERVER_CLOSE_CONFIRMED].sort(),
    ["already-closed", "closed", "no-server"]
  );
  for (const v of ["kill-timeout", "kill-failed", "error"]) {
    assert.equal(CHILD_STOP_CONFIRMED.includes(v), false, `${v} は未確認として扱うこと`);
  }
  assert.equal(SERVER_CLOSE_CONFIRMED.includes("close-timeout"), false);
});
