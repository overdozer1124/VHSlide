import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Slide } from "./model";

type Axis = "x" | "y";
type Pan = {
  axis: Axis;
  offset: number;
  direction: number;
  target?: Slide;
  settling: boolean;
};
type Gesture = {
  source: "touch" | "wheel";
  slideId: string;
  pointerId?: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  axis?: Axis;
  startTime: number;
  text: boolean;
};
const EDIT_HANDLE = ".element-move-handle, .resize-handle";

/** Keep a page attached to the finger; commit navigation only after it settles. */
export function useSlidePan(options: {
  slideId: string;
  width: number;
  height: number;
  neighbor: (dx: number, dy: number) => Slide | undefined;
  navigate: (dx: number, dy: number) => unknown;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const latest = useRef(options);
  latest.current = options;
  const [pan, setPan] = useState<Pan | null>(null);
  const currentPan = useRef<Pan | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const settling = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wheelTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wheelBlockedUntil = useRef(0);
  const suppressClickUntil = useRef(0);
  function display(next: Pan | null) {
    currentPan.current = next;
    setPan(next);
  }
  function reset() {
    clearTimeout(settleTimer.current);
    clearTimeout(wheelTimer.current);
    gesture.current = null;
    settling.current = false;
    display(null);
  }
  function update(g: Gesture) {
    if (g.slideId !== latest.current.slideId) return reset();
    if (!g.axis) {
      const ax = Math.abs(g.dx),
        ay = Math.abs(g.dy);
      if (Math.max(ax, ay) < 8 || Math.max(ax, ay) < Math.min(ax, ay) * 1.3)
        return;
      g.axis = ax > ay ? "x" : "y";
      window.getSelection()?.removeAllRanges();
    }
    const raw = g.axis === "x" ? g.dx : g.dy;
    const direction = raw < 0 ? 1 : -1;
    const target = latest.current.neighbor(
      g.axis === "x" ? direction : 0,
      g.axis === "y" ? direction : 0,
    );
    const size = g.axis === "x" ? latest.current.width : latest.current.height;
    display({
      axis: g.axis,
      direction,
      target,
      offset: target
        ? Math.max(-size, Math.min(size, raw))
        : Math.max(-60, Math.min(60, raw * 0.18)),
      settling: false,
    });
  }
  function finish(cancelled = false) {
    const g = gesture.current,
      p = currentPan.current;
    gesture.current = null;
    clearTimeout(wheelTimer.current);
    if (!g || !p) return;
    const size = p.axis === "x" ? latest.current.width : latest.current.height;
    const commit =
      !cancelled &&
      !!p.target &&
      Math.abs(p.offset) >= Math.min(72, size * 0.2);
    settling.current = true;
    if (g.source === "wheel")
      wheelBlockedUntil.current = performance.now() + 400;
    display({ ...p, settling: true, offset: commit ? -p.direction * size : 0 });
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : 220;
    settleTimer.current = setTimeout(() => {
      if (commit && latest.current.slideId === g.slideId) {
        // Blur only after settling: removing the touch target or closing the
        // on-screen keyboard earlier can interrupt capture or resize the page.
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          active.isContentEditable &&
          viewport.current?.contains(active)
        )
          active.blur();
        latest.current.navigate(
          p.axis === "x" ? p.direction : 0,
          p.axis === "y" ? p.direction : 0,
        );
      }
      settling.current = false;
      display(null);
    }, duration);
  }
  useEffect(() => {
    reset();
    return () => {
      clearTimeout(settleTimer.current);
      clearTimeout(wheelTimer.current);
      gesture.current = null;
    };
  }, [options.slideId, options.width, options.height]);

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    function wheel(event: WheelEvent) {
      // Ctrl+wheel is a trackpad pinch; leave browser zoom available.
      if (event.ctrlKey || (event.target as Element).closest(EDIT_HANDLE))
        return;
      event.preventDefault();
      if (gesture.current?.source === "touch") return;
      const now = performance.now();
      if (settling.current || now < wheelBlockedUntil.current) {
        wheelBlockedUntil.current = now + 180;
        return;
      }
      let g = gesture.current;
      if (!g) {
        g = {
          source: "wheel",
          slideId: latest.current.slideId,
          x: 0,
          y: 0,
          dx: 0,
          dy: 0,
          startTime: now,
          text: false,
        };
        gesture.current = g;
      }
      const factor =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? latest.current.height
            : 1;
      g.dx -= event.deltaX * factor;
      g.dy -= event.deltaY * factor;
      update(g);
      clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => finish(), 140);
    }
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);

  return {
    viewport,
    pan,
    handlers: {
      onPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
        if (event.pointerType !== "touch") return;
        if (!event.isPrimary) {
          if (!settling.current) finish(true);
          event.stopPropagation();
          return;
        }
        if ((event.target as Element).closest(EDIT_HANDLE)) return;
        if (settling.current) {
          event.stopPropagation();
          return;
        }
        if (gesture.current?.source === "wheel") reset();
        gesture.current = {
          source: "touch",
          slideId: latest.current.slideId,
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          dx: 0,
          dy: 0,
          startTime: performance.now(),
          text: !!(event.target as Element).closest("[contenteditable]"),
        };
      },
      onPointerMoveCapture(event: ReactPointerEvent<HTMLDivElement>) {
        const g = gesture.current;
        if (!g || g.source !== "touch" || g.pointerId !== event.pointerId)
          return;
        if (!g.axis && g.text && performance.now() - g.startTime > 400) {
          gesture.current = null; // A long press in text keeps native text selection.
          return;
        }
        g.dx = event.clientX - g.x;
        g.dy = event.clientY - g.y;
        update(g);
        if (g.axis) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      },
      onPointerUpCapture(event: ReactPointerEvent<HTMLDivElement>) {
        const g = gesture.current;
        if (!g || g.pointerId !== event.pointerId) return;
        if (g.axis) {
          g.dx = event.clientX - g.x;
          g.dy = event.clientY - g.y;
          update(g);
          event.preventDefault();
          event.stopPropagation();
          suppressClickUntil.current = performance.now() + 400;
        }
        finish();
      },
      onPointerCancelCapture(event: ReactPointerEvent<HTMLDivElement>) {
        if (gesture.current?.pointerId === event.pointerId) finish(true);
      },
      onLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
        if (
          event.target === event.currentTarget &&
          gesture.current?.pointerId === event.pointerId
        )
          finish(true);
      },
      onClickCapture(event: React.MouseEvent<HTMLDivElement>) {
        if (performance.now() < suppressClickUntil.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
  };
}
