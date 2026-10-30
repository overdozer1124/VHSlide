import { it, expect } from "vitest";
import * as Y from "yjs";
import { blank, uid, parseDeck } from "./model";
import type { Deck, Element } from "./model";
import { createTable, resizeTable, parseTable, cellKey } from "./tableData";
import {
  applyDeckChange,
  createSharedDeck,
  readSharedDeck,
  LOCAL_CHANGE,
} from "./sharedDeck";
import { applyAuthorizedUpdate } from "./authorizeUpdate";
import { defaultAccess } from "./permissions";
import { backupSnapshot } from "./backupData";
import { createBackupArchive, readBackupArchive } from "./backupArchive";
function fixture(): Deck {
  const t = createTable(2, 2, uid);
  const e: Element = {
    id: uid(),
    type: "table",
    table: t,
    x: 100,
    y: 100,
    w: 600,
    h: 250,
    fontSize: 24,
    color: "#173d38",
    fill: "#ffffff",
    stroke: "#79958b",
    textAlign: "left",
  };
  return {
    version: 1,
    title: "表のテスト",
    slides: [{ ...blank(0, 0), elements: [e] }],
  };
}
const table = (d: Deck) => d.slides[0].elements[0].table!;
function edit(doc: Y.Doc, row: number, col: number, value: string) {
  const before = readSharedDeck(doc),
    after = structuredClone(before),
    t = table(after);
  t.cells[cellKey(t.rows[row], t.columns[col])] = value;
  applyDeckChange(doc, before, after);
}
it("roundtrips tables through JSON and ZIP v1 and rejects malformed cells, dimensions and oversized text", async () => {
  const d = fixture(),
    t = table(d);
  t.cells[cellKey(t.rows[0], t.columns[0])] =
    "日本語\n<script>plain text</script>";
  expect(parseDeck(JSON.stringify(d))).toEqual(d);
  const archive = await createBackupArchive(
    backupSnapshot(d, [], [], []),
    async () => {
      throw new Error("no images");
    },
  );
  expect((await readBackupArchive(archive)).snapshot.deck).toEqual(d);
  for (const bad of [
    { ...t, rows: [] },
    { ...t, columns: Array(13).fill("x") },
    { ...t, rows: ["same", "same"] },
    { ...t, cells: { "foreign:cell": "secret" } },
    { ...t, cells: { [cellKey(t.rows[0], t.columns[0])]: "a".repeat(2001) } },
  ])
    expect(() => parseTable(bad)).toThrow();
});
it("adds/removes axes while keeping stable cell identities and unrelated content", () => {
  const t = table(fixture()),
    key = cellKey(t.rows[0], t.columns[0]);
  t.cells[key] = "保持";
  const larger = resizeTable(t, "rows", 1, uid);
  expect(larger.rows.slice(0, 2)).toEqual(t.rows);
  expect(larger.cells[key]).toBe("保持");
  expect(Object.keys(larger.cells)).toHaveLength(6);
  expect(resizeTable(larger, "rows", -1, uid)).toEqual(t);
  expect(
    resizeTable(createTable(1, 1, uid), "columns", -1, uid).columns,
  ).toHaveLength(1);
});
it("merges simultaneous cell edits including the same initially empty cell and undo affects only local edits", () => {
  const initial = fixture(),
    a = createSharedDeck(initial),
    b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const undo = new Y.UndoManager(a.getMap("slides"), {
    trackedOrigins: new Set([LOCAL_CHANGE]),
  });
  edit(a, 0, 0, "A");
  edit(b, 1, 1, "B");
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  expect(readSharedDeck(a)).toEqual(readSharedDeck(b));
  expect(Object.values(table(readSharedDeck(a)).cells)).toContain("A");
  expect(Object.values(table(readSharedDeck(a)).cells)).toContain("B");
  undo.undo();
  expect(Object.values(table(readSharedDeck(a)).cells)).toContain("B");
  expect(Object.values(table(readSharedDeck(a)).cells)).not.toContain("A");
  const c = createSharedDeck(initial),
    e = new Y.Doc();
  Y.applyUpdate(e, Y.encodeStateAsUpdate(c));
  edit(c, 0, 0, "左");
  edit(e, 0, 0, "右");
  Y.applyUpdate(c, Y.encodeStateAsUpdate(e));
  Y.applyUpdate(e, Y.encodeStateAsUpdate(c));
  const merged = table(readSharedDeck(c)).cells[
    cellKey(table(initial).rows[0], table(initial).columns[0])
  ];
  expect(merged).toHaveLength(2);
  expect(merged).toContain("左");
  expect(merged).toContain("右");
  expect(readSharedDeck(c)).toEqual(readSharedDeck(e));
  for (const doc of [a, b, c, e]) doc.destroy();
  undo.destroy();
});
it("keeps concurrent existing-cell text when adding a column and enforces server edit scopes on nested text", () => {
  const initial = fixture(),
    a = createSharedDeck(initial),
    b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const before = readSharedDeck(a),
    after = structuredClone(before);
  after.slides[0].elements[0].table = resizeTable(
    table(after),
    "columns",
    1,
    uid,
  );
  applyDeckChange(a, before, after);
  edit(b, 0, 1, "共同編集");
  const candidate = new Y.Doc();
  Y.applyUpdate(candidate, Y.encodeStateAsUpdate(a));
  expect(() =>
    applyAuthorizedUpdate(
      a,
      candidate,
      Y.encodeStateAsUpdate(b),
      defaultAccess(),
      false,
    ),
  ).toThrow();
  const accepted = new Y.Doc();
  Y.applyUpdate(accepted, Y.encodeStateAsUpdate(a));
  applyAuthorizedUpdate(
    a,
    accepted,
    Y.encodeStateAsUpdate(b),
    { ...defaultAccess(), mode: "all" },
    false,
  );
  expect(table(readSharedDeck(accepted)).columns).toHaveLength(3);
  expect(Object.values(table(readSharedDeck(accepted)).cells)).toContain(
    "共同編集",
  );
  for (const doc of [a, b, candidate, accepted]) doc.destroy();
});
it("keeps surviving cells editable after concurrent incompatible row changes", () => {
  const initial = fixture(),
    a = createSharedDeck(initial),
    b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  a.clientID = 100;
  b.clientID = 200;
  for (const [doc, delta] of [
    [a, -1],
    [b, 1],
  ] as const) {
    const before = readSharedDeck(doc),
      after = structuredClone(before);
    after.slides[0].elements[0].table = resizeTable(
      table(after),
      "rows",
      delta,
      uid,
    );
    applyDeckChange(doc, before, after);
  }
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  expect(readSharedDeck(a)).toEqual(readSharedDeck(b));
  expect(table(readSharedDeck(a)).rows).toHaveLength(3);
  edit(a, 1, 0, "編集を再開");
  expect(Object.values(table(readSharedDeck(a)).cells)).toContain("編集を再開");
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  expect(readSharedDeck(a)).toEqual(readSharedDeck(b));
  a.destroy();
  b.destroy();
});
