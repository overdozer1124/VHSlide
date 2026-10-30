import { it, expect } from "vitest";
import { wrapLabel, chartLayout, type TextMeasure } from "./chartLayout";
import type { Element } from "./model";
const measure: TextMeasure = (text, size) =>
  Array.from(text).length * size * 0.7;
const chart = (count: number, label = "項目"): Element => ({
  id: "chart",
  type: "chart",
  x: 0,
  y: 0,
  w: 720,
  h: 405,
  chart: {
    kind: "bar",
    title: "比較",
    showLegend: false,
    showValues: true,
    series: Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      label: label + i,
      value: i % 2 ? i : -i,
      color: "#587d59",
    })),
  },
});
it("wraps actual text widths and newlines, marks truncation without changing the input", () => {
  expect(wrapLabel("ABC\n\nDEF", 60, 14, 5, measure).lines).toEqual([
    "ABC",
    "",
    "DEF",
  ]);
  const text = "長い名前ABCDEFGHIJ".repeat(4),
    r = wrapLabel(text, 60, 14, 2, measure);
  expect(r.clipped).toBe(true);
  expect(r.lines).toHaveLength(2);
  expect(r.lines[1]).toContain("…");
  expect(text).toContain("ABCDEFGHIJ");
});
it("keeps two-dimensional chart labels when they fit and numbers crowded labels even with legend off", () => {
  const a = chart(3),
    b = chart(12, "長い日本語の名称を確認する".repeat(3));
  expect(chartLayout(a, measure).numbered).toBe(false);
  const before = JSON.stringify(b),
    layout = chartLayout(b, measure);
  expect(layout.numbered).toBe(true);
  expect(layout.mapping).toBe(true);
  expect(layout.names).toHaveLength(12);
  expect(layout.issues).toContain("項目名の一部が省略されています。");
  expect(JSON.stringify(b)).toBe(before);
});
it("reserves bounded map and plot regions for 1, 3, 8, 12 items and never draws a crowded tiny plot", () => {
  for (const count of [1, 3, 8, 12])
    for (const kind of ["bar", "line", "pie"] as const) {
      const e = chart(count);
      e.chart!.kind = kind;
      const l = chartLayout(e, measure);
      if (!l.small) {
        expect(l.bottom - l.top).toBeGreaterThanOrEqual(48);
        expect(l.mapTop).toBeGreaterThan(l.bottom);
        expect(
          l.mapTop + Math.ceil(count / l.cols) * l.rowHeight,
        ).toBeLessThanOrEqual(e.h);
      }
    }
  const e = chart(12);
  e.w = 180;
  e.h = 100;
  expect(chartLayout(e, measure).small).toBe(true);
});
it("handles empty and zero data and preserves negative non-pie values", () => {
  for (const count of [0, 1, 12]) {
    const e = chart(count);
    e.chart!.series = e.chart!.series.map((p) => ({ ...p, value: 0 }));
    const l = chartLayout(e, measure);
    expect(Number.isFinite(l.range)).toBe(true);
    expect(l.range).toBeGreaterThan(0);
  }
  const e = chart(3);
  e.chart!.series[0].value = -1000000;
  expect(chartLayout(e, measure).min).toBe(-1000000);
});
