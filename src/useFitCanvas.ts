import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { H, W } from "./model";
export function useFitCanvas(
  ref: RefObject<HTMLDivElement | null>,
  verticalSpace = 85,
  horizontalSpace = 48,
) {
  const [zoom, setZoom] = useState(0.5);
  // Fit before the first paint too, so the canvas never shows at a stand-in
  // size (a transition into it would aim at that size, then jump).
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fit = (width: number, height: number) =>
      setZoom(
        Math.max(
          0.1,
          Math.min((width - horizontalSpace) / W, (height - verticalSpace) / H),
        ),
      );
    const style = getComputedStyle(node);
    fit(
      node.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
      node.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom),
    );
    const observer = new ResizeObserver(([entry]) =>
      fit(entry.contentRect.width, entry.contentRect.height),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, verticalSpace, horizontalSpace]);
  return zoom;
}
