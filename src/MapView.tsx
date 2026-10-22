import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
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
} from "lucide-react";
import type { Deck, Slide, GridMove } from "./model";
import { bounds, W, H } from "./model";
import { Canvas } from "./Canvas";
import { usePinch } from "./usePinch";
import type { PinchPoint } from "./usePinch";
import type { OpenThumbnailMenu } from "./ThumbnailMenu";
const ThumbnailCanvas = memo(Canvas);

interface MapViewProps {
  deck: Deck;
  activeId: string;
  moving?: GridMove;
  onMove: (move?: GridMove) => void;
  dropAt: (x: number, y: number) => void;
  add: (slide: Slide, direction: "right" | "down") => void;
  onEdit: (id: string, rect?: DOMRect) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onAddCell: (x: number, y: number) => void;
  scale: number;
  onScale: (scale: number) => void;
  onOpenMenu: OpenThumbnailMenu;
}
export function MapView({
  deck,
  activeId,
  moving,
  onMove,
  dropAt,
  add,
  onEdit,
  onSelect,
  onDelete,
  onAddCell,
  scale,
  onScale,
  onOpenMenu,
}: MapViewProps) {
  const size = bounds(deck),
    cols = Math.max(3, size.cols),
    rows = Math.max(2, size.rows);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({
    width: 1000,
    height: 500,
  });
  const [find, setFind] = useState("");
  const [findError, setFindError] = useState("");
  const activeCard = useRef<HTMLDivElement>(null);
  const skipFocusScroll = useRef(false);
  const cells = useMemo(
    () => new Map(deck.slides.map((s) => [`${s.x},${s.y}`, s])),
    [deck.slides],
  );
  const numbers = scale === 0;
  const gap = numbers || scale < 0.25 ? 8 : 24;
  const thumbWidth = numbers
      ? Math.max(44, Math.min(72, (viewportSize.width - 88) / cols - gap))
      : 242 * scale,
    thumbHeight = numbers
      ? Math.max(20, Math.min(32, (viewportSize.height - 60) / rows))
      : (thumbWidth * H) / W;
  const cardWidth = thumbWidth + 2,
    cardHeight = thumbHeight + (numbers ? 0 : scale < 0.25 ? 20 : 34);
  const clampScale = (next: number) => Math.max(0.1, Math.min(1.25, next));
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
    skipFocusScroll.current = (next === 0) !== numbers;
    onScale(next);
    if (next === scale) restoreAnchor();
  }
  usePinch(scrollRef, {
    start(point) {
      const grid = gridRef.current!,
        rect = grid.getBoundingClientRect();
      let nearest: HTMLElement | undefined,
        best = Infinity;
      grid.querySelectorAll<HTMLElement>("[data-page-id]").forEach((node) => {
        const b = node.getBoundingClientRect();
        const distance = Math.hypot(
          Math.max(b.x - point.x, 0, point.x - b.right),
          Math.max(b.y - point.y, 0, point.y - b.bottom),
        );
        if (distance < best) {
          best = distance;
          nearest = node;
        }
      });
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
      const a = anchor.current!;
      const ratio = Math.max(0.12, Math.min(5, sample.ratio));
      gridRef.current!.style.transform = `translate(${sample.x - a.point.x}px, ${sample.y - a.point.y}px) scale(${ratio})`;
    },
    end(sample, cancelled) {
      const a = anchor.current!;
      delete gridRef.current!.dataset.pinching;
      if (cancelled) {
        gridRef.current!.style.transform = "";
        return;
      }
      if (!numbers && a.scale * sample.ratio >= 1.5 && a.id) {
        const tile = gridRef.current!.querySelector(
          `[data-page-id="${CSS.escape(a.id)}"] .thumbnail`,
        );
        const rect = tile?.getBoundingClientRect();
        // Keep the last useful map size when returning from the editor.
        onEdit(a.id, rect);
        return;
      }
      const next = numbers
        ? sample.ratio > 1.18
          ? clampScale((thumbWidth / 242) * sample.ratio)
          : 0
        : a.scale * sample.ratio < 0.075
          ? 0
          : clampScale(a.scale * sample.ratio);
      keepAnchor(next, sample);
    },
  });
  useLayoutEffect(restoreAnchor, [scale]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setViewportSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(scrollRef.current!);
    return () => observer.disconnect();
  }, []);
  function zoomOut() {
    onScale(
      scale <= 0.1
        ? 0
        : scale <= 0.15
          ? 0.1
          : scale <= 0.25
            ? 0.15
            : Math.max(0.25, Math.round((scale - 0.1) * 100) / 100),
    );
  }
  function zoomIn() {
    onScale(
      numbers
        ? 0.1
        : scale < 0.15
          ? 0.15
          : scale < 0.25
            ? 0.25
            : clampScale(Math.round((scale + 0.1) * 100) / 100),
    );
  }
  function fitColumns() {
    if (!scrollRef.current) return;
    const width = scrollRef.current.clientWidth - 24 - 32 - 32;
    onScale(clampScale(Math.min(1, (width / cols - 24 - 2) / 242)));
    scrollRef.current.scrollLeft = 0;
  }
  useEffect(() => {
    if (skipFocusScroll.current) {
      skipFocusScroll.current = false;
      return;
    }
    activeCard.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, numbers]);
  return (
    <main className="map-main">
      <section className="map-panel" aria-label="ページの全体マップ">
        <div className="map-toolbar">
          <div className="map-summary">
            <h1>
              <LayoutGrid size={16} />
              全体マップ
            </h1>
            <span className="map-stats">
              {deck.slides.length}ページ{" "}
              <span>
                ／ {size.cols}話題・{size.rows}段
              </span>
            </span>
          </div>
          <form
            className="map-find"
            onSubmit={(event) => {
              event.preventDefault();
              const match = find.trim().match(/^(\d+)[.．・,、-](\d+)$/);
              const target =
                match &&
                cells.get(`${Number(match[2]) - 1},${Number(match[1]) - 1}`);
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
              aria-label="表示サイズを80%に戻す"
              title="標準の表示サイズに戻す"
              onClick={() => onScale(0.8)}
            >
              {numbers ? "番号" : `${Math.round(scale * 100)}%`}
            </button>
            <button
              className="icon-button"
              aria-label="マップを拡大"
              title="マップを拡大"
              disabled={scale >= 1.25}
              onClick={zoomIn}
            >
              <ZoomIn size={17} />
            </button>
            <button
              className="icon-button map-numbers-toggle"
              aria-label="番号だけの一覧"
              aria-pressed={numbers}
              title="番号だけの一覧"
              onClick={() => onScale(numbers ? 0.1 : 0)}
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
            <button className="quiet map-fit" onClick={fitColumns}>
              <Maximize2 size={15} />
              横をおさめる
            </button>
          </div>
        </div>
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
            移動：入れかえるマスをタップしてください。
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
            data-mini={!numbers && scale < 0.25}
            data-compact={scale <= 0.6}
            data-tiny={scale < 0.4}
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
              <span>次の話題へ</span>
              <span className="axis-line" />
              <ArrowRight size={15} />
            </div>
            <div />
            <div />
            <>
              {Array.from({ length: cols }, (_, x) => (
                <div className="column-heading" key={x}>
                  <span className="column-num">
                    {String(x + 1).padStart(2, "0")}
                  </span>
                  <span>{x === 0 ? "はじまり" : `話題 ${x + 1}`}</span>
                  <button
                    draggable
                    onDragStart={() => onMove({ mode: "column", x, y: 0 })}
                    className="icon-button"
                    title="この話題をまとめて移動"
                    aria-label={`話題${x + 1}を移動`}
                    onClick={() => onMove({ mode: "column", x, y: 0 })}
                  >
                    <GripVertical size={16} />
                  </button>
                </div>
              ))}
            </>
            <div />
            {Array.from({ length: rows }, (_, y) => (
              <div className="grid-row" key={y}>
                <div className="row-axis">
                  <button
                    className="row-move"
                    draggable
                    onDragStart={() => onMove({ mode: "row", x: 0, y })}
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
                  return (
                    <div
                      className={`grid-cell ${moving ? "drop-ready" : ""}`}
                      key={x}
                      onDragOver={(e) => {
                        if (moving) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        dropAt(x, y);
                      }}
                    >
                      {s ? (
                        <>
                          <div
                            ref={s.id === activeId ? activeCard : undefined}
                            data-page-id={s.id}
                            className={`slide-card ${s.id === activeId ? "active-card" : ""}`}
                            onContextMenu={(event) =>
                              onOpenMenu(event, { pageId: s.id })
                            }
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", s.id);
                              onMove({ mode: "slide", x, y });
                            }}
                            onDragEnd={() => onMove(undefined)}
                          >
                            <button
                              className="thumbnail"
                              aria-current={
                                s.id === activeId ? "page" : undefined
                              }
                              title={`${y + 1}.${x + 1} ${s.title}${s.id === activeId ? "（いまのページ）" : ""}`}
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
                                  {y + 1}.{x + 1}
                                </span>
                              ) : (
                                <ThumbnailCanvas
                                  slide={s}
                                  zoom={thumbWidth / W}
                                />
                              )}
                              {x === 0 && y === 0 && (
                                <span className="start-badge">START</span>
                              )}
                            </button>
                            <div className="card-footer">
                              <span className="page-number">
                                {y + 1}.{x + 1}
                              </span>
                              <span className="card-title">{s.title}</span>
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
                                className="card-tool"
                                aria-label={`${s.title}を移動`}
                                onClick={() => onMove({ mode: "slide", x, y })}
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
                            </div>
                          </div>
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
                      ) : (
                        <button
                          className="empty-cell"
                          aria-label={`${y + 1}.${x + 1}にページを${moving ? "移動" : "追加"}`}
                          onClick={() => {
                            if (moving) dropAt(x, y);
                            else onAddCell(x, y);
                          }}
                        >
                          <Plus size={19} />
                          <span>{moving ? "ここへ移動" : "ページを追加"}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
                <div className="grid-end" />
              </div>
            ))}
          </div>
        </div>
        <div className="map-bottom">
          <span>
            <span className="keyboard-key">↔</span> よこは「次の話題」
            <span className="legend-separator">/</span>
            <span className="keyboard-key">↕</span> たては「くわしい説明」
          </span>
          <span className="map-pinch-hint">
            ピンチで拡大・縮小 → ページ編集
          </span>
        </div>
      </section>
    </main>
  );
}
