import { useContext, useEffect, useRef, useState } from "react";
import { useActivityPanel } from "./ActivitiesPanel";
import { WorksheetContext, useWorksheets } from "./WorksheetContext";
import { SurveySlideContext } from "./SurveySlideContext";
import type { Deck, Slide } from "./model";
import { sheetList } from "./workbook";
import { Canvas } from "./Canvas";
import { api } from "./cloud";
import type { GalleryCard, ResponseGallery } from "./responseGallery";
export function ResponseGalleryCard({
  card,
  slide,
}: {
  card: GalleryCard;
  slide: Slide;
}) {
  const ctx = useWorksheets(),
    survey = useContext(SurveySlideContext);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <WorksheetContext.Provider
      value={{ ...ctx, host: false, readOnly: true, sheets: card.worksheets }}
    >
      <SurveySlideContext.Provider
        value={{ ...survey, readOnly: true, surveys: card.surveys }}
      >
        <div ref={ref} className="gallery-slide">
          <Canvas slide={slide} surveyInteractive zoom={width / 960} />
        </div>
      </SurveySlideContext.Provider>
    </WorksheetContext.Provider>
  );
}
export function ResponseGalleryPanel({
  deck,
  onOpenGallery,
}: {
  deck: Deck;
  onOpenGallery: () => void;
}) {
  const activity = useActivityPanel(),
    ctx = useWorksheets();
  const active = activity.open && activity.active === "gallery";
  const [preview, setPreview] = useState<ResponseGallery | null>(null),
    [published, setPublished] = useState<ResponseGallery | null>(null),
    [publishedList, setPublishedList] = useState<ResponseGallery[]>([]),
    [error, setError] = useState(""),
    [names, setNames] = useState(false),
    [live, setLive] = useState(false),
    [all, setAll] = useState(true),
    [selected, setSelected] = useState<string[]>([]),
    [compare, setCompare] = useState<string[]>([]),
    [enlarged, setEnlarged] = useState<string>(),
    [busy, setBusy] = useState(false),
    [columns, setColumns] = useState(2),
    [selectedSlideId, setSelectedSlideId] = useState<string>();
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  const [compareOnly, setCompareOnly] = useState(false);
  const endpoint = `/api/decks/${ctx.deckId}/gallery`;
  useEffect(() => {
    if (!active || !ctx.enabled) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    async function tick() {
      const version = generation.current;
      try {
        const data = await api<{
          gallery: ResponseGallery | null;
          galleries?: ResponseGallery[];
        }>(endpoint);
        if (!stopped && version === generation.current) {
          setPublished(data.gallery);
          setPublishedList(
            data.galleries ?? (data.gallery ? [data.gallery] : []),
          );
          setError("");
        }
      } catch (e) {
        if (!stopped && version === generation.current) {
          setPublished(null);
          setPublishedList([]);
          setError((e as Error).message);
        }
      }
      if (!stopped) timer = setTimeout(tick, 3000);
    }
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, ctx.enabled, endpoint]);
  const sheets = sheetList(deck);
  const candidates = deck.slides
    .filter((slide) =>
      slide.elements.some((element) =>
        [element.responseField, element.worksheet, element.survey].some(
          (binding) => !!binding && binding.deckId === ctx.deckId,
        ),
      ),
    )
    .sort(
      (a, b) =>
        sheets.findIndex((sheet) => sheet.id === (a.sheetId ?? "main")) -
          sheets.findIndex((sheet) => sheet.id === (b.sheetId ?? "main")) ||
        a.y - b.y ||
        a.x - b.x,
    );
  const chosen = candidates.find((slide) => slide.id === selectedSlideId);
  async function action(
    command: "preview" | "publish" | "stop",
    target?: Slide,
  ) {
    if (command !== "stop" && !target) return;
    if (command === "preview") {
      setSelectedSlideId(target!.id);
      setPreview(null);
      setSelected([]);
      setCompare([]);
      setCompareOnly(false);
      setPage(0);
      setEnlarged(undefined);
    }
    setBusy(true);
    setError("");
    const version = ++generation.current;
    try {
      const data = await api<{
        gallery: ResponseGallery | null;
        galleries?: ResponseGallery[];
      }>(`${endpoint}/${command}`, {
        method: "POST",
        body: JSON.stringify({
          slide: target,
          ...(command === "publish" ? { append: true } : {}),
          ...(command === "stop" && target ? { slideId: target.id } : {}),
          participants: command === "preview" || all ? null : selected,
          names,
          live,
        }),
      });
      if (version !== generation.current) return;
      if (command === "preview") {
        setPreview(data.gallery);
        setCompare([]);
      } else {
        setPublished(data.galleries?.[0] ?? data.gallery);
        setPublishedList(
          data.galleries ?? (data.gallery ? [data.gallery] : []),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!active) return null;
  const gallery = ctx.host ? preview : null;
  const cards = gallery?.cards ?? [];
  const displayed =
    compareOnly && compare.length
      ? cards.filter((c) => compare.includes(c.id))
      : cards;
  const pageCount = Math.max(1, Math.ceil(displayed.length / 24));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = displayed.slice(currentPage * 24, (currentPage + 1) * 24);
  const large = cards.find((c) => c.id === enlarged);
  return (
    <section className="response-gallery">
      <h3>スライドで回答を共有</h3>
      {ctx.host ? (
        <>
          <p>
            フォームがあるスライドを選ぶと、各参加者の保存した回答をプレビューできます。プレビューはホストだけに見えます。スライドは１枚ずつ共有に追加でき、最大50枚まで共有できます。
          </p>
          {candidates.length ? (
            <div
              className="gallery-slide-picker"
              aria-label="回答を表示するスライド"
              role="region"
              tabIndex={0}
            >
              {candidates.map((candidate) => {
                const sheet = sheets.find(
                  (item) => item.id === (candidate.sheetId ?? "main"),
                );
                const label = `${sheet?.name ?? "シート"}・${candidate.y + 1}.${candidate.x + 1} ${candidate.title || "無題"}`;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className="gallery-slide-choice"
                    aria-label={`${label} の回答をプレビュー`}
                    aria-pressed={candidate.id === selectedSlideId}
                    disabled={busy || !ctx.enabled}
                    onClick={() => void action("preview", candidate)}
                  >
                    <span className="gallery-slide-thumb" aria-hidden="true">
                      <Canvas slide={candidate} zoom={192 / 960} />
                    </span>
                    <span className="gallery-slide-label">{label}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p>
              回答をプレビューするには、スライドにフォームを配置してください。
            </p>
          )}
          <div className="gallery-controls">
            <label>
              <input
                type="checkbox"
                checked={names}
                onChange={(e) => setNames(e.target.checked)}
              />
              氏名を表示（未選択なら匿名）
            </label>
            <label>
              <input
                type="checkbox"
                checked={live}
                onChange={(e) => setLive(e.target.checked)}
              />
              保存された回答を自動更新
            </label>
            <label>
              <input
                type="checkbox"
                checked={all}
                onChange={(e) => setAll(e.target.checked)}
              />
              全員を共有{live ? "（今後の回答も含む）" : ""}
            </label>
            <button
              className="button primary"
              disabled={
                busy || !preview || !chosen || (!all && !selected.length)
              }
              onClick={() => void action("publish", preview?.slide)}
            >
              選択したスライドの回答を全員に共有
            </button>
            <button
              className="button outline"
              disabled={busy || !published}
              onClick={() => void action("stop")}
            >
              すべての共有を停止
            </button>
          </div>
          <p role="status">
            {publishedList.length
              ? `共有中：${publishedList.length}枚`
              : "現在、参加者には公開していません。"}{" "}
            メールアドレスは共有されません。
          </p>
          {publishedList.length > 0 && (
            <button
              className="button outline"
              onClick={() => {
                activity.close();
                onOpenGallery();
              }}
            >
              共有された回答を開く
            </button>
          )}
          {publishedList.length > 0 && (
            <div
              className="gallery-published-list"
              aria-label="共有中のスライド"
            >
              {publishedList.map((item) => (
                <div key={item.slide.id}>
                  <span>
                    {item.slide.title || "無題"}（{item.cards.length}人・
                    {item.names ? "氏名あり" : "匿名"}・
                    {item.live ? "自動更新" : "共有時点の回答"}）
                  </span>
                  <button
                    className="button outline"
                    disabled={busy}
                    onClick={() => void action("stop", item.slide)}
                  >
                    このスライドの共有を停止
                  </button>
                </div>
              ))}
            </div>
          )}
          {preview && (
            <p>
              選択したスライドのプレビュー：{preview.cards.length}
              人。公開後のレイアウトは共有時点の状態です。ページを変更した場合は再度共有してください。
            </p>
          )}
        </>
      ) : (
        <div>
          <p>
            {publishedList.length
              ? `${publishedList.length}枚の回答スライドが共有されています。`
              : "ホストが共有すると、ここから回答スライドを閲覧できます。"}
          </p>
          <button
            className="button primary"
            disabled={!publishedList.length}
            onClick={() => {
              activity.close();
              onOpenGallery();
            }}
          >
            共有された回答を開く
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {gallery && (
        <>
          <div className="gallery-controls">
            <label>
              表示列数
              <select
                value={columns}
                onChange={(e) => setColumns(Number(e.target.value))}
              >
                <option value={1}>1列</option>
                <option value={2}>2列</option>
                <option value={3}>3列</option>
              </select>
            </label>
            <span>比較する回答を最大4件選べます。</span>
            {compare.length > 0 && (
              <>
                <button onClick={() => setCompareOnly(true)}>
                  選択した回答を比較
                </button>
                <button
                  onClick={() => {
                    setCompare([]);
                    setCompareOnly(false);
                  }}
                >
                  比較を解除
                </button>
              </>
            )}
          </div>
          <div
            className="gallery-grid"
            style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}
          >
            {visible.map((card) => (
              <article className="gallery-card" key={card.id}>
                <header>
                  <strong>{card.name}</strong>
                  {ctx.host && card.email && <small>{card.email}</small>}
                  <button onClick={() => setEnlarged(card.id)}>拡大</button>
                </header>
                <ResponseGalleryCard card={card} slide={gallery.slide} />
                <footer>
                  {ctx.host && !all && (
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(card.id)}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, card.id]
                              : ids.filter((id) => id !== card.id),
                          )
                        }
                      />
                      この回答を共有
                    </label>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      disabled={
                        !compare.includes(card.id) && compare.length >= 4
                      }
                      checked={compare.includes(card.id)}
                      onChange={(e) =>
                        setCompare((ids) =>
                          e.target.checked
                            ? [...ids, card.id]
                            : ids.filter((id) => id !== card.id),
                        )
                      }
                    />
                    比較
                  </label>
                </footer>
              </article>
            ))}
          </div>
          {pageCount > 1 && (
            <nav aria-label="回答スライドのページ">
              <button
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                前の回答
              </button>
              <span>
                {currentPage + 1} / {pageCount}ページ
              </span>
              <button
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                次の回答
              </button>
            </nav>
          )}
          {!cards.length && (
            <p>選択したスライドの入力欄への保存済み回答はありません。</p>
          )}
        </>
      )}
      {large && gallery && (
        <div
          className="gallery-enlarged"
          role="dialog"
          aria-modal="true"
          aria-label="回答スライドの拡大"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setEnlarged(undefined);
            }
          }}
        >
          <button
            autoFocus
            className="button outline"
            onClick={() => setEnlarged(undefined)}
          >
            拡大表示を閉じる
          </button>
          <h3>{large.name}</h3>
          <ResponseGalleryCard card={large} slide={gallery.slide} />
        </div>
      )}
    </section>
  );
}
