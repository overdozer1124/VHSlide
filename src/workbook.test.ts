import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { sample, parseDeck, duplicateRowGroup, blank } from "./model";
import { activeSheet, changeSheet, sheetDeck, mergeSheet } from "./workbook";
import {
  balancedGrid,
  matchesFilter,
  emptyFilter,
  toggleFilterSlide,
  toggleFilterGroup,
  groupSelection,
} from "./mapFilter";
import {
  createSharedDeck,
  readSharedDeck,
  applyDeckChange,
  LOCAL_CHANGE,
  sharedText,
} from "./sharedDeck";

describe("sheets and filtered maps", () => {
  it("isolates sheets at identical coordinates and roundtrips names, ordering and active choice", () => {
    const original = sample(),
      added = changeSheet(original, "add");
    expect(sheetDeck(added).slides).toHaveLength(1);
    const id = activeSheet(added).id;
    const current = sheetDeck(added);
    const edited = mergeSheet(added, {
      ...current,
      slides: [{ ...current.slides[0], title: "別の作品" }],
    });
    expect(sheetDeck({ ...edited, activeSheetId: "main" }).slides).toEqual(
      original.slides,
    );
    let copied = changeSheet(edited, "duplicate", id);
    expect(activeSheet(copied).id).not.toBe(id);
    expect(sheetDeck(copied).slides[0].title).toBe("別の作品");
    expect(sheetDeck(copied).slides[0].id).not.toBe(current.slides[0].id);
    copied = changeSheet(copied, "rename", id, "練習");
    copied = changeSheet(copied, "left", activeSheet(copied).id);
    expect(parseDeck(JSON.stringify(copied))).toEqual(copied);
    expect(
      parseDeck(JSON.stringify(changeSheet(copied, "delete", id))).sheets,
    ).toHaveLength(2);
    expect(() => changeSheet(original, "delete")).toThrow();
  });
  it("moves sheets across several tabs atomically, keeps contents and active choice, and undoes once", () => {
    let book = sample();
    for (let i = 0; i < 3; i++) book = changeSheet(book, "add");
    const ids = book.sheets!.map((s) => s.id);
    const moved = changeSheet(book, "after", ids[0], ids[3]);
    expect(moved.sheets!.map((s) => s.id)).toEqual([
      ids[1],
      ids[2],
      ids[3],
      ids[0],
    ]);
    expect(moved.slides).toBe(book.slides);
    expect(moved.activeSheetId).toBe(book.activeSheetId);
    expect(changeSheet(moved, "before", ids[0], ids[1]).sheets).toEqual(
      book.sheets,
    );
    expect(changeSheet(book, "before", ids[0], ids[1])).toBe(book);
    expect(changeSheet(book, "after", ids[0], ids[0])).toBe(book);
    expect(() => changeSheet(book, "after", ids[0], "missing")).toThrow();
    const doc = createSharedDeck(book);
    const undo = new Y.UndoManager(doc.getMap("sheets"), {
      trackedOrigins: new Set([LOCAL_CHANGE]),
    });
    applyDeckChange(doc, book, moved);
    expect(readSharedDeck(doc).sheets).toEqual(moved.sheets);
    undo.undo();
    expect(readSharedDeck(doc).sheets).toEqual(book.sheets);
  });
  it("duplicates an entire sparse row repeatedly with unique IDs, shifts following rows once, and rejects limits atomically", () => {
    const original = sample(),
      next = duplicateRowGroup(original, 0, 5);
    expect(next.slides).toHaveLength(original.slides.length + 15);
    for (let y = 1; y <= 5; y++)
      expect(next.slides.filter((s) => s.y === y).map((s) => s.x)).toEqual([
        0, 1, 2,
      ]);
    expect(next.slides.find((s) => s.id === original.slides[3].id)!.y).toBe(6);
    expect(
      new Set(
        next.slides.flatMap((s) => [s.id, ...s.elements.map((e) => e.id)]),
      ).size,
    ).toBe(next.slides.reduce((n, s) => n + 1 + s.elements.length, 0));
    for (const n of [0, -1, 1.5, 99])
      expect(() => duplicateRowGroup(original, 0, n)).toThrow();
    expect(original.slides).toHaveLength(5);
  });
  it("keeps a four-page column in a 2 by 2 virtual grid without changing coordinates", () => {
    const slides = Array.from({ length: 4 }, (_, y) => blank(0, y));
    const selected = slides.filter((s) =>
      matchesFilter(s, { ids: [], rows: [], columns: [0] }),
    );
    expect(balancedGrid(selected.length)).toEqual({ cols: 2, rows: 2 });
    for (let n = 1; n <= 1000; n++) {
      const g = balancedGrid(n);
      expect(g.cols * g.rows).toBeGreaterThanOrEqual(n);
      expect(Math.abs(g.cols - g.rows)).toBeLessThanOrEqual(1);
    }
    expect(slides.map((s) => s.y)).toEqual([0, 1, 2, 3]);
  });

  it("selects real rows and columns, supports individual exclusions, and toggles groups back off", () => {
    const pages = Array.from({ length: 6 }, (_, i) =>
      blank(i % 2, Math.floor(i / 2)),
    );
    const column = pages.filter((s) => s.x === 0),
      row = pages.filter((s) => s.y === 1);
    let filter = toggleFilterGroup(emptyFilter(), column, "columns", 0);
    expect(pages.filter((s) => matchesFilter(s, filter))).toEqual(column);
    filter = toggleFilterSlide(filter, column[1]);
    expect(groupSelection(column, filter)).toBe("mixed");
    expect(matchesFilter(column[1], filter)).toBe(false);
    filter = toggleFilterGroup(filter, row, "rows", 1);
    expect(row.every((s) => matchesFilter(s, filter))).toBe(true);
    filter = toggleFilterGroup(filter, row, "rows", 1);
    expect(row.some((s) => matchesFilter(s, filter))).toBe(false);
    filter = toggleFilterGroup(filter, column, "columns", 0);
    expect(column.every((s) => matchesFilter(s, filter))).toBe(true);
    filter = toggleFilterGroup(filter, column, "columns", 0);
    expect(pages.some((s) => matchesFilter(s, filter))).toBe(false);
  });
  it("merges simultaneous sheet additions and edits, preserving local-only sheet choice and own-only undo", () => {
    const base = sample(),
      a = createSharedDeck(base),
      b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "server");
    const undo = new Y.UndoManager([a.getMap("slides"), a.getMap("sheets")], {
      trackedOrigins: new Set([LOCAL_CHANGE]),
    });
    const added = changeSheet(base, "add"),
      other = changeSheet(base, "add");
    applyDeckChange(a, base, added);
    applyDeckChange(b, base, other);
    sharedText(b, base.slides[0].id, base.slides[0].elements[0].id)!.insert(
      0,
      "相手の入力",
    );
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), "server");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "server");
    const result = readSharedDeck(a);
    expect(result.sheets).toHaveLength(3);
    expect(result.slides).toHaveLength(7);
    expect(result.activeSheetId).toBeUndefined();
    expect(parseDeck(JSON.stringify(result))).toEqual(result);
    undo.undo();
    expect(readSharedDeck(a).sheets).toHaveLength(2);
    expect(
      sharedText(
        a,
        base.slides[0].id,
        base.slides[0].elements[0].id,
      )!.toString(),
    ).toContain("相手の入力");
  });
});
