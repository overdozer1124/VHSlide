import {
  ArrowDown,
  ArrowRight,
  ChevronRight,
  GripVertical,
  LayoutGrid,
  Move,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import type { Deck, Slide, GridMove } from "./model";
import { bounds, W } from "./model";
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
  onHelp: () => void;
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
  onHelp,
  onOpenMenu,
}: MapViewProps) {
  const size = bounds(deck),
    cols = Math.max(3, size.cols),
    rows = Math.max(2, size.rows);
  return (
    <main className="map-main">
      <section className="map-intro">
        <div>
          <div className="eyebrow">YOUR STORY, IN TWO DIRECTIONS</div>
          <h1>
            アイデアを、つなげよう<span>。</span>
          </h1>
          <p>
            よこに広げて、たてに深める。あなたの伝えたいことを、このマップに。
          </p>
        </div>
        <div className="map-count">
          <span>{deck.slides.length.toString().padStart(2, "0")}</span>
          <div>
            ページ
            <br />
            <small>{size.cols} つの話題</small>
          </div>
        </div>
      </section>
      <section className="map-panel" aria-label="ページの全体マップ">
        <div className="map-toolbar">
          <div className="map-legend">
            <span className="live-dot" />
            ストーリーマップ<span className="subtle">/ すべてのページ</span>
          </div>
          <span className="map-tip">
            <Move size={14} />
            マスにぴったり並びます
          </span>
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
        <div className="map-scroll">
          <div
            className="map-grid"
            style={{ gridTemplateColumns: `44px repeat(${cols}, 274px) 110px` }}
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
                  const s = deck.slides.find((s) => s.x === x && s.y === y);
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
                              <Canvas slide={s} zoom={242 / W} />
                              {x === 0 && y === 0 && (
                                <span className="start-badge">START</span>
                              )}
                            </button>
                            <div className="card-footer">
                              <span className="page-number">
                                {x + 1}.{y + 1}
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
                          aria-label={`${x + 1}.${y + 1}にページを${moving ? "移動" : "追加"}`}
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
      <footer className="page-footer">
        <span className="footer-brand">
          <LayoutGrid size={15} /> VHSlide
        </span>
        <span>伝えることが、もっと自由に。</span>
        <button className="quiet" onClick={() => onHelp()}>
          はじめての方へ <ChevronRight size={14} />
        </button>
      </footer>
    </main>
  );
}
