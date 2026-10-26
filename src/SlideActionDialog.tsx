import { FitReview } from "./FitReview";
import { needsFitCheck } from "./checkContentFit";
import type { FitIssue } from "./contentFit";
import { resolvePageScope, type PageScope } from "./pageScope";
import { PageScopeSummary } from "./PageScopeSummary";
import type { EditAccess } from "./permissions";
import { activeSheet } from "./workbook";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Canvas } from "./Canvas";
import type { Deck, Slide } from "./model";
import { uid } from "./model";
import type { CloudWorkspace } from "./cloud";
import { routeSlides, slideLabel } from "./learningTools";
import { SlidePicker } from "./SlidePicker";
import { HistoryPanel } from "./HistoryPanel";

export type SlideAction = "compare" | "pdf" | "routes" | "history";
export function SlideActionDialog({
  mode,
  latestBook,
  initialIds,
  onFixIssue,
  defaultScope,
  filterScope,
  access,
  book,
  cloud,
  close,
  commit,
  present,
  restoreLocal,
}: {
  mode: SlideAction;
  latestBook: () => Deck;
  initialIds?: string[];
  onFixIssue: (issue: FitIssue, scope: PageScope, ids: string[]) => void;
  defaultScope: PageScope;
  filterScope?: Extract<PageScope, { kind: "filter" }>;
  access: EditAccess;
  book: Deck;
  cloud: CloudWorkspace;
  close: () => void;
  commit: (book: Deck) => boolean;
  present: (id: string) => void;
  restoreLocal: (book: Deck) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<PageScope["kind"]>(defaultScope.kind);
  const [contextSheetId] = useState(
    defaultScope.kind === "filter" || defaultScope.kind === "sheet"
      ? defaultScope.sheetId
      : activeSheet(book).id,
  );
  const [contextFilter] = useState(filterScope);
  const [initialScope] = useState(() =>
    resolvePageScope(book, defaultScope, access),
  );
  const [ids, setIds] = useState<string[]>(
    initialIds?.filter((id) => initialScope.ids.includes(id)) ??
      (mode === "pdf" ? initialScope.ids : []),
  );
  const title = {
    compare: "スライドを比較",
    pdf: "PDFで保存",
    routes: "発表ルート",
    history: "保存した版",
  }[mode];
  const [name, setName] = useState("発表ルート"),
    [message, setMessage] = useState("");
  const [comparing, setComparing] = useState(false);
  const [checkingPDF, setCheckingPDF] = useState(false);
  const [printJob, setPrintJob] = useState<{
    pages: Slide[];
    book: Deck;
    scopeKey: string;
    selectionKey: string;
  }>();
  const printRoot = useRef<HTMLDivElement>(null),
    [ready, setReady] = useState(false);
  const descriptor = useMemo<PageScope>(
    () =>
      scope === "book"
        ? { kind: "book" }
        : scope === "filter"
          ? (contextFilter ?? {
              kind: "selection",
              ids: [],
              label: "フィルタなし",
            })
          : scope === "selection"
            ? defaultScope
            : { kind: "sheet", sheetId: contextSheetId },
    [scope, contextFilter, contextSheetId, defaultScope],
  );
  const resolved = useMemo(
    () => resolvePageScope(book, descriptor, access),
    [book, descriptor, access],
  );
  const pages = resolved.pages,
    candidateKey = JSON.stringify(resolved.ids),
    byId = new Map(pages.map((s) => [s.id, s]));
  const chosen =
    mode === "pdf"
      ? pages.filter((s) => ids.includes(s.id))
      : ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const chosenIds = chosen.map((s) => s.id),
    selectionKey = JSON.stringify(chosenIds);
  const printing =
    printJob &&
    printJob.book === book &&
    printJob.scopeKey === candidateKey &&
    printJob.selectionKey === selectionKey
      ? printJob.pages
      : undefined;
  const comparingOpen = comparing && chosen.length >= 2 && chosen.length <= 4;
  useEffect(() => {
    const next = ids.filter((id) => byId.has(id));
    if (next.length !== ids.length) {
      choose(next);
      setMessage(
        "対象範囲が変わったため、範囲外・削除済みのページを選択から外しました。",
      );
    }
  }, [candidateKey]);
  useEffect(() => {
    if (printJob && !printing) {
      setPrintJob(undefined);
      setReady(false);
      setMessage(
        "作品または対象範囲が更新されました。確認してPDFの準備をやり直してください。",
      );
    }
  }, [printJob, printing]);
  useEffect(() => {
    const node = dialog.current!,
      opener = document.activeElement as HTMLElement | null;
    node.showModal();
    return () => {
      node.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    if (!printing) return;
    let alive = true;
    setReady(false);
    void (async () => {
      await document.fonts.ready;
      await Promise.all(
        [...printRoot.current!.querySelectorAll("img")].map((img) =>
          img.decode(),
        ),
      );
      if (alive) setReady(true);
    })().catch(() => {
      if (alive)
        setMessage(
          "画像を読み込めません。接続を確認し、PDFの準備をやり直してください。",
        );
    });
    return () => {
      alive = false;
    };
  }, [printing]);
  function preparePrint() {
    if (latestBook() !== book) {
      setCheckingPDF(false);
      setMessage("作品が更新されました。PDFの準備をやり直してください。");
      return;
    }
    setCheckingPDF(false);
    setReady(false);
    setPrintJob({
      pages: structuredClone(chosen),
      book,
      scopeKey: candidateKey,
      selectionKey,
    });
    setMessage("画像とフォントを確認しています…");
  }
  function choose(next: string[]) {
    setIds(next);
    setMessage("");
    setComparing(false);
    setPrintJob(undefined);
    setReady(false);
  }
  function changeRoute(id: string, slides: string[]) {
    commit({
      ...book,
      routes: book.routes?.map((r) => (r.id === id ? { ...r, slides } : r)),
    });
  }
  return createPortal(
    <>
      <dialog
        ref={dialog}
        className={`tools-dialog purpose-${mode}`}
        aria-label={title}
        onCancel={close}
      >
        <header>
          <div>
            <h2>{title}</h2>
            <p className="dialog-purpose">
              {
                {
                  compare: "考えを並べて見比べます。元の配置は変わりません。",
                  pdf: "配る・提出するスライドを選んで、PDFにまとめます。",
                  routes:
                    "発表するスライドと順番を決めます。通常の縦横発表も使えます。",
                  history:
                    "保存した時点の作品を確認し、別作品として復元できます。",
                }[mode]
              }
            </p>
          </div>
          <button className="button outline" onClick={close}>
            閉じる
          </button>
        </header>
        {mode === "history" ? (
          <HistoryPanel
            book={book}
            cloud={cloud}
            onLocalRestore={restoreLocal}
          />
        ) : (
          <>
            {!comparingOpen && !printing && (
              <>
                <label>
                  対象範囲{" "}
                  <select
                    aria-label="対象範囲"
                    value={scope}
                    onChange={(e) => {
                      const value = e.target.value as PageScope["kind"];
                      const next = resolvePageScope(
                        book,
                        value === "book"
                          ? { kind: "book" }
                          : value === "filter"
                            ? (contextFilter ?? { kind: "selection", ids: [] })
                            : { kind: "sheet", sheetId: contextSheetId },
                        access,
                      );
                      setScope(value);
                      choose(
                        mode === "pdf"
                          ? next.ids
                          : ids.filter((id) => next.ids.includes(id)),
                      );
                    }}
                  >
                    <option value="sheet">現在のシート</option>
                    <option value="filter" disabled={!contextFilter}>
                      マップの絞り込み
                    </option>
                    <option value="book">作品全体</option>
                  </select>
                </label>
                <PageScopeSummary scope={resolved} />
                {resolved.issues.length > 0 && (
                  <p role="status">{resolved.issues.join(" ")}</p>
                )}
                {!pages.length && (
                  <p role="status">
                    条件に合うページがありません。対象範囲を変更してください。
                  </p>
                )}
                <div className="backup-actions">
                  {mode !== "compare" && (
                    <button
                      className="button outline"
                      disabled={!pages.length}
                      onClick={() => choose(pages.map((s) => s.id))}
                    >
                      対象をすべて選ぶ
                    </button>
                  )}
                  <button className="quiet" onClick={() => choose([])}>
                    選択を解除
                  </button>
                  <span aria-live="polite">
                    {chosen.length}枚を選択
                    {mode === "compare"
                      ? " · 2〜4枚を選んで比較"
                      : mode === "routes"
                        ? " · 押した順に発表します"
                        : ""}
                  </span>
                </div>
                <SlidePicker
                  book={book}
                  pages={pages}
                  ids={chosenIds}
                  maxSelected={mode === "compare" ? 4 : undefined}
                  onChange={choose}
                />
              </>
            )}
            {mode !== "routes" ? (
              <>
                <div className="backup-actions">
                  {mode === "compare" && (
                    <button
                      className="button primary"
                      disabled={
                        !comparingOpen &&
                        (chosen.length < 2 || chosen.length > 4)
                      }
                      onClick={() => setComparing(!comparingOpen)}
                    >
                      {comparingOpen
                        ? "スライドを選び直す"
                        : "選んだスライドを比較（最大4枚）"}
                    </button>
                  )}
                  {mode === "pdf" && (
                    <button
                      className="button outline"
                      disabled={!chosen.length}
                      onClick={() => {
                        if (needsFitCheck(chosen)) setCheckingPDF(true);
                        else preparePrint();
                      }}
                    >
                      PDFの準備
                    </button>
                  )}
                </div>
                {comparingOpen && (
                  <div
                    className="compare-grid"
                    aria-label="スライドの比較"
                    data-count={chosen.length}
                  >
                    {chosen.map((s, i) => (
                      <CompareCard key={`${s.id}-${i}`} book={book} slide={s} />
                    ))}
                  </div>
                )}
                {printing && (
                  <div className="backup-preview">
                    <p>
                      {printing.length}ページ · 16:9 ·
                      1枚ずつ保存します。印刷画面で「PDFに保存」を選び、背景のグラフィックを有効にしてください。
                    </p>
                    <button
                      className="button primary"
                      disabled={!ready}
                      onClick={() => window.print()}
                    >
                      印刷・PDFに保存
                    </button>
                    <button
                      className="quiet"
                      onClick={() => setPrintJob(undefined)}
                    >
                      スライドを選び直す
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                {!cloud.isHost && (
                  <p>
                    発表ルートの編集はホストだけが行えます。保存済みルートでの発表は全員が利用できます。
                  </p>
                )}
                <div className="backup-actions">
                  <label>
                    ルートの名前{" "}
                    <input
                      aria-label="発表ルート名"
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <button
                    className="button primary"
                    disabled={
                      !cloud.isHost ||
                      !name.trim() ||
                      !chosen.length ||
                      (book.routes?.length ?? 0) >= 30
                    }
                    onClick={() => {
                      if (
                        commit({
                          ...book,
                          routes: [
                            ...(book.routes ?? []),
                            {
                              id: uid(),
                              name: name.trim(),
                              slides: chosen.map((s) => s.id),
                            },
                          ],
                        })
                      )
                        setMessage("発表ルートを保存しました。");
                    }}
                  >
                    選択順でルートを保存
                  </button>
                </div>
                {(book.routes ?? []).map((r) => (
                  <section className="backup-preview" key={r.id}>
                    <input
                      aria-label={`${r.name}の名前`}
                      value={r.name}
                      maxLength={80}
                      readOnly={!cloud.isHost}
                      onChange={(e) => {
                        if (e.target.value.trim())
                          commit({
                            ...book,
                            routes: book.routes!.map((p) =>
                              p.id === r.id
                                ? { ...p, name: e.target.value }
                                : p,
                            ),
                          });
                      }}
                    />
                    <p>
                      {routeSlides(book, r).length}枚 ·
                      削除済みのスライドは発表時にスキップします
                    </p>
                    <button
                      className="button primary"
                      disabled={!routeSlides(book, r).length}
                      onClick={() => present(r.id)}
                    >
                      {r.name}で発表
                    </button>
                    {cloud.isHost && (
                      <button
                        className="quiet"
                        onClick={() =>
                          commit({
                            ...book,
                            routes: book.routes!.filter((p) => p.id !== r.id),
                          })
                        }
                      >
                        ルートを削除
                      </button>
                    )}
                    <ol>
                      {r.slides.map((id, i) => (
                        <li key={`${id}-${i}`}>
                          <span>
                            {book.slides.find((s) => s.id === id)
                              ? slideLabel(
                                  book,
                                  book.slides.find((s) => s.id === id)!,
                                )
                              : "削除されたスライド"}
                          </span>
                          {cloud.isHost && (
                            <>
                              <button
                                aria-label={`${i + 1}番目を前へ`}
                                disabled={!i}
                                onClick={() => {
                                  const order = [...r.slides];
                                  [order[i - 1], order[i]] = [
                                    order[i],
                                    order[i - 1],
                                  ];
                                  changeRoute(r.id, order);
                                }}
                              >
                                ↑
                              </button>
                              <button
                                aria-label={`${i + 1}番目を後へ`}
                                disabled={i === r.slides.length - 1}
                                onClick={() => {
                                  const order = [...r.slides];
                                  [order[i + 1], order[i]] = [
                                    order[i],
                                    order[i + 1],
                                  ];
                                  changeRoute(r.id, order);
                                }}
                              >
                                ↓
                              </button>
                              <button
                                onClick={() =>
                                  changeRoute(
                                    r.id,
                                    r.slides.filter((_, n) => n !== i),
                                  )
                                }
                              >
                                外す
                              </button>
                            </>
                          )}
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
              </>
            )}
          </>
        )}
        {message && (
          <p role="status">
            {ready && printing ? "PDFの準備ができました。" : message}
          </p>
        )}
      </dialog>
      {checkingPDF && (
        <FitReview
          pages={chosen}
          onContinue={preparePrint}
          onCancel={() => setCheckingPDF(false)}
          onEdit={(issue) => onFixIssue(issue, descriptor, chosenIds)}
        />
      )}
      {printing && (
        <div className="print-export" ref={printRoot} aria-hidden="true">
          {printing.map((s, i) => (
            <div className="print-page" key={`${s.id}-${i}`}>
              <Canvas slide={s} />
            </div>
          ))}
        </div>
      )}
    </>,
    document.body,
  );
}
function CompareCard({ book, slide }: { book: Deck; slide: Slide }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.4);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setZoom(
        Math.min(
          1,
          entry.contentRect.width / 960,
          entry.contentRect.height / 540,
        ),
      ),
    );
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <article>
      <h4>{slideLabel(book, slide)}</h4>
      <div className="compare-preview" ref={ref}>
        <Canvas slide={slide} zoom={zoom} />
      </div>
    </article>
  );
}
