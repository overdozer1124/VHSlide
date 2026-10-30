import { InkObject } from "./InkObject";
import { ChartGraphic } from "./ChartGraphic";
import {
  resolveConnections,
  expandGroups,
  movableElements,
  nearestAnchor,
  anchorPoint,
} from "./structureData";
import { resizeSelectionFromHandle } from "./structuredEditing";
import { RichTextView } from "./RichTextView";
import { ImageGraphic } from "./ImageTools";
import type { TextController } from "./TextSelectionControls";
import type { CellSelection } from "./TableCellControls";
import { ShapeGraphic, LineGraphic } from "./ObjectGraphics";
import {
  elementBounds,
  linePoint,
  moveLinePoint,
  resizeElementFromHandle,
  type ResizeDirection,
  translateElements,
  objectsInSelection,
} from "./objectEditing";
import { SlideTable } from "./SlideTable";
import { useEffect, useRef, useState } from "react";
import type { Element, Slide } from "./model";
import { W, H } from "./model";
import { InlineText } from "./InlineText";
export function ElementView({ element: e }: { element: Element }) {
  if (e.type === "chart") return <ChartGraphic element={e} />;
  if (e.type === "table") return <SlideTable element={e} />;
  if (e.type === "text") return <RichTextView element={e} />;
  if (e.type === "image")
    return e.drawing ? <InkObject element={e} /> : <ImageGraphic element={e} />;
  if (e.type === "line") return <LineGraphic element={e} />;
  return <ShapeGraphic element={e} />;
}
export function Canvas({
  slide,
  selected,
  selectedIds,
  selectMultiple = false,
  onSelect,
  onSelectMany,
  selectedInkIndex,
  onSelectInk,
  onChange,
  onChangeMany,
  editable = false,
  zoom = 1,
  touchNavigation = false,
  gestureEpoch = 0,
  onTextController,
  onUndo,
  onRedo,
  cellSelection,
  onCellSelection,
  cellRangeMode = false,
  onOpenLink,
}: {
  slide: Slide;
  selected?: string;
  selectedIds?: string[];
  selectMultiple?: boolean;
  onSelect?: (id?: string, additive?: boolean, inside?: boolean) => void;
  onSelectMany?: (ids: string[]) => void;
  selectedInkIndex?: number;
  onSelectInk?: (index?: number) => void;
  onChange?: (e: Element) => void;
  onChangeMany?: (elements: Element[]) => void;
  editable?: boolean;
  zoom?: number;
  touchNavigation?: boolean;
  gestureEpoch?: number;
  onTextController?: (controller?: TextController) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  cellSelection?: CellSelection;
  onCellSelection?: (selection: CellSelection) => void;
  cellRangeMode?: boolean;
  onOpenLink?: (slideId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drafts, setDrafts] = useState<Element[]>([]);
  const activeIds = selectedIds ?? (selected ? [selected] : []);
  const [editingId, setEditingId] = useState<string>();
  const previousSelection = useRef(selected);
  useEffect(() => {
    if (!editable) return;
    if (selected !== previousSelection.current) {
      const element = slide.elements.find((e) => e.id === selected);
      setEditingId((current) =>
        current === selected
          ? current
          : !marquee.current &&
              activeIds.length <= 1 &&
              element?.type === "text" &&
              element.text === "ここにことばを入力"
            ? element.id
            : undefined,
      );
      previousSelection.current = selected;
    }
    if (editingId && !slide.elements.some((e) => e.id === editingId))
      setEditingId(undefined);
  }, [selected, slide.id, slide.elements, editable, editingId]);
  const [selectionBox, setSelectionBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  }>();
  const marquee = useRef<{
    pointerId: number;
    start: { x: number; y: number };
    base: string[];
    previous: string[];
    slideId: string;
  } | null>(null);
  function selectionPoint(event: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(W, ((event.clientX - r.left) * W) / r.width)),
      y: Math.max(0, Math.min(H, ((event.clientY - r.top) * H) / r.height)),
    };
  }
  function updateSelection(event: React.PointerEvent) {
    const m = marquee.current;
    if (!m || m.pointerId !== event.pointerId) return false;
    event.preventDefault();
    event.stopPropagation();
    const p = selectionPoint(event),
      box = {
        x: Math.min(m.start.x, p.x),
        y: Math.min(m.start.y, p.y),
        w: Math.abs(m.start.x - p.x),
        h: Math.abs(m.start.y - p.y),
      };
    setSelectionBox(box);
    const ids =
      box.w > 3 || box.h > 3 ? objectsInSelection(slide.elements, box) : [];
    onSelectMany?.([...new Set([...m.base, ...ids])]);
    return true;
  }
  function cancelSelection() {
    const m = marquee.current;
    if (!m) return;
    marquee.current = null;
    setSelectionBox(undefined);
    if (m.slideId === slide.id) onSelectMany?.(m.previous);
    if (ref.current?.hasPointerCapture(m.pointerId))
      ref.current.releasePointerCapture(m.pointerId);
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (document.documentElement.dataset.hostFollow === "active") return;
      if (event.key !== "Escape" || !marquee.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelSelection();
    };
    const blur = () => cancelSelection();
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", blur);
    };
  });
  const [guides, setGuides] = useState({ x: false, y: false });
  const touchTap = useRef<{
    element: Element;
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const drag = useRef<{
    element: Element;
    px: number;
    py: number;
    resize: boolean;
    scale: number;
    allowTyping: boolean;
    group: Element[];
    endpoint?: "start" | "end";
    groupResize?: boolean;
    direction: ResizeDirection;
    aspectLocked: boolean;
  } | null>(null);
  function cancelDrag() {
    cancelSelection();
    drag.current = null;
    touchTap.current = null;
    setDrafts([]);
    setGuides({ x: false, y: false });
  }
  useEffect(() => {
    // A second finger claims navigation, cancelling pending taps and handle drags
    // without unmounting a text editor or interrupting an IME composition.
    cancelDrag();
  }, [gestureEpoch, slide.id, editable]);
  function selectElement(id: string, additive = false, inside = false) {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      ref.current?.contains(active) &&
      active.closest<HTMLElement>(".element")?.dataset.elementId !== id
    )
      active.blur();
    onSelect?.(id, additive, inside);
  }
  function start(
    event: React.PointerEvent,
    element: Element,
    resize = false,
    allowTyping = true,
    endpoint?: "start" | "end",
    groupResize = false,
    direction: ResizeDirection = "se",
  ) {
    if (!editable || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    touchTap.current = null;
    if (
      touchNavigation &&
      event.pointerType === "touch" &&
      !resize &&
      allowTyping
    ) {
      touchTap.current = {
        element,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      return;
    }
    setEditingId(undefined);
    if (!activeIds.includes(element.id)) selectElement(element.id);
    const scale = ref.current!.getBoundingClientRect().width / W;
    drag.current = {
      element,
      px: event.clientX,
      py: event.clientY,
      resize,
      scale,
      allowTyping,
      endpoint,
      groupResize,
      direction,
      aspectLocked: event.shiftKey || !!element.aspectLocked,
      group: endpoint
        ? [element]
        : movableElements(
            slide.elements,
            groupResize || (!resize && activeIds.includes(element.id))
              ? activeIds
              : resize
                ? [element.id]
                : expandGroups(slide.elements, [element.id]),
          ),
    };
    setDrafts(drag.current.group);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: React.PointerEvent) {
    if (updateSelection(event)) return;
    const d = drag.current;
    if (!d) return;
    const dx = (event.clientX - d.px) / d.scale,
      dy = (event.clientY - d.py) / d.scale;
    if (d.endpoint) {
      const box = ref.current!.getBoundingClientRect(),
        x = (event.clientX - box.left) / d.scale,
        y = (event.clientY - box.top) / d.scale;
      const anchor = nearestAnchor(
          slide.elements,
          d.element.id,
          x,
          y,
          18 / d.scale,
        ),
        target = anchor
          ? slide.elements.find((e) => e.id === anchor.elementId)
          : undefined;
      const p = anchor && target ? anchorPoint(target, anchor.side) : { x, y };
      setDrafts([
        {
          ...moveLinePoint(d.element, d.endpoint, p.x, p.y),
          [d.endpoint === "start" ? "startAnchor" : "endAnchor"]: anchor,
        },
      ]);
      return;
    }
    if (d.groupResize) {
      setDrafts(resizeSelectionFromHandle(d.group, d.direction, dx, dy));
      return;
    }
    if (d.resize) {
      setDrafts([
        resizeElementFromHandle(d.element, d.direction, dx, dy, d.aspectLocked),
      ]);
      return;
    }
    const b = elementBounds(d.group);
    const gx = Math.abs(b.x + dx + b.w / 2 - W / 2) < 7,
      gy = Math.abs(b.y + dy + b.h / 2 - H / 2) < 7;
    setGuides({ x: gx, y: gy });
    setDrafts(
      translateElements(
        d.group,
        gx ? W / 2 - b.x - b.w / 2 : dx,
        gy ? H / 2 - b.y - b.h / 2 : dy,
      ),
    );
  }
  function end(event: React.PointerEvent) {
    if (marquee.current?.pointerId === event.pointerId) {
      updateSelection(event);
      marquee.current = null;
      setSelectionBox(undefined);
      if (ref.current?.hasPointerCapture(event.pointerId))
        ref.current.releasePointerCapture(event.pointerId);
      return;
    }
    const tap = touchTap.current;
    touchTap.current = null;
    if (
      tap &&
      tap.pointerId === event.pointerId &&
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 8
    ) {
      if (
        !activeIds.includes(tap.element.id) ||
        activeIds.length <= 1 ||
        !tap.element.groupId
      )
        selectElement(tap.element.id);
      setEditingId(
        (tap.element.type === "text" ||
          (tap.element.type === "shape" && tap.element.text !== undefined)) &&
          activeIds.length <= 1 &&
          (!tap.element.groupId || activeIds.includes(tap.element.id))
          ? tap.element.id
          : undefined,
      );
      return;
    }
    if (drag.current && drafts.length) {
      const d = drag.current;
      const changed = drafts.some((e) => {
        const old = d.group.find((t) => t.id === e.id)!;
        return [
          "x",
          "y",
          "w",
          "h",
          "lineStart",
          "lineEnd",
          "startAnchor",
          "endAnchor",
        ].some(
          (key) =>
            JSON.stringify(old[key as keyof Element]) !==
            JSON.stringify(e[key as keyof Element]),
        );
      });
      if (changed) {
        const values = drafts.map((e) => ({
          ...slide.elements.find((t) => t.id === e.id)!,
          x: e.x,
          y: e.y,
          w: e.w,
          h: e.h,
          ...(e.type === "line"
            ? {
                lineStart: e.lineStart,
                lineEnd: e.lineEnd,
                startAnchor: e.startAnchor,
                endAnchor: e.endAnchor,
              }
            : {}),
        }));
        if (onChangeMany) onChangeMany(values);
        else values.forEach((e) => onChange?.(e));
      } else if (!d.resize && !d.element.groupId && activeIds.length > 1) {
        selectElement(d.element.id);
      } else if (
        (d.element.type === "text" ||
          (d.element.type === "shape" && d.element.text !== undefined)) &&
        !d.resize &&
        d.allowTyping &&
        activeIds.length <= 1
      )
        setEditingId(d.element.id);
    }
    drag.current = null;
    setDrafts([]);
    setGuides({ x: false, y: false });
  }
  const rendered = resolveConnections(
    slide.elements.map((e) => drafts.find((d) => d.id === e.id) ?? e),
  );
  const grouped = rendered.filter((e) => activeIds.includes(e.id));
  const groupBox =
    editable && grouped.length > 1 ? elementBounds(grouped) : undefined;
  return (
    <div className="canvas-scale" style={{ width: W * zoom, height: H * zoom }}>
      <div
        ref={ref}
        data-selection-mode={selectMultiple}
        className={`slide-canvas ${editable ? "editable" : ""}`}
        style={
          {
            background: slide.background,
            transform: `scale(${zoom})`,
            "--canvas-zoom": zoom,
          } as React.CSSProperties
        }
        onPointerDownCapture={(event) => {
          if (!editable) return;
          // Touch browsers can retarget a thin frame to a nearby textarea.
          // Use the physical hit point before that input handles the event.
          const hit = document.elementFromPoint(event.clientX, event.clientY);
          const owner = hit?.closest<HTMLElement>(".element");
          // Chromium may adjust a touch inside an empty table cell onto a
          // nearby native resize button. Route that down through the actual
          // cell so the table keeps its focus/range-selection behavior.
          const nativeHandle = (event.target as HTMLElement).closest(
            ".resize-handle",
          );
          const cell = hit?.closest<HTMLElement>("td,th");
          if (
            event.pointerType === "touch" &&
            nativeHandle &&
            !hit?.closest(".resize-handle") &&
            cell &&
            cell.closest(".slide-table") &&
            ref.current?.contains(cell)
          ) {
            event.preventDefault();
            event.stopPropagation();
            cell.dispatchEvent(
              new PointerEvent("pointerdown", {
                bubbles: true,
                cancelable: true,
                pointerId: event.pointerId,
                pointerType: event.pointerType,
                isPrimary: event.isPrimary,
                button: event.button,
                buttons: event.buttons,
                clientX: event.clientX,
                clientY: event.clientY,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
              }),
            );
            return;
          }
          if (hit?.closest(".resize-handle")) return;
          if (
            (event.ctrlKey || event.metaKey) &&
            owner &&
            rendered.find((e) => e.id === owner.dataset.elementId)?.link
          ) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (
            (selectMultiple ||
              event.shiftKey ||
              event.ctrlKey ||
              event.metaKey) &&
            owner &&
            ref.current?.contains(owner)
          ) {
            event.preventDefault();
            event.stopPropagation();
            setEditingId(undefined);
            selectElement(owner.dataset.elementId!, true);
            return;
          }
          if (
            event.button === 0 &&
            event.pointerType === "mouse" &&
            !owner &&
            onSelectMany &&
            ref.current?.contains(hit) &&
            !hit?.closest(
              "button,input,textarea,[contenteditable],.resize-handle",
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
            setEditingId(undefined);
            const active = document.activeElement;
            if (active instanceof HTMLElement && ref.current.contains(active))
              active.blur();
            const base =
              event.shiftKey || event.ctrlKey || event.metaKey
                ? [...activeIds]
                : [];
            marquee.current = {
              pointerId: event.pointerId,
              start: selectionPoint(event),
              base,
              previous: [...activeIds],
              slideId: slide.id,
            };
            setSelectionBox(undefined);
            onSelectMany(base);
            ref.current.setPointerCapture(event.pointerId);
            return;
          }
          const border = hit?.closest<HTMLElement>(".element-drag-border");
          if (!border || !ref.current?.contains(border)) return;
          const element = resolveConnections(slide.elements).find(
            (e) => e.id === border.dataset.elementId,
          );
          if (element) start(event, element, false, false);
        }}
        onPointerDown={() => onSelect?.()}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={() => {
          if (marquee.current) cancelSelection();
        }}
      >
        {rendered.map((e, layer) => {
          const quarter = (e.rotation ?? 0) % 180 !== 0,
            vw = quarter ? e.h : e.w,
            vh = quarter ? e.w : e.h;
          // Contain controls within their object, using the saved array order.
          return (
            <div
              key={e.id}
              data-element-id={e.id}
              data-object-link={!!e.link}
              className={`element ${editable && activeIds.includes(e.id) ? "selected-element" : ""} ${editingId === e.id ? "editing-element" : ""}`}
              tabIndex={editable ? 0 : undefined}
              aria-label={
                editable && (e.type === "text" || e.type === "shape")
                  ? "テキストボックス"
                  : undefined
              }
              onDoubleClick={(event) => {
                if (event.shiftKey || event.ctrlKey || event.metaKey) return;
                if (
                  editable &&
                  (e.groupId || e.type === "text" || e.type === "shape")
                ) {
                  event.stopPropagation();
                  selectElement(e.id, false, true);
                  setEditingId(
                    e.type === "text" || e.type === "shape" ? e.id : undefined,
                  );
                }
              }}
              onKeyDown={(event) => {
                if (
                  editable &&
                  (e.groupId || e.type === "text" || e.type === "shape") &&
                  ["Enter", "F2"].includes(event.key)
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  selectElement(e.id, false, true);
                  setEditingId(
                    e.type === "text" || e.type === "shape" ? e.id : undefined,
                  );
                }
              }}
              style={
                {
                  "--resize-limit-x": `${e.w / 2}px`,
                  "--resize-limit-y": `${e.h / 2}px`,
                  left: e.x,
                  top: e.y,
                  width: e.w,
                  height: e.h,
                  zIndex: layer,
                } as React.CSSProperties
              }
              onPointerDown={(event) => {
                if (e.link && (!editable || event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                start(event, e);
              }}
              onClickCapture={(event) => {
                if (
                  !e.link ||
                  !onOpenLink ||
                  (editable && !event.ctrlKey && !event.metaKey)
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
                if (e.link.url)
                  window.open(e.link.url, "_blank", "noopener,noreferrer");
                else if (e.link.slideId) onOpenLink(e.link.slideId);
              }}
            >
              <div
                className="element-visual"
                style={{
                  width: vw,
                  height: vh,
                  left: (e.w - vw) / 2,
                  top: (e.h - vh) / 2,
                  transform: `rotate(${e.rotation ?? 0}deg) scale(${e.flipX ? -1 : 1},${e.flipY ? -1 : 1})`,
                  opacity: e.opacity ?? 1,
                }}
              >
                {e.drawing ? (
                  <InkObject
                    element={e}
                    selectedIndex={
                      activeIds.includes(e.id) ? selectedInkIndex : undefined
                    }
                    onSelect={onSelectInk}
                    editable={editable && selected === e.id}
                    onChange={onChange}
                  />
                ) : e.type === "table" ? (
                  <SlideTable
                    element={e}
                    editable={editable}
                    onSelect={() => selectElement(e.id, false, true)}
                    onChange={onChange}
                    onMoveStart={(event) => start(event, e, false, false)}
                    selectedCells={
                      cellSelection?.id === e.id ? cellSelection.keys : []
                    }
                    onSelectCells={(keys) =>
                      onCellSelection?.({ id: e.id, keys })
                    }
                    rangeMode={cellRangeMode}
                  />
                ) : e.type === "text" ||
                  (e.type === "shape" && e.text !== undefined) ? (
                  <>
                    {e.type === "shape" && <ShapeGraphic element={e} />}
                    <div
                      className={`text-layout ${e.type === "shape" ? "shape-label" : ""}`}
                      data-vertical-align={e.verticalAlign ?? "top"}
                      data-writing-mode={e.writingMode ?? "horizontal-tb"}
                      style={{
                        fontSize: e.fontSize,
                        fontWeight: e.bold ? 700 : 400,
                        color: e.color,
                        background: e.highlight,
                        textAlign: e.textAlign ?? "left",
                        writingMode: e.writingMode ?? "horizontal-tb",
                      }}
                    >
                      {editable && editingId === e.id ? (
                        <InlineText
                          key={e.id}
                          element={e}
                          onChange={(patch) => onChange?.({ ...e, ...patch })}
                          onController={onTextController}
                          onUndo={onUndo}
                          onRedo={onRedo}
                          onFinish={() => setEditingId(undefined)}
                        />
                      ) : (
                        <ElementView element={{ ...e, type: "text" }} />
                      )}
                    </div>
                  </>
                ) : (
                  <ElementView element={e} />
                )}
              </div>
              {editable &&
                selected === e.id &&
                activeIds.length <= 1 &&
                e.type === "line" &&
                (["start", "end"] as const).map((endpoint) => {
                  const p = linePoint(e, endpoint);
                  return (
                    <button
                      key={endpoint}
                      className="line-endpoint"
                      style={{ left: `${p.x}%`, top: `${p.y}%` }}
                      aria-label={
                        endpoint === "start"
                          ? "線の始点を移動"
                          : "線の終点を移動"
                      }
                      onPointerDown={(event) =>
                        start(event, e, false, false, endpoint)
                      }
                    />
                  );
                })}
              {editable &&
                (["top", "right", "bottom", "left"] as const).map((edge) => (
                  <span
                    key={edge}
                    className={`element-drag-border border-${edge}`}
                    data-element-id={e.id}
                    aria-hidden="true"
                    title="枠をドラッグして移動"
                    onPointerDown={(event) => start(event, e, false, false)}
                  />
                ))}
              {editable &&
                selected === e.id &&
                activeIds.length <= 1 &&
                e.type !== "line" && (
                  <ResizeFrame
                    onStart={(event, direction) =>
                      start(
                        event,
                        e,
                        !event.altKey,
                        false,
                        undefined,
                        false,
                        direction,
                      )
                    }
                  />
                )}
            </div>
          );
        })}
        {groupBox && (
          <div
            className="group-selection-box"
            style={
              {
                "--resize-limit-x": `${groupBox.w / 2}px`,
                "--resize-limit-y": `${groupBox.h / 2}px`,
                left: groupBox.x,
                top: groupBox.y,
                width: groupBox.w,
                height: groupBox.h,
              } as React.CSSProperties
            }
          >
            <ResizeFrame
              group
              onStart={(event, direction) =>
                start(
                  event,
                  grouped[0],
                  !event.altKey,
                  false,
                  undefined,
                  !event.altKey,
                  direction,
                )
              }
            />
          </div>
        )}
        {selectionBox && (
          <div
            className="object-marquee"
            aria-hidden="true"
            style={{
              left: selectionBox.x,
              top: selectionBox.y,
              width: selectionBox.w,
              height: selectionBox.h,
            }}
          />
        )}
        {guides.x && <div className="guide vertical" />}
        {guides.y && <div className="guide horizontal" />}
      </div>
    </div>
  );
}

const resizeDirections: { direction: ResizeDirection; label: string }[] = [
  { direction: "n", label: "上" },
  { direction: "ne", label: "右上" },
  { direction: "e", label: "右" },
  { direction: "se", label: "右下" },
  { direction: "s", label: "下" },
  { direction: "sw", label: "左下" },
  { direction: "w", label: "左" },
  { direction: "nw", label: "左上" },
];
function ResizeFrame({
  group = false,
  onStart,
}: {
  group?: boolean;
  onStart: (event: React.PointerEvent, direction: ResizeDirection) => void;
}) {
  return (
    <>
      {resizeDirections.map(({ direction, label }) => (
        <button
          key={direction}
          type="button"
          className={`resize-handle resize-${direction.length === 1 ? "edge" : "corner"} resize-${direction}${group ? " group-resize" : ""}`}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          data-resize-direction={direction}
          aria-label={
            direction === "se"
              ? group
                ? "選択全体のサイズを変更"
                : "要素のサイズを変更"
              : `${group ? "選択全体" : "要素"}の${label}の枠でサイズを変更`
          }
          title={`${label}の枠をドラッグしてサイズ変更（Altキーで移動）`}
          onPointerDown={(event) => onStart(event, direction)}
        />
      ))}
    </>
  );
}
