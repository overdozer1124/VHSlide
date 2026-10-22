import { useEffect, useRef, useState } from "react";
import type { Element, Slide } from "./model";
import { W, H } from "./model";
import { InlineText } from "./InlineText";
import { Move } from "lucide-react";
import { useCanvasSwipe } from "./useCanvasSwipe";
export function ElementView({ element: e }: { element: Element }) {
  if (e.type === "text")
    return (
      <div
        className="slide-text"
        style={{
          fontSize: e.fontSize,
          fontWeight: e.bold ? 700 : 400,
          color: e.color,
          background: e.highlight,
        }}
      >
        {e.bullets
          ? e.text
              ?.split("\n")
              .map((line) => `• ${line}`)
              .join("\n")
          : e.text}
      </div>
    );
  if (e.type === "image")
    return (
      <img
        className="slide-image"
        src={e.src}
        alt="スライドの画像"
        draggable={false}
      />
    );
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      fill={e.fill}
      stroke={e.stroke}
      strokeWidth="2"
    >
      {e.shape === "circle" ? (
        <ellipse cx="50" cy="50" rx="48" ry="48" />
      ) : e.shape === "arrow" ? (
        <path d="M2 30H60V4L98 50 60 96V70H2Z" />
      ) : e.shape === "bubble" ? (
        <path d="M12 2H88Q98 2 98 12V68Q98 78 88 78H38L17 97 21 78H12Q2 78 2 68V12Q2 2 12 2Z" />
      ) : (
        <rect
          x="1"
          y="1"
          width="98"
          height="98"
          rx={e.shape === "rounded" ? 14 : 0}
        />
      )}
    </svg>
  );
}
export function Canvas({
  slide,
  selected,
  onSelect,
  onChange,
  editable = false,
  zoom = 1,
  onNavigate,
}: {
  slide: Slide;
  selected?: string;
  onSelect?: (id?: string) => void;
  onChange?: (e: Element) => void;
  editable?: boolean;
  zoom?: number;
  onNavigate?: (dx: number, dy: number) => unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Element>();
  const [editingId, setEditingId] = useState<string>();
  const previousSelection = useRef(selected);
  useEffect(() => {
    if (!editable) return;
    if (selected !== previousSelection.current) {
      const element = slide.elements.find((e) => e.id === selected);
      setEditingId(
        element?.type === "text" && element.text === "ここにことばを入力"
          ? element.id
          : undefined,
      );
      previousSelection.current = selected;
    }
    if (editingId && !slide.elements.some((e) => e.id === editingId))
      setEditingId(undefined);
  }, [selected, slide.id, slide.elements, editable, editingId]);
  const [guides, setGuides] = useState({ x: false, y: false });
  const drag = useRef<{
    element: Element;
    px: number;
    py: number;
    resize: boolean;
    scale: number;
    allowTyping: boolean;
  } | null>(null);
  function cancelDrag() {
    drag.current = null;
    setDraft(undefined);
    setGuides({ x: false, y: false });
  }
  const swipe = useCanvasSwipe(
    slide.id,
    editable ? onNavigate : undefined,
    cancelDrag,
  );
  function start(
    event: React.PointerEvent,
    element: Element,
    resize = false,
    allowTyping = true,
  ) {
    if (!editable || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    setEditingId(undefined);
    onSelect?.(element.id);
    const scale = ref.current!.getBoundingClientRect().width / W;
    drag.current = {
      element,
      px: event.clientX,
      py: event.clientY,
      resize,
      scale,
      allowTyping,
    };
    setDraft(element);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (event.clientX - d.px) / d.scale,
      dy = (event.clientY - d.py) / d.scale;
    let e = { ...d.element };
    if (d.resize) {
      e.w = Math.max(20, Math.min(W - e.x, e.w + dx));
      e.h = Math.max(20, Math.min(H - e.y, e.h + dy));
    } else {
      e.x = Math.max(0, Math.min(W - e.w, e.x + dx));
      e.y = Math.max(0, Math.min(H - e.h, e.y + dy));
    }
    const gx = !d.resize && Math.abs(e.x + e.w / 2 - W / 2) < 7;
    const gy = !d.resize && Math.abs(e.y + e.h / 2 - H / 2) < 7;
    if (gx) e.x = W / 2 - e.w / 2;
    if (gy) e.y = H / 2 - e.h / 2;
    setGuides({ x: gx, y: gy });
    setDraft(e);
  }
  function end() {
    if (drag.current && draft) {
      const before = drag.current.element;
      const changed = (["x", "y", "w", "h"] as const).some(
        (key) => before[key] !== draft[key],
      );
      if (changed)
        onChange?.({
          ...(slide.elements.find((e) => e.id === draft.id) ?? draft),
          x: draft.x,
          y: draft.y,
          w: draft.w,
          h: draft.h,
        });
      else if (
        before.type === "text" &&
        !drag.current.resize &&
        drag.current.allowTyping
      )
        setEditingId(before.id);
    }
    drag.current = null;
    setDraft(undefined);
    setGuides({ x: false, y: false });
  }
  return (
    <div className="canvas-scale" style={{ width: W * zoom, height: H * zoom }}>
      <div
        ref={ref}
        className={`slide-canvas ${editable ? "editable" : ""} ${editable && onNavigate ? "swipe-enabled" : ""}`}
        {...swipe}
        style={{ background: slide.background, transform: `scale(${zoom})` }}
        onPointerDown={() => onSelect?.()}
      >
        {slide.elements.map((original) => {
          const e = draft?.id === original.id ? draft : original;
          return (
            <div
              key={e.id}
              className={`element ${editable && selected === e.id ? "selected-element" : ""} ${editingId === e.id ? "editing-element" : ""}`}
              tabIndex={editable ? 0 : undefined}
              aria-label={
                editable && e.type === "text" ? "テキストボックス" : undefined
              }
              onDoubleClick={(event) => {
                if (editable && e.type === "text") {
                  event.stopPropagation();
                  onSelect?.(e.id);
                  setEditingId(e.id);
                }
              }}
              onKeyDown={(event) => {
                if (
                  editable &&
                  e.type === "text" &&
                  ["Enter", "F2"].includes(event.key)
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect?.(e.id);
                  setEditingId(e.id);
                }
              }}
              style={{ left: e.x, top: e.y, width: e.w, height: e.h }}
              onPointerDown={(event) => start(event, e)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={cancelDrag}
            >
              {editable && editingId === e.id && e.type === "text" ? (
                <InlineText
                  key={e.id}
                  element={e}
                  onChange={(text) => onChange?.({ ...e, text })}
                  onFinish={() => setEditingId(undefined)}
                />
              ) : (
                <ElementView element={e} />
              )}
              {editable && selected === e.id && e.type === "text" && (
                <button
                  className="element-move-handle"
                  aria-label="要素を移動"
                  onPointerDown={(event) => start(event, e, false, false)}
                >
                  <Move size={18} />
                </button>
              )}
              {editable && selected === e.id && (
                <button
                  aria-label="要素のサイズを変更"
                  className="resize-handle"
                  onPointerDown={(event) => start(event, e, true)}
                />
              )}
            </div>
          );
        })}
        {guides.x && <div className="guide vertical" />}
        {guides.y && <div className="guide horizontal" />}
      </div>
    </div>
  );
}
