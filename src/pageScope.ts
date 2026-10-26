import type { Deck, Slide } from "./model.ts";
import type { EditAccess } from "./permissions.ts";
import { canEdit } from "./permissions.ts";
import { axisGrant, axisIndex } from "./axes.ts";
import { sheetList } from "./workbook.ts";
import { matchesFilter, type MapFilter } from "./mapFilter.ts";
export type PageScope =
  | { kind: "sheet"; sheetId: string }
  | { kind: "filter"; sheetId: string; filter: MapFilter }
  | { kind: "selection"; ids: string[]; label?: string }
  | { kind: "book" };
export type ResolvedPageScope = {
  ids: string[];
  pages: Slide[];
  label: string;
  summary: string;
  details: string;
  issues: string[];
};
/** Bind a user's numeric choices once, before positions can be reordered. */
export function bindMapFilter(
  book: Deck,
  sheetId: string,
  filter: MapFilter,
): MapFilter {
  return {
    ids: [...new Set(filter.ids)],
    rows: [...filter.rows],
    columns: [...filter.columns],
    excludedIds: [...new Set(filter.excludedIds ?? [])],
    rowAxes: filter.rows.map((i) => axisGrant(book, sheetId, "rows", i)),
    columnAxes: filter.columns.map((i) =>
      axisGrant(book, sheetId, "columns", i),
    ),
    assigned: filter.assigned,
  };
}
export function resolveMapFilter(
  book: Deck,
  sheetId: string,
  filter: MapFilter,
  access?: EditAccess,
) {
  const issues: string[] = [];
  const rows = filter.rowAxes
    ? filter.rowAxes.flatMap((g) => {
        const i =
          g.sheetId === sheetId ? axisIndex(book, "rows", g) : undefined;
        if (i === undefined) {
          issues.push("選んだ行が削除されています。");
          return [];
        }
        return [i];
      })
    : filter.rows;
  const columns = filter.columnAxes
    ? filter.columnAxes.flatMap((g) => {
        const i =
          g.sheetId === sheetId ? axisIndex(book, "columns", g) : undefined;
        if (i === undefined) {
          issues.push("選んだ列が削除されています。");
          return [];
        }
        return [i];
      })
    : filter.columns;
  const available = new Set(
    book.slides
      .filter((s) => (s.sheetId ?? "main") === sheetId)
      .map((s) => s.id),
  );
  if (filter.ids.some((id) => !available.has(id)))
    issues.push("選んだページが削除・移動されています。");
  const assignedIds =
    filter.assigned && access
      ? book.slides
          .filter(
            (s) =>
              (s.sheetId ?? "main") === sheetId && canEdit(access, s, book),
          )
          .map((s) => s.id)
      : [];
  if (filter.assigned && !assignedIds.length)
    issues.push("このシートに編集できる担当ページがありません。");
  return {
    filter: { ...filter, rows, columns, assignedIds },
    issues: [...new Set(issues)],
  };
}
export function resolvePageScope(
  book: Deck,
  scope: PageScope,
  access?: EditAccess,
): ResolvedPageScope {
  const sheets = sheetList(book),
    rank = new Map(sheets.map((s, i) => [s.id, i]));
  const ordered = [...book.slides].sort(
    (a, b) =>
      (rank.get(a.sheetId ?? "main") ?? 999) -
        (rank.get(b.sheetId ?? "main") ?? 999) ||
      a.y - b.y ||
      a.x - b.x ||
      a.id.localeCompare(b.id),
  );
  let pages = ordered,
    label = "作品全体",
    details = "",
    issues: string[] = [];
  if (scope.kind === "selection") {
    const ids = new Set(scope.ids);
    pages = ordered.filter((s) => ids.has(s.id));
    label = scope.label ?? "選んだページ";
    if (pages.length < ids.size)
      issues.push("選んだページの一部が削除されています。");
  } else if (scope.kind !== "book") {
    const sheet = sheets.find((s) => s.id === scope.sheetId);
    pages = ordered.filter((s) => (s.sheetId ?? "main") === scope.sheetId);
    label = `${sheet?.name ?? "削除されたシート"}・${scope.kind === "filter" ? "絞り込み" : "全体"}`;
    if (!sheet) {
      pages = [];
      issues.push("対象のシートが削除されています。");
    }
    if (scope.kind === "filter") {
      const resolved = resolveMapFilter(
          book,
          scope.sheetId,
          scope.filter,
          access,
        ),
        f = resolved.filter;
      issues.push(...resolved.issues);
      pages = pages.filter((s) => matchesFilter(s, f));
      details = [
        f.assigned ? "自分の担当" : "",
        ...f.rows.map(
          (i) =>
            `${i + 1}行${sheet?.rowLabels?.[i] ? `：${sheet.rowLabels[i]}` : ""}`,
        ),
        ...f.columns.map(
          (i) =>
            `${i + 1}列${sheet?.columnLabels?.[i] ? `：${sheet.columnLabels[i]}` : ""}`,
        ),
        f.ids.length ? `個別${f.ids.length}ページ` : "",
        f.excludedIds?.length ? `除外${f.excludedIds.length}ページ` : "",
      ]
        .filter(Boolean)
        .join(" / ");
    }
  }
  return {
    ids: pages.map((s) => s.id),
    pages,
    label,
    summary: `${label}・${pages.length}ページ`,
    details,
    issues: [...new Set(issues)],
  };
}
export function pageOrigin(book: Deck, s: Slide) {
  const sheet = sheetList(book).find((t) => t.id === (s.sheetId ?? "main"));
  return `${s.y + 1}行${sheet?.rowLabels?.[s.y] ? `：${sheet.rowLabels[s.y]}` : ""} / ${s.x + 1}列${sheet?.columnLabels?.[s.x] ? `：${sheet.columnLabels[s.x]}` : ""}`;
}
