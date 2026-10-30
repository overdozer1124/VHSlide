export const MAX_TABLE_AXIS = 12;
export const MAX_CELL_TEXT = 2000;
export type CellStyle = {
  fill?: string;
  color?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
};
export const CELL_STYLE_KEYS = [
  "fill",
  "color",
  "fontSize",
  "bold",
  "italic",
  "textAlign",
  "verticalAlign",
] as const;
export interface TableData {
  styles?: Record<string, CellStyle>;
  widths?: Record<string, number>;
  heights?: Record<string, number>;
  rows: string[];
  columns: string[];
  cells: Record<string, string>;
  header: boolean;
}
export const cellKey = (row: string, column: string) => `${row}:${column}`;
export function createTable(
  rows: number,
  columns: number,
  id: () => string,
): TableData {
  return parseTable({
    rows: Array.from({ length: rows }, id),
    columns: Array.from({ length: columns }, id),
    cells: {},
    header: true,
  });
}
export function parseTable(value: unknown): TableData {
  const fail = (): never => {
    throw new Error(
      "表は1〜12行・1〜12列、セルの文字は2000文字以内にしてください。",
    );
  };
  if (!value || typeof value !== "object") return fail();
  const t = value as TableData;
  const axis = (a: unknown): string[] => {
    if (
      !Array.isArray(a) ||
      !a.length ||
      a.length > MAX_TABLE_AXIS ||
      a.some(
        (v) => typeof v !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(v),
      ) ||
      new Set(a).size !== a.length
    )
      return fail();
    return [...a];
  };
  const rows = axis(t.rows),
    columns = axis(t.columns);
  if (
    typeof t.header !== "boolean" ||
    !t.cells ||
    typeof t.cells !== "object" ||
    Array.isArray(t.cells)
  )
    return fail();
  const keys = new Set(rows.flatMap((r) => columns.map((c) => cellKey(r, c))));
  const cells: Record<string, string> = Object.fromEntries(
    [...keys].map((key) => [key, ""]),
  );
  for (const [key, text] of Object.entries(t.cells)) {
    if (
      !keys.has(key) ||
      typeof text !== "string" ||
      text.length > MAX_CELL_TEXT
    )
      return fail();
    cells[key] = text;
  }
  const styles: Record<string, CellStyle> = {};
  if (t.styles !== undefined) {
    if (!t.styles || typeof t.styles !== "object" || Array.isArray(t.styles))
      return fail();
    for (const [key, style] of Object.entries(t.styles)) {
      if (
        !keys.has(key) ||
        !style ||
        typeof style !== "object" ||
        Array.isArray(style)
      )
        return fail();
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(style)) {
        if (!CELL_STYLE_KEYS.includes(k as (typeof CELL_STYLE_KEYS)[number]))
          return fail();
        if (k === "fill" || k === "color") {
          if (typeof v !== "string" || !/^#[0-9a-fA-F]{6}$/.test(v))
            return fail();
        }
        if (
          k === "fontSize" &&
          (typeof v !== "number" || !Number.isFinite(v) || v < 12 || v > 72)
        )
          return fail();
        if ((k === "bold" || k === "italic") && typeof v !== "boolean")
          return fail();
        if (
          k === "textAlign" &&
          !["left", "center", "right"].includes(v as string)
        )
          return fail();
        if (
          k === "verticalAlign" &&
          !["top", "middle", "bottom"].includes(v as string)
        )
          return fail();
        next[k] = v;
      }
      if (Object.keys(next).length) styles[key] = next;
    }
  }
  const sizes = (input: unknown, ids: string[]) => {
    if (input === undefined) return undefined;
    if (!input || typeof input !== "object" || Array.isArray(input))
      return fail();
    const result: Record<string, number> = {};
    for (const [id, v] of Object.entries(input)) {
      if (
        !ids.includes(id) ||
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0.25 ||
        v > 8
      )
        return fail();
      result[id] = v;
    }
    return Object.keys(result).length ? result : undefined;
  };
  const widths = sizes(t.widths, columns),
    heights = sizes(t.heights, rows);
  return {
    rows,
    columns,
    cells,
    header: t.header,
    ...(Object.keys(styles).length ? { styles } : {}),
    ...(widths ? { widths } : {}),
    ...(heights ? { heights } : {}),
  };
}
export function resizeTable(
  t: TableData,
  axis: "rows" | "columns",
  delta: 1 | -1,
  id: () => string,
): TableData {
  if (
    (delta < 0 && t[axis].length === 1) ||
    (delta > 0 && t[axis].length === MAX_TABLE_AXIS)
  )
    return t;
  return changeTableAxis(
    t,
    axis,
    delta > 0 ? "insert" : "delete",
    delta > 0 ? t[axis].length : t[axis].length - 1,
    id,
  );
}
export function changeTableAxis(
  t: TableData,
  axis: "rows" | "columns",
  action: "insert" | "delete",
  index: number,
  id: () => string,
): TableData {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > (action === "insert" ? t[axis].length : t[axis].length - 1)
  )
    throw new Error("表の位置が正しくありません。");
  if (
    (action === "delete" && t[axis].length === 1) ||
    (action === "insert" && t[axis].length === MAX_TABLE_AXIS)
  )
    return t;
  const ids = [...t[axis]];
  if (action === "insert") ids.splice(index, 0, id());
  else ids.splice(index, 1);
  const next = { ...t, [axis]: ids };
  const keys = new Set(
    next.rows.flatMap((r) => next.columns.map((c) => cellKey(r, c))),
  );
  return parseTable({
    ...next,
    cells: Object.fromEntries(
      Object.entries(t.cells).filter(([k]) => keys.has(k)),
    ),
    ...(t.styles
      ? {
          styles: Object.fromEntries(
            Object.entries(t.styles).filter(([k]) => keys.has(k)),
          ),
        }
      : {}),
    ...(t.widths
      ? {
          widths: Object.fromEntries(
            Object.entries(t.widths).filter(([k]) => next.columns.includes(k)),
          ),
        }
      : {}),
    ...(t.heights
      ? {
          heights: Object.fromEntries(
            Object.entries(t.heights).filter(([k]) => next.rows.includes(k)),
          ),
        }
      : {}),
  });
}
export function cellRectangle(t: TableData, a: string, b: string): string[] {
  const [ar, ac] = a.split(":"),
    [br, bc] = b.split(":"),
    r1 = t.rows.indexOf(ar),
    r2 = t.rows.indexOf(br),
    c1 = t.columns.indexOf(ac),
    c2 = t.columns.indexOf(bc);
  if ([r1, r2, c1, c2].some((v) => v < 0)) return [];
  return t.rows
    .slice(Math.min(r1, r2), Math.max(r1, r2) + 1)
    .flatMap((r) =>
      t.columns
        .slice(Math.min(c1, c2), Math.max(c1, c2) + 1)
        .map((c) => cellKey(r, c)),
    );
}
/** Paste a bounded TSV rectangle atomically; quoted spreadsheet fields may contain newlines. */
export function pasteTable(
  t: TableData,
  start: string,
  input: string,
  id: () => string,
): { table: TableData; keys: string[] } {
  if (input.length > 300000) throw new Error("貼り付ける表が大きすぎます。");
  const rows: string[][] = [[]];
  let field = "",
    quoted = false;
  const s = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && (quoted || field === "")) {
      if (quoted && s[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "\t" || c === "\n")) {
      rows.at(-1)!.push(field);
      field = "";
      if (c === "\n") rows.push([]);
    } else field += c;
  }
  if (quoted) throw new Error("貼り付ける表の引用符が閉じていません。");
  rows.at(-1)!.push(field);
  if (s.endsWith("\n") && rows.at(-1)!.length === 1 && rows.at(-1)![0] === "")
    rows.pop();
  const [row, col] = start.split(":"),
    r = t.rows.indexOf(row),
    c = t.columns.indexOf(col),
    width = Math.max(...rows.map((a) => a.length));
  if (
    r < 0 ||
    c < 0 ||
    r + rows.length > 12 ||
    c + width > 12 ||
    rows.some((a) => a.some((v) => v.length > MAX_CELL_TEXT))
  )
    throw new Error("表は12行・12列まで、セルは2000文字まで貼り付けできます。");
  let next = t;
  while (next.rows.length < r + rows.length)
    next = changeTableAxis(next, "rows", "insert", next.rows.length, id);
  while (next.columns.length < c + width)
    next = changeTableAxis(next, "columns", "insert", next.columns.length, id);
  const cells = { ...next.cells },
    keys: string[] = [];
  rows.forEach((values, dy) => {
    for (let dx = 0; dx < width; dx++) {
      const key = cellKey(next.rows[r + dy], next.columns[c + dx]);
      keys.push(key);
      cells[key] = values[dx] ?? "";
    }
  });
  return { table: parseTable({ ...next, cells }), keys };
}
