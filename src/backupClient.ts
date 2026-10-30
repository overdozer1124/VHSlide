import { api } from "./cloud";
import type { LoadedBackup } from "./backupArchive";
import type { BackupSnapshot } from "./backupData";
import {
  backupChanged,
  digestBytes,
  digestText,
  validCheckpoint,
} from "./backupProtocol";
import type { BackupCheckpoint, RestoreTask } from "./backupProtocol";

export async function downloadFullBackup(
  id: string,
  progress: (text: string) => void,
  signal?: AbortSignal,
) {
  const { createBackupInWorker } = await import("./backupWorker");
  signal?.throwIfAborted();
  const snapshot = await api<BackupSnapshot & { checkpoint: BackupCheckpoint }>(
    `/api/decks/${id}/backup`,
    { signal },
  );
  if (!validCheckpoint(snapshot.checkpoint))
    throw new Error(
      "バックアップ方式が更新されました。画面を再読み込みしてください。",
    );
  const bytes = await createBackupInWorker(snapshot, id, progress, signal);
  signal?.throwIfAborted();
  progress("作品・付箋・共有設定の変更を確認しています…");
  // One attempt, fail closed: no download on conflict, auth loss or transport failure.
  await api(`/api/decks/${id}/backup/verify`, {
    method: "POST",
    signal,
    body: JSON.stringify({ checkpoint: snapshot.checkpoint }),
  });
  signal?.throwIfAborted();
  const url = URL.createObjectURL(bytes);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${snapshot.deck.title.replace(/[\\/:*?"<>|]/g, "_") || "VHSlide"}.vhslide.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function listRestoreTasks(): Promise<RestoreTask[]> {
  return (await api<{ jobs: RestoreTask[] }>("/api/restores")).jobs;
}
export async function cancelRestoreTask(id: string) {
  try {
    await api(`/api/decks/${id}/restore`, { method: "DELETE" });
  } catch (error) {
    const job = await api<RestoreTask>(`/api/restores/${id}`).catch(
      () => undefined,
    );
    if (job?.status === "cancelled") return;
    throw error;
  }
}
export async function backupFingerprint(backup: LoadedBackup) {
  if (backup.fingerprint) return backup.fingerprint;
  const images: string[][] = [];
  for (const [source, bytes] of [...backup.images].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    images.push([source, await digestBytes(bytes)]);
  }
  return digestText(JSON.stringify([backup.snapshot, images]));
}
class RestoreError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function restoreFullBackup(
  backup: LoadedBackup,
  applySharing: boolean,
  progress: (text: string) => void,
  signal: AbortSignal,
  options: {
    resumeId?: string;
    onJob?: (id: string) => void;
    newCopy?: boolean;
    requestKey?: string;
  } = {},
): Promise<string> {
  let id: string | undefined;
  const pause = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, ms);
      const abort = () => {
        clearTimeout(timer);
        reject(
          new DOMException(
            "復元を中断しました。ファイルを選び直して再開できます。",
            "AbortError",
          ),
        );
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    let last: unknown;
    for (let retry = 0; retry < 3; retry++) {
      signal.throwIfAborted();
      try {
        const r = await fetch(path, {
          ...options,
          credentials: "same-origin",
          signal,
          headers: {
            ...(typeof options.body === "string"
              ? { "Content-Type": "application/json" }
              : {}),
            ...options.headers,
          },
        });
        const result = await r.json().catch(() => ({}));
        if (!r.ok)
          throw new RestoreError(
            result.error || "復元中に接続が切れました。",
            r.status,
          );
        return result;
      } catch (error) {
        last = error;
        signal.throwIfAborted();
        if (
          error instanceof RestoreError &&
          error.status !== 429 &&
          error.status < 500
        )
          throw error;
        if (retry < 2) {
          progress(
            error instanceof RestoreError && error.status === 429
              ? "操作上限のため30秒待っています。"
              : "接続を確認し、同じ復元を再試行しています…",
          );
          await pause(
            error instanceof RestoreError && error.status === 429
              ? 30_000
              : 200 * (retry + 1),
          );
        }
      }
    }
    throw last;
  }
  try {
    progress("バックアップと前回の復元を確認しています…");
    const contentHash = await backupFingerprint(backup);
    signal.throwIfAborted();
    let job: RestoreTask | undefined;
    if (options.resumeId) {
      job = await request<RestoreTask>(`/api/restores/${options.resumeId}`);
      if (
        (job.contentHash && job.contentHash !== contentHash) ||
        (job.applySharing !== null && job.applySharing !== applySharing)
      )
        throw new Error(
          "再開するファイルまたは共有設定が前回と違います。同じバックアップと設定を選んでください。",
        );
    }
    if (!job) {
      const created = await request<{ id: string }>("/api/restores", {
        method: "POST",
        body: JSON.stringify({
          title: backup.snapshot.deck.title,
          key: options.requestKey ?? (await digestText(crypto.randomUUID())),
          ...(options.newCopy ? { newCopy: true } : {}),
          contentHash,
          applySharing,
        }),
      });
      id = created.id;
      job = await request<RestoreTask>(`/api/restores/${id}`);
    }
    id = job.id;
    options.onJob?.(id);
    if (job.status === "ready") return id;
    if (["cancelled", "cancelling"].includes(job.status))
      throw new Error(
        "この復元は取り消されています。作品一覧で状態を確認してください。",
      );
    const snapshot = structuredClone(backup.snapshot),
      replacements = new Map<string, string>();
    let i = 0;
    for (const [source, bytes] of backup.images) {
      progress(`写真を復元中 ${++i} / ${backup.images.size}`);
      const result = await request<{ src: string }>(`/api/decks/${id}/assets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Restore-Image":
            backup.imageHashes?.get(source) ?? (await digestBytes(bytes)),
        },
        body: bytes as Uint8Array<ArrayBuffer>,
      });
      replacements.set(source, result.src);
    }
    for (const slide of snapshot.deck.slides)
      for (const e of slide.elements)
        if (e.type === "image") e.src = replacements.get(e.src!)!;
    progress("スライド・付箋・共有設定を保存しています…");
    await request(`/api/decks/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({ snapshot, applySharing }),
    });
    return id;
  } catch (error) {
    // An unknown response is not a failed commit. Never automatically delete it.
    if (id) {
      const job = await api<RestoreTask>(`/api/restores/${id}`).catch(
        () => undefined,
      );
      if (job?.status === "ready") return id;
      if (signal.aborted)
        throw new DOMException(
          "復元を中断しました。作品一覧から同じファイルを選んで再開できます。",
          "AbortError",
        );
      throw new Error(
        `${(error as Error).message} 途中の復元は保存されています。作品一覧から再開・取り消しできます。`,
      );
    }
    throw error;
  }
}
// Used by callers that want a stable, translated conflict label.
export { backupChanged };
