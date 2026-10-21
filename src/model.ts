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
  if (deck.slides.length >= 100) throw new Error("ページは100枚までです。");
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
      if (s.x === from.x && s.y === from.y) return { ...s, ...to };
      if (s.x === to.x && s.y === to.y) return { ...s, ...from };
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
    d.slides.length > 100
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
            )
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
  return { version: 1, title: str(d.title, 200), slides };
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
