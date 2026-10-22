import { useEffect, useMemo, useRef } from "react";
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
} from "lucide-react";
import type { Deck, Slide, GridMove } from "./model";
import { bounds, W, H } from "./model";
import { Canvas } from "./Canvas";
import type { OpenThumbnailMenu } from "./ThumbnailMenu";
interface MapViewProps {
  deck: Deck;
  activeId: string;
  moving?: GridMove;
  onMove: (move?: GridMove) => void;
  dropAt: (x: number, y: number) => void;
  add: (slide: Slide, direction: "right" | "down") => void;
  onEdit: (id: string) => void;
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
  const activeCard = useRef<HTMLDivElement>(null);
  const cells = useMemo(
    () => new Map(deck.slides.map((s) => [`${s.x},${s.y}`, s])),
    [deck.slides],
  );
  const thumbWidth = 242 * scale,
    thumbHeight = (thumbWidth * H) / W;
  const cardWidth = thumbWidth + 2,
    cardHeight = thumbHeight + 34;
  const clampScale = (next: number) => Math.max(0.25, Math.min(1.25, next));
  function fitColumns() {
    if (!scrollRef.current) return;
    const width = scrollRef.current.clientWidth - 24 - 32 - 32;
    onScale(clampScale(Math.min(1, (width / cols - 24 - 2) / 242)));
    scrollRef.current.scrollLeft = 0;
  }
  useEffect(() => {
    activeCard.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);
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
          <div
            className="map-zoom"
            role="group"
            aria-label="マップの表示サイズ"
          >
            <button
              className="icon-button"
              aria-label="マップを縮小"
              title="マップを縮小"
              disabled={scale <= 0.25}
              onClick={() =>
                onScale(clampScale(Math.round((scale - 0.1) * 100) / 100))
              }
            >
              <ZoomOut size={17} />
            </button>
            <button
              className="map-scale-reset"
              aria-label="表示サイズを80%に戻す"
              title="標準の表示サイズに戻す"
              onClick={() => onScale(0.8)}
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              className="icon-button"
              aria-label="マップを拡大"
              title="マップを拡大"
              disabled={scale >= 1.25}
              onClick={() =>
                onScale(clampScale(Math.round((scale + 0.1) * 100) / 100))
              }
            >
              <ZoomIn size={17} />
            </button>
            <button className="quiet map-fit" onClick={fitColumns}>
              <Maximize2 size={15} />
              横をおさめる
            </button>
          </div>
        </div>
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
            data-compact={scale <= 0.6}
            data-tiny={scale < 0.4}
            style={
              {
                gridTemplateColumns: `32px repeat(${cols}, ${cardWidth + 24}px) 32px`,
                "--map-card-width": `${cardWidth}px`,
                "--map-card-height": `${cardHeight}px`,
                "--map-row-height": `${cardHeight + 24}px`,
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
                              aria-label={`${s.title}を${moving ? "移動先にする" : "編集"}`}
                              onClick={() => {
                                if (moving) dropAt(x, y);
                                else onEdit(s.id);
                              }}
                            >
                              <Canvas slide={s} zoom={thumbWidth / W} />
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
          <span>小さなアイデアから、はじめよう。</span>
        </div>
      </section>
    </main>
  );
}
