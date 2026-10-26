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
  duration?: number;
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
function isEditSurface(
  target: EventTarget | null,
  point?: { x: number; y: number },
) {
  if (point) target = document.elementFromPoint(point.x, point.y);
  if (!(target instanceof Element)) return false;
  return (
    !!target.closest(
      ".element-drag-border, .resize-handle, .line-endpoint, .slide-table[data-cell-range=true], .sticky-note, .slide-canvas[data-selection-mode=true]",
    ) ||
    (!!target.closest(".editable .slide-table") && !target.closest("textarea"))
  );
}

/** Keep a page attached to the finger; commit navigation only after it settles. */
export function useSlidePan(options: {
  slideId: string;
  width: number;
  height: number;
  neighbor: (dx: number, dy: number) => Slide | undefined;
  navigate: (dx: number, dy: number) => unknown;
  pinching?: () => boolean;
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
  const wheelCommitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const frame = useRef<number>(undefined);
  const wheelMotion = useRef({ magnitude: 0, peak: 0, falling: 0 });
  const wheelTail = useRef<{
    axis: Axis;
    direction: number;
    magnitude: number;
    lastAt: number;
    decayed: boolean;
  } | null>(null);
  const suppressClickUntil = useRef(0);
  function display(next: Pan | null, coalesce = false) {
    currentPan.current = next;
    if (coalesce) {
      if (frame.current === undefined)
        frame.current = requestAnimationFrame(() => {
          frame.current = undefined;
          setPan(currentPan.current);
        });
    } else {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      setPan(next);
    }
  }
  function reset() {
    clearTimeout(settleTimer.current);
    clearTimeout(wheelTimer.current);
    clearTimeout(wheelCommitTimer.current);
    wheelCommitTimer.current = undefined;
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
    display(
      {
        axis: g.axis,
        direction,
        target,
        offset: target
          ? Math.max(-size, Math.min(size, raw))
          : Math.max(-60, Math.min(60, raw * 0.18)),
        settling: false,
      },
      g.source === "wheel",
    );
  }
  function finish(cancelled = false) {
    const g = gesture.current,
      p = currentPan.current;
    gesture.current = null;
    clearTimeout(wheelTimer.current);
    clearTimeout(wheelCommitTimer.current);
    wheelCommitTimer.current = undefined;
    if (!g || !p) return;
    const size = p.axis === "x" ? latest.current.width : latest.current.height;
    const commit =
      !cancelled &&
      !!p.target &&
      Math.abs(p.offset) >= Math.min(72, size * 0.2);
    // Only a committed page change needs to finish before accepting another one.
    // Returning from an edge or a cancelled pan is short and interruptible.
    settling.current = commit;
    if (g.source === "wheel")
      wheelTail.current = {
        axis: p.axis,
        direction: p.direction,
        magnitude: wheelMotion.current.magnitude,
        lastAt: performance.now(),
        decayed: wheelMotion.current.falling > 0,
      };
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : !commit
        ? 90
        : g.source === "wheel"
          ? 160
          : 220;
    display({
      ...p,
      settling: true,
      duration,
      offset: commit ? -p.direction * size : 0,
    });
    settleTimer.current = setTimeout(() => {
      if (commit && latest.current.slideId === g.slideId) {
        // Blur only after settling: removing the touch target or closing the
        // on-screen keyboard earlier can interrupt capture or resize the page.
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          (active.isContentEditable || active instanceof HTMLTextAreaElement) &&
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
      clearTimeout(wheelCommitTimer.current);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      gesture.current = null;
    };
  }, [options.slideId, options.width, options.height]);

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    function wheel(event: WheelEvent) {
      // Pinches belong to the map/editor zoom gesture.
      if (
        event.ctrlKey ||
        latest.current.pinching?.() ||
        isEditSurface(event.target)
      )
        return;
      event.preventDefault();
      if (gesture.current?.source === "touch") return;
      const now = performance.now();
      const factor = event.deltaMode === 1 ? 16 : 1;
      const dx =
          event.deltaX *
          (event.deltaMode === 2 ? latest.current.width : factor),
        dy =
          event.deltaY *
          (event.deltaMode === 2 ? latest.current.height : factor);
      if (!dx && !dy) return;
      const axis: Axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      const delta = axis === "x" ? dx : dy;
      const magnitude = Math.abs(delta);
      const tail = wheelTail.current;
      if (tail) {
        // Ignore the old gesture's inertia, but accept a fresh stroke or reversal
        // without waiting for a long Windows momentum stream to end.
        const fresh =
          !settling.current &&
          (now - tail.lastAt > 100 ||
            (magnitude >= 8 &&
              (axis !== tail.axis || Math.sign(delta) !== tail.direction)) ||
            (tail.decayed && magnitude >= Math.max(16, tail.magnitude * 2.5)));
        if (!fresh) {
          tail.decayed ||= magnitude < tail.magnitude * 0.8;
          tail.magnitude = magnitude;
          tail.lastAt = now;
          return;
        }
        wheelTail.current = null;
      }
      if (settling.current) return;
      let g = gesture.current;
      if (!g) {
        // Stop the previous return timer before it can clear the new gesture.
        if (currentPan.current?.settling) reset();
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
        wheelMotion.current = { magnitude: 0, peak: 0, falling: 0 };
      }
      const motion = wheelMotion.current;
      motion.falling =
        magnitude < motion.magnitude * 0.85 ? motion.falling + 1 : 0;
      motion.magnitude = magnitude;
      motion.peak = Math.max(motion.peak, magnitude);
      g.dx -= dx;
      g.dy -= dy;
      update(g);
      clearTimeout(wheelTimer.current);
      const p = currentPan.current;
      if (p && !p.target) {
        // There is no destination: do not wait for a potentially long momentum
        // stream to end. Its remaining outward events are handled by wheelTail.
        finish();
        return;
      }
      const size =
        p?.axis === "x" ? latest.current.width : latest.current.height;
      const ready =
        !!p?.target && Math.abs(p.offset) >= Math.min(72, size * 0.2);
      if (ready) {
        // A sustained stream must not postpone navigation indefinitely.
        if (wheelCommitTimer.current === undefined)
          wheelCommitTimer.current = setTimeout(() => finish(), 120);
        if (motion.falling >= 2 && magnitude < motion.peak * 0.7) {
          finish();
          return;
        }
      } else {
        clearTimeout(wheelCommitTimer.current);
        wheelCommitTimer.current = undefined;
      }
      wheelTimer.current = setTimeout(() => finish(), 80);
    }
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);

  return {
    viewport,
    pan,
    cancel: reset,
    handlers: {
      onPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
        if (latest.current.pinching?.()) {
          event.stopPropagation();
          return;
        }
        // Ignore the compatibility click after a swipe, not the next real tap.
        suppressClickUntil.current = 0;
        if (!settling.current && currentPan.current?.settling) reset();
        if (event.pointerType !== "touch") return;
        if (!event.isPrimary) {
          if (!settling.current) finish(true);
          event.stopPropagation();
          return;
        }
        if (isEditSurface(event.target, { x: event.clientX, y: event.clientY }))
          return;
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
          text: !!(event.target as Element).closest(
            "[contenteditable],textarea",
          ),
        };
      },
      onPointerMoveCapture(event: ReactPointerEvent<HTMLDivElement>) {
        if (latest.current.pinching?.()) {
          event.stopPropagation();
          return;
        }
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
