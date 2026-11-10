import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Canvas } from "./Canvas";
import { H, W, type Deck } from "./model";
import type { CloudWorkspace } from "./cloud";
import { useWorksheets } from "./WorksheetContext";
import { usePageVisible } from "./usePageVisible";
import { WorksheetResults } from "./WorksheetResults";
import { worksheetCsv } from "./worksheetCsv";
import {
  consoleDefaultPreview,
  consoleDefaultSheet,
  consoleSheets,
  consoleSlides,
  fieldAnswered,
} from "./teacherConsole";

/**
 * Host-only monitoring view for use in a separate tab while another tab
 * drives the follow projection. Everything here is local to this tab:
 * previews never touch the shared document or the follow target.
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
  const [previewId, setPreviewId] = useState(() =>
    consoleDefaultPreview(workbook, follow),
  );
  const preview = slides.find((s) => s.id === previewId) ?? slides[0];
  const previewIndex = preview ? slides.indexOf(preview) : -1;
  const projected =
    follow.active && follow.target.mode === "page"
      ? workbook.slides.find((s) => s.id === follow.target.pageId)
      : undefined;
  const projectedHere = projected && (projected.sheetId ?? "main") === sheetId;

  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.6);
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const measure = () =>
      setZoom(
        Math.max(
          0.1,
          Math.min(node.clientWidth / W, node.clientHeight / H, 1.2),
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function jumpToProjected() {
    if (!projected) return;
    setSheetId(projected.sheetId ?? "main");
    setPreviewId(projected.id);
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
            title="投影中のスライドをプレビューします"
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
                setPreviewId(
                  consoleSlides(workbook, e.target.value)[0]?.id,
                );
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
            const isPreview = preview?.id === s.id;
            return (
              <button
                key={s.id}
                type="button"
                className={`console-thumb ${isPreview ? "is-preview" : ""}`}
                onClick={() => setPreviewId(s.id)}
                aria-pressed={isPreview}
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
        <main className="console-preview">
          <div className="console-preview-head">
            <button
              type="button"
              className="button outline"
              disabled={previewIndex <= 0}
              onClick={() => setPreviewId(slides[previewIndex - 1]?.id)}
              aria-label="前のスライド"
            >
              <ChevronLeft size={15} />
              前へ
            </button>
            <strong>
              {preview
                ? `${preview.x + 1}.${preview.y + 1} ${preview.title}`
                : ""}
            </strong>
            <button
              type="button"
              className="button outline"
              disabled={
                previewIndex < 0 || previewIndex >= slides.length - 1
              }
              onClick={() => setPreviewId(slides[previewIndex + 1]?.id)}
              aria-label="次のスライド"
            >
              次へ
              <ChevronRight size={15} />
            </button>
            {projectedHere && preview?.id !== projected.id && (
              <button
                type="button"
                className="button outline"
                onClick={() => setPreviewId(projected.id)}
              >
                投影中を見る
              </button>
            )}
          </div>
          <div className="console-stage" ref={stageRef}>
            {preview && <Canvas slide={preview} zoom={zoom} />}
          </div>
          {preview?.speakerNotes && (
            <div className="console-notes">
              <strong>発表ノート</strong>
              <p>{preview.speakerNotes}</p>
            </div>
          )}
        </main>
        <ConsoleAnswers cloud={cloud} />
      </div>
    </section>
  );
}

function ConsoleAnswers({ cloud }: { cloud: CloudWorkspace }) {
  const ctx = useWorksheets();
  const visible = usePageVisible();
  const [worksheetId, setWorksheetId] = useState("");
  const [tab, setTab] = useState<"fields" | "people">("fields");
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
      /* The panel shows refresh errors; the console stays quiet. */
    } finally {
      if (alive.current) setDownloading(false);
    }
  }

  if (!ctx.enabled)
    return (
      <aside className="console-answers" aria-label="回答の状況">
        <h3>回答の状況</h3>
        <p>クラウドの作品を開くと、ワークシートの回答がここに表示されます。</p>
      </aside>
    );
  if (!sheet)
    return (
      <aside className="console-answers" aria-label="回答の状況">
        <h3>回答の状況</h3>
        <p>この作品にはワークシートがありません。</p>
      </aside>
    );
  const responses = sheet.results?.responses ?? [];
  const respondentIds = new Set(responses.map((r) => r.respondentId));
  const waiting = cloud.members.filter(
    (m) => m.id !== cloud.user?.id && !respondentIds.has(m.id),
  );
  return (
    <aside className="console-answers" aria-label="回答の状況">
      <h3>回答の状況</h3>
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
        ／ 回答した生徒 {responses.length}人
      </p>
      <div className="console-answer-tabs" role="tablist" aria-label="表示切替">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "fields"}
          className={tab === "fields" ? "active" : ""}
          onClick={() => setTab("fields")}
        >
          設問ごと
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "people"}
          className={tab === "people" ? "active" : ""}
          onClick={() => setTab("people")}
        >
          生徒ごと
        </button>
      </div>
      {tab === "fields" ? (
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
      ) : (
        <WorksheetResults
          sheet={sheet}
          busy={downloading}
          onDownload={(order) => void download(order)}
        />
      )}
    </aside>
  );
}
