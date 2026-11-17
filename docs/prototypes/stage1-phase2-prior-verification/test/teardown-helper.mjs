// 終了処理の共通手順（Codex レビュー 6737085464 への対応）。
//
// 順序：子プロセスの終了待ち → 中継サーバーの閉鎖待ち → 対象
// ディレクトリの削除。Windows では子プロセスがミラー内のファイル
// を開いたまま削除すると EBUSY になるため、削除は必ず子プロセスの
// 終了確認の後で行う。Linux では EBUSY は再現しないため、順序の
// 正しさは test/clean-boot-teardown.test.mjs のイベント記録で示す。
// 実 Google・実 Worker とは通信しない。秘密は扱わない。
//
// 待ち時間はすべて上限付きで、無限待ちにはならない。
//
// teardownAndRemove は、終了・閉鎖の確認が取れた場合にだけ対象
// ディレクトリを削除する（fail-closed）。終了を確認できないまま
// 削除へ進まない条件は Codex レビュー 6754717703 への対応。

import { rm } from "node:fs/promises";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// SIGTERM 送信後、子プロセスの終了を待つ上限（ミリ秒）。
export const CHILD_EXIT_TIMEOUT_MS = 5000;
// SIGKILL 送信後、子プロセスの終了を待つ上限（ミリ秒）。この上限を
// 過ぎても終了しなければ "kill-timeout" を返し、呼び出し元が先へ
// 進める（無限待ちにしない）。
export const CHILD_KILL_TIMEOUT_MS = 5000;
// 中継サーバーの閉鎖を待つ上限（ミリ秒）。keep-alive 接続が残って
// いてもこの上限で打ち切り、呼び出し元が先へ進める。
export const SERVER_CLOSE_TIMEOUT_MS = 5000;

// 子プロセスに SIGTERM を送り、終了を待つ。所定時間内に終了しな
// ければ SIGKILL を送って再度待つ。戻り値：
//   "exited"         SIGTERM で終了した
//   "killed"         SIGKILL で終了した
//   "kill-timeout"   SIGKILL 後も所定時間内に終了しなかった
//   "error"          子プロセスが error で終わった
//   "no-child"       子プロセスが存在しない（起動しなかった場合など）
//   "already-exited" 呼び出し時点で既に終了していた
//   "kill-failed"    SIGTERM を送れなかった
export async function stopChild(
  child,
  { exitTimeoutMs = CHILD_EXIT_TIMEOUT_MS, killTimeoutMs = CHILD_KILL_TIMEOUT_MS } = {}
) {
  if (!child) return "no-child";
  if (child.exitCode !== null || child.signalCode !== null) return "already-exited";
  let sent = false;
  try {
    sent = child.kill("SIGTERM");
  } catch {
    sent = false;
  }
  if (!sent) {
    // kill と exitCode の確認の間に子プロセスが終了した場合。
    if (child.exitCode !== null || child.signalCode !== null) return "exited";
    return "kill-failed";
  }
  const ended = new Promise((resolve) => {
    child.once("exit", () => resolve("ended"));
    child.once("error", () => resolve("error"));
  });
  const first = await Promise.race([ended, delay(exitTimeoutMs).then(() => "timeout")]);
  if (first === "error") return "error";
  if (first !== "timeout") return "exited";
  // 所定時間内に終了しなかった：SIGKILL で強制終了する。
  try {
    child.kill("SIGKILL");
  } catch {
    // 既に終了しかけている場合は無視する。
  }
  const second = await Promise.race([ended, delay(killTimeoutMs).then(() => "kill-timeout")]);
  if (second === "kill-timeout") return "kill-timeout";
  // SIGKILL 後に終了した（error で終わった場合も、子プロセスは
  // 既に存在しないので "killed" とする）。
  return "killed";
}

// 中継サーバーを閉じ、閉鎖の完了を待つ。keep-alive の遊休接続が
// 残ると close() のコールバックが遅れるため、先に全接続を切る
// （Node 18.2 以降の closeAllConnections）。戻り値：
//   "closed"         閉鎖が完了した
//   "close-timeout"  所定時間内に閉鎖が完了しなかった
//   "no-server"      サーバーが存在しない
//   "already-closed" 呼び出し時点で既に閉じていた
export async function closeServer(server, { timeoutMs = SERVER_CLOSE_TIMEOUT_MS } = {}) {
  if (!server) return "no-server";
  if (!server.listening) return "already-closed";
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  const closed = new Promise((resolve) => server.close(() => resolve("closed")));
  return await Promise.race([closed, delay(timeoutMs).then(() => "close-timeout")]);
}

// 子プロセスの終了が確認できたとみなす stopChild の戻り値。これら
// 以外（"kill-timeout"・"kill-failed"・"error"）は、子プロセスが
// まだ生きている可能性を否定できないため、確認できたとは扱わない。
export const CHILD_STOP_CONFIRMED = ["exited", "killed", "already-exited", "no-child"];

// 中継サーバーの閉鎖が確認できたとみなす closeServer の戻り値。
// "close-timeout" は閉鎖が完了していない可能性があるため含めない。
export const SERVER_CLOSE_CONFIRMED = ["closed", "already-closed", "no-server"];

// 終了処理の本体（clean-boot.test.mjs の after() が使う）：
// 子プロセスの終了待ち → 中継サーバーの閉鎖待ち → 両方の確認が
// 取れた場合のみ対象ディレクトリを削除する。確認が取れなければ
// 削除せず、failure に理由を入れて返す（fail-closed。Codex
// レビュー 6754717703 への対応）。戻り値：
//   { stopResult, closeResult, removed, failure }
//   removed: 削除した場合は true、しなかった場合は false
//   failure: 削除しなかった理由（"child:kill-timeout" など）。
//            削除した場合は null。
export async function teardownAndRemove({ child, server, dir, stopOptions, closeOptions } = {}) {
  const stopResult = await stopChild(child, stopOptions);
  const closeResult = await closeServer(server, closeOptions);
  const failures = [];
  if (!CHILD_STOP_CONFIRMED.includes(stopResult)) failures.push(`child:${stopResult}`);
  if (!SERVER_CLOSE_CONFIRMED.includes(closeResult)) failures.push(`server:${closeResult}`);
  if (failures.length > 0) {
    return { stopResult, closeResult, removed: false, failure: failures.join(", ") };
  }
  await rm(dir, { recursive: true, force: true });
  return { stopResult, closeResult, removed: true, failure: null };
}

// ディレクトリの削除を、上限付きで再試行する（ガード試験群と
// run.mjs の開始時掃除が使う）。Windows では Miniflare（workerd）
// の dispose 直後でも SQLite ファイルのハンドルが短時間残り、
// 削除が EBUSY／EPERM で失敗することがある。固定名の永続化
// ディレクトリを即時に rmSync する従来方式は、after フックの
// 失敗（＝スイートの失敗表示）や、残留した workerd が次回実行の
// before の削除・起動を塞ぐ原因になった（Codex レビュー
// 6873611386 への対応：全体実行だけが S10／S14 ガードで止まり、
// 単体では合格した）。
// 戻り値：true = 削除できた（元々存在しない場合を含む）、
//         false = 上限まで再試行しても削除できなかった。
// 例外は投げない。呼び出し元は、削除できない場合でも次回実行と
// 衝突しない形（実行ごとに一意な名前など）で使うこと。
export const REMOVE_DIR_ATTEMPTS = 20;
export const REMOVE_DIR_DELAY_MS = 250;
export async function removeDirWithRetry(
  dir,
  { attempts = REMOVE_DIR_ATTEMPTS, delayMs = REMOVE_DIR_DELAY_MS } = {}
) {
  for (let i = 0; i < attempts; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return true;
    } catch {
      if (i + 1 < attempts) await delay(delayMs);
    }
  }
  return false;
}
