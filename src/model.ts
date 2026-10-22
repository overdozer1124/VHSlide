export const MAX_SLIDES = 1000;
export const MAX_FILE_BYTES = 25_000_000;
export const W = 960,
  H = 540;
export interface GridMove {
  mode: "slide" | "row" | "column";
  x: number;
  y: number;
}
export type Shape = "rect" | "rounded" | "circle" | "arrow" | "bubble";
export interface Element {
  id: string;
  type: "text" | "image" | "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fontSize?: number;
  bold?: boolean;
  color?: string;
  highlight?: string;
  bullets?: boolean;
  src?: string;
  shape?: Shape;
  fill?: string;
  stroke?: string;
}
export interface Slide {
  id: string;
  x: number;
  y: number;
  title: string;
  background: string;
  elements: Element[];
}
export interface Deck {
  version: 1;
  title: string;
  slides: Slide[];
  /** One remembered slide ID per row; coordinates may change during reordering. */
  rowSelections?: string[];
  /** Show the same topic in every editor row; independent choices are retained. */
  linkedRows?: boolean;
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
  return { ...deck, slides: [...slides, blank(x, y)] };
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
    ...deck,
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
    ...deck,
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
  const seenRows = new Set<number>();
  const rowSelections = (deck.rowSelections ?? []).filter((remembered) => {
    const page = deck.slides.find((s) => s.id === remembered);
    if (!page || page.y === chosen.y || seenRows.has(page.y)) return false;
    seenRows.add(page.y);
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
    ...deck,
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
  return {
    ...source,
    id: uid(),
    x,
    y,
    title: `${source.title.slice(0, 195)} のコピー`,
    elements: source.elements.map((element) => ({ ...element, id: uid() })),
  };
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
export function duplicateRowGroup(deck: Deck, y: number): Deck {
  const source = deck.slides.filter((s) => s.y === y);
  if (!source.length) throw new Error("複製する段にページがありません。");
  if (deck.slides.length + source.length > MAX_SLIDES)
    throw new Error(`ページは${MAX_SLIDES}枚までです。`);
  if (bounds(deck).rows >= 100) throw new Error("縦・横は100マスまでです。");
  const copies = source.map((s) => copySlide(s, s.x, y + 1));
  const chosen = rowPage(deck, y);
  const chosenCopy = copies.find((s) => s.x === chosen?.x);
  const next = {
    ...deck,
    slides: [
      ...deck.slides.map((s) => (s.y > y ? { ...s, y: s.y + 1 } : s)),
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
    ...deck,
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
      cell = `${x},${y}`;
    if (!Number.isInteger(x) || !Number.isInteger(y) || cells.has(cell)) fail();
    cells.add(cell);
    return {
      id: id(s.id),
      x,
      y,
      title: str(s.title, 200),
      background: color(s.background),
      elements: s.elements.map((e: any): Element => {
        if (!e || !["text", "image", "shape"].includes(e.type)) return fail();
        const base: Element = {
          id: id(e.id),
          type: e.type,
          x: num(e.x, 0, W),
          y: num(e.y, 0, H),
          w: num(e.w, 20, W),
          h: num(e.h, 20, H),
        };
        if (base.x + base.w > W + 0.1 || base.y + base.h > H + 0.1) fail();
        if (e.type === "text")
          return {
            ...base,
            text: str(e.text),
            fontSize: num(e.fontSize, 12, 120),
            ...(e.bold === undefined ? {} : { bold: bool(e.bold) }),
            ...(e.bullets === undefined ? {} : { bullets: bool(e.bullets) }),
            color: color(e.color),
            highlight:
              e.highlight === undefined ? undefined : color(e.highlight),
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
          return { ...base, src };
        }
        if (!["rect", "rounded", "circle", "arrow", "bubble"].includes(e.shape))
          fail();
        return {
          ...base,
          shape: e.shape,
          fill: color(e.fill),
          stroke: color(e.stroke),
        };
      }),
    };
  });
  if (!cells.has("0,0")) fail();
  const result: Deck = { version: 1, title: str(d.title, 200), slides };
  if (d.linkedRows !== undefined) result.linkedRows = bool(d.linkedRows);
  if (d.rowSelections !== undefined) {
    if (
      !Array.isArray(d.rowSelections) ||
      d.rowSelections.length > 100 ||
      !d.rowSelections.every(
        (id: unknown) => typeof id === "string" && id.length <= 100,
      )
    )
      fail();
    // Stale IDs can result from deletion or swapping. Recover the valid choices.
    const seenRows = new Set<number>();
    result.rowSelections = d.rowSelections.filter((id: string) => {
      const page = slides.find((s) => s.id === id);
      if (!page || seenRows.has(page.y)) return false;
      seenRows.add(page.y);
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
