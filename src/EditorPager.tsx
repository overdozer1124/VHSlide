import type { CSSProperties, ReactNode, RefObject } from "react";
import { memo, useEffect } from "react";
import type { Deck, Slide } from "./model";
import { editorNeighbor, W, H } from "./model";
import { Canvas } from "./Canvas";
import { useSlidePan } from "./useSlidePan";
import { usePinch } from "./usePinch";
const PagePreview = memo(Canvas);
let shownWidth: number | undefined;
/** How wide the editor last showed its slide, if it has been open. */
export const editorSlideWidth = () => shownWidth;

export function EditorPager({
  deck,
  slide,
  zoom,
  onNavigate,
  onMap,
  onPinchStart,
  surface,
  children,
}: {
  deck: Deck;
  slide: Slide;
  zoom: number;
  onNavigate: (dx: number, dy: number) => unknown;
  onMap: (rect?: DOMRect) => void;
  onPinchStart: () => void;
  /** Where a pinch is taken, beside the slide too; the slide by default. */
  surface?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const width = W * zoom,
    height = H * zoom;
  useEffect(() => {
    shownWidth = width;
  }, [width]);
  const { viewport, pan, handlers, cancel } = useSlidePan({
    slideId: slide.id,
    width,
    height,
    neighbor: (dx, dy) => editorNeighbor(deck, slide, dx, dy),
    navigate: onNavigate,
    pinching: () => pinch.current,
  });
  const pinch = usePinch(surface ?? viewport, {
    start(point) {
      cancel();
      onPinchStart();
      const node = viewport.current!;
      const rect = node.getBoundingClientRect();
      node.style.transition = "none";
      node.style.transformOrigin = `${point.x - rect.x}px ${point.y - rect.y}px`;
    },
    change({ ratio }) {
      viewport.current!.style.transform = `scale(${Math.max(0.35, Math.min(1, ratio))})`;
    },
    end({ direction }) {
      const node = viewport.current!;
      if (direction === "in") {
        onMap(node.getBoundingClientRect());
      } else {
        node.style.transition = matchMedia("(prefers-reduced-motion: reduce)")
          .matches
          ? "none"
          : "transform 120ms ease-out";
        node.style.transform = "";
      }
    },
  });
  const transform = (offset: number) =>
    pan?.axis === "y"
      ? `translate3d(0, ${offset}px, 0)`
      : `translate3d(${offset}px, 0, 0)`;
  return (
    <div
      ref={viewport}
      className="editor-pager canvas-scale"
      style={
        {
          width,
          height,
          "--page-settle-duration": `${pan?.duration ?? 220}ms`,
        } as CSSProperties
      }
      {...handlers}
      data-pan-phase={pan ? (pan.settling ? "settling" : "dragging") : "idle"}
      data-pan-axis={pan?.axis}
      aria-label="編集中のスライド"
    >
      <div
        className="editor-page-current"
        style={{ transform: transform(pan?.offset ?? 0) }}
      >
        {children}
      </div>
      {pan?.target && (
        <div
          className="editor-page-preview"
          aria-hidden="true"
          inert
          style={{
            transform: transform(
              pan.offset + pan.direction * (pan.axis === "x" ? width : height),
            ),
          }}
        >
          <PagePreview slide={pan.target} zoom={zoom} />
        </div>
      )}
    </div>
  );
}
