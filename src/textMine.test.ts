import { describe, expect, it } from "vitest";
import { textMineTexts } from "./textMine";

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
