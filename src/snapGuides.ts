import type { Element } from "./model";
import { H, W } from "./model";
import { elementBounds, type ResizeDirection } from "./objectEditing";

/** Slide units within which a dragged edge is pulled onto a target line. */
export const SNAP_THRESHOLD = 7;

export type SnapTargets = { xs: number[]; ys: number[] };
export type Box = { x: number; y: number; w: number; h: number };

/** Snap lines offered while dragging: the slide edges and centre, plus the
 * edges and centres of every element that is not itself being dragged. */
export function collectSnapTargets(
  elements: Element[],
  exclude: ReadonlySet<string>,
): SnapTargets {
  const xs = [0, W / 2, W],
    ys = [0, H / 2, H];
  for (const e of elements) {
    if (exclude.has(e.id)) continue;
    const b = elementBounds([e]);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

function nearest(
  value: number,
  targets: number[],
  threshold: number,
): { adjust: number; guide: number } | undefined {
  let best: { adjust: number; guide: number } | undefined;
  for (const t of targets) {
    const adjust = t - value;
    if (
      Math.abs(adjust) <= threshold &&
      (!best || Math.abs(adjust) < Math.abs(best.adjust))
    )
      best = { adjust, guide: t };
  }
  return best;
}

/** Pull a moving box's delta so its nearest edge or centre lands on a target
 * line. Returns the adjusted delta and the guide line to show per axis. */
export function snapMoveDelta(
  bounds: Box,
  dx: number,
  dy: number,
  targets: SnapTargets,
  threshold = SNAP_THRESHOLD,
): { dx: number; dy: number; guideX?: number; guideY?: number } {
  let out = { dx, dy } as {
    dx: number;
    dy: number;
    guideX?: number;
    guideY?: number;
  };
  let bestX: { adjust: number; guide: number } | undefined;
  for (const edge of [
    bounds.x + dx,
    bounds.x + dx + bounds.w / 2,
    bounds.x + dx + bounds.w,
  ]) {
    const hit = nearest(edge, targets.xs, threshold);
    if (hit && (!bestX || Math.abs(hit.adjust) < Math.abs(bestX.adjust)))
      bestX = hit;
  }
  if (bestX) {
    out.dx += bestX.adjust;
    out.guideX = bestX.guide;
  }
  let bestY: { adjust: number; guide: number } | undefined;
  for (const edge of [
    bounds.y + dy,
    bounds.y + dy + bounds.h / 2,
    bounds.y + dy + bounds.h,
  ]) {
    const hit = nearest(edge, targets.ys, threshold);
    if (hit && (!bestY || Math.abs(hit.adjust) < Math.abs(bestY.adjust)))
      bestY = hit;
  }
  if (bestY) {
    out.dy += bestY.adjust;
    out.guideY = bestY.guide;
  }
  return out;
}

/** Pull a resize drag's delta so the moving edge lands on a target line.
 * With the aspect locked, only the driving axis (the one the resize itself
 * follows) is snapped, so the derived side never fights the guide. */
export function snapResizeDelta(
  bounds: Box,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  targets: SnapTargets,
  lock = false,
  threshold = SNAP_THRESHOLD,
): { dx: number; dy: number; guideX?: number; guideY?: number } {
  const west = direction.includes("w"),
    east = direction.includes("e"),
    north = direction.includes("n"),
    south = direction.includes("s");
  let adjX: { adjust: number; guide: number } | undefined,
    adjY: { adjust: number; guide: number } | undefined;
  if (east) adjX = nearest(bounds.x + bounds.w + dx, targets.xs, threshold);
  else if (west) adjX = nearest(bounds.x + dx, targets.xs, threshold);
  if (south) adjY = nearest(bounds.y + bounds.h + dy, targets.ys, threshold);
  else if (north) adjY = nearest(bounds.y + dy, targets.ys, threshold);
  if (lock && adjX && adjY) {
    // resizeBoxFromHandle follows the axis whose size changed more.
    if (Math.abs(dx) >= Math.abs(dy)) adjY = undefined;
    else adjX = undefined;
  }
  return {
    dx: dx + (adjX?.adjust ?? 0),
    dy: dy + (adjY?.adjust ?? 0),
    guideX: adjX?.guide,
    guideY: adjY?.guide,
  };
}
