import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Slide } from "./model";
type Point = { x: number; y: number };
export function useMapSelection(
  pages: Slide[],
  positions: Map<string, Point>,
  enabled: boolean,
) {
  const [active, setActive] = useState(false),
    [ids, setIds] = useState<string[]>([]),
    [box, setBox] = useState<{
      left: number;
      top: number;
      width: number;
      height: number;
    }>();
  const anchor = useRef<string | undefined>(undefined),
    drag = useRef<
      | {
          start: Point;
          point: Point;
          base: string[];
          previous: string[];
          card?: string;
          add: boolean;
          shift: boolean;
          pointer: number;
          node: HTMLElement;
        }
      | undefined
    >(undefined),
    frame = useRef(0);
  const available = new Set(pages.map((s) => s.id)),
    selected = ids.filter((id) => available.has(id));
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    if (!enabled) {
      setActive(false);
      setBox(undefined);
      drag.current = undefined;
    }
  }, [enabled]);
  function choose(id: string, add: boolean, shift: boolean) {
    const p = positions.get(id),
      a = anchor.current && positions.get(anchor.current);
    const range =
      shift && p && a
        ? pages
            .filter((s) => {
              const v = positions.get(s.id)!;
              return (
                v.x >= Math.min(a.x, p.x) &&
                v.x <= Math.max(a.x, p.x) &&
                v.y >= Math.min(a.y, p.y) &&
                v.y <= Math.max(a.y, p.y)
              );
            })
            .map((s) => s.id)
        : [id];
    setIds(
      add && !shift
        ? selected.includes(id)
          ? selected.filter((i) => i !== id)
          : [...selected, id]
        : add
          ? [...new Set([...selected, ...range])]
          : range,
    );
    if (!shift) anchor.current = id;
  }
  function update() {
    const d = drag.current;
    if (!d) return;
    const left = Math.min(d.start.x, d.point.x),
      top = Math.min(d.start.y, d.point.y),
      right = Math.max(d.start.x, d.point.x),
      bottom = Math.max(d.start.y, d.point.y);
    if (Math.hypot(d.point.x - d.start.x, d.point.y - d.start.y) < 5) return;
    setBox({ left, top, width: right - left, height: bottom - top });
    const hit = [...d.node.querySelectorAll<HTMLElement>("[data-page-id]")]
      .filter((n) => {
        const r = n.getBoundingClientRect();
        return (
          r.right > left && r.left < right && r.bottom > top && r.top < bottom
        );
      })
      .map((n) => n.dataset.pageId!);
    setIds([...new Set([...d.base, ...hit])]);
  }
  function finishDrag() {
    cancelAnimationFrame(frame.current);
    const d = drag.current;
    drag.current = undefined;
    if (d?.node.hasPointerCapture(d.pointer))
      d.node.releasePointerCapture(d.pointer);
    setBox(undefined);
  }
  const handlers = {
    onPointerDownCapture(e: ReactPointerEvent<HTMLDivElement>) {
      if (
        !enabled ||
        !e.isPrimary ||
        e.button !== 0 ||
        (!active && !e.ctrlKey && !e.metaKey && !e.shiftKey)
      )
        return;
      const bounds = e.currentTarget.getBoundingClientRect();
      if (
        e.clientX >= bounds.left + e.currentTarget.clientWidth ||
        e.clientY >= bounds.top + e.currentTarget.clientHeight
      )
        return;
      const target = e.target as HTMLElement;
      if (
        target.closest("input,textarea,select,.card-tool,.map-heading,.add-dot")
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      setActive(true);
      const card =
        target.closest<HTMLElement>("[data-page-id]")?.dataset.pageId;
      e.currentTarget.focus({ preventScroll: true });
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = {
        start: { x: e.clientX, y: e.clientY },
        point: { x: e.clientX, y: e.clientY },
        base: e.ctrlKey || e.metaKey ? selected : [],
        previous: selected,
        card,
        add: e.ctrlKey || e.metaKey || e.pointerType === "touch",
        shift: e.shiftKey,
        pointer: e.pointerId,
        node: e.currentTarget,
      };
    },
    onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
      const d = drag.current;
      if (!d || d.pointer !== e.pointerId) return;
      d.point = { x: e.clientX, y: e.clientY };
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(update);
    },
    onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
      const d = drag.current;
      if (!d || d.pointer !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      cancelAnimationFrame(frame.current);
      d.point = { x: e.clientX, y: e.clientY };
      if (Math.hypot(d.point.x - d.start.x, d.point.y - d.start.y) >= 5)
        update();
      else if (d.card) choose(d.card, d.add, d.shift);
      else if (!d.add) setIds([]);
      drag.current = undefined;
      setBox(undefined);
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onPointerCancel() {
      if (drag.current) setIds(drag.current.previous);
      finishDrag();
    },
    onLostPointerCapture() {
      if (drag.current) {
        setIds(drag.current.previous);
        finishDrag();
      }
    },
    onClickCapture(e: ReactMouseEvent<HTMLDivElement>) {
      if (!active) return;
      const target = e.target as HTMLElement;
      if (
        target.closest(".card-tool,input,textarea,select,.map-heading,.add-dot")
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      if (e.detail === 0) {
        const id =
          target.closest<HTMLElement>("[data-page-id]")?.dataset.pageId;
        if (id) choose(id, true, e.shiftKey);
      }
    },
  };
  return {
    active,
    ids: selected,
    box,
    handlers,
    toggle() {
      finishDrag();
      setActive(!active);
      setIds([]);
      setBox(undefined);
    },
    clear() {
      setIds([]);
    },
    all() {
      setIds(pages.map((s) => s.id));
    },
    close() {
      finishDrag();
      setActive(false);
      setIds([]);
      setBox(undefined);
    },
  };
}
