import { textDifference } from "./textDiff.ts";
import { changeRichText, sharedRichDelta } from "./sharedRichText.ts";
import { parseRichText, richPlain, textDelta } from "./richText.ts";
import { CELL_STYLE_KEYS } from "./tableData.ts";
import type { TableData } from "./tableData.ts";
import * as Y from "yjs";
import type { Deck, Element, Slide, Sheet } from "./model.ts";

export const LOCAL_CHANGE = "vhslide-local";
type Fields = Y.Map<unknown>;
function fields(value: unknown): Fields {
  if (!(value instanceof Y.Map))
    throw new Error("作品の共有データが壊れています。");
  return value;
}
function text(value: unknown): string {
  if (!(value instanceof Y.Text))
    throw new Error("文字の共有データが壊れています。");
  return value.toString();
}
/** Replace only the changed span, so concurrent text insertions remain independent. */
function changeText(target: Y.Text, before: string, after: string) {
  if (before === after) return;
  const { start, suffix } = textDifference(before, after);
  target.delete(start, before.length - start - suffix);
  target.insert(start, after.slice(start, after.length - suffix));
}
function patchFields(
  target: Fields,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  skip: string[],
) {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (
      skip.includes(key) ||
      JSON.stringify(before[key]) === JSON.stringify(after[key])
    )
      continue;
    if (after[key] === undefined) target.delete(key);
    else target.set(key, after[key]);
  }
}
export function applyDeckChange(doc: Y.Doc, before: Deck, after: Deck) {
  doc.transact(() => {
    changeText(doc.getText("title"), before.title, after.title);
    const routes = doc.getMap("routes");
    for (const old of before.routes ?? [])
      if (!(after.routes ?? []).some((r) => r.id === old.id))
        routes.delete(old.id);
    for (const route of after.routes ?? [])
      if (
        JSON.stringify(route) !==
        JSON.stringify(before.routes?.find((r) => r.id === route.id))
      )
        routes.set(route.id, route);
    const sheets = doc.getMap<Fields>("sheets");
    for (const old of before.sheets ?? [])
      if (!(after.sheets ?? []).some((s) => s.id === old.id))
        sheets.delete(old.id);
    (after.sheets ?? []).forEach((sheet, rank) => {
      const old = before.sheets?.find((s) => s.id === sheet.id);
      let target = sheets.get(sheet.id);
      if (!target) {
        if (
          old &&
          ![...doc.getMap<Fields>("slides").values()].some(
            (s) => (s.get("sheetId") ?? "main") === sheet.id,
          )
        )
          return;
        target = new Y.Map();
        sheets.set(sheet.id, target);
      }
      patchFields(
        target,
        (old ?? {}) as Record<string, unknown>,
        sheet as unknown as Record<string, unknown>,
        ["id", "name"],
      );
      if (!old || old.name !== sheet.name) target.set("name", sheet.name);
      if (!old || before.sheets?.indexOf(old) !== rank)
        target.set("rank", rank);
    });
    const slides = doc.getMap<Fields>("slides");
    for (const old of before.slides)
      if (!after.slides.some((s) => s.id === old.id)) slides.delete(old.id);
    for (const slide of after.slides) {
      const old = before.slides.find((s) => s.id === slide.id);
      let target = slides.get(slide.id);
      if (!old && target) continue;
      if (!target) {
        if (old) continue; // A concurrent deletion wins over a stale edit.
        target = new Y.Map();
        slides.set(slide.id, target);
        target.set("title", new Y.Text());
        target.set("elements", new Y.Map());
      }
      changeText(target.get("title") as Y.Text, old?.title ?? "", slide.title);
      if (old?.footerLabel !== slide.footerLabel) {
        if (slide.footerLabel === undefined) target.delete("footerLabel");
        else target.set("footerLabel", slide.footerLabel);
      }
      if (!old || old.x !== slide.x || old.y !== slide.y)
        target.set("position", { x: slide.x, y: slide.y });
      if (!old || old.sheetId !== slide.sheetId) {
        if (slide.sheetId === undefined) target.delete("sheetId");
        else target.set("sheetId", slide.sheetId);
      }
      if (!old || old.background !== slide.background)
        target.set("background", slide.background);
      const elements = fields(target.get("elements"));
      for (const previous of old?.elements ?? [])
        if (!slide.elements.some((e) => e.id === previous.id))
          elements.delete(previous.id);
      slide.elements.forEach((element, rank) => {
        const previous = old?.elements.find((e) => e.id === element.id);
        let item = elements.get(element.id) as Fields | undefined;
        if (!previous && item) return;
        if (!item) {
          if (previous) return;
          item = new Y.Map();
          elements.set(element.id, item);
          if (
            element.type === "text" ||
            (element.type === "shape" && element.text !== undefined)
          )
            item.set("text", new Y.Text());
        }
        patchFields(
          item,
          (previous ?? {}) as Record<string, unknown>,
          element as unknown as Record<string, unknown>,
          ["id", "text", "richText", "table", "chart"],
        );
        if (element.type === "chart" && element.chart) {
          let chart = item.get("chart") as Fields | undefined;
          if (!chart) {
            chart = new Y.Map();
            item.set("chart", chart);
            chart.set("series", new Y.Map());
          }
          const oldChart = previous?.chart;
          patchFields(
            chart,
            (oldChart ?? {}) as Record<string, unknown>,
            element.chart as unknown as Record<string, unknown>,
            ["series"],
          );
          const points = fields(chart.get("series"));
          for (const p of oldChart?.series ?? [])
            if (!element.chart.series.some((t) => t.id === p.id))
              points.delete(p.id);
          element.chart.series.forEach((p, rank) => {
            const old = oldChart?.series.find((t) => t.id === p.id);
            let point = points.get(p.id) as Fields | undefined;
            if (!point) {
              if (old) return;
              point = new Y.Map();
              points.set(p.id, point);
            }
            patchFields(
              point,
              (old ?? {}) as Record<string, unknown>,
              p as unknown as Record<string, unknown>,
              ["id"],
            );
            if (!old || oldChart?.series.indexOf(old) !== rank)
              point.set("rank", rank);
          });
        }
        if (element.type === "table" && element.table) {
          let table = item.get("table") as Fields | undefined;
          if (!table) {
            table = new Y.Map();
            item.set("table", table);
            table.set("cells", new Y.Map());
          }
          const oldTable = previous?.table;
          for (const key of ["rows", "columns", "header"] as const)
            if (
              JSON.stringify(oldTable?.[key]) !==
              JSON.stringify(element.table[key])
            )
              table.set(key, element.table[key]);
          // Granular stable keys avoid first-use nested-map creation conflicts.
          for (const kind of ["widths", "heights"] as const) {
            const prefix = kind === "widths" ? "width:" : "height:";
            for (const id of new Set([
              ...Object.keys(oldTable?.[kind] ?? {}),
              ...Object.keys(element.table[kind] ?? {}),
            ])) {
              const value = element.table[kind]?.[id];
              if (value === oldTable?.[kind]?.[id]) continue;
              if (value === undefined) table.delete(prefix + id);
              else table.set(prefix + id, value);
            }
          }
          for (const key of new Set([
            ...Object.keys(oldTable?.styles ?? {}),
            ...Object.keys(element.table.styles ?? {}),
          ]))
            for (const field of CELL_STYLE_KEYS) {
              const value = element.table.styles?.[key]?.[field];
              if (value === oldTable?.styles?.[key]?.[field]) continue;
              const name = `style:${key}:${field}`;
              if (value === undefined) table.delete(name);
              else table.set(name, value);
            }
          const cells = fields(table.get("cells"));
          for (const key of Object.keys(oldTable?.cells ?? {}))
            if (!(key in element.table.cells)) cells.delete(key);
          for (const [key, value] of Object.entries(element.table.cells)) {
            const old = oldTable?.cells[key];
            if (old === value) continue;
            let cell = cells.get(key) as Y.Text | undefined;
            if (!cell) {
              // A structural conflict may leave a current cell without a text node.
              // Recreate it; deleted rows/columns stay filtered out when reading.
              cell = new Y.Text();
              cells.set(key, cell);
              changeText(cell, "", value);
            } else changeText(cell, old ?? "", value);
          }
        }
        if (
          element.type === "text" ||
          (element.type === "shape" && element.text !== undefined)
        ) {
          if (!(item.get("text") instanceof Y.Text))
            item.set("text", new Y.Text());
          const value = item.get("text") as Y.Text;
          if (element.richText !== undefined || item.get("richText") === true) {
            if (item.get("richText") !== true) {
              value.insert(value.length, "\n");
              item.set("richText", true);
            }
            changeRichText(
              value,
              previous ? textDelta(previous) : [{ insert: "\n" }],
              textDelta(element),
            );
          } else changeText(value, previous?.text ?? "", element.text ?? "");
        } else if (previous?.type === "shape" && previous.text !== undefined)
          item.delete("text");
        if (!previous || old?.elements.indexOf(previous) !== rank)
          item.set("rank", rank);
      });
    }
  }, LOCAL_CHANGE);
}
export function createSharedDeck(deck: Deck): Y.Doc {
  const doc = new Y.Doc();
  applyDeckChange(doc, { version: 1, title: "", slides: [] }, deck);
  return doc;
}
/** Deterministically place simultaneous additions into distinct, fixed grid cells. */
export function readSharedDeck(doc: Y.Doc): Deck {
  const slides: Slide[] = [];
  const sheets = [...doc.getMap<Fields>("sheets")]
    .map(([id, s]) => ({
      id,
      name: String(s.get("name")),
      rank: Number(s.get("rank")),
      ...(s.has("rowLabels")
        ? { rowLabels: s.get("rowLabels") as Sheet["rowLabels"] }
        : {}),
      ...(s.has("columnLabels")
        ? { columnLabels: s.get("columnLabels") as Sheet["columnLabels"] }
        : {}),
      ...(s.has("rowIds")
        ? { rowIds: s.get("rowIds") as Sheet["rowIds"] }
        : {}),
      ...(s.has("columnIds")
        ? { columnIds: s.get("columnIds") as Sheet["columnIds"] }
        : {}),
      ...(s.has("showRowAccounts")
        ? { showRowAccounts: s.get("showRowAccounts") as boolean }
        : {}),
    }))
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .map(({ rank: _rank, ...sheet }) => sheet);
  const pageSheets = new Set(
    [...doc.getMap<Fields>("slides").values()].map(
      (s) => (s.get("sheetId") ?? "main") as string,
    ),
  );
  if (sheets.length || [...pageSheets].some((id) => id !== "main")) {
    for (const id of pageSheets)
      if (!sheets.some((sheet) => sheet.id === id)) {
        const recovered = {
          id,
          name: id === "main" ? "シート1" : "復元したシート",
        };
        if (id === "main") sheets.unshift(recovered);
        else sheets.push(recovered);
      }
  }
  for (const [id, value] of doc.getMap("slides")) {
    const s = fields(value);
    const position = s.get("position") as { x: number; y: number };
    if (
      !position ||
      ![position.x, position.y].every(
        (n) => Number.isInteger(n) && n >= 0 && n < 100,
      )
    )
      throw new Error("ページの位置が正しくありません。");
    const elements = [...fields(s.get("elements"))]
      .map(([elementId, value]) => {
        const e = fields(value),
          raw = e.toJSON();
        delete raw.rank;
        if (raw.type === "text" || (raw.type === "shape" && e.has("text"))) {
          raw.text = text(e.get("text"));
          if (e.get("richText") === true) {
            const delta = sharedRichDelta(e.get("text") as Y.Text);
            raw.text = richPlain(delta);
            raw.richText = parseRichText(delta, raw.text);
          } else delete raw.richText;
        }
        if (raw.type === "chart") {
          const chart = fields(e.get("chart")),
            points = fields(chart.get("series"));
          raw.chart = {
            ...chart.toJSON(),
            series: [...points]
              .map(
                ([id, p]) =>
                  ({ id, ...fields(p).toJSON() }) as {
                    id: string;
                    rank: number;
                    [key: string]: unknown;
                  },
              )
              .sort(
                (a, b) =>
                  Number(a.rank) - Number(b.rank) || a.id.localeCompare(b.id),
              )
              .map(({ rank, ...p }) => p),
          };
        }
        if (raw.type === "table") {
          const table = fields(e.get("table"));
          const rows = table.get("rows") as string[],
            columns = table.get("columns") as string[];
          if (!Array.isArray(rows) || !Array.isArray(columns))
            throw new Error("表の共有データが壊れています。");
          const keys = new Set(
            rows.flatMap((r) => columns.map((c) => `${r}:${c}`)),
          );
          const widths: Record<string, number> = {},
            heights: Record<string, number> = {},
            styles: NonNullable<TableData["styles"]> = {};
          for (const column of columns)
            if (table.has(`width:${column}`))
              widths[column] = table.get(`width:${column}`) as number;
          for (const row of rows)
            if (table.has(`height:${row}`))
              heights[row] = table.get(`height:${row}`) as number;
          for (const key of keys) {
            const style: Record<string, unknown> = {};
            for (const field of CELL_STYLE_KEYS)
              if (table.has(`style:${key}:${field}`))
                style[field] = table.get(`style:${key}:${field}`);
            if (Object.keys(style).length) styles[key] = style;
          }
          raw.table = {
            ...(Object.keys(widths).length ? { widths } : {}),
            ...(Object.keys(heights).length ? { heights } : {}),
            ...(Object.keys(styles).length ? { styles } : {}),
            rows,
            columns,
            header: table.get("header"),
            cells: Object.fromEntries(
              [...keys].map((key) => {
                const value = fields(table.get("cells")).get(key);
                return [key, value === undefined ? "" : text(value)];
              }),
            ),
          } as TableData;
        }
        return {
          element: { ...raw, id: elementId } as Element,
          rank: Number(e.get("rank")),
        };
      })
      .sort(
        (a, b) => a.rank - b.rank || a.element.id.localeCompare(b.element.id),
      )
      .map((e) => e.element);
    if (
      sheets.length &&
      !sheets.some((sheet) => sheet.id === (s.get("sheetId") ?? "main"))
    )
      continue;
    slides.push({
      id,
      ...(s.get("sheetId") === undefined
        ? {}
        : { sheetId: s.get("sheetId") as string }),
      ...position,
      title: text(s.get("title")),
      ...(s.has("footerLabel")
        ? { footerLabel: String(s.get("footerLabel")) }
        : {}),
      background: s.get("background") as string,
      elements,
    });
  }
  const occupied = new Set<string>();
  slides.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  for (const s of slides) {
    while (occupied.has(`${s.sheetId ?? "main"}:${s.x},${s.y}`)) {
      s.x++;
      if (s.x >= 100) {
        s.x = 0;
        s.y++;
      }
      if (s.y >= 100) throw new Error("縦・横は100マスまでです。");
    }
    occupied.add(`${s.sheetId ?? "main"}:${s.x},${s.y}`);
  }
  for (const sheet of sheets.length
    ? sheets
    : [{ id: "main", name: "シート1" }]) {
    if (!occupied.has(`${sheet.id}:0,0`))
      slides.unshift({
        id: `cloud-start-${sheet.id}`,
        ...(sheet.id === "main" ? {} : { sheetId: sheet.id }),
        x: 0,
        y: 0,
        title: "はじめのページ",
        background: "#ffffff",
        elements: [],
      });
  }
  return {
    version: 1,
    title: doc.getText("title").toString(),
    ...(doc.getMap("routes").size
      ? { routes: [...doc.getMap("routes").values()] as Deck["routes"] }
      : {}),
    slides,
    ...(sheets.length ? { sheets } : {}),
  };
}
export function sharedText(
  doc: Y.Doc,
  slideId: string,
  elementId: string,
): Y.Text | undefined {
  const slide = doc.getMap<Fields>("slides").get(slideId);
  const elements = slide?.get("elements");
  const element =
    elements instanceof Y.Map ? elements.get(elementId) : undefined;
  const value = element instanceof Y.Map ? element.get("text") : undefined;
  return value instanceof Y.Text ? value : undefined;
}
export function toBase64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
export const fromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
