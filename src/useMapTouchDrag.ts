import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { GridMove } from "./model";
export type MapDrop = { x: number; y: number; insert: boolean };
type Point = { x: number; y: number };
/** Delegate touch dragging so even a 1000-page map needs only one set of listeners. */
export function useMapTouchDrag(
  surface: RefObject<HTMLElement | null>,
  options: {
    enabled: boolean;
    start: (source: GridMove) => void;
    hit: (point: Point, source: GridMove) => MapDrop | undefined;
    hover: (target?: MapDrop) => void;
    drop: (source: GridMove, target: MapDrop) => void;
    cancel: () => void;
  },
) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const node = surface.current;
    if (!node || !options.enabled) return;
    let drag:
      | {
          source: GridMove;
          original: HTMLElement;
          start: Point;
          point: Point;
          active: boolean;
          grip: boolean;
          nativeDraggable: string | null;
        }
      | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0,
      preview: HTMLElement | undefined,
      suppressUntil = 0;
    let pointerType = "";
    function reset() {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      preview?.remove();
      preview = undefined;
      drag?.original.classList.remove("map-touch-source");
      if (drag) {
        if (drag.nativeDraggable === null)
          drag.original.removeAttribute("draggable");
        else drag.original.setAttribute("draggable", drag.nativeDraggable);
      }
      drag = undefined;
    }
    function cancel() {
      const active = drag?.active;
      if (active) suppressUntil = performance.now() + 500;
      reset();
      if (active) latest.current.cancel();
    }
    function update() {
      if (!drag?.active) return;
      if (preview)
        preview.style.transform = `translate3d(${drag.point.x + 14}px, ${drag.point.y + 14}px, 0) scale(.65)`;
      latest.current.hover(latest.current.hit(drag.point, drag.source));
    }
    function scroll() {
      if (!drag?.active) return;
      const b = node!.getBoundingClientRect();
      const speed = (p: number, lo: number, hi: number) =>
        p < lo - 40 || p > hi + 40
          ? 0
          : p < lo + 40
            ? -Math.min(12, (lo + 40 - p) / 4)
            : p > hi - 40
              ? Math.min(12, (p - hi + 40) / 4)
              : 0;
      const dx = speed(drag.point.x, b.left, b.right),
        dy = speed(drag.point.y, b.top, b.bottom);
      if (dx || dy) {
        node!.scrollBy(dx, dy);
        update();
      }
      frame = requestAnimationFrame(scroll);
    }
    function activate() {
      if (!drag) return;
      drag.active = true;
      preview = document.createElement("div");
      preview.className = "map-touch-preview";
      preview.setAttribute("aria-hidden", "true");
      const clone = drag.original.cloneNode(true) as HTMLElement;
      clone.draggable = false;
      clone.removeAttribute("id");
      const b = drag.original.getBoundingClientRect();
      clone.style.width = `${b.width}px`;
      preview.append(clone);
      document.body.append(preview);
      drag.original.classList.add("map-touch-source");
      latest.current.start(drag.source);
      update();
      scroll();
    }
    function start(event: TouchEvent) {
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      const target = event.target as Element;
      if (target.closest("input,textarea,select,[contenteditable=true]"))
        return;
      const original = target.closest<HTMLElement>("[data-map-drag-source]");
      if (!original || !node!.contains(original)) return;
      const grip = !!target.closest("[data-map-drag-handle]");
      if (!grip && target.closest("button:not(.thumbnail):not(.row-move)"))
        return;
      const mode = original.dataset.mapDragSource as GridMove["mode"];
      const point = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
      };
      reset();
      drag = {
        source: {
          mode,
          x: Number(original.dataset.x),
          y: Number(original.dataset.y),
        },
        original,
        start: point,
        point,
        active: false,
        grip,
        nativeDraggable: original.getAttribute("draggable"),
      };
      // A long press must not hand control to HTML drag-and-drop. Chromium
      // otherwise cancels our touch stream and shows its native no-drop cursor.
      original.draggable = false;
      if (grip) {
        event.preventDefault();
        activate();
      } else timer = setTimeout(activate, 280);
    }
    function move(event: TouchEvent) {
      if (!drag) return;
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      drag.point = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      if (!drag.active) {
        if (
          Math.hypot(drag.point.x - drag.start.x, drag.point.y - drag.start.y) >
          16
        )
          reset();
        return;
      }
      event.preventDefault();
      update();
    }
    function end(event: TouchEvent) {
      if (!drag?.active) {
        reset();
        return;
      }
      event.preventDefault();
      if (
        drag.grip &&
        Math.hypot(drag.point.x - drag.start.x, drag.point.y - drag.start.y) < 8
      ) {
        // A grip also remains a tap-to-pick move control. A new tap elsewhere
        // chooses the destination; suppress only this release-generated click.
        suppressUntil = performance.now() + 500;
        reset();
        latest.current.hover(undefined);
        return;
      }
      const { source, point } = drag;
      const target = latest.current.hit(point, source);
      suppressUntil = performance.now() + 500;
      reset();
      if (target) latest.current.drop(source, target);
      else latest.current.cancel();
    }
    function click(event: MouseEvent) {
      if (performance.now() < suppressUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    function pointer(event: PointerEvent) {
      pointerType = event.pointerType;
      // Suppress a release-generated click, but accept the next intentional tap.
      if (event.isPrimary && !drag?.active) suppressUntil = 0;
    }
    function nativeDrag(event: DragEvent) {
      // Also block late native events after touchcancel, until a real mouse or
      // pen gesture begins. A native dragend must not clear our current move.
      if (drag || pointerType === "touch") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    function context(event: MouseEvent) {
      if (drag || performance.now() < suppressUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape" && drag) {
        event.preventDefault();
        cancel();
      }
    }
    node.addEventListener("touchstart", start, {
      passive: false,
      capture: true,
    });
    node.addEventListener("touchmove", move, { passive: false, capture: true });
    node.addEventListener("touchend", end, { passive: false, capture: true });
    node.addEventListener("touchcancel", cancel, true);
    node.addEventListener("click", click, true);
    node.addEventListener("pointerdown", pointer, true);
    node.addEventListener("dragstart", nativeDrag, true);
    node.addEventListener("dragend", nativeDrag, true);
    node.addEventListener("contextmenu", context, true);
    document.addEventListener("keydown", key);
    return () => {
      reset();
      node.removeEventListener("touchstart", start, true);
      node.removeEventListener("touchmove", move, true);
      node.removeEventListener("touchend", end, true);
      node.removeEventListener("touchcancel", cancel, true);
      node.removeEventListener("click", click, true);
      node.removeEventListener("pointerdown", pointer, true);
      node.removeEventListener("dragstart", nativeDrag, true);
      node.removeEventListener("dragend", nativeDrag, true);
      node.removeEventListener("contextmenu", context, true);
      document.removeEventListener("keydown", key);
    };
  }, [surface, options.enabled]);
}
