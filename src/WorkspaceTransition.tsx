import { useLayoutEffect, useRef } from "react";
import { Canvas } from "./Canvas";
import { W } from "./model";
import type { Slide } from "./model";

export type WorkspaceFlight = {
  slide: Slide;
  from: DOMRect;
  destination: "map" | "editor";
};

/** A passive slide preview bridges the two layouts; editing DOM is never scaled
 * into the map, and neither a gesture nor text input waits on the animation. */
export function WorkspaceTransition({
  flight,
  done,
}: {
  flight: WorkspaceFlight;
  done: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latestDone = useRef(done);
  latestDone.current = done;
  useLayoutEffect(() => {
    let animation: Animation | undefined;
    let frame = 0;
    // Let the editor's ResizeObserver fit the canvas, or the map restore scroll.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const target =
          flight.destination === "editor"
            ? document.querySelector(".editor-pager")
            : document.querySelector(
                `[data-page-id="${CSS.escape(flight.slide.id)}"] .thumbnail`,
              );
        const to = target?.getBoundingClientRect();
        if (
          !ref.current ||
          !to ||
          !to.width ||
          matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          latestDone.current();
          return;
        }
        const transform = (rect: DOMRect) =>
          `translate3d(${rect.x}px, ${rect.y}px, 0) scale(${rect.width / W})`;
        animation = ref.current.animate(
          [{ transform: transform(flight.from) }, { transform: transform(to) }],
          {
            duration: 280,
            easing: "cubic-bezier(.2,.7,.2,1)",
            fill: "forwards",
          },
        );
        animation.onfinish = () => latestDone.current();
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      animation?.cancel();
    };
  }, [flight]);
  return (
    <div
      className="workspace-flight"
      ref={ref}
      aria-hidden="true"
      inert
      style={{
        transform: `translate3d(${flight.from.x}px, ${flight.from.y}px, 0) scale(${flight.from.width / W})`,
      }}
    >
      <Canvas slide={flight.slide} zoom={1} />
    </div>
  );
}
