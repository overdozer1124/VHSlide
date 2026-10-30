import { useId } from "react";
import type { Element } from "./model";
import { shapePath } from "./shapeCatalog";
import { linePoint } from "./objectEditing";
export const dashArray = (e: Element) =>
  e.strokeDash === "dash" ? "8 5" : e.strokeDash === "dot" ? "2 5" : undefined;
export function ShapeGraphic({ element: e }: { element: Element }) {
  const path = shapePath(e.shape!);
  // Keep legacy ellipse/rect nodes for saved slides and existing accessibility tools.
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      fill={e.fill}
      stroke={e.stroke}
      strokeWidth={e.strokeWidth ?? 2}
      strokeDasharray={dashArray(e)}
    >
      {e.shape === "circle" ? (
        <ellipse cx="50" cy="50" rx="48" ry="48" />
      ) : e.shape === "rect" || e.shape === "rounded" ? (
        <rect
          x="1"
          y="1"
          width="98"
          height="98"
          rx={e.shape === "rounded" ? 14 : 0}
        />
      ) : (
        <path d={path} />
      )}
    </svg>
  );
}
export function LineGraphic({ element: e }: { element: Element }) {
  const id = useId().replace(/:/g, ""),
    start = linePoint(e, "start"),
    end = linePoint(e, "end"),
    a = { x: (e.w * start.x) / 100, y: (e.h * start.y) / 100 },
    b = { x: (e.w * end.x) / 100, y: (e.h * end.y) / 100 },
    mid = (a.x + b.x) / 2;
  const path =
    e.lineKind === "elbow"
      ? `M${a.x} ${a.y}H${mid}V${b.y}H${b.x}`
      : e.lineKind === "curve"
        ? `M${a.x} ${a.y}C${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`
        : `M${a.x} ${a.y}L${b.x} ${b.y}`;
  const marker = (which: "start" | "end", kind: string | undefined) =>
    kind && kind !== "none" ? (
      <marker
        id={`${id}-${which}`}
        viewBox="0 0 10 10"
        refX={kind === "circle" ? 5 : 9}
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
        markerUnits="strokeWidth"
      >
        {kind === "circle" ? (
          <circle cx="5" cy="5" r="4" fill={e.stroke} />
        ) : (
          <path d="M0 0L10 5 0 10Z" fill={e.stroke} />
        )}
      </marker>
    ) : null;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${e.w} ${e.h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ overflow: "visible" }}
    >
      <defs>
        {marker("start", e.startArrow)}
        {marker("end", e.endArrow)}
      </defs>
      <path
        d={path}
        fill="none"
        stroke={e.stroke}
        strokeWidth={e.strokeWidth ?? 2}
        strokeDasharray={dashArray(e)}
        markerStart={
          e.startArrow && e.startArrow !== "none"
            ? `url(#${id}-start)`
            : undefined
        }
        markerEnd={
          e.endArrow && e.endArrow !== "none" ? `url(#${id}-end)` : undefined
        }
      />
    </svg>
  );
}
