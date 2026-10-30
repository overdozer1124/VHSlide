import { blank, MAX_SLIDES } from "./model.ts";
import type { Deck } from "./model.ts";
import type { EditAccess } from "./permissions.ts";
import { assertDeckAccess } from "./permissions.ts";
/** Insert within a single assigned row; global axes and other rows stay intact. */
export function addGuestPage(
  book: Deck,
  access: EditAccess,
  sheetId: string,
  x: number,
  y: number,
  id?: string,
): Deck {
  const policy = book.guestPageCreation ?? "append";
  if (policy === "none")
    throw new Error("ホストがページの追加を許可していません。");
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x > 99 ||
    y > 99
  )
    throw new Error("縦・横は100マスまでです。");
  if (book.slides.length >= MAX_SLIDES)
    throw new Error(`ページは${MAX_SLIDES}枚までです。`);
  const row = book.slides.filter(
    (s) => (s.sheetId ?? "main") === sheetId && s.y === y,
  );
  const last = Math.max(-1, ...row.map((s) => s.x));
  if (policy === "append" && x <= last)
    throw new Error("ホストの設定により、担当行の末尾にのみ追加できます。");
  const shifted = policy === "insert" ? row.filter((s) => s.x >= x) : [];
  if (shifted.some((s) => s.x >= 99))
    throw new Error("縦・横は100マスまでです。");
  const ids = new Set(shifted.map((s) => s.id));
  const page = { ...blank(x, y), sheetId, ...(id ? { id } : {}) };
  const next = {
    ...book,
    slides: [
      ...book.slides.map((s) => (ids.has(s.id) ? { ...s, x: s.x + 1 } : s)),
      page,
    ],
  };
  assertDeckAccess(book, next, access, false);
  return next;
}
