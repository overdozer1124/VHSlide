import type { Element } from "./model.ts";
import { createChart, type ChartKind } from "./chartData.ts";
export type DiagramKind = "compare" | "process" | "timeline";
export function createDiagram(kind: DiagramKind, id: () => string): Element[] {
  const groupId = id(),
    shape = (
      text: string,
      x: number,
      y: number,
      w: number,
      h: number,
      fill: string,
    ): Element => ({
      id: id(),
      type: "shape",
      shape: "rounded",
      x,
      y,
      w,
      h,
      fill,
      stroke: "#729276",
      strokeWidth: 2,
      text,
      fontSize: 26,
      color: "#173d38",
      textAlign: "center",
      verticalAlign: "middle",
      groupId,
    });
  const title: Element = {
    id: id(),
    type: "text",
    x: 80,
    y: 35,
    w: 800,
    h: 65,
    text:
      kind === "compare"
        ? "くらべて考えよう"
        : kind === "process"
          ? "順番にまとめよう"
          : "時間の流れを見よう",
    fontSize: 36,
    bold: true,
    color: "#173d38",
    groupId,
  };
  if (kind === "compare")
    return [
      title,
      ...["はじめの考え", "共通すること", "新しい考え"].flatMap((label, i) => [
        shape(
          label,
          65 + i * 285,
          130,
          260,
          75,
          ["#e5efdb", "#e5edf5", "#f6ead7"][i],
        ),
        {
          id: id(),
          type: "text" as const,
          x: 80 + i * 285,
          y: 235,
          w: 230,
          h: 220,
          text: "ここにことばを入力",
          fontSize: 26,
          color: "#173d38",
          groupId,
        },
      ]),
    ];
  const nodes = ["はじめ", "途中", "まとめ"].map((label, i) =>
    shape(
      kind === "timeline" ? `${i + 1} · ${label}` : label,
      75 + i * 290,
      kind === "timeline" ? 235 : 180,
      230,
      120,
      ["#e5efdb", "#e5edf5", "#f6ead7"][i],
    ),
  );
  const lines: Element[] = nodes.slice(0, -1).map((node, i) => ({
    id: id(),
    type: "line",
    x: 305 + i * 290,
    y: 230,
    w: 60,
    h: 20,
    stroke: "#587d59",
    strokeWidth: 3,
    lineKind: "straight",
    endArrow: "triangle",
    lineStart: { x: 0, y: 50 },
    lineEnd: { x: 100, y: 50 },
    startAnchor: { elementId: node.id, side: "right" },
    endAnchor: { elementId: nodes[i + 1].id, side: "left" },
    groupId,
  }));
  const labels: Element[] =
    kind === "timeline"
      ? nodes.map((_, i) => ({
          id: id(),
          type: "text",
          x: 75 + i * 290,
          y: 135,
          w: 230,
          h: 70,
          text: `時期 ${i + 1}`,
          fontSize: 28,
          color: "#587d59",
          textAlign: "center",
          groupId,
        }))
      : [];
  return [title, ...lines, ...nodes, ...labels];
}
export function createChartElement(kind: ChartKind, id: () => string): Element {
  return {
    id: id(),
    type: "chart",
    x: 120,
    y: 80,
    w: 720,
    h: 405,
    chart: createChart(kind, id),
  };
}
