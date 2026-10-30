import { axisId } from "./axes.ts";
import type { AxisGrant } from "./axes.ts";
import type { Deck, Slide } from "./model.ts";
export type EditAccess = {
  mode: "none" | "all" | "scoped";
  comment: boolean;
  rows: AxisGrant[];
  columns: AxisGrant[];
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
          s.index > 99 ||
          (s.axisId !== undefined &&
            (typeof s.axisId !== "string" ||
              !s.axisId ||
              s.axisId.length > 80)),
      )
    )
      throw new Error("行・列の設定が正しくありません。");
    return items.map((s) => ({
      sheetId: s.sheetId as string,
      index: s.index as number,
      ...(s.axisId === undefined ? {} : { axisId: s.axisId as string }),
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
export function canEdit(access: EditAccess, slide: Slide, deck?: Deck) {
  const sheetId = slide.sheetId ?? "main";
  return (
    access.mode === "all" ||
    (access.mode === "scoped" &&
      (access.slides.includes(slide.id) ||
        access.rows.some(
          (r) =>
            r.sheetId === sheetId &&
            (r.axisId ?? String(r.index)) ===
              axisId(deck, sheetId, "rows", slide.y),
        ) ||
        access.columns.some(
          (c) =>
            c.sheetId === sheetId &&
            (c.axisId ?? String(c.index)) ===
              axisId(deck, sheetId, "columns", slide.x),
        )))
  );
}
export class AccessError extends Error {
  constructor(
    message = "この操作はホストから許可された編集範囲を超えています。",
  ) {
    super(message);
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
    before.guestPageCreation !== after.guestPageCreation ||
    !!before.restrictGuests !== !!after.restrictGuests ||
    JSON.stringify(before.routes ?? []) !==
      JSON.stringify(after.routes ?? []) ||
    JSON.stringify(before.sheets) !== JSON.stringify(after.sheets)
  )
    throw new AccessError();
  const old = new Map(before.slides.map((s) => [s.id, s]));
  const next = new Map(after.slides.map((s) => [s.id, s]));
  if (before.restrictGuests) {
    const added = after.slides.filter((s) => !old.has(s.id)),
      policy = before.guestPageCreation ?? "append";
    if (added.length && policy === "none")
      throw new AccessError("ホストがページの追加を許可していません。");
    if (added.length && policy === "append") {
      if (
        before.slides.some((a) => {
          const b = next.get(a.id);
          return b && (a.x !== b.x || a.y !== b.y || a.sheetId !== b.sheetId);
        })
      )
        throw new AccessError();
      for (const page of added) {
        const sheet = page.sheetId ?? "main",
          pages = before.slides.filter((s) => (s.sheetId ?? "main") === sheet),
          row = pages.filter((s) => s.y === page.y);
        if (row.length) {
          if (page.x <= Math.max(...row.map((s) => s.x)))
            throw new AccessError();
        } else {
          const rowGranted =
            access.mode === "all" ||
            access.rows.some(
              (r) =>
                r.sheetId === sheet &&
                (r.axisId ?? String(r.index)) ===
                  axisId(before, sheet, "rows", page.y),
            );
          const column = pages.filter((s) => s.x === page.x);
          if (
            !(rowGranted && page.x === 0) &&
            (!column.length || page.y <= Math.max(...column.map((s) => s.y)))
          )
            throw new AccessError();
        }
      }
    }
  }
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id),
      b = next.get(id);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if ((a && !canEdit(access, a, before)) || (b && !canEdit(access, b, after)))
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
  color?: string;
  w?: number;
  h?: number;
};
export function parseComment(value: unknown): {
  slide: string;
  text: string;
  x: number;
  y: number;
  color?: string;
  w?: number;
  h?: number;
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
  if (
    (v.color !== undefined && !/^#[0-9a-f]{6}$/i.test(v.color)) ||
    (v.w !== undefined && (!Number.isFinite(v.w) || v.w < 0.12 || v.w > 0.8)) ||
    (v.h !== undefined && (!Number.isFinite(v.h) || v.h < 0.16 || v.h > 0.8))
  )
    throw new Error("付箋の色・サイズが正しくありません。");
  return {
    slide: v.slide,
    text: v.text.trim(),
    x: v.x,
    y: v.y,
    ...(v.color === undefined ? {} : { color: v.color }),
    ...(v.w === undefined ? {} : { w: v.w }),
    ...(v.h === undefined ? {} : { h: v.h }),
  };
}
