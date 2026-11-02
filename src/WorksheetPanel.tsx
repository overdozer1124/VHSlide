import { useEffect, useRef, useState } from "react";
import { useWorksheets } from "./WorksheetContext";
import { WorksheetAnswer, WorksheetInputs } from "./SlideWorksheet";
import {
  worksheetTemplate,
  worksheetTemplateNames,
} from "./worksheetTemplates";
import type {
  WorksheetDefinition,
  WorksheetField,
  WorksheetView,
} from "./worksheets";
import { worksheetCsv, worksheetValueText } from "./worksheetCsv";
import { surveyResponseTime } from "./surveyCsv";
import { api } from "./cloud";
export function WorksheetPanel({
  host,
  presenting,
  onEmbed,
  error: connectionError,
}: {
  host: boolean;
  presenting: boolean;
  onEmbed: (sheet: WorksheetView) => void;
  error: string;
}) {
  const ctx = useWorksheets();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [definition, setDefinition] = useState<WorksheetDefinition>(() =>
    worksheetTemplate("reason"),
  );
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const modal = useRef<HTMLElement>(null);
  const launch = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (open) modal.current?.focus();
  }, [open]);
  const selected = ctx.sheets.find((s) => s.id === selectedId);
  function close() {
    setOpen(false);
    launch.current?.focus();
  }
  async function command(path: string, value?: unknown, method = "POST") {
    if (busy || !ctx.enabled) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api<{ worksheets: WorksheetView[] }>(
        `/api/decks/${ctx.deckId}/worksheets${path}`,
        {
          method,
          body: value === undefined ? undefined : JSON.stringify(value),
        },
      );
      if (!alive.current) return;
      ctx.update(data.worksheets);
      if (path === "") {
        setCreating(false);
        setSelectedId(data.worksheets[0]?.id ?? "");
      }
      if (method === "DELETE") setSelectedId("");
      setMessage("保存しました。");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function editField(id: string, patch: Partial<WorksheetField>) {
    setDefinition((d) => ({
      ...d,
      fields: d.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }
  async function download() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const fresh = await ctx.refresh();
      if (!alive.current) return;
      const sheet = fresh.find((s) => s.id === selected.id);
      if (!sheet) throw Error("ワークシートが見つかりません。");
      const url = URL.createObjectURL(
        new Blob([worksheetCsv(sheet)], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `ワークシート_${sheet.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("最新の入力結果をCSVで保存しました。");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      <button
        ref={launch}
        className={`button outline worksheet-launch ${presenting ? "presenting" : ""}`}
        onClick={() => {
          setOpen(true);
          if (ctx.enabled) void ctx.refresh().catch((e) => setError(e.message));
        }}
      >
        ワークシート{ctx.sheets.length ? `（${ctx.sheets.length}）` : ""}
      </button>
      {open && (
        <div
          className="survey-overlay"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") close();
            if (e.key === "Tab") {
              const items = modal.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
              );
              if (items?.length) {
                const first = items[0],
                  last = items[items.length - 1];
                if (
                  e.shiftKey &&
                  (document.activeElement === first ||
                    document.activeElement === modal.current)
                ) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }
          }}
        >
          <section
            className="survey-panel worksheet-panel"
            role="dialog"
            aria-modal="true"
            aria-label="ワークシート"
            tabIndex={-1}
            ref={modal}
          >
            <header>
              <h2>ワークシート</h2>
              <button
                className="button outline"
                aria-label="ワークシートを閉じる"
                onClick={close}
              >
                ×
              </button>
            </header>
            {!ctx.enabled ? (
              <p>
                クラウドの共有作品で利用できます。作品を共有して開くと、ホストがワークシートを作成し、参加者が自分のアカウントで入力できます。
              </p>
            ) : (
              <>
                <p>
                  名前・メールアドレスと入力結果はホストだけが確認できます。各自の最新の保存内容を集約します。
                </p>
                <div className="survey-layout">
                  <aside>
                    {host && (
                      <button
                        className="button primary"
                        onClick={() => {
                          setCreating(true);
                          setDefinition(worksheetTemplate("reason"));
                          setMessage("");
                          setError("");
                        }}
                      >
                        新しいワークシート
                      </button>
                    )}
                    {ctx.sheets.map((s) => (
                      <button
                        key={s.id}
                        className={`survey-item ${selectedId === s.id ? "active" : ""}`}
                        onClick={() => {
                          setSelectedId(s.id);
                          setCreating(false);
                          setError("");
                          setMessage("");
                        }}
                      >
                        <strong>{s.title}</strong>
                        <span>
                          {s.status === "draft"
                            ? "下書き"
                            : s.status === "open"
                              ? "入力受付中"
                              : "受付終了"}
                        </span>
                      </button>
                    ))}
                    {!ctx.sheets.length && (
                      <p>まだワークシートがありません。</p>
                    )}
                  </aside>
                  <main>
                    {host && creating ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void command("", definition);
                        }}
                      >
                        <h3>ワークシートを作成</h3>
                        <label>
                          ひな形
                          <select
                            aria-label="ワークシートのひな形"
                            onChange={(e) =>
                              setDefinition(
                                worksheetTemplate(
                                  e.target
                                    .value as keyof typeof worksheetTemplateNames,
                                ),
                              )
                            }
                            defaultValue="reason"
                          >
                            {Object.entries(worksheetTemplateNames).map(
                              ([k, v]) => (
                                <option value={k} key={k}>
                                  {v}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          タイトル
                          <input
                            required
                            maxLength={200}
                            aria-label="ワークシートのタイトル"
                            value={definition.title}
                            onChange={(e) =>
                              setDefinition({
                                ...definition,
                                title: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          説明・資料・キーワード
                          <textarea
                            maxLength={1000}
                            value={definition.description}
                            onChange={(e) =>
                              setDefinition({
                                ...definition,
                                description: e.target.value,
                              })
                            }
                          />
                        </label>
                        <p>
                          作成後は項目を固定します。項目を変える場合は新しいワークシートを作成してください。1〜40項目、1作品30件まで。
                        </p>
                        {definition.fields.map((f, i) => (
                          <fieldset
                            className="worksheet-field-editor"
                            key={f.id}
                          >
                            <legend>入力欄 {i + 1}</legend>
                            <label>
                              項目名
                              <input
                                required
                                aria-label={`項目名${i + 1}`}
                                maxLength={200}
                                value={f.label}
                                onChange={(e) =>
                                  editField(f.id, { label: e.target.value })
                                }
                              />
                            </label>
                            <label>
                              形式
                              <select
                                aria-label={`入力形式${i + 1}`}
                                value={f.kind}
                                onChange={(e) => {
                                  const kind = e.target
                                    .value as WorksheetField["kind"];
                                  editField(f.id, {
                                    kind,
                                    options:
                                      kind === "single" || kind === "multiple"
                                        ? ["はい", "いいえ"]
                                        : [],
                                  });
                                }}
                              >
                                <option value="text">記述欄</option>
                                <option value="checkbox">チェック欄</option>
                                <option value="single">単一選択</option>
                                <option value="multiple">複数選択</option>
                              </select>
                            </label>
                            <label>
                              セクション見出し
                              <input
                                maxLength={200}
                                value={f.section}
                                onChange={(e) =>
                                  editField(f.id, { section: e.target.value })
                                }
                              />
                            </label>
                            {f.kind === "text" && (
                              <label>
                                入力例
                                <input
                                  maxLength={200}
                                  value={f.placeholder}
                                  onChange={(e) =>
                                    editField(f.id, {
                                      placeholder: e.target.value,
                                    })
                                  }
                                />
                              </label>
                            )}
                            {(f.kind === "single" || f.kind === "multiple") && (
                              <label>
                                選択肢（1行1項目・2〜10項目）
                                <textarea
                                  value={f.options.join("\n")}
                                  onChange={(e) =>
                                    editField(f.id, {
                                      options: e.target.value.split("\n"),
                                    })
                                  }
                                />
                              </label>
                            )}
                            <label>
                              <input
                                type="checkbox"
                                checked={f.wide}
                                onChange={(e) =>
                                  editField(f.id, { wide: e.target.checked })
                                }
                              />
                              横幅いっぱいに配置
                            </label>
                            <div className="worksheet-editor-actions">
                              <button
                                type="button"
                                disabled={i === 0}
                                onClick={() =>
                                  setDefinition((d) => {
                                    const fields = [...d.fields];
                                    [fields[i - 1], fields[i]] = [
                                      fields[i],
                                      fields[i - 1],
                                    ];
                                    return { ...d, fields };
                                  })
                                }
                              >
                                上へ
                              </button>
                              <button
                                type="button"
                                disabled={definition.fields.length === 1}
                                onClick={() =>
                                  setDefinition((d) => ({
                                    ...d,
                                    fields: d.fields.filter(
                                      (x) => x.id !== f.id,
                                    ),
                                  }))
                                }
                              >
                                項目を削除
                              </button>
                            </div>
                          </fieldset>
                        ))}
                        <button
                          type="button"
                          disabled={definition.fields.length >= 40}
                          onClick={() =>
                            setDefinition((d) => ({
                              ...d,
                              fields: [
                                ...d.fields,
                                ...worksheetTemplate("blank").fields,
                              ],
                            }))
                          }
                        >
                          入力欄を追加
                        </button>
                        <details>
                          <summary>レイアウトのプレビュー</summary>
                          <div className="worksheet-preview">
                            <h3>{definition.title}</h3>
                            <p>{definition.description}</p>
                            <WorksheetInputs
                              sheet={definition}
                              values={{}}
                              onChange={() => {}}
                              disabled
                              preview
                            />
                          </div>
                        </details>
                        <button className="button primary" disabled={busy}>
                          下書きを作成
                        </button>
                      </form>
                    ) : selected ? (
                      <>
                        <h3>{selected.title}</h3>
                        <p>{selected.description}</p>
                        {host && (
                          <div className="worksheet-admin">
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={() =>
                                void command(`/${selected.id}/status`, {
                                  status:
                                    selected.status === "open"
                                      ? "closed"
                                      : "open",
                                })
                              }
                            >
                              {selected.status === "open"
                                ? "受付を終了"
                                : "受付を開始"}
                            </button>
                            <button
                              className="button outline"
                              disabled={selected.status === "draft" || busy}
                              onClick={() => {
                                try {
                                  onEmbed(selected);
                                  close();
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
                            >
                              このワークシートをスライドに配置
                            </button>
                            <button
                              className="button outline"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "このワークシートと全員の入力結果を削除します。元に戻せません。",
                                  )
                                )
                                  void command(
                                    `/${selected.id}`,
                                    undefined,
                                    "DELETE",
                                  );
                              }}
                            >
                              ワークシートを削除
                            </button>
                          </div>
                        )}
                        <WorksheetAnswer key={selected.id} sheet={selected} />
                        {host && selected.results && (
                          <section
                            className="worksheet-results"
                            aria-label="ワークシート入力結果"
                          >
                            <h3>
                              入力結果 · {selected.results.responses.length}人
                            </h3>
                            <button
                              className="button outline"
                              disabled={
                                busy || !selected.results.responses.length
                              }
                              onClick={() => void download()}
                            >
                              入力結果をCSV保存
                            </button>
                            <p>
                              1人1行で、全項目と最終保存日時を保存します。未入力も含め、各参加者の最新の保存内容を表示します。
                            </p>
                            <div className="survey-response-table-wrap">
                              <table className="survey-response-table">
                                <thead>
                                  <tr>
                                    <th>回答者名</th>
                                    <th>メールアドレス</th>
                                    {selected.fields.map((f) => (
                                      <th key={f.id}>
                                        {f.section ? f.section + "：" : ""}
                                        {f.label}
                                      </th>
                                    ))}
                                    <th>最終保存（日本時間）</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selected.results.responses.map((r) => (
                                    <tr key={r.respondentId}>
                                      <th scope="row">{r.name}</th>
                                      <td>{r.email}</td>
                                      {selected.fields.map((f) => (
                                        <td
                                          className="survey-response-answer"
                                          key={f.id}
                                        >
                                          {worksheetValueText(f, r.values) ||
                                            "（未入力）"}
                                        </td>
                                      ))}
                                      <td>{surveyResponseTime(r.updated)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </section>
                        )}
                      </>
                    ) : (
                      <p>ワークシートを選択してください。</p>
                    )}
                  </main>
                </div>
              </>
            )}
            {(error || connectionError) && (
              <p role="alert">{error || connectionError}</p>
            )}
            {message && <p role="status">{message}</p>}
          </section>
        </div>
      )}
    </>
  );
}
