import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Grid2X2,
  PanelsTopLeft,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import type { Deck, Slide } from "./model";
import { bounds, W, rowPage } from "./model";
import { ThumbnailFooter } from "./ThumbnailFooter";
import { Canvas } from "./Canvas";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from "@dnd-kit/core";
import type {
  DragEndEvent,
  DragOverEvent,
  CollisionDetection,
} from "@dnd-kit/core";
import {
  RailRowFrame,
  PageDragFrame,
  PageInsertDrop,
  RowInsertDrop,
  NewRowDrop,
} from "./RailDrag";
import type { RailDragSource, RailDropTarget } from "./RailDrag";
import type { OpenThumbnailMenu } from "./ThumbnailMenu";
import {
  clampRailScale,
  MIN_RAIL_SCALE,
  MAX_RAIL_SCALE,
} from "./workspacePreferences";

interface SlideRailProps {
  filtered?: boolean;
  footerLabel: (slide: Slide) => string;
  footerEditable: (slide: Slide) => boolean;
  onFooterChange: (id: string, text: string) => void;
  numbers: boolean;
  onToggleNumbers: () => void;
  scale: number;
  onScale: (scale: number) => void;
  deck: Deck;
  slide: Slide;
  onSelectSlide: (id: string) => void;
  onInsert: (axis: "row" | "column", index: number, cross: number) => boolean;
  onCreate: (x: number, y: number) => boolean;
  onMove: (
    source: RailDragSource,
    x: number,
    y: number,
    mode?: "swap" | "insert",
  ) => boolean;
  onNavigate: (dx: number, dy: number) => Slide | undefined;
  onOpenMenu: OpenThumbnailMenu;
  menuOpen: boolean;
}

/** A resizable column, with a temporary horizontal view of each grid row. */
export function SlideRail({
  filtered = false,
  footerLabel,
  footerEditable,
  onFooterChange,
  numbers,
  onToggleNumbers,
  scale,
  onScale,
  deck,
  slide,
  onSelectSlide,
  onInsert,
  onCreate,
  onMove,
  onNavigate,
  onOpenMenu,
  menuOpen,
}: SlideRailProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 16 },
      bypassActivationConstraint: ({ event }) =>
        !!(event.target as Element).closest("[data-touch-drag-handle]"),
    }),
  );
  const [dragging, setDragging] = useState<RailDragSource | null>(null);
  const draggingRef = useRef<RailDragSource | null>(null);
  const navigationStarted = useRef(false);
  const [insertTarget, setInsertTarget] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [rowInsertTarget, setRowInsertTarget] = useState<number | null>(null);
  const collision: CollisionDetection = (args) => {
    // Keep the newly opened part of the gap an insertion target as well.
    const droppableRects = new Map(args.droppableRects);
    if (insertTarget) {
      const id = `insert-${insertTarget.x}-${insertTarget.y}`;
      const rect = droppableRects.get(id);
      if (rect)
        droppableRects.set(id, {
          ...rect,
          right: rect.right + 16,
          width: rect.width + 16,
        });
    }
    if (rowInsertTarget !== null) {
      const id = `row-insert-${rowInsertTarget}`;
      const rect = droppableRects.get(id);
      if (rect)
        droppableRects.set(id, {
          ...rect,
          bottom: rect.bottom + 16,
          height: rect.height + 16,
        });
    }
    const hits = pointerWithin({
      ...args,
      droppableRects,
      droppableContainers: args.droppableContainers.filter((container) =>
        args.active.data.current?.kind === "row"
          ? ["row", "row-insert"].includes(container.data.current?.kind)
          : container.data.current?.kind !== "row-insert",
      ),
    });
    // Gaps overlap the fixed card hit boxes, so prefer an explicit insert target.
    const isInsert = (id: string | number) =>
      ["insert", "row-insert"].includes(
        args.droppableContainers.find((d) => d.id === id)?.data.current?.kind,
      );
    return hits.sort((a, b) => Number(isInsert(b.id)) - Number(isInsert(a.id)));
  };
  const { rows, cols } = bounds(deck);
  const rowIndexes = filtered
    ? [...new Set(deck.slides.map((s) => s.y))].sort((a, b) => a - b)
    : Array.from({ length: rows }, (_, y) => y);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [position, setPosition] = useState({ left: 180, top: 220, width: 720 });
  const [thumbWidth, setThumbWidth] = useState(140);
  const railRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLSpanElement>(null);
  const [draftScale, setDraftScale] = useState<number>();
  const resizeDrag = useRef<{
    id: number;
    x: number;
    scale: number;
    baseWidth: number;
    next: number;
  }>(undefined);
  const displayedScale = draftScale ?? scale;
  const scrollRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggers = useRef(new Map<number, HTMLButtonElement>());
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const pointer = useRef("");
  const focusPopup = useRef(false);
  const suppressFocus = useRef(false);
  const cells = new Map(deck.slides.map((s) => [`${s.x},${s.y}`, s]));

  function cancelTimers() {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }
  function close(restoreFocus = false) {
    cancelTimers();
    setOpenRow(null);
    if (restoreFocus && openRow !== null) {
      suppressFocus.current = true;
      triggers.current.get(openRow)?.focus({ preventScroll: true });
    }
  }
  function focusSelectedPage() {
    const selected = popupRef.current?.querySelector<HTMLButtonElement>(
      '[aria-current="page"]',
    );
    const first =
      popupRef.current?.querySelector<HTMLButtonElement>(".row-page");
    (selected ?? first)?.focus({ preventScroll: true });
  }
  function show(y: number, keyboard = false) {
    cancelTimers();
    const rail = railRef.current?.getBoundingClientRect();
    const trigger = triggers.current.get(y)?.getBoundingClientRect();
    if (!rail || !trigger) return;
    setPosition({
      left: rail.right,
      top: Math.max(8, Math.min(trigger.top, window.innerHeight - 210)),
      width: Math.min(
        860,
        window.innerWidth - rail.right - 12,
        cols * 186 + 28,
      ),
    });
    focusPopup.current = keyboard;
    setOpenRow(y);
    if (keyboard) requestAnimationFrame(focusSelectedPage);
  }
  function hover(y: number) {
    if (draggingRef.current || resizeDrag.current || menuOpen) return;
    cancelTimers();
    openTimer.current = setTimeout(() => show(y), 180);
  }
  function delayClose() {
    if (draggingRef.current || menuOpen) return;
    cancelTimers();
    closeTimer.current = setTimeout(() => setOpenRow(null), 330);
  }
  function insert(axis: "row" | "column", index: number, cross: number) {
    if (onInsert(axis, index, cross)) close();
  }

  function select(id: string) {
    navigationStarted.current = true;
    onSelectSlide(id);
  }
  function arrow(event: React.KeyboardEvent, fromPopup = false) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return false;
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (!steps[event.key] || (!fromPopup && !navigationStarted.current))
      return false;
    event.preventDefault();
    event.stopPropagation();
    const next = onNavigate(...steps[event.key]);
    if (next) show(next.y, true);
    return true;
  }
  function over(event: DragOverEvent) {
    clearTimeout(openTimer.current);
    const target = event.over?.data.current as RailDropTarget | undefined;
    setInsertTarget(target?.kind === "insert" ? target : null);
    setRowInsertTarget(target?.kind === "row-insert" ? target.y : null);
    if (
      draggingRef.current?.kind === "page" &&
      target?.kind === "row" &&
      target.y < rows &&
      target.y !== openRow
    )
      openTimer.current = setTimeout(() => show(target.y), 250);
  }
  function endDrag(event: DragEndEvent) {
    const source = draggingRef.current,
      target = event.over?.data.current as RailDropTarget | undefined;
    draggingRef.current = null;
    setDragging(null);
    setInsertTarget(null);
    setRowInsertTarget(null);
    cancelTimers();
    if (source && target)
      onMove(
        source,
        target.x,
        target.y,
        target.kind === "insert" || target.kind === "row-insert"
          ? "insert"
          : "swap",
      );
    close();
  }
  useEffect(() => () => cancelTimers(), []);
  useEffect(() => {
    if (menuOpen) cancelTimers();
  }, [menuOpen]);
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const observer = new ResizeObserver(([entry]) =>
      setThumbWidth(entry.contentRect.width),
    );
    observer.observe(preview);
    return () => observer.disconnect();
  }, [filtered, rowIndexes[0], numbers]);
  function finishResize(event: PointerEvent<HTMLDivElement>, cancel = false) {
    const drag = resizeDrag.current;
    if (!drag || event.pointerId !== drag.id) return;
    resizeDrag.current = undefined;
    setDraftScale(undefined);
    if (!cancel) onScale(drag.next);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  useEffect(() => {
    // Scroll this pane only; never move the canvas or the document to reveal a page.
    const node = triggers.current.get(slide.y),
      pane = scrollRef.current;
    if (!node || !pane) return;
    const item = node.getBoundingClientRect(),
      viewport = pane.getBoundingClientRect();
    if (item.top < viewport.top) pane.scrollTop -= viewport.top - item.top;
    else if (item.bottom > viewport.bottom)
      pane.scrollTop += item.bottom - viewport.bottom;
  }, [slide.id, slide.y, numbers]);
  useEffect(() => {
    if (openRow === null) return;
    if (
      openRow >= rows ||
      (filtered && !deck.slides.some((s) => s.y === openRow))
    ) {
      close();
      return;
    }
    const selected = popupRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    const pane =
      popupRef.current?.querySelector<HTMLElement>(".row-page-scroll");
    if (selected && pane) {
      const item = selected.getBoundingClientRect(),
        viewport = pane.getBoundingClientRect();
      if (item.left < viewport.left)
        pane.scrollLeft -= viewport.left - item.left;
      else if (item.right > viewport.right)
        pane.scrollLeft += item.right - viewport.right;
    }
    if (focusPopup.current) {
      focusSelectedPage();
      focusPopup.current = false;
    }
    function outside(event: Event) {
      const target = event.target as Node;
      if ((target as HTMLElement).closest?.(".thumbnail-menu")) return;
      if (
        !railRef.current?.contains(target) &&
        !popupRef.current?.contains(target)
      )
        close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (draggingRef.current || menuOpen) return;
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    }
    const resize = () => close();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", resize);
    };
  }, [openRow, rows, slide.id, menuOpen]);

  return (
    <DndContext
      sensors={sensors}
      autoScroll={{
        canScroll: (element) =>
          element.classList.contains("rail-scroll") ||
          element.classList.contains("row-page-scroll"),
      }}
      collisionDetection={collision}
      onDragStart={(event) => {
        cancelTimers();
        const source = event.active.data.current as RailDragSource;
        draggingRef.current = source;
        setDragging(source);
      }}
      onDragOver={over}
      onDragEnd={endDrag}
      onDragCancel={() => {
        draggingRef.current = null;
        setDragging(null);
        setInsertTarget(null);
        setRowInsertTarget(null);
        close(true);
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "サムネイルはドラッグで移動できます。左のサムネイルは段ごと、横一覧は1枚ずつ移動します。",
        },
      }}
    >
      <aside
        className="slide-rail two-d-rail"
        id="editor-thumbnails"
        style={{ "--rail-scale": displayedScale / 100 } as CSSProperties}
        data-resizing={draftScale !== undefined}
        ref={railRef}
        aria-label="縦横のページ一覧"
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") delayClose();
        }}
      >
        <div className="rail-heading">
          <strong>ページ一覧</strong>
          <button
            className="rail-view-toggle"
            aria-label="行番号一覧"
            aria-pressed={numbers}
            title={numbers ? "サムネイル一覧に戻す" : "行番号一覧に切り替え"}
            disabled={!!dragging}
            onClick={() => {
              close();
              onToggleNumbers();
            }}
          >
            {numbers ? <PanelsTopLeft size={13} /> : <Grid2X2 size={13} />}
            {numbers ? "サムネイル" : "行番号一覧"}
          </button>
        </div>
        <div
          className="rail-scroll"
          ref={scrollRef}
          onScroll={() => {
            if (draggingRef.current || openRow === null) return;
            const trigger = triggers.current
              .get(openRow)
              ?.getBoundingClientRect();
            const viewport = scrollRef.current?.getBoundingClientRect();
            // Selecting a distant row can scroll this pane automatically. Keep
            // its flyout aligned while the row is visible, including that scroll.
            if (
              trigger &&
              viewport &&
              trigger.bottom > viewport.top &&
              trigger.top < viewport.bottom
            )
              show(openRow);
            else close();
          }}
        >
          {numbers ? (
            <div
              className="rail-number-grid"
              aria-label="行番号一覧からジャンプ"
            >
              {rowIndexes.map((y) => {
                const cell =
                  rowPage(deck, y, slide.x) ??
                  deck.slides.find((s) => s.y === y);
                return (
                  <button
                    key={y}
                    ref={(node) => {
                      if (node) triggers.current.set(y, node);
                      else triggers.current.delete(y);
                    }}
                    className="rail-row-number"
                    aria-label={`${y + 1}行目へ移動`}
                    aria-current={slide.y === y ? "page" : undefined}
                    title={`${y + 1}行目${cell ? `：${cell.title}` : "（空の行）"}`}
                    disabled={!cell}
                    onClick={() => {
                      if (cell) select(cell.id);
                    }}
                    onKeyDown={(event) => {
                      if (arrow(event)) return;
                      if (event.key === "ArrowRight") {
                        event.preventDefault();
                        show(y, true);
                      }
                    }}
                  >
                    {y + 1}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              {!filtered && (
                <RowInsertDrop y={0} active={dragging?.kind === "row"} />
              )}
              {rowIndexes.map((y) => {
                const cell =
                  rowPage(deck, y, slide.x) ??
                  (filtered ? deck.slides.find((s) => s.y === y) : undefined);
                return (
                  <RailRowFrame
                    x={cell?.x ?? 0}
                    y={y}
                    hasPages={!filtered && deck.slides.some((s) => s.y === y)}
                    shifted={rowInsertTarget !== null && y >= rowInsertTarget}
                    key={y}
                    onPointerEnter={(e) => {
                      if (e.pointerType === "mouse") hover(y);
                    }}
                    onPointerLeave={(e) => {
                      if (e.pointerType === "mouse") delayClose();
                    }}
                  >
                    {(dragProps) => (
                      <>
                        <button
                          {...dragProps}
                          ref={(node) => {
                            if (node) triggers.current.set(y, node);
                            else triggers.current.delete(y);
                          }}
                          className={`rail-trigger ${slide.y === y ? "rail-active" : ""}`}
                          aria-label={`${y + 1}段目の横のページをひらく`}
                          aria-expanded={openRow === y}
                          aria-controls={
                            openRow === y ? "editor-row-pages" : undefined
                          }
                          onContextMenu={(event) => {
                            if (
                              pointer.current === "touch" ||
                              draggingRef.current
                            ) {
                              event.preventDefault();
                              return;
                            }
                            cancelTimers();
                            onOpenMenu(event, {
                              pageId: cell?.id,
                              ...(filtered ? {} : { row: y }),
                            });
                          }}
                          onPointerDown={(e) => {
                            pointer.current = e.pointerType;
                          }}
                          onFocus={(e) => {
                            if (suppressFocus.current) {
                              suppressFocus.current = false;
                              return;
                            }
                            if (e.currentTarget.matches(":focus-visible"))
                              show(y);
                          }}
                          onKeyDown={(e) => {
                            if (arrow(e)) return;
                            if (["ArrowRight", "Enter", " "].includes(e.key)) {
                              e.preventDefault();
                              show(y, true);
                            }
                          }}
                          onClick={() => {
                            show(y);
                            if (pointer.current === "mouse" && cell)
                              select(cell.id);
                          }}
                        >
                          <span className="rail-coordinate">
                            <span>
                              {y + 1}.{cell ? cell.x + 1 : "—"}
                            </span>
                            {!filtered && (
                              <span
                                className="rail-drag-hint"
                                data-touch-drag-handle
                                title="ここをドラッグで段ごと移動"
                              >
                                <GripVertical size={11} />
                                <ChevronRight size={13} />
                              </span>
                            )}
                          </span>
                          <span
                            className="rail-preview"
                            ref={y === rowIndexes[0] ? previewRef : undefined}
                          >
                            {cell ? (
                              <Canvas slide={cell} zoom={thumbWidth / W} />
                            ) : (
                              <span className="rail-empty">空のマス</span>
                            )}
                          </span>
                          <span
                            className="rail-page-title"
                            aria-hidden={!!cell}
                            style={cell ? { visibility: "hidden" } : undefined}
                          >
                            {cell ? footerLabel(cell) : "横のページを確認"}
                          </span>
                        </button>
                        {cell && (
                          <div className="rail-footer-editor">
                            <ThumbnailFooter
                              slide={cell}
                              label={footerLabel(cell)}
                              editable={footerEditable(cell)}
                              onChange={onFooterChange}
                            />
                          </div>
                        )}
                        <button
                          className="thumbnail-more rail-more"
                          aria-label={`${y + 1}段目のメニュー`}
                          title="ページ・段の複製や削除"
                          onClick={(event) => {
                            cancelTimers();
                            onOpenMenu(event, {
                              pageId: cell?.id,
                              ...(filtered ? {} : { row: y }),
                            });
                          }}
                        >
                          <MoreHorizontal size={15} />
                        </button>
                        {!filtered && (
                          <RowInsertDrop
                            y={y + 1}
                            active={dragging?.kind === "row"}
                          >
                            <button
                              className="rail-insert-row"
                              aria-label={`${y + 1}段目の下に行を挿入`}
                              title="ここに詳しい段を追加"
                              onClick={() => insert("row", y + 1, cell?.x ?? 0)}
                            >
                              <span />
                              <Plus size={15} />
                              <span />
                            </button>
                          </RowInsertDrop>
                        )}
                      </>
                    )}
                  </RailRowFrame>
                );
              })}
              {!filtered &&
                dragging &&
                (dragging.kind === "row" || rows < 100) && (
                  <NewRowDrop
                    group={dragging.kind === "row"}
                    x={
                      dragging.kind === "page"
                        ? (deck.slides.find((s) => s.id === dragging.id)?.x ??
                          slide.x)
                        : slide.x
                    }
                    y={rows}
                  />
                )}
            </>
          )}
        </div>
        <div className="rail-footnote">
          {numbers
            ? filtered
              ? "対象の行番号を押して移動"
              : "行番号を押して移動"
            : filtered
              ? "フィルタしたページを表示中"
              : "段ごと移動 ↕ · 重ねて入れ替え · 間に挿入"}
        </div>
        <div
          className="rail-resize-handle"
          role="separator"
          tabIndex={0}
          aria-label="サムネイルバーの幅"
          aria-orientation="vertical"
          aria-controls="editor-thumbnails"
          aria-valuemin={MIN_RAIL_SCALE}
          aria-valuemax={MAX_RAIL_SCALE}
          aria-valuenow={displayedScale}
          aria-valuetext={`${displayedScale}%`}
          title={`幅 ${displayedScale}%：ドラッグで変更・ダブルクリックで100%に戻す`}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0 || draggingRef.current)
              return;
            event.preventDefault();
            event.stopPropagation();
            close();
            event.currentTarget.focus({ preventScroll: true });
            resizeDrag.current = {
              id: event.pointerId,
              x: event.clientX,
              scale,
              baseWidth:
                railRef.current!.getBoundingClientRect().width / (scale / 100),
              next: scale,
            };
            setDraftScale(scale);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = resizeDrag.current;
            if (!drag || event.pointerId !== drag.id) return;
            drag.next = clampRailScale(
              drag.scale + ((event.clientX - drag.x) / drag.baseWidth) * 100,
            );
            setDraftScale(drag.next);
          }}
          onPointerUp={finishResize}
          onPointerCancel={(event) => finishResize(event, true)}
          onLostPointerCapture={(event) => finishResize(event)}
          onDoubleClick={() => onScale(100)}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowLeft"
                ? displayedScale - 5
                : event.key === "ArrowRight"
                  ? displayedScale + 5
                  : event.key === "Home"
                    ? MIN_RAIL_SCALE
                    : event.key === "End"
                      ? MAX_RAIL_SCALE
                      : undefined;
            if (next === undefined) return;
            event.preventDefault();
            event.stopPropagation();
            close();
            onScale(clampRailScale(next));
          }}
        />
      </aside>
      {openRow !== null &&
        createPortal(
          <div
            ref={popupRef}
            id="editor-row-pages"
            role="region"
            aria-label={`${openRow + 1}段目の横のページ一覧`}
            className="row-flyout"
            style={position}
            onPointerEnter={(e) => {
              // Compatibility mouse events during a touch drag must not cancel
              // the timer that opens its destination row.
              if (e.pointerType === "mouse" && !draggingRef.current)
                cancelTimers();
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") delayClose();
            }}
          >
            <div className="row-flyout-heading">
              <div>
                <strong>{openRow + 1}段目</strong>
                <span>
                  次の話題へ <ArrowRight size={13} />
                </span>
              </div>
              <button
                className="icon-button"
                aria-label="横のページ一覧を閉じる"
                onClick={() => close(true)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="row-page-scroll">
              <div className="row-page-items">
                {!filtered && (
                  <PageInsertDrop
                    x={0}
                    y={openRow}
                    active={dragging?.kind === "page"}
                  />
                )}
                {(filtered
                  ? deck.slides
                      .filter((s) => s.y === openRow)
                      .map((s) => s.x)
                      .sort((a, b) => a - b)
                  : Array.from({ length: cols }, (_, x) => x)
                ).map((x) => {
                  const cell = cells.get(`${x},${openRow}`);
                  return (
                    <PageDragFrame
                      key={x}
                      x={x}
                      y={openRow}
                      page={filtered ? undefined : cell}
                      shifted={
                        insertTarget?.y === openRow && x >= insertTarget.x
                      }
                    >
                      {(dragProps, ref) => (
                        <>
                          <button
                            {...dragProps}
                            ref={ref}
                            onKeyDown={(e) => arrow(e, true)}
                            className={`row-page ${cell?.id === slide.id ? "row-page-active" : ""} ${!cell ? "row-page-empty" : ""}`}
                            aria-current={
                              cell?.id === slide.id ? "page" : undefined
                            }
                            onContextMenu={(event) => {
                              if (
                                pointer.current === "touch" ||
                                draggingRef.current
                              ) {
                                event.preventDefault();
                                return;
                              }
                              if (!cell) return;
                              cancelTimers();
                              onOpenMenu(event, { pageId: cell.id });
                            }}
                            aria-label={
                              cell
                                ? `${openRow + 1}.${x + 1} ${cell.title}を編集`
                                : `${openRow + 1}.${x + 1}の空のマスにページを追加`
                            }
                            onPointerDown={(event) => {
                              pointer.current = event.pointerType;
                            }}
                            onClick={() => {
                              if (cell) select(cell.id);
                              else if (onCreate(x, openRow)) close();
                            }}
                          >
                            <span className="row-page-image">
                              {cell ? (
                                <Canvas slide={cell} zoom={140 / W} />
                              ) : (
                                <span>
                                  <Plus size={20} />
                                  空のマス
                                </span>
                              )}
                            </span>
                            <span className="row-page-caption">
                              <span>
                                {openRow + 1}.{x + 1}
                              </span>
                              <span
                                style={
                                  cell ? { visibility: "hidden" } : undefined
                                }
                              >
                                {cell ? footerLabel(cell) : "ページを追加"}
                              </span>
                              {cell && !filtered && (
                                <span
                                  className="page-drag-grip"
                                  data-touch-drag-handle
                                  title="ここをドラッグで移動"
                                >
                                  <GripVertical size={16} />
                                </span>
                              )}
                            </span>
                            {cell?.id === slide.id && (
                              <span className="row-editing-badge">編集中</span>
                            )}
                          </button>
                          {cell && (
                            <ThumbnailFooter
                              className="flyout-footer-editor"
                              slide={cell}
                              label={footerLabel(cell)}
                              editable={footerEditable(cell)}
                              onChange={onFooterChange}
                            />
                          )}
                          {cell && (
                            <button
                              className="thumbnail-more page-more"
                              aria-label={`${cell.title}のページメニュー`}
                              title="ページの複製や削除"
                              onClick={(event) => {
                                cancelTimers();
                                onOpenMenu(event, { pageId: cell.id });
                              }}
                            >
                              <MoreHorizontal size={15} />
                            </button>
                          )}
                          {!filtered && (
                            <PageInsertDrop
                              x={x + 1}
                              y={openRow}
                              active={dragging?.kind === "page"}
                            >
                              <button
                                className="row-insert-column"
                                aria-label={`${x + 1}番目の話題の右に列を挿入`}
                                title="ここに新しい話題を挿入"
                                onClick={() => insert("column", x + 1, openRow)}
                              >
                                <Plus size={17} />
                              </button>
                            </PageInsertDrop>
                          )}
                        </>
                      )}
                    </PageDragFrame>
                  );
                })}
              </div>
            </div>
            <div className="row-flyout-hint">
              {filtered
                ? "フィルタしたページだけを表示しています"
                : "長押し・つまみで移動 · 重ねて入れ替え · 間に置いて挿入"}
            </div>
          </div>,
          document.body,
        )}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="rail-drag-preview">
              {dragging.kind === "row" ? (
                <>
                  <GripVertical size={20} />
                  <span>
                    {dragging.y + 1}段目をまとめて移動
                    <br />
                    <small>
                      {deck.slides.filter((s) => s.y === dragging.y).length}
                      ページ
                    </small>
                  </span>
                </>
              ) : (
                <>
                  {(() => {
                    const page = deck.slides.find((s) => s.id === dragging.id);
                    return page ? <Canvas slide={page} zoom={140 / W} /> : null;
                  })()}
                </>
              )}
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
