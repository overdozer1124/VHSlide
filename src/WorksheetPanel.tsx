import { useActivityPanel } from "./ActivitiesPanel";
import { useEffect, useRef, useState } from "react";
import { useWorksheets } from "./WorksheetContext";
import { WorksheetAnswer, WorksheetInputs } from "./SlideWorksheet";
import { WorksheetModalLayout } from "./WorksheetModalLayout";
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
import { WorksheetSummary } from "./WorksheetSummary";
import { api } from "./cloud";
import { usePageVisible } from "./usePageVisible";
import { Plus } from "lucide-react";
import {
  mergeWorksheetSection,
  moveWorksheetFieldToSection,
  moveWorksheetSection,
  sectionWorksheet,
} from "./worksheetSections";
import { parseWorksheet } from "./worksheets";
import type { FormDraft } from "./formEditing";
export function WorksheetPanel({
  host,
  onEmbed,
  onEmbedResult,
  onFormSaved,
}: {
  host: boolean;
  onEmbed: (sheet: WorksheetView) => void;
  onEmbedResult: (sheet: WorksheetView, field: WorksheetField) => void;
  onFormSaved: (draft: FormDraft) => boolean;
}) {
  const ctx = useWorksheets();
  const activity = useActivityPanel();
  const open = activity.open && activity.active === "worksheet";
  const visible = usePageVisible();
  const connectionError = ctx.error;
  const close = activity.close;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    expected: WorksheetDefinition;
  }>();
  const [layoutEditing, setLayoutEditing] = useState<{
    id: string;
    expected: WorksheetDefinition;
    value: WorksheetDefinition;
  }>();
  const [hostView, setHostView] = useState<"results" | "input" | "settings">(
    "results",
  );
  const content = useRef<HTMLElement>(null);

  const [definition, setDefinition] = useState<WorksheetDefinition>(() =>
    sectionWorksheet(worksheetTemplate("reason")),
  );
  const [selectedId, setSelectedId] = useState("");
  const [movingFieldId, setMovingFieldId] = useState<string>();
  const [mergingSectionId, setMergingSectionId] = useState<string>();
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
    setMovingFieldId(undefined);
    setMergingSectionId(undefined);
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
    if (!open || !ctx.enabled || !visible) return;
    const refresh = () =>
      void ctx.refresh().catch((e) => {
        if (alive.current) setError((e as Error).message);
      });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [open, ctx.enabled, visible]);
  useEffect(() => {
    if (open && (error || connectionError || message))
      feedback.current?.scrollIntoView({ block: "nearest" });
  }, [open, error, connectionError, message]);
  useEffect(() => {
    if (
      !creating &&
      !layoutEditing &&
      !editing &&
      ctx.sheets.length &&
      !ctx.sheets.some((s) => s.id === selectedId)
    ) {
      setSelectedId(ctx.sheets[0].id);
      setHostView("results");
    }
  }, [creating, editing, layoutEditing, ctx.sheets, selectedId]);
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
      const value = parseWorksheet(definition);
      void (editing
        ? command(`/${editing.id}/edit`, {
            expected: editing.expected,
            definition: value,
          })
        : command("", value));
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
      if (path.endsWith("/edit") && (editing || selected) && ctx.deckId) {
        const expected = editing?.expected ?? selected!;
        const saved = data.worksheets.find(
          (item) => item.id === (editing?.id ?? selected?.id),
        );
        if (saved) {
          const value = {
            title: saved.title,
            description: saved.description,
            fontSize: saved.fontSize,
            modalLayout: saved.modalLayout,
            fields: saved.fields,
            sections: saved.sections,
          };
          if (
            !onFormSaved({
              kind: "worksheet",
              id: saved.id,
              deckId: ctx.deckId,
              elementId: "",
              expected,
              value,
            })
          )
            setError(
              "内容は保存されましたが、スライドのプレビュー更新を確認できませんでした。",
            );
        }
        if (editing) {
          setEditing(undefined);
          setHostView("settings");
        }
      }
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
  async function saveModalLayout() {
    if (!layoutEditing || !ctx.deckId || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api<{ worksheets: WorksheetView[] }>(
        `/api/decks/${ctx.deckId}/worksheets/${layoutEditing.id}/edit`,
        {
          method: "POST",
          body: JSON.stringify({
            expected: layoutEditing.expected,
            definition: layoutEditing.value,
          }),
        },
      );
      const saved = data.worksheets.find(
        (item) => item.id === layoutEditing.id,
      );
      if (!saved) throw Error("保存したワークシートを確認できませんでした。");
      ctx.update(data.worksheets);
      const value = {
        title: saved.title,
        description: saved.description,
        fields: saved.fields,
        sections: saved.sections,
        fontSize: saved.fontSize,
        modalLayout: saved.modalLayout,
      };
      if (
        !onFormSaved({
          kind: "worksheet",
          id: saved.id,
          deckId: ctx.deckId,
          elementId: "",
          expected: layoutEditing.expected,
          value,
        })
      )
        setError(
          "レイアウトは保存されましたが、スライドのプレビュー更新を確認できませんでした。",
        );
      setLayoutEditing(undefined);
      setMessage("画面のレイアウトを保存しました。");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const layoutField = (sheet: WorksheetDefinition, field: WorksheetField) => (
    <WorksheetInputs
      sheet={{
        ...sheet,
        fields: [
          {
            ...field,
            wide: true,
            widthPercent: undefined,
            inputHeight: undefined,
          },
        ],
      }}
      values={{}}
      onChange={() => {}}
      disabled
      preview
      hideScore
    />
  );
  const existingField = (id: string) =>
    !!editing?.expected.fields.some((field) => field.id === id);
  async function download(order: string[] = []) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const fresh = await ctx.refresh();
      if (!alive.current) return;
      const sheet = fresh.find((s) => s.id === selected.id);
      if (!sheet) throw Error("ワークシートが見つかりません。");
      if (sheet.results && order.length) {
        const rank = new Map(order.map((id, i) => [id, i]));
        sheet.results = {
          responses: [...sheet.results.responses].sort(
            (a, b) =>
              (rank.get(a.respondentId) ?? Number.MAX_SAFE_INTEGER) -
              (rank.get(b.respondentId) ?? Number.MAX_SAFE_INTEGER),
          ),
        };
      }
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
                  disabled={busy || !!layoutEditing}
                  onClick={() => {
                    setCreating(true);
                    setEditing(undefined);
                    setLayoutEditing(undefined);
                    setDefinition(
                      sectionWorksheet(worksheetTemplate("reason")),
                    );
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
                  disabled={busy || !!layoutEditing}
                  onClick={() => {
                    setSelectedId(s.id);
                    setHostView("results");
                    setCreating(false);
                    setEditing(undefined);
                    setLayoutEditing(undefined);
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
              {host && layoutEditing ? (
                <section
                  className="worksheet-layout-editor"
                  aria-label="フォーム画面のレイアウト編集"
                >
                  <h3>入力画面のレイアウト</h3>
                  <p>
                    各項目の「移動」をドラッグして配置し、右下の↘で幅と高さを変えます。横に移動するには先に幅を縮めます。矢印キーでも操作できます。
                  </p>
                  <div className="worksheet-layout-editor-actions">
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => void saveModalLayout()}
                    >
                      {busy ? "保存中…" : "レイアウトを保存"}
                    </button>
                    <button
                      className="button outline"
                      disabled={busy}
                      onClick={() =>
                        setLayoutEditing(
                          (current) =>
                            current && {
                              ...current,
                              value: {
                                ...current.value,
                                modalLayout: undefined,
                              },
                            },
                        )
                      }
                    >
                      標準の配置に戻す
                    </button>
                    <button
                      className="button outline"
                      disabled={busy}
                      onClick={() => {
                        if (
                          JSON.stringify(layoutEditing.value) !==
                            JSON.stringify(layoutEditing.expected) &&
                          !window.confirm("レイアウトの変更を破棄しますか？")
                        )
                          return;
                        setLayoutEditing(undefined);
                      }}
                    >
                      キャンセル
                    </button>
                  </div>
                  <WorksheetModalLayout
                    sheet={layoutEditing.value}
                    editing
                    onChange={(modalLayout) =>
                      setLayoutEditing(
                        (current) =>
                          current && {
                            ...current,
                            value: { ...current.value, modalLayout },
                          },
                      )
                    }
                    renderField={(field) =>
                      layoutField(layoutEditing.value, field)
                    }
                  />
                </section>
              ) : host && (creating || editing) ? (
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    createDraft();
                  }}
                >
                  <h3>
                    {editing ? "ワークシートを編集" : "ワークシートを作成"}
                  </h3>
                  {!editing && (
                    <label>
                      ひな形
                      <select
                        aria-label="ワークシートのひな形"
                        onChange={(e) =>
                          setDefinition(
                            sectionWorksheet(
                              worksheetTemplate(
                                e.target
                                  .value as keyof typeof worksheetTemplateNames,
                              ),
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
                  )}
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
                  <label>
                    ワークシート全体の文字の大きさ
                    <input
                      type="number"
                      aria-label="ワークシート全体の文字の大きさ"
                      min={12}
                      max={60}
                      placeholder="自動（18）"
                      value={definition.fontSize ?? ""}
                      onChange={(event) =>
                        setDefinition({
                          ...definition,
                          fontSize:
                            event.target.value === ""
                              ? undefined
                              : Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <small>
                    12〜60。スライドで個別に文字サイズを設定している場合は、その設定が優先されます。
                  </small>
                  <p>
                    {editing
                      ? "既存の回答を引き継ぎながら、項目の並べ替え・編集・追加ができます。"
                      : "入力欄は1〜40項目、ワークシートは1作品30件までです。"}
                  </p>
                  {definition.sections?.map((section, sectionIndex) => (
                    <section
                      className="worksheet-section-editor"
                      key={section.id}
                      aria-label={`セクション${sectionIndex + 1}`}
                    >
                      <h4>セクション {sectionIndex + 1}</h4>
                      <label>
                        セクション見出し
                        <input
                          aria-label={`セクション${sectionIndex + 1}の見出し`}
                          maxLength={200}
                          value={section.title}
                          placeholder="見出しなし"
                          onChange={(event) => {
                            const title = event.target.value;
                            setDefinition((d) => ({
                              ...d,
                              sections: d.sections!.map((s) =>
                                s.id === section.id ? { ...s, title } : s,
                              ),
                              fields: d.fields.map((f) =>
                                f.sectionId === section.id
                                  ? { ...f, section: title }
                                  : f,
                              ),
                            }));
                          }}
                        />
                      </label>
                      {definition.fields.map((f, i) =>
                        f.sectionId !== section.id ? null : (
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
                                disabled={existingField(f.id)}
                                value={f.kind}
                                onChange={(e) => {
                                  const kind = e.target
                                    .value as WorksheetField["kind"];
                                  editField(f.id, {
                                    kind,
                                    aggregatePublic:
                                      kind === "single" || kind === "multiple"
                                        ? f.aggregatePublic
                                        : undefined,
                                    reason:
                                      kind === "single" || kind === "multiple"
                                        ? f.reason
                                        : undefined,
                                    radar:
                                      kind === "radar"
                                        ? {
                                            axes: [
                                              "項目1",
                                              "項目2",
                                              "項目3",
                                              "項目4",
                                              "項目5",
                                              "項目6",
                                            ],
                                            series: ["場面1", "場面2"],
                                            min: 1,
                                            max: 5,
                                          }
                                        : undefined,
                                    ...(kind === "radar" ? { wide: true } : {}),
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
                                <option value="radar">
                                  数値とレーダーチャート
                                </option>
                              </select>
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
                              <>
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
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={!!f.reason}
                                    disabled={existingField(f.id) && !!f.reason}
                                    onChange={(e) =>
                                      editField(f.id, {
                                        reason: e.target.checked || undefined,
                                      })
                                    }
                                  />{" "}
                                  選択した理由を書く欄を追加
                                </label>
                              </>
                            )}
                            {f.kind === "radar" && f.radar && (
                              <div className="radar-config">
                                <label>
                                  項目（1行1項目・3〜10項目）
                                  <textarea
                                    aria-label={`レーダーチャートの項目${i + 1}`}
                                    value={f.radar.axes.join("\n")}
                                    onChange={(event) =>
                                      editField(f.id, {
                                        radar: {
                                          ...f.radar!,
                                          axes: event.target.value.split("\n"),
                                        },
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  比較する場面（1行1項目・1〜4項目）
                                  <textarea
                                    aria-label={`レーダーチャートの場面${i + 1}`}
                                    value={f.radar.series.join("\n")}
                                    onChange={(event) =>
                                      editField(f.id, {
                                        radar: {
                                          ...f.radar!,
                                          series:
                                            event.target.value.split("\n"),
                                        },
                                      })
                                    }
                                  />
                                </label>
                                <div className="radar-config-range">
                                  <label>
                                    最小値
                                    <input
                                      aria-label={`レーダーチャートの最小値${i + 1}`}
                                      type="number"
                                      min={0}
                                      max={99}
                                      disabled={existingField(f.id)}
                                      value={f.radar.min}
                                      onChange={(event) =>
                                        editField(f.id, {
                                          radar: {
                                            ...f.radar!,
                                            min: Number(event.target.value),
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                  <label>
                                    最大値
                                    <input
                                      aria-label={`レーダーチャートの最大値${i + 1}`}
                                      type="number"
                                      min={1}
                                      max={100}
                                      disabled={existingField(f.id)}
                                      value={f.radar.max}
                                      onChange={(event) =>
                                        editField(f.id, {
                                          radar: {
                                            ...f.radar!,
                                            max: Number(event.target.value),
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                </div>
                                {existingField(f.id) && (
                                  <small>
                                    回答との対応を保つため、既存の項目数・場面数・数値の範囲は変更できません。名称は変更できます。
                                  </small>
                                )}
                              </div>
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
                            <details className="worksheet-layout-settings">
                              <summary>入力欄の大きさ・文字を調整</summary>
                              <p>
                                空欄では自動になります。幅は配置先の横幅に対する割合です。
                              </p>
                              <div className="worksheet-layout-controls">
                                <label>
                                  幅（%）
                                  <input
                                    type="number"
                                    aria-label={`入力欄${i + 1}の幅`}
                                    min={20}
                                    max={100}
                                    placeholder="自動"
                                    value={f.widthPercent ?? ""}
                                    onChange={(event) =>
                                      editField(f.id, {
                                        widthPercent:
                                          event.target.value === ""
                                            ? undefined
                                            : Number(event.target.value),
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  高さ（px）
                                  <input
                                    type="number"
                                    aria-label={`入力欄${i + 1}の高さ`}
                                    min={32}
                                    max={400}
                                    placeholder="自動"
                                    value={f.inputHeight ?? ""}
                                    onChange={(event) =>
                                      editField(f.id, {
                                        inputHeight:
                                          event.target.value === ""
                                            ? undefined
                                            : Number(event.target.value),
                                      })
                                    }
                                  />
                                </label>
                                <label>
                                  文字（px）
                                  <input
                                    type="number"
                                    aria-label={`入力欄${i + 1}の文字の大きさ`}
                                    min={12}
                                    max={60}
                                    placeholder="全体と同じ"
                                    value={f.fontSize ?? ""}
                                    onChange={(event) =>
                                      editField(f.id, {
                                        fontSize:
                                          event.target.value === ""
                                            ? undefined
                                            : Number(event.target.value),
                                      })
                                    }
                                  />
                                </label>
                              </div>
                            </details>
                            <div className="worksheet-editor-actions">
                              <button
                                type="button"
                                disabled={i === 0}
                                aria-label={`入力欄${i + 1}を上へ移動`}
                                onClick={() =>
                                  setDefinition((d) => {
                                    const fields = [...d.fields];
                                    fields[i] = {
                                      ...fields[i],
                                      section: fields[i - 1].section,
                                      sectionId: fields[i - 1].sectionId,
                                    };
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
                                disabled={i === definition.fields.length - 1}
                                aria-label={`入力欄${i + 1}を下へ移動`}
                                onClick={() =>
                                  setDefinition((d) => {
                                    const fields = [...d.fields];
                                    fields[i] = {
                                      ...fields[i],
                                      section: fields[i + 1].section,
                                      sectionId: fields[i + 1].sectionId,
                                    };
                                    [fields[i], fields[i + 1]] = [
                                      fields[i + 1],
                                      fields[i],
                                    ];
                                    return { ...d, fields };
                                  })
                                }
                              >
                                下へ
                              </button>
                              <button
                                type="button"
                                disabled={
                                  (definition.sections?.length ?? 0) < 2
                                }
                                aria-label={`入力欄${i + 1}のセクションを移動`}
                                aria-expanded={movingFieldId === f.id}
                                onClick={() =>
                                  setMovingFieldId((id) =>
                                    id === f.id ? undefined : f.id,
                                  )
                                }
                              >
                                セクションを移動
                              </button>
                              <button
                                type="button"
                                disabled={
                                  definition.fields.length === 1 ||
                                  existingField(f.id)
                                }
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
                            {movingFieldId === f.id && (
                              <label>
                                移動先のセクション
                                <select
                                  aria-label={`入力欄${i + 1}の移動先セクション`}
                                  value=""
                                  autoFocus
                                  onKeyDown={(event) => {
                                    if (event.key === "Escape")
                                      setMovingFieldId(undefined);
                                  }}
                                  onChange={(event) => {
                                    const destination = event.target.value;
                                    if (!destination) return;
                                    setDefinition((d) =>
                                      moveWorksheetFieldToSection(
                                        d,
                                        f.id,
                                        destination,
                                      ),
                                    );
                                    setMovingFieldId(undefined);
                                  }}
                                >
                                  <option value="">移動先を選択</option>
                                  {definition.sections?.map((s, index) =>
                                    s.id === f.sectionId ? null : (
                                      <option key={s.id} value={s.id}>
                                        {`セクション ${index + 1}：${s.title || "見出しなし"}`}
                                      </option>
                                    ),
                                  )}
                                </select>
                                <small>
                                  選んだセクションの末尾に移動します。
                                </small>
                              </label>
                            )}
                          </fieldset>
                        ),
                      )}
                      <div className="worksheet-section-actions">
                        <button
                          type="button"
                          aria-label={`セクション${sectionIndex + 1}に入力欄を追加`}
                          className="button outline worksheet-add-field"
                          disabled={definition.fields.length >= 40}
                          onClick={() =>
                            setDefinition((d) => {
                              const fields = [...d.fields];
                              const last = fields.reduce(
                                (index, f, i) =>
                                  f.sectionId === section.id ? i : index,
                                -1,
                              );
                              const followingIds = new Set(
                                d
                                  .sections!.slice(sectionIndex + 1)
                                  .map((s) => s.id),
                              );
                              const next = fields.findIndex(
                                (f) =>
                                  f.sectionId && followingIds.has(f.sectionId),
                              );
                              const position =
                                last >= 0
                                  ? last + 1
                                  : next >= 0
                                    ? next
                                    : fields.length;
                              fields.splice(position, 0, {
                                ...worksheetTemplate("blank").fields[0],
                                sectionId: section.id,
                                section: section.title,
                              });
                              return { ...d, fields };
                            })
                          }
                        >
                          <Plus size={18} aria-hidden="true" /> 入力欄を追加
                        </button>
                        <button
                          type="button"
                          className="button outline"
                          aria-label={`セクション${sectionIndex + 1}を統合`}
                          aria-expanded={mergingSectionId === section.id}
                          disabled={definition.sections!.length < 2}
                          onClick={() =>
                            setMergingSectionId((id) =>
                              id === section.id ? undefined : section.id,
                            )
                          }
                        >
                          セクションを統合
                        </button>
                        <button
                          type="button"
                          className="button outline"
                          disabled={
                            definition.sections!.length <= 1 ||
                            definition.fields.some(
                              (f) => f.sectionId === section.id,
                            )
                          }
                          onClick={() =>
                            setDefinition((d) => ({
                              ...d,
                              sections: d.sections!.filter(
                                (s) => s.id !== section.id,
                              ),
                            }))
                          }
                        >
                          空のセクションを削除
                        </button>
                        <button
                          type="button"
                          className="button outline"
                          aria-label={`セクション${sectionIndex + 1}を上へ移動`}
                          disabled={sectionIndex === 0}
                          onClick={() => {
                            setDefinition((d) =>
                              moveWorksheetSection(d, section.id, -1),
                            );
                            setMergingSectionId(undefined);
                          }}
                        >
                          セクションを上へ
                        </button>
                        <button
                          type="button"
                          className="button outline"
                          aria-label={`セクション${sectionIndex + 1}を下へ移動`}
                          disabled={
                            sectionIndex === definition.sections!.length - 1
                          }
                          onClick={() => {
                            setDefinition((d) =>
                              moveWorksheetSection(d, section.id, 1),
                            );
                            setMergingSectionId(undefined);
                          }}
                        >
                          セクションを下へ
                        </button>
                      </div>
                      {mergingSectionId === section.id && (
                        <div
                          className="worksheet-section-merge"
                          role="group"
                          aria-label={`セクション${sectionIndex + 1}の統合先`}
                        >
                          <span>統合先の見出しを残します。</span>
                          <button
                            type="button"
                            className="button outline"
                            disabled={sectionIndex === 0}
                            onClick={() => {
                              setDefinition((d) =>
                                mergeWorksheetSection(d, section.id, -1),
                              );
                              setMergingSectionId(undefined);
                            }}
                          >
                            上のセクションと統合
                          </button>
                          <button
                            type="button"
                            className="button outline"
                            disabled={
                              sectionIndex === definition.sections!.length - 1
                            }
                            onClick={() => {
                              setDefinition((d) =>
                                mergeWorksheetSection(d, section.id, 1),
                              );
                              setMergingSectionId(undefined);
                            }}
                          >
                            下のセクションと統合
                          </button>
                        </div>
                      )}
                    </section>
                  ))}
                  <button
                    type="button"
                    className="button outline worksheet-add-field"
                    disabled={(definition.sections?.length ?? 0) >= 40}
                    onClick={() =>
                      setDefinition((d) => ({
                        ...d,
                        sections: [
                          ...(d.sections ?? []),
                          { id: crypto.randomUUID(), title: "" },
                        ],
                      }))
                    }
                  >
                    <Plus size={18} aria-hidden="true" />
                    セクションを追加
                  </button>
                  <details>
                    <summary>レイアウトのプレビュー</summary>
                    <div
                      className="worksheet-preview"
                      style={{ fontSize: definition.fontSize }}
                    >
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
                    {busy ? "保存中…" : editing ? "変更を保存" : "下書きを作成"}
                  </button>
                  {editing && (
                    <button
                      type="button"
                      className="button outline"
                      disabled={busy}
                      onClick={() => setEditing(undefined)}
                    >
                      キャンセル
                    </button>
                  )}
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
                      <button
                        className="button outline"
                        disabled={busy}
                        onClick={() => {
                          const expected = structuredClone({
                            title: selected.title,
                            description: selected.description,
                            fields: selected.fields,
                            sections: selected.sections,
                            fontSize: selected.fontSize,
                            modalLayout: selected.modalLayout,
                          });
                          setLayoutEditing({
                            id: selected.id,
                            expected,
                            value: structuredClone(expected),
                          });
                          setError("");
                          setMessage("");
                        }}
                      >
                        入力画面のレイアウトを編集
                      </button>
                      <button
                        className="button outline"
                        disabled={busy}
                        onClick={() => {
                          const expected = structuredClone({
                            title: selected.title,
                            description: selected.description,
                            fontSize: selected.fontSize,
                            modalLayout: selected.modalLayout,
                            fields: selected.fields,
                            sections: selected.sections,
                          });
                          setDefinition(sectionWorksheet(expected));
                          setEditing({ id: selected.id, expected });
                          setMessage("");
                          setError("");
                        }}
                      >
                        項目を編集・追加
                      </button>
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
                      {selected.modalLayout ? (
                        <WorksheetModalLayout
                          sheet={selected}
                          renderField={(field) => layoutField(selected, field)}
                        />
                      ) : (
                        <WorksheetInputs
                          sheet={selected}
                          values={{}}
                          onChange={() => {}}
                          disabled
                          preview
                        />
                      )}
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
                    <WorksheetAnswer key={selected.id} sheet={selected} modal />
                  </div>
                  {host && hostView === "results" && selected.results && (
                    <>
                      {selected.fields.some(
                        (field) =>
                          field.kind === "single" || field.kind === "multiple",
                      ) && (
                        <details className="worksheet-aggregate-details">
                          <summary>選択式の集計・公開・スライド配置</summary>
                          <WorksheetSummary
                            sheet={selected}
                            host
                            onShare={(field, published) =>
                              void command(`/${selected.id}/edit`, {
                                expected: selected,
                                definition: {
                                  ...selected,
                                  fields: selected.fields.map((f) =>
                                    f.id === field.id
                                      ? {
                                          ...f,
                                          aggregatePublic:
                                            published || undefined,
                                        }
                                      : f,
                                  ),
                                },
                              })
                            }
                            onInsert={(field) => {
                              try {
                                onEmbedResult(selected, field);
                                close();
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          />
                        </details>
                      )}
                      <WorksheetResults
                        key={selected.id}
                        sheet={selected}
                        busy={busy}
                        onDownload={(order) => void download(order)}
                      />
                    </>
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
