import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as Y from "yjs";
import {
  blank,
  sample,
  parseDeck,
  serializeDeck,
  swapRowGroups,
} from "./model";
import { assignedSlides, routeSlides } from "./learningTools";
import { defaultAccess } from "./permissions";
import {
  createSharedDeck,
  readSharedDeck,
  applyDeckChange,
} from "./sharedDeck";
import { applyAuthorizedUpdate } from "./authorizeUpdate";
import { backupSnapshot } from "./backupData";
import {
  historySchema,
  historySave,
  historyRead,
  historyList,
  historyBeforeChange,
} from "./historyStore";

it("keeps assignments attached to the stable row across reordering and sheets", () => {
  const book = sample();
  const access = {
    ...defaultAccess(),
    mode: "scoped" as const,
    rows: [{ sheetId: "main", index: 0 }],
  };
  const mine = assignedSlides(book, access)
    .map((s) => s.id)
    .sort();
  const moved = swapRowGroups(book, 0, 1);
  expect(
    assignedSlides(moved, access)
      .map((s) => s.id)
      .sort(),
  ).toEqual(mine);
  expect(assignedSlides(book, defaultAccess())).toEqual([]);
});
it("round trips cross-sheet routes through JSON, Yjs and backup; non-host route writes are refused", () => {
  const before = sample();
  before.sheets = [
    { id: "main", name: "シート1" },
    { id: "second", name: "シート2" },
  ];
  before.slides.push({ ...blank(0, 0), sheetId: "second" });
  const after = {
    ...before,
    routes: [
      {
        id: "r",
        name: "発表",
        slides: [before.slides.at(-1)!.id, before.slides[0].id],
      },
    ],
  };
  expect(parseDeck(serializeDeck(after)).routes).toEqual(after.routes);
  const doc = createSharedDeck(after);
  expect(readSharedDeck(doc).routes).toEqual(after.routes);
  expect(backupSnapshot(after, [], [], []).deck.routes).toEqual(after.routes);
  const base = createSharedDeck(before),
    guest = new Y.Doc(),
    candidate = new Y.Doc();
  Y.applyUpdate(guest, Y.encodeStateAsUpdate(base));
  Y.applyUpdate(candidate, Y.encodeStateAsUpdate(base));
  const vector = Y.encodeStateVector(guest);
  applyDeckChange(guest, before, after);
  const update = Y.encodeStateAsUpdate(guest, vector);
  expect(() =>
    applyAuthorizedUpdate(
      base,
      candidate,
      update,
      { ...defaultAccess(), mode: "all" },
      false,
    ),
  ).toThrow();
  const host = new Y.Doc();
  Y.applyUpdate(host, Y.encodeStateAsUpdate(base));
  expect(() =>
    applyAuthorizedUpdate(
      base,
      host,
      update,
      { ...defaultAccess(), mode: "all" },
      true,
    ),
  ).not.toThrow();
  expect(readSharedDeck(host).routes).toEqual(after.routes);
  host.destroy();
  base.destroy();
  expect(
    routeSlides(after, {
      id: "r",
      name: "x",
      slides: ["deleted", before.slides[0].id, before.slides[0].id],
    }).map((s) => s.id),
  ).toEqual([before.slides[0].id]);
  doc.destroy();
  guest.destroy();
  candidate.destroy();
});
it("rejects malformed and excessive routes without changing version 1 compatibility", () => {
  const book = sample();
  expect(parseDeck(serializeDeck(book)).routes).toBeUndefined();
  expect(() =>
    parseDeck(
      JSON.stringify({ ...book, routes: [{ id: "r", name: "", slides: [] }] }),
    ),
  ).toThrow();
  expect(() =>
    parseDeck(
      JSON.stringify({
        ...book,
        routes: Array.from({ length: 31 }, (_, i) => ({
          id: String(i),
          name: "x",
          slides: [],
        })),
      }),
    ),
  ).toThrow();
});
it("stores chunked versions, keeps latest ten deterministically and isolates work IDs", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(historySchema);
  const sql = (q: string, ...args: (string | number)[]) =>
    db.prepare(q).all(...args);
  const snapshot = backupSnapshot(sample(), [], [], []);
  snapshot.deck.title = "a".repeat(150);
  const first = historySave(sql, "a", snapshot, "最初");
  historySave(sql, "b", snapshot, "別作品");
  for (let i = 0; i < 12; i++) historySave(sql, "a", snapshot, `版${i}`);
  expect(historyList(sql, "a")).toHaveLength(10);
  expect(historyList(sql, "b")).toHaveLength(1);
  expect(historyList(sql, "a")[0].reason).toBe("版11");
  expect(() => historyRead(sql, "a", first.id)).toThrow();
  const latest = historyList(sql, "a")[0];
  expect(historyRead(sql, "a", latest.id).deck.title).toEqual(
    snapshot.deck.title,
  );
  expect(() => historyRead(sql, "b", latest.id)).toThrow();
  const before = sample(),
    after = { ...before, slides: [before.slides[0]] };
  historyBeforeChange(sql, "a", before, after, () => []);
  expect(historyList(sql, "a")[0].reason).toBe("削除する前");
  expect(
    historyRead(sql, "a", historyList(sql, "a")[0].id).deck.slides,
  ).toHaveLength(before.slides.length);
  db.close();
});
it("rolls back a version with its surrounding data transaction and enforces the byte budget", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(historySchema);
  const sql = (q: string, ...args: (string | number)[]) =>
    db.prepare(q).all(...args);
  const book = sample();
  book.slides[0].elements[0].text = "a".repeat(9000);
  const snapshot = backupSnapshot(book, [], [], []);
  db.exec("BEGIN");
  historySave(sql, "a", snapshot, "未確定");
  db.exec("ROLLBACK");
  expect(historyList(sql, "a")).toHaveLength(0);
  // Each large snapshot remains within version 1's per-element text limits.
  book.slides[0].elements = Array.from({ length: 200 }, (_, i) => ({
    ...book.slides[0].elements[0],
    id: `e-${i}`,
    text: "a".repeat(9000),
  }));
  book.slides[1].elements = book.slides[0].elements.map((e, i) => ({
    ...e,
    id: `other-${i}`,
  }));
  for (let i = 0; i < 15; i++)
    historySave(sql, "a", backupSnapshot(book, [], [], []), `版${i}`);
  const entries = historyList(sql, "a");
  expect(entries.length).toBeLessThan(10);
  expect(entries.reduce((n, e) => n + e.bytes, 0)).toBeLessThanOrEqual(
    20_000_000,
  );
  db.close();
});

it("preserves emoji at SQL chunk boundaries", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(historySchema);
  const sql = (q: string, ...args: (string | number)[]) =>
    db.prepare(q).all(...args);
  const book = sample(),
    element = book.slides[0].elements[0];
  book.slides[0].elements = Array.from({ length: 5 }, (_, i) => ({
    ...element,
    id: `emoji-${i}`,
    text: "😀".repeat(4500),
  }));
  const original = backupSnapshot(book, [], [], []),
    entry = historySave(sql, "emoji", original, "文字");
  expect(historyRead(sql, "emoji", entry.id)).toEqual(original);
  db.close();
});
