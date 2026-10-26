import type { Element } from "./model.ts";
import {
  arrangeElements,
  elementBounds,
  translateElements,
  type Arrange,
} from "./objectEditing.ts";
import {
  movableElements,
  resolveConnections,
  endpoint,
  withLinePoints,
} from "./structureData.ts";
export function resizeSelection(es: Element[], w: number, h: number) {
  const b = elementBounds(es),
    wanted = Math.abs(w - b.w) >= Math.abs(h - b.h) ? w / b.w : h / b.h;
  const min = Math.max(
      20 / b.w,
      20 / b.h,
      ...es
        .filter((e) => e.type !== "line")
        .flatMap((e) => [20 / e.w, 20 / e.h]),
    ),
    max = Math.min((960 - b.x) / b.w, (540 - b.y) / b.h);
  const scale = Math.max(min, Math.min(max, wanted));
  if (min > max) return es;
  return es.map((e) => {
    if (e.type === "line") {
      const a = endpoint(e, "start"),
        z = endpoint(e, "end");
      return withLinePoints(
        e,
        { x: b.x + (a.x - b.x) * scale, y: b.y + (a.y - b.y) * scale },
        { x: b.x + (z.x - b.x) * scale, y: b.y + (z.y - b.y) * scale },
      );
    }
    return {
      ...e,
      x: b.x + (e.x - b.x) * scale,
      y: b.y + (e.y - b.y) * scale,
      w: e.w * scale,
      h: e.h * scale,
    };
  });
}
/** Complete groups behave as units; an explicitly entered member remains editable on its own. */
export function arrangementUnits(all: Element[], ids: string[]): Element[][] {
  const selected = new Set(ids),
    source = movableElements(all, ids),
    seen = new Set<string>();
  const units: Element[][] = [];
  for (const e of source) {
    if (seen.has(e.id)) continue;
    const full =
      e.groupId &&
      all
        .filter((t) => t.groupId === e.groupId)
        .every((t) => selected.has(t.id));
    const unit = full ? source.filter((t) => t.groupId === e.groupId) : [e];
    unit.forEach((t) => seen.add(t.id));
    units.push(unit);
  }
  return units;
}
export function arrangeStructured(
  all: Element[],
  ids: string[],
  action: Arrange,
) {
  const selected = new Set(ids),
    source = movableElements(all, ids),
    units = arrangementUnits(all, ids);
  if (!units.length) return all;
  if (["front", "back", "forward", "backward"].includes(action)) {
    const inside = source[0].groupId;
    if (
      inside &&
      source.every((e) => e.groupId === inside) &&
      !all.filter((e) => e.groupId === inside).every((e) => selected.has(e.id))
    ) {
      const ordered = arrangeElements(
        all.filter((e) => e.groupId === inside),
        ids,
        action,
      );
      let index = 0;
      return all.map((e) => (e.groupId === inside ? ordered[index++] : e));
    }
    // Compact groups into layer blocks, including unselected groups.
    const blocks: Element[][] = [],
      done = new Set<string>();
    for (const e of all) {
      if (done.has(e.id)) continue;
      const block = e.groupId
        ? all.filter((t) => t.groupId === e.groupId)
        : [e];
      block.forEach((t) => done.add(t.id));
      blocks.push(block);
    }
    const proxies = blocks.map((block, i) => ({
        ...block[0],
        id: `block-${i}`,
      })),
      chosen = blocks.flatMap((b, i) =>
        b.some((e) => selected.has(e.id)) ? [`block-${i}`] : [],
      );
    const result = arrangeElements(proxies, chosen, action).flatMap(
      (p) => blocks[Number(p.id.slice(6))],
    );
    return result;
  }
  const proxies = units.map((unit, i) => ({
    ...unit[0],
    ...elementBounds(unit),
    id: `unit-${i}`,
    rotation: 0 as const,
    flipX: false,
    flipY: false,
  }));
  const result = arrangeElements(
      proxies,
      proxies.map((e) => e.id),
      action,
    ),
    changes = new Map<string, Element>();
  units.forEach((unit, i) => {
    const b = elementBounds(unit),
      next = result[i];
    if (
      action === "rotateLeft" ||
      action === "rotateRight" ||
      action === "flipX" ||
      action === "flipY"
    ) {
      if (unit.length === 1) {
        const transformed = arrangeElements(unit, [unit[0].id], action)[0];
        changes.set(transformed.id, transformed);
        return;
      }
      const turn = action === "rotateLeft" || action === "rotateRight",
        right = action === "rotateRight",
        scale = turn ? Math.min(next.w / b.h, next.h / b.w) : 1;
      for (const e of unit) {
        let nx = (e.x - b.x) / b.w,
          ny = (e.y - b.y) / b.h,
          nw = e.w / b.w,
          nh = e.h / b.h;
        if (turn) {
          const tx = right ? 1 - ny - nh : ny,
            ty = right ? nx : 1 - nx - nw;
          nx = tx;
          ny = ty;
          [nw, nh] = [nh, nw];
        } else if (action === "flipX") nx = 1 - nx - nw;
        else ny = 1 - ny - nh;
        const geometry = {
          x: Math.max(0, Math.min(940, next.x + nx * next.w)),
          y: Math.max(0, Math.min(520, next.y + ny * next.h)),
          w: Math.max(20, turn ? e.h * scale : e.w),
          h: Math.max(20, turn ? e.w * scale : e.h),
        };
        geometry.w = Math.min(960 - geometry.x, geometry.w);
        geometry.h = Math.min(540 - geometry.y, geometry.h);
        const transformed = arrangeElements(
          [{ ...e, x: 0, y: 0 }],
          [e.id],
          action,
        )[0];
        changes.set(e.id, { ...transformed, ...geometry });
      }
    } else
      for (const e of translateElements(unit, next.x - b.x, next.y - b.y))
        changes.set(e.id, e);
  });
  return resolveConnections(all.map((e) => changes.get(e.id) ?? e));
}
