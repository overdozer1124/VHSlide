import { useActivityPanel } from "./ActivitiesPanel";
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
import { worksheetCsv } from "./worksheetCsv";
import { WorksheetResults } from "./WorksheetResults";
import { api } from "./cloud";
import { parseWorksheet } from "./worksheets";
export function WorksheetPanel({
  host,
  onEmbed,
}: {
  host: boolean;
  onEmbed: (sheet: WorksheetView) => void;
}) {
  const ctx = useWorksheets();
  const activity = useActivityPanel();
  const open = activity.open && activity.active === "worksheet";
  const connectionError = ctx.error;
  const close = activity.close;
  const [creating, setCreating] = useState(false);
  const [hostView, setHostView] = useState<"results" | "input" | "settings">(
    "results",
  );
  const content = useRef<HTMLElement>(null);

  const [definition, setDefinition] = useState<WorksheetDefinition>(() =>
    worksheetTemplate("reason"),
  );
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [selectedId, creating, hostView]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const feedback = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (open && ctx.enabled)
      void ctx.refresh().catch((e) => {
        if (alive.current) setError((e as Error).message);
      });
  }, [open, ctx.enabled]);
  useEffect(() => {
    if (open && (error || connectionError || message))
      feedback.current?.scrollIntoView({ block: "nearest" });
  }, [open, error, connectionError, message]);
  useEffect(() => {
    if (
      !creating &&
      ctx.sheets.length &&
      !ctx.sheets.some((s) => s.id === selectedId)
    ) {
      setSelectedId(ctx.sheets[0].id);
      setHostView("results");
    }
  }, [creating, ctx.sheets, selectedId]);
  function createDraft() {
    if (busy) return;
    setError("");
    setMessage("");
    try {
      if (!definition.title.trim())
        throw new Error("ワークシートのタイトルを入力してください。");
      definition.fields.forEach((field, index) => {
        if (!field.label.trim())
          throw new Error(`入力欄 ${index + 1} の項目名を入力してください。`);
        if (
          (field.kind === "single" || field.kind === "multiple") &&
          (field.options.length < 2 ||
            field.options.length > 10 ||
            field.options.some((o) => !o.trim()) ||
            new Set(field.options).size !== field.options.length)
        )
          throw new Error(
            `入力欄 ${index + 1} の選択肢を、空行・重複のない2〜10項目で入力してください。`,
          );
      });
      void command("", parseWorksheet(definition));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const selected = ctx.sheets.find((s) => s.id === selectedId);
  async function command(path: string, value?: unknown, method = "POST") {
    if (busy || !ctx.enabled) return;
    setBusy(true);
    setError("");
    setMessage(path === "" ? "下書きを保存しています…" : "");
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
        setHostView("settings");
        setSelectedId(data.worksheets[0]?.id ?? "");
      }
      if (method === "DELETE") setSelectedId("");
      setMessage(
        path === ""
          ? "下書きを作成しました。クラウドに保存しました。「受付を開始」で公開できます。"
          : "保存しました。",
      );
    } catch (e) {
      if (alive.current) {
        setMessage("");
        setError(
          path === ""
            ? `下書きを作成できませんでした。${(e as Error).message}`
            : (e as Error).message,
        );
      }
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
  if (!activity.open) return null;
  return (
    <>
      {(error || connectionError || message) && (
        <div
          ref={feedback}
          className={`worksheet-feedback ${error || connectionError ? "has-error" : ""}`}
        >
          {error || connectionError ? (
            <p role="alert">{error || connectionError}</p>
          ) : (
            <p role="status">{message}</p>
          )}
        </div>
      )}
      {!ctx.enabled ? (
        <p>
          クラウドの共有作品で利用できます。作品を共有して開くと、ホストがワークシートを作成し、参加者が自分のアカウントで入力できます。
        </p>
      ) : (
        <>
          <p>
            ホストは名前・メールアドレスと最新の保存内容を確認できます。ホストが共有した回答・氏名は他の参加者にも表示されます。メールアドレスは共有されません。
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
                    setHostView("results");
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
              {!ctx.sheets.length && <p>まだワークシートがありません。</p>}
            </aside>
            <main ref={content}>
              {host && creating ? (
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    createDraft();
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
                      {Object.entries(worksheetTemplateNames).map(([k, v]) => (
                        <option value={k} key={k}>
                          {v}
                        </option>
                      ))}
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
                    <fieldset className="worksheet-field-editor" key={f.id}>
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
                              fields: d.fields.filter((x) => x.id !== f.id),
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
                    {busy ? "下書きを保存中…" : "下書きを作成"}
                  </button>
                </form>
              ) : selected ? (
                <>
                  <h3>{selected.title}</h3>
                  {host && (
                    <div className="worksheet-admin">
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() =>
                          void command(`/${selected.id}/status`, {
                            status:
                              selected.status === "open" ? "closed" : "open",
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
                    </div>
                  )}
                  {host && (
                    <div
                      className="worksheet-section-tabs"
                      role="group"
                      aria-label="ワークシートの表示内容"
                    >
                      <button
                        type="button"
                        aria-pressed={hostView === "results"}
                        onClick={() => setHostView("results")}
                      >
                        回答結果（
                        {selected.results?.responses.length ?? 0}人）
                      </button>
                      <button
                        type="button"
                        aria-pressed={hostView === "input"}
                        onClick={() => setHostView("input")}
                      >
                        自分で入力
                      </button>
                      <button
                        type="button"
                        aria-pressed={hostView === "settings"}
                        onClick={() => setHostView("settings")}
                      >
                        設定・内容の確認
                      </button>
                    </div>
                  )}
                  {host && hostView === "settings" && (
                    <section
                      className="worksheet-settings"
                      aria-label="ワークシートの設定"
                    >
                      <h4>内容の確認</h4>
                      <p>
                        {selected.description || "説明は設定されていません。"}
                      </p>
                      <p>
                        入力項目：{selected.fields.length}項目 ·{" "}
                        {selected.status === "draft"
                          ? "下書き（未公開）"
                          : selected.status === "open"
                            ? "入力受付中"
                            : "受付終了"}
                      </p>
                      <WorksheetInputs
                        sheet={selected}
                        values={{}}
                        onChange={() => {}}
                        disabled
                        preview
                      />
                      <p>
                        作成済みの項目は固定されています。項目を変更する場合は、新しいワークシートを作成してください。
                      </p>
                      <details className="worksheet-delete">
                        <summary>ワークシートの削除</summary>
                        <p>全員の入力結果も削除され、元に戻せません。</p>
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
                      </details>
                    </section>
                  )}
                  <div hidden={host && hostView !== "input"}>
                    <WorksheetAnswer key={selected.id} sheet={selected} />
                  </div>
                  {host && hostView === "results" && selected.results && (
                    <WorksheetResults
                      key={selected.id}
                      sheet={selected}
                      busy={busy}
                      onDownload={() => void download()}
                    />
                  )}
                </>
              ) : (
                <p>ワークシートを選択してください。</p>
              )}
            </main>
          </div>
        </>
      )}
    </>
  );
}
