import { ChartGraphic } from "./ChartGraphic";
import {
  resolveConnections,
  expandGroups,
  movableElements,
  nearestAnchor,
  anchorPoint,
} from "./structureData";
import { resizeSelection } from "./structuredEditing";
import { Link2 } from "lucide-react";
import { RichTextView } from "./RichTextView";
import { ImageGraphic } from "./ImageTools";
import type { TextController } from "./TextSelectionControls";
import type { CellSelection } from "./TableCellControls";
import { ShapeGraphic, LineGraphic } from "./ObjectGraphics";
import {
  elementBounds,
  linePoint,
  moveLinePoint,
  resizeElement,
  translateElements,
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
  if (e.type === "image") return <ImageGraphic element={e} />;
  if (e.type === "line") return <LineGraphic element={e} />;
  return <ShapeGraphic element={e} />;
}
export function Canvas({
  slide,
  selected,
  selectedIds,
  selectMultiple = false,
  onSelect,
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
          : element?.type === "text" && element.text === "ここにことばを入力"
            ? element.id
            : undefined,
      );
      previousSelection.current = selected;
    }
    if (editingId && !slide.elements.some((e) => e.id === editingId))
      setEditingId(undefined);
  }, [selected, slide.id, slide.elements, editable, editingId]);
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
  } | null>(null);
  function cancelDrag() {
    drag.current = null;
    touchTap.current = null;
    setDrafts([]);
    setGuides({ x: false, y: false });
  }
  useEffect(() => {
    // A second finger claims navigation, cancelling pending taps and handle drags
    // without unmounting a text editor or interrupting an IME composition.
    cancelDrag();
  }, [gestureEpoch]);
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
      const b = elementBounds(d.group);
      setDrafts(resizeSelection(d.group, b.w + dx, b.h + dy));
      return;
    }
    if (d.resize) {
      setDrafts([resizeElement(d.element, d.element.w + dx, d.element.h + dy)]);
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
              className={`element ${editable && activeIds.includes(e.id) ? "selected-element" : ""} ${editingId === e.id ? "editing-element" : ""}`}
              tabIndex={editable ? 0 : undefined}
              aria-label={
                editable && (e.type === "text" || e.type === "shape")
                  ? "テキストボックス"
                  : undefined
              }
              onDoubleClick={(event) => {
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
              style={{
                left: e.x,
                top: e.y,
                width: e.w,
                height: e.h,
                zIndex: layer,
              }}
              onPointerDown={(event) => start(event, e)}
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
                {e.type === "table" ? (
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
                      style={{
                        fontSize: e.fontSize,
                        fontWeight: e.bold ? 700 : 400,
                        color: e.color,
                        background: e.highlight,
                        textAlign: e.textAlign ?? "left",
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
              {e.link &&
                (onOpenLink ? (
                  <button
                    className="canvas-object-link"
                    aria-label="リンク先のページへ"
                    title="リンク先のページへ"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenLink(e.link!.slideId);
                    }}
                  >
                    <Link2 size={16} />
                    <span>リンク先へ</span>
                  </button>
                ) : (
                  <span className="canvas-link-mark" aria-hidden="true">
                    <Link2 size={16} />
                  </span>
                ))}
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
                  <button
                    aria-label="要素のサイズを変更"
                    className="resize-handle"
                    onPointerDown={(event) => start(event, e, true)}
                  />
                )}
            </div>
          );
        })}
        {groupBox && (
          <div
            className="group-selection-box"
            style={{
              left: groupBox.x,
              top: groupBox.y,
              width: groupBox.w,
              height: groupBox.h,
            }}
          >
            <button
              className="resize-handle group-resize"
              aria-label="選択全体のサイズを変更"
              onPointerDown={(event) =>
                start(event, grouped[0], true, false, undefined, true)
              }
            />
          </div>
        )}
        {guides.x && <div className="guide vertical" />}
        {guides.y && <div className="guide horizontal" />}
      </div>
    </div>
  );
}
