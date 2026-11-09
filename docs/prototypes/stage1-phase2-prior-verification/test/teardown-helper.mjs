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
