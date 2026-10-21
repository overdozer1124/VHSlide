import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { H, W } from "./model";
export function useFitCanvas(
  ref: RefObject<HTMLDivElement | null>,
  verticalSpace = 85,
) {
  const [zoom, setZoom] = useState(0.5);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setZoom(
        Math.max(
          0.1,
          Math.min(
            (entry.contentRect.width - 48) / W,
            (entry.contentRect.height - verticalSpace) / H,
          ),
        ),
      ),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, verticalSpace]);
  return zoom;
}
