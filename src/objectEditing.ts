import { copyElements } from "./structureData.ts";
import type { Element } from "./model.ts";
import { H, W, uid } from "./model.ts";
export type Arrange =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "horizontal"
  | "vertical"
  | "front"
  | "forward"
  | "backward"
  | "back"
  | "rotateLeft"
  | "rotateRight"
  | "flipX"
  | "flipY";
export function elementBounds(es: Element[]) {
  const x = Math.min(...es.map((e) => e.x)),
    y = Math.min(...es.map((e) => e.y));
  const right = Math.max(...es.map((e) => e.x + e.w)),
    bottom = Math.max(...es.map((e) => e.y + e.h));
  return { x, y, w: right - x, h: bottom - y };
}
export function translateElements(es: Element[], dx: number, dy: number) {
  if (!es.length) return es;
  const b = elementBounds(es);
  dx = Math.max(-b.x, Math.min(W - b.x - b.w, dx));
  dy = Math.max(-b.y, Math.min(H - b.y - b.h, dy));
  return es.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
}
export function resizeElement(
  e: Element,
  w: number,
  h: number,
  lock = e.aspectLocked ?? false,
) {
  if (lock) {
    const wanted = Math.abs(w - e.w) >= Math.abs(h - e.h) ? w / e.w : h / e.h;
    const scale = Math.max(
      Math.max(20 / e.w, 20 / e.h),
      Math.min(Math.min((W - e.x) / e.w, (H - e.y) / e.h), wanted),
    );
    return { ...e, w: e.w * scale, h: e.h * scale };
  }
  return {
    ...e,
    w: Math.max(20, Math.min(W - e.x, w)),
    h: Math.max(20, Math.min(H - e.y, h)),
  };
}
export function arrangeElements(
  all: Element[],
  ids: string[],
  action: Arrange,
): Element[] {
  const chosen = new Set(ids),
    es = all.filter((e) => chosen.has(e.id));
  if (!es.length) return all;
  if (["front", "back", "forward", "backward"].includes(action)) {
    if (action === "front")
      return [...all.filter((e) => !chosen.has(e.id)), ...es];
    if (action === "back")
      return [...es, ...all.filter((e) => !chosen.has(e.id))];
    const next = [...all];
    if (action === "forward")
      for (let i = next.length - 2; i >= 0; i--) {
        if (chosen.has(next[i].id) && !chosen.has(next[i + 1].id))
          [next[i], next[i + 1]] = [next[i + 1], next[i]];
      }
    else
      for (let i = 1; i < next.length; i++) {
        if (chosen.has(next[i].id) && !chosen.has(next[i - 1].id))
          [next[i], next[i - 1]] = [next[i - 1], next[i]];
      }
    return next;
  }
  const bounds =
    es.length === 1 ? { x: 0, y: 0, w: W, h: H } : elementBounds(es);
  const changes = new Map<string, Element>();
  if (action === "horizontal" || action === "vertical") {
    if (es.length < 3) return all;
    const key = action === "horizontal" ? "x" : "y",
      size = key === "x" ? "w" : "h";
    const sorted = [...es].sort((a, b) => a[key] - b[key]),
      first = sorted[0][key],
      last = sorted.at(-1)!;
    const gap =
      (last[key] +
        last[size] -
        first -
        sorted.reduce((n, e) => n + e[size], 0)) /
      (es.length - 1);

    if (gap < 0) return all;
    let at = first;
    for (const e of sorted) {
      changes.set(e.id, { ...e, [key]: at });
      at += e[size] + gap;
    }
  } else
    for (const e of es) {
      let next = { ...e };
      switch (action) {
        case "left":
          next.x = bounds.x;
          break;
        case "center":
          next.x = bounds.x + (bounds.w - e.w) / 2;
          break;
        case "right":
          next.x = bounds.x + bounds.w - e.w;
          break;
        case "top":
          next.y = bounds.y;
          break;
        case "middle":
          next.y = bounds.y + (bounds.h - e.h) / 2;
          break;
        case "bottom":
          next.y = bounds.y + bounds.h - e.h;
          break;
        case "rotateLeft":
        case "rotateRight": {
          const scale = Math.min(1, W / e.h, H / e.w),
            w = Math.max(20, e.h * scale),
            h = Math.max(20, e.w * scale);
          next = {
            ...e,
            w: Math.min(W, w),
            h: Math.min(H, h),
            x: Math.max(0, Math.min(W - Math.min(W, w), e.x + (e.w - w) / 2)),
            y: Math.max(0, Math.min(H - Math.min(H, h), e.y + (e.h - h) / 2)),
            rotation: (((e.rotation ?? 0) +
              (action === "rotateRight" ? 90 : 270)) %
              360) as Element["rotation"],
          };
          if (e.type === "line") {
            next.rotation = 0;
            const turn = (p: { x: number; y: number }) =>
              action === "rotateRight"
                ? { x: 100 - p.y, y: p.x }
                : { x: p.y, y: 100 - p.x };
            next.lineStart = turn(linePoint(e, "start"));
            next.lineEnd = turn(linePoint(e, "end"));
          }
          break;
        }
        case "flipX":
          if (e.type === "line") {
            next.lineStart = {
              ...linePoint(e, "start"),
              x: 100 - linePoint(e, "start").x,
            };
            next.lineEnd = {
              ...linePoint(e, "end"),
              x: 100 - linePoint(e, "end").x,
            };
          } else next.flipX = !e.flipX;
          break;
        case "flipY":
          if (e.type === "line") {
            next.lineStart = {
              ...linePoint(e, "start"),
              y: 100 - linePoint(e, "start").y,
            };
            next.lineEnd = {
              ...linePoint(e, "end"),
              y: 100 - linePoint(e, "end").y,
            };
          } else next.flipY = !e.flipY;
          break;
      }
      changes.set(e.id, next);
    }
  return all.map((e) => changes.get(e.id) ?? e);
}
export function duplicateObjects(
  all: Element[],
  ids: string[],
): { elements: Element[]; ids: string[] } {
  const copies = copyElements(all, ids, uid);
  const moved = translateElements(copies, 20, 20);
  return { elements: [...all, ...moved], ids: moved.map((e) => e.id) };
}
export function linePoint(e: Element, p: "start" | "end") {
  return (
    e[p === "start" ? "lineStart" : "lineEnd"] ?? {
      x: p === "start" ? 0 : 100,
      y: 50,
    }
  );
}
export function moveLinePoint(
  e: Element,
  p: "start" | "end",
  x: number,
  y: number,
): Element {
  const points = { start: linePoint(e, "start"), end: linePoint(e, "end") };
  const a = {
      x: e.x + (e.w * points.start.x) / 100,
      y: e.y + (e.h * points.start.y) / 100,
    },
    b = {
      x: e.x + (e.w * points.end.x) / 100,
      y: e.y + (e.h * points.end.y) / 100,
    };
  Object.assign(p === "start" ? a : b, {
    x: Math.max(0, Math.min(W, x)),
    y: Math.max(0, Math.min(H, y)),
  });
  const w = Math.max(20, Math.abs(b.x - a.x)),
    h = Math.max(20, Math.abs(b.y - a.y)),
    left = Math.min(Math.min(a.x, b.x), W - w),
    top = Math.min(Math.min(a.y, b.y), H - h);
  return {
    ...e,
    x: left,
    y: top,
    w,
    h,
    lineStart: {
      x: Math.max(0, Math.min(100, ((a.x - left) / w) * 100)),
      y: Math.max(0, Math.min(100, ((a.y - top) / h) * 100)),
    },
    lineEnd: {
      x: Math.max(0, Math.min(100, ((b.x - left) / w) * 100)),
      y: Math.max(0, Math.min(100, ((b.y - top) / h) * 100)),
    },
  };
}

export function canDistribute(
  es: Element[],
  direction: "horizontal" | "vertical",
) {
  if (es.length < 3) return false;
  const b = elementBounds(es),
    size = direction === "horizontal" ? "w" : "h";
  return b[size] >= es.reduce((sum, e) => sum + e[size], 0);
}
