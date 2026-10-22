import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Maximize,
  X,
} from "lucide-react";
import type { Deck, Slide } from "./model";
import { bounds, neighbor } from "./model";
import { Canvas } from "./Canvas";
import { useFitCanvas } from "./useFitCanvas";
interface PresentationProps {
  deck: Deck;
  slide: Slide;
  direction: string;
  go: (dx: number, dy: number) => void;
  exitPresent: () => void;
}
export function PresentationView({
  deck,
  slide,
  direction,
  go,
  exitPresent,
}: PresentationProps) {
  const presentRef = useRef<HTMLDivElement>(null),
    touch = useRef<{ x: number; y: number } | null>(null);
  const zoom = useFitCanvas(presentRef, 0, 0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nearEdge = useRef(false);
  const currentCell = useRef<HTMLSpanElement>(null);
  const cells = useMemo(
    () => new Map(deck.slides.map((page) => [`${page.x},${page.y}`, page])),
    [deck.slides],
  );
  function reveal(duration = 2000) {
    clearTimeout(hideTimer.current);
    setControlsVisible(true);
    if (!nearEdge.current)
      hideTimer.current = setTimeout(() => setControlsVisible(false), duration);
  }
  function hide() {
    clearTimeout(hideTimer.current);
    setControlsVisible(false);
  }
  useEffect(() => {
    hideTimer.current = setTimeout(() => setControlsVisible(false), 1800);
    return () => clearTimeout(hideTimer.current);
  }, []);
  useEffect(() => {
    currentCell.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [slide.id]);
  const size = bounds(deck);
  return (
    <div
      className="present-mode"
      style={{ background: slide.background }}
      data-controls-visible={controlsVisible}
      onPointerMove={(event) => {
        if (event.pointerType === "touch") return;
        const box = event.currentTarget.getBoundingClientRect();
        const edge =
          !!(event.target as Element).closest(".present-top,.present-bottom") ||
          event.clientY - box.top < 64 ||
          box.bottom - event.clientY < 135;
        if (edge) {
          nearEdge.current = true;
          reveal();
        } else if (nearEdge.current || controlsVisible) {
          nearEdge.current = false;
          clearTimeout(hideTimer.current);
          hideTimer.current = setTimeout(() => setControlsVisible(false), 350);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "touch") return;
        nearEdge.current = false;
        hide();
      }}
      onFocusCapture={(event) => {
        if (event.target.matches(":focus-visible")) reveal();
      }}
      onKeyDownCapture={() => reveal()}
      ref={presentRef}
      onTouchStart={(e) => {
        if (
          (e.target as Element).closest("button,.minimap") ||
          e.touches.length !== 1
        ) {
          touch.current = null;
          return;
        }
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e) => {
        if (!touch.current) return;
        const dx = e.changedTouches[0].clientX - touch.current.x,
          dy = e.changedTouches[0].clientY - touch.current.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 60) {
          hide();
          if (Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1, 0);
          else go(0, dy < 0 ? 1 : -1);
        } else if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) {
          if (controlsVisible) hide();
          else reveal(2500);
        }
        touch.current = null;
      }}
      onTouchCancel={() => {
        touch.current = null;
      }}
    >
      <div className="present-top" aria-label="発表の操作">
        <span>
          VHSlide <span className="present-deck-title">/ {deck.title}</span>
        </span>
        <div>
          <button
            className="quiet"
            aria-label="全画面切り替え"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else
                void document.documentElement
                  .requestFullscreen?.()
                  .catch(() => {});
            }}
          >
            <Maximize size={18} />
          </button>
          <button className="quiet" onClick={exitPresent}>
            <X size={18} />
            発表をおわる
          </button>
        </div>
      </div>
      <div className={`present-slide enter-${direction}`} key={slide.id}>
        <Canvas slide={slide} zoom={zoom} />
      </div>
      <div className="present-bottom">
        <div
          className="minimap"
          aria-label="現在地マップ"
          style={{ gridTemplateColumns: `repeat(${size.cols}, 10px)` }}
        >
          {Array.from({ length: size.rows }, (_, y) =>
            Array.from({ length: size.cols }, (_, x) => {
              const s = cells.get(`${x},${y}`);
              return (
                <span
                  key={`${x}-${y}`}
                  ref={s?.id === slide.id ? currentCell : undefined}
                  className={`${s ? "occupied" : ""} ${s?.id === slide.id ? "current" : ""}`}
                  title={s?.title}
                />
              );
            }),
          )}
          <span
            className="minimap-caption"
            style={{ gridColumn: `1 / ${size.cols + 1}` }}
          >
            {slide.y + 1}.{slide.x + 1} 現在地
          </span>
        </div>
        <span className="present-caption">
          {slide.title}
          <small>マウスを上下の端へ · タッチは画面をタップ</small>
        </span>
        <div className="navigation-pad">
          <button
            aria-label="上のページ"
            disabled={!neighbor(deck, slide, 0, -1)}
            onClick={() => go(0, -1)}
          >
            <ArrowUp size={21} />
          </button>
          <div>
            <button
              aria-label="前の話題"
              disabled={!neighbor(deck, slide, -1, 0)}
              onClick={() => go(-1, 0)}
            >
              <ArrowLeft size={21} />
            </button>
            <button
              aria-label="下のページ"
              disabled={!neighbor(deck, slide, 0, 1)}
              onClick={() => go(0, 1)}
            >
              <ArrowDown size={21} />
            </button>
            <button
              aria-label="次の話題"
              disabled={!neighbor(deck, slide, 1, 0)}
              onClick={() => go(1, 0)}
            >
              <ArrowRight size={21} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
