import { useId, useState } from "react";
import type { PointerEvent } from "react";
import type { Element } from "./model";
import type {
  WorksheetDefinition,
  WorksheetField,
  WorksheetValues,
  WorksheetView,
} from "./worksheets";
import { useWorksheets } from "./WorksheetContext";
import { api } from "./cloud";
export function WorksheetInputs({
  sheet,
  values,
  onChange,
  disabled = false,
  preview = false,
}: {
  sheet: WorksheetDefinition;
  values: WorksheetValues;
  onChange: (v: WorksheetValues) => void;
  disabled?: boolean;
  preview?: boolean;
}) {
  const prefix = useId();
  const checks = sheet.fields.filter((f) => f.kind === "checkbox");
  const groups: { section: string; fields: WorksheetField[] }[] = [];
  for (const f of sheet.fields) {
    const last = groups[groups.length - 1];
    if (f.section && last?.section === f.section) last.fields.push(f);
    else groups.push({ section: f.section, fields: [f] });
  }
  return (
    <>
      <div className="worksheet-fields">
        {groups.map((group) => {
          const wide =
            group.fields.some((f) => f.wide) ||
            (!!group.section &&
              group.fields.length > 1 &&
              group.fields.every((f) => f.kind === "checkbox"));
          return (
            <section
              className={`worksheet-group ${wide ? "wide" : ""}`}
              key={group.fields[0].id}
            >
              {group.section && <h4>{group.section}</h4>}
              <div
                className={`worksheet-group-fields ${wide ? "two-columns" : ""}`}
              >
                {group.fields.map((f) => (
                  <div
                    className={`worksheet-field ${f.wide ? "wide" : ""}`}
                    key={f.id}
                  >
                    {f.kind === "checkbox" ? (
                      <label className="worksheet-check">
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={values[f.id] === true}
                          onChange={(e) =>
                            onChange({ ...values, [f.id]: e.target.checked })
                          }
                        />
                        <span>{f.label}</span>
                      </label>
                    ) : (
                      <>
                        <label htmlFor={`${prefix}-${f.id}`}>{f.label}</label>
                        {f.kind === "text" ? (
                          <textarea
                            id={`${prefix}-${f.id}`}
                            rows={f.wide ? 2 : 1}
                            maxLength={2000}
                            placeholder={f.placeholder}
                            value={String(values[f.id] ?? "")}
                            disabled={disabled}
                            onChange={(e) =>
                              onChange({ ...values, [f.id]: e.target.value })
                            }
                          />
                        ) : (
                          <fieldset
                            disabled={disabled}
                            id={`${prefix}-${f.id}`}
                          >
                            <legend className="sr-only">{f.label}</legend>
                            {f.options.map((option, n) => (
                              <label key={n}>
                                <input
                                  type={
                                    f.kind === "single" ? "radio" : "checkbox"
                                  }
                                  name={`${prefix}-${f.id}`}
                                  checked={
                                    Array.isArray(values[f.id]) &&
                                    (values[f.id] as number[]).includes(n)
                                  }
                                  onChange={() => {
                                    const prev =
                                      (values[f.id] as number[]) ?? [];
                                    onChange({
                                      ...values,
                                      [f.id]:
                                        f.kind === "single"
                                          ? [n]
                                          : prev.includes(n)
                                            ? prev.filter((x) => x !== n)
                                            : [...prev, n],
                                    });
                                  }}
                                />
                                {option}
                              </label>
                            ))}
                          </fieldset>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {checks.length > 0 && (
        <p className="worksheet-score">
          チェックした数：
          {preview
            ? "—"
            : checks.filter((f) => values[f.id] === true).length} /{" "}
          {checks.length}
        </p>
      )}
    </>
  );
}
export function WorksheetAnswer({ sheet }: { sheet: WorksheetView }) {
  const ctx = useWorksheets();
  const [draft, setDraft] = useState<WorksheetValues>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const values = draft ?? sheet.own?.values ?? {};
  const open = sheet.status === "open" && ctx.enabled;
  async function save() {
    if (!open || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api<{ worksheets: WorksheetView[] }>(
        `/api/decks/${ctx.deckId}/worksheets/${sheet.id}/answer`,
        { method: "POST", body: JSON.stringify({ values }) },
      );
      ctx.update(data.worksheets);
      setDraft(undefined);
      setMessage("入力を保存しました。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <WorksheetInputs
        sheet={sheet}
        values={values}
        onChange={setDraft}
        disabled={!open || busy}
      />
      <div className="worksheet-save">
        {open && (
          <button type="submit" disabled={busy}>
            {busy ? "保存中…" : sheet.own ? "入力を変更して保存" : "入力を保存"}
          </button>
        )}
        <span>
          {draft
            ? "未保存の入力があります。保存ボタンを押してください。"
            : sheet.own
              ? "保存済み"
              : ""}{" "}
          {sheet.status !== "open" && "受付は終了しています。"}
        </span>
      </div>
      <p className="worksheet-privacy">
        名前・メールアドレスと入力内容はホストだけが確認できます。途中の内容や未チェックの状態も保存できます。
      </p>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export function SlideWorksheet({
  element,
  interactive = false,
  onMoveStart,
}: {
  element: Element;
  interactive?: boolean;
  onMoveStart?: (event: PointerEvent) => void;
}) {
  const ctx = useWorksheets();
  const binding = element.worksheet!;
  const live =
    interactive && ctx.enabled && binding.deckId === ctx.deckId
      ? ctx.sheets.find((s) => s.id === binding.worksheetId)
      : undefined;
  const sheet = live ?? binding;
  return (
    <section
      className={`slide-worksheet ${interactive ? "is-interactive" : "is-preview"}`}
      data-slide-survey={interactive || undefined}
      aria-label={`ワークシート：${sheet.title}`}
      onPointerDown={interactive ? (e) => e.stopPropagation() : undefined}
      onClick={interactive ? (e) => e.stopPropagation() : undefined}
      onDoubleClick={interactive ? (e) => e.stopPropagation() : undefined}
      onKeyDown={interactive ? (e) => e.stopPropagation() : undefined}
      onTouchStart={interactive ? (e) => e.stopPropagation() : undefined}
      onTouchEnd={interactive ? (e) => e.stopPropagation() : undefined}
    >
      <header>
        {interactive && onMoveStart && (
          <button
            type="button"
            className="worksheet-move"
            aria-label="ワークシートを移動"
            onPointerDown={onMoveStart}
          >
            移動
          </button>
        )}
        <h3>{sheet.title}</h3>
        {sheet.description && <p>{sheet.description}</p>}
      </header>
      {live ? (
        <WorksheetAnswer
          key={`${ctx.deckId}:${ctx.userId}:${live.id}`}
          sheet={live}
        />
      ) : (
        <>
          <WorksheetInputs
            sheet={sheet}
            values={{}}
            onChange={() => {}}
            disabled
            preview
          />
          <p>
            {interactive
              ? "元の共有作品で受付を開始すると入力できます。接続・公開状態を確認してください。"
              : "プレビュー · 個人の入力内容は含みません。"}
          </p>
        </>
      )}
    </section>
  );
}
