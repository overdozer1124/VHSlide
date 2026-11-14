import { describe, expect, it } from "vitest";
import { cloudFontSize, layoutWordCloud } from "./wordCloud";

// 描画幅の代わり: 1文字 ≒ サイズ×0.62、高さ ≒ サイズ
const measure = (text: string, size: number) => ({
  w: text.length * size * 0.62,
  h: size,
});

const words = [
  { word: "栄養素", weight: 18 },
  { word: "野菜", weight: 15 },
  { word: "エネルギー", weight: 14 },
  { word: "大切", weight: 12 },
  { word: "食べる", weight: 11 },
  { word: "食事", weight: 9 },
  { word: "体", weight: 7 },
  { word: "バランス", weight: 6 },
  { word: "考える", weight: 5 },
  { word: "好き", weight: 3 },
];

describe("cloudFontSize", () => {
  it("scales with the square root of the weight", () => {
    expect(cloudFontSize(16, 16)).toBe(42);
    expect(cloudFontSize(4, 16)).toBe(Math.round(13 + 29 * 0.5));
    expect(cloudFontSize(0, 16)).toBe(13);
  });
});

describe("layoutWordCloud", () => {
  it("places words inside the box without overlaps", () => {
    const placed = layoutWordCloud(words, 720, 300, measure);
    expect(placed.length).toBeGreaterThanOrEqual(8);
    expect(placed[0].word).toBe("栄養素");
    const boxes = placed.map((p) => {
      const m = measure(p.word, p.size);
      return { ...p, w: m.w + 8, h: m.h + 5 };
    });
    for (const b of boxes) {
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w / 2).toBeLessThanOrEqual(720);
      expect(b.y - b.h / 2).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h / 2).toBeLessThanOrEqual(300);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const hit =
          Math.abs(a.x - b.x) * 2 < a.w + b.w + 3 &&
          Math.abs(a.y - b.y) * 2 < a.h + b.h + 3;
        expect(hit, `${a.word} x ${b.word}`).toBe(false);
      }
  });

  it("is deterministic and gives the heaviest word the largest size", () => {
    const a = layoutWordCloud(words, 720, 300, measure);
    const b = layoutWordCloud(words, 720, 300, measure);
    expect(a).toEqual(b);
    const sizes = a.map((p) => p.size);
    expect(Math.max(...sizes)).toBe(a[0].size);
  });

  it("handles empty and tiny inputs", () => {
    expect(layoutWordCloud([], 720, 300, measure)).toEqual([]);
    expect(layoutWordCloud(words, 40, 30, measure)).toEqual([]);
  });
});
