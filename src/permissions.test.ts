import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { sample } from "./model";
import { createSharedDeck, readSharedDeck, sharedText } from "./sharedDeck";
import { applyAuthorizedUpdate } from "./authorizeUpdate";
import {
  defaultAccess,
  parseAccess,
  canEdit,
  assertDeckAccess,
} from "./permissions";
const all = { ...defaultAccess(), mode: "all" as const };
function change(doc: Y.Doc, operation: (doc: Y.Doc) => void) {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(doc));
  readSharedDeck(client);
  const vector = Y.encodeStateVector(client);
  operation(client);
  const update = Y.encodeStateAsUpdate(client, vector),
    candidate = new Y.Doc();
  Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
  return { update, candidate, client };
}
describe("host and scoped editing", () => {
  it("separates sheets, combines row/column/page grants, and rejects malformed permission input", () => {
    const s = sample().slides[0],
      access = {
        ...defaultAccess(),
        mode: "scoped" as const,
        rows: [{ sheetId: "main", index: 0 }],
        slides: ["chosen"],
      };
    expect(canEdit(access, s)).toBe(true);
    expect(canEdit(access, { ...s, sheetId: "other" })).toBe(false);
    expect(canEdit(access, { ...s, id: "chosen", sheetId: "other" })).toBe(
      true,
    );
    expect(() =>
      parseAccess({ ...access, rows: [{ sheetId: "main", index: -1 }] }),
    ).toThrow();
    expect(() => parseAccess({ ...access, mode: "owner" })).toThrow();
  });
  it("accepts authorized rich text but denies changes to protected text and mixed batches", () => {
    const deck = sample(),
      doc = createSharedDeck(deck),
      s = deck.slides[0],
      locked = deck.slides[1];
    const access = {
      ...defaultAccess(),
      mode: "scoped" as const,
      slides: [s.id],
    };
    const edit = change(doc, (c) =>
      sharedText(c, s.id, s.elements[0].id)!.insert(0, "自分"),
    );
    expect(() =>
      applyAuthorizedUpdate(doc, edit.candidate, edit.update, access, false),
    ).not.toThrow();
    const attack = change(doc, (c) => {
      sharedText(c, s.id, s.elements[0].id)!.insert(0, "自分");
      sharedText(c, locked.id, locked.elements[0].id)!.delete(0, 1);
    });
    expect(() =>
      applyAuthorizedUpdate(
        doc,
        attack.candidate,
        attack.update,
        access,
        false,
      ),
    ).toThrow();
    expect(readSharedDeck(doc)).toEqual(readSharedDeck(createSharedDeck(deck)));
  });
  it("denies deck settings even for all-slide clients, hidden roots and deferred CRDT payloads", () => {
    const deck = sample(),
      doc = createSharedDeck(deck);
    for (const operation of [
      (c: Y.Doc) => c.getText("title").insert(0, "変更"),
      (c: Y.Doc) => c.getMap("future-permissions").set("owner", true),
    ]) {
      const a = change(doc, operation);
      expect(() =>
        applyAuthorizedUpdate(doc, a.candidate, a.update, all, false),
      ).toThrow();
    }
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(doc));
    readSharedDeck(client);
    const t = sharedText(
      client,
      deck.slides[0].id,
      deck.slides[0].elements[0].id,
    )!;
    t.insert(0, "first");
    const vector = Y.encodeStateVector(client);
    t.insert(1, "deferred");
    const candidate = new Y.Doc();
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
    expect(() =>
      applyAuthorizedUpdate(
        doc,
        candidate,
        Y.encodeStateAsUpdate(client, vector),
        all,
        false,
      ),
    ).toThrow();
  });
  it("denies moving granted slides into a protected range and changing other slides through grid collisions", () => {
    const deck = sample(),
      s = deck.slides[0],
      access = {
        ...defaultAccess(),
        mode: "scoped" as const,
        rows: [{ sheetId: "main", index: 0 }],
      };
    expect(() =>
      assertDeckAccess(
        deck,
        {
          ...deck,
          slides: deck.slides.map((p) => (p.id === s.id ? { ...p, y: 5 } : p)),
        },
        access,
        false,
      ),
    ).toThrow();
    const doc = createSharedDeck(deck),
      a = change(doc, (c) => {
        (c.getMap("slides").get(s.id) as Y.Map<unknown>).set("position", {
          x: 0,
          y: 1,
        });
      });
    expect(() =>
      applyAuthorizedUpdate(
        doc,
        a.candidate,
        a.update,
        { ...all, mode: "scoped", slides: [s.id] },
        false,
      ),
    ).toThrow();
  });
});
