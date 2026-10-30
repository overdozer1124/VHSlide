import * as Y from "yjs";
import { parseDeck } from "./model.ts";
import { fromBase64, readSharedDeck } from "./sharedDeck.ts";
/** Validate the authoritative document before considering any local cache. */
export function serverDocument(state: string): Y.Doc {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, fromBase64(state), "server");
    parseDeck(JSON.stringify(readSharedDeck(doc)));
    return doc;
  } catch {
    doc.destroy();
    throw new Error(
      "クラウドに保存されている作品データを読み込めません。元の作品と端末の一時保存は変更していません。",
    );
  }
}
/** Never let a partial or invalid merge contaminate the authoritative document. */
export function mergeCachedDocument(server: Y.Doc, data: Uint8Array): Y.Doc {
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(server), "server");
    Y.applyUpdate(candidate, data, "server");
    parseDeck(JSON.stringify(readSharedDeck(candidate)));
    return candidate;
  } catch (error) {
    candidate.destroy();
    throw error;
  }
}
