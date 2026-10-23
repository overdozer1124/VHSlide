import type { Deck, Slide } from "./model.ts";
export type EditAccess = {
  mode: "none" | "all" | "scoped";
  comment: boolean;
  rows: { sheetId: string; index: number }[];
  columns: { sheetId: string; index: number }[];
  slides: string[];
};
export const defaultAccess = (): EditAccess => ({
  mode: "none",
  comment: true,
  rows: [],
  columns: [],
  slides: [],
});
export const hostAccess = (): EditAccess => ({
  ...defaultAccess(),
  mode: "all",
});
export function parseAccess(value: unknown): EditAccess {
  const v = value as EditAccess;
  if (
    !v ||
    !["none", "all", "scoped"].includes(v.mode) ||
    typeof v.comment !== "boolean"
  )
    throw new Error("権限の設定が正しくありません。");
  const axes = (items: unknown) => {
    if (
      !Array.isArray(items) ||
      items.length > 5000 ||
      items.some(
        (s) =>
          !s ||
          typeof s.sheetId !== "string" ||
          !s.sheetId ||
          s.sheetId.length > 100 ||
          !Number.isInteger(s.index) ||
          s.index < 0 ||
          s.index > 99,
      )
    )
      throw new Error("行・列の設定が正しくありません。");
    return items.map((s) => ({
      sheetId: s.sheetId as string,
      index: s.index as number,
    }));
  };
  if (
    !Array.isArray(v.slides) ||
    v.slides.length > 1000 ||
    v.slides.some((id) => typeof id !== "string" || !id || id.length > 100)
  )
    throw new Error("スライドの設定が正しくありません。");
  return {
    mode: v.mode,
    comment: v.comment,
    rows: axes(v.rows),
    columns: axes(v.columns),
    slides: [...new Set(v.slides)],
  };
}
export function canEdit(access: EditAccess, slide: Slide) {
  const sheetId = slide.sheetId ?? "main";
  return (
    access.mode === "all" ||
    (access.mode === "scoped" &&
      (access.slides.includes(slide.id) ||
        access.rows.some((r) => r.sheetId === sheetId && r.index === slide.y) ||
        access.columns.some(
          (c) => c.sheetId === sheetId && c.index === slide.x,
        )))
  );
}
export class AccessError extends Error {
  constructor() {
    super("この操作はホストから許可された編集範囲を超えています。");
  }
}
export function assertDeckAccess(
  before: Deck,
  after: Deck,
  access: EditAccess,
  host: boolean,
) {
  if (host) return;
  if (
    before.title !== after.title ||
    JSON.stringify(before.sheets) !== JSON.stringify(after.sheets)
  )
    throw new AccessError();
  const old = new Map(before.slides.map((s) => [s.id, s]));
  const next = new Map(after.slides.map((s) => [s.id, s]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id),
      b = next.get(id);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if ((a && !canEdit(access, a)) || (b && !canEdit(access, b)))
      throw new AccessError();
  }
}
export type SlideComment = {
  id: string;
  slide: string;
  author: string;
  name: string;
  text: string;
  x: number;
  y: number;
  created: number;
};
export function parseComment(value: unknown): {
  slide: string;
  text: string;
  x: number;
  y: number;
} {
  const v = value as SlideComment;
  if (
    !v ||
    typeof v.slide !== "string" ||
    !v.slide ||
    v.slide.length > 100 ||
    typeof v.text !== "string" ||
    !v.text.trim() ||
    v.text.length > 1000 ||
    !Number.isFinite(v.x) ||
    !Number.isFinite(v.y) ||
    v.x < 0 ||
    v.x > 1 ||
    v.y < 0 ||
    v.y > 1
  )
    throw new Error("付箋は1000文字以内で入力してください。");
  return { slide: v.slide, text: v.text.trim(), x: v.x, y: v.y };
}
