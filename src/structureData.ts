import type { Element, Slide } from "./model.ts";
export type AnchorSide = "top" | "right" | "bottom" | "left";
export type ConnectorAnchor = { elementId: string; side: AnchorSide };
export function parseAnchor(value: unknown): ConnectorAnchor {
  const a = value as ConnectorAnchor;
  if (
    !a ||
    typeof a !== "object" ||
    typeof a.elementId !== "string" ||
    !a.elementId.length ||
    a.elementId.length > 100 ||
    !["top", "right", "bottom", "left"].includes(a.side)
  )
    throw new Error("線の接続先が正しくありません。");
  return { elementId: a.elementId, side: a.side };
}
export function anchorPoint(target: Element, side: AnchorSide) {
  let x = side === "left" ? 0 : side === "right" ? 1 : 0.5,
    y = side === "top" ? 0 : side === "bottom" ? 1 : 0.5;
  if (target.flipX) x = 1 - x;
  if (target.flipY) y = 1 - y;
  for (let i = 0; i < (target.rotation ?? 0) / 90; i++) [x, y] = [1 - y, x];
  return { x: target.x + x * target.w, y: target.y + y * target.h };
}
export function endpoint(e: Element, which: "start" | "end") {
  const p = (which === "start" ? e.lineStart : e.lineEnd) ?? {
    x: which === "start" ? 0 : 100,
    y: 50,
  };
  return { x: e.x + (e.w * p.x) / 100, y: e.y + (e.h * p.y) / 100 };
}
export function withLinePoints(
  e: Element,
  a: { x: number; y: number },
  b: { x: number; y: number },
): Element {
  const w = Math.max(20, Math.abs(a.x - b.x)),
    h = Math.max(20, Math.abs(a.y - b.y));
  const x = Math.max(0, Math.min(960 - w, Math.min(a.x, b.x))),
    y = Math.max(0, Math.min(540 - h, Math.min(a.y, b.y)));
  return {
    ...e,
    x,
    y,
    w,
    h,
    lineStart: { x: ((a.x - x) * 100) / w, y: ((a.y - y) * 100) / h },
    lineEnd: { x: ((b.x - x) * 100) / w, y: ((b.y - y) * 100) / h },
  };
}
/** Resolve only local non-line targets. Missing/foreign IDs never fetch data or form a cycle. */
export function resolveConnections(all: Element[]): Element[] {
  const byId = new Map(all.map((e) => [e.id, e]));
  return all.map((e) => {
    if (e.type !== "line") return e;
    const point = (which: "start" | "end") => {
      const ref = which === "start" ? e.startAnchor : e.endAnchor,
        target = ref ? byId.get(ref.elementId) : undefined;
      return ref && target && target.type !== "line"
        ? anchorPoint(target, ref.side)
        : endpoint(e, which);
    };
    return e.startAnchor || e.endAnchor
      ? withLinePoints(e, point("start"), point("end"))
      : e;
  });
}
export function nearestAnchor(
  all: Element[],
  lineId: string,
  x: number,
  y: number,
  threshold: number,
): ConnectorAnchor | undefined {
  let best = threshold,
    result: ConnectorAnchor | undefined;
  for (const e of [...all].reverse()) {
    if (e.type === "line" || e.id === lineId) continue;
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const p = anchorPoint(e, side),
        distance = Math.hypot(p.x - x, p.y - y);
      if (distance < best) {
        best = distance;
        result = { elementId: e.id, side };
      }
    }
  }
  return result;
}
export function expandGroups(all: Element[], ids: string[]): string[] {
  const selected = new Set(ids),
    groups = new Set(
      all.filter((e) => selected.has(e.id) && e.groupId).map((e) => e.groupId),
    );
  return all
    .filter((e) => selected.has(e.id) || (e.groupId && groups.has(e.groupId)))
    .map((e) => e.id);
}
export function groupElements(all: Element[], ids: string[], id: () => string) {
  const chosen = new Set(expandGroups(all, ids));
  if (chosen.size < 2) return all;
  const groupId = id();
  const members = all
    .filter((e) => chosen.has(e.id))
    .map((e) => ({ ...e, groupId }));
  const last = all.reduce((last, e, i) => (chosen.has(e.id) ? i : last), -1);
  return all.flatMap((e, i) =>
    chosen.has(e.id) ? (i === last ? members : []) : [e],
  );
}
export function ungroupElements(all: Element[], ids: string[]) {
  const chosen = new Set(ids),
    groups = new Set(
      all.filter((e) => chosen.has(e.id) && e.groupId).map((e) => e.groupId),
    );
  return all.map((e) =>
    e.groupId && groups.has(e.groupId) ? { ...e, groupId: undefined } : e,
  );
}
/** Moving a line independently detaches only endpoints whose objects are not moving. */
export function movableElements(all: Element[], ids: string[]) {
  const selected = new Set(ids);
  return resolveConnections(all)
    .filter((e) => selected.has(e.id))
    .map((e) =>
      e.type === "line"
        ? {
            ...e,
            startAnchor:
              e.startAnchor && selected.has(e.startAnchor.elementId)
                ? e.startAnchor
                : undefined,
            endAnchor:
              e.endAnchor && selected.has(e.endAnchor.elementId)
                ? e.endAnchor
                : undefined,
          }
        : e,
    );
}
export function removeObjects(all: Element[], ids: string[]) {
  const removed = new Set(ids);
  return resolveConnections(all)
    .filter((e) => !removed.has(e.id))
    .map((e) =>
      e.type === "line"
        ? {
            ...e,
            startAnchor:
              e.startAnchor && removed.has(e.startAnchor.elementId)
                ? undefined
                : e.startAnchor,
            endAnchor:
              e.endAnchor && removed.has(e.endAnchor.elementId)
                ? undefined
                : e.endAnchor,
          }
        : e,
    );
}
/** Clone an object set as a graph: references outside the copied set are detached. */
export function copyElements(
  all: Element[],
  ids: string[],
  id: () => string,
  slides = new Map<string, string>(),
) {
  const chosen = new Set(ids),
    source = resolveConnections(all).filter((e) => chosen.has(e.id)),
    map = new Map(source.map((e) => [e.id, id()])),
    groups = new Map<string, string>();
  for (const e of source)
    if (e.groupId && !groups.has(e.groupId)) groups.set(e.groupId, id());
  return source.map((e) => {
    const next: Element = { ...structuredClone(e), id: map.get(e.id)! };
    if (e.groupId)
      next.groupId =
        source.filter((t) => t.groupId === e.groupId).length > 1
          ? groups.get(e.groupId)
          : undefined;
    for (const key of ["startAnchor", "endAnchor"] as const) {
      const a = e[key];
      if (a)
        next[key] = map.has(a.elementId)
          ? { ...a, elementId: map.get(a.elementId)! }
          : undefined;
    }
    if (e.link?.slideId)
      next.link = { slideId: slides.get(e.link.slideId) ?? e.link.slideId };
    else if (e.link?.url) next.link = { url: e.link.url };
    if (e.chart)
      next.chart = {
        ...structuredClone(e.chart),
        series: e.chart.series.map((p) => ({ ...p, id: id() })),
      };
    return next;
  });
}
export function copyPages(source: Slide[], id: () => string) {
  const slides = new Map(source.map((s) => [s.id, id()]));
  return source.map((s) => ({
    ...structuredClone(s),
    id: slides.get(s.id)!,
    elements: copyElements(
      s.elements,
      s.elements.map((e) => e.id),
      id,
      slides,
    ),
  }));
}
