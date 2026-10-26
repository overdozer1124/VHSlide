import type { Element } from "./model.ts";
import { CELL_STYLE_KEYS, type CellStyle } from "./tableData.ts";
/** Same effective values for drawing and the selection inspector, including header defaults. */
export function effectiveCellStyle(
  e: Element,
  key: string,
): Required<CellStyle> {
  const t = e.table!,
    s = t.styles?.[key] ?? {};
  const header = t.header && key.split(":")[0] === t.rows[0];
  const color = (s.color ?? e.color ?? "#173d38").toLowerCase();
  const base = (e.fill ?? "#ffffff").toLowerCase();
  const headerFill =
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(color.slice(i, i + 2), 16) * 0.1 +
            parseInt(base.slice(i, i + 2), 16) * 0.9,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  return {
    fill: (s.fill ?? (header ? headerFill : base)).toLowerCase(),
    color,
    fontSize: s.fontSize ?? e.fontSize ?? 24,
    bold: s.bold ?? header,
    italic: s.italic ?? false,
    textAlign: s.textAlign ?? e.textAlign ?? "left",
    verticalAlign: s.verticalAlign ?? "top",
  };
}
export type CellFormatState = {
  [K in keyof Required<CellStyle>]: Required<CellStyle>[K] | null;
};
export function cellFormatState(e: Element, keys: string[]): CellFormatState {
  const valid = keys.filter((k) => Object.hasOwn(e.table!.cells, k));
  const styles = valid.map((k) => effectiveCellStyle(e, k));
  return Object.fromEntries(
    CELL_STYLE_KEYS.map((k) => [
      k,
      styles.length && styles.every((s) => s[k] === styles[0][k])
        ? styles[0][k]
        : null,
    ]),
  ) as CellFormatState;
}
