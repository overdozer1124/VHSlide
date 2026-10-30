import { webLink } from "./webLink.ts";
import { parseChart } from "./chartData.ts";
import type { ChartData } from "./chartData.ts";
import { parseAnchor, copyPages } from "./structureData.ts";
import type { ConnectorAnchor } from "./structureData.ts";
import { parseRichText } from "./richText.ts";
import type { RichOp } from "./richText.ts";
import { parseCrop } from "./imageData.ts";
import type { ImageCrop } from "./imageData.ts";
import { shapeIds } from "./shapeCatalog.ts";
import type { ShapeKind } from "./shapeCatalog.ts";
import { parseTable } from "./tableData.ts";
import type { TableData } from "./tableData.ts";
import { remapAxis } from "./axes.ts";
export const MAX_SLIDES = 1000;
export const MAX_FILE_BYTES = 25_000_000;
export const W = 960,
  H = 540;
export interface GridMove {
  mode: "slide" | "row" | "column";
  x: number;
  y: number;
}
export type Shape = ShapeKind;
export interface Element {
  id: string;
  type: "text" | "image" | "shape" | "table" | "line" | "chart";
  groupId?: string;
  startAnchor?: ConnectorAnchor;
  endAnchor?: ConnectorAnchor;
  link?: { slideId?: string; url?: string };
  drawingTool?:
    "pen" | "fill" | "eraser" | "line" | "rectangle" | "ellipse" | "select";
  eraserWidth?: number;
  inkShapeFill?: string;
  inkShapeDash?: "solid" | "dash" | "dot";
  drawing?: {
    points: { x: number; y: number }[];
    color: string;
    width: number;
    erase?: boolean;
    shape?: "line" | "rectangle" | "ellipse";
    fill?: string;
    dash?: "solid" | "dash" | "dot";
    fillContours?: { x: number; y: number }[][];
  }[];
  writingMode?: "horizontal-tb" | "vertical-rl";
  chart?: ChartData;
  rotation?: 0 | 90 | 180 | 270;
  flipX?: boolean;
  flipY?: boolean;
  aspectLocked?: boolean;
  opacity?: number;
  strokeWidth?: number;
  strokeDash?: "solid" | "dash" | "dot";
  lineKind?: "straight" | "elbow" | "curve";
  lineStart?: { x: number; y: number };
  lineEnd?: { x: number; y: number };
  startArrow?: "none" | "triangle" | "circle";
  endArrow?: "none" | "triangle" | "circle";
  table?: TableData;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  richText?: RichOp[];
  fontSize?: number;
  bold?: boolean;
  color?: string;
  highlight?: string;
  bullets?: boolean;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  src?: string;
  crop?: ImageCrop;
  altText?: string;
  shape?: Shape;
  fill?: string;
  stroke?: string;
}
export interface Slide {
  speakerNotes?: string;
  footerLabel?: string;
  id: string;
  sheetId?: string;
  x: number;
  y: number;
  title: string;
  background: string;
  elements: Element[];
}
export interface Sheet {
  id: string;
  name: string;
  rowLabels?: Record<string, string>;
  columnLabels?: Record<string, string>;
  showRowAccounts?: boolean;
  rowIds?: Record<string, string>;
  columnIds?: Record<string, string>;
}
export type PresentationRoute = { id: string; name: string; slides: string[] };
export interface Deck {
  restrictGuests?: boolean;
  guestPageCreation?: "none" | "append" | "insert";
  routes?: PresentationRoute[];
  version: 1;
  title: string;
  slides: Slide[];
  /** One remembered slide ID per row; coordinates may change during reordering. */
  rowSelections?: string[];
  /** Show the same topic in every editor row; independent choices are retained. */
  linkedRows?: boolean;
  sheets?: Sheet[];
  activeSheetId?: string;
}
export const uid = (): string => {
  if (crypto.randomUUID) return crypto.randomUUID();
  // UUID v4 also works on a local HTTP network, where randomUUID may be unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const blank = (x: number, y: number): Slide => ({
  id: uid(),
  x,
  y,
  title: "あたらしいページ",
  background: "#ffffff",
  elements: [],
});
const txt = (
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color = "#173d38",
  w = 780,
): Element => ({
  id: uid(),
  type: "text",
  text,
  x,
  y,
  w,
  h: fontSize * 3,
  fontSize,
  bold: true,
  color,
});
export function sample(): Deck {
  const make = (
    x: number,
    y: number,
    title: string,
    background: string,
    elements: Element[],
  ): Slide => ({ id: uid(), x, y, title, background, elements });
  return {
    version: 1,
    title: "わたしたちのまちの、いいところ",
    slides: [
      make(0, 0, "わたしたちのまち", "#e5f0dc", [
        txt("OUR TOWN", 68, 62, 20),
        txt("わたしたちのまちの、\nいいところ。", 68, 148, 58),
        txt("いつもの景色に、新しい発見。", 72, 415, 22),
        {
          id: uid(),
          type: "shape",
          shape: "circle",
          x: 735,
          y: 55,
          w: 145,
          h: 145,
          fill: "#b8d394",
          stroke: "#b8d394",
        },
      ]),
      make(1, 0, "自然がいっぱい", "#e7efea", [
        txt("01  /  NATURE", 68, 62, 20),
        txt("自然がいっぱい。", 68, 174, 60),
        txt("緑の道を、歩いてみよう。", 72, 364, 26),
      ]),
      make(2, 0, "人とつながる", "#f8eddc", [
        txt("02  /  PEOPLE", 68, 62, 20),
        txt("人と、つながる。", 68, 174, 60),
        txt("「こんにちは」から、はじまる。", 72, 364, 26),
      ]),
      make(0, 1, "まちを歩いてみたら", "#f4f3e9", [
        txt("ちいさな発見 01", 68, 62, 20),
        txt("まちを歩いてみたら", 68, 174, 49),
        txt("いつもの通学路にも、\nまだ知らないことがある。", 72, 325, 28),
      ]),
      make(1, 1, "お気に入りの公園", "#edf3e3", [
        txt("ちいさな発見 02", 68, 62, 20),
        txt("お気に入りの公園", 68, 174, 49),
        txt("季節が変わると、\nどんな発見があるかな？", 72, 325, 28),
      ]),
    ],
  };
}
export function bounds(deck: Deck) {
  return {
    cols: Math.max(...deck.slides.map((s) => s.x)) + 1,
    rows: Math.max(...deck.slides.map((s) => s.y)) + 1,
  };
}
export function insert(
  deck: Deck,
  at: Slide,
  direction: "right" | "down",
): Deck {
  if (deck.slides.length >= MAX_SLIDES)
    throw new Error(`ページは${MAX_SLIDES}枚までです。`);
  const x = at.x + (direction === "right" ? 1 : 0),
    y = direction === "right" ? 0 : at.y + 1;
  const slides = deck.slides.map((s) =>
    direction === "right" && s.x >= x
      ? { ...s, x: s.x + 1 }
      : direction === "down" && s.x === x && s.y >= y
        ? { ...s, y: s.y + 1 }
        : s,
  );
  return {
    ...(direction === "right"
      ? remapAxis(deck, "columns", (i) => (i >= x ? i + 1 : i))
      : deck),
    slides: [...slides, blank(x, y)],
  };
}
/** Insert a complete grid line between pages; the origin is never displaced. */
export function insertGridLine(
  deck: Deck,
  axis: "row" | "column",
  index: number,
  cross: number,
): Deck {
  const size = bounds(deck);
  const length = axis === "row" ? size.rows : size.cols;
  const crossLength = axis === "row" ? size.cols : size.rows;
  if (
    !Number.isInteger(index) ||
    index < 1 ||
    index > length ||
    !Number.isInteger(cross) ||
    cross < 0 ||
    cross >= crossLength
  )
    throw new Error("ページの間か、最後の＋を選んでください。");
  if (deck.slides.length >= MAX_SLIDES)
    throw new Error(`ページは${MAX_SLIDES}枚までです。`);
  if (length >= 100) throw new Error("縦・横は100マスまでです。");
  const slides = deck.slides.map((s) =>
    axis === "row" && s.y >= index
      ? { ...s, y: s.y + 1 }
      : axis === "column" && s.x >= index
        ? { ...s, x: s.x + 1 }
        : s,
  );
  return {
    ...remapAxis(deck, axis === "row" ? "rows" : "columns", (i) =>
      i >= index ? i + 1 : i,
    ),
    slides: [
      ...slides,
      blank(axis === "column" ? index : cross, axis === "row" ? index : cross),
    ],
  };
}
export function swap(
  deck: Deck,
  mode: "slide" | "row" | "column",
  from: { x: number; y: number },
  to: { x: number; y: number },
): Deck {
  return {
    ...(mode === "slide"
      ? deck
      : remapAxis(deck, mode === "row" ? "rows" : "columns", (i) => {
          const a = mode === "row" ? from.y : from.x,
            b = mode === "row" ? to.y : to.x;
          return i === a ? b : i === b ? a : i;
        })),
    slides: deck.slides.map((s) => {
      if (mode === "row")
        return { ...s, y: s.y === from.y ? to.y : s.y === to.y ? from.y : s.y };
      if (mode === "column")
        return { ...s, x: s.x === from.x ? to.x : s.x === to.x ? from.x : s.x };
      if (s.x === from.x && s.y === from.y) return { ...s, x: to.x, y: to.y };
      if (s.x === to.x && s.y === to.y) return { ...s, x: from.x, y: from.y };
      return s;
    }),
  };
}
export function removeSlide(deck: Deck, id: string): Deck {
  const slides = deck.slides.filter((s) => s.id !== id);
  if (!slides.length) return { ...deck, slides: [blank(0, 0)] };
  if (!slides.some((s) => s.x === 0 && s.y === 0)) {
    const first = [...slides].sort((a, b) => a.x - b.x || a.y - b.y)[0];
    return {
      ...deck,
      slides: slides.map((s) => (s.id === first.id ? { ...s, x: 0, y: 0 } : s)),
    };
  }
  return { ...deck, slides };
}
/** Pick the independently remembered page of a row, falling back to its leftmost page. */
export function rowPage(
  deck: Deck,
  y: number,
  linkedX?: number,
): Slide | undefined {
  if (deck.linkedRows && linkedX !== undefined)
    return deck.slides.find((s) => s.y === y && s.x === linkedX);
  const pages = deck.slides.filter((s) => s.y === y).sort((a, b) => a.x - b.x);
  return pages.find((s) => deck.rowSelections?.includes(s.id)) ?? pages[0];
}
export function rememberRowPage(deck: Deck, id: string): Deck {
  const chosen = deck.slides.find((s) => s.id === id);
  if (!chosen) return deck;
  const seenRows = new Set<string>();
  const rowSelections = (deck.rowSelections ?? []).filter((remembered) => {
    const page = deck.slides.find((s) => s.id === remembered);
    if (
      !page ||
      page.y === chosen.y ||
      seenRows.has(`${page.sheetId ?? "main"}:${page.y}`)
    )
      return false;
    seenRows.add(`${page.sheetId ?? "main"}:${page.y}`);
    return true;
  });
  return { ...deck, rowSelections: [...rowSelections, id] };
}
export function editorNeighbor(
  deck: Deck,
  current: Slide,
  dx: number,
  dy: number,
): Slide | undefined {
  if (dx)
    return deck.slides
      .filter(
        (s) =>
          s.y === current.y && (dx > 0 ? s.x > current.x : s.x < current.x),
      )
      .sort((a, b) => (dx > 0 ? a.x - b.x : b.x - a.x))[0];
  if (!dy) return undefined;
  if (deck.linkedRows) return neighbor(deck, current, 0, dy);
  const ys = [...new Set(deck.slides.map((s) => s.y))]
    .filter((y) => (dy > 0 ? y > current.y : y < current.y))
    .sort((a, b) => (dy > 0 ? a - b : b - a));
  return ys.length ? rowPage(deck, ys[0]) : undefined;
}
function requireOrigin(deck: Deck): Deck {
  if (!deck.slides.some((s) => s.x === 0 && s.y === 0))
    throw new Error("はじめのマスにページが残る場所へ移動してください。");
  return deck;
}
/** Reorder an entire row, shifting the rows between source and destination. */
export function moveRowGroup(deck: Deck, from: number, to: number): Deck {
  const { rows } = bounds(deck);
  if (![from, to].every((y) => Number.isInteger(y) && y >= 0 && y < rows))
    throw new Error("移動先の段を選んでください。");
  if (from === to) return deck;
  return requireOrigin({
    ...remapAxis(deck, "rows", (i) =>
      i === from
        ? to
        : from < to && i > from && i <= to
          ? i - 1
          : from > to && i >= to && i < from
            ? i + 1
            : i,
    ),
    slides: deck.slides.map((s) => ({
      ...s,
      y:
        s.y === from
          ? to
          : from < to && s.y > from && s.y <= to
            ? s.y - 1
            : from > to && s.y >= to && s.y < from
              ? s.y + 1
              : s.y,
    })),
  });
}
/** Overlapping row thumbnails swaps the two complete groups. */
export function swapRowGroups(deck: Deck, from: number, to: number): Deck {
  const { rows } = bounds(deck);
  if (![from, to].every((y) => Number.isInteger(y) && y >= 0 && y < rows))
    throw new Error("移動先の段を選んでください。");
  if (from === to) return deck;
  return requireOrigin(swap(deck, "row", { x: 0, y: from }, { x: 0, y: to }));
}
/** A gap refers to the boundary before removing the source row. */
export function insertMovedRowGroup(
  deck: Deck,
  from: number,
  boundary: number,
): Deck {
  const { rows } = bounds(deck);
  if (!Number.isInteger(boundary) || boundary < 0 || boundary > rows)
    throw new Error("挿入先の段を選んでください。");
  return moveRowGroup(deck, from, boundary - (from < boundary ? 1 : 0));
}
/** Move one page across grid rows. An occupied destination swaps the two pages. */
export function movePage(deck: Deck, id: string, x: number, y: number): Deck {
  const from = deck.slides.find((s) => s.id === id);
  if (!from || ![x, y].every((v) => Number.isInteger(v) && v >= 0 && v < 100))
    throw new Error("移動先のマスを選んでください。");
  if (from.x === x && from.y === y) return deck;
  return requireOrigin(swap(deck, "slide", from, { x, y }));
}
/** Insert an existing page at a row boundary. Only source/destination rows shift. */
export function insertMovedPage(
  deck: Deck,
  id: string,
  boundary: number,
  y: number,
): Deck {
  const from = deck.slides.find((s) => s.id === id);
  if (
    !from ||
    !Number.isInteger(boundary) ||
    boundary < 0 ||
    boundary > 100 ||
    !Number.isInteger(y) ||
    y < 0 ||
    y >= 100
  )
    throw new Error("挿入先を選んでください。");
  const x = boundary - (from.y === y && from.x < boundary ? 1 : 0);
  if (from.y === y && from.x === x) return deck;
  if (x >= 100) throw new Error("縦・横は100マスまでです。");
  const next = {
    ...deck,
    slides: deck.slides.map((s) => {
      if (s.id === id) return { ...s, x, y };
      let nextX = s.x;
      if (s.y === from.y && nextX > from.x) nextX--;
      if (s.y === y && nextX >= x) nextX++;
      if (nextX >= 100) throw new Error("縦・横は100マスまでです。");
      return nextX === s.x ? s : { ...s, x: nextX };
    }),
  };
  return requireOrigin(next);
}
function copySlide(source: Slide, x: number, y: number): Slide {
  const copied = copyPages([source], uid)[0];
  return { ...copied, x, y, title: `${source.title.slice(0, 195)} のコピー` };
}
/** Copy one page to its right, shifting only pages in that row. */
export function duplicateSlide(deck: Deck, id: string): Deck {
  const source = deck.slides.find((s) => s.id === id);
  if (!source) throw new Error("複製するページが見つかりません。");
  if (deck.slides.length >= MAX_SLIDES)
    throw new Error(`ページは${MAX_SLIDES}枚までです。`);
  if (deck.slides.some((s) => s.y === source.y && s.x === 99))
    throw new Error("縦・横は100マスまでです。");
  return {
    ...deck,
    slides: [
      ...deck.slides.map((s) =>
        s.y === source.y && s.x > source.x ? { ...s, x: s.x + 1 } : s,
      ),
      copySlide(source, source.x + 1, source.y),
    ],
  };
}
/** Copy an entire row immediately below itself, preserving its gaps and selection. */
export function duplicateRowGroup(deck: Deck, y: number, count = 1): Deck {
  const source = deck.slides.filter((s) => s.y === y);
  if (!source.length) throw new Error("複製する段にページがありません。");
  if (!Number.isInteger(count) || count < 1 || count > 99)
    throw new Error("複製する数は1〜99で指定してください。");
  if (deck.slides.length + source.length * count > MAX_SLIDES)
    throw new Error(`ページは${MAX_SLIDES}枚までです。`);
  if (bounds(deck).rows + count > 100)
    throw new Error("縦・横は100マスまでです。");
  const copies = Array.from({ length: count }, (_, i) =>
    copyPages(source, uid).map((s) => ({
      ...s,
      y: y + i + 1,
      title: `${s.title.slice(0, 195)} のコピー`,
    })),
  ).flat();
  const chosen = rowPage(deck, y);
  const chosenCopy = copies.find((s) => s.x === chosen?.x);
  const next = {
    ...remapAxis(deck, "rows", (i) => (i > y ? i + count : i)),
    slides: [
      ...deck.slides.map((s) => (s.y > y ? { ...s, y: s.y + count } : s)),
      ...copies,
    ],
  };
  return chosenCopy ? rememberRowPage(next, chosenCopy.id) : next;
}
/** Delete a whole row and close the gap without changing other topics' x positions. */
export function removeRowGroup(deck: Deck, y: number): Deck {
  if (!Number.isInteger(y) || y < 0 || y >= bounds(deck).rows)
    throw new Error("削除する段を選んでください。");
  const slides = deck.slides
    .filter((s) => s.y !== y)
    .map((s) => (s.y > y ? { ...s, y: s.y - 1 } : s));
  if (!slides.some((s) => s.x === 0 && s.y === 0)) slides.unshift(blank(0, 0));
  return {
    ...remapAxis(deck, "rows", (i) =>
      i === y ? undefined : i > y ? i - 1 : i,
    ),
    slides,
    ...(deck.rowSelections === undefined
      ? {}
      : {
          rowSelections: deck.rowSelections.filter((id) =>
            slides.some((s) => s.id === id),
          ),
        }),
  };
}
// Import only known fields. Never render imported HTML, external images, or executable URLs.
export function parseDeck(input: string): Deck {
  if (input.length > MAX_FILE_BYTES)
    throw new Error("ファイルが大きすぎます（25MBまで）。");
  const d = JSON.parse(input);
  const fail = (): never => {
    throw new Error("対応するVHSlideファイルではありません。");
  };
  const str = (v: unknown, limit = 10000): string =>
    typeof v === "string" && v.length <= limit ? v : fail();
  const num = (v: unknown, min: number, max: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
      ? v
      : fail();
  const bool = (v: unknown): boolean => (typeof v === "boolean" ? v : fail());
  const color = (v: unknown): string =>
    /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : fail();
  if (
    d?.version !== 1 ||
    !Array.isArray(d.slides) ||
    !d.slides.length ||
    d.slides.length > MAX_SLIDES
  )
    fail();
  let sheets: Deck["sheets"];
  if (d.sheets !== undefined) {
    if (!Array.isArray(d.sheets) || !d.sheets.length || d.sheets.length > 50)
      fail();
    const seen = new Set<string>();
    sheets = d.sheets.map((sheet: any) => {
      const sheetId = str(sheet?.id, 100),
        name = str(sheet?.name, 80);
      if (!sheetId || !name.trim() || seen.has(sheetId)) fail();
      seen.add(sheetId);
      const labels = (value: unknown): Record<string, string> => {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).length > 100
        )
          fail();
        const result: Record<string, string> = {};
        for (const [key, text] of Object.entries(
          value as Record<string, unknown>,
        )) {
          if (!/^(0|[1-9][0-9]?)$/.test(key)) fail();
          result[key] = str(text, 80);
        }
        return result;
      };
      const identities = (value: unknown): Record<string, string> => {
        const result = labels(value);
        const seen = new Set<string>();
        for (let i = 0; i < 100; i++) {
          const value = result[String(i)] ?? String(i);
          if (!value || seen.has(value)) fail();
          seen.add(value);
        }
        return result;
      };
      return {
        id: sheetId,
        name,
        ...(sheet.rowIds === undefined
          ? {}
          : { rowIds: identities(sheet.rowIds) }),
        ...(sheet.columnIds === undefined
          ? {}
          : { columnIds: identities(sheet.columnIds) }),
        ...(sheet.rowLabels === undefined
          ? {}
          : { rowLabels: labels(sheet.rowLabels) }),
        ...(sheet.columnLabels === undefined
          ? {}
          : { columnLabels: labels(sheet.columnLabels) }),
        ...(sheet.showRowAccounts === undefined
          ? {}
          : { showRowAccounts: bool(sheet.showRowAccounts) }),
      };
    });
  }
  const ids = new Set<string>(),
    cells = new Set<string>();
  const id = (v: unknown) => {
    const value = str(v, 100);
    if (!value || ids.has(value)) fail();
    ids.add(value);
    return value;
  };
  const slides: Slide[] = d.slides.map((s: any) => {
    if (!s || !Array.isArray(s.elements) || s.elements.length > 200) fail();
    const x = num(s.x, 0, 99),
      y = num(s.y, 0, 99),
      sheetId = s.sheetId === undefined ? "main" : str(s.sheetId, 100),
      cell = `${sheetId}:${x},${y}`;
    if (
      sheets
        ? !sheets.some((sheet) => sheet.id === sheetId)
        : sheetId !== "main"
    )
      fail();
    if (!Number.isInteger(x) || !Number.isInteger(y) || cells.has(cell)) fail();
    cells.add(cell);
    return {
      id: id(s.id),
      ...(s.sheetId === undefined ? {} : { sheetId }),
      x,
      y,
      title: str(s.title, 200),
      ...(s.footerLabel === undefined
        ? {}
        : { footerLabel: str(s.footerLabel, 80) }),
      ...(s.speakerNotes === undefined
        ? {}
        : { speakerNotes: str(s.speakerNotes, 10000) }),
      background: color(s.background),
      elements: s.elements.map((e: any): Element => {
        if (
          !e ||
          !["text", "image", "shape", "table", "line", "chart"].includes(e.type)
        )
          return fail();
        const base: Element = {
          id: id(e.id),
          type: e.type,
          x: num(e.x, 0, W),
          y: num(e.y, 0, H),
          w: num(e.w, 20, W),
          h: num(e.h, 20, H),
        };
        if (base.x + base.w > W + 0.1 || base.y + base.h > H + 0.1) fail();
        if (e.rotation !== undefined)
          base.rotation = [0, 90, 180, 270].includes(e.rotation)
            ? e.rotation
            : fail();
        for (const key of ["flipX", "flipY", "aspectLocked"] as const)
          if (e[key] !== undefined) base[key] = bool(e[key]);
        if (e.opacity !== undefined) base.opacity = num(e.opacity, 0, 1);
        if (e.groupId !== undefined) {
          base.groupId = str(e.groupId, 100);
          if (!base.groupId) fail();
        }
        if (e.link !== undefined) {
          if (
            !e.link ||
            typeof e.link !== "object" ||
            Object.keys(e.link).some((k) => k !== "slideId" && k !== "url")
          )
            fail();
          if ((e.link.slideId !== undefined) === (e.link.url !== undefined))
            fail();
          if (e.link.url !== undefined)
            base.link = { url: webLink(str(e.link.url, 2048)) };
          else {
            const slideId = str(e.link.slideId, 100);
            if (!slideId) fail();
            base.link = { slideId };
          }
        }
        if (e.type === "chart") return { ...base, chart: parseChart(e.chart) };

        if (e.type === "text")
          return {
            ...base,
            text: str(e.text),
            ...(e.writingMode === undefined
              ? {}
              : {
                  writingMode: ["horizontal-tb", "vertical-rl"].includes(
                    e.writingMode,
                  )
                    ? e.writingMode
                    : fail(),
                }),
            ...(e.richText === undefined
              ? {}
              : { richText: parseRichText(e.richText, str(e.text)) }),
            fontSize: num(e.fontSize, 12, 120),
            ...(e.bold === undefined ? {} : { bold: bool(e.bold) }),
            ...(e.bullets === undefined ? {} : { bullets: bool(e.bullets) }),
            ...(e.textAlign === undefined
              ? {}
              : {
                  textAlign: ["left", "center", "right"].includes(e.textAlign)
                    ? e.textAlign
                    : fail(),
                }),
            ...(e.verticalAlign === undefined
              ? {}
              : {
                  verticalAlign: ["top", "middle", "bottom"].includes(
                    e.verticalAlign,
                  )
                    ? e.verticalAlign
                    : fail(),
                }),
            color: color(e.color),
            highlight:
              e.highlight === undefined ? undefined : color(e.highlight),
          };
        if (e.type === "table")
          return {
            ...base,
            table: parseTable(e.table),
            fontSize: num(e.fontSize, 12, 72),
            color: color(e.color),
            fill: color(e.fill),
            stroke: color(e.stroke),
            textAlign:
              e.textAlign === undefined
                ? "left"
                : ["left", "center", "right"].includes(e.textAlign)
                  ? e.textAlign
                  : fail(),
          };
        if (e.type === "image") {
          const src = str(e.src, 12_000_000);
          if (
            !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(
              src,
            ) &&
            !/^\/api\/decks\/[a-f0-9-]{36}\/assets\/[a-f0-9-]{36}$/.test(src)
          )
            fail();
          return {
            ...base,
            src,
            ...(e.drawing === undefined
              ? {}
              : {
                  drawing: (() => {
                    if (!Array.isArray(e.drawing) || e.drawing.length > 1000)
                      fail();
                    let total = 0;
                    return e.drawing.map((s: any) => {
                      if (
                        !s ||
                        !Array.isArray(s.points) ||
                        !s.points.length ||
                        (total += s.points.length) > 50000
                      )
                        fail();
                      return {
                        points: s.points.map((p: any) => ({
                          x: num(p.x, 0, 960),
                          y: num(p.y, 0, 540),
                        })),
                        ...(s.fillContours === undefined
                          ? {}
                          : {
                              fillContours: (() => {
                                if (
                                  !Array.isArray(s.fillContours) ||
                                  !s.fillContours.length ||
                                  s.fillContours.length > 10000
                                )
                                  fail();
                                return s.fillContours.map((c: any) => {
                                  if (
                                    !Array.isArray(c) ||
                                    c.length < 3 ||
                                    (total += c.length) > 50000
                                  )
                                    fail();
                                  return c.map((p: any) => ({
                                    x: num(p.x, 0, 960),
                                    y: num(p.y, 0, 540),
                                  }));
                                });
                              })(),
                            }),
                        ...(s.erase === undefined
                          ? {}
                          : {
                              erase:
                                typeof s.erase === "boolean" &&
                                !(s.erase && s.fillContours)
                                  ? s.erase
                                  : fail(),
                            }),
                        ...(s.shape === undefined
                          ? {}
                          : {
                              shape:
                                ["line", "rectangle", "ellipse"].includes(
                                  s.shape,
                                ) &&
                                !s.erase &&
                                !s.fillContours
                                  ? s.shape
                                  : fail(),
                            }),
                        ...(s.fill === undefined
                          ? {}
                          : {
                              fill:
                                !s.erase && !s.fillContours
                                  ? s.fill === "none"
                                    ? "none"
                                    : color(s.fill)
                                  : fail(),
                            }),
                        ...(s.dash === undefined
                          ? {}
                          : {
                              dash:
                                ["solid", "dash", "dot"].includes(s.dash) &&
                                !s.erase &&
                                !s.fillContours
                                  ? s.dash
                                  : fail(),
                            }),
                        color: color(s.color),
                        width: num(s.width, 1, s.erase ? 100 : 30),
                      };
                    });
                  })(),
                  ...(e.drawingTool === undefined
                    ? {}
                    : {
                        drawingTool: [
                          "select",
                          "pen",
                          "fill",
                          "eraser",
                          "line",
                          "rectangle",
                          "ellipse",
                        ].includes(e.drawingTool)
                          ? e.drawingTool
                          : fail(),
                      }),
                  ...(e.eraserWidth === undefined
                    ? {}
                    : { eraserWidth: num(e.eraserWidth, 1, 100) }),
                  ...(e.inkShapeFill === undefined
                    ? {}
                    : {
                        inkShapeFill:
                          e.inkShapeFill === "none"
                            ? "none"
                            : color(e.inkShapeFill),
                      }),
                  ...(e.inkShapeDash === undefined
                    ? {}
                    : {
                        inkShapeDash: ["solid", "dash", "dot"].includes(
                          e.inkShapeDash,
                        )
                          ? e.inkShapeDash
                          : fail(),
                      }),
                  stroke: e.stroke === undefined ? "#173d38" : color(e.stroke),
                  strokeWidth:
                    e.strokeWidth === undefined ? 5 : num(e.strokeWidth, 1, 30),
                }),
            ...(e.crop === undefined ? {} : { crop: parseCrop(e.crop) }),
            ...(e.altText === undefined
              ? {}
              : { altText: str(e.altText, 500) }),
          };
        }
        const lineStyle: Partial<Element> = {
          ...(e.strokeWidth === undefined
            ? {}
            : { strokeWidth: num(e.strokeWidth, 0, 20) }),
          ...(e.strokeDash === undefined
            ? {}
            : {
                strokeDash: ["solid", "dash", "dot"].includes(e.strokeDash)
                  ? e.strokeDash
                  : fail(),
              }),
        };
        if (e.type === "line") {
          if (
            (e.rotation !== undefined && e.rotation !== 0) ||
            e.flipX === true ||
            e.flipY === true
          )
            fail();
          const points: Partial<Element> = {};
          for (const key of ["lineStart", "lineEnd"] as const)
            if (e[key] !== undefined)
              points[key] = {
                x: num(e[key]?.x, 0, 100),
                y: num(e[key]?.y, 0, 100),
              };
          return {
            ...base,
            ...lineStyle,
            ...points,
            ...(e.startAnchor === undefined
              ? {}
              : { startAnchor: parseAnchor(e.startAnchor) }),
            ...(e.endAnchor === undefined
              ? {}
              : { endAnchor: parseAnchor(e.endAnchor) }),
            stroke: color(e.stroke),
            ...(e.lineKind === undefined
              ? {}
              : {
                  lineKind: ["straight", "elbow", "curve"].includes(e.lineKind)
                    ? e.lineKind
                    : fail(),
                }),
            ...(e.startArrow === undefined
              ? {}
              : {
                  startArrow: ["none", "triangle", "circle"].includes(
                    e.startArrow,
                  )
                    ? e.startArrow
                    : fail(),
                }),
            ...(e.endArrow === undefined
              ? {}
              : {
                  endArrow: ["none", "triangle", "circle"].includes(e.endArrow)
                    ? e.endArrow
                    : fail(),
                }),
          };
        }
        if (!shapeIds.includes(e.shape)) fail();
        return {
          ...base,
          shape: e.shape,
          fill: e.fill === "none" ? "none" : color(e.fill),
          stroke: color(e.stroke),
          ...lineStyle,
          ...(e.text === undefined
            ? {}
            : {
                text: str(e.text),
                ...(e.richText === undefined
                  ? {}
                  : { richText: parseRichText(e.richText, str(e.text)) }),
                ...(e.bullets === undefined
                  ? {}
                  : { bullets: bool(e.bullets) }),
                ...(e.highlight === undefined
                  ? {}
                  : { highlight: color(e.highlight) }),
                fontSize: num(e.fontSize ?? 24, 12, 120),
                color: color(e.color ?? "#173d38"),
                ...(e.bold === undefined ? {} : { bold: bool(e.bold) }),
                textAlign:
                  e.textAlign === undefined
                    ? "center"
                    : ["left", "center", "right"].includes(e.textAlign)
                      ? e.textAlign
                      : fail(),
                verticalAlign:
                  e.verticalAlign === undefined
                    ? "middle"
                    : ["top", "middle", "bottom"].includes(e.verticalAlign)
                      ? e.verticalAlign
                      : fail(),
              }),
        };
      }),
    };
  });
  for (const slide of slides)
    for (const e of slide.elements)
      for (const key of ["startAnchor", "endAnchor"] as const) {
        const a = e[key];
        if (a) {
          const target = slide.elements.find((t) => t.id === a.elementId);
          if (target?.type === "line" || a.elementId === e.id) fail();
        }
      }
  for (const sheet of sheets ?? [{ id: "main" }])
    if (!cells.has(`${sheet.id}:0,0`)) fail();
  const result: Deck = { version: 1, title: str(d.title, 200), slides };
  if (d.guestPageCreation !== undefined)
    result.guestPageCreation = ["none", "append", "insert"].includes(
      d.guestPageCreation,
    )
      ? d.guestPageCreation
      : fail();
  if (d.restrictGuests !== undefined)
    result.restrictGuests = bool(d.restrictGuests);
  if (d.routes !== undefined) {
    if (!Array.isArray(d.routes) || d.routes.length > 30) fail();
    const ids = new Set<string>();
    result.routes = d.routes.map((r: any) => {
      const id = str(r?.id, 100),
        name = str(r?.name, 80);
      if (
        !id ||
        !name.trim() ||
        ids.has(id) ||
        !Array.isArray(r.slides) ||
        r.slides.length > 1000
      )
        fail();
      ids.add(id);
      return { id, name, slides: r.slides.map((id: unknown) => str(id, 100)) };
    });
  }
  if (sheets) result.sheets = sheets;
  if (d.activeSheetId !== undefined) {
    const active = str(d.activeSheetId, 100);
    if ((sheets ?? [{ id: "main" }]).some((sheet) => sheet.id === active))
      result.activeSheetId = active;
  }
  if (d.linkedRows !== undefined) result.linkedRows = bool(d.linkedRows);
  if (d.rowSelections !== undefined) {
    if (
      !Array.isArray(d.rowSelections) ||
      d.rowSelections.length > MAX_SLIDES ||
      !d.rowSelections.every(
        (id: unknown) => typeof id === "string" && id.length <= 100,
      )
    )
      fail();
    // Stale IDs can result from deletion or swapping. Recover the valid choices.
    const seenRows = new Set<string>();
    result.rowSelections = d.rowSelections.filter((id: string) => {
      const page = slides.find((s) => s.id === id);
      if (!page || seenRows.has(`${page.sheetId ?? "main"}:${page.y}`))
        return false;
      seenRows.add(`${page.sheetId ?? "main"}:${page.y}`);
      return true;
    });
  }
  return result;
}
export function neighbor(
  deck: Deck,
  current: Slide,
  dx: number,
  dy: number,
): Slide | undefined {
  if (dx) {
    const xs = [...new Set(deck.slides.map((s) => s.x))]
      .filter((x) => (dx > 0 ? x > current.x : x < current.x))
      .sort((a, b) => (dx > 0 ? a - b : b - a));
    const x = xs[0];
    return (
      deck.slides.find((s) => s.x === x && s.y === current.y) ??
      deck.slides.filter((s) => s.x === x).sort((a, b) => a.y - b.y)[0]
    );
  }
  return deck.slides
    .filter(
      (s) => s.x === current.x && (dy > 0 ? s.y > current.y : s.y < current.y),
    )
    .sort((a, b) => (dy > 0 ? a.y - b.y : b.y - a.y))[0];
}

export function serializeDeck(deck: Deck): string {
  const encoded = JSON.stringify(deck);
  if (new Blob([encoded]).size > MAX_FILE_BYTES)
    throw new Error("作品は25MBまでです。画像やページを減らしてください。");
  return encoded;
}
