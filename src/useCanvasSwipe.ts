import { useRef } from "react";
import type { Touch, TouchEvent } from "react";

type Point = { id: number; x: number; y: number };
const point = (touch: Touch): Point => ({
  id: touch.identifier,
  x: touch.clientX,
  y: touch.clientY,
});

/** Background: one finger. Over editable objects: two parallel fingers. */
export function useCanvasSwipe(
  slideId: string,
  navigate: ((dx: number, dy: number) => unknown) | undefined,
  cancelDrag: () => void,
) {
  const gesture = useRef<{
    slideId: string;
    start: Point[];
    last: Point[];
    eligible: boolean;
  } | null>(null);
  function update(event: TouchEvent) {
    const g = gesture.current;
    if (!g) return;
    const touches = [
      ...Array.from(event.touches),
      ...Array.from(event.changedTouches),
    ];
    g.last = g.start.map((start, index) => {
      const touch = touches.find((touch) => touch.identifier === start.id);
      return touch ? point(touch) : g.last[index];
    });
    if (g.start.length === 2) {
      const distance = (points: Point[]) =>
        Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      // A pinch or fingers moving apart must never turn into page navigation.
      if (Math.abs(distance(g.last) - distance(g.start)) > 20)
        g.eligible = false;
    }
  }
  return {
    onTouchStartCapture(event: TouchEvent<HTMLDivElement>) {
      if (!navigate) return;
      if (event.touches.length === 1) {
        const start = [point(event.touches[0])];
        gesture.current = {
          slideId,
          start,
          last: start,
          eligible: !(event.target as HTMLElement).closest(".element"),
        };
      } else if (event.touches.length === 2 && gesture.current) {
        const start = Array.from(event.touches, point);
        gesture.current = { slideId, start, last: start, eligible: true };
        // Roll back any object drag started by the first finger.
        cancelDrag();
      } else if (gesture.current) gesture.current.eligible = false;
    },
    onTouchMoveCapture(event: TouchEvent<HTMLDivElement>) {
      if (
        gesture.current &&
        event.touches.length !== gesture.current.start.length
      )
        gesture.current.eligible = false;
      update(event);
    },
    onTouchEndCapture(event: TouchEvent<HTMLDivElement>) {
      update(event);
      const g = gesture.current;
      // Consume on the first release, so lifting the second finger cannot repeat it.
      gesture.current = null;
      if (!g?.eligible || g.slideId !== slideId || !navigate) return;
      const deltas = g.last.map((last, i) => ({
        x: last.x - g.start[i].x,
        y: last.y - g.start[i].y,
      }));
      const dx = deltas.reduce((sum, d) => sum + d.x, 0) / deltas.length;
      const dy = deltas.reduce((sum, d) => sum + d.y, 0) / deltas.length;
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const major = horizontal ? dx : dy;
      const minor = horizontal ? dy : dx;
      if (Math.abs(major) < 48 || Math.abs(major) < Math.abs(minor) * 1.3)
        return;
      if (deltas.some((d) => (horizontal ? d.x : d.y) * Math.sign(major) < 32))
        return;
      navigate(
        horizontal ? (dx < 0 ? 1 : -1) : 0,
        horizontal ? 0 : dy < 0 ? 1 : -1,
      );
    },
    onTouchCancelCapture() {
      gesture.current = null;
      cancelDrag();
    },
  };
}
