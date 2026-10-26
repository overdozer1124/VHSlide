import { createBackupBlob, readBackupArchive } from "./backupArchive";
import { digestText } from "./backupProtocol";
import type { BackupSnapshot } from "./backupData";

type Request =
  | { operation: "read"; file: Blob }
  | { operation: "create"; snapshot: BackupSnapshot; id: string };
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    if (data.operation === "read") {
      const bytes = new Uint8Array(await data.file.arrayBuffer());
      scope.postMessage({ progress: "ZIPの整合性を確認しています…" });
      const result = await readBackupArchive(bytes);
      const imageHashes = result.imageHashes!;
      const images = [...imageHashes].sort(([a], [b]) => a.localeCompare(b));
      const fingerprint = await digestText(
        JSON.stringify([result.snapshot, images]),
      );
      scope.postMessage(
        { result: { ...result, imageHashes, fingerprint } },
        [...result.images.values()].map((b) => b.buffer as ArrayBuffer),
      );
    } else {
      const { id, snapshot } = data;
      const result = await createBackupBlob(
        snapshot,
        async (source) => {
          if (
            !new RegExp(`^/api/decks/${id}/assets/[a-f0-9-]{36}$`).test(source)
          )
            throw new Error("作品の写真の参照が正しくありません。");
          const response = await fetch(source, { credentials: "same-origin" });
          if (!response.ok)
            throw new Error(
              "写真を取得できません。接続を確認して再実行してください。",
            );
          return new Uint8Array(await response.arrayBuffer());
        },
        (progress) => scope.postMessage({ progress }),
      );
      scope.postMessage({ result });
    }
  } catch (error) {
    scope.postMessage({
      error:
        (error as Error).message ||
        "バックアップを処理できません。空きメモリを確認してください。",
    });
  }
};
