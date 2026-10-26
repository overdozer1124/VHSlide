import type { LoadedBackup } from "./backupArchive";
import type { BackupSnapshot } from "./backupData";
import { MAX_BACKUP_BYTES } from "./backupData";

function run<T>(
  request: unknown,
  signal?: AbortSignal,
  progress?: (text: string) => void,
): Promise<T> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./backup.worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(
        new DOMException(
          "バックアップ処理を中断しました。元の作品は変更していません。",
          "AbortError",
        ),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessageerror = worker.onerror = () => {
      cleanup();
      reject(
        new Error(
          "バックアップを処理できません。空きメモリ・接続を確認して再実行してください。",
        ),
      );
    };
    worker.onmessage = ({ data }) => {
      if (data.progress) {
        progress?.(data.progress);
        return;
      }
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result as T);
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
export function readBackupInWorker(
  file: Blob,
  signal?: AbortSignal,
  progress?: (text: string) => void,
): Promise<LoadedBackup> {
  if (file.size > MAX_BACKUP_BYTES)
    return Promise.reject(new Error("バックアップは300MBまでです。"));
  return run({ operation: "read", file }, signal, progress);
}
export function createBackupInWorker(
  snapshot: BackupSnapshot,
  id: string,
  progress?: (text: string) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  return run({ operation: "create", snapshot, id }, signal, progress);
}
