import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import type { Deck, Slide } from "./model";
import { bounds, H, W, rowPage } from "./model";
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
import { RailRowFrame, PageDragFrame, NewRowDrop } from "./RailDrag";
import type { RailDragSource, RailDropTarget } from "./RailDrag";
import type { OpenThumbnailMenu } from "./ThumbnailMenu";

interface SlideRailProps {
  deck: Deck;
  slide: Slide;
  onSelectSlide: (id: string) => void;
  onInsert: (axis: "row" | "column", index: number, cross: number) => boolean;
  onCreate: (x: number, y: number) => boolean;
  onMove: (source: RailDragSource, x: number, y: number) => boolean;
  onNavigate: (dx: number, dy: number) => Slide | undefined;
  onOpenMenu: OpenThumbnailMenu;
  menuOpen: boolean;
}

/** A fixed-width column, with a temporary horizontal view of each grid row. */
export function SlideRail({
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
      activationConstraint: { delay: 200, tolerance: 7 },
    }),
  );
  const [dragging, setDragging] = useState<RailDragSource | null>(null);
  const draggingRef = useRef<RailDragSource | null>(null);
  const navigationStarted = useRef(false);
  const collision: CollisionDetection = (args) =>
    pointerWithin({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (container) =>
          args.active.data.current?.kind !== "row" ||
          container.data.current?.kind === "row",
      ),
    });
  const { rows, cols } = bounds(deck);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [position, setPosition] = useState({ left: 180, top: 220, width: 720 });
  const [thumbWidth, setThumbWidth] = useState(140);
  const railRef = useRef<HTMLElement>(null);
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
    if (draggingRef.current || menuOpen) return;
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
    cancelTimers();
    if (source && target) onMove(source, target.x, target.y);
    close();
  }
  useEffect(() => () => cancelTimers(), []);
  useEffect(() => {
    if (menuOpen) cancelTimers();
  }, [menuOpen]);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const observer = new ResizeObserver(([entry]) =>
      setThumbWidth(Math.max(56, Math.min(140, entry.contentRect.width - 24))),
    );
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);
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
  }, [slide.id, slide.y]);
  useEffect(() => {
    if (openRow === null) return;
    if (openRow >= rows) {
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
        ref={railRef}
        aria-label="縦横のページ一覧"
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") delayClose();
        }}
      >
        <div className="rail-heading">
          <strong>ページ一覧</strong>
          <span>
            横にひらく <ArrowRight size={12} />
          </span>
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
          {Array.from({ length: rows }, (_, y) => {
            const cell = rowPage(deck, y, slide.x);
            return (
              <RailRowFrame
                x={cell?.x ?? 0}
                y={y}
                hasPages={deck.slides.some((s) => s.y === y)}
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
                        cancelTimers();
                        onOpenMenu(event, { pageId: cell?.id, row: y });
                      }}
                      onPointerDown={(e) => {
                        pointer.current = e.pointerType;
                      }}
                      onFocus={(e) => {
                        if (suppressFocus.current) {
                          suppressFocus.current = false;
                          return;
                        }
                        if (e.currentTarget.matches(":focus-visible")) show(y);
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
                        <span className="rail-drag-hint">
                          <GripVertical size={11} />
                          <ChevronRight size={13} />
                        </span>
                      </span>
                      <span
                        className="rail-preview"
                        style={{
                          width: thumbWidth,
                          height: (thumbWidth * H) / W,
                        }}
                      >
                        {cell ? (
                          <Canvas slide={cell} zoom={thumbWidth / W} />
                        ) : (
                          <span className="rail-empty">空のマス</span>
                        )}
                      </span>
                      <span className="rail-page-title">
                        {cell?.title ?? "横のページを確認"}
                      </span>
                    </button>
                    <button
                      className="thumbnail-more rail-more"
                      aria-label={`${y + 1}段目のメニュー`}
                      title="ページ・段の複製や削除"
                      onClick={(event) => {
                        cancelTimers();
                        onOpenMenu(event, { pageId: cell?.id, row: y });
                      }}
                    >
                      <MoreHorizontal size={15} />
                    </button>
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
                  </>
                )}
              </RailRowFrame>
            );
          })}
          {dragging && (dragging.kind === "row" || rows < 100) && (
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
        </div>
        <div className="rail-footnote">ドラッグで段ごと移動 ↕</div>
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
              if (e.pointerType === "mouse") cancelTimers();
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
                {Array.from({ length: cols }, (_, x) => {
                  const cell = cells.get(`${x},${openRow}`);
                  return (
                    <PageDragFrame key={x} x={x} y={openRow} page={cell}>
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
                              if (!cell) return;
                              cancelTimers();
                              onOpenMenu(event, { pageId: cell.id });
                            }}
                            aria-label={
                              cell
                                ? `${openRow + 1}.${x + 1} ${cell.title}を編集`
                                : `${openRow + 1}.${x + 1}の空のマスにページを追加`
                            }
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
                              <span>{cell?.title ?? "ページを追加"}</span>
                            </span>
                            {cell?.id === slide.id && (
                              <span className="row-editing-badge">編集中</span>
                            )}
                          </button>
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
                          <button
                            className="row-insert-column"
                            aria-label={`${x + 1}番目の話題の右に列を挿入`}
                            title="ここに新しい話題を挿入"
                            onClick={() => insert("column", x + 1, openRow)}
                          >
                            <Plus size={17} />
                          </button>
                        </>
                      )}
                    </PageDragFrame>
                  );
                })}
              </div>
            </div>
            <div className="row-flyout-hint">
              クリック・矢印で切り替え · ドラッグで1枚移動
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
