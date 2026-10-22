import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { blank, insertMovedPage, parseDeck, sample } from "./model";
import {
  applyDeckChange,
  createSharedDeck,
  readSharedDeck,
  sharedText,
  LOCAL_CHANGE,
} from "./sharedDeck";

describe("shared slide document", () => {
  it("merges alignment with remote typing and undoes only the local alignment", () => {
    const base = sample();
    const a = createSharedDeck(base),
      b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "server");
    const undo = new Y.UndoManager(a.getMap("slides"), {
      trackedOrigins: new Set([LOCAL_CHANGE]),
    });
    const aligned = structuredClone(base);
    Object.assign(aligned.slides[0].elements[0], {
      textAlign: "right",
      verticalAlign: "bottom",
    });
    applyDeckChange(a, base, aligned);
    const remoteText = sharedText(
      b,
      base.slides[0].id,
      base.slides[0].elements[0].id,
    )!;
    remoteText.insert(0, "相手の文字 ");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), "server");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "server");
    const result = readSharedDeck(a).slides[0].elements[0];
    expect(result).toMatchObject({
      textAlign: "right",
      verticalAlign: "bottom",
    });
    expect(result.text).toContain("相手の文字");
    expect(parseDeck(JSON.stringify(readSharedDeck(b)))).toEqual(
      readSharedDeck(a),
    );
    undo.undo();
    const restored = readSharedDeck(a).slides[0].elements[0];
    expect(restored.textAlign).toBeUndefined();
    expect(restored.verticalAlign).toBeUndefined();
    expect(restored.text).toContain("相手の文字");
  });
  it("undoes an inserted page's positions without undoing a collaborator's text", () => {
    const base = sample(),
      a = createSharedDeck(base),
      b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "server");
    const undo = new Y.UndoManager([a.getMap("slides"), a.getText("title")], {
      trackedOrigins: new Set([LOCAL_CHANGE]),
    });
    applyDeckChange(a, base, insertMovedPage(base, base.slides[1].id, 1, 1));
    const text = sharedText(
      b,
      base.slides[1].id,
      base.slides[1].elements[0].id,
    )!;
    text.insert(0, "相手の入力 ");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), "server");
    expect(
      readSharedDeck(a).slides.find((s) => s.id === base.slides[1].id),
    ).toMatchObject({ x: 1, y: 1 });
    undo.undo();
    const result = readSharedDeck(a);
    for (const slide of base.slides)
      expect(result.slides.find((s) => s.id === slide.id)).toMatchObject({
        x: slide.x,
        y: slide.y,
      });
    expect(
      sharedText(
        a,
        base.slides[1].id,
        base.slides[1].elements[0].id,
      )!.toString(),
    ).toContain("相手の入力");
    expect(result.slides).toHaveLength(base.slides.length);
  });
  it("round-trips content and keeps per-user thumbnail settings out of shared state", () => {
    const deck = sample();
    deck.linkedRows = true;
    deck.rowSelections = [deck.slides[2].id];
    const doc = createSharedDeck(deck);
    expect(readSharedDeck(doc)).toEqual({
      version: 1,
      title: deck.title,
      slides: deck.slides,
    });
    const local = {
      ...deck,
      linkedRows: false,
      rowSelections: [deck.slides[0].id],
    };
    const changes: unknown[] = [];
    doc.on("update", (update) => changes.push(update));
    applyDeckChange(doc, deck, local);
    expect(changes).toHaveLength(0);
  });
  it("merges concurrent text input and independent formatting without losing either edit", () => {
    const base = sample(),
      server = createSharedDeck(base),
      a = new Y.Doc(),
      b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(server));
    sharedText(a, base.slides[0].id, base.slides[0].elements[0].id)!.insert(
      0,
      "甲",
    );
    sharedText(b, base.slides[0].id, base.slides[0].elements[0].id)!.insert(
      0,
      "乙",
    );
    const next = readSharedDeck(a);
    next.slides[1].background = "#123456";
    applyDeckChange(a, readSharedDeck(a), next);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readSharedDeck(a)).toEqual(readSharedDeck(b));
    const text = readSharedDeck(a).slides[0].elements[0].text!;
    expect(text).toContain("甲");
    expect(text).toContain("乙");
    expect(text).toContain("OUR TOWN");
    expect(readSharedDeck(b).slides[1].background).toBe("#123456");
    // A UI event based on an older render must not overwrite remote fields it did not edit.
    applyDeckChange(a, base, { ...base, title: "新しい作品名" });
    expect(readSharedDeck(a).title).toBe("新しい作品名");
    expect(readSharedDeck(a).slides[1].background).toBe("#123456");
    expect(readSharedDeck(a).slides[0].elements[0].text).toBe(text);
  });
  it("keeps simultaneous slide additions in separate fixed cells", () => {
    const base = sample(),
      a = createSharedDeck(base),
      b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    applyDeckChange(a, base, {
      ...base,
      slides: [...base.slides, blank(2, 1)],
    });
    applyDeckChange(b, base, {
      ...base,
      slides: [...base.slides, blank(2, 1)],
    });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const result = readSharedDeck(a);
    expect(result.slides).toHaveLength(7);
    expect(new Set(result.slides.map((s) => `${s.x},${s.y}`)).size).toBe(7);
    expect(parseDeck(JSON.stringify(result))).toEqual(result);
    expect(readSharedDeck(b)).toEqual(result);
  });
  it("undoes only the local change while retaining another user's changes", () => {
    const base = sample(),
      a = createSharedDeck(base),
      b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const undo = new Y.UndoManager([a.getMap("slides"), a.getText("title")], {
      trackedOrigins: new Set([LOCAL_CHANGE]),
    });
    applyDeckChange(a, base, { ...base, title: "自分の題名" });
    const next = structuredClone(base);
    next.slides[0].background = "#123456";
    applyDeckChange(b, base, next);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), "server");
    undo.undo();
    expect(readSharedDeck(a).title).toBe(base.title);
    expect(readSharedDeck(a).slides[0].background).toBe("#123456");
  });
});
