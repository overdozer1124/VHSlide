import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Minus, Plus, X } from "lucide-react";
import { Canvas } from "./Canvas";
import { usePinch } from "./usePinch";
import { W, type Deck, type Slide } from "./model";
import { api, type CloudWorkspace } from "./cloud";
import type {
  FollowTarget,
  ChartShowRequest,
  EditSlideShowRequest,
} from "./hostFollow";
import { useWorksheets } from "./WorksheetContext";
import { useEditSlides } from "./EditSlideContext";
import { useWebbing } from "./WebbingContext";
import { useThinking } from "./ThinkingContext";
import { ThinkingResults } from "./ThinkingResults";
import { useGroups } from "./GroupsContext";
import type { WebbingNode } from "./webbing";
import { WebbingMini } from "./WebbingMini";
import { usePageVisible } from "./usePageVisible";
import { WorksheetResults } from "./WorksheetResults";
import type { WorksheetField, WorksheetView } from "./worksheets";
import { textMineTexts } from "./textMine";
import { TextMinePanel } from "./TextMinePanel";
import { worksheetCsv } from "./worksheetCsv";
import { ResponseGalleryCard } from "./ResponseGalleryPanel";
import type { ResponseGallery } from "./responseGallery";
import {
  consoleDefaultSheet,
  consoleAdjacentRelevant,
  consoleInitialSlide,
  consoleRows,
  consoleSheets,
  consoleSlides,
  fieldAnswered,
} from "./teacherConsole";

type ConsoleMode = "list" | "fields" | "slides" | "groups" | "thinking";

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
  onOpenGallery,
  groupShow,
  onGroupShow,
  chartShow,
  onChartShow,
  editShow,
  onEditShow,
  initialSlideId,
}: {
  workbook: Deck;
  cloud: CloudWorkspace;
  onClose: () => void;
  /** The slide the editor had open when the console was opened: the
   * console starts there (unless a follow is live). */
  initialSlideId?: string;
  onOpenGallery?: () => void;
  groupShow?: FollowTarget;
  onGroupShow?: (target?: FollowTarget) => void;
  chartShow?: ChartShowRequest;
  onChartShow?: (req?: ChartShowRequest) => void;
  editShow?: EditSlideShowRequest;
  onEditShow?: (req?: EditSlideShowRequest) => void;
}) {
  const follow = cloud.follow;
  const sheets = consoleSheets(workbook);
  const [sheetId, setSheetId] = useState(() =>
    consoleDefaultSheet(workbook, follow, initialSlideId),
  );
  const slides = consoleSlides(workbook, sheetId);
  const [focusId, setFocusId] = useState(() =>
    consoleInitialSlide(workbook, follow, initialSlideId),
  );
  const [expandedRow, setExpandedRow] = useState<number | undefined>(() => {
    const initial = consoleSlides(
      workbook,
      consoleDefaultSheet(workbook, follow, initialSlideId),
    ).find(
      (s) => s.id === consoleInitialSlide(workbook, follow, initialSlideId),
    );
    return initial?.y;
  });
  const focus = slides.find((s) => s.id === focusId) ?? slides[0];
  const projected =
    follow.active && follow.target.mode === "page"
      ? workbook.slides.find((s) => s.id === follow.target.pageId)
      : undefined;
  const { deckId } = useWorksheets();
  const webbingCtx = useWebbing();
  const visible = usePageVisible();
  const [mode, setMode] = useState<ConsoleMode>("list");
  const [onlyRelevant, setOnlyRelevant] = useState(false);
  const [answerCounts, setAnswerCounts] = useState<Record<string, number>>({});
  // Per-slide answer counts (same aggregation as the gallery preview),
  // polled only while the student-slides mode is on screen: they drive
  // the rail highlights and the "only slides with answers" filter.
  useEffect(() => {
    if (mode !== "slides" || !deckId || !visible) return;
    let stopped = false;
    const load = async () => {
      const payload = workbook.slides
        .filter((s) =>
          s.elements.some((e) =>
            [e.responseField, e.worksheet, e.survey].some(
              (b) => !!b && b.deckId === deckId,
            ),
          ),
        )
        .map((s) => ({
          id: s.id,
          elements: s.elements.map((e) => ({
            responseField: e.responseField ?? null,
            worksheet: e.worksheet ?? null,
            survey: e.survey ?? null,
          })),
        }));
      if (!payload.length) {
        if (!stopped) setAnswerCounts({});
        return;
      }
      try {
        const data = await api<{ counts?: Record<string, number> }>(
          `/api/decks/${deckId}/gallery/counts`,
          { method: "POST", body: JSON.stringify({ slides: payload }) },
        );
        if (!stopped) setAnswerCounts(data.counts ?? {});
      } catch {
        /* The highlight is best-effort; the main views surface errors. */
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [mode, deckId, visible, workbook]);
  const hasForm = (s: Slide) =>
    !!deckId &&
    s.elements.some((e) =>
      [e.responseField, e.worksheet, e.survey].some(
        (b) => !!b && b.deckId === deckId,
      ),
    );
  const hasWebbing = (s: Slide) =>
    !!webbingCtx.deckId &&
    s.elements.some(
      (e) => !!e.webbing && e.webbing.deckId === webbingCtx.deckId,
    );

  /** Writings on the slide's maps, not counting the theme roots. */
  const slideWrites = (s: Slide) => {
    let total = 0;
    for (const e of s.elements) {
      if (!e.webbing || e.webbing.deckId !== webbingCtx.deckId) continue;
      const map = webbingCtx.maps.find((m) => m.id === e.webbing!.mapId);
      if (map) total += map.nodes.filter((n) => n.parentId !== null).length;
    }
    return total;
  };
  /** How much student content a slide has in the current mode: saved
   * answers in student-slides mode, map writings in group-map mode. */
  const relevance = (s: Slide) =>
    mode === "slides"
      ? (answerCounts[s.id] ?? 0)
      : mode === "groups"
        ? slideWrites(s)
        : 0;
  const relevantMode = mode === "slides" || mode === "groups";
  const filterActive = onlyRelevant && relevantMode;
  const toggleFilter = () => {
    if (filterActive) {
      setOnlyRelevant(false);
      return;
    }
    setOnlyRelevant(true);
    if (focus && relevance(focus) === 0) {
      const first = slides.find((s) => relevance(s) > 0);
      if (first) {
        setFocusId(first.id);
        setExpandedRow(first.y);
      }
    }
  };

  // Arrow keys step between the slides that have answers while the
  // student-slides view is on screen (spec: console improvement 4).
  useEffect(() => {
    if (mode !== "slides") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      const next = consoleAdjacentRelevant(
        slides,
        (s) => relevance(s) > 0,
        focus?.id,
        e.key === "ArrowRight" ? 1 : -1,
      );
      if (next) {
        e.preventDefault();
        setFocusId(next.id);
        setExpandedRow(next.y);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Switching into the student-slides view: the answered-only
   * filter starts on (its default there) and the focused slide's
   * row starts expanded. */
  const enterMode = (key: ConsoleMode) => {
    setMode(key);
    if (key === "slides") {
      setOnlyRelevant(true);
      if (focus) setExpandedRow(focus.y);
    }
  };

  function jumpToProjected() {
    if (!projected) return;
    setSheetId(projected.sheetId ?? "main");
    setFocusId(projected.id);
    setExpandedRow(projected.y);
  }

  return (
    <section className="teacher-console" aria-label="授業コンソール">
      <header className="console-bar">
        <strong>授業コンソール</strong>
        <span className="console-safe">
          この画面の操作は、生徒の画面に影響しません（回答の共有を除く）
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
                setExpandedRow(undefined);
              }}
            >
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {relevantMode && (
            <button
              type="button"
              className={`console-filter ${filterActive ? "active" : ""}`}
              aria-pressed={filterActive}
              onClick={toggleFilter}
            >
              {mode === "slides"
                ? "回答があるスライドだけ"
                : "書き込みがあるスライドだけ"}
            </button>
          )}
          {consoleRows(slides).map((row) => {
            const shownSlides = filterActive
              ? row.slides.filter((s) => relevance(s) > 0)
              : row.slides;
            if (filterActive && !shownSlides.length) return null;
            const rowRelevant =
              relevantMode && row.slides.some((s) => relevance(s) > 0);
            const expanded = filterActive || expandedRow === row.y;
            const rowForm = row.slides.some(hasForm);
            const rowProjected = projected
              ? row.slides.some((s) => s.id === projected.id)
              : false;
            const rowFocus = focus
              ? row.slides.some((s) => s.id === focus.id)
              : false;
            return (
              <div
                key={row.y}
                className={`console-rail-item ${rowForm ? "has-form" : ""} ${rowRelevant ? "has-answers" : ""}`}
              >
                <button
                  type="button"
                  className={`console-rail-head ${rowFocus ? "is-focus" : ""}`}
                  aria-expanded={expanded}
                  onClick={() =>
                    setExpandedRow(expanded ? undefined : row.y)
                  }
                >
                  <span className="console-rail-title">
                    {row.y + 1}行目：
                    {row.slides.map((s) => s.title).join(" ・ ")}
                  </span>
                  {rowForm && (
                    <span className="console-form-chip">回答欄</span>
                  )}
                  {row.slides.some(hasWebbing) && (
                    <span className="console-form-chip">マップ</span>
                  )}
                  {rowRelevant && (
                    <span className="console-count-chip">
                      {mode === "slides" ? "回答あり" : "書き込みあり"}
                    </span>
                  )}
                  {rowProjected && (
                    <span className="console-badge">投影中</span>
                  )}
                  {expanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
                {expanded &&
                  shownSlides.map((s) => {
                    const isProjected = projected?.id === s.id;
                    const isFocus = focus?.id === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`console-rail-slide ${isFocus ? "is-focus" : ""} ${hasForm(s) ? "has-form" : ""} ${relevantMode && relevance(s) > 0 ? "has-answers" : ""}`}
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
                          {hasForm(s) && (
                            <span className="console-form-chip">回答欄</span>
                          )}
                          {hasWebbing(s) && (
                            <span className="console-form-chip">マップ</span>
                          )}
                          {relevantMode && relevance(s) > 0 && (
                            <span className="console-count-chip">
                              {mode === "slides"
                                ? `回答${relevance(s)}人`
                                : `書き込み${relevance(s)}件`}
                            </span>
                          )}
                          {isProjected && (
                            <span className="console-badge">投影中</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
          {!slides.length && <p>このシートにはスライドがありません。</p>}
          {filterActive && !slides.some((s) => relevance(s) > 0) && (
            <p>
              {mode === "slides"
                ? "回答があるスライドはまだありません。"
                : "書き込みがあるスライドはまだありません。"}
            </p>
          )}
        </aside>
        <ConsoleMain
          cloud={cloud}
          workbook={workbook}
          focus={focus}
          mode={mode}
          setMode={enterMode}
          onOpenGallery={onOpenGallery}
          groupShow={groupShow}
          onGroupShow={onGroupShow}
          chartShow={chartShow}
          onChartShow={onChartShow}
          editShow={editShow}
          onEditShow={onEditShow}
        />
      </div>
    </section>
  );
}

function ConsoleMain({
  cloud,
  workbook,
  focus,
  mode,
  setMode,
  onOpenGallery,
  groupShow,
  onGroupShow,
  chartShow,
  onChartShow,
  editShow,
  onEditShow,
}: {
  cloud: CloudWorkspace;
  workbook: Deck;
  focus?: Slide;
  mode: ConsoleMode;
  setMode: (mode: ConsoleMode) => void;
  onOpenGallery?: () => void;
  groupShow?: FollowTarget;
  onGroupShow?: (target?: FollowTarget) => void;
  chartShow?: ChartShowRequest;
  onChartShow?: (req?: ChartShowRequest) => void;
  editShow?: EditSlideShowRequest;
  onEditShow?: (req?: EditSlideShowRequest) => void;
}) {
  const ctx = useWorksheets();
  const webbingCtx = useWebbing();
  const thinkingCtx = useThinking();
  const visible = usePageVisible();
  // Webbing and thinking share one 5s timer: both refreshes go through
  // the same deck poller, and two timers drifting apart would poll
  // twice per interval (review 2026-11-17 🟡7).
  useEffect(() => {
    if (!visible || (!webbingCtx.enabled && !thinkingCtx.enabled)) return;
    const refreshBoth = () => {
      if (webbingCtx.enabled) void webbingCtx.refresh().catch(() => {});
      if (thinkingCtx.enabled) void thinkingCtx.refresh().catch(() => {});
    };
    refreshBoth();
    const timer = setInterval(refreshBoth, 5000);
    return () => clearInterval(timer);
  }, [webbingCtx.enabled, thinkingCtx.enabled, visible]); // eslint-disable-line react-hooks/exhaustive-deps
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
    ...(webbingCtx.maps.length
      ? [{ key: "groups" as ConsoleMode, label: "グループ別マップ" }]
      : []),
    ...(thinkingCtx.tools.length
      ? [{ key: "thinking" as ConsoleMode, label: "思考ツール" }]
      : []),
  ];
  const showHead =
    (mode === "list" || mode === "fields") && ctx.enabled && !!sheet;
  return (
    <main className="console-main">
      <div className="console-toprow">
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
        {showHead && (
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
        )}
      </div>
      {mode === "slides" ? (
        <>
          <ConsoleStudentSlides focus={focus} onOpenGallery={onOpenGallery} />
          <ConsoleEditSlides
            workbook={workbook}
            focus={focus}
            editShow={editShow}
            onEditShow={onEditShow}
          />
        </>
      ) : mode === "groups" ? (
        <ConsoleGroups
          focus={focus}
          groupShow={groupShow}
          onGroupShow={onGroupShow}
        />
      ) : mode === "thinking" ? (
        <ConsoleThinking
          workbook={workbook}
          chartShow={chartShow}
          onChartShow={onChartShow}
        />
      ) : !ctx.enabled ? (
        <p className="console-note">
          クラウドの作品を開くと、ワークシートの回答がここに表示されます。
        </p>
      ) : !sheet ? (
        <p className="console-note">
          この作品にはワークシートがありません。
        </p>
      ) : mode === "list" ? (
        <WorksheetResults
          sheet={sheet}
          busy={downloading}
          onDownload={(order) => void download(order)}
          initialView="table"
          compact
        />
      ) : (
        <ConsoleFields cloud={cloud} sheet={sheet} />
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
            {field.kind === "text" && (
              <TextMineAnalysis sheet={sheet} field={field} />
            )}
          </article>
        );
      })}
      {!sheet.fields.length && <p>設問がありません。</p>}
    </div>
  );
}

/** 記述回答の言葉の分析。文章の取り出しだけワークシート用で、
 * 分析のパネル自体は思考ツールのカードと共用（TextMinePanel）。 */
function TextMineAnalysis({
  sheet,
  field,
}: {
  sheet: WorksheetView;
  field: WorksheetField;
}) {
  const responses = sheet.results?.responses ?? [];
  const texts = textMineTexts(responses, field.id);
  return (
    <TextMinePanel
      texts={texts}
      idleNote="記述の回答を言葉に分けて、よく出る言葉を人数順に並べます。解析はこの端末の中で行われ、回答が外部へ送られることはありません。"
    />
  );
}

/** Per-student renderings of the focused slide, via the gallery preview
 * API. This is also where the host shares answer slides with the class:
 * the sharing workflow that used to live in the form dialog's
 * 回答スライド tab was consolidated here (0.114.0). */
/** Free-edit slides for the focused slide: each student's own
 * slide as a thumbnail, click to enlarge, plus who has not made
 * theirs yet. Host-only data (the context only carries answers
 * for the host). */
function ConsoleEditSlides({
  workbook,
  focus,
  editShow,
  onEditShow,
}: {
  workbook: Deck;
  focus?: Slide;
  editShow?: EditSlideShowRequest;
  onEditShow?: (req?: EditSlideShowRequest) => void;
}) {
  const ctx = useEditSlides();
  const [large, setLarge] = useState<{
    name: string;
    author: string;
    defId: string;
    slide: Slide;
  } | null>(null);
  // Answer slides arrive as metadata on the poll; the content of
  // each answer is fetched on demand and cached by its updated
  // stamp, so a class saving at once never pushes every slide's
  // content to the console.
  const [contents, setContents] = useState(
    new Map<string, { updated: number; slide: Slide }>(),
  );
  const defs =
    ctx.enabled && ctx.host && focus
      ? ctx.defs.filter((d) => d.source === focus.id)
      : [];
  const metas = defs.map((def) => ({
    def,
    meta: ctx.answersMeta.find((m) => m.id === def.id),
  }));
  useEffect(() => {
    let stale = false;
    for (const { def, meta } of metas)
      for (const a of meta?.answers ?? []) {
        const key = `${def.id}:${a.author}`;
        if (contents.get(key)?.updated === a.updated) continue;
        void ctx
          .answerContent(def.id, a.author)
          .then((content) => {
            if (stale) return;
            setContents((prev) => {
              const next = new Map(prev);
              next.set(key, content);
              return next;
            });
          })
          .catch(() => {});
      }
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.answersMeta, ctx.defs, focus?.id]);
  if (!defs.length) return null;
  return (
    <section className="console-edit-slides" aria-label="生徒が作ったスライド">
      {metas.map(({ def, meta }) => (
        <div key={def.id} className="console-edit-def">
          <h3>
            生徒が作ったスライド（{meta?.answers.length ?? 0}人）
            {!workbook.slides.some((s) => s.id === def.source) && (
              <span className="console-badge">
                元のスライドは削除されています
              </span>
            )}
          </h3>
          <div className="console-edit-grid">
            {(meta?.answers ?? []).map((a) => {
              const content = contents.get(`${def.id}:${a.author}`);
              const slide =
                content?.updated === a.updated ? content.slide : undefined;
              return (
                <button
                  key={a.author}
                  type="button"
                  className="console-edit-card"
                  disabled={!slide}
                  onClick={() =>
                    slide &&
                    setLarge({
                      name: a.name,
                      author: a.author,
                      defId: def.id,
                      slide,
                    })
                  }
                >
                  <span className="console-thumb-canvas">
                    {slide ? (
                      <Canvas slide={slide} zoom={148 / W} />
                    ) : (
                      <span className="console-thumb-loading">読込中…</span>
                    )}
                  </span>
                  <span>{a.name}</span>
                  {a.reopen && (
                    <span className="console-badge">差し戻し中</span>
                  )}
                  {a.resubmitted && (
                    <span className="console-badge">再提出</span>
                  )}
                  {a.shared && (
                    <span className="console-badge">共有中</span>
                  )}
                </button>
              );
            })}
          </div>
          {!!meta?.uncreated.length && (
            <div className="console-unanswered">
              <span className="console-unanswered-label">
                未作成（{meta.uncreated.length}人）
              </span>
              <span className="console-unanswered-names">
                {meta.uncreated.map((u) => u.name).join("、")}
              </span>
            </div>
          )}
        </div>
      ))}
      {large && (
        <div
          className="console-edit-large"
          role="dialog"
          aria-modal="true"
          aria-label={`${large.name}のスライド`}
        >
          <header>
            <h3>{large.name}のスライド</h3>
            <button
              className="button outline"
              aria-label="閉じる"
              onClick={() => setLarge(null)}
            >
              <X size={18} />
            </button>
          </header>
          <Canvas slide={large.slide} zoom={0.85} />
          <ConsoleEditShare
            defId={large.defId}
            author={large.author}
            shared={
              metas
                .find((m) => m.def.id === large.defId)
                ?.meta?.answers.find((a) => a.author === large.author)
                ?.shared === true
            }
            sourceSlide={workbook.slides.find(
              (s) =>
                s.id ===
                ctx.defs.find((d) => d.id === large.defId)?.source,
            )}
            editShow={editShow}
            onEditShow={onEditShow}
          />
          <ConsoleEditFeedback
            defId={large.defId}
            author={large.author}
            name={large.name}
          />
        </div>
      )}
    </section>
  );
}

/** Showing one student's free-edit slide to the class (stage 2b):
 * follow (集合で見せる) and the response gallery both present a
 * snapshot taken at this moment — what the class sees never
 * changes under them while the student keeps editing. */
function ConsoleEditShare({
  defId,
  author,
  shared,
  sourceSlide,
  editShow,
  onEditShow,
}: {
  defId: string;
  author: string;
  shared: boolean;
  sourceSlide?: Slide;
  editShow?: EditSlideShowRequest;
  onEditShow?: (req?: EditSlideShowRequest) => void;
}) {
  const ctx = useEditSlides();
  const showing =
    editShow?.defId === defId && editShow?.owner === author ? editShow : undefined;
  const [names, setNames] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="console-edit-share">
      <h4>みんなに見せる</h4>
      <label className="console-edit-share-names">
        <input
          type="checkbox"
          checked={showing ? showing.showNames : names}
          disabled={busy || !!showing}
          onChange={(e) => setNames(e.target.checked)}
        />
        名前を出す
      </label>
      <div className="console-edit-share-actions">
        {onEditShow && sourceSlide && (
          <>
            <button
              type="button"
              className="button outline"
              disabled={busy}
              aria-pressed={!!showing}
              onClick={() =>
                void run(async () => {
                  if (showing) {
                    onEditShow(undefined);
                    await ctx.unshareFollow(defId);
                  } else {
                    await ctx.shareFollow(defId, author, names);
                    onEditShow({
                      defId,
                      owner: author,
                      showNames: names,
                      sheetId: sourceSlide.sheetId ?? "main",
                      pageId: sourceSlide.id,
                    });
                  }
                })
              }
            >
              {showing ? "見せるのをやめる" : "集合で見せる"}
            </button>
            {showing && (
              <button
                type="button"
                className="button outline"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    ctx.shareFollow(defId, author, showing.showNames),
                  )
                }
              >
                最新にする
              </button>
            )}
          </>
        )}
        {sourceSlide && (
          <button
            type="button"
            className="button outline"
            disabled={busy}
            aria-pressed={shared}
            onClick={() =>
              void run(async () => {
                if (shared) await ctx.unshareGallery(defId, author);
                else
                  await ctx.shareGallery(
                    defId,
                    author,
                    names,
                    sourceSlide,
                  );
              })
            }
          >
            {shared ? "共有を取り消す" : "回答スライド共有に出す"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="small">
          {error}
        </p>
      )}
    </div>
  );
}

/** Feedback (§4.3) for one student's free-edit answer: the host
 * sends a short comment and/or a stamp, optionally as a send-back
 * that re-opens saving for that student after the intake closed,
 * and can cancel a send-back that is still in force. */
function ConsoleEditFeedback({
  defId,
  author,
  name,
}: {
  defId: string;
  author: string;
  name: string;
}) {
  const ctx = useEditSlides();
  const [text, setText] = useState("");
  const [stamp, setStamp] = useState("");
  const [reopen, setReopen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = ctx.feedback.filter(
    (f) =>
      f.targetKind === "editslide" && f.targetId === defId && f.owner === author,
  );
  const reopenActive = rows.some((f) => f.reopen === 1);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="console-edit-feedback">
      <h4>{name}さんへのフィードバック</h4>
      {rows.slice(0, 5).map((f) => (
        <p key={f.id} className="console-edit-feedback-row">
          {f.stamp && <span className="stamp">{f.stamp}</span>}
          {f.text}
          {f.reopen === 1 && <span className="console-badge">差し戻し中</span>}
          {f.readAt !== null && <span className="small">（既読）</span>}
        </p>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="console-edit-feedback-form">
        <input
          type="text"
          value={text}
          maxLength={200}
          placeholder="短いコメント（200文字まで）"
          aria-label="フィードバックのコメント"
          onChange={(e) => setText(e.target.value)}
        />
        <select
          value={stamp}
          aria-label="スタンプ"
          onChange={(e) => setStamp(e.target.value)}
        >
          <option value="">スタンプなし</option>
          <option value="よくできました">よくできました</option>
          <option value="なるほど">なるほど</option>
          <option value="もう一歩">もう一歩</option>
          <option value="すてきな考え">すてきな考え</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={reopen}
            onChange={(e) => setReopen(e.target.checked)}
          />
          書き直してほしい（差し戻し）
        </label>
        <button
          className="button primary"
          disabled={busy || (text === "" && stamp === "" && !reopen)}
          onClick={() =>
            void run(async () => {
              await ctx.sendFeedback({
                targetId: defId,
                owner: author,
                text,
                stamp,
                reopen,
              });
              setText("");
              setStamp("");
              setReopen(false);
            })
          }
        >
          送る
        </button>
        {reopenActive && (
          <button
            className="button outline"
            disabled={busy}
            onClick={() =>
              void run(() => ctx.cancelFeedbackReopen(defId, author))
            }
          >
            差し戻しを取り消す
          </button>
        )}
      </div>
    </div>
  );
}

function ConsoleStudentSlides({
  focus,
  onOpenGallery,
}: {
  focus?: Slide;
  onOpenGallery?: () => void;
}) {
  const ctx = useWorksheets();
  const visible = usePageVisible();
  const [gallery, setGallery] = useState<ResponseGallery | null>(null);
  const [error, setError] = useState("");
  const [enlargedId, setEnlargedId] = useState<string>();
  const [names, setNames] = useState(false);
  const [live, setLive] = useState(false);
  const [all, setAll] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareOnly, setCompareOnly] = useState(false);
  const [publishedList, setPublishedList] = useState<ResponseGallery[]>([]);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");
  const ZOOM_KEY = "vhslide-console-card-zoom";
  const [zoomPct, setZoomPct] = useState(() => {
    try {
      const v = Number(localStorage.getItem(ZOOM_KEY));
      return v >= 40 && v <= 250 ? v : 100;
    } catch {
      return 100;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(ZOOM_KEY, String(zoomPct));
    } catch {
      /* Keep the zoom for this session only. */
    }
  }, [zoomPct]);
  const areaRef = useRef<HTMLDivElement>(null);
  const pinchBase = useRef(100);
  usePinch(areaRef, {
    start: () => {
      pinchBase.current = zoomPct;
    },
    change: ({ ratio }) =>
      setZoomPct(
        Math.max(40, Math.min(250, Math.round(pinchBase.current * ratio))),
      ),
    end: () => {},
  });
  const commitZoom = (raw: string) => {
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0)
      setZoomPct(Math.max(40, Math.min(250, Math.round(v))));
  };
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
    if (!deckId || !visible) return;
    let stopped = false;
    const load = async () => {
      try {
        const data = await api<{
          gallery: ResponseGallery | null;
          galleries?: ResponseGallery[];
        }>(`/api/decks/${deckId}/gallery`);
        if (!stopped)
          setPublishedList(
            data.galleries ?? (data.gallery ? [data.gallery] : []),
          );
      } catch {
        /* The published state just stays as it was. */
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [deckId, visible]);
  async function share(
    command: "publish" | "stop",
    targetSlideId?: string,
  ) {
    if (!deckId || shareBusy) return;
    setShareBusy(true);
    setShareError("");
    try {
      const data = await api<{
        gallery: ResponseGallery | null;
        galleries?: ResponseGallery[];
      }>(`/api/decks/${deckId}/gallery/${command}`, {
        method: "POST",
        body: JSON.stringify(
          command === "publish"
            ? {
                slide: slideRef.current,
                append: true,
                participants: all ? null : selected,
                names,
                live,
              }
            : targetSlideId
              ? { slideId: targetSlideId }
              : {},
        ),
      });
      setPublishedList(data.galleries ?? (data.gallery ? [data.gallery] : []));
    } catch (e) {
      setShareError((e as Error).message);
    } finally {
      setShareBusy(false);
    }
  }
  useEffect(() => {
    setGallery(null);
    setEnlargedId(undefined);
    setSelected([]);
    setCompare([]);
    setCompareOnly(false);
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

  const cards = gallery?.cards ?? [];
  const shownCards =
    compareOnly && compare.length
      ? cards.filter((c) => compare.includes(c.id))
      : cards;
  const enlarged = cards.find((c) => c.id === enlargedId);
  return (
    <div className="console-students" ref={areaRef}>
      {!focus ? (
        <p className="console-note">スライドがありません。</p>
      ) : !hasForm ? (
        <p className="console-note">
          「{focus.title}
          」には回答欄がありません。左の一覧で、回答欄のあるスライド（「回答欄」の印つき）を選んでください。
        </p>
      ) : (
        <>
          <div className="console-students-head">
            <p className="console-answer-status">
              「{focus.title}」への生徒の回答（{cards.length}人）
            </p>
            <div className="console-zoom" aria-label="サムネイルの表示倍率">
              <button
                type="button"
                onClick={() => setZoomPct((z) => Math.max(40, z - 10))}
                aria-label="サムネイルを小さく"
              >
                <Minus size={14} />
              </button>
              <input
                key={zoomPct}
                type="number"
                min={40}
                max={250}
                step={10}
                defaultValue={zoomPct}
                aria-label="表示倍率（パーセント）"
                onBlur={(e) => commitZoom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    (e.target as HTMLInputElement).blur();
                }}
              />
              <span>％</span>
              <button
                type="button"
                onClick={() => setZoomPct((z) => Math.min(250, z + 10))}
                aria-label="サムネイルを大きく"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
          <div className="console-share">
            <div className="console-share-row">
              <strong>回答の共有</strong>
              <span className="console-share-note">
                共有すると生徒の画面にも表示されます。メールアドレスは共有されません。
              </span>
            </div>
            <div className="console-share-row">
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
            </div>
            <div className="console-share-row">
              <button
                type="button"
                className="button primary"
                disabled={
                  shareBusy ||
                  !gallery ||
                  !cards.length ||
                  (!all && !selected.length)
                }
                onClick={() => void share("publish")}
              >
                このスライドの回答を全員に共有
              </button>
              <button
                type="button"
                className="button outline"
                disabled={shareBusy || !publishedList.length}
                onClick={() => void share("stop")}
              >
                すべての共有を停止
              </button>
              {publishedList.length > 0 && onOpenGallery && (
                <button
                  type="button"
                  className="button outline"
                  onClick={onOpenGallery}
                >
                  共有された回答を開く
                </button>
              )}
              <span role="status">
                {publishedList.length
                  ? `共有中：${publishedList.length}枚`
                  : "現在、参加者には公開していません。"}
              </span>
            </div>
            {publishedList.length > 0 && (
              <div className="console-published-list" aria-label="共有中のスライド">
                {publishedList.map((item) => (
                  <div key={item.slide.id} className="console-share-row">
                    <span>
                      {item.slide.title || "無題"}（{item.cards.length}人・
                      {item.names ? "氏名あり" : "匿名"}・
                      {item.live ? "自動更新" : "共有時点の回答"}）
                    </span>
                    <button
                      type="button"
                      className="button outline"
                      disabled={shareBusy}
                      onClick={() => void share("stop", item.slide.id)}
                    >
                      このスライドの共有を停止
                    </button>
                  </div>
                ))}
              </div>
            )}
            {shareError && <p role="alert">{shareError}</p>}
            {compare.length > 0 && (
              <div className="console-share-row">
                <span>比較する回答を最大4件選べます。</span>
                <button type="button" onClick={() => setCompareOnly(true)}>
                  選択した回答を比較
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCompare([]);
                    setCompareOnly(false);
                  }}
                >
                  比較を解除
                </button>
              </div>
            )}
          </div>
          {error && <p className="console-waiting">{error}</p>}
          {!error && !cards.length && !(gallery?.unanswered?.length ?? 0) && (
            <p className="console-note">まだ回答がありません。</p>
          )}
          <div
            className="console-cards"
            style={
              {
                "--console-card-w": `${Math.round(3.2 * zoomPct)}px`,
              } as CSSProperties
            }
          >
        {shownCards.map((card) => (
          <article
            className="console-card"
            key={card.id}
            onClick={() => setEnlargedId(card.id)}
            title="クリックで拡大"
          >
            <span className="console-card-name">{card.name}</span>
            <ResponseGalleryCard card={card} slide={focus} />
            <footer
              className="console-card-foot"
              onClick={(e) => e.stopPropagation()}
            >
              {!all && (
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
                  checked={compare.includes(card.id)}
                  disabled={
                    !compare.includes(card.id) && compare.length >= 4
                  }
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
      {gallery?.unanswered && gallery.unanswered.length > 0 && (
        <div className="console-unanswered">
          <p className="console-answer-status">
            未回答（{gallery.unanswered.length}人）
          </p>
          <div className="console-unanswered-list">
            {gallery.unanswered.map((u, i) => (
              <span key={i} className="console-unanswered-chip">
                {u.name}
                <em>未回答</em>
              </span>
            ))}
          </div>
        </div>
      )}
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
        </>
      )}
    </div>
  );
}

/** Thinking tools in the console: the same distribution / playback /
 * trajectory view as the form panel's results, kept fresh by the
 * console's 5-second refresh so the host can watch points move
 * during the lesson. */
function ConsoleThinking({
  workbook,
  chartShow,
  onChartShow,
}: {
  workbook: Deck;
  chartShow?: ChartShowRequest;
  onChartShow?: (req?: ChartShowRequest) => void;
}) {
  const thinkingCtx = useThinking();
  const [toolId, setToolId] = useState("");
  const tool =
    thinkingCtx.tools.find((t) => t.id === toolId) ?? thinkingCtx.tools[0];
  if (!tool)
    return (
      <p className="console-note">
        思考ツールはまだありません。「フォーム」の「思考ツール」から作成できます。
      </p>
    );
  // The slide the tool is placed on: the follow target needs it.
  const placed = workbook.slides.find((s) =>
    s.elements.some((e) => e.thinking?.toolId === tool.id),
  );
  return (
    <div className="console-thinking">
      {thinkingCtx.tools.length > 1 && (
        <select
          aria-label="思考ツールを選ぶ"
          value={tool.id}
          onChange={(e) => setToolId(e.target.value)}
        >
          {thinkingCtx.tools.map((t) => (
            <option key={t.id} value={t.id}>
              {t.definition.title}
            </option>
          ))}
        </select>
      )}
      <ThinkingResults
        key={tool.id}
        tool={tool}
        showingOwner={
          chartShow && chartShow.toolId === tool.id
            ? chartShow.owner
            : undefined
        }
        showingNames={
          chartShow && chartShow.toolId === tool.id
            ? chartShow.showNames
            : undefined
        }
        onShowChart={
          onChartShow && placed
            ? (req) =>
                onChartShow(
                  req
                    ? {
                        ...req,
                        sheetId: placed.sheetId ?? "main",
                        pageId: placed.id,
                      }
                    : undefined,
                )
            : undefined
        }
      />
    </div>
  );
}

/** Per-group view of the focused slide's webbing maps: a miniature map
 * plus the group's writings as a tree, so the host can check every
 * group's answers at once without switching tabs on the slide itself.
 * A card opens enlarged — as a dialog or a full view — with arrow-key
 * navigation across the slide's cards, and can be shown to the whole
 * class through follow mode. */
function ConsoleGroups({
  focus,
  groupShow,
  onGroupShow,
}: {
  focus?: Slide;
  groupShow?: FollowTarget;
  onGroupShow?: (target?: FollowTarget) => void;
}) {
  const webbingCtx = useWebbing();
  const groupsCtx = useGroups();
  const [enlargedKey, setEnlargedKey] = useState<string>();
  const [full, setFull] = useState(false);
  const mapIds = new Set(
    (focus?.elements ?? [])
      .map((e) => e.webbing)
      .filter((b) => !!b && b.deckId === webbingCtx.deckId)
      .map((b) => b!.mapId),
  );
  const maps = webbingCtx.maps.filter((m) => mapIds.has(m.id));
  // The cards in display order: arrow keys and the prev/next buttons
  // walk this list, across every map placed on the focused slide.
  type Card = {
    key: string;
    map: (typeof maps)[number];
    groupId: string;
    title: string;
    nodes: WebbingNode[];
  };
  const cards: Card[] = maps.flatMap((map) =>
    map.grouped
      ? groupsCtx.groups.map((group) => ({
          key: `${map.id}:${group.id}`,
          map,
          groupId: group.id,
          title: `${group.name}（参加 ${group.memberCount}人）`,
          nodes: map.nodes.filter((n) => n.groupId === group.id),
        }))
      : [
          {
            key: `${map.id}:all`,
            map,
            groupId: "",
            title: "全員のマップ",
            nodes: map.nodes,
          },
        ],
  );
  const enlargedIndex = cards.findIndex((c) => c.key === enlargedKey);
  const enlarged = enlargedIndex >= 0 ? cards[enlargedIndex] : undefined;
  const targetFor = (card: Card): FollowTarget => ({
    mode: "group",
    sheetId: focus?.sheetId ?? "main",
    pageId: focus?.id,
    mapId: card.map.id,
    groupId: card.groupId,
  });
  const showing = (card: Card) =>
    !!groupShow &&
    groupShow.mode === "group" &&
    groupShow.mapId === card.map.id &&
    (groupShow.groupId ?? "") === card.groupId &&
    !!focus &&
    groupShow.pageId === focus.id;
  const navigate = (dir: number) => {
    if (enlargedIndex < 0) return;
    const next = cards[enlargedIndex + dir];
    if (!next) return;
    const wasShowing = showing(cards[enlargedIndex]);
    setEnlargedKey(next.key);
    if (wasShowing && onGroupShow) onGroupShow(targetFor(next));
  };
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    if (!enlargedKey) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateRef.current(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateRef.current(1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setEnlargedKey(undefined);
        setFull(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enlargedKey]);
  if (!webbingCtx.enabled)
    return (
      <p className="console-note">
        クラウドの作品を開くと、ウェビングマップがここに表示されます。
      </p>
    );
  if (!maps.length)
    return (
      <p className="console-note">
        このスライドにはウェビングマップがありません。左の一覧でマップのあるスライドを選んでください。
      </p>
    );
  const closeEnlarged = () => {
    setEnlargedKey(undefined);
    setFull(false);
  };
  const enlargedBody = enlarged && (
    <>
      <header className="console-group-bar">
        <strong>
          {enlarged.map.title} — {enlarged.title}
        </strong>
        <span className="console-group-pos">
          {enlargedIndex + 1} / {cards.length}
        </span>
        <div className="console-group-actions">
          <button
            type="button"
            className="button outline"
            disabled={enlargedIndex <= 0}
            onClick={() => navigate(-1)}
          >
            <ChevronLeft size={15} />
            前のグループ
          </button>
          <button
            type="button"
            className="button outline"
            disabled={enlargedIndex >= cards.length - 1}
            onClick={() => navigate(1)}
          >
            次のグループ
            <ChevronRight size={15} />
          </button>
          {onGroupShow && (
            <button
              type="button"
              className="button outline"
              aria-pressed={showing(enlarged)}
              onClick={() =>
                onGroupShow(showing(enlarged) ? undefined : targetFor(enlarged))
              }
            >
              {showing(enlarged) ? "見せるのをやめる" : "集合で見せる"}
            </button>
          )}
          <button
            type="button"
            className="button outline"
            aria-pressed={full}
            onClick={() => setFull((f) => !f)}
          >
            {full ? "もどす" : "全体表示"}
          </button>
          <button
            type="button"
            className="button outline"
            onClick={closeEnlarged}
          >
            <X size={15} />
            閉じる
          </button>
        </div>
      </header>
      <div
        className={
          full ? "console-group-full-body" : "console-enlarged-map-body"
        }
      >
        <WebbingMini nodes={enlarged.nodes} large />
        <div className="console-enlarged-map-tree">
          <ConsoleWebbingTree nodes={enlarged.nodes} parentId={null} />
          {!enlarged.nodes.length && (
            <p className="console-note">まだ書き込みがありません。</p>
          )}
        </div>
      </div>
    </>
  );
  return (
    <div className="console-groups">
      {maps.map((map) => (
        <section key={map.id} className="console-group-map">
          <header className="console-group-map-head">
            <strong>{map.title}</strong>
            <span>
              {map.status === "open"
                ? "書き込み受付中"
                : map.status === "closed"
                  ? "受付終了"
                  : "準備中"}
              ／ 書き込み{" "}
              {map.nodes.filter((n) => n.parentId !== null).length}件
            </span>
          </header>
          {map.grouped ? (
            <div className="console-group-grid">
              {groupsCtx.groups.map((group) => (
                <ConsoleGroupCard
                  key={group.id}
                  title={`${group.name}（参加 ${group.memberCount}人）`}
                  nodes={map.nodes.filter((n) => n.groupId === group.id)}
                  onEnlarge={() => setEnlargedKey(`${map.id}:${group.id}`)}
                />
              ))}
              {!groupsCtx.groups.length && (
                <p className="console-note">
                  グループがまだ設定されていません。
                </p>
              )}
            </div>
          ) : (
            <ConsoleGroupCard
              title="全員のマップ"
              nodes={map.nodes}
              onEnlarge={() => setEnlargedKey(`${map.id}:all`)}
            />
          )}
        </section>
      ))}
      {enlarged &&
        (full ? (
          <div
            className="console-group-full"
            role="dialog"
            aria-modal="true"
            aria-label={`${enlarged.title}のマップ`}
          >
            {enlargedBody}
          </div>
        ) : (
          <div
            className="console-enlarged"
            role="dialog"
            aria-modal="true"
            aria-label={`${enlarged.title}のマップ`}
            onClick={closeEnlarged}
          >
            <div
              className="console-enlarged-box console-enlarged-map"
              onClick={(e) => e.stopPropagation()}
            >
              {enlargedBody}
            </div>
          </div>
        ))}
    </div>
  );
}

function ConsoleGroupCard({
  title,
  nodes,
  onEnlarge,
}: {
  title: string;
  nodes: WebbingNode[];
  onEnlarge?: () => void;
}) {
  return (
    <article
      className={`console-group-card ${onEnlarge ? "is-clickable" : ""}`}
      onClick={onEnlarge}
      title={onEnlarge ? "クリックで拡大" : undefined}
    >
      <header>
        <strong>{title}</strong>
        <span>
          書き込み {nodes.filter((n) => n.parentId !== null).length}件
        </span>
      </header>
      <WebbingMini nodes={nodes} />
      <ConsoleWebbingTree nodes={nodes} parentId={null} />
      {!nodes.length && <p className="console-note">まだ書き込みがありません。</p>}
    </article>
  );
}

function ConsoleWebbingTree({
  nodes,
  parentId,
}: {
  nodes: WebbingNode[];
  parentId: string | null;
}) {
  const here = nodes.filter((n) => n.parentId === parentId);
  if (!here.length) return null;
  return (
    <ul className="console-webbing-tree">
      {here.map((n) => (
        <li key={n.id}>
          <span className="console-webbing-text">{n.text}</span>
          {n.parentId !== null && (
            <span className="console-webbing-author">{n.authorName}</span>
          )}
          <ConsoleWebbingTree nodes={nodes} parentId={n.id} />
        </li>
      ))}
    </ul>
  );
}
