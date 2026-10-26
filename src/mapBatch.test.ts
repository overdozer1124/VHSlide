import { it, expect } from "vitest";
import { blank, parseDeck, type Deck } from "./model";
import { batchAxes, removeSelectedPages } from "./mapBatch";
import { axisGrant, axisIndex } from "./axes";
import { assertDeckAccess, canEdit, defaultAccess } from "./permissions";
const book = (): Deck => ({
  version: 1,
  title: "一括",
  activeSheetId: "main",
  sheets: [
    {
      id: "main",
      name: "一枚",
      rowLabels: { 0: "A", 1: "B", 2: "C" },
      columnLabels: { 0: "問", 1: "答", 2: "次" },
    },
  ],
  slides: Array.from({ length: 9 }, (_, i) => ({
    ...blank(i % 3, Math.floor(i / 3)),
    id: `p${i}`,
  })),
});
it("inserts entire blank rows and columns in one change, preserving old content, axes and labels", () => {
  for (const axis of ["rows", "columns"] as const) {
    const b = book(),
      grant = axisGrant(b, "main", axis, 1),
      next = batchAxes(b, axis, "add", 1, 2);
    expect(next.slides).toHaveLength(15);
    expect(axisIndex(next, axis, grant)).toBe(3);
    expect(
      next.slides.find((s) => s.id === "p4")?.[axis === "rows" ? "y" : "x"],
    ).toBe(3);
    expect(
      canEdit(
        { ...defaultAccess(), mode: "scoped", [axis]: [grant] },
        next.slides.find((s) => s.id === "p4")!,
        next,
      ),
    ).toBe(true);
    expect(parseDeck(JSON.stringify(next)).slides).toHaveLength(15);
    expect(new Set(next.slides.map((s) => `${s.x},${s.y}`)).size).toBe(15);
  }
});
it("deletes a contiguous range and closes its gaps without reusing deleted axis grants", () => {
  for (const axis of ["rows", "columns"] as const) {
    const b = book(),
      gone = axisGrant(b, "main", axis, 1),
      survive = axisGrant(b, "main", axis, 2),
      next = batchAxes(b, axis, "delete", 0, 2);
    expect(next.slides).toHaveLength(3);
    expect(axisIndex(next, axis, gone)).toBeUndefined();
    expect(axisIndex(next, axis, survive)).toBe(0);
    expect(parseDeck(JSON.stringify(next)).slides).toHaveLength(3);
  }
});
it("rejects invalid ranges and limits atomically", () => {
  const b = book(),
    original = JSON.stringify(b);
  for (const [action, start, count] of [
    ["add", 0, 98],
    ["delete", 2, 2],
    ["add", -1, 1],
    ["add", 1, 0],
    ["delete", 0, NaN],
  ] as const)
    expect(() => batchAxes(b, "rows", action, start, count)).toThrow();
  const large = {
    ...b,
    slides: Array.from({ length: 1000 }, (_, i) => ({
      ...blank(i % 100, Math.floor(i / 100)),
      id: `l${i}`,
    })),
  };
  expect(() => batchAxes(large, "rows", "add", 10, 1)).toThrow("1000");
  expect(JSON.stringify(b)).toBe(original);
});
it("removes only selected IDs, preserves untouched positions and an empty origin, and allows undo snapshot restoration", () => {
  const b = book(),
    next = removeSelectedPages(b, ["p0", "p4", "missing"]);
  expect(next.slides.some((s) => s.id === "p0" || s.id === "p4")).toBe(false);
  expect(next.slides.find((s) => s.id === "p1")).toEqual(b.slides[1]);
  expect(next.slides.some((s) => s.x === 0 && s.y === 0)).toBe(true);
  expect(next.slides).toHaveLength(8);
  expect(parseDeck(JSON.stringify(next)).slides).toHaveLength(8);
  const empty = removeSelectedPages(
    b,
    b.slides.map((s) => s.id),
  );
  expect(empty.slides).toHaveLength(1);
  expect(empty.slides[0].elements).toEqual([]);
  expect(b.slides).toHaveLength(9);
});
it("requires host structure authority and all selected page rights, without silently deleting a permitted subset", () => {
  const b = book(),
    access = {
      ...defaultAccess(),
      mode: "scoped" as const,
      rows: [axisGrant(b, "main", "rows", 1)],
    };
  expect(() =>
    assertDeckAccess(b, batchAxes(b, "rows", "add", 2, 1), access, false),
  ).toThrow();
  expect(() =>
    assertDeckAccess(b, removeSelectedPages(b, ["p3", "p4"]), access, false),
  ).not.toThrow();
  expect(() =>
    assertDeckAccess(b, removeSelectedPages(b, ["p3", "p7"]), access, false),
  ).toThrow();
  expect(() =>
    assertDeckAccess(b, batchAxes(b, "rows", "delete", 0, 3), access, true),
  ).not.toThrow();
});
