import type { Deck, PresentationRoute, Slide } from "./model";
import type { EditAccess } from "./permissions";
import { canEdit } from "./permissions";
export function assignedSlides(book: Deck, access: EditAccess): Slide[] {
  return book.slides
    .filter((s) => canEdit(access, s, book))
    .sort(
      (a, b) =>
        (a.sheetId ?? "main").localeCompare(b.sheetId ?? "main") ||
        a.y - b.y ||
        a.x - b.x,
    );
}
export function routeSlides(book: Deck, route: PresentationRoute): Slide[] {
  const pages = new Map(book.slides.map((s) => [s.id, s]));
  return [...new Set(route.slides)].flatMap((id) =>
    pages.has(id) ? [pages.get(id)!] : [],
  );
}
export function slideLabel(book: Deck, s: Slide) {
  const sheet =
    book.sheets?.find((t) => t.id === (s.sheetId ?? "main"))?.name ?? "シート1";
  const number = `${s.y + 1}.${s.x + 1}`;
  const raw = s.footerLabel || s.title;
  const title = raw.startsWith(number + " ")
    ? raw.slice(number.length).trimStart()
    : raw;
  return `${sheet} · ${number} ${title}`;
}
