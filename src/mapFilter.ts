import type { Slide } from "./model";
export type MapFilter = { ids: string[]; rows: number[]; columns: number[] };
export const emptyFilter = (): MapFilter => ({
  ids: [],
  rows: [],
  columns: [],
});
export const matchesFilter = (s: Slide, filter: MapFilter) =>
  filter.ids.includes(s.id) ||
  filter.rows.includes(s.y) ||
  filter.columns.includes(s.x);
export function balancedGrid(count: number) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
}
export function filterNumbers(text: string): number[] {
  if (!text.trim()) return [];
  const result = new Set<number>();
  for (const part of text.split(/[,、\s]+/).filter(Boolean)) {
    const match = part.match(/^(\d+)(?:[-〜~](\d+))?$/);
    if (!match) throw new Error("番号は「1,3,5-8」のように入力してください。");
    const first = Number(match[1]),
      last = Number(match[2] ?? match[1]);
    if (first < 1 || last > 100 || first > last)
      throw new Error("番号は1〜100の範囲で指定してください。");
    for (let n = first; n <= last; n++) result.add(n - 1);
  }
  return [...result];
}
