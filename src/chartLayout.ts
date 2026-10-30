import type { Element } from "./model";
export type TextMeasure = (
  text: string,
  size: number,
  bold?: boolean,
) => number;
export function wrapLabel(
  text: string,
  width: number,
  size: number,
  limit: number,
  measure: TextMeasure,
) {
  const lines: string[] = [];
  let line = "";
  for (const part of text.split("\n")) {
    for (const char of Array.from(part)) {
      if (line && measure(line + char, size) > width) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    lines.push(line);
    line = "";
  }
  const clipped =
    lines.length > limit || lines.some((s) => measure(s, size) > width);
  const result = lines.slice(0, limit);
  if (clipped && result.length) {
    let last = result[result.length - 1];
    while (last && measure(last + "…", size) > width)
      last = Array.from(last).slice(0, -1).join("");
    result[result.length - 1] = last + "…";
  }
  return { lines: result, clipped };
}
export const chartNumber = (value: number) =>
  new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
export function chartLayout(e: Element, measure: TextMeasure) {
  const c = e.chart!,
    n = c.series.length,
    w = e.w,
    h = e.h;
  const title = wrapLabel(c.title, Math.max(1, w - 24), 22, 2, (s, size) =>
      measure(s, size, true),
    ),
    top = title.lines.length * 25 + 24;
  const min = Math.min(0, ...c.series.map((p) => p.value)),
    max = Math.max(1, ...c.series.map((p) => p.value)),
    left = Math.max(
      46,
      ...[min, max, (min + max) / 2].map(
        (v) => measure(chartNumber(v), 14) + 12,
      ),
    ),
    right = w - 16,
    step = (right - left) / Math.max(1, n);
  const labels = c.series.map((p) =>
    wrapLabel(p.label, Math.max(1, step - 8), 16, 2, measure),
  );
  const numbered =
    c.kind === "pie" ||
    labels.some((l) => l.clipped) ||
    (c.showValues &&
      c.series.some((p) => measure(chartNumber(p.value), 14) > step - 8));
  const mapping = numbered || c.showLegend,
    cols = Math.min(Math.max(1, n), w >= 600 ? 3 : w >= 360 ? 2 : 1),
    rows = Math.ceil(n / cols),
    colWidth = (w - 32) / cols;
  const lineCount = Math.max(
    1,
    Math.min(3, Math.floor(((h * 0.46) / Math.max(1, rows) - 22) / 16)),
  );
  const names = mapping
    ? c.series.map((p) =>
        wrapLabel(p.label, Math.max(1, colWidth - 22), 14, lineCount, measure),
      )
    : [];
  const rowHeight = mapping
    ? 22 + 16 * Math.max(1, ...names.map((p) => p.lines.length))
    : 0;
  const mapHeight = rows * rowHeight,
    bottom =
      h - 20 - (mapping ? mapHeight + 10 : 0) - (c.kind === "pie" ? 0 : 42);
  const small =
    w < 240 ||
    h < 180 ||
    bottom - top < 48 ||
    (c.kind !== "pie" && numbered && step < 18) ||
    (c.kind === "pie" &&
      n > 6 &&
      (bottom - top) / 2 - 10 < Math.min(80, n * 5));
  const issues = [
    ...(title.clipped ? ["グラフのタイトルが省略されています。"] : []),
    ...(names.some((l) => l.clipped)
      ? ["項目名の一部が省略されています。"]
      : []),
    ...(small ? ["グラフが小さく、表示に必要な領域が不足しています。"] : []),
  ];
  return {
    w,
    h,
    title,
    top,
    bottom,
    left,
    right,
    step,
    min,
    max,
    range: max - min || 1,
    numbered,
    mapping,
    cols,
    colWidth,
    rowHeight,
    names,
    labels,
    mapTop: h - 16 - mapHeight,
    small,
    issues,
  };
}
