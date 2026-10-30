export type ChartKind = "bar" | "line" | "pie";
export type ChartPoint = {
  id: string;
  label: string;
  value: number;
  color: string;
};
export type ChartData = {
  kind: ChartKind;
  title: string;
  series: ChartPoint[];
  showValues: boolean;
  showLegend: boolean;
};
export const chartColors = [
  "#587d59",
  "#6c97bd",
  "#d4a35d",
  "#b98099",
  "#8b7cb0",
  "#70a997",
];
export function parseChart(value: unknown): ChartData {
  const c = value as ChartData,
    fail = (): never => {
      throw new Error(
        "グラフは0〜12項目、値は-100万〜100万（円グラフは0以上）で入力してください。",
      );
    };
  if (
    !c ||
    !["bar", "line", "pie"].includes(c.kind) ||
    typeof c.title !== "string" ||
    c.title.length > 100 ||
    typeof c.showValues !== "boolean" ||
    typeof c.showLegend !== "boolean" ||
    !Array.isArray(c.series) ||
    c.series.length > 12
  )
    return fail();
  const ids = new Set<string>();
  const series = c.series.map((p) => {
    if (
      !p ||
      typeof p.id !== "string" ||
      !p.id.length ||
      p.id.length > 100 ||
      ids.has(p.id) ||
      typeof p.label !== "string" ||
      p.label.length > 60 ||
      typeof p.value !== "number" ||
      !Number.isFinite(p.value) ||
      Math.abs(p.value) > 1e6 ||
      (c.kind === "pie" && p.value < 0) ||
      !/^#[\da-f]{6}$/i.test(p.color)
    )
      return fail();
    ids.add(p.id);
    return { id: p.id, label: p.label, value: p.value, color: p.color };
  });
  return {
    kind: c.kind,
    title: c.title,
    series,
    showValues: c.showValues,
    showLegend: c.showLegend,
  };
}
export function createChart(kind: ChartKind, id: () => string): ChartData {
  return {
    kind,
    title: "わたしたちの調べたこと",
    series: [3, 5, 4].map((value, i) => ({
      id: id(),
      label: `項目${i + 1}`,
      value,
      color: chartColors[i],
    })),
    showValues: true,
    showLegend: true,
  };
}
