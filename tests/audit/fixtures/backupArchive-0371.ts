// Frozen 0.37.1 baseline for matched performance measurements.
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import {
  BACKUP_METADATA_BYTES,
  MAX_BACKUP_BYTES,
  parseBackupSnapshot,
} from "../../../src/backupData";
import type { BackupSnapshot } from "../../../src/backupData";
export { MAX_BACKUP_BYTES } from "../../../src/backupData";
const MAX_IMAGE_BYTES = 6_000_000;
const MAX_FILES = 2002;
type FileEntry = {
  path: string;
  bytes: number;
  sha256: string;
  source?: string;
};
type Manifest = { format: "vhslide-archive"; version: 1; files: FileEntry[] };
export type LoadedBackup = {
  snapshot: BackupSnapshot;
  images: Map<string, Uint8Array>;
  size: number;
};
async function hash(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
function validateImages(
  snapshot: BackupSnapshot,
  images: Map<string, Uint8Array>,
) {
  const used = new Set(
    snapshot.deck.slides.flatMap((s) =>
      s.elements.filter((e) => e.type === "image").map((e) => e.src!),
    ),
  );
  if (used.size !== images.size || [...used].some((src) => !images.has(src)))
    throw new Error("写真が不足しているか、作品にない写真が含まれています。");
}
export async function createBackupArchive(
  snapshot: BackupSnapshot,
  loadImage: (source: string) => Promise<Uint8Array>,
  progress?: (message: string) => void,
): Promise<Uint8Array> {
  snapshot = parseBackupSnapshot(snapshot);
  const files: Record<string, Uint8Array> = {},
    entries: FileEntry[] = [];
  const metadata = strToU8(JSON.stringify(snapshot));
  if (metadata.length > BACKUP_METADATA_BYTES)
    throw new Error("作品・付箋・共有設定の合計が12MBを超えています。");
  files["work.json"] = metadata;
  entries.push({
    path: "work.json",
    bytes: metadata.length,
    sha256: await hash(metadata),
  });
  let total = metadata.length;
  const sources = [
    ...new Set(
      snapshot.deck.slides.flatMap((s) =>
        s.elements.filter((e) => e.type === "image").map((e) => e.src!),
      ),
    ),
  ];
  if (sources.length > MAX_FILES - 2)
    throw new Error("バックアップの写真は2000点までです。");
  for (let i = 0; i < sources.length; i++) {
    progress?.(`写真を保存中 ${i + 1} / ${sources.length}`);
    const bytes = await loadImage(sources[i]);
    total += bytes.length;
    if (bytes.length > MAX_IMAGE_BYTES || total > MAX_BACKUP_BYTES - 1_000_000)
      throw new Error(
        "バックアップの容量上限（300MB、写真1点6MB）を超えています。",
      );
    const path = `images/${i}.bin`;
    files[path] = bytes;
    entries.push({
      path,
      source: sources[i],
      bytes: bytes.length,
      sha256: await hash(bytes),
    });
  }
  const manifest: Manifest = {
    format: "vhslide-archive",
    version: 1,
    files: entries,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  // Photos are already compressed. STORE avoids compression CPU and zip-bomb expansion.
  return zipSync(files, { level: 0 });
}
async function readArchive(bytes: Uint8Array): Promise<LoadedBackup> {
  if (bytes.length > MAX_BACKUP_BYTES)
    throw new Error("バックアップは300MBまでです。");
  let total = 0;
  const seen = new Set<string>();
  const files = unzipSync(bytes, {
    filter: (f) => {
      if (
        seen.has(f.name) ||
        seen.size >= MAX_FILES ||
        !/^(manifest\.json|work\.json|images\/(0|[1-9][0-9]*)\.bin)$/.test(
          f.name,
        )
      )
        throw new Error("バックアップ内のファイル名が正しくありません。");
      seen.add(f.name);
      total += f.originalSize;
      const max =
        f.name === "manifest.json"
          ? 1_000_000
          : f.name === "work.json"
            ? 12_000_000
            : MAX_IMAGE_BYTES;
      if (
        f.compression !== 0 ||
        f.size !== f.originalSize ||
        f.originalSize > max ||
        total > MAX_BACKUP_BYTES
      )
        throw new Error("バックアップ内の形式または容量が上限を超えています。");
      return true;
    },
  });
  const manifest = JSON.parse(
    strFromU8(files["manifest.json"] ?? new Uint8Array()),
  ) as Manifest;
  if (
    manifest?.format !== "vhslide-archive" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length + 1 !== seen.size
  )
    throw new Error("対応するバックアップではありません。");
  const checked = new Set<string>(),
    images = new Map<string, Uint8Array>();
  for (const entry of manifest.files) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      entry.path === "manifest.json" ||
      checked.has(entry.path) ||
      !Object.hasOwn(files, entry.path)
    )
      throw new Error("バックアップのファイル一覧が正しくありません。");
    checked.add(entry.path);
    const file = files[entry.path];
    if (
      entry.bytes !== file.length ||
      typeof entry.sha256 !== "string" ||
      (await hash(file)) !== entry.sha256
    )
      throw new Error(
        "バックアップが破損しています。元のファイルを選び直してください。",
      );
    if (entry.path !== "work.json") {
      if (typeof entry.source !== "string" || images.has(entry.source))
        throw new Error("写真の対応が正しくありません。");
      images.set(entry.source, file);
    }
  }
  if (!checked.has("work.json")) throw new Error("作品データがありません。");
  const snapshot = parseBackupSnapshot(
    JSON.parse(strFromU8(files["work.json"])),
  );
  validateImages(snapshot, images);
  return { snapshot, images, size: total };
}

export async function readBackupArchive(
  bytes: Uint8Array,
): Promise<LoadedBackup> {
  try {
    return await readArchive(bytes);
  } catch (error) {
    if (error instanceof Error && /[ぁ-んァ-ン一-龯]/.test(error.message))
      throw error;
    throw new Error(
      "バックアップを読み込めません。VHSlideで保存した.vhslide.zipファイルを選び直してください。",
    );
  }
}
