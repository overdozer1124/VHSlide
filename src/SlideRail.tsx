import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, ChevronRight, Plus, X } from "lucide-react";
import type { Deck, Slide } from "./model";
import { bounds, H, W } from "./model";
import { Canvas } from "./Canvas";

interface SlideRailProps {
  deck: Deck;
  slide: Slide;
  onSelectSlide: (id: string) => void;
  onInsert: (axis: "row" | "column", index: number, cross: number) => boolean;
  onCreate: (x: number, y: number) => boolean;
}

/** A fixed-width column, with a temporary horizontal view of each grid row. */
export function SlideRail({
  deck,
  slide,
  onSelectSlide,
  onInsert,
  onCreate,
}: SlideRailProps) {
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
    cancelTimers();
    openTimer.current = setTimeout(() => show(y), 180);
  }
  function delayClose() {
    cancelTimers();
    closeTimer.current = setTimeout(() => setOpenRow(null), 330);
  }
  function insert(axis: "row" | "column", index: number, cross: number) {
    if (onInsert(axis, index, cross)) close();
  }

  useEffect(() => () => cancelTimers(), []);
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
      if (
        !railRef.current?.contains(target) &&
        !popupRef.current?.contains(target)
      )
        close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
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
  }, [openRow, rows, slide.id]);

  return (
    <>
      <aside
        className="slide-rail two-d-rail"
        ref={railRef}
        aria-label="縦横のページ一覧"
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") delayClose();
        }}
      >
        <div className="rail-heading">
          <strong>話題 {slide.x + 1}</strong>
          <span>
            横にひらく <ArrowRight size={12} />
          </span>
        </div>
        <div className="rail-scroll" ref={scrollRef} onScroll={() => close()}>
          {Array.from({ length: rows }, (_, y) => {
            const cell = cells.get(`${slide.x},${y}`);
            return (
              <div
                className="rail-entry"
                key={y}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") hover(y);
                }}
                onPointerLeave={(e) => {
                  if (e.pointerType === "mouse") delayClose();
                }}
              >
                <button
                  ref={(node) => {
                    if (node) triggers.current.set(y, node);
                    else triggers.current.delete(y);
                  }}
                  className={`rail-trigger ${slide.y === y ? "rail-active" : ""}`}
                  aria-label={`${y + 1}段目の横のページをひらく`}
                  aria-expanded={openRow === y}
                  aria-controls={openRow === y ? "editor-row-pages" : undefined}
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
                    if (["ArrowRight", "Enter", " "].includes(e.key)) {
                      e.preventDefault();
                      show(y, true);
                    }
                  }}
                  onClick={() => {
                    show(y);
                    if (pointer.current === "mouse" && cell)
                      onSelectSlide(cell.id);
                  }}
                >
                  <span className="rail-coordinate">
                    {slide.x + 1}.{y + 1}
                    <ChevronRight size={13} />
                  </span>
                  <span
                    className="rail-preview"
                    style={{ width: thumbWidth, height: (thumbWidth * H) / W }}
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
                  className="rail-insert-row"
                  aria-label={`${y + 1}段目の下に行を挿入`}
                  title="ここに詳しい段を追加"
                  onClick={() => insert("row", y + 1, slide.x)}
                >
                  <span />
                  <Plus size={15} />
                  <span />
                </button>
              </div>
            );
          })}
        </div>
        <div className="rail-footnote">たてに、くわしく ↓</div>
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
                    <div className="row-page-pair" key={x}>
                      <button
                        className={`row-page ${cell?.id === slide.id ? "row-page-active" : ""} ${!cell ? "row-page-empty" : ""}`}
                        aria-current={
                          cell?.id === slide.id ? "page" : undefined
                        }
                        aria-label={
                          cell
                            ? `${x + 1}.${openRow + 1} ${cell.title}を編集`
                            : `${x + 1}.${openRow + 1}の空のマスにページを追加`
                        }
                        onClick={() => {
                          if (cell) onSelectSlide(cell.id);
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
                            {x + 1}.{openRow + 1}
                          </span>
                          <span>{cell?.title ?? "ページを追加"}</span>
                        </span>
                        {cell?.id === slide.id && (
                          <span className="row-editing-badge">編集中</span>
                        )}
                      </button>
                      <button
                        className="row-insert-column"
                        aria-label={`${x + 1}番目の話題の右に列を挿入`}
                        title="ここに新しい話題を挿入"
                        onClick={() => insert("column", x + 1, openRow)}
                      >
                        <Plus size={17} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="row-flyout-hint">
              ページを選んで切り替え · ＋で話題を挿入
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
