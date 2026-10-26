import { axisId } from "./axes";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  blank,
  rememberRowPage,
  rowPage,
  editorNeighbor,
  moveRowGroup,
  swapRowGroups,
  insertMovedRowGroup,
  movePage,
  insertMovedPage,
  insert,
  insertGridLine,
  neighbor,
  parseDeck,
  serializeDeck,
  removeSlide,
  duplicateSlide,
  duplicateRowGroup,
  removeRowGroup,
  sample,
  swap,
} from "./model";
import type { Deck } from "./model";
describe("fixed grid and portable document", () => {
  it("imports the complete 10 by 40 sample", () => {
    const d = parseDeck(
      readFileSync("public/samples/vhslide-10x40.json", "utf8"),
    );
    expect(d.slides).toHaveLength(400);
    expect(new Set(d.slides.map((s) => s.x)).size).toBe(10);
    expect(new Set(d.slides.map((s) => s.y)).size).toBe(40);
    expect(d.slides.at(-1)).toMatchObject({ x: 9, y: 39 });
    expect(
      parseDeck(JSON.stringify(insert(d, d.slides[0], "right"))).slides,
    ).toHaveLength(401);
  });
  it("accepts the 1000th page and rejects import or insertion of a 1001st page", () => {
    const d: Deck = {
      version: 1,
      title: "1000 pages",
      slides: Array.from({ length: 999 }, (_, i) =>
        blank(i % 20, Math.floor(i / 20)),
      ),
    };
    const full = insert(d, d.slides[0], "right");
    expect(parseDeck(JSON.stringify(full)).slides).toHaveLength(1000);
    expect(() =>
      parseDeck(
        JSON.stringify({ ...full, slides: [...full.slides, blank(99, 99)] }),
      ),
    ).toThrow();
    expect(() => insert(full, full.slides[0], "right")).toThrow("1000枚");
  });
  it("inserts a topic by shifting all deeper columns and keeping fixed coordinates", () => {
    const d = sample(),
      added = insert(d, d.slides[0], "right");
    expect(added.slides).toHaveLength(6);
    expect(added.slides.find((s) => s.id === d.slides[1].id)?.x).toBe(2);
    expect(added.slides.find((s) => s.id === d.slides[4].id)?.x).toBe(2);
    expect(added.slides.at(-1)).toMatchObject({ x: 1, y: 0 });
    expect(parseDeck(JSON.stringify(added))).toEqual(added);
  });
  it("inserts detail without changing adjacent topics", () => {
    const d = sample(),
      added = insert(d, d.slides[0], "down");
    expect(added.slides.find((s) => s.id === d.slides[3].id)?.y).toBe(2);
    expect(added.slides.find((s) => s.id === d.slides[4].id)?.y).toBe(1);
  });
  it("swaps single pages, complete rows and complete columns without collisions", () => {
    const d = sample();
    for (const mode of ["slide", "row", "column"] as const) {
      const moved = swap(d, mode, { x: 0, y: 0 }, { x: 1, y: 1 });
      expect(new Set(moved.slides.map((s) => `${s.x},${s.y}`)).size).toBe(5);
      const restored = swap(moved, mode, { x: 0, y: 0 }, { x: 1, y: 1 });
      expect(restored.slides).toEqual(d.slides);
      for (const axis of ["rows", "columns"] as const)
        for (let i = 0; i < 100; i++)
          expect(axisId(restored, "main", axis, i)).toBe(
            axisId(d, "main", axis, i),
          );
    }
  });
  it("deletes the origin by promoting the next page and retains a blank when all pages are removed", () => {
    let d = sample();
    d = removeSlide(d, d.slides[0].id);
    expect(d.slides.some((s) => s.x === 0 && s.y === 0)).toBe(true);
    const only: Deck = { version: 1, title: "空", slides: [blank(0, 0)] };
    expect(removeSlide(only, only.slides[0].id).slides).toHaveLength(1);
  });
  it("navigates sparse columns and returns to the top when an adjacent topic lacks the current depth", () => {
    const d = sample();
    expect(neighbor(d, d.slides[0], 0, 1)?.id).toBe(d.slides[3].id);
    expect(neighbor(d, d.slides[4], 1, 0)?.id).toBe(d.slides[2].id);
    expect(neighbor(d, d.slides[0], -1, 0)).toBeUndefined();
  });
  it("roundtrips every element type, colors, highlights and embedded image data", () => {
    const d = sample();
    d.slides[0].elements.push({
      id: "picture",
      type: "image",
      x: 0,
      y: 0,
      w: 80,
      h: 60,
      src: "data:image/png;base64,aGVsbG8=",
    });
    d.slides[0].elements[0].highlight = "#fffabc";
    d.slides[0].elements[0].bullets = true;
    expect(parseDeck(JSON.stringify(d))).toEqual(d);
  });
  it("round-trips all text alignments while leaving older documents unchanged", () => {
    const d = sample();
    expect(parseDeck(JSON.stringify(d))).toEqual(d);
    for (const textAlign of ["left", "center", "right"] as const)
      for (const verticalAlign of ["top", "middle", "bottom"] as const) {
        Object.assign(d.slides[0].elements[0], { textAlign, verticalAlign });
        expect(parseDeck(serializeDeck(d))).toEqual(d);
      }
  });
  it.each([
    ["textAlign", "justify"],
    ["textAlign", null],
    ["textAlign", 1],
    ["verticalAlign", "center"],
    ["verticalAlign", null],
    ["verticalAlign", {}],
  ])("rejects invalid text alignment %s=%j", (key, value) => {
    const d = sample();
    Object.assign(d.slides[0].elements[0], { [key as string]: value });
    expect(() => parseDeck(JSON.stringify(d))).toThrow();
  });
  it.each([
    "duplicate",
    "fraction",
    "version",
    "script",
    "overflow",
    "missing-origin",
    "null-element",
  ])("rejects invalid document: %s", (kind) => {
    const d: any = sample();
    if (kind === "duplicate") d.slides.push(d.slides[0]);
    if (kind === "fraction") d.slides[1].x = 0.5;
    if (kind === "version") d.version = 3;
    if (kind === "script")
      d.slides[0].elements.push({
        id: "bad",
        type: "image",
        x: 0,
        y: 0,
        w: 20,
        h: 20,
        src: "javascript:alert(1)",
      });
    if (kind === "overflow") d.slides[0].elements[0].w = 960;
    if (kind === "missing-origin") d.slides[0].x = 99;
    if (kind === "null-element") d.slides[0].elements.push(null);
    expect(() => parseDeck(JSON.stringify(d))).toThrow();
  });
});

describe("linked rows and thumbnail actions", () => {
  it("links matching columns, skips missing pages, and retains independent row choices", () => {
    let d = sample();
    d = rememberRowPage(d, d.slides[2].id);
    d = rememberRowPage(d, d.slides[3].id);
    const linked = { ...d, linkedRows: true };
    expect(rowPage(linked, 1, 1)?.id).toBe(d.slides[4].id);
    expect(rowPage(linked, 1, 2)).toBeUndefined();
    expect(editorNeighbor(linked, d.slides[2], 0, 1)).toBeUndefined();
    linked.slides = [...linked.slides, blank(2, 3)];
    expect(editorNeighbor(linked, d.slides[2], 0, 1)).toBe(
      linked.slides.at(-1),
    );
    expect(editorNeighbor(linked, d.slides[1], 0, 1)?.id).toBe(d.slides[4].id);
    const unlinked = { ...linked, linkedRows: false };
    expect(rowPage(unlinked, 1, 1)?.id).toBe(d.slides[3].id);
    expect(editorNeighbor(unlinked, d.slides[2], 0, 1)?.id).toBe(
      d.slides[3].id,
    );
    expect(parseDeck(JSON.stringify(linked))).toEqual(linked);
    expect(() =>
      parseDeck(JSON.stringify({ ...d, linkedRows: "true" })),
    ).toThrow();
  });

  it("duplicates a page with unique element IDs, shifting only its own row", () => {
    const d = sample();
    const next = duplicateSlide(d, d.slides[0].id);
    const copy = next.slides.at(-1)!;
    expect(copy).toMatchObject({
      x: 1,
      y: 0,
      title: "わたしたちのまち のコピー",
    });
    expect(copy.id).not.toBe(d.slides[0].id);
    expect(copy.elements.map(({ id, ...e }) => e)).toEqual(
      d.slides[0].elements.map(({ id, ...e }) => e),
    );
    copy.elements[0].text = "copy only";
    expect(d.slides[0].elements[0].text).toBe("OUR TOWN");
    expect(next.slides.find((s) => s.id === d.slides[1].id)?.x).toBe(2);
    expect(next.slides.find((s) => s.id === d.slides[4].id)?.x).toBe(1);
    expect(parseDeck(JSON.stringify(next))).toEqual(next);
  });

  it("duplicates a sparse row below itself and preserves its remembered topic", () => {
    let d = sample();
    d.slides[1].x = 4;
    d = rememberRowPage(d, d.slides[1].id);
    const next = duplicateRowGroup(d, 0);
    expect(next.slides).toHaveLength(8);
    expect(next.slides.filter((s) => s.y === 1).map((s) => s.x)).toEqual([
      0, 4, 2,
    ]);
    expect(rowPage(next, 1)?.title).toBe("自然がいっぱい のコピー");
    expect(next.slides.find((s) => s.id === d.slides[3].id)?.y).toBe(2);
    expect(rowPage(next, 0)?.id).toBe(d.slides[1].id);
    expect(parseDeck(JSON.stringify(next))).toEqual(next);
  });

  it("removes a group atomically, retains other content, and recovers the origin", () => {
    let d = sample();
    d = rememberRowPage(d, d.slides[1].id);
    d = rememberRowPage(d, d.slides[4].id);
    const next = removeRowGroup(d, 0);
    expect(next.slides).toEqual(
      d.slides.filter((s) => s.y === 1).map((s) => ({ ...s, y: 0 })),
    );
    expect(next.rowSelections).toEqual([d.slides[4].id]);
    const sparse: Deck = {
      version: 1,
      title: "sparse",
      slides: [blank(0, 0), blank(3, 1)],
    };
    const recovered = removeRowGroup(sparse, 0);
    expect(
      recovered.slides.find((s) => s.id === sparse.slides[1].id),
    ).toMatchObject({ x: 3, y: 0 });
    expect(parseDeck(JSON.stringify(recovered))).toEqual(recovered);
    const empty = removeRowGroup(
      { ...d, slides: d.slides.filter((s) => s.y === 0) },
      0,
    );
    expect(empty.slides).toHaveLength(1);
    expect(empty.slides[0]).toMatchObject({ x: 0, y: 0, elements: [] });
    expect(parseDeck(JSON.stringify(empty))).toEqual(empty);
  });

  it("rejects duplicate operations at the page and grid limits without mutating the source", () => {
    const full: Deck = {
      version: 1,
      title: "full",
      slides: Array.from({ length: 1000 }, (_, i) =>
        blank(i % 10, Math.floor(i / 10)),
      ),
    };
    const before = JSON.stringify(full);
    expect(() => duplicateSlide(full, full.slides[0].id)).toThrow("1000枚");
    expect(() => duplicateRowGroup(full, 0)).toThrow("1000枚");
    expect(JSON.stringify(full)).toBe(before);
    const edge: Deck = {
      version: 1,
      title: "edge",
      slides: [blank(0, 0), blank(99, 0), blank(0, 99)],
    };
    expect(() => duplicateSlide(edge, edge.slides[0].id)).toThrow("100マス");
    expect(() => duplicateRowGroup(edge, 0)).toThrow("100マス");
    expect(() => duplicateSlide(edge, "missing")).toThrow();
    expect(() => duplicateRowGroup(edge, 1)).toThrow();
  });
});

describe("inserting an existing page between thumbnails", () => {
  it("closes the source gap and shifts only the destination row without losing content", () => {
    const d = sample(),
      page = d.slides[1];
    const next = insertMovedPage(d, page.id, 1, 1);
    expect(next.slides.find((s) => s.id === page.id)).toEqual({
      ...page,
      x: 1,
      y: 1,
    });
    expect(next.slides.find((s) => s.id === d.slides[2].id)?.x).toBe(1);
    expect(next.slides.find((s) => s.id === d.slides[4].id)?.x).toBe(2);
    expect(next.slides).toHaveLength(d.slides.length);
    expect(next.slides.map((s) => s.id)).toEqual(d.slides.map((s) => s.id));
    expect(parseDeck(JSON.stringify(next))).toEqual(next);
    expect(d.slides[1]).toEqual(page);
  });
  it("adjusts same-row boundaries after removal, including no-op gaps and the end", () => {
    const d = sample();
    expect(insertMovedPage(d, d.slides[1].id, 1, 0)).toBe(d);
    expect(insertMovedPage(d, d.slides[1].id, 2, 0)).toBe(d);
    expect(
      insertMovedPage(d, d.slides[0].id, 3, 0).slides.map((s) => [s.x, s.y]),
    ).toEqual([
      [2, 0],
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(
      insertMovedPage(d, d.slides[2].id, 0, 0).slides.map((s) => [s.x, s.y]),
    ).toEqual([
      [1, 0],
      [2, 0],
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
  });
  it("preserves sparse rows and rejects an empty origin or coordinate overflow atomically", () => {
    const d = { ...sample(), slides: [blank(0, 0), blank(0, 1), blank(99, 1)] };
    expect(() => insertMovedPage(d, d.slides[0].id, 0, 2)).toThrow(
      "はじめのマス",
    );
    expect(() => insertMovedPage(d, d.slides[0].id, 0, 1)).toThrow("100マス");
    expect(() => insertMovedPage(d, d.slides[1].id, 100, 0)).toThrow("100マス");
    const next = insertMovedPage(d, d.slides[2].id, 1, 0);
    expect(next.slides.map((s) => [s.x, s.y])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    expect(d.slides[2].x).toBe(99);
  });
});
describe("editor grid-line insertion", () => {
  it("inserts between columns at the hovered depth and shifts every row together", () => {
    const d = sample(),
      next = insertGridLine(d, "column", 1, 1);
    expect(next.slides.at(-1)).toMatchObject({ x: 1, y: 1, elements: [] });
    for (const s of d.slides)
      expect(next.slides.find((n) => n.id === s.id)).toEqual({
        ...s,
        x: s.x >= 1 ? s.x + 1 : s.x,
      });
    expect(parseDeck(JSON.stringify(next))).toEqual(next);
  });
  it("inserts a row across all topics and appends a last row", () => {
    const d = sample(),
      next = insertGridLine(d, "row", 1, 1);
    expect(next.slides.at(-1)).toMatchObject({ x: 1, y: 1 });
    for (const s of d.slides)
      expect(next.slides.find((n) => n.id === s.id)).toEqual({
        ...s,
        y: s.y >= 1 ? s.y + 1 : s.y,
      });
    expect(insertGridLine(next, "row", 3, 2).slides.at(-1)).toMatchObject({
      x: 2,
      y: 3,
    });
    expect(parseDeck(JSON.stringify(next))).toEqual(next);
  });
  it("preserves gaps in sparse rows and columns", () => {
    const d: Deck = {
      version: 1,
      title: "sparse",
      slides: [blank(0, 0), blank(3, 0), blank(0, 4)],
    };
    const next = insertGridLine(insertGridLine(d, "column", 1, 4), "row", 2, 1);
    expect(next.slides.map((s) => [s.x, s.y])).toEqual([
      [0, 0],
      [4, 0],
      [0, 5],
      [1, 5],
      [1, 2],
    ]);
    expect(new Set(next.slides.map((s) => `${s.x},${s.y}`)).size).toBe(5);
  });
  it("rejects origin displacement, invalid positions, page and coordinate limits", () => {
    expect(() => insertGridLine(sample(), "row", 0, 1)).toThrow();
    expect(() => insertGridLine(sample(), "column", 1.5, 0)).toThrow();
    expect(() => insertGridLine(sample(), "row", 3, 0)).toThrow();
    expect(() => insertGridLine(sample(), "row", 1, 3)).toThrow();
    const wide: Deck = {
      version: 1,
      title: "wide",
      slides: [blank(0, 0), blank(99, 0)],
    };
    expect(() => insertGridLine(wide, "column", 1, 0)).toThrow(
      "縦・横は100マスまでです。",
    );
    const full: Deck = {
      version: 1,
      title: "full",
      slides: Array.from({ length: 1000 }, (_, i) =>
        blank(i % 10, Math.floor(i / 10)),
      ),
    };
    expect(() => insertGridLine(full, "row", 1, 0)).toThrow(
      "ページは1000枚までです。",
    );
  });
});

describe("independent row choices and editor moves", () => {
  it("swaps overlapping row groups but inserts at gaps and the final boundary", () => {
    const d: Deck = {
      version: 1,
      title: "row drop targets",
      slides: Array.from({ length: 6 }, (_, i) =>
        blank(i % 2, Math.floor(i / 2)),
      ),
    };
    const swapped = swapRowGroups(d, 0, 2);
    expect(swapped.slides.map((s) => s.y)).toEqual([2, 2, 1, 1, 0, 0]);
    expect(insertMovedRowGroup(d, 0, 2).slides.map((s) => s.y)).toEqual([
      1, 1, 0, 0, 2, 2,
    ]);
    expect(insertMovedRowGroup(d, 0, 3).slides.map((s) => s.y)).toEqual([
      2, 2, 0, 0, 1, 1,
    ]);
    expect(insertMovedRowGroup(d, 2, 0).slides.map((s) => s.y)).toEqual([
      1, 1, 2, 2, 0, 0,
    ]);
    expect(insertMovedRowGroup(d, 1, 1)).toBe(d);
    expect(insertMovedRowGroup(d, 1, 2)).toBe(d);
    expect(swapRowGroups(d, 1, 1)).toBe(d);
    for (const page of d.slides)
      expect(swapped.slides.find((s) => s.id === page.id)).toEqual({
        ...page,
        y: 2 - page.y,
      });
    expect(() => insertMovedRowGroup(d, 1, 4)).toThrow();
    expect(() => swapRowGroups(d, 0, 3)).toThrow();
    const sparse = { ...d, slides: [blank(0, 0), blank(1, 2)] };
    expect(() => swapRowGroups(sparse, 0, 2)).toThrow("はじめのマス");
    expect(() => insertMovedRowGroup(sparse, 2, 0)).toThrow("はじめのマス");
  });
  it("remembers a different column in each row and restores choices from JSON", () => {
    let d = sample();
    d = rememberRowPage(d, d.slides[2].id);
    d = rememberRowPage(d, d.slides[4].id);
    expect(rowPage(d, 0)?.title).toBe("人とつながる");
    expect(rowPage(d, 1)?.title).toBe("お気に入りの公園");
    expect(parseDeck(JSON.stringify(d))).toEqual(d);
    expect(editorNeighbor(d, d.slides[2], 0, 1)?.id).toBe(d.slides[4].id);
    expect(editorNeighbor(d, d.slides[4], 0, -1)?.id).toBe(d.slides[2].id);
    expect(editorNeighbor(d, d.slides[4], 1, 0)).toBeUndefined();
  });
  it("reorders entire row groups and keeps their selected IDs attached", () => {
    let d = sample();
    d = rememberRowPage(d, d.slides[1].id);
    d = rememberRowPage(d, d.slides[4].id);
    const moved = moveRowGroup(d, 0, 1);
    for (const s of d.slides)
      expect(moved.slides.find((n) => n.id === s.id)).toEqual({
        ...s,
        y: 1 - s.y,
      });
    expect(rowPage(moved, 0)?.title).toBe("お気に入りの公園");
    expect(rowPage(moved, 1)?.title).toBe("自然がいっぱい");
    const restored = moveRowGroup(moved, 1, 0);
    expect(restored.slides).toEqual(d.slides);
    expect(restored.rowSelections).toEqual(d.rowSelections);
    expect(axisId(restored, "main", "rows", 0)).toBe("0");
  });
  it("inserts a row group between other rows instead of swapping only two groups", () => {
    const d: Deck = {
      version: 1,
      title: "rows",
      slides: [blank(0, 0), blank(0, 1), blank(0, 2), blank(0, 3)],
    };
    expect(moveRowGroup(d, 3, 1).slides.map((s) => s.y)).toEqual([0, 2, 3, 1]);
  });
  it("moves one page across rows and swaps occupied cells without losing content", () => {
    const d = sample(),
      page = d.slides[1];
    const moved = movePage(d, page.id, 2, 1);
    expect(moved.slides.find((s) => s.id === page.id)).toMatchObject({
      x: 2,
      y: 1,
    });
    expect(moved.slides.filter((s) => s.id !== page.id)).toEqual(
      d.slides.filter((s) => s.id !== page.id),
    );
    const swapped = movePage(d, page.id, 0, 1);
    expect(swapped.slides.find((s) => s.id === d.slides[3].id)).toMatchObject({
      x: 1,
      y: 0,
    });
    expect(parseDeck(JSON.stringify(swapped))).toEqual(swapped);
    expect(() => movePage(d, d.slides[0].id, 2, 1)).toThrow("はじめのマス");
  });
  it("recovers stale row choices and normalizes selections after a swap", () => {
    const d = sample();
    d.rowSelections = ["deleted", d.slides[0].id, d.slides[1].id];
    expect(parseDeck(JSON.stringify(d)).rowSelections).toEqual([
      d.slides[0].id,
    ]);
    const normalized = rememberRowPage(d, d.slides[4].id);
    expect(parseDeck(JSON.stringify(normalized))).toEqual(normalized);
  });
});
