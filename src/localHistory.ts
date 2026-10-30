import { backupSnapshot } from "./backupData";
import type { BackupSnapshot } from "./backupData";
import type { Deck } from "./model";
import { uid } from "./model";
import { HISTORY_BYTES, HISTORY_COUNT } from "./historyStore";
import type { HistoryEntry } from "./historyStore";
type LocalEntry = HistoryEntry & { snapshot: BackupSnapshot };
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return (connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("vhslide-history", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("versions", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      connection = undefined;
      reject(request.error);
    };
  }));
}
export async function localVersions(): Promise<LocalEntry[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const t = db.transaction("versions"),
      r = t.objectStore("versions").getAll();
    t.oncomplete = () =>
      resolve(
        (r.result as LocalEntry[]).sort(
          (a, b) => b.created - a.created || b.id.localeCompare(a.id),
        ),
      );
    t.onerror = () => reject(t.error);
  });
}
let saving = Promise.resolve();
export function saveLocalVersion(book: Deck, reason: string) {
  const snapshot = backupSnapshot(book, [], [], []),
    bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
  if (bytes > 12_000_000)
    return Promise.reject(
      new Error("保存する版が12MBを超えています。JSONを保存してください。"),
    );
  const entry: LocalEntry = {
    id: uid(),
    deck: "local",
    title: book.title,
    created: Date.now(),
    reason,
    bytes,
    snapshot,
  };
  const action = saving
    .catch(() => {})
    .then(async () => {
      const existing = await localVersions(),
        db = await database();
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction("versions", "readwrite"),
          store = t.objectStore("versions");
        entry.created = Math.max(
          entry.created,
          (existing[0]?.created ?? 0) + 1,
        );
        store.put(entry);
        let total = bytes;
        existing.forEach((r, i) => {
          total += r.bytes;
          if (i >= HISTORY_COUNT - 1 || total > HISTORY_BYTES)
            store.delete(r.id);
        });
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    });
  saving = action;
  return action;
}
