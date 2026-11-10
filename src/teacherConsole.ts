import type { Deck, Slide } from "./model";
import type { PublicFollowState } from "./hostFollow";
import type { WorksheetValues } from "./worksheets";

/** Slides of one sheet in reading order: across a row first, then down. */
export function consoleSlides(deck: Deck, sheetId: string): Slide[] {
  return deck.slides
    .filter((s) => (s.sheetId ?? "main") === sheetId)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function consoleSheets(deck: Deck): { id: string; name: string }[] {
  return deck.sheets ?? [{ id: "main", name: "メイン" }];
}

/** The sheet the console opens on: the followed sheet when follow is live. */
export function consoleDefaultSheet(deck: Deck, follow: PublicFollowState): string {
  if (follow.active) return follow.target.sheetId;
  return deck.activeSheetId ?? consoleSheets(deck)[0].id;
}

/**
 * The slide the console focuses first: the projected page when follow is
 * live, otherwise the first page of the opening sheet.
 */
export function consoleInitialSlide(
  deck: Deck,
  follow: PublicFollowState,
): string | undefined {
  const sheetId = consoleDefaultSheet(deck, follow);
  const slides = consoleSlides(deck, sheetId);
  if (!slides.length) return undefined;
  if (follow.active && follow.target.mode === "page" && follow.target.pageId) {
    const projected = slides.find((s) => s.id === follow.target.pageId);
    if (projected) return projected.id;
  }
  return slides[0].id;
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
