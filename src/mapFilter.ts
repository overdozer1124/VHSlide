import type { Slide } from "./model";
import type { AxisGrant } from "./axes";
export type MapFilter = {
  ids: string[];
  rows: number[];
  columns: number[];
  excludedIds?: string[];
  rowAxes?: AxisGrant[];
  columnAxes?: AxisGrant[];
  assigned?: boolean;
  /** Derived from current access; never persisted as the assigned condition. */
  assignedIds?: string[];
};
export const emptyFilter = (): MapFilter => ({
  ids: [],
  rows: [],
  columns: [],
});
export const matchesFilter = (s: Slide, filter: MapFilter) =>
  !filter.excludedIds?.includes(s.id) &&
  (filter.ids.includes(s.id) ||
    filter.rows.includes(s.y) ||
    filter.columns.includes(s.x) ||
    !!(filter.assigned && filter.assignedIds?.includes(s.id)));
export function toggleFilterSlide(filter: MapFilter, slide: Slide): MapFilter {
  const selected = matchesFilter(slide, filter);
  return {
    ...filter,
    ids: selected
      ? filter.ids.filter((id) => id !== slide.id)
      : [...new Set([...filter.ids, slide.id])],
    excludedIds: selected
      ? [...new Set([...(filter.excludedIds ?? []), slide.id])]
      : filter.excludedIds?.filter((id) => id !== slide.id),
  };
}
export function groupSelection(
  slides: Slide[],
  filter: MapFilter,
): boolean | "mixed" {
  const count = slides.filter((s) => matchesFilter(s, filter)).length;
  return count && count < slides.length ? "mixed" : !!count;
}
export function toggleFilterGroup(
  filter: MapFilter,
  slides: Slide[],
  axis: "rows" | "columns",
  index: number,
): MapFilter {
  const ids = new Set(slides.map((s) => s.id));
  const selected = groupSelection(slides, filter) === true;
  return {
    ...filter,
    [axis]: selected
      ? filter[axis].filter((n) => n !== index)
      : [...new Set([...filter[axis], index])],
    ids: selected ? filter.ids.filter((id) => !ids.has(id)) : filter.ids,
    excludedIds: selected
      ? [...new Set([...(filter.excludedIds ?? []), ...ids])]
      : filter.excludedIds?.filter((id) => !ids.has(id)),
  };
}
export function balancedGrid(count: number) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
}
