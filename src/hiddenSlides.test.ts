import { describe, expect, it } from "vitest";
import type { Deck, Slide } from "./model.ts";
import { parseDeck } from "./model.ts";
import {
  isRowHidden,
  isSlideHidden,
  nearestVisibleSlide,
  studentDeck,
} from "./hiddenSlides.ts";
import { applyDeckChange, createSharedDeck, readSharedDeck } from "./sharedDeck.ts";
import { remapAxis } from "./axes.ts";

const slide = (id: string, x: number, y: number, extra = {}): Slide => ({
  id,
  x,
  y,
  title: id,
  background: "#ffffff",
  elements: [],
  ...extra,
});

const book = (): Deck => ({
  version: 1,
  title: "t",
  activeSheetId: "main",
  sheets: [
    {
      id: "main",
      name: "シート1",
      rowLabels: { "0": "導入", "1": "答え", "2": "まとめ" },
      hiddenRows: { "1": true },
    },
  ],
  slides: [
    slide("a", 0, 0),
    slide("b", 1, 0, { hidden: true }),
    slide("c", 0, 1),
    slide("d", 0, 2),
    slide("e", 1, 2),
  ],
});

describe("isSlideHidden / isRowHidden", () => {
  it("hides by own flag and by row", () => {
    const deck = book();
    expect(isSlideHidden(deck, deck.slides[0])).toBe(false);
    expect(isSlideHidden(deck, deck.slides[1])).toBe(true);
    expect(isSlideHidden(deck, deck.slides[2])).toBe(true);
    expect(isRowHidden(deck, "main", 1)).toBe(true);
    expect(isRowHidden(deck, "main", 0)).toBe(false);
  });
});

describe("studentDeck", () => {
  it("drops hidden slides and compresses hidden rows with labels", () => {
    const view = studentDeck(book());
    expect(view.slides.map((s) => s.id)).toEqual(["a", "d", "e"]);
    // Row 2 becomes row 1 after the hidden row 1 is removed.
    expect(view.slides.find((s) => s.id === "d")?.y).toBe(1);
    expect(view.slides.find((s) => s.id === "e")?.y).toBe(1);
    expect(view.sheets?.[0].rowLabels).toEqual({ "0": "導入", "1": "まとめ" });
    expect(view.sheets?.[0].hiddenRows).toBeUndefined();
    // x positions are untouched so topics stay in their columns.
    expect(view.slides.find((s) => s.id === "e")?.x).toBe(1);
  });

  it("keeps a labelled empty row in place", () => {
    const deck = book();
    deck.sheets![0].rowLabels = { "0": "導入", "1": "答え", "2": "まとめ", "3": "予備" };
    deck.sheets![0].hiddenRows = { "1": true };
    const view = studentDeck(deck);
    expect(view.sheets?.[0].rowLabels).toEqual({
      "0": "導入",
      "1": "まとめ",
      "2": "予備",
    });
  });
});

describe("nearestVisibleSlide", () => {
  it("prefers the previous visible slide, then the next", () => {
    const deck = book();
    expect(nearestVisibleSlide(deck, deck.slides[2])?.id).toBe("a");
    expect(nearestVisibleSlide(deck, deck.slides[1])?.id).toBe("a");
    const only = book();
    only.slides = [slide("x", 0, 0, { hidden: true }), slide("y", 1, 0)];
    only.sheets![0].hiddenRows = {};
    expect(nearestVisibleSlide(only, only.slides[0])?.id).toBe("y");
  });
});

describe("persistence", () => {
  it("round-trips through the shared doc", () => {
    const deck = book();
    const back = readSharedDeck(createSharedDeck(deck));
    expect(back.slides.find((s) => s.id === "b")?.hidden).toBe(true);
    expect(back.sheets?.[0].hiddenRows).toEqual({ "1": true });
    const doc = createSharedDeck(deck);
    const shown: Deck = {
      ...deck,
      slides: deck.slides.map((s) =>
        s.id === "b" ? { ...s, hidden: undefined } : s,
      ),
      sheets: [{ ...deck.sheets![0], hiddenRows: undefined }],
    };
    applyDeckChange(doc, deck, shown);
    const after = readSharedDeck(doc);
    expect(after.slides.find((s) => s.id === "b")?.hidden).toBeUndefined();
    expect(after.sheets?.[0].hiddenRows).toBeUndefined();
  });

  it("parses from a .vhslide file and drops false flags", () => {
    const deck = parseDeck(JSON.stringify(book()));
    expect(deck.slides.find((s) => s.id === "b")?.hidden).toBe(true);
    expect(deck.sheets?.[0].hiddenRows).toEqual({ "1": true });
    const plain = parseDeck(
      JSON.stringify({
        ...book(),
        slides: [slide("a", 0, 0, { hidden: false })],
        sheets: [{ id: "main", name: "シート1", hiddenRows: { "0": false } }],
      }),
    );
    expect(plain.slides[0].hidden).toBeUndefined();
    expect(plain.sheets?.[0].hiddenRows).toEqual({});
  });
});

describe("remapAxis", () => {
  it("carries hiddenRows when rows move", () => {
    const deck = book();
    // Insert a new row at the top: every row shifts down by one.
    const moved = remapAxis(deck, "rows", (i) => i + 1);
    expect(moved.sheets?.[0].hiddenRows).toEqual({ "2": true });
    expect(moved.sheets?.[0].rowLabels?.["3"]).toBe("まとめ");
  });
});
