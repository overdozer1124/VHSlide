import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./cloud";
import { useWorksheets } from "./WorksheetContext";
import { ResponseGalleryCard } from "./ResponseGalleryPanel";
import type { ResponseGallery } from "./responseGallery";

/** A read-only workspace for the publicly shared response cards. */
export function ResponseGalleryView({ onClose }: { onClose: () => void }) {
  const { deckId, enabled } = useWorksheets();
  const [galleries, setGalleries] = useState<ResponseGallery[]>([]);
  const [selected, setSelected] = useState("");
  const [cardId, setCardId] = useState<string>();
  const [zoom, setZoom] = useState(100);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) {
      setGalleries([]);
      setSelected("");
      setCardId(undefined);
      return;
    }
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const data = await api<{
          gallery: ResponseGallery | null;
          galleries?: ResponseGallery[];
        }>(`/api/decks/${deckId}/gallery`);
        if (!stopped) {
          const next = data.galleries ?? (data.gallery ? [data.gallery] : []);
          setGalleries(next);
          setSelected((id) =>
            next.some((item) => item.slide.id === id)
              ? id
              : (next[0]?.slide.id ?? ""),
          );
          setError("");
        }
      } catch (e) {
        if (!stopped) {
          setGalleries([]);
          setError((e as Error).message);
        }
      }
      if (!stopped) timer = setTimeout(refresh, 3000);
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [deckId, enabled]);
  const gallery = galleries.find((g) => g.slide.id === selected);
  const cards = gallery?.cards ?? [];
  const active = cards.find((card) => card.id === cardId);
  const count = Math.max(1, Math.ceil(cards.length / 24));
  const current = Math.min(page, count - 1);
  const visible = cards.slice(current * 24, (current + 1) * 24);
  const columns = Math.max(1, Math.ceil(Math.sqrt(visible.length)));
  return createPortal(
    <section
      className="response-workspace"
      aria-label="共有された回答スライド"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          if (cardId) setCardId(undefined);
          else onClose();
        }
        if (e.key === "Tab") {
          const items = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),select:not(:disabled),[tabindex="0"]',
            ),
          );
          if (!items.length) return;
          const first = items[0],
            last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <header className="response-workspace-toolbar">
        <button
          className="button outline"
          autoFocus
          onClick={active ? () => setCardId(undefined) : onClose}
        >
          {active ? "回答一覧へ" : "作品に戻る"}
        </button>
        <strong>共有された回答スライド{active ? "・閲覧のみ" : ""}</strong>
        <label>
          スライドを選択
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setCardId(undefined);
              setPage(0);
            }}
          >
            {galleries.map((item, index) => (
              <option key={item.slide.id} value={item.slide.id}>
                {index + 1}. {item.slide.title || "無題"}
              </option>
            ))}
          </select>
        </label>
        {!active && (
          <div className="response-workspace-zoom" aria-label="表示倍率">
            <button
              aria-label="縮小"
              onClick={() => setZoom((value) => Math.max(50, value - 25))}
              disabled={zoom <= 50}
            >
              −
            </button>
            <span>{zoom}%</span>
            <button
              aria-label="拡大"
              onClick={() => setZoom((value) => Math.min(200, value + 25))}
              disabled={zoom >= 200}
            >
              ＋
            </button>
          </div>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      {!gallery ? (
        <p>共有されている回答スライドはありません。</p>
      ) : active ? (
        <div className="response-workspace-reader">
          <aside className="response-workspace-rail" aria-label="回答一覧">
            {visible.map((card) => (
              <div
                key={card.id}
                className="response-workspace-rail-card"
                role="button"
                tabIndex={0}
                aria-label={`${card.name}の回答を閲覧`}
                aria-current={card.id === active.id ? "page" : undefined}
                onClick={() => setCardId(card.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setCardId(card.id);
                  }
                }}
              >
                <div aria-hidden="true">
                  <ResponseGalleryCard card={card} slide={gallery.slide} />
                </div>
                <strong>{card.name}</strong>
              </div>
            ))}
          </aside>
          <main className="response-workspace-detail">
            <h2>{active.name}</h2>
            <div className="response-workspace-detail-slide">
              <ResponseGalleryCard card={active} slide={gallery.slide} />
            </div>
          </main>
        </div>
      ) : (
        <main className="response-workspace-map">
          <p>
            {gallery.slide.title || "無題"} · {cards.length}人の回答
          </p>
          <div
            className="response-workspace-grid"
            style={{
              gridTemplateColumns: `repeat(${columns}, ${Math.round((280 * zoom) / 100)}px)`,
            }}
          >
            {visible.map((card) => (
              <article
                key={card.id}
                className="response-workspace-card"
                role="button"
                tabIndex={0}
                aria-label={`${card.name}の回答を閲覧`}
                onClick={() => setCardId(card.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setCardId(card.id);
                  }
                }}
              >
                <div aria-hidden="true">
                  <ResponseGalleryCard card={card} slide={gallery.slide} />
                </div>
                <strong>{card.name}</strong>
              </article>
            ))}
          </div>
          {!cards.length && <p>共有された回答はまだありません。</p>}
          {count > 1 && (
            <nav aria-label="回答のページ">
              <button disabled={!current} onClick={() => setPage(current - 1)}>
                前へ
              </button>
              <span>
                {current + 1} / {count}
              </span>
              <button
                disabled={current >= count - 1}
                onClick={() => setPage(current + 1)}
              >
                次へ
              </button>
            </nav>
          )}
        </main>
      )}
    </section>,
    document.body,
  );
}
