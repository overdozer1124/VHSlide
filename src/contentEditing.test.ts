import { expect, it } from "vitest";
import * as Y from "yjs";
import { blank, parseDeck, uid, type Deck, type Element } from "./model";
import { parseCrop, coverCrop } from "./imageData";
import {
  parseRichText,
  textDelta,
  alignRichParagraphs,
  richPlain,
} from "./richText";
import {
  createSharedDeck,
  readSharedDeck,
  applyDeckChange,
  sharedText,
  LOCAL_CHANGE,
} from "./sharedDeck";
import { enableRichText } from "./sharedRichText";
it("whole-box alignment preserves inline and list styles and produces valid paragraph deltas", () => {
  const ops = [
    { insert: "hello\nworld", attributes: { italic: true } },
    {
      insert: "\n",
      attributes: { list: "ordered" as const, align: "center" as const },
    },
  ];
  const original = JSON.stringify(ops),
    plain = richPlain(ops);
  const right = alignRichParagraphs(ops, "right");
  expect(parseRichText(right, plain)).toEqual(right);
  expect(
    right
      .filter((o) => o.insert === "\n")
      .every((o) => o.attributes?.align === "right"),
  ).toBe(true);
  expect(right.at(-1)?.attributes?.list).toBe("ordered");
  expect(right[0].attributes?.italic).toBe(true);
  const left = alignRichParagraphs(right, "left");
  expect(left.every((o) => o.attributes?.align === undefined)).toBe(true);
  expect(richPlain(left)).toBe(plain);
  expect(JSON.stringify(ops)).toBe(original);
});
import {
  createTable,
  changeTableAxis,
  pasteTable,
  cellKey,
  parseTable,
} from "./tableData";
import { applyAuthorizedUpdate } from "./authorizeUpdate";
import { defaultAccess } from "./permissions";
import { backupSnapshot } from "./backupData";
import { createBackupArchive, readBackupArchive } from "./backupArchive";
const text: Element = {
  id: "text",
  type: "text",
  x: 20,
  y: 20,
  w: 400,
  h: 120,
  text: "Hello\nWorld",
  fontSize: 24,
  color: "#173d38",
};
const book = (elements: Element[]): Deck => ({
  version: 1,
  title: "第2段階",
  slides: [{ ...blank(0, 0), elements }],
});
it("validates rich insert deltas, safe crop and cell styles; rejects HTML-like attributes, embeds and inconsistent text", () => {
  const delta = [
    { insert: "Hello", attributes: { bold: true, color: "#ff0000" } },
    { insert: "\n", attributes: { list: "ordered" as const } },
    { insert: "World\n" },
  ];
  const d = book([{ ...text, richText: delta }]);
  expect(parseDeck(JSON.stringify(d))).toEqual(d);
  for (const richText of [
    [{ insert: { image: "x" } }],
    [{ insert: "wrong\n" }],
    [{ insert: "Hello\nWorld\n", attributes: { link: "javascript:alert(1)" } }],
    [{ insert: "Hello\nWorld\n", attributes: { align: "center" } }],
  ])
    expect(() => parseRichText(richText, text.text!)).toThrow();
  expect(coverCrop(2, 1, 2)).toEqual({ x: 0.375, y: 0.25, w: 0.25, h: 0.5 });
  for (const c of [
    { x: 0, y: 0, w: 0, h: 1 },
    { x: 0.8, y: 0, w: 0.3, h: 1 },
    { x: NaN, y: 0, w: 1, h: 1 },
  ])
    expect(() => parseCrop(c)).toThrow();
  const t = createTable(2, 2, uid),
    key = cellKey(t.rows[0], t.columns[0]);
  for (const s of [{ fill: "red" }, { fontSize: 500 }, { evil: "<img>" }])
    expect(() => parseTable({ ...t, styles: { [key]: s } })).toThrow();
  expect(() => parseTable({ ...t, widths: { foreign: 2 } })).toThrow();
});
it("migrates legacy text without replacing characters; independent format and content updates converge; own Undo preserves remote typing", () => {
  const d = book([text]),
    a = createSharedDeck(d),
    b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const beforeText = sharedText(a, d.slides[0].id, "text")!;
  enableRichText(beforeText, text);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const undo = new Y.UndoManager(a.getMap("slides"), {
    trackedOrigins: new Set([LOCAL_CHANGE]),
  });
  a.transact(() => beforeText.format(0, 5, { bold: true }), LOCAL_CHANGE);
  b.transact(
    () => sharedText(b, d.slides[0].id, "text")!.insert(5, "!"),
    "remote",
  );
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), "server");
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "server");
  expect(readSharedDeck(a)).toEqual(readSharedDeck(b));
  expect(readSharedDeck(a).slides[0].elements[0].text).toBe("Hello!\nWorld");
  undo.undo();
  const result = readSharedDeck(a).slides[0].elements[0];
  expect(result.text).toContain("!");
  expect(result.richText!.some((o) => o.attributes?.bold)).toBe(false);
  expect(parseDeck(JSON.stringify(readSharedDeck(a)))).toEqual(
    readSharedDeck(a),
  );
  const unauthorized = new Y.Doc();
  Y.applyUpdate(unauthorized, Y.encodeStateAsUpdate(b));
  const update = Y.encodeStateAsUpdate(a);
  expect(() =>
    applyAuthorizedUpdate(b, unauthorized, update, defaultAccess(), false),
  ).toThrow();
});
it("merges first-use cell styles on different properties and width changes independently of typing", () => {
  const t = createTable(2, 2, uid),
    e: Element = {
      id: "table",
      type: "table",
      x: 20,
      y: 20,
      w: 500,
      h: 200,
      table: t,
      fontSize: 24,
      color: "#173d38",
      fill: "#ffffff",
      stroke: "#173d38",
    };
  const d = book([e]),
    a = createSharedDeck(d),
    b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const key = cellKey(t.rows[0], t.columns[0]);
  for (const [doc, patch] of [
    [a, { fill: "#ff0000" }],
    [b, { bold: true }],
  ] as const) {
    const before = readSharedDeck(doc),
      after = structuredClone(before);
    after.slides[0].elements[0].table!.styles = { [key]: patch };
    applyDeckChange(doc, before, after);
  }
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  expect(readSharedDeck(a)).toEqual(readSharedDeck(b));
  expect(readSharedDeck(a).slides[0].elements[0].table!.styles![key]).toEqual({
    fill: "#ff0000",
    bold: true,
  });
});
it("inserts/deletes axes with stable IDs, retains surviving styles and widths, and pastes quoted TSV atomically", () => {
  let t = createTable(2, 2, uid);
  const row = t.rows[0],
    col = t.columns[0],
    key = cellKey(row, col);
  t = { ...t, styles: { [key]: { fill: "#ff0000" } }, widths: { [col]: 2 } };
  const next = changeTableAxis(t, "rows", "insert", 0, uid);
  expect(next.rows[1]).toBe(row);
  expect(next.styles).toEqual(t.styles);
  expect(changeTableAxis(next, "rows", "delete", 0, uid)).toEqual(t);
  const pasted = pasteTable(t, key, '"hello\nworld"\tB\tC\nD\tE\tF\n', uid);
  expect(pasted.table.columns).toHaveLength(3);
  expect(pasted.table.cells[key]).toBe("hello\nworld");
  expect(pasted.keys).toHaveLength(6);
  expect(() => pasteTable(t, key, "x\t".repeat(13), uid)).toThrow();
  expect(t.columns).toHaveLength(2);
});
it("round trips rich labels, crop, alt text, styled tables and axis sizes through ZIP v1", async () => {
  const t = createTable(1, 1, uid),
    key = cellKey(t.rows[0], t.columns[0]);
  const d = book([
    { ...text, richText: textDelta({ ...text, bold: true }) },
    {
      id: "table",
      type: "table",
      x: 10,
      y: 200,
      w: 500,
      h: 100,
      table: {
        ...t,
        styles: { [key]: { fill: "#ff0000", textAlign: "center" } },
        widths: { [t.columns[0]]: 2 },
        heights: { [t.rows[0]]: 0.5 },
      },
      fontSize: 24,
      color: "#173d38",
      fill: "#ffffff",
      stroke: "#173d38",
    },
  ]);
  const s = backupSnapshot(d, [], [], []),
    zip = await createBackupArchive(s, async () => {
      throw Error("no images");
    });
  expect((await readBackupArchive(zip)).snapshot.deck).toEqual(
    parseDeck(JSON.stringify(d)),
  );
  const image = {
    id: "pic",
    type: "image" as const,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    src: "data:image/png;base64,aGVsbG8=",
    crop: coverCrop(2, 1),
    altText: "赤い花",
  };
  expect(
    parseDeck(JSON.stringify(book([image]))).slides[0].elements[0],
  ).toEqual(image);
});
it("concurrent legacy migrations retain one terminal, and emoji formatting/replacement never splits a surrogate", async () => {
  const { normalizeRichTerminals, changeRichText } =
    await import("./sharedRichText");
  const d = book([{ ...text, text: "😀日本語" }]),
    a = createSharedDeck(d),
    b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  for (const doc of [a, b])
    enableRichText(
      sharedText(doc, d.slides[0].id, "text")!,
      d.slides[0].elements[0],
    );
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  expect(readSharedDeck(a).slides[0].elements[0].text).toBe("😀日本語");
  for (const doc of [a, b])
    normalizeRichTerminals(sharedText(doc, d.slides[0].id, "text")!);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  expect(readSharedDeck(a)).toEqual(readSharedDeck(b));
  const value = sharedText(a, d.slides[0].id, "text")!;
  changeRichText(
    value,
    [{ insert: "😀日本語\n" }],
    [{ insert: "😁日本語\n", attributes: { bold: true } }],
  );
  expect(readSharedDeck(a).slides[0].elements[0].text).toBe("😁日本語");
  expect(
    readSharedDeck(a).slides[0].elements[0].richText!.some((o) =>
      o.insert.includes("�"),
    ),
  ).toBe(false);
  const before = readSharedDeck(a),
    after = structuredClone(before);
  after.slides[0].elements[0].richText = [
    { insert: "😁日本語\n", attributes: { italic: true } },
  ];
  applyDeckChange(a, before, after);
  expect(readSharedDeck(a).slides[0].elements[0].text).toBe("😁日本語");
});
