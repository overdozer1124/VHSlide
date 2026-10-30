import { expect, it } from "vitest";
import { blank, moveRowGroup, removeRowGroup, swap, type Deck } from "./model";
import { defaultAccess } from "./permissions";
import { bindMapFilter, resolveMapFilter, resolvePageScope } from "./pageScope";
import {
  presentationState,
  presentationNeighbor,
  type PresentationSession,
} from "./presentationSession";
import { balancedGrid } from "./mapFilter";
const book = (): Deck => ({
  version: 1,
  title: "範囲",
  sheets: [
    { id: "z", name: "先のシート", rowLabels: { 0: "A", 1: "B", 2: "C" } },
    { id: "a", name: "次のシート" },
  ],
  activeSheetId: "z",
  slides: [
    ...Array.from({ length: 9 }, (_, i) => ({
      ...blank(i % 3, Math.floor(i / 3)),
      id: `p${i}`,
      sheetId: "z",
    })),
    { ...blank(0, 0), id: "q", sheetId: "a" },
  ],
});
it("orders candidates by sheet order and coordinates, independently of edit access and clicked order", () => {
  const b = book();
  b.slides.reverse();
  expect(resolvePageScope(b, { kind: "book" }, defaultAccess()).ids).toEqual([
    ...Array.from({ length: 9 }, (_, i) => `p${i}`),
    "q",
  ]);
  expect(
    resolvePageScope(b, { kind: "selection", ids: ["q", "p8", "p0"] }).ids,
  ).toEqual(["p0", "p8", "q"]);
});
it("binds row and column choices to stable identities with OR and exclusions", () => {
  const b = book(),
    filter = bindMapFilter(b, "z", {
      ids: ["p8"],
      rows: [0],
      columns: [1],
      excludedIds: ["p1"],
    });
  const expected = resolvePageScope(b, {
    kind: "filter",
    sheetId: "z",
    filter,
  }).ids;
  const moved = swap(
    moveRowGroup(b, 0, 2),
    "column",
    { x: 1, y: 0 },
    { x: 2, y: 0 },
  );
  expect(
    new Set(
      resolvePageScope(moved, { kind: "filter", sheetId: "z", filter }).ids,
    ),
  ).toEqual(new Set(expected));
  expect(resolveMapFilter(moved, "z", filter).filter.rows).toEqual([2]);
});
it("never falls back to all pages when selected axes, pages or the sheet are deleted", () => {
  const b = book(),
    filter = bindMapFilter(b, "z", { ids: [], rows: [2], columns: [] }),
    deleted = removeRowGroup(b, 2);
  const result = resolvePageScope(deleted, {
    kind: "filter",
    sheetId: "z",
    filter,
  });
  expect(result.ids).toEqual([]);
  expect(result.issues.length).toBeGreaterThan(0);
  expect(
    resolvePageScope(b, {
      kind: "filter",
      sheetId: "z",
      filter: { ids: [], rows: [], columns: [] },
    }).ids,
  ).toEqual([]);
  expect(
    resolvePageScope(
      { ...b, sheets: b.sheets!.filter((s) => s.id !== "z") },
      { kind: "sheet", sheetId: "z" },
    ).ids,
  ).toEqual([]);
});
it("re-resolves assigned pages from current access without narrowing ordinary scopes", () => {
  const b = book(),
    filter = bindMapFilter(b, "z", {
      ids: [],
      rows: [],
      columns: [],
      assigned: true,
    }),
    access = {
      ...defaultAccess(),
      mode: "scoped" as const,
      rows: [{ sheetId: "z", index: 0 }],
    };
  expect(
    resolvePageScope(b, { kind: "filter", sheetId: "z", filter }, access).ids,
  ).toEqual(["p0", "p1", "p2"]);
  access.rows = [{ sheetId: "z", index: 1 }];
  expect(
    resolvePageScope(b, { kind: "filter", sheetId: "z", filter }, access).ids,
  ).toEqual(["p3", "p4", "p5"]);
  expect(
    resolvePageScope(b, { kind: "sheet", sheetId: "z" }, defaultAccess()).ids,
  ).toHaveLength(9);
  expect(
    bindMapFilter(b, "z", { ...filter, assignedIds: ["p0"] }).assignedIds,
  ).toBeUndefined();
});
const session = (
  ids: string[],
  mode: PresentationSession["mode"] = "spatial",
): PresentationSession => ({
  ids,
  mode,
  label: "対象",
  returnTo: { view: "map", sheetId: "z", activeId: "p0" },
});
it("keeps spatial navigation and original coordinates within a frozen membership", () => {
  const b = book(),
    s = session(["p1", "p4", "p7"]),
    state = presentationState(b, s, "p1");
  expect(presentationNeighbor(state, s.mode, 0, 1)?.id).toBe("p4");
  expect(presentationNeighbor(state, s.mode, 1, 0)).toBeUndefined();
  expect(state.slide?.x).toBe(1);
  expect(state.deck.slides).toHaveLength(3);
  expect(balancedGrid(4)).toEqual({ cols: 2, rows: 2 });
  const expanded = {
    ...b,
    slides: [...b.slides, { ...blank(1, 3), id: "new", sheetId: "z" }],
  };
  expect(presentationState(expanded, s, "p1").pages.map((p) => p.id)).toEqual(
    s.ids,
  );
});
it("skips removed current pages forward then backward and does not project an unrelated fallback", () => {
  const b = book(),
    s = session(["p1", "p4", "p7"]);
  expect(
    presentationState(
      { ...b, slides: b.slides.filter((p) => p.id !== "p4") },
      s,
      "p4",
    ).slide?.id,
  ).toBe("p7");
  expect(
    presentationState(
      { ...b, slides: b.slides.filter((p) => p.id !== "p7") },
      s,
      "p7",
    ).slide?.id,
  ).toBe("p4");
  expect(
    presentationState(
      { ...b, slides: b.slides.filter((p) => !s.ids.includes(p.id)) },
      s,
      "p1",
    ).slide,
  ).toBeUndefined();
});
it("keeps explicit saved route order and isolates out-of-scope excursions", () => {
  const b = book(),
    s = session(["p8", "q", "p0"], "route"),
    state = presentationState(b, s, "p8");
  expect(presentationNeighbor(state, s.mode, 1, 0)?.id).toBe("q");
  const external = presentationState(b, s, "p4", true);
  expect(external.external).toBe(true);
  expect(presentationNeighbor(external, s.mode, 1, 0)).toBeUndefined();
  expect(external.pages.map((p) => p.id)).toEqual(s.ids);
});
