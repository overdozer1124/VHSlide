import { useContext, useEffect, useRef, useState } from "react";
import { api } from "./cloud";
import {
  parseWorksheet,
  TEXT_PLACEHOLDER_DEFAULT,
  type WorksheetDefinition,
  type WorksheetField,
  type WorksheetView,
} from "./worksheets";
import type { SurveyView } from "./surveys";
import type { FormDraft } from "./formEditing";
import { worksheetTemplate } from "./worksheetTemplates";
import { useWorksheets } from "./WorksheetContext";
import { SurveySlideContext } from "./SurveySlideContext";

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function definitionFrom(sheet: WorksheetView): WorksheetDefinition {
  return copy({
    title: sheet.title,
    description: sheet.description,
    fontSize: sheet.fontSize,
    modalLayout: sheet.modalLayout,
    fields: sheet.fields,
    sections: sheet.sections,
  });
}

/**
 * Host-only editor shown in the right sidebar when a worksheet, survey or
 * response-field object on the slide is selected, so the form's items can
 * be edited without opening the form dialog and drilling down to them.
 * Saves go through the same /edit endpoints as the form panels.
 */
export function WorksheetSidebarEditor({
  sheet,
  deckId,
  elementId,
  highlightFieldId,
  onFormSaved,
}: {
  sheet: WorksheetView;
  deckId: string;
  elementId: string;
  highlightFieldId?: string;
  onFormSaved: (draft: FormDraft) => boolean;
}) {
  const worksheets = useWorksheets();
  const [base, setBase] = useState(sheet);
  const [draft, setDraft] = useState(() => definitionFrom(sheet));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [stale, setStale] = useState(false);
  const fieldRefs = useRef(new Map<string, HTMLFieldSetElement>());
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(definitionFrom(base));
  useEffect(() => {
    if (sheet.id !== base.id) return;
    if (sheet === base) return;
    if (!dirty) {
      setBase(sheet);
      setDraft(definitionFrom(sheet));
    } else setStale(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);
  useEffect(() => {
    if (!highlightFieldId) return;
    const node = fieldRefs.current.get(highlightFieldId);
    node?.scrollIntoView({ block: "nearest" });
  }, [highlightFieldId]);
  function reload() {
    setBase(sheet);
    setDraft(definitionFrom(sheet));
    setStale(false);
    setError("");
    setMessage("");
  }
  function editField(id: string, patch: Partial<WorksheetField>) {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }
  function changeKind(f: WorksheetField, kind: WorksheetField["kind"]) {
    editField(f.id, {
      kind,
      placeholder:
        kind === "drawing" && f.placeholder === TEXT_PLACEHOLDER_DEFAULT
          ? ""
          : f.placeholder,
      hideLabel: kind === "checkbox" ? undefined : f.hideLabel,
      aggregatePublic:
        kind === "single" || kind === "multiple" ? f.aggregatePublic : undefined,
      reason:
        kind === "single" || kind === "multiple" ? f.reason : undefined,
      radar:
        kind === "radar"
          ? (f.radar ?? {
              axes: ["項目1", "項目2", "項目3", "項目4", "項目5", "項目6"],
              series: ["場面1", "場面2"],
              min: 1,
              max: 5,
            })
          : undefined,
      ...(kind === "radar" ? { wide: true } : {}),
      options:
        kind === "single" || kind === "multiple" ? ["はい", "いいえ"] : [],
    });
  }
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.fields.length) return;
    const fields = [...draft.fields];
    const a = fields[index],
      b = fields[target];
    fields[index] = { ...b, section: a.section, sectionId: a.sectionId };
    fields[target] = { ...a, section: b.section, sectionId: b.sectionId };
    setDraft((d) => ({ ...d, fields }));
  }
  function addField() {
    const last = draft.fields[draft.fields.length - 1];
    const field = {
      ...worksheetTemplate("blank").fields[0],
      section: last?.section ?? "",
      sectionId: last?.sectionId,
    };
    setDraft((d) => ({ ...d, fields: [...d.fields, field] }));
  }
  async function save() {
    if (busy) return;
    setError("");
    setMessage("");
    try {
      draft.fields.forEach((field, index) => {
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
      const definition = parseWorksheet(draft);
      setBusy(true);
      const data = await api<{ worksheets: WorksheetView[] }>(
        `/api/decks/${deckId}/worksheets/${base.id}/edit`,
        {
          method: "POST",
          body: JSON.stringify({ expected: base, definition }),
        },
      );
      worksheets.update(data.worksheets);
      const saved = data.worksheets.find((item) => item.id === base.id);
      if (!saved) throw new Error("保存後のワークシートを確認できませんでした。");
      if (
        !onFormSaved({
          kind: "worksheet",
          id: saved.id,
          deckId,
          elementId,
          expected: base,
          value: {
            title: saved.title,
            description: saved.description,
            fontSize: saved.fontSize,
            modalLayout: saved.modalLayout,
            fields: saved.fields,
            sections: saved.sections,
          },
        })
      )
        setError(
          "内容は保存されましたが、スライドのプレビュー更新を確認できませんでした。",
        );
      setBase(saved);
      setDraft(definitionFrom(saved));
      setStale(false);
      setMessage("保存しました。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const existing = (id: string) => base.fields.some((f) => f.id === id);
  let lastSection: string | null = null;
  return (
    <section className="form-sidebar-editor" aria-label="ワークシートの項目を編集">
      <h3>項目を編集</h3>
      <div className="worksheet-save form-sidebar-actions">
        <button type="button" disabled={busy || !dirty} onClick={() => void save()}>
          保存する
        </button>
        <button type="button" disabled={busy || !dirty} onClick={reload}>
          元に戻す
        </button>
      </div>
      <label>
        ワークシート名
        <input
          value={draft.title}
          maxLength={200}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
      </label>
      <label>
        説明
        <input
          value={draft.description}
          maxLength={500}
          onChange={(e) =>
            setDraft((d) => ({ ...d, description: e.target.value }))
          }
        />
      </label>
      {draft.fields.map((f, i) => {
        const sectionKey = f.sectionId ?? f.section;
        const heading = sectionKey !== lastSection ? f.section : "";
        lastSection = sectionKey;
        return (
          <div key={f.id}>
            {heading ? <h4 className="form-sidebar-section">{heading}</h4> : null}
            <fieldset
              className={`worksheet-field-editor${highlightFieldId === f.id ? " form-sidebar-highlight" : ""}`}
              ref={(node) => {
                if (node) fieldRefs.current.set(f.id, node);
                else fieldRefs.current.delete(f.id);
              }}
            >
              <legend>入力欄 {i + 1}</legend>
              <label>
                項目名
                <input
                  required
                  aria-label={`項目名${i + 1}`}
                  maxLength={200}
                  value={f.label}
                  onChange={(e) => editField(f.id, { label: e.target.value })}
                />
              </label>
              <label>
                形式
                <select
                  aria-label={`入力形式${i + 1}`}
                  disabled={existing(f.id)}
                  value={f.kind}
                  onChange={(e) =>
                    changeKind(f, e.target.value as WorksheetField["kind"])
                  }
                >
                  <option value="text">記述欄</option>
                  <option value="drawing">画像・手描き</option>
                  <option value="checkbox">チェック欄</option>
                  <option value="single">単一選択</option>
                  <option value="multiple">複数選択</option>
                  <option value="radar">数値とレーダーチャート</option>
                </select>
              </label>
              {(f.kind === "text" || f.kind === "drawing") && (
                <label>
                  {f.kind === "drawing" ? "貼り付け前の案内文" : "入力例"}
                  <input
                    maxLength={200}
                    value={f.placeholder}
                    onChange={(e) =>
                      editField(f.id, { placeholder: e.target.value })
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
                      disabled={existing(f.id) && !!f.reason}
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
                            series: event.target.value.split("\n"),
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
                        disabled={existing(f.id)}
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
                        disabled={existing(f.id)}
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
                  {existing(f.id) && (
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
                  onChange={(e) => editField(f.id, { wide: e.target.checked })}
                />{" "}
                横幅いっぱいに配置
              </label>
              {f.kind !== "checkbox" && (
                <label>
                  <input
                    type="checkbox"
                    checked={!!f.hideLabel}
                    aria-label={`入力欄${i + 1}の項目名を表示しない`}
                    onChange={(e) =>
                      editField(f.id, {
                        hideLabel: e.target.checked || undefined,
                      })
                    }
                  />{" "}
                  項目名（見出し）を表示しない
                </label>
              )}
              <details className="worksheet-layout-settings">
                <summary>入力欄の大きさ・文字を調整</summary>
                <p>空欄では自動になります。幅は配置先の横幅に対する割合です。</p>
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
                  onClick={() => move(i, -1)}
                >
                  上へ
                </button>
                <button
                  type="button"
                  disabled={i === draft.fields.length - 1}
                  aria-label={`入力欄${i + 1}を下へ移動`}
                  onClick={() => move(i, 1)}
                >
                  下へ
                </button>
                <button
                  type="button"
                  aria-label={`入力欄${i + 1}を削除`}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      fields: d.fields.filter((x) => x.id !== f.id),
                    }))
                  }
                >
                  削除
                </button>
              </div>
            </fieldset>
          </div>
        );
      })}
      <div className="worksheet-editor-actions">
        <button type="button" onClick={addField}>
          入力欄を追加
        </button>
      </div>
      {stale && (
        <p role="alert">
          他の画面で内容が更新されています。
          <button type="button" onClick={reload}>
            最新の内容を読み込む
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p>{message}</p>}
      <div className="worksheet-save">
        <button type="button" disabled={busy || !dirty} onClick={() => void save()}>
          保存する
        </button>
        <button type="button" disabled={busy || !dirty} onClick={reload}>
          元に戻す
        </button>
      </div>
      <p className="inspector-note">
        セクションの追加・変更や受付の開始・終了は、フォーム画面から行えます。
      </p>
    </section>
  );
}

export function SurveySidebarEditor({
  survey,
  deckId,
  elementId,
  onFormSaved,
}: {
  survey: SurveyView;
  deckId: string;
  elementId: string;
  onFormSaved: (draft: FormDraft) => boolean;
}) {
  const surveyContext = useContext(SurveySlideContext);
  const [base, setBase] = useState(survey);
  const [question, setQuestion] = useState(survey.question);
  const [options, setOptions] = useState<string[]>(survey.options);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [stale, setStale] = useState(false);
  const dirty =
    question !== base.question ||
    JSON.stringify(options) !== JSON.stringify(base.options);
  useEffect(() => {
    if (survey.id !== base.id || survey === base) return;
    if (!dirty) {
      setBase(survey);
      setQuestion(survey.question);
      setOptions(survey.options);
    } else setStale(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survey]);
  function reload() {
    setBase(survey);
    setQuestion(survey.question);
    setOptions(survey.options);
    setStale(false);
    setError("");
    setMessage("");
  }
  async function save() {
    if (busy) return;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const data = await api<{ surveys: SurveyView[] }>(
        `/api/decks/${deckId}/surveys/${base.id}/edit`,
        {
          method: "POST",
          body: JSON.stringify({
            expected: base,
            question,
            options: base.kind === "text" ? [] : options,
          }),
        },
      );
      surveyContext.onUpdated(data.surveys, deckId, surveyContext.userId);
      const saved = data.surveys.find((item) => item.id === base.id);
      if (!saved) throw new Error("保存後のアンケートを確認できませんでした。");
      if (
        !onFormSaved({
          kind: "survey",
          id: saved.id,
          deckId,
          elementId,
          expected: {
            question: base.question,
            kind: base.kind,
            options: base.options,
          },
          value: {
            question: saved.question,
            kind: saved.kind,
            options: saved.options,
          },
        })
      )
        setError(
          "内容は保存されましたが、スライドのプレビュー更新を確認できませんでした。",
        );
      setBase(saved);
      setQuestion(saved.question);
      setOptions(saved.options);
      setStale(false);
      setMessage("保存しました。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="form-sidebar-editor" aria-label="アンケートの項目を編集">
      <h3>項目を編集</h3>
      <div className="worksheet-save form-sidebar-actions">
        <button type="button" disabled={busy || !dirty} onClick={() => void save()}>
          保存する
        </button>
        <button type="button" disabled={busy || !dirty} onClick={reload}>
          元に戻す
        </button>
      </div>
      <label>
        質問
        <textarea
          aria-label="アンケートの質問"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={200}
          required
          disabled={busy}
        />
      </label>
      <p>
        回答形式：
        {base.kind === "text"
          ? "記述式"
          : base.kind === "multiple"
            ? "選択式（複数選ぶ）"
            : "選択式（1つ選ぶ）"}
      </p>
      {base.kind !== "text" && (
        <fieldset disabled={busy}>
          <legend>選択肢（2〜10項目）</legend>
          {options.map((option, i) => (
            <div className="survey-option-edit" key={i}>
              <input
                aria-label={`選択肢${i + 1}`}
                value={option}
                maxLength={60}
                required
                onChange={(e) =>
                  setOptions((o) => o.map((v, j) => (j === i ? e.target.value : v)))
                }
              />
              <button
                type="button"
                className="button outline"
                aria-label={`選択肢${i + 1}を削除`}
                disabled={options.length <= 2 || i < base.options.length}
                onClick={() =>
                  setOptions((o) => o.filter((_, j) => j !== i))
                }
              >
                削除
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button outline"
            disabled={options.length >= 10}
            onClick={() => setOptions((o) => [...o, ""])}
          >
            選択肢を追加
          </button>
        </fieldset>
      )}
      {stale && (
        <p role="alert">
          他の画面で内容が更新されています。
          <button type="button" onClick={reload}>
            最新の内容を読み込む
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p>{message}</p>}
      <div className="worksheet-save">
        <button type="button" disabled={busy || !dirty} onClick={() => void save()}>
          保存する
        </button>
        <button type="button" disabled={busy || !dirty} onClick={reload}>
          元に戻す
        </button>
      </div>
      <p className="inspector-note">
        受付の開始・終了や集計の共有は、フォーム画面から行えます。
      </p>
    </section>
  );
}
