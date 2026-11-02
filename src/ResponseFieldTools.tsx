import { ResponseField } from "./ResponseField";
import { useContext, useState, useEffect } from "react";
import { useWorksheets } from "./WorksheetContext";
import { SurveySlideContext } from "./SurveySlideContext";
import type { Element, Slide } from "./model";
import { parseResponseField } from "./responseFields";
import type { ResponseFieldBinding } from "./responseFields";
import type { WorksheetField, WorksheetView } from "./worksheets";
import type { SurveyView } from "./surveys";
import { api } from "./cloud";
export function makeResponseElement(binding: ResponseFieldBinding): Element {
  return {
    id: crypto.randomUUID(),
    type: "shape",
    shape: "rounded",
    x: 60,
    y: 150,
    w: 400,
    h: 170,
    fill: "#ffffff",
    stroke: "#a7c0ab",
    strokeWidth: 1,
    text:
      binding.source === "worksheet" ? binding.field.label : binding.question,
    fontSize: 20,
    color: "#173d38",
    responseField: parseResponseField(binding),
  };
}
export function ResponseFieldTools({
  onPlace,
  slide,
  onBusyChange,
}: {
  onPlace: (elements: Element[]) => void;
  slide: Slide;
  onBusyChange?: (busy: boolean) => void;
}) {
  const ctx = useWorksheets();
  const surveys = useContext(SurveySlideContext);
  const [source, setSource] = useState<"worksheet" | "survey">("worksheet");
  const [record, setRecord] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [create, setCreate] = useState(true);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<WorksheetField["kind"]>("text");
  const [options, setOptions] = useState("はい\nいいえ");
  const [placeholder, setPlaceholder] = useState("ここに入力");
  const [groupTitle, setGroupTitle] = useState("ワークシート");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const [templateName, setTemplateName] = useState("");
  const storageKey = `vhslide-input-layouts:${ctx.userId}`;
  const [templates, setTemplates] = useState<
    { name: string; elements: Element[] }[]
  >(() => {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      return Array.isArray(data)
        ? data
            .filter(
              (t) =>
                t && typeof t.name === "string" && Array.isArray(t.elements),
            )
            .slice(-10)
        : [];
    } catch {
      return [];
    }
  });
  const sheet = ctx.sheets.find((s) => s.id === record) ?? ctx.sheets[0];
  const survey =
    surveys.surveys.find((s) => s.id === record) ?? surveys.surveys[0];
  const field = sheet?.fields.find((f) => f.id === fieldId) ?? sheet?.fields[0];
  async function add() {
    if (busy || !ctx.host || !ctx.enabled) return;
    setBusy(true);
    setError("");
    try {
      let binding: ResponseFieldBinding;
      if (source === "worksheet") {
        let current: WorksheetView | undefined = sheet;
        let item = field;
        if (create) {
          item = {
            id: crypto.randomUUID(),
            label,
            kind,
            placeholder,
            options:
              kind === "single" || kind === "multiple"
                ? options.split("\n").map((s) => s.trim())
                : [],
            section: "",
            wide: true,
          };
          const data = await api<{ worksheets: WorksheetView[] }>(
            `/api/decks/${ctx.deckId}/worksheets${record === "new" || !sheet ? "" : `/${sheet.id}/field`}`,
            {
              method: "POST",
              body: JSON.stringify(
                record === "new" || !sheet
                  ? { title: groupTitle, description: "", fields: [item] }
                  : { field: item },
              ),
            },
          );
          ctx.update(data.worksheets);
          current = data.worksheets.find((s) =>
            s.fields.some((f) => f.id === item!.id),
          );
        }
        if (!current || !item)
          throw Error("ワークシートと項目を選択してください。");
        if (current.status === "draft") {
          const data = await api<{ worksheets: WorksheetView[] }>(
            `/api/decks/${ctx.deckId}/worksheets/${current.id}/status`,
            { method: "POST", body: JSON.stringify({ status: "open" }) },
          );
          ctx.update(data.worksheets);
        }
        binding = {
          source: "worksheet",
          deckId: ctx.deckId!,
          worksheetId: current.id,
          field: item,
          showLabel: true,
        };
      } else {
        let current = survey;
        if (create) {
          const data = await api<{ surveys: SurveyView[] }>(
            `/api/decks/${ctx.deckId}/surveys`,
            {
              method: "POST",
              body: JSON.stringify({
                question: label,
                kind: kind === "checkbox" ? "multiple" : kind,
                options:
                  kind === "text"
                    ? []
                    : options.split("\n").map((s) => s.trim()),
              }),
            },
          );
          current = data.surveys[0];
          surveys.onUpdated(data.surveys, ctx.deckId, ctx.userId);
        }
        if (!current) throw Error("アンケートを選択してください。");
        if (current.status === "draft") {
          const data = await api<{ surveys: SurveyView[] }>(
            `/api/decks/${ctx.deckId}/surveys/${current.id}/status`,
            { method: "POST", body: JSON.stringify({ status: "open" }) },
          );
          surveys.onUpdated(data.surveys, ctx.deckId, ctx.userId);
        }
        binding = {
          source: "survey",
          deckId: ctx.deckId!,
          surveyId: current.id,
          question: current.question,
          kind: current.kind,
          options: current.options,
          showLabel: true,
        };
      }
      onPlace([makeResponseElement(binding)]);
      if (create) setLabel("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function saveTemplate() {
    const elements = slide.elements.filter((e) => e.responseField);
    if (!elements.length || !templateName.trim()) {
      setError("ひな形の名前と、保存する入力欄を確認してください。");
      return;
    }
    const next = [
      ...templates.filter((t) => t.name !== templateName.trim()),
      { name: templateName.trim(), elements },
    ].slice(-10);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setTemplates(next);
      setTemplateName("");
    } catch {
      setError("端末にひな形を保存できませんでした。");
    }
  }
  async function useTemplate(index: number) {
    if (busy || !ctx.enabled || !ctx.host) return;
    setBusy(true);
    setError("");
    try {
      const template = templates[index];
      const mapping = new Map<string, WorksheetField>();
      for (const e of template.elements) {
        const b = parseResponseField(e.responseField);
        const key =
          b.source === "worksheet"
            ? `${b.worksheetId}/${b.field.id}`
            : b.surveyId;
        if (!mapping.has(key))
          mapping.set(
            key,
            b.source === "worksheet"
              ? { ...b.field, id: crypto.randomUUID() }
              : {
                  id: crypto.randomUUID(),
                  label: b.question,
                  kind: b.kind,
                  options: b.options,
                  placeholder: "ここに入力",
                  section: "",
                  wide: true,
                },
          );
      }
      const fields = [...mapping.values()];
      const data = await api<{ worksheets: WorksheetView[] }>(
        `/api/decks/${ctx.deckId}/worksheets`,
        {
          method: "POST",
          body: JSON.stringify({
            title: template.name,
            description: "入力欄の配置ひな形から作成",
            fields,
          }),
        },
      );
      const created = data.worksheets.find((s) =>
        s.fields.some((f) => f.id === fields[0].id),
      )!;
      const opened = await api<{ worksheets: WorksheetView[] }>(
        `/api/decks/${ctx.deckId}/worksheets/${created.id}/status`,
        { method: "POST", body: JSON.stringify({ status: "open" }) },
      );
      ctx.update(opened.worksheets);
      const groups = new Map<string, string>();
      onPlace(
        template.elements.map((e) => {
          const b = parseResponseField(e.responseField);
          const key =
            b.source === "worksheet"
              ? `${b.worksheetId}/${b.field.id}`
              : b.surveyId;
          if (e.groupId && !groups.has(e.groupId))
            groups.set(e.groupId, crypto.randomUUID());
          return {
            ...e,
            id: crypto.randomUUID(),
            groupId: e.groupId ? groups.get(e.groupId) : undefined,
            responseField: parseResponseField({
              source: "worksheet",
              deckId: ctx.deckId!,
              worksheetId: created.id,
              field: mapping.get(key),
              showLabel: b.showLabel,
            }),
          };
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const previewOptions = options
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const previewField: WorksheetField = create
    ? {
        id: "preview",
        label: label || "質問・項目名",
        kind,
        options: previewOptions.length
          ? previewOptions
          : ["選択肢1", "選択肢2"],
        placeholder,
        section: "",
        wide: true,
      }
    : (field ?? {
        id: "preview",
        label: "項目を選択してください",
        kind: "text",
        options: [],
        placeholder: "ここに入力",
        section: "",
        wide: true,
      });
  const previewBinding: ResponseFieldBinding =
    source === "worksheet"
      ? {
          source: "worksheet",
          deckId: ctx.deckId ?? "",
          worksheetId: sheet?.id ?? "",
          field: previewField,
          showLabel: true,
        }
      : {
          source: "survey",
          deckId: ctx.deckId ?? "",
          surveyId: survey?.id ?? "",
          question: create
            ? label || "質問・項目名"
            : (survey?.question ?? "アンケートを選択してください"),
          kind: create
            ? kind === "checkbox"
              ? "multiple"
              : kind
            : (survey?.kind ?? "text"),
          options: create
            ? previewOptions.length
              ? previewOptions
              : ["選択肢1", "選択肢2"]
            : (survey?.options ?? []),
          showLabel: true,
        };
  const previewElement: Element = {
    id: "preview",
    type: "shape",
    shape: "rounded",
    x: 0,
    y: 0,
    w: 400,
    h: 200,
    fill: "#ffffff",
    stroke: "#a7c0ab",
    strokeWidth: 1,
    fontSize: 20,
    color: "#173d38",
    responseField: previewBinding,
  };
  return (
    <section
      className="response-field-tools response-field-creator"
      aria-label="回答欄の追加"
    >
      {!ctx.enabled || !ctx.host ? (
        <p>
          回答欄はクラウドの共有作品で利用できます。「クラウド」から作品を開くと、ホストが作成できます。
        </p>
      ) : (
        <>
          <div className="response-field-form">
            <div
              className="response-field-mode"
              role="group"
              aria-label="回答欄の作り方"
            >
              <button aria-pressed={create} onClick={() => setCreate(true)}>
                新しく作る
              </button>
              <button aria-pressed={!create} onClick={() => setCreate(false)}>
                作成済みの項目を使う
              </button>
            </div>
            {!create && (source === "worksheet" ? !sheet : !survey) && (
              <p>
                作成済みの項目はありません。「新しく作る」を選んでください。
              </p>
            )}
            <details
              className="response-field-destination"
              key={create ? "new-destination" : "existing-destination"}
              open={!create}
            >
              <summary>
                {create
                  ? `保存先：${source === "survey" ? "アンケート" : record === "new" || !sheet ? "新しいワークシート" : sheet.title}（変更する）`
                  : "使用する項目を選択"}
              </summary>
              <label>
                回答を集める機能
                <select
                  aria-label="入力欄の保存先"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value as typeof source);
                    if (e.target.value === "survey" && kind === "checkbox")
                      setKind("multiple");
                    setRecord("");
                  }}
                >
                  <option value="worksheet">ワークシート</option>
                  <option value="survey">アンケート</option>
                </select>
              </label>
              {source === "worksheet" ? (
                <>
                  <label>
                    ワークシート
                    <select
                      aria-label="配置するワークシート"
                      value={record || sheet?.id || "new"}
                      onChange={(e) => {
                        setRecord(e.target.value);
                        setFieldId("");
                      }}
                    >
                      {ctx.sheets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                      {create && (
                        <option value="new">新しいワークシート</option>
                      )}
                    </select>
                  </label>
                  {!create && (
                    <label>
                      入力項目
                      <select
                        aria-label="配置する入力項目"
                        value={fieldId || field?.id || ""}
                        onChange={(e) => setFieldId(e.target.value)}
                      >
                        {sheet?.fields.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {create && (record === "new" || !sheet) && (
                    <label>
                      ワークシート名
                      <input
                        value={groupTitle}
                        onChange={(e) => setGroupTitle(e.target.value)}
                        maxLength={200}
                      />
                    </label>
                  )}
                </>
              ) : (
                !create && (
                  <label>
                    アンケート
                    <select
                      aria-label="配置するアンケート"
                      value={record || survey?.id || ""}
                      onChange={(e) => setRecord(e.target.value)}
                    >
                      {surveys.surveys.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.question}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              )}
            </details>
            {create && (
              <>
                <label>
                  項目名（必須）
                  <input
                    autoFocus
                    aria-label="新しい入力項目名"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    maxLength={200}
                  />
                </label>
                <fieldset className="response-kind-picker">
                  <legend>回答形式</legend>
                  <div>
                    {(
                      [
                        ["text", "記述", "自分の考えを文章で"],
                        ["checkbox", "チェック", "あてはまるかを確認"],
                        ["single", "単一選択", "選択肢から1つ"],
                        ["multiple", "複数選択", "選択肢から複数"],
                      ] as const
                    )
                      .filter(
                        ([value]) =>
                          source === "worksheet" || value !== "checkbox",
                      )
                      .map(([value, title, description]) => (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={kind === value}
                          onClick={() => setKind(value)}
                        >
                          <strong>{title}</strong>
                          <small>{description}</small>
                        </button>
                      ))}
                  </div>
                </fieldset>
                {kind === "text" ? (
                  <label>
                    入力例
                    <input
                      value={placeholder}
                      maxLength={200}
                      onChange={(e) => setPlaceholder(e.target.value)}
                    />
                  </label>
                ) : (
                  kind !== "checkbox" && (
                    <label>
                      選択肢（1行1項目）
                      <textarea
                        value={options}
                        onChange={(e) => setOptions(e.target.value)}
                      />
                    </label>
                  )
                )}
              </>
            )}
            {create && !label.trim() && (
              <p>項目名を入力すると、スライドに追加できます。</p>
            )}
            <button
              className="button primary"
              disabled={
                busy ||
                (create
                  ? !label.trim()
                  : source === "worksheet"
                    ? !field
                    : !survey)
              }
              onClick={() => void add()}
            >
              {busy ? "追加しています…" : "スライドに追加"}
            </button>
            <p>
              同じ項目を複数の場所に置くと、同じ回答を表示します。位置・サイズ・色・枠線は配置後に編集できます。
            </p>
            <details>
              <summary>入力欄の配置ひな形</summary>
              <label>
                ひな形の名前
                <input
                  maxLength={100}
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                />
              </label>
              <button className="button outline" onClick={saveTemplate}>
                このページの入力欄の配置を保存
              </button>
              {templates.map((t, i) => (
                <div key={t.name}>
                  <span>{t.name}</span>
                  <button disabled={busy} onClick={() => void useTemplate(i)}>
                    新しい項目として配置
                  </button>
                  <button
                    onClick={() => {
                      const next = templates.filter((_, n) => n !== i);
                      localStorage.setItem(storageKey, JSON.stringify(next));
                      setTemplates(next);
                    }}
                  >
                    ひな形を削除
                  </button>
                </div>
              ))}
              <p>
                ひな形はこのアカウントの端末に保存します。回答内容は含みません。
              </p>
            </details>
            {error && <p role="alert">{error}</p>}
          </div>
          <aside className="response-field-preview">
            <h3>配置する回答欄のプレビュー</h3>
            <div className="response-preview-slide">
              <ResponseField element={previewElement} />
            </div>
            <p>
              追加後に、位置・大きさ・色・枠線・項目名の表示を変更できます。
            </p>
            <p>
              参加者の回答はアカウントごとに自動保存されます。回答一覧とCSVはフォーム内のアンケート・ワークシートのタブから確認できます。
            </p>
          </aside>
        </>
      )}
      {!ctx.enabled && error && <p role="alert">{error}</p>}
    </section>
  );
}
export function ResponseFieldAppearance({
  element: e,
  onChange,
  onPlace,
}: {
  element: Element;
  onPlace: (elements: Element[]) => void;
  onChange: (patch: Partial<Element>) => void;
}) {
  const b = e.responseField!;
  return (
    <section className="response-field-tools" aria-label="入力欄の設定">
      <h3>入力欄の設定</h3>
      <SeparateResponseField key={e.id} element={e} onPlace={onPlace} />
      <label>
        <input
          type="checkbox"
          checked={b.showLabel}
          onChange={(ev) =>
            onChange({ responseField: { ...b, showLabel: ev.target.checked } })
          }
        />
        項目名を表示
      </label>
      <label>
        文字サイズ
        <input
          type="number"
          min={12}
          max={120}
          value={e.fontSize ?? 20}
          onChange={(ev) => {
            const fontSize = Number(ev.target.value);
            if (fontSize >= 12 && fontSize <= 120) onChange({ fontSize });
          }}
        />
      </label>
      <label>
        文字色
        <input
          type="color"
          value={e.color ?? "#173d38"}
          onChange={(ev) => onChange({ color: ev.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={e.fill === "none"}
          onChange={(ev) =>
            onChange({ fill: ev.target.checked ? "none" : "#ffffff" })
          }
        />
        背景を透明にする
      </label>
      {e.fill !== "none" && (
        <label>
          背景色
          <input
            type="color"
            value={e.fill ?? "#ffffff"}
            onChange={(ev) => onChange({ fill: ev.target.value })}
          />
        </label>
      )}
      <label>
        <input
          type="checkbox"
          checked={e.strokeWidth === 0}
          onChange={(ev) =>
            onChange({ strokeWidth: ev.target.checked ? 0 : 1 })
          }
        />
        枠線を非表示
      </label>
      <label>
        枠線の色
        <input
          type="color"
          value={e.stroke ?? "#a7c0ab"}
          onChange={(ev) => onChange({ stroke: ev.target.value })}
        />
      </label>
      <p>
        回答はアカウントごとに保存されます。通常の複製は同じ入力項目への参照を保ちます。
      </p>
    </section>
  );
}

function SeparateResponseField({
  element: e,
  onPlace,
}: {
  element: Element;
  onPlace: (elements: Element[]) => void;
}) {
  const ctx = useWorksheets(),
    surveys = useContext(SurveySlideContext);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [label, setLabel] = useState(() =>
    (
      (e.responseField!.source === "worksheet"
        ? e.responseField!.field.label
        : e.responseField!.question) + "（コピー）"
    ).slice(0, 200),
  );
  async function duplicate() {
    if (!ctx.enabled || !ctx.host || busy) return;
    setBusy(true);
    setError("");
    try {
      const b = e.responseField!;
      let binding: ResponseFieldBinding;
      if (b.source === "worksheet") {
        const sheet = ctx.sheets.find((s) => s.id === b.worksheetId);
        if (!sheet) throw Error("元のワークシートを確認してください。");
        const field = {
          ...(sheet.fields.find((f) => f.id === b.field.id) ?? b.field),
          id: crypto.randomUUID(),
          label,
        };
        const data = await api<{ worksheets: WorksheetView[] }>(
          `/api/decks/${ctx.deckId}/worksheets/${sheet.id}/field`,
          { method: "POST", body: JSON.stringify({ field }) },
        );
        ctx.update(data.worksheets);
        binding = { ...b, field };
      } else {
        const data = await api<{ surveys: SurveyView[] }>(
          `/api/decks/${ctx.deckId}/surveys`,
          {
            method: "POST",
            body: JSON.stringify({
              question: label,
              kind: b.kind,
              options: b.options,
            }),
          },
        );
        const created = data.surveys.find(
          (s) => !surveys.surveys.some((old) => old.id === s.id),
        )!;
        const opened = await api<{ surveys: SurveyView[] }>(
          `/api/decks/${ctx.deckId}/surveys/${created.id}/status`,
          { method: "POST", body: JSON.stringify({ status: "open" }) },
        );
        surveys.onUpdated(opened.surveys, ctx.deckId, ctx.userId);
        binding = { ...b, surveyId: created.id, question: label };
      }
      onPlace([
        {
          ...e,
          id: crypto.randomUUID(),
          groupId: undefined,
          x: Math.max(0, Math.min(960 - e.w, e.x + 24)),
          y: Math.max(0, Math.min(540 - e.h, e.y + 24)),
          responseField: binding,
          text: label,
        },
      ]);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return ctx.host ? (
    <>
      <label>
        複製する項目名
        <input
          value={label}
          maxLength={200}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <button
        className="button outline"
        disabled={busy || !ctx.enabled}
        onClick={() => void duplicate()}
      >
        別の回答項目として複製
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  ) : null;
}
