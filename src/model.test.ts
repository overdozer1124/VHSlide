import { describe, expect, it } from "vitest";
import {
  blank,
  insert,
  insertGridLine,
  neighbor,
  parseDeck,
  removeSlide,
  sample,
  swap,
} from "./model";
import type { Deck } from "./model";
describe("fixed grid and portable document", () => {
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
      expect(swap(moved, mode, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual(d);
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
      slides: Array.from({ length: 100 }, (_, x) => blank(x, 0)),
    };
    expect(() => insertGridLine(full, "row", 1, 0)).toThrow(
      "ページは100枚までです。",
    );
  });
});
