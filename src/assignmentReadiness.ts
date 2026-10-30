import type { Deck } from "./model.ts";
import type { EditAccess } from "./permissions.ts";
import { canEdit } from "./permissions.ts";
import { axisIndex } from "./axes.ts";
import { sheetList } from "./workbook.ts";
export type AssignmentReadiness = {
  kind: "view" | "ready" | "waiting" | "deleted" | "unassigned";
  pageIds: string[];
  pending: string[];
  missing: string[];
  otherSheets: { id: string; name: string; count: number }[];
  summary: string;
};
/** Derive readiness from existing grants and pages; never creates rows or changes permissions. */
export function assignmentReadiness(
  book: Deck,
  access: EditAccess,
  sheetId?: string,
): AssignmentReadiness {
  const sheets = sheetList(book),
    pages = book.slides.filter((s) => canEdit(access, s, book));
  const here = sheetId
    ? pages.filter((s) => (s.sheetId ?? "main") === sheetId)
    : pages;
  const pending: string[] = [],
    missing: string[] = [];
  if (access.mode === "scoped") {
    for (const [axis, grants, name] of [
      ["rows", access.rows, "行"],
      ["columns", access.columns, "列"],
    ] as const) {
      for (const g of grants) {
        if (sheetId && g.sheetId !== sheetId) continue;
        const sheet = sheets.find((s) => s.id === g.sheetId),
          index = axisIndex(book, axis, g);
        if (index === undefined || !sheet) {
          missing.push(`削除された${name}・シート`);
          continue;
        }
        const label = `${sheet.name}・${index + 1}${name}目`;
        if (
          !book.slides.some(
            (s) =>
              (s.sheetId ?? "main") === g.sheetId &&
              (axis === "rows" ? s.y : s.x) === index,
          )
        )
          pending.push(label);
      }
    }
    for (const id of access.slides) {
      const s = book.slides.find((s) => s.id === id);
      if (!s) missing.push("削除されたページ");
    }
  }
  const kind =
    access.mode === "none"
      ? "view"
      : here.length
        ? "ready"
        : pending.length
          ? "waiting"
          : missing.length
            ? "deleted"
            : "unassigned";
  const summary =
    kind === "view"
      ? "閲覧のみ"
      : `${here.length}ページ${pending.length ? `・未作成 ${pending.length}範囲` : ""}${missing.length ? `・削除済み ${missing.length}範囲` : ""}`;
  return {
    kind,
    pageIds: here.map((s) => s.id),
    pending: [...new Set(pending)],
    missing: [...new Set(missing)],
    otherSheets: sheetId
      ? sheets
          .filter((s) => s.id !== sheetId)
          .map((s) => ({
            ...s,
            count: pages.filter((p) => (p.sheetId ?? "main") === s.id).length,
          }))
          .filter((s) => s.count > 0)
          .map((s) => ({ id: s.id, name: s.name, count: s.count }))
      : [],
    summary,
  };
}
