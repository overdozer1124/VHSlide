import { useEffect, useRef, useState } from "react";
import type { Deck, Slide } from "./model";
import type { PublicFollowState } from "./hostFollow";
import { Canvas } from "./Canvas";
import { useFitCanvas } from "./useFitCanvas";
export function HostFollowView({
  book,
  state,
}: {
  book: Deck;
  state: Extract<PublicFollowState, { active: true }>;
}) {
  const pages = book.slides.filter(
      (p) => (p.sheetId ?? "main") === state.target.sheetId,
    ),
    page = pages.find((p) => p.id === state.target.pageId);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(timer);
  }, []);
  return (
    <section
      className="host-follow-overlay"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="ホストの画面"
      data-mode={state.target.mode}
    >
      <header>
        <strong>{state.host.name}さんの画面を表示中</strong>
        <span>ページ移動・編集はホストが終了するまでできません。</span>
      </header>
      <p className="host-follow-notice" role="status">
        ホストが集合をかけました。編集中の内容はそのまま保持されています。
      </p>
      {!ready ? (
        <div className="host-follow-wait" role="status">
          ホストの画面へ切り替えます…
        </div>
      ) : state.target.mode === "map" ? (
        <FollowMap book={book} state={state} />
      ) : (
        <FollowPage page={page} />
      )}
    </section>
  );
}
// Mount the measuring ref with the actual page, after the initial notice and map views.
function FollowPage({ page }: { page?: Slide }) {
  return page ? (
    <FittedFollowPage page={page} />
  ) : (
    <div className="host-follow-page">
      <p role="status">ホストのページを読み込んでいます…</p>
    </div>
  );
}
function FittedFollowPage({ page }: { page: Slide }) {
  const frame = useRef<HTMLDivElement>(null),
    zoom = useFitCanvas(frame, 0, 0);
  return (
    <div className="host-follow-page" data-follow-page={page.id}>
      <p>
        {page.y + 1}.{page.x + 1}　{page.title}
      </p>
      <div ref={frame} className="host-follow-canvas">
        <Canvas slide={page} zoom={zoom} />
      </div>
    </div>
  );
}
function FollowMap({
  book,
  state,
}: {
  book: Deck;
  state: Extract<PublicFollowState, { active: true }>;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    [view, setView] = useState({ left: 0, top: 0, width: 1400, height: 800 });
  const pages = book.slides.filter(
      (s) => (s.sheetId ?? "main") === state.target.sheetId,
    ),
    cols = Math.max(1, ...pages.map((s) => s.x + 1)),
    rows = Math.max(1, ...pages.map((s) => s.y + 1));
  const sheet = book.sheets?.find((s) => s.id === state.target.sheetId);
  useEffect(() => {
    const n = viewport.current;
    if (!n) return;
    const update = () =>
      setView({
        left: n.scrollLeft,
        top: n.scrollTop,
        width: n.clientWidth,
        height: n.clientHeight,
      });
    const observer = new ResizeObserver(update);
    observer.observe(n);
    update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const n = viewport.current,
      p = pages.find((s) => s.id === state.target.pageId);
    if (n && !p) n.scrollTo({ left: 0, top: 0 });
    if (n && p)
      n.scrollTo({
        left: Math.max(0, 54 + p.x * 240 - n.clientWidth / 2 + 110),
        top: Math.max(0, 48 + p.y * 170 - n.clientHeight / 2 + 75),
      });
  }, [state.target.pageId, state.target.sheetId]);
  const x0 = Math.max(0, Math.floor((view.left - 54) / 240) - 1),
    x1 = Math.min(cols - 1, Math.ceil((view.left + view.width) / 240)),
    y0 = Math.max(0, Math.floor((view.top - 48) / 170) - 1),
    y1 = Math.min(rows - 1, Math.ceil((view.top + view.height) / 170));
  return (
    <div
      className="host-follow-map"
      ref={viewport}
      aria-label="ホストの全体マップ"
      onScroll={(e) => {
        const n = e.currentTarget;
        setView({
          left: n.scrollLeft,
          top: n.scrollTop,
          width: n.clientWidth,
          height: n.clientHeight,
        });
      }}
    >
      <div
        style={{
          position: "relative",
          width: cols * 240 + 54,
          height: rows * 170 + 48,
        }}
      >
        {Array.from({ length: x1 - x0 + 1 }, (_, i) => i + x0).map((x) => (
          <div
            className="follow-column-heading"
            key={x}
            style={{ left: 54 + x * 240 }}
          >
            {x + 1}　{sheet?.columnLabels?.[x] ?? `話題 ${x + 1}`}
          </div>
        ))}
        {Array.from({ length: y1 - y0 + 1 }, (_, i) => i + y0).map((y) => (
          <div
            className="follow-row-heading"
            key={y}
            style={{ top: 48 + y * 170 }}
          >
            {y + 1}
            <br />
            {sheet?.rowLabels?.[y] ?? ""}
          </div>
        ))}
        {pages
          .filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1)
          .map((p) => (
            <figure
              key={p.id}
              className="follow-map-card"
              data-follow-page={p.id}
              data-host-focus={p.id === state.target.pageId}
              style={{ left: 54 + p.x * 240, top: 48 + p.y * 170 }}
            >
              <Canvas slide={p} zoom={220 / 960} />
              <figcaption>
                {p.y + 1}.{p.x + 1}　{p.title}
              </figcaption>
            </figure>
          ))}
      </div>
    </div>
  );
}
