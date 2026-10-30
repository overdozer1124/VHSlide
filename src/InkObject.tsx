import { useId, useRef, useState } from "react";
import { inkDash, inkShapeKind } from "./inkStyle";
import { inkGeometry } from "./inkGeometry";
import type { InkShape } from "./inkGeometry";
import { fillInk } from "./inkFill";
import type { ReactNode } from "react";
import type { Element } from "./model";
export type InkStroke = {
  points: { x: number; y: number }[];
  color: string;
  width: number;
  erase?: boolean;
  shape?: InkShape;
  fill?: string;
  dash?: "solid" | "dash" | "dot";
  fillContours?: { x: number; y: number }[][];
};
export const emptyInkImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
function inkPath(s: InkStroke) {
  return s.fillContours
    ? s.fillContours
        .map(
          (c) =>
            c.map((p, j) => `${j ? "L" : "M"}${p.x},${p.y}`).join(" ") + "Z",
        )
        .join(" ")
    : s.points.map((p, j) => `${j ? "L" : "M"}${p.x},${p.y}`).join(" ") +
        (s.points.length === 1 ? "l0.01,0" : "");
}
function InkArtwork({
  strokes,
  selectable = false,
}: {
  strokes: InkStroke[];
  selectable?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  let artwork: ReactNode = null;
  let segment: { stroke: InkStroke; index: number }[] = [];
  const masks: ReactNode[] = [];
  const flush = () => {
    if (!segment.length) return;
    artwork = (
      <>
        {artwork}
        {segment
          .sort(
            (a, b) =>
              Number(!!b.stroke.fillContours) - Number(!!a.stroke.fillContours),
          )
          .map(({ stroke: s, index }) => (
            <path
              key={index}
              data-ink-paint=""
              data-ink-index={index}
              data-ink-shape={inkShapeKind(s)}
              pointerEvents={selectable && inkShapeKind(s) ? "all" : undefined}
              d={inkPath(s)}
              fill={
                s.fillContours
                  ? s.color
                  : s.shape === "line"
                    ? "none"
                    : (s.fill ?? "none")
              }
              fillRule="evenodd"
              stroke={s.fillContours ? "none" : s.color}
              strokeWidth={s.width}
              strokeDasharray={inkDash(s.dash, s.width).join(" ") || undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
      </>
    );
    segment = [];
  };
  strokes.forEach((s, index) => {
    if (!s.erase) {
      segment.push({ stroke: s, index });
      return;
    }
    flush();
    const maskId = `ink-erase-${id}-${index}`;
    masks.push(
      <mask
        key={maskId}
        id={maskId}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="960"
        height="540"
        style={{ maskType: "luminance" }}
      >
        <rect width="960" height="540" fill="white" />
        <path
          d={inkPath(s)}
          fill="none"
          stroke="black"
          strokeWidth={s.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>,
    );
    artwork = (
      <g key={maskId} mask={`url(#${maskId})`}>
        {artwork}
      </g>
    );
  });
  flush();
  return (
    <>
      <defs>{masks}</defs>
      {artwork}
    </>
  );
}
export function InkObject({
  element: e,
  editable = false,
  onChange,
  selectedIndex,
  onSelect,
}: {
  element: Element;
  editable?: boolean;
  onChange?: (e: Element) => void;
  selectedIndex?: number;
  onSelect?: (index?: number) => void;
}) {
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<InkStroke | null>(null),
    live = useRef<InkStroke | null>(null),
    pointer = useRef<number | undefined>(undefined);
  const shape = useRef<{
    tool: InkShape;
    start: { x: number; y: number };
  } | null>(null);
  const point = (ev: React.PointerEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(960, ((ev.clientX - r.x) * 960) / r.width)),
      y: Math.max(0, Math.min(540, ((ev.clientY - r.y) * 540) / r.height)),
    };
  };
  const chosen =
    selectedIndex === undefined ? undefined : e.drawing?.[selectedIndex];
  const chosenPoints =
    chosen && inkShapeKind(chosen) && e.drawingTool === "select"
      ? chosen.points
      : undefined;
  const box = chosenPoints
    ? {
        x: Math.min(...chosenPoints.map((p) => p.x)),
        y: Math.min(...chosenPoints.map((p) => p.y)),
        w:
          Math.max(...chosenPoints.map((p) => p.x)) -
          Math.min(...chosenPoints.map((p) => p.x)),
        h:
          Math.max(...chosenPoints.map((p) => p.y)) -
          Math.min(...chosenPoints.map((p) => p.y)),
      }
    : undefined;
  return (
    <svg
      className={
        editable
          ? `ink-object ink-editing ${e.drawingTool === "select" ? "ink-selecting" : ""}`
          : "ink-object"
      }
      viewBox="0 0 960 540"
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      aria-label="手描きオブジェクト"
      onPointerDown={(ev) => {
        if (!editable || ev.button !== 0 || live.current) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (e.drawingTool === "select") {
          const node = (
            ev.target as globalThis.Element
          ).closest<SVGPathElement>("[data-ink-index]");
          const index = node ? Number(node.dataset.inkIndex) : undefined;
          onSelect?.(
            index !== undefined &&
              e.drawing?.[index] &&
              inkShapeKind(e.drawing[index])
              ? index
              : undefined,
          );
          return;
        }
        if (e.drawingTool === "fill") {
          const seed = point(ev),
            contours = fillInk(e.drawing ?? [], seed);
          const pointCount =
            (e.drawing ?? []).reduce(
              (n, s) =>
                n +
                s.points.length +
                (s.fillContours ?? []).reduce((m, c) => m + c.length, 0),
              0,
            ) +
            1 +
            contours.reduce((n, c) => n + c.length, 0);
          if (!contours.length) return;
          if ((e.drawing?.length ?? 0) >= 1000 || pointCount > 50000) {
            window.alert(
              "手描きの容量上限に達しました。不要な描画を消すか、別の手描きオブジェクトを追加してください。",
            );
            return;
          }
          onChange?.({
            ...e,
            drawing: [
              ...(e.drawing ?? []),
              {
                points: [seed],
                color: e.stroke ?? "#173d38",
                width: 1,
                fillContours: contours,
              },
            ],
          });
          return;
        }
        shape.current = ["line", "rectangle", "ellipse"].includes(
          e.drawingTool ?? "",
        )
          ? { tool: e.drawingTool as InkShape, start: point(ev) }
          : null;
        pointer.current = ev.pointerId;
        ev.currentTarget.setPointerCapture(ev.pointerId);
        live.current = {
          points: [point(ev)],
          color: e.stroke ?? "#173d38",
          width:
            e.drawingTool === "eraser"
              ? (e.eraserWidth ?? 30)
              : (e.strokeWidth ?? 5),
          ...(e.drawingTool === "eraser" ? { erase: true } : {}),
          ...(shape.current
            ? {
                shape: shape.current.tool,
                fill:
                  shape.current.tool === "line"
                    ? "none"
                    : (e.inkShapeFill ?? "none"),
                dash: e.inkShapeDash ?? "solid",
              }
            : {}),
        };
        setDraft(live.current);
      }}
      onPointerLeave={() => setHover(null)}
      onPointerMove={(ev) => {
        if (editable && e.drawingTool === "eraser") setHover(point(ev));
        if (!live.current || pointer.current !== ev.pointerId) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (live.current.points.length >= 10000) return;
        live.current = {
          ...live.current,
          points: shape.current
            ? inkGeometry(
                shape.current.tool,
                shape.current.start,
                point(ev),
                ev.shiftKey,
              )
            : [...live.current.points, point(ev)],
        };
        setDraft(live.current);
      }}
      onPointerUp={(ev) => {
        if (!live.current || pointer.current !== ev.pointerId) return;
        ev.stopPropagation();
        const stroke = shape.current
          ? {
              ...live.current,
              points: inkGeometry(
                shape.current.tool,
                shape.current.start,
                point(ev),
                ev.shiftKey,
              ),
            }
          : live.current;
        const noShape =
          shape.current &&
          Math.hypot(
            point(ev).x - shape.current.start.x,
            point(ev).y - shape.current.start.y,
          ) < 2;
        shape.current = null;
        live.current = null;
        setDraft(null);
        if (noShape) return;
        const drawing = [...(e.drawing ?? []), stroke];
        if (
          drawing.length > 1000 ||
          drawing.reduce(
            (n, s) =>
              n +
              s.points.length +
              (s.fillContours ?? []).reduce((m, c) => m + c.length, 0),
            0,
          ) > 50000
        ) {
          window.alert(
            "手描きの容量上限に達しました。不要な描画を消すか、別の手描きオブジェクトを追加してください。",
          );
          return;
        }
        onChange?.({ ...e, drawing });
      }}
      onPointerCancel={() => {
        shape.current = null;
        live.current = null;
        setDraft(null);
      }}
    >
      <InkArtwork
        strokes={[...(e.drawing ?? []), ...(draft ? [draft] : [])]}
        selectable={editable && e.drawingTool === "select"}
      />
      {editable && box && (
        <rect
          className="ink-shape-selection"
          x={box.x - 4}
          y={box.y - 4}
          width={box.w + 8}
          height={box.h + 8}
          fill="none"
          stroke="#4387c9"
          strokeWidth="1"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
      {editable && e.drawingTool === "eraser" && hover && (
        <circle
          className="ink-eraser-cursor"
          cx={hover.x}
          cy={hover.y}
          r={(e.eraserWidth ?? 30) / 2}
          fill="none"
          stroke="#173d38"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
