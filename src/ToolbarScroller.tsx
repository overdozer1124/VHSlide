import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Keep one toolbar row and make overflowing actions discoverable. */
export function ToolbarScroller({
  children,
  label,
}: {
  children: (ref: RefObject<HTMLElement | null>) => ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState({
    overflow: false,
    left: false,
    right: false,
  });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const max = Math.max(0, element.scrollWidth - element.clientWidth);
        const next = {
          overflow: max > 1,
          left: element.scrollLeft > 1,
          right: element.scrollLeft < max - 1,
        };
        setState((previous) =>
          previous.overflow === next.overflow &&
          previous.left === next.left &&
          previous.right === next.right
            ? previous
            : next,
        );
      });
    };
    const resize = new ResizeObserver(update);
    const mutation = new MutationObserver(update);
    resize.observe(element);
    mutation.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  const scroll = (direction: number) =>
    ref.current?.scrollBy({
      left: direction * Math.max(180, ref.current.clientWidth * 0.7),
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  return (
    <div className="toolbar-scroll-shell">
      {children(ref)}
      {state.overflow && (
        <div
          className="toolbar-scroll-controls"
          role="group"
          aria-label={`${label}の隠れた操作`}
        >
          <button
            type="button"
            aria-label={`${label}を左へスクロール`}
            disabled={!state.left}
            onClick={() => scroll(-1)}
          >
            <ChevronLeft size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`${label}を右へスクロール`}
            disabled={!state.right}
            onClick={() => scroll(1)}
          >
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
