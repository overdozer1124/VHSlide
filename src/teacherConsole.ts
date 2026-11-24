import type { Deck, Slide } from "./model";
import type { PublicFollowState } from "./hostFollow";
import type { WorksheetValues } from "./worksheets";

/** Slides of one sheet in reading order: across a row first, then down. */
export function consoleSlides(deck: Deck, sheetId: string): Slide[] {
  return deck.slides
    .filter((s) => (s.sheetId ?? "main") === sheetId)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Group slides into map rows (same y). Rows run top to bottom; slides
 * within a row run left to right. */
export function consoleRows(
  slides: Slide[],
): { y: number; slides: Slide[] }[] {
  const byRow = new Map<number, Slide[]>();
  for (const s of slides) {
    const list = byRow.get(s.y) ?? [];
    list.push(s);
    byRow.set(s.y, list);
  }
  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([y, list]) => ({
      y,
      slides: [...list].sort((a, b) => a.x - b.x),
    }));
}

export function consoleSheets(deck: Deck): { id: string; name: string }[] {
  return deck.sheets ?? [{ id: "main", name: "メイン" }];
}

/** The sheet the console opens on: the followed sheet when follow is
 * live; otherwise the sheet of the slide the editor had open, so the
 * console starts where the teacher was working. */
export function consoleDefaultSheet(
  deck: Deck,
  follow: PublicFollowState,
  editorSlideId?: string,
): string {
  if (follow.active) return follow.target.sheetId;
  const editing = editorSlideId
    ? deck.slides.find((s) => s.id === editorSlideId)
    : undefined;
  if (editing) return editing.sheetId ?? "main";
  return deck.activeSheetId ?? consoleSheets(deck)[0].id;
}

/**
 * The slide the console focuses first: the projected page when follow is
 * live, otherwise the slide the editor had open, otherwise the first
 * page of the opening sheet.
 */
export function consoleInitialSlide(
  deck: Deck,
  follow: PublicFollowState,
  editorSlideId?: string,
): string | undefined {
  const sheetId = consoleDefaultSheet(deck, follow, editorSlideId);
  const slides = consoleSlides(deck, sheetId);
  if (!slides.length) return undefined;
  if (follow.active && follow.target.mode === "page" && follow.target.pageId) {
    const projected = slides.find((s) => s.id === follow.target.pageId);
    if (projected) return projected.id;
  }
  if (!follow.active && editorSlideId) {
    const editing = slides.find((s) => s.id === editorSlideId);
    if (editing) return editing.id;
  }
  return slides[0].id;
}

/** The next slide with student content in reading order, for the
 * student-slides arrow keys: steps over slides without answers and
 * stops at the ends (no wrap). */
export function consoleAdjacentRelevant(
  slides: Slide[],
  relevant: (slide: Slide) => boolean,
  currentId: string | undefined,
  direction: 1 | -1,
): Slide | undefined {
  const start = slides.findIndex((s) => s.id === currentId);
  if (start < 0) return slides.find(relevant);
  for (let i = start + direction; i >= 0 && i < slides.length; i += direction)
    if (relevant(slides[i])) return slides[i];
  return undefined;
}

/** Whether one worksheet field has a real answer in a response. */
export function fieldAnswered(
  values: WorksheetValues | undefined,
  fieldId: string,
): boolean {
  const value = values?.[fieldId];
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some((v) => v !== null);
  return false;
}
