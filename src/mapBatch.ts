import { blank, bounds, MAX_SLIDES, type Deck } from "./model.ts";
import { remapAxis } from "./axes.ts";
export type BatchAxis = "rows" | "columns";
/** Work on a sheetDeck; merge and validate workbook limits before committing. */
export function batchAxes(
  deck: Deck,
  axis: BatchAxis,
  action: "add" | "delete",
  start: number,
  count: number,
): Deck {
  const size = bounds(deck),
    length = axis === "rows" ? size.rows : size.cols,
    field = axis === "rows" ? "y" : "x";
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100 ||
    start < 0 ||
    start > (action === "add" ? length : length - 1)
  )
    throw new Error("開始位置と数を確認してください。");
  if (action === "add" && length + count > 100)
    throw new Error("縦・横は100マスまでです。");
  if (action === "delete" && start + count > length)
    throw new Error("削除範囲が現在の行・列を超えています。");
  if (action === "add") {
    const cross = axis === "rows" ? size.cols : size.rows;
    if (deck.slides.length + count * cross > MAX_SLIDES)
      throw new Error(`作品全体で${MAX_SLIDES}ページまでです。`);
    const inserted = Array.from({ length: count * cross }, (_, i) =>
      blank(
        axis === "rows" ? i % cross : start + Math.floor(i / cross),
        axis === "rows" ? start + Math.floor(i / cross) : i % cross,
      ),
    );
    return {
      ...remapAxis(deck, axis, (i) => (i >= start ? i + count : i)),
      slides: [
        ...deck.slides.map((s) =>
          s[field] >= start ? { ...s, [field]: s[field] + count } : s,
        ),
        ...inserted,
      ],
    };
  }
  const slides = deck.slides
    .filter((s) => s[field] < start || s[field] >= start + count)
    .map((s) =>
      s[field] >= start + count ? { ...s, [field]: s[field] - count } : s,
    );
  if (!slides.some((s) => s.x === 0 && s.y === 0)) slides.unshift(blank(0, 0));
  return {
    ...remapAxis(deck, axis, (i) =>
      i < start ? i : i < start + count ? undefined : i - count,
    ),
    slides,
    rowSelections: deck.rowSelections?.filter((id) =>
      slides.some((s) => s.id === id),
    ),
  };
}
/** Delete exactly these pages. Never reposition an unselected page to fill the origin. */
export function removeSelectedPages(deck: Deck, ids: string[]): Deck {
  const selected = new Set(ids),
    slides = deck.slides.filter((s) => !selected.has(s.id));
  if (slides.length === deck.slides.length) return deck;
  if (!slides.some((s) => s.x === 0 && s.y === 0)) slides.unshift(blank(0, 0));
  return {
    ...deck,
    slides,
    rowSelections: deck.rowSelections?.filter((id) => !selected.has(id)),
  };
}
