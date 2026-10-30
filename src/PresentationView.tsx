import { speakerPreview, type SpeakerState } from "./speakerChannel";
import type { SpeakerLaunch } from "./useSpeakerWindow";
import { useSpeakerWindow } from "./useSpeakerWindow";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Maximize,
  NotebookPen,
  X,
} from "lucide-react";
import type { Deck, Slide } from "./model";
import { bounds, neighbor } from "./model";
import { Canvas } from "./Canvas";
import { useFitCanvas } from "./useFitCanvas";
import { pageOrigin } from "./pageScope";
interface PresentationProps {
  speakerLaunch?: SpeakerLaunch;
  scopeLabel: string;
  scopeCount: number;
  external: boolean;
  pendingLink?: Slide;
  onConfirmLink: () => void;
  onCancelLink: () => void;
  route?: Slide[];
  onOpenLink: (id: string) => void;
  onLinkBack?: () => void;
  deck: Deck;
  slide: Slide;
  direction: string;
  go: (dx: number, dy: number) => void;
  exitPresent: () => void;
}
export function PresentationView({
  speakerLaunch,
  onOpenLink,
  onLinkBack,
  deck,
  slide,
  direction,
  go,
  exitPresent,
  route,
  scopeLabel,
  scopeCount,
  external,
  pendingLink,
  onConfirmLink,
  onCancelLink,
}: PresentationProps) {
  const presentRef = useRef<HTMLDivElement>(null),
    touch = useRef<{ x: number; y: number } | null>(null);
  const zoom = useFitCanvas(presentRef, 0, 0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nearEdge = useRef(false);
  const currentCell = useRef<HTMLSpanElement>(null);
  const linkConfirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pendingLink) return;
    const previous = document.activeElement as HTMLElement | null;
    linkConfirm.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [pendingLink?.id]);
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
  const routeIndex = route?.findIndex((s) => s.id === slide.id) ?? -1;
  const available = (dx: number, dy: number) =>
    !external &&
    !pendingLink &&
    (route
      ? !!route[routeIndex + (dx || dy)]
      : !!neighbor(deck, slide, dx, dy));
  const left = available(-1, 0),
    right = available(1, 0),
    up = available(0, -1),
    down = available(0, 1);
  const speakerState = useMemo<SpeakerState>(
    () => ({
      title: deck.title,
      slideTitle: slide.title,
      position: `${slide.y + 1}.${slide.x + 1}`,
      notes: slide.speakerNotes ?? "",
      preview: speakerPreview(slide),
      available: { left, right, up, down },
    }),
    [deck.title, slide, left, right, up, down],
  );
  const speaker = useSpeakerWindow(speakerState, go, speakerLaunch);
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
      {speaker.error && (
        <div className="speaker-popup-error" role="alert">
          {speaker.error}
        </div>
      )}
      <div className="present-top" aria-label="発表の操作">
        <span>
          VHSlide <span className="present-deck-title">/ {deck.title}</span>
          <small className="present-scope" aria-label="発表対象">
            {scopeLabel}・{scopeCount}ページ
            {external ? " · 対象外のリンク先" : ""}
          </small>
        </span>
        <div>
          <button
            className="quiet"
            aria-label="発表者用ノートを開く"
            title="別ウィンドウでスピーカーノートを確認"
            onClick={speaker.open}
          >
            <NotebookPen size={18} />
            発表者ノート
          </button>
          <button
            className="quiet"
            aria-label="全画面切り替え"
            onClick={() => {
              try {
                if (document.fullscreenElement)
                  void document.exitFullscreen().catch(() => {});
                else
                  void document.documentElement
                    .requestFullscreen?.()
                    .catch(() => {});
              } catch {
                /* Keep presenting in the window. */
              }
            }}
          >
            <Maximize size={18} />
          </button>
          {onLinkBack && (
            <button className="quiet" onClick={onLinkBack}>
              リンク元へ戻る
            </button>
          )}
          <button className="quiet" onClick={exitPresent}>
            <X size={18} />
            発表をおわる
          </button>
        </div>
      </div>
      <div className={`present-slide enter-${direction}`} key={slide.id}>
        <Canvas slide={slide} zoom={zoom} onOpenLink={onOpenLink} />
      </div>
      <div className="present-bottom">
        {external ? (
          <span>発表対象外 · {pageOrigin(deck, slide)}</span>
        ) : route ? (
          <span aria-label="発表ルートの現在地">
            ルート {routeIndex + 1} / {route.length}
          </span>
        ) : (
          <div
            className="minimap"
            aria-label="現在地マップ"
            style={{
              gridTemplateColumns: `repeat(${size.cols}, 10px)`,
              gridTemplateRows: `repeat(${size.rows},10px) auto`,
            }}
          >
            {deck.slides.map((s) => (
              <span
                key={s.id}
                ref={s?.id === slide.id ? currentCell : undefined}
                style={{ gridColumn: s.x + 1, gridRow: s.y + 1 }}
                className={`occupied ${s.id === slide.id ? "current" : ""}`}
                title={s?.title}
              />
            ))}
            <span
              className="minimap-caption"
              style={{
                gridColumn: `1 / ${size.cols + 1}`,
                gridRow: size.rows + 1,
              }}
            >
              {slide.y + 1}.{slide.x + 1} 現在地
            </span>
          </div>
        )}
        <span className="present-caption">
          {slide.title}
          <small>マウスを上下の端へ · タッチは画面をタップ</small>
        </span>
        <div className="navigation-pad">
          <button
            aria-label="上のページ"
            disabled={!available(0, -1)}
            onClick={() => go(0, -1)}
          >
            <ArrowUp size={21} />
          </button>
          <div>
            <button
              aria-label="前の話題"
              disabled={!available(-1, 0)}
              onClick={() => go(-1, 0)}
            >
              <ArrowLeft size={21} />
            </button>
            <button
              aria-label="下のページ"
              disabled={!available(0, 1)}
              onClick={() => go(0, 1)}
            >
              <ArrowDown size={21} />
            </button>
            <button
              aria-label="次の話題"
              disabled={!available(1, 0)}
              onClick={() => go(1, 0)}
            >
              <ArrowRight size={21} />
            </button>
          </div>
        </div>
      </div>
      {pendingLink && (
        <div
          className="present-link-prompt"
          role="dialog"
          aria-label="発表対象外のリンク"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            onCancelLink?.();
          }}
        >
          <strong>発表対象外のページを開きます</strong>
          <p>{pendingLink.title}</p>
          <p>発表の対象は増やさず、リンク元へ戻れます。</p>
          <button
            className="button primary"
            ref={linkConfirm}
            onClick={onConfirmLink}
          >
            リンク先を開く
          </button>
          <button className="button outline" onClick={onCancelLink}>
            発表に戻る
          </button>
        </div>
      )}
    </div>
  );
}
