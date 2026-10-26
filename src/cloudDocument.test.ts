import { expect, it } from "vitest";
import * as Y from "yjs";
import { sample } from "./model";
import { createSharedDeck, readSharedDeck, toBase64 } from "./sharedDeck";
import { serverDocument, mergeCachedDocument } from "./cloudDocument";
import { recoveryDocuments } from "./cloudCache";
it("repeated protection attempts deduplicate bytes without losing protocol distinctions", () => {
  const a = { data: new Uint8Array([1, 2, 3]), protocol: 5 },
    b = { data: new Uint8Array([1, 2, 3]), protocol: 4 };
  expect(recoveryDocuments([a, structuredClone(a), b, undefined])).toEqual([
    a,
    b,
  ]);
});
function invalid(doc: Y.Doc) {
  const deck = readSharedDeck(doc),
    slide = doc.getMap<Y.Map<unknown>>("slides").get(deck.slides[0].id)!,
    elements = slide.get("elements") as Y.Map<Y.Map<unknown>>;
  elements.get(deck.slides[0].elements[0].id)!.set("fontSize", -1);
}
it("isolates invalid cached changes and preserves the authoritative document", () => {
  const source = createSharedDeck(sample()),
    cached = new Y.Doc();
  Y.applyUpdate(cached, Y.encodeStateAsUpdate(source));
  invalid(cached);
  const before = readSharedDeck(source);
  expect(() =>
    mergeCachedDocument(source, Y.encodeStateAsUpdate(cached)),
  ).toThrow();
  expect(() =>
    mergeCachedDocument(source, new Uint8Array([1, 2, 3])),
  ).toThrow();
  expect(readSharedDeck(source)).toEqual(before);
  source.destroy();
  cached.destroy();
});
it("still merges valid unsent edits without changing the server snapshot", () => {
  const source = createSharedDeck(sample()),
    cached = new Y.Doc();
  Y.applyUpdate(cached, Y.encodeStateAsUpdate(source));
  cached.getText("title").insert(0, "未送信 ");
  const merged = mergeCachedDocument(source, Y.encodeStateAsUpdate(cached));
  expect(readSharedDeck(merged).title).toBe(
    `未送信 ${readSharedDeck(source).title}`,
  );
  merged.destroy();
  source.destroy();
  cached.destroy();
});
it("distinguishes invalid authoritative data and never silently trusts a cache instead", () => {
  const bad = createSharedDeck(sample());
  invalid(bad);
  expect(() => serverDocument(toBase64(Y.encodeStateAsUpdate(bad)))).toThrow(
    "クラウドに保存されている作品データ",
  );
  bad.destroy();
});
