import type { Deck, Sheet } from "./model.ts";
import { uid } from "./model.ts";

export type Axis = "rows" | "columns";
export type AxisGrant = { sheetId: string; index: number; axisId?: string };
const field = (axis: Axis) => (axis === "rows" ? "rowIds" : "columnIds");
/** Legacy slots have deterministic IDs, so existing DB grants need no rewrite. */
export function axisId(
  deck: Deck | undefined,
  sheetId: string,
  axis: Axis,
  index: number,
): string {
  const sheet = deck?.sheets?.find((s) => s.id === sheetId);
  return sheet?.[field(axis)]?.[String(index)] ?? String(index);
}
export function axisIndex(
  deck: Deck,
  axis: Axis,
  grant: AxisGrant,
): number | undefined {
  if (!(deck.sheets ?? [{ id: "main" }]).some((s) => s.id === grant.sheetId))
    return;
  const id = grant.axisId ?? String(grant.index);
  for (let i = 0; i < 100; i++)
    if (axisId(deck, grant.sheetId, axis, i) === id) return i;
}
export function axisGrant(
  deck: Deck,
  sheetId: string,
  axis: Axis,
  index: number,
): AxisGrant {
  return { sheetId, index, axisId: axisId(deck, sheetId, axis, index) };
}
/** Move identities and labels together. New slots never inherit an old grant. */
export function remapAxis(
  deck: Deck,
  axis: Axis,
  move: (index: number) => number | undefined,
): Deck {
  const sheetId = deck.activeSheetId ?? deck.slides[0]?.sheetId ?? "main";
  const sheets: Sheet[] = deck.sheets ?? [{ id: "main", name: "シート1" }];
  const old = sheets.find((s) => s.id === sheetId);
  if (!old) throw new Error("シートが見つかりません。");
  const labelsKey = axis === "rows" ? "rowLabels" : "columnLabels";
  const ids: Record<string, string> = {},
    labels: Record<string, string> = {};
  const occupied = new Set<number>();
  for (let i = 0; i < 100; i++) {
    const to = move(i);
    if (to === undefined || to < 0 || to >= 100) continue;
    if (occupied.has(to)) throw new Error("行・列の移動先が重複しています。");
    occupied.add(to);
    ids[String(to)] = axisId(deck, sheetId, axis, i);
    if (old[labelsKey]?.[String(i)] !== undefined)
      labels[String(to)] = old[labelsKey]![String(i)];
  }
  for (let i = 0; i < 100; i++)
    if (!occupied.has(i)) ids[String(i)] = `axis-${uid()}`;
  // Keep unchanged legacy slots implicit, but retain moved/deleted identities.
  for (let i = 0; i < 100; i++)
    if (ids[String(i)] === String(i)) delete ids[String(i)];
  return {
    ...deck,
    sheets: sheets.map((s) =>
      s.id === sheetId
        ? {
            ...s,
            [field(axis)]: ids,
            ...(old[labelsKey] === undefined ? {} : { [labelsKey]: labels }),
          }
        : s,
    ),
  };
}

/** Layout-only comparison for safely recovering pre-migration offline caches. */
export function layoutState(deck: Deck): string {
  return JSON.stringify({
    sheets: (deck.sheets ?? [{ id: "main", name: "シート1" }])
      .map((s) => ({
        id: s.id,
        rows: Array.from({ length: 100 }, (_, i) =>
          axisId(deck, s.id, "rows", i),
        ),
        columns: Array.from({ length: 100 }, (_, i) =>
          axisId(deck, s.id, "columns", i),
        ),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    slides: deck.slides
      .map((s) => ({ id: s.id, sheet: s.sheetId ?? "main", x: s.x, y: s.y }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}
