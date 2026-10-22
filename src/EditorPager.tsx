import type { ReactNode } from "react";
import { memo } from "react";
import type { Deck, Slide } from "./model";
import { editorNeighbor, W, H } from "./model";
import { Canvas } from "./Canvas";
import { useSlidePan } from "./useSlidePan";
const PagePreview = memo(Canvas);

export function EditorPager({
  deck,
  slide,
  zoom,
  onNavigate,
  children,
}: {
  deck: Deck;
  slide: Slide;
  zoom: number;
  onNavigate: (dx: number, dy: number) => unknown;
  children: ReactNode;
}) {
  const width = W * zoom,
    height = H * zoom;
  const { viewport, pan, handlers } = useSlidePan({
    slideId: slide.id,
    width,
    height,
    neighbor: (dx, dy) => editorNeighbor(deck, slide, dx, dy),
    navigate: onNavigate,
  });
  const transform = (offset: number) =>
    pan?.axis === "y"
      ? `translate3d(0, ${offset}px, 0)`
      : `translate3d(${offset}px, 0, 0)`;
  return (
    <div
      ref={viewport}
      className="editor-pager canvas-scale"
      style={{ width, height }}
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
