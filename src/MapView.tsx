import { useLayoutEffect, useMemo, useRef, useState, memo } from "react";
import type { CSSProperties } from "react";
import {
  ArrowDown,
  ArrowRight,
  GripVertical,
  LayoutGrid,
  Maximize2,
  MoreHorizontal,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
  Hash,
  LocateFixed,
  Search,
  Filter,
} from "lucide-react";
import type { Deck, Slide, GridMove } from "./model";
import { bounds, W, H } from "./model";
import { Canvas } from "./Canvas";
import { usePinch } from "./usePinch";
import type { PinchPoint } from "./usePinch";
import type { OpenThumbnailMenu } from "./ThumbnailMenu";
const ThumbnailCanvas = memo(Canvas);
import { MapZoomSettings } from "./MapZoomSettings";
import { closestZoom } from "./workspacePreferences";
import { useMapTouchDrag } from "./useMapTouchDrag";
import type { MapDrop } from "./useMapTouchDrag";

import { MapFilterPanel } from "./MapFilterPanel";
import { balancedGrid, emptyFilter, matchesFilter } from "./mapFilter";
import type { MapFilter } from "./mapFilter";

interface MapViewProps {
  visible: boolean;
  zoomSteps: number[];
  onZoomSteps: (steps: number[]) => void;
  deck: Deck;
  activeId: string;
  moving?: GridMove;
  onMove: (move?: GridMove) => void;
  dropAt: (x: number, y: number, source?: GridMove) => void;
  onInsertMove: (id: string, x: number, y: number) => void;
  add: (slide: Slide, direction: "right" | "down") => void;
  onEdit: (id: string, rect?: DOMRect) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onAddCell: (x: number, y: number) => void;
  scale: number;
  onScale: (scale: number) => void;
  onOpenMenu: OpenThumbnailMenu;
}
function MapViewComponent({
  visible,
  zoomSteps,
  onZoomSteps,
  deck,
  activeId,
  moving,
  onMove,
  dropAt,
  onInsertMove,
  add,
  onEdit,
  onSelect,
  onDelete,
  onAddCell,
  scale,
  onScale,
  onOpenMenu,
}: MapViewProps) {
  const [filter, setFilter] = useState<MapFilter>();
  const [draftFilter, setDraftFilter] = useState(emptyFilter);
  const [filterOpen, setFilterOpen] = useState(false);
  const filtered = filter !== undefined;
  const displaySlides = useMemo(
    () =>
      filter
        ? deck.slides
            .filter((s) => matchesFilter(s, filter))
            .sort((a, b) => a.y - b.y || a.x - b.x)
        : deck.slides,
    [deck.slides, filter],
  );
  const size = bounds(deck),
    packed = balancedGrid(displaySlides.length),
    cols = filtered ? packed.cols : Math.max(3, size.cols),
    rows = filtered ? packed.rows : Math.max(2, size.rows);
  const positions = useMemo(
    () =>
      new Map(
        displaySlides.map((s, i) => [
          s.id,
          filtered
            ? { x: i % cols, y: Math.floor(i / cols) }
            : { x: s.x, y: s.y },
        ]),
      ),
    [displaySlides, filtered, cols],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({
    width: 1000,
    height: 500,
  });
  const [visibleWindow, setVisibleWindow] = useState({
    left: 0,
    right: 8,
    top: 0,
    bottom: 4,
  });
  const [find, setFind] = useState("");
  const [findError, setFindError] = useState("");
  const activeCard = useRef<HTMLDivElement>(null);
  const [dropHint, setDropHint] = useState<MapDrop>();
  function hint(target?: MapDrop) {
    setDropHint((before) =>
      before?.x === target?.x &&
      before?.y === target?.y &&
      before?.insert === target?.insert
        ? before
        : target,
    );
  }
  function insertDrop(x: number, y: number, source = moving) {
    if (source?.mode !== "slide") return;
    const page = deck.slides.find((s) => s.x === source.x && s.y === source.y);
    if (page) onInsertMove(page.id, x, y);
    hint();
  }
  const skipFocusScroll = useRef(false);
  const cells = useMemo(
    () =>
      new Map(
        displaySlides.map((s) => {
          const p = positions.get(s.id)!;
          return [`${p.x},${p.y}`, s];
        }),
      ),
    [displaySlides, positions],
  );
  const levels = zoomSteps.map((percent) => percent / 100);
  const defaultScale = closestZoom(zoomSteps) / 100;
  const largestScale = levels[levels.length - 1];
  const smallerScale =
    [...levels].reverse().find((level) => level < scale - 0.0001) ?? 0;
  const largerScale =
    levels.find((level) => level > scale + 0.0001) ?? largestScale;
  const numbers = scale === 0;
  const gap = numbers ? 8 : 24;
  const thumbWidth = numbers
      ? Math.max(44, Math.min(72, (viewportSize.width - 88) / cols - gap - 2))
      : 242 * scale,
    thumbHeight = numbers
      ? Math.max(20, Math.min(32, (viewportSize.height - 60) / rows))
      : (thumbWidth * H) / W;
  const cardWidth = thumbWidth + 2,
    cardHeight = thumbHeight + (numbers ? 0 : 34);
  const anchor = useRef<{
    id?: string;
    point: PinchPoint;
    scale: number;
    rx: number;
    ry: number;
  } | null>(null);
  const pending = useRef<{
    id: string;
    point: PinchPoint;
    rx: number;
    ry: number;
  } | null>(null);
  function restoreAnchor() {
    const a = pending.current;
    pending.current = null;
    if (!a) return;
    const tile = gridRef.current?.querySelector(
      `[data-page-id="${CSS.escape(a.id)}"] .thumbnail`,
    );
    const rect = tile?.getBoundingClientRect();
    if (rect && scrollRef.current) {
      scrollRef.current.scrollLeft += rect.x + rect.width * a.rx - a.point.x;
      scrollRef.current.scrollTop += rect.y + rect.height * a.ry - a.point.y;
    }
  }
  function keepAnchor(next: number, point: PinchPoint) {
    const a = anchor.current;
    if (a?.id) pending.current = { id: a.id, point, rx: a.rx, ry: a.ry };
    gridRef.current!.style.transform = "";
    skipFocusScroll.current = next !== scale;
    onScale(next);
    if (next === scale) restoreAnchor();
  }
  const pinching = usePinch(scrollRef, {
    start(point) {
      const grid = gridRef.current!,
        rect = grid.getBoundingClientRect();
      // Read the touched card directly. For gaps, use fixed grid coordinates
      // instead of forcing a layout read for every slide in the document.
      let nearest = document
        .elementFromPoint(point.x, point.y)
        ?.closest<HTMLElement>(".slide-card");
      if (!nearest || !grid.contains(nearest)) {
        let target: Slide | undefined,
          best = Infinity;
        for (const page of displaySlides) {
          const p = positions.get(page.id)!;
          const left = rect.x + 32 + p.x * (cardWidth + gap);
          const top = rect.y + 46 + p.y * (cardHeight + gap);
          const distance = Math.hypot(
            Math.max(left - point.x, 0, point.x - left - cardWidth),
            Math.max(top - point.y, 0, point.y - top - cardHeight),
          );
          if (distance < best) {
            best = distance;
            target = page;
          }
        }
        nearest = target
          ? grid.querySelector<HTMLElement>(
              `[data-page-id="${CSS.escape(target.id)}"]`,
            )
          : null;
      }
      const tile = nearest
        ?.querySelector(".thumbnail")
        ?.getBoundingClientRect();
      anchor.current = {
        id: nearest?.dataset.pageId,
        point,
        scale,
        rx: tile ? (point.x - tile.x) / tile.width : 0.5,
        ry: tile ? (point.y - tile.y) / tile.height : 0.5,
      };
      grid.style.transformOrigin = `${point.x - rect.x}px ${point.y - rect.y}px`;
      grid.dataset.pinching = "true";
    },
    change(sample) {
      if (numbers && sample.direction === "in") return;
      const a = anchor.current!;
      const ratio = Math.max(0.12, Math.min(5, sample.ratio));
      gridRef.current!.style.transform = `translate(${sample.x - a.point.x}px, ${sample.y - a.point.y}px) scale(${ratio})`;
    },
    end(sample) {
      const a = anchor.current!;
      delete gridRef.current!.dataset.pinching;
      if (!sample.direction) {
        gridRef.current!.style.transform = "";
        return;
      }
      if (a.scale === largestScale && sample.direction === "out" && a.id) {
        const tile = gridRef.current!.querySelector(
          `[data-page-id="${CSS.escape(a.id)}"] .thumbnail`,
        );
        const rect = tile?.getBoundingClientRect();
        // The map stays mounted while editing; do not retain its pinch preview.
        gridRef.current!.style.transform = "";
        // Keep the last useful map size when returning from the editor.
        onEdit(a.id, rect);
        return;
      }
      // Always complete the display step chosen by the initial pinch direction.
      const next = sample.direction === "in" ? smallerScale : largerScale;
      keepAnchor(next, sample);
    },
  });
  useMapTouchDrag(scrollRef, {
    enabled: visible && !filtered && !filterOpen,
    start: (source) => onMove(source),
    hit(point, source) {
      const target = document
        .elementFromPoint(point.x, point.y)
        ?.closest<HTMLElement>("[data-map-insert],[data-map-cell]");
      if (!target || !scrollRef.current?.contains(target)) return;
      const insert =
        target.hasAttribute("data-map-insert") && source.mode === "slide";
      const position = target.dataset.mapInsert ?? target.dataset.mapCell;
      const [x, y] = position!.split(",").map(Number);
      return { x, y, insert };
    },
    hover: hint,
    drop(source, target) {
      if (target.insert) insertDrop(target.x, target.y, source);
      else dropAt(target.x, target.y, source);
      onMove(undefined);
      hint();
    },
    cancel() {
      onMove(undefined);
      hint();
    },
  });
  useLayoutEffect(restoreAnchor, [scale]);
  useLayoutEffect(() => {
    if (!visible) return;
    const node = scrollRef.current!;
    let frame: number | undefined;
    function measure() {
      frame = undefined;
      if (pinching.current || !node.clientWidth || !node.clientHeight) return;
      const width = node.clientWidth,
        height = node.clientHeight;
      setViewportSize((before) =>
        before.width === width && before.height === height
          ? before
          : { width, height },
      );
      // Keep one neighbouring row/column ready for scrolling and pinch previews.
      const next = {
        left: Math.max(
          0,
          Math.floor((node.scrollLeft - 44) / (cardWidth + gap)) - 1,
        ),
        right:
          Math.ceil((node.scrollLeft + width - 44) / (cardWidth + gap)) + 1,
        top: Math.max(
          0,
          Math.floor((node.scrollTop - 56) / (cardHeight + gap)) - 1,
        ),
        bottom:
          Math.ceil((node.scrollTop + height - 56) / (cardHeight + gap)) + 1,
      };
      setVisibleWindow((before) =>
        before.left === next.left &&
        before.right === next.right &&
        before.top === next.top &&
        before.bottom === next.bottom
          ? before
          : next,
      );
    }
    function queue() {
      if (frame === undefined) frame = requestAnimationFrame(measure);
    }
    const observer = new ResizeObserver(queue);
    observer.observe(node);
    node.addEventListener("scroll", queue, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", queue);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [cardWidth, cardHeight, gap, pinching, visible]);
  function zoomOut() {
    onScale(smallerScale);
  }
  function zoomIn() {
    onScale(largerScale);
  }
  function fitColumns() {
    if (!scrollRef.current) return;
    const width = scrollRef.current.clientWidth - 24 - 32 - 32;
    onScale(
      [...levels]
        .reverse()
        .find((level) => cols * (242 * level + 2 + 24) <= width) ?? 0,
    );
    scrollRef.current.scrollLeft = 0;
  }
  useLayoutEffect(() => {
    if (!visible) return;
    if (skipFocusScroll.current) {
      skipFocusScroll.current = false;
      return;
    }
    const thumbnail = activeCard.current?.querySelector(".thumbnail");
    thumbnail?.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "instant",
    });
  }, [activeId, scale, visible, filtered, cols]);
  return (
    <main
      className="map-main"
      hidden={!visible}
      style={visible ? undefined : { display: "none" }}
    >
      <section className="map-panel" aria-label="ページの全体マップ">
        <div className="map-toolbar">
          <div className="map-summary">
            <h1>
              <LayoutGrid size={16} />
              全体マップ
            </h1>
            <span className="map-stats">
              {filtered
                ? `${displaySlides.length} / ${deck.slides.length}`
                : deck.slides.length}
              ページ{" "}
              <span>
                ／ {size.cols}話題・{size.rows}段
              </span>
            </span>
          </div>
          <button
            className="quiet filter-toggle"
            aria-label="マップをフィルタ"
            aria-expanded={filterOpen}
            onClick={() => {
              setDraftFilter(filter ?? emptyFilter());
              setFilterOpen(!filterOpen);
              onMove(undefined);
            }}
          >
            <Filter size={16} />
            フィルタ
          </button>
          {filtered && (
            <button
              className="quiet"
              onClick={() => {
                setFilter(undefined);
                setFilterOpen(false);
              }}
            >
              フィルタ解除
            </button>
          )}
          <form
            className="map-find"
            onSubmit={(event) => {
              event.preventDefault();
              const match = find.trim().match(/^(\d+)[.．・,、-](\d+)$/);
              const target =
                match &&
                displaySlides.find(
                  (s) =>
                    s.x === Number(match[2]) - 1 &&
                    s.y === Number(match[1]) - 1,
                );
              if (target) {
                onSelect(target.id);
                setFindError("");
                requestAnimationFrame(() =>
                  gridRef.current
                    ?.querySelector(`[data-page-id="${CSS.escape(target.id)}"]`)
                    ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
                );
              } else setFindError("その番号のページはありません");
            }}
          >
            <input
              aria-label="ページ番号で探す"
              placeholder="3.2"
              value={find}
              onChange={(event) => {
                setFind(event.target.value);
                setFindError("");
              }}
            />
            <button
              className="icon-button"
              aria-label="番号のページを探す"
              title="縦.横の番号で探す"
            >
              <Search size={15} />
            </button>
          </form>
          <div
            className="map-zoom"
            role="group"
            aria-label="マップの表示サイズ"
          >
            <button
              className="icon-button"
              aria-label="マップを縮小"
              title="マップを縮小"
              disabled={numbers}
              onClick={zoomOut}
            >
              <ZoomOut size={17} />
            </button>
            <button
              className="map-scale-reset"
              aria-label={`表示サイズを${Math.round(defaultScale * 100)}%に戻す`}
              title={`標準の${Math.round(defaultScale * 100)}%に戻す`}
              onClick={() => onScale(defaultScale)}
            >
              {numbers ? "番号" : `${Math.round(scale * 100)}%`}
            </button>
            <button
              className="icon-button"
              aria-label="マップを拡大"
              title="マップを拡大"
              disabled={scale === largestScale}
              onClick={zoomIn}
            >
              <ZoomIn size={17} />
            </button>
            <button
              className="icon-button map-numbers-toggle"
              aria-label="番号だけの一覧"
              aria-pressed={numbers}
              title="番号だけの一覧"
              onClick={() => onScale(numbers ? levels[0] : 0)}
            >
              <Hash size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="いまのページを表示"
              title="いまのページを表示"
              onClick={() =>
                activeCard.current?.scrollIntoView({
                  block: "center",
                  inline: "center",
                  behavior: matchMedia("(prefers-reduced-motion: reduce)")
                    .matches
                    ? "instant"
                    : "smooth",
                })
              }
            >
              <LocateFixed size={17} />
            </button>
            <MapZoomSettings steps={zoomSteps} onApply={onZoomSteps} />
            <button className="quiet map-fit" onClick={fitColumns}>
              <Maximize2 size={15} />
              横をおさめる
            </button>
          </div>
        </div>
        {filterOpen && (
          <MapFilterPanel
            deck={deck}
            value={draftFilter}
            onChange={setDraftFilter}
            onApply={() => {
              setFilter(draftFilter);
              setFilterOpen(false);
              onMove(undefined);
            }}
            onClose={() => setFilterOpen(false)}
          />
        )}
        {filtered && (
          <div className="filtered-note">
            絞り込み表示 · 元のスライド番号で表示しています
          </div>
        )}
        {findError && (
          <div className="map-find-error" role="status">
            {findError}
          </div>
        )}
        {moving && (
          <div className="move-banner">
            {moving.mode === "row"
              ? "同じ高さのページをまとめて"
              : moving.mode === "column"
                ? "同じ話題のページをまとめて"
                : "ページを"}
            {moving.mode === "slide"
              ? "移動：重ねて入れ替え、間に置いて挿入。マスをタップしても移動できます。"
              : "移動：入れかえるマスに置くか、タップしてください。"}
            <button onClick={() => onMove(undefined)}>キャンセル</button>
          </div>
        )}
        <div
          className="map-scroll"
          ref={scrollRef}
          role="region"
          aria-label="スライドのマップ"
          tabIndex={0}
        >
          <div
            className="map-grid"
            ref={gridRef}
            data-numbers={numbers}
            data-compact={scale <= 0.6}
            data-tiny={numbers || scale < 0.4}
            data-micro={!numbers && scale < 0.25}
            style={
              {
                gridTemplateColumns: `32px repeat(${cols}, ${cardWidth + gap}px) 32px`,
                "--map-card-width": `${cardWidth}px`,
                "--map-card-height": `${cardHeight}px`,
                "--map-row-height": `${cardHeight + gap}px`,
                "--map-gap": `${gap}px`,
                "--map-thumb-height": `${thumbHeight}px`,
              } as CSSProperties
            }
          >
            <div className="axis-origin" />
            <div
              className="axis-horizontal"
              style={{ gridColumn: `2 / ${cols + 2}` }}
            >
              <span>{filtered ? "フィルタしたページ" : "次の話題へ"}</span>
              <span className="axis-line" />
              <ArrowRight size={15} />
            </div>
            <div />
            <div />
            <>
              {Array.from({ length: cols }, (_, x) =>
                filtered ? (
                  <div key={x} />
                ) : (
                  <div className="column-heading" key={x}>
                    <span className="column-num">
                      {String(x + 1).padStart(2, "0")}
                    </span>
                    <span>{x === 0 ? "はじまり" : `話題 ${x + 1}`}</span>
                    <button
                      draggable
                      data-map-drag-source="column"
                      data-x={x}
                      data-y={0}
                      data-map-drag-handle
                      onDragStart={() => onMove({ mode: "column", x, y: 0 })}
                      onDragEnd={() => {
                        onMove(undefined);
                        hint();
                      }}
                      className="icon-button"
                      title="この話題をまとめて移動"
                      aria-label={`話題${x + 1}を移動`}
                      onClick={() => onMove({ mode: "column", x, y: 0 })}
                    >
                      <GripVertical size={16} />
                    </button>
                  </div>
                ),
              )}
            </>
            <div />
            {Array.from({ length: rows }, (_, y) => (
              <div className="grid-row" key={y}>
                <div
                  className="row-axis"
                  style={filtered ? { visibility: "hidden" } : undefined}
                >
                  <button
                    className="row-move"
                    draggable
                    data-map-drag-source="row"
                    data-x={0}
                    data-y={y}
                    data-map-drag-handle
                    onDragStart={() => onMove({ mode: "row", x: 0, y })}
                    onDragEnd={() => {
                      onMove(undefined);
                      hint();
                    }}
                    onClick={() => onMove({ mode: "row", x: 0, y })}
                    aria-label={`高さ${y + 1}のページをまとめて移動`}
                    title="同じ高さのページを移動"
                  >
                    {String(y + 1).padStart(2, "0")}
                  </button>
                  {y === 1 && (
                    <span className="vertical-label">
                      くわしく <ArrowDown size={14} />
                    </span>
                  )}
                </div>
                {Array.from({ length: cols }, (_, x) => {
                  const s = cells.get(`${x},${y}`);
                  const detailed =
                    !numbers &&
                    x >= visibleWindow.left &&
                    x <= visibleWindow.right &&
                    y >= visibleWindow.top &&
                    y <= visibleWindow.bottom;
                  return (
                    <div
                      className={`grid-cell ${moving ? "drop-ready" : ""}`}
                      data-map-cell={`${x},${y}`}
                      data-insert-shift={
                        dropHint?.insert && dropHint.y === y && x >= dropHint.x
                      }
                      data-drop-over={
                        dropHint &&
                        !dropHint.insert &&
                        dropHint.x === x &&
                        dropHint.y === y
                      }
                      key={x}
                      onDragOver={(e) => {
                        if (moving) {
                          e.preventDefault();
                          hint({ x, y, insert: false });
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        dropAt(x, y);
                        hint();
                      }}
                    >
                      <div
                        className="map-insert-drop"
                        data-map-insert={`${x},${y}`}
                        data-active={moving?.mode === "slide"}
                        data-over={
                          dropHint?.insert &&
                          dropHint.x === x &&
                          dropHint.y === y
                        }
                        onDragEnter={(event) => {
                          if (moving?.mode !== "slide") return;
                          event.preventDefault();
                          event.stopPropagation();
                          hint({ x, y, insert: true });
                        }}
                        onDragOver={(event) => {
                          if (moving?.mode !== "slide") return;
                          event.preventDefault();
                          event.stopPropagation();
                          hint({ x, y, insert: true });
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          insertDrop(x, y);
                        }}
                      >
                        <span className="insert-drop-line" />
                        {dropHint?.insert &&
                          dropHint.x === x &&
                          dropHint.y === y && (
                            <span className="insert-drop-label">
                              ここに挿入
                            </span>
                          )}
                      </div>
                      {s ? (
                        <>
                          <div
                            ref={s.id === activeId ? activeCard : undefined}
                            data-page-id={s.id}
                            data-map-drag-source={
                              filtered || filterOpen ? undefined : "slide"
                            }
                            data-x={x}
                            data-y={y}
                            style={
                              !numbers && !detailed
                                ? { height: cardHeight }
                                : undefined
                            }
                            className={`slide-card ${s.id === activeId ? "active-card" : ""}`}
                            onContextMenu={(event) =>
                              onOpenMenu(event, { pageId: s.id })
                            }
                            draggable={!filtered && !filterOpen}
                            onDragStart={(e) => {
                              if (filtered || filterOpen) {
                                e.preventDefault();
                                return;
                              }
                              e.dataTransfer.setData("text/plain", s.id);
                              onMove({ mode: "slide", x, y });
                            }}
                            onDragEnd={() => {
                              onMove(undefined);
                              hint();
                            }}
                          >
                            <button
                              className="thumbnail"
                              style={
                                !numbers && !detailed
                                  ? {
                                      width: thumbWidth,
                                      height: thumbHeight,
                                      background: s.background,
                                    }
                                  : undefined
                              }
                              aria-current={
                                s.id === activeId ? "page" : undefined
                              }
                              title={`${s.y + 1}.${s.x + 1} ${s.title}${s.id === activeId ? "（いまのページ）" : ""}`}
                              aria-label={`${s.title}を${moving ? "移動先にする" : "編集"}`}
                              onClick={() => {
                                if (moving) dropAt(x, y);
                                else onEdit(s.id);
                              }}
                            >
                              {numbers ? (
                                <span
                                  className="number-tile"
                                  style={{ height: thumbHeight }}
                                >
                                  {s.y + 1}.{s.x + 1}
                                </span>
                              ) : detailed ? (
                                <ThumbnailCanvas
                                  slide={s}
                                  zoom={thumbWidth / W}
                                />
                              ) : null}
                              {detailed && x === 0 && y === 0 && (
                                <span className="start-badge">START</span>
                              )}
                            </button>
                            {detailed && (
                              <div className="card-footer">
                                <span className="page-number">
                                  {s.y + 1}.{s.x + 1}
                                </span>
                                <span className="card-title">{s.title}</span>
                                <>
                                  <button
                                    className="card-tool"
                                    aria-label={`${s.title}のページメニュー`}
                                    onClick={(event) =>
                                      onOpenMenu(event, { pageId: s.id })
                                    }
                                  >
                                    <MoreHorizontal size={14} />
                                  </button>
                                  <button
                                    style={{
                                      display:
                                        filtered || filterOpen
                                          ? "none"
                                          : undefined,
                                    }}
                                    className="card-tool"
                                    data-map-drag-handle
                                    aria-label={`${s.title}を移動`}
                                    onClick={() =>
                                      onMove({ mode: "slide", x, y })
                                    }
                                  >
                                    <GripVertical size={14} />
                                  </button>
                                  <button
                                    className="card-tool delete"
                                    aria-label={`${s.title}を削除`}
                                    onClick={() => onDelete(s.id)}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              </div>
                            )}
                          </div>
                          {detailed && !filtered && (
                            <>
                              <button
                                className="add-right add-dot"
                                aria-label={`${s.title}の右に次の話題を追加`}
                                title="次の話題へ（右）"
                                onClick={() => add(s, "right")}
                              >
                                <Plus size={15} />
                              </button>
                              <button
                                className="add-down add-dot"
                                aria-label={`${s.title}の下に詳しいページを追加`}
                                title="くわしく（下）"
                                onClick={() => add(s, "down")}
                              >
                                <Plus size={15} />
                              </button>
                            </>
                          )}
                        </>
                      ) : filtered ? (
                        <div />
                      ) : (
                        <button
                          className="empty-cell"
                          aria-label={`${y + 1}.${x + 1}にページを${moving ? "移動" : "追加"}`}
                          onClick={() => {
                            if (moving) dropAt(x, y);
                            else onAddCell(x, y);
                          }}
                        >
                          {detailed && !filtered && (
                            <>
                              <Plus size={19} />
                              <span>
                                {moving ? "ここへ移動" : "ページを追加"}
                              </span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
                <div className="grid-end map-row-end">
                  <div
                    className="map-insert-drop"
                    data-map-insert={`${cols},${y}`}
                    data-active={moving?.mode === "slide"}
                    data-over={
                      dropHint?.insert &&
                      dropHint.x === cols &&
                      dropHint.y === y
                    }
                    onDragEnter={(event) => {
                      if (moving?.mode !== "slide") return;
                      event.preventDefault();
                      event.stopPropagation();
                      hint({ x: cols, y, insert: true });
                    }}
                    onDragOver={(event) => {
                      if (moving?.mode !== "slide") return;
                      event.preventDefault();
                      event.stopPropagation();
                      hint({ x: cols, y, insert: true });
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      insertDrop(cols, y);
                    }}
                  >
                    <span className="insert-drop-line" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {filtered && !displaySlides.length && (
          <p className="filter-empty">
            一致するページがありません。フィルタを解除するか、条件を変更してください。
          </p>
        )}
        <div className="map-bottom">
          <span>
            <span className="keyboard-key">↔</span> よこは「次の話題」
            <span className="legend-separator">/</span>
            <span className="keyboard-key">↕</span> たては「くわしい説明」
          </span>
          <span className="map-pinch-hint">
            長押し・つまみで移動 · ピンチで拡大・縮小
          </span>
        </div>
      </section>
    </main>
  );
}
// Keep the map's DOM and scroll position for a quick return. While hidden,
// editor keystrokes and cloud updates do not rerender its thumbnails.
export const MapView = memo(
  MapViewComponent,
  (previous, next) => !previous.visible && !next.visible,
);
