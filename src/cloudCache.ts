import { COLLABORATION_PROTOCOL } from "./collaborationProtocol.ts";
export interface CacheRecovery {
  id: string;
  created: number;
  documents: unknown[];
  acknowledged?: boolean;
}
const recoveryPrefix = (key: string) => `recovery/${key}/`;
const normalize = (value: any) =>
  value instanceof Uint8Array ? { data: value, protocol: 1 } : value;
function equalCache(a: any, b: any) {
  return (
    a?.protocol === b?.protocol &&
    a?.data instanceof Uint8Array &&
    b?.data instanceof Uint8Array &&
    a.data.length === b.data.length &&
    a.data.every((v: number, i: number) => v === b.data[i])
  );
}
export function recoveryDocuments(values: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (const value of values)
    if (
      value !== undefined &&
      !result.some((old) => equalCache(normalize(old), normalize(value)))
    )
      result.push(value);
  return result;
}
function database(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const request = indexedDB.open("vhslide-cloud", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("documents");
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
  });
}

/** Archive both the inspected and current cache, then replace the working cache
 * atomically. Another tab's intervening write is preserved as well. */
export async function quarantineDocument(
  key: string,
  saved: unknown,
  server: Uint8Array,
  retained: unknown[] = [],
): Promise<CacheRecovery> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("documents", "readwrite"),
        store = tx.objectStore("documents"),
        request = store.get(key);
      let record: CacheRecovery;
      request.onsuccess = () => {
        try {
          const current = normalize(request.result),
            created = Date.now();
          record = {
            id: `${recoveryPrefix(key)}${String(created).padStart(16, "0")}-${crypto.randomUUID()}`,
            created,
            documents: recoveryDocuments([...retained, saved, current]),
          };
          store.put(record, record.id);
          store.put({ data: server, protocol: COLLABORATION_PROTOCOL }, key);
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      tx.oncomplete = () => resolve(record!);
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error("一時保存を保護できませんでした。"));
    });
  } finally {
    db.close();
  }
}
export async function cachedRecovery(
  key: string,
): Promise<CacheRecovery | undefined> {
  const db = await database(),
    prefix = recoveryPrefix(key);
  try {
    return await new Promise((resolve, reject) => {
      const r = db
        .transaction("documents")
        .objectStore("documents")
        .openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`), "prev");
      r.onsuccess = () => resolve(r.result?.value);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function acknowledgeRecovery(id: string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("documents", "readwrite"),
        s = tx.objectStore("documents"),
        r = s.get(id);
      r.onsuccess = () => {
        if (r.result) s.put({ ...r.result, acknowledged: true }, id);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function cachedDocument(
  key: string,
): Promise<{ data: Uint8Array; protocol: number } | undefined> {
  const db = await database();
  try {
    return await new Promise((done, fail) => {
      const request = db
        .transaction("documents")
        .objectStore("documents")
        .get(key);
      request.onsuccess = () => {
        const saved = request.result;
        done(
          saved instanceof Uint8Array ? { data: saved, protocol: 1 } : saved,
        );
      };
      request.onerror = () => fail(request.error);
    });
  } finally {
    db.close();
  }
}
export async function cacheDocument(key: string, value: Uint8Array) {
  const db = await database();
  try {
    await new Promise<void>((done, fail) => {
      const transaction = db.transaction("documents", "readwrite");
      transaction
        .objectStore("documents")
        .put({ data: value, protocol: COLLABORATION_PROTOCOL }, key);
      transaction.oncomplete = () => done();
      transaction.onerror = () => fail(transaction.error);
    });
  } finally {
    db.close();
  }
}
