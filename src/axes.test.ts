import { expect, it } from "vitest";
import * as Y from "yjs";
import { axisGrant, axisId, axisIndex } from "./axes";
import {
  blank,
  duplicateRowGroup,
  insertGridLine,
  insert,
  movePage,
  moveRowGroup,
  parseDeck,
  removeRowGroup,
  swap,
} from "./model";
import type { Deck } from "./model";
import { canEdit, defaultAccess, parseAccess } from "./permissions";
import { applyAuthorizedUpdate } from "./authorizeUpdate";
import {
  applyDeckChange,
  createSharedDeck,
  LOCAL_CHANGE,
  readSharedDeck,
} from "./sharedDeck";
import { changeSheet, mergeSheet, sheetDeck } from "./workbook";
import { sharedAccountNames } from "./preSharing";
import { thumbnailLabel } from "./ThumbnailFooter";
const book = (): Deck => ({
  version: 1,
  title: "担当",
  slides: [blank(0, 0), blank(1, 0), blank(0, 1), blank(1, 1)],
  sheets: [
    {
      id: "main",
      name: "シート1",
      rowLabels: { "0": "A班", "1": "B班" },
      columnLabels: { "0": "問い", "1": "答え" },
    },
  ],
});
const rights = () => ({
  ...defaultAccess(),
  mode: "scoped" as const,
  rows: [{ sheetId: "main", index: 0 }],
});
it("keeps legacy row permissions, labels and account names attached through reorder and JSON", () => {
  const before = book(),
    access = rights(),
    after = parseDeck(JSON.stringify(moveRowGroup(before, 0, 1)));
  const original = after.slides.find((s) => s.id === before.slides[0].id)!;
  const other = after.slides.find((s) => s.id === before.slides[2].id)!;
  expect(canEdit(access, original, after)).toBe(true);
  expect(canEdit(access, other, after)).toBe(false);
  expect(axisIndex(after, "rows", access.rows[0])).toBe(1);
  expect(after.sheets![0].rowLabels).toEqual({ "0": "B班", "1": "A班" });
  const labels = sharedAccountNames(
    [{ email: "a@school.example", name: "Aさん", access }],
    [],
  );
  expect(thumbnailLabel(original, labels, after)).toBe("Aさん");
  expect(thumbnailLabel(other, labels, after)).toBe(other.title);
});
it("moves column grants and headings when swapping or inserting entire columns", () => {
  const before = book(),
    access = {
      ...rights(),
      rows: [],
      columns: [{ sheetId: "main", index: 0 }],
    };
  const after = swap(before, "column", { x: 0, y: 0 }, { x: 1, y: 0 });
  expect(after.sheets![0].columnLabels).toEqual({ "0": "答え", "1": "問い" });
  expect(canEdit(access, after.slides[0], after)).toBe(true);
  expect(canEdit(access, after.slides[1], after)).toBe(false);
  const added = insert(before, before.slides[0], "right");
  expect(axisId(added, "main", "columns", 2)).toBe("1");
  expect(axisId(added, "main", "columns", 1)).not.toBe("1");
});
it("does not give duplicated, inserted or replacement rows an existing person's grant", () => {
  const before = book(),
    access = { ...rights(), rows: [{ sheetId: "main", index: 1 }] };
  for (const next of [
    duplicateRowGroup(before, 0, 3),
    insertGridLine(before, "row", 1, 0),
  ]) {
    expect(
      canEdit(
        access,
        next.slides.find((s) => s.id === before.slides[2].id)!,
        next,
      ),
    ).toBe(true);
    for (const page of next.slides.filter(
      (s) => !before.slides.some((old) => old.id === s.id),
    ))
      expect(canEdit(access, page, next)).toBe(false);
    expect(parseDeck(JSON.stringify(next))).toEqual(next);
  }
  const deleted = removeRowGroup(before, 0);
  expect(canEdit(rights(), deleted.slides[0], deleted)).toBe(false);
  expect(axisIndex(deleted, "rows", rights().rows[0])).toBeUndefined();
});
it("uses the destination row for individual pages and still checks both sides of a guest move", () => {
  const before = book(),
    next = movePage(before, before.slides[1].id, 1, 1),
    access = rights();
  expect(
    canEdit(
      access,
      next.slides.find((s) => s.id === before.slides[1].id)!,
      next,
    ),
  ).toBe(false);
  const doc = createSharedDeck(before);
  const working = new Y.Doc();
  Y.applyUpdate(working, Y.encodeStateAsUpdate(doc));
  const vector = Y.encodeStateVector(working);
  applyDeckChange(working, before, next);
  const candidate = new Y.Doc();
  Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
  expect(() =>
    applyAuthorizedUpdate(
      doc,
      candidate,
      Y.encodeStateAsUpdate(working, vector),
      access,
      false,
    ),
  ).toThrow();
  for (const d of [doc, working, candidate]) d.destroy();
});
it("CRDT undo restores coordinates, identities and grants together without reverting remote text", () => {
  const before = book(),
    doc = createSharedDeck(before),
    undo = new Y.UndoManager([doc.getMap("sheets"), doc.getMap("slides")], {
      trackedOrigins: new Set([LOCAL_CHANGE]),
    });
  applyDeckChange(doc, before, moveRowGroup(before, 0, 1));
  expect(axisId(readSharedDeck(doc), "main", "rows", 1)).toBe("0");
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  const v = Y.encodeStateVector(peer);
  (
    peer
      .getMap<Y.Map<unknown>>("slides")
      .get(before.slides[0].id)!
      .get("title") as Y.Text
  ).insert(0, "相手の変更");
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, v), "server");
  undo.undo();
  const restored = readSharedDeck(doc);
  expect(restored.slides.find((s) => s.id === before.slides[0].id)!.y).toBe(0);
  expect(axisId(restored, "main", "rows", 0)).toBe("0");
  expect(
    restored.slides.find((s) => s.id === before.slides[0].id)!.title,
  ).toContain("相手の変更");
  undo.redo();
  expect(axisId(readSharedDeck(doc), "main", "rows", 1)).toBe("0");
  undo.destroy();
  doc.destroy();
  peer.destroy();
});
it("preserves active-sheet metadata on commit and isolates duplicated sheets' permissions", () => {
  const before = book(),
    next = mergeSheet(before, moveRowGroup(sheetDeck(before), 0, 1));
  expect(axisId(next, "main", "rows", 1)).toBe("0");
  const copied = changeSheet(next, "duplicate");
  expect(canEdit(rights(), sheetDeck(copied).slides[0], copied)).toBe(false);
  const fresh = axisGrant(next, "main", "rows", 0);
  expect(fresh.axisId).toBe("1");
  expect(parseAccess({ ...rights(), rows: [fresh] }).rows[0]).toEqual(fresh);
});
it("rejects duplicated, oversized and malformed identity metadata", () => {
  const invalid: Record<string, string>[] = [
    { "0": "1" },
    { "0": "" },
    { "100": "bad" },
    { "0": "x".repeat(81) },
  ];
  for (const rowIds of invalid) {
    const d = book();
    d.sheets![0].rowIds = rowIds;
    expect(() => parseDeck(JSON.stringify(d))).toThrow();
  }
  expect(() =>
    parseAccess({
      ...rights(),
      rows: [{ sheetId: "main", index: 0, axisId: 17 }],
    }),
  ).toThrow();
});
