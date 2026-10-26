export type FitIssue = {
  pageId?: string;
  elementId: string;
  cellKey?: string;
  kind: "table" | "chart";
  message: string;
};
let canvas: HTMLCanvasElement | undefined,
  family = "",
  revision = 0;
const widths = new Map<string, number>();
if (typeof document !== "undefined")
  document.fonts.addEventListener("loadingdone", () => {
    revision++;
    family = "";
    widths.clear();
  });
export const fontRevision = () => revision;
export const canvasFont = () =>
  (family ||= getComputedStyle(document.body).fontFamily);
export function textMeasure(text: string, size: number, bold = false) {
  const key = `${revision}/${size}/${bold}/${text}`;
  if (widths.has(key)) return widths.get(key)!;
  canvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("文字サイズを計測できません。");
  context.font = `${bold ? "700" : "400"} ${size}px ${canvasFont()}`;
  const width = context.measureText(text).width;
  if (widths.size > 12000) widths.clear();
  widths.set(key, width);
  return width;
}
/** Measure all cell mirrors in one layout pass. Independent of textarea scroll/caret position. */
export function measureTableFit(
  root: HTMLTableElement,
  elementId: string,
): FitIssue[] {
  const host = document.createElement("div");
  host.className = "fit-measure-host";
  host.style.cssText =
    "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;z-index:-1;contain:layout style;";
  const cells = [
    ...root.querySelectorAll<HTMLElement>("td[data-cell],th[data-cell]"),
  ].map((cell) => {
    const box = cell.querySelector<HTMLElement>(".table-cell-content")!,
      source = box.querySelector<HTMLElement>("textarea,span")!,
      style = getComputedStyle(source),
      value =
        source instanceof HTMLTextAreaElement
          ? source.value
          : (source.textContent ?? "");
    const mirror = document.createElement("div");
    mirror.style.cssText =
      "position:absolute;top:0;left:0;height:auto;max-height:none;padding:0;border:0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;";
    for (const property of [
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "line-height",
      "letter-spacing",
      "word-spacing",
    ])
      mirror.style.setProperty(property, style.getPropertyValue(property));
    mirror.style.width = `${Math.max(0, box.clientWidth)}px`;
    mirror.textContent = value + "\u200b";
    host.append(mirror);
    return { cell, box, value, mirror };
  });
  document.body.append(host);
  try {
    return cells.flatMap(({ cell, box, value, mirror }) =>
      value.length &&
      (box.clientHeight < 1 ||
        box.clientWidth < 1 ||
        mirror.scrollHeight > box.clientHeight + 1 ||
        mirror.scrollWidth > box.clientWidth + 1)
        ? [
            {
              elementId,
              cellKey: cell.dataset.cell,
              kind: "table" as const,
              message: `${(cell.parentElement as HTMLTableRowElement).rowIndex + 1}行${(cell as HTMLTableCellElement).cellIndex + 1}列：全文が表示されません。`,
            },
          ]
        : [],
    );
  } finally {
    host.remove();
  }
}
