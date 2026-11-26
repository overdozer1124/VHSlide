import type { Deck, Sheet, Slide } from "./model.ts";
import { sheetList } from "./workbook.ts";

/** "Hide from students" state: a slide is hidden when its own flag is
 * set or when its whole row is hidden. Hosts always see everything;
 * these helpers drive the student-facing views only. */

export function sheetOf(book: Deck, slide: Slide): Sheet | undefined {
  return sheetList(book).find((s) => s.id === (slide.sheetId ?? "main"));
}

export function isRowHidden(book: Deck, sheetId: string, y: number): boolean {
  return (
    sheetList(book).find((s) => s.id === sheetId)?.hiddenRows?.[String(y)] ===
    true
  );
}

export function isSlideHidden(book: Deck, slide: Slide): boolean {
  if (slide.hidden) return true;
  return isRowHidden(book, slide.sheetId ?? "main", slide.y);
}

/** The deck as a student may see it: hidden slides removed, hidden
 * rows removed and the rows below them shifted up (labels follow).
 * Slide ids and x positions are untouched, so selections and follow
 * targets keep referring to the same pages. */
export function studentDeck(book: Deck): Deck {
  const sheets = sheetList(book);
  // Per sheet: old y -> new y for the rows that stay visible.
  const rowMaps = new Map<string, Map<number, number>>();
  for (const sheet of sheets) {
    const used = new Set(
      book.slides
        .filter((s) => (s.sheetId ?? "main") === sheet.id)
        .map((s) => s.y),
    );
    // A row with no slides still occupies its place when it carries a
    // label, so compression must consider labelled rows too.
    for (const key of Object.keys(sheet.rowLabels ?? {}))
      if (/^\d+$/.test(key)) used.add(Number(key));
    const visible = [...used]
      .filter((y) => !sheet.hiddenRows?.[String(y)])
      .sort((a, b) => a - b);
    rowMaps.set(sheet.id, new Map(visible.map((y, i) => [y, i])));
  }
  const remapLabels = (
    sheet: Sheet,
    labels: Record<string, string> | undefined,
  ): Record<string, string> | undefined => {
    if (!labels) return undefined;
    const map = rowMaps.get(sheet.id)!;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(labels)) {
      const to = map.get(Number(key));
      if (to !== undefined) out[String(to)] = value;
    }
    return out;
  };
  const slides = book.slides
    .filter((s) => !isSlideHidden(book, s))
    .map((s) => {
      const to = rowMaps.get(s.sheetId ?? "main")?.get(s.y);
      return to === undefined || to === s.y ? s : { ...s, y: to };
    });
  return {
    ...book,
    slides,
    sheets: sheets.map((sheet) => {
      const { hiddenRows: _hiddenRows, ...rest } = sheet;
      const rowLabels = remapLabels(sheet, sheet.rowLabels);
      return {
        ...rest,
        ...(rowLabels === undefined ? {} : { rowLabels }),
      };
    }),
    rowSelections: book.rowSelections?.filter((id) =>
      slides.some((s) => s.id === id),
    ),
  };
}

/** The visible slide a student should land on instead of `slide`:
 * the nearest visible one before it in reading order (same sheet,
 * then row by row), else the nearest visible one after it. */
export function nearestVisibleSlide(
  book: Deck,
  slide: Slide,
): Slide | undefined {
  const sheetId = slide.sheetId ?? "main";
  const ordered = book.slides
    .filter((s) => (s.sheetId ?? "main") === sheetId)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const at = ordered.findIndex((s) => s.id === slide.id);
  if (at < 0) return undefined;
  for (let i = at - 1; i >= 0; i--)
    if (!isSlideHidden(book, ordered[i])) return ordered[i];
  for (let i = at + 1; i < ordered.length; i++)
    if (!isSlideHidden(book, ordered[i])) return ordered[i];
  return undefined;
}
