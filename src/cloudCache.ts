function database(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const request = indexedDB.open("vhslide-cloud", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("documents");
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
  });
}
export async function cachedDocument(
  key: string,
): Promise<Uint8Array | undefined> {
  const db = await database();
  try {
    return await new Promise((done, fail) => {
      const request = db
        .transaction("documents")
        .objectStore("documents")
        .get(key);
      request.onsuccess = () => done(request.result);
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
      transaction.objectStore("documents").put(value, key);
      transaction.oncomplete = () => done();
      transaction.onerror = () => fail(transaction.error);
    });
  } finally {
    db.close();
  }
}
