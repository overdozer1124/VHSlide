import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Canvas } from "./Canvas";
import { W, type Deck, type Slide } from "./model";
import { api, type CloudWorkspace } from "./cloud";
import { useWorksheets } from "./WorksheetContext";
import { usePageVisible } from "./usePageVisible";
import { WorksheetResults } from "./WorksheetResults";
import type { WorksheetView } from "./worksheets";
import { worksheetCsv } from "./worksheetCsv";
import { ResponseGalleryCard } from "./ResponseGalleryPanel";
import type { ResponseGallery } from "./responseGallery";
import {
  consoleDefaultSheet,
  consoleInitialSlide,
  consoleSheets,
  consoleSlides,
  fieldAnswered,
} from "./teacherConsole";

type ConsoleMode = "list" | "fields" | "slides";

/**
 * Host-only monitoring view for use in a separate tab while another tab
 * drives the follow projection. Answers come first; slides are only
 * thumbnails here. Everything is local to this tab and never touches the
 * shared document or the follow target.
 */
export function TeacherConsole({
  workbook,
  cloud,
  onClose,
}: {
  workbook: Deck;
  cloud: CloudWorkspace;
  onClose: () => void;
}) {
  const follow = cloud.follow;
  const sheets = consoleSheets(workbook);
  const [sheetId, setSheetId] = useState(() =>
    consoleDefaultSheet(workbook, follow),
  );
  const slides = consoleSlides(workbook, sheetId);
  const [focusId, setFocusId] = useState(() =>
    consoleInitialSlide(workbook, follow),
  );
  const focus = slides.find((s) => s.id === focusId) ?? slides[0];
  const projected =
    follow.active && follow.target.mode === "page"
      ? workbook.slides.find((s) => s.id === follow.target.pageId)
      : undefined;

  function jumpToProjected() {
    if (!projected) return;
    setSheetId(projected.sheetId ?? "main");
    setFocusId(projected.id);
  }

  return (
    <section className="teacher-console" aria-label="授業コンソール">
      <header className="console-bar">
        <strong>授業コンソール</strong>
        <span className="console-safe">
          この画面の操作は、生徒の画面に影響しません
        </span>
        {follow.active ? (
          <button
            type="button"
            className="console-now"
            onClick={jumpToProjected}
            disabled={!projected}
            title="投影中のスライドを選びます"
          >
            投影中：
            {follow.target.mode === "map"
              ? `全体マップ（${sheets.find((s) => s.id === follow.target.sheetId)?.name ?? ""}）`
              : (projected?.title ?? "（削除されたページ）")}
          </button>
        ) : (
          <span className="console-now is-idle">集合していません</span>
        )}
        <button type="button" className="button outline" onClick={onClose}>
          <X size={15} />
          閉じる
        </button>
      </header>
      <div className="console-body">
        <aside className="console-slides" aria-label="スライド一覧">
          {sheets.length > 1 && (
            <select
              aria-label="シートを選ぶ"
              value={sheetId}
              onChange={(e) => {
                setSheetId(e.target.value);
                setFocusId(consoleSlides(workbook, e.target.value)[0]?.id);
              }}
            >
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {slides.map((s) => {
            const isProjected = projected?.id === s.id;
            const isFocus = focus?.id === s.id;
            return (
              <button
                key={s.id}
                type="button"
                className={`console-thumb ${isFocus ? "is-preview" : ""}`}
                onClick={() => setFocusId(s.id)}
                aria-pressed={isFocus}
              >
                <span className="console-thumb-canvas">
                  <Canvas slide={s} zoom={148 / W} />
                </span>
                <span className="console-thumb-label">
                  <span>
                    {s.x + 1}.{s.y + 1} {s.title}
                  </span>
                  {isProjected && (
                    <span className="console-badge">投影中</span>
                  )}
                </span>
              </button>
            );
          })}
          {!slides.length && <p>このシートにはスライドがありません。</p>}
        </aside>
        <ConsoleMain cloud={cloud} focus={focus} />
      </div>
    </section>
  );
}

function ConsoleMain({
  cloud,
  focus,
}: {
  cloud: CloudWorkspace;
  focus?: Slide;
}) {
  const ctx = useWorksheets();
  const visible = usePageVisible();
  const [mode, setMode] = useState<ConsoleMode>("list");
  const [worksheetId, setWorksheetId] = useState("");
  const [downloading, setDownloading] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!ctx.enabled || !visible) return;
    void ctx.refresh().catch(() => {});
    const timer = setInterval(
      () => void ctx.refresh().catch(() => {}),
      5000,
    );
    return () => clearInterval(timer);
  }, [ctx.enabled, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheet =
    ctx.sheets.find((s) => s.id === worksheetId) ?? ctx.sheets[0];
  async function download(order: string[]) {
    if (!sheet || downloading) return;
    setDownloading(true);
    try {
      const fresh = await ctx.refresh();
      const target = fresh.find((s) => s.id === sheet.id);
      if (!target || !alive.current) return;
      if (target.results && order.length) {
        const rank = new Map(order.map((id, i) => [id, i]));
        target.results = {
          responses: [...target.results.responses].sort(
            (a, b) =>
              (rank.get(a.respondentId) ?? Number.MAX_SAFE_INTEGER) -
              (rank.get(b.respondentId) ?? Number.MAX_SAFE_INTEGER),
          ),
        };
      }
      const url = URL.createObjectURL(
        new Blob([worksheetCsv(target)], {
          type: "text/csv;charset=utf-8",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${target.title}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* The worksheet panel surfaces refresh errors; the console stays quiet. */
    } finally {
      if (alive.current) setDownloading(false);
    }
  }

  const modes: { key: ConsoleMode; label: string }[] = [
    { key: "list", label: "回答一覧" },
    { key: "fields", label: "設問ごとの集計" },
    { key: "slides", label: "生徒のスライド" },
  ];
  return (
    <main className="console-main">
      <div className="console-modes" role="tablist" aria-label="表示切替">
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            className={mode === m.key ? "active" : ""}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === "slides" ? (
        <ConsoleStudentSlides focus={focus} />
      ) : !ctx.enabled ? (
        <p className="console-note">
          クラウドの作品を開くと、ワークシートの回答がここに表示されます。
        </p>
      ) : !sheet ? (
        <p className="console-note">
          この作品にはワークシートがありません。
        </p>
      ) : (
        <>
          <div className="console-answer-head">
            {ctx.sheets.length > 1 && (
              <select
                aria-label="ワークシートを選ぶ"
                value={sheet.id}
                onChange={(e) => setWorksheetId(e.target.value)}
              >
                {ctx.sheets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            )}
            <p className="console-answer-status">
              {sheet.title}：
              {sheet.status === "open"
                ? "受付中"
                : sheet.status === "closed"
                  ? "受付は終了"
                  : "下書き（受付前）"}
              ／ 回答した生徒 {sheet.results?.responses.length ?? 0}人
            </p>
          </div>
          {mode === "list" ? (
            <WorksheetResults
              sheet={sheet}
              busy={downloading}
              onDownload={(order) => void download(order)}
              initialView="table"
            />
          ) : (
            <ConsoleFields cloud={cloud} sheet={sheet} />
          )}
        </>
      )}
    </main>
  );
}

function ConsoleFields({
  cloud,
  sheet,
}: {
  cloud: CloudWorkspace;
  sheet: WorksheetView;
}) {
  const responses = sheet.results?.responses ?? [];
  const respondentIds = new Set(responses.map((r) => r.respondentId));
  const waiting = cloud.members.filter(
    (m) => m.id !== cloud.user?.id && !respondentIds.has(m.id),
  );
  return (
    <div className="console-fields">
      {waiting.length > 0 && (
        <p className="console-waiting">
          まだの人：{waiting.map((m) => m.name).join("、")}
        </p>
      )}
      {sheet.fields.map((field) => {
        const count = responses.filter((r) =>
          fieldAnswered(r.values, field.id),
        ).length;
        const summary = sheet.summaries?.[field.id];
        return (
          <article className="console-field" key={field.id}>
            <strong>{field.label}</strong>
            <span>
              {count}/{responses.length}人
            </span>
            {(field.kind === "single" || field.kind === "multiple") &&
              summary &&
              field.options.map((option, i) => (
                <div className="console-field-row" key={i}>
                  <span>{option}</span>
                  <progress
                    max={Math.max(1, summary.count)}
                    value={summary.counts[i] ?? 0}
                    aria-label={`${field.label}：${option}`}
                  />
                  <span>{summary.counts[i] ?? 0}件</span>
                </div>
              ))}
          </article>
        );
      })}
      {!sheet.fields.length && <p>設問がありません。</p>}
    </div>
  );
}

/** Per-student renderings of the focused slide, via the gallery preview API. */
function ConsoleStudentSlides({ focus }: { focus?: Slide }) {
  const ctx = useWorksheets();
  const visible = usePageVisible();
  const [gallery, setGallery] = useState<ResponseGallery | null>(null);
  const [error, setError] = useState("");
  const [enlargedId, setEnlargedId] = useState<string>();
  const slideRef = useRef(focus);
  slideRef.current = focus;
  const deckId = ctx.deckId;
  const hasForm = !!(
    focus &&
    deckId &&
    focus.elements.some((e) =>
      [e.responseField, e.worksheet, e.survey].some(
        (b) => !!b && b.deckId === deckId,
      ),
    )
  );
  useEffect(() => {
    setGallery(null);
    setEnlargedId(undefined);
    setError("");
    if (!focus || !deckId || !hasForm || !visible) return;
    let stopped = false;
    const load = async () => {
      try {
        const data = await api<{ gallery: ResponseGallery | null }>(
          `/api/decks/${deckId}/gallery/preview`,
          {
            method: "POST",
            body: JSON.stringify({
              slide: slideRef.current,
              participants: null,
              names: true,
              live: false,
            }),
          },
        );
        if (!stopped) {
          setGallery(data.gallery);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [focus?.id, deckId, hasForm, visible]);

  if (!focus)
    return <p className="console-note">スライドがありません。</p>;
  if (!hasForm)
    return (
      <p className="console-note">
        「{focus.title}」には回答欄がありません。左の一覧で、回答欄のあるスライドを選んでください。
      </p>
    );
  const cards = gallery?.cards ?? [];
  const enlarged = cards.find((c) => c.id === enlargedId);
  return (
    <div className="console-students">
      <p className="console-answer-status">
        「{focus.title}」への生徒の回答（{cards.length}人）
      </p>
      {error && <p className="console-waiting">{error}</p>}
      {!error && !cards.length && (
        <p className="console-note">まだ回答がありません。</p>
      )}
      <div className="console-cards">
        {cards.map((card) => (
          <article
            className="console-card"
            key={card.id}
            onClick={() => setEnlargedId(card.id)}
            title="クリックで拡大"
          >
            <span className="console-card-name">{card.name}</span>
            <ResponseGalleryCard card={card} slide={focus} />
          </article>
        ))}
      </div>
      {enlarged && (
        <div
          className="console-enlarged"
          role="dialog"
          aria-modal="true"
          aria-label={`${enlarged.name}の回答`}
          onClick={() => setEnlargedId(undefined)}
        >
          <div
            className="console-enlarged-box"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <strong>{enlarged.name}</strong>
              <button
                type="button"
                className="button outline"
                onClick={() => setEnlargedId(undefined)}
              >
                <X size={15} />
                閉じる
              </button>
            </header>
            <ResponseGalleryCard card={enlarged} slide={focus} />
          </div>
        </div>
      )}
    </div>
  );
}
