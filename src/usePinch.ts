import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export type PinchPoint = { x: number; y: number };
export type PinchSample = PinchPoint & {
  ratio: number;
  direction?: "in" | "out";
};

/** Own only two-finger pinches (including Chrome's ctrl+wheel trackpad events).
 * One-finger scrolling/paging and ordinary wheel events stay with their owners. */
export function usePinch(
  surface: RefObject<HTMLElement | null>,
  options: {
    start: (point: PinchPoint) => void;
    change: (sample: PinchSample) => void;
    end: (sample: PinchSample, cancelled: boolean) => void;
  },
) {
  const latest = useRef(options);
  latest.current = options;
  const active = useRef(false);
  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    let source: "touch" | "wheel" | undefined;
    let distance = 1;
    let wheelRatio = 1;
    let sample: PinchSample = { x: 0, y: 0, ratio: 1 };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let suppressUntil = 0;
    const measure = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
      distance: Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      ),
    });
    function report(next: PinchSample) {
      // Ignore two-finger taps and tiny sensor jitter. Once zoom has begun,
      // keep its first direction and furthest extent even if the fingers reverse.
      const direction =
        sample.direction ??
        (Math.abs(Math.log(next.ratio)) >= 0.045
          ? next.ratio < 1
            ? "in"
            : "out"
          : undefined);
      sample = {
        ...next,
        direction,
        ratio:
          direction === "in"
            ? Math.min(sample.ratio, next.ratio)
            : direction === "out"
              ? Math.max(sample.ratio, next.ratio)
              : 1,
      };
      latest.current.change(sample);
    }
    function finish(cancelled: boolean) {
      clearTimeout(timer);
      if (!source) return;
      source = undefined;
      suppressUntil = performance.now() + 350;
      latest.current.end(sample, cancelled);
    }
    function start(event: TouchEvent) {
      if (event.touches.length < 2 || source === "touch") return;
      if (source) finish(true);
      event.preventDefault();
      const point = measure(event.touches);
      distance = Math.max(20, point.distance);
      sample = { x: point.x, y: point.y, ratio: 1 };
      source = "touch";
      active.current = true;
      latest.current.start(point);
    }
    function move(event: TouchEvent) {
      if (source !== "touch") return;
      event.preventDefault();
      if (event.touches.length !== 2) return finish(true);
      const point = measure(event.touches);
      report({
        x: point.x,
        y: point.y,
        ratio: Math.max(0.08, Math.min(8, point.distance / distance)),
      });
    }
    function end(event: TouchEvent) {
      if (source === "touch" && event.touches.length < 2) {
        event.preventDefault();
        finish(event.type === "touchcancel");
      }
      // The remaining finger must not turn into a page swipe or an object drag.
      if (!event.touches.length) active.current = false;
    }
    function wheel(event: WheelEvent) {
      if (!event.ctrlKey || source === "touch") return;
      event.preventDefault();
      if (!source) {
        source = "wheel";
        active.current = true;
        wheelRatio = 1;
        sample = { x: event.clientX, y: event.clientY, ratio: 1 };
        latest.current.start(sample);
      }
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? node!.clientHeight
            : 1;
      wheelRatio = Math.max(
        0.08,
        Math.min(8, wheelRatio * Math.exp(-event.deltaY * unit * 0.008)),
      );
      report({ x: sample.x, y: sample.y, ratio: wheelRatio });
      clearTimeout(timer);
      timer = setTimeout(() => {
        active.current = false;
        finish(false);
      }, 120);
    }
    function pointer(event: PointerEvent) {
      if (event.isPrimary && !active.current) suppressUntil = 0;
    }
    function click(event: MouseEvent) {
      if (performance.now() < suppressUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    node.addEventListener("touchstart", start, {
      passive: false,
      capture: true,
    });
    node.addEventListener("touchmove", move, { passive: false, capture: true });
    node.addEventListener("touchend", end, { passive: false, capture: true });
    node.addEventListener("touchcancel", end, {
      passive: false,
      capture: true,
    });
    node.addEventListener("wheel", wheel, { passive: false, capture: true });
    node.addEventListener("click", click, true);
    node.addEventListener("pointerdown", pointer, true);
    return () => {
      clearTimeout(timer);
      active.current = false;
      node.removeEventListener("touchstart", start, true);
      node.removeEventListener("touchmove", move, true);
      node.removeEventListener("touchend", end, true);
      node.removeEventListener("touchcancel", end, true);
      node.removeEventListener("wheel", wheel, true);
      node.removeEventListener("click", click, true);
      node.removeEventListener("pointerdown", pointer, true);
    };
  }, [surface]);
  return active;
}
