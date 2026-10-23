import type { Deck, Sheet } from "./model";
import { blank, MAX_SLIDES, uid } from "./model";
export const sheetList = (book: Deck): Sheet[] =>
  book.sheets ?? [{ id: "main", name: "シート1" }];
export const activeSheet = (book: Deck) =>
  sheetList(book).find((s) => s.id === book.activeSheetId) ??
  sheetList(book)[0];
export function sheetDeck(book: Deck): Deck {
  const id = activeSheet(book).id;
  return {
    ...book,
    activeSheetId: id,
    slides: book.slides.filter((s) => (s.sheetId ?? "main") === id),
    rowSelections: book.rowSelections?.filter((id) =>
      book.slides.some(
        (s) => s.id === id && (s.sheetId ?? "main") === activeSheet(book).id,
      ),
    ),
  };
}
export function mergeSheet(book: Deck, next: Deck): Deck {
  const id = next.activeSheetId ?? activeSheet(book).id;
  if (!sheetList(book).some((s) => s.id === id))
    throw new Error("編集していたシートは削除されました。");
  const others = book.slides.filter((s) => (s.sheetId ?? "main") !== id);
  const slides = next.slides.map((s) =>
    id === "main" && s.sheetId === undefined ? s : { ...s, sheetId: id },
  );
  return {
    ...book,
    title: next.title,
    linkedRows: next.linkedRows,
    slides: [...others, ...slides],
    ...(book.rowSelections === undefined && next.rowSelections === undefined
      ? {}
      : {
          rowSelections: [
            ...(book.rowSelections ?? []).filter((page) =>
              others.some((s) => s.id === page),
            ),
            ...(next.rowSelections ?? []),
          ],
        }),
  };
}
export function changeSheet(
  book: Deck,
  action:
    | "add"
    | "duplicate"
    | "delete"
    | "rename"
    | "left"
    | "right"
    | "before"
    | "after",
  id = activeSheet(book).id,
  name?: string,
): Deck {
  const sheets = [...sheetList(book)],
    index = sheets.findIndex((s) => s.id === id);
  if (index < 0) throw new Error("シートが見つかりません。");
  if (action === "add" || action === "duplicate") {
    if (sheets.length >= 50) throw new Error("シートは50枚までです。");
    const newId = uid(),
      source = book.slides.filter((s) => (s.sheetId ?? "main") === id);
    const copies =
      action === "add"
        ? [{ ...blank(0, 0), sheetId: newId }]
        : source.map((s) => ({
            ...s,
            id: uid(),
            sheetId: newId,
            elements: s.elements.map((e) => ({ ...e, id: uid() })),
          }));
    if (copies.length + book.slides.length > MAX_SLIDES)
      throw new Error(`作品全体で${MAX_SLIDES}ページまでです。`);
    const baseName =
      action === "add"
        ? `シート${sheets.length + 1}`
        : `${sheets[index].name.slice(0, 70)} のコピー`;
    let newName = baseName,
      suffix = 2;
    while (sheets.some((s) => s.name === newName))
      newName = `${baseName} (${suffix++})`;
    sheets.splice(index + 1, 0, {
      ...(action === "duplicate" ? sheets[index] : {}),
      id: newId,
      name: newName,
    });
    return {
      ...book,
      sheets,
      activeSheetId: newId,
      slides: [...book.slides, ...copies],
    };
  }
  if (action === "delete") {
    if (sheets.length === 1) throw new Error("最後のシートは削除できません。");
    sheets.splice(index, 1);
    const slides = book.slides.filter((s) => (s.sheetId ?? "main") !== id);
    return {
      ...book,
      sheets,
      slides,
      activeSheetId:
        id === activeSheet(book).id
          ? sheets[Math.min(index, sheets.length - 1)].id
          : book.activeSheetId,
      rowSelections: book.rowSelections?.filter((page) =>
        slides.some((s) => s.id === page),
      ),
    };
  }
  if (action === "rename") {
    if (!name?.trim() || name.length > 80)
      throw new Error("シート名は1〜80文字で入力してください。");
    if (sheets.some((s) => s.id !== id && s.name === name.trim()))
      throw new Error("同じ名前のシートがあります。");
    sheets[index] = { ...sheets[index], name: name.trim() };
  } else if (action === "before" || action === "after") {
    if (id === name) return book;
    const target = sheets.find((sheet) => sheet.id === name);
    if (!target) throw new Error("移動先のシートが見つかりません。");
    const [moving] = sheets.splice(index, 1);
    sheets.splice(
      sheets.indexOf(target) + (action === "after" ? 1 : 0),
      0,
      moving,
    );
    if (sheets.every((sheet, i) => sheet.id === sheetList(book)[i].id))
      return book;
  } else {
    const to = index + (action === "left" ? -1 : 1);
    if (to < 0 || to >= sheets.length) return book;
    [sheets[index], sheets[to]] = [sheets[to], sheets[index]];
  }
  return { ...book, sheets };
}
