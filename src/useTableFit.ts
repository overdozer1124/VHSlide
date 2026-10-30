import { useEffect, useRef, useState } from "react";
import { measureTableFit, type FitIssue } from "./contentFit";
export function useTableFit(
  elementId: string,
  dependency: unknown,
  enabled: boolean,
) {
  const ref = useRef<HTMLTableElement>(null),
    [issues, setIssues] = useState<FitIssue[]>([]);
  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node) {
      setIssues([]);
      return;
    }
    let alive = true,
      frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!alive) return;
        const next = measureTableFit(node, elementId);
        setIssues((old) =>
          JSON.stringify(old) === JSON.stringify(next) ? old : next,
        );
        node.dispatchEvent(
          new CustomEvent("vhslide-table-fit", {
            bubbles: true,
            detail: { id: elementId, issues: next },
          }),
        );
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    document.fonts.addEventListener("loadingdone", update);
    void document.fonts.ready.then(update);
    update();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", update);
    };
  }, [elementId, dependency, enabled]);
  return { ref, issues };
}
