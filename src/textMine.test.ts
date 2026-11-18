import { describe, expect, it } from "vitest";
import { textMineCardTexts, textMineTexts } from "./textMine";

describe("textMineTexts", () => {
  it("collects only non-empty string answers for the field", () => {
    const responses = [
      { values: { q1: "野菜を食べることが大切です。" } },
      { values: { q1: "  " } },
      { values: { q1: 42 } },
      { values: { q2: "別の欄の回答" } },
      { values: { q1: "エネルギーになります。" } },
    ];
    expect(textMineTexts(responses, "q1")).toEqual([
      "野菜を食べることが大切です。",
      "エネルギーになります。",
    ]);
  });

  it("returns an empty list when nobody answered", () => {
    expect(textMineTexts([], "q1")).toEqual([]);
    expect(textMineTexts([{ values: {} }], "q1")).toEqual([]);
  });
});

describe("textMineCardTexts", () => {
  const cards = [
    { zone: "a", text: "野菜が大切", authorId: "ana", owner: "ana" },
    { zone: "a", text: "野菜を食べる", authorId: "ana", owner: "ana" },
    { zone: "a", text: "運動も大切", authorId: "bob", owner: "bob" },
    { zone: "b", text: "睡眠が大切", authorId: "ana", owner: "ana" },
    { zone: "b", text: "  ", authorId: "bob", owner: "bob" },
  ];

  it("joins one author's cards in a zone into a single text", () => {
    // The analyzer counts one text as one respondent, so ana's two
    // cards in zone a must arrive as ONE text: a word she wrote on
    // both cards still counts as one person.
    expect(textMineCardTexts(cards, "a")).toEqual([
      "野菜が大切。野菜を食べる",
      "運動も大切",
    ]);
  });

  it("covers every zone when no zone is chosen", () => {
    expect(textMineCardTexts(cards, null)).toEqual([
      "野菜が大切。野菜を食べる。睡眠が大切",
      "運動も大切",
    ]);
  });

  it("returns an empty list for a zone without cards", () => {
    expect(textMineCardTexts(cards, "zzz")).toEqual([]);
    expect(textMineCardTexts([], null)).toEqual([]);
  });
});
