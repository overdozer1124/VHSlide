import { canDragForm } from "./formDrag";
import { useId } from "react";
import type { PointerEvent } from "react";
import type { Element } from "./model";
import type {
  WorksheetDefinition,
  WorksheetField,
  WorksheetValues,
  WorksheetView,
} from "./worksheets";
import { useWorksheets } from "./WorksheetContext";
import { useAnswers } from "./AnswerStore";
export function WorksheetInputs({
  sheet,
  values,
  onChange,
  disabled = false,
  preview = false,
  onFieldChange,
}: {
  sheet: WorksheetDefinition;
  values: WorksheetValues;
  onChange: (v: WorksheetValues) => void;
  disabled?: boolean;
  preview?: boolean;
  onFieldChange?: (
    id: string,
    value: WorksheetValues[string],
    immediate: boolean,
  ) => void;
}) {
  const prefix = useId();
  const change = (
    id: string,
    value: WorksheetValues[string],
    immediate = false,
  ) =>
    onFieldChange
      ? onFieldChange(id, value, immediate)
      : onChange({ ...values, [id]: value });
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
                          onChange={(e) => change(f.id, e.target.checked, true)}
                        />
                        <span>{f.label}</span>
                      </label>
                    ) : (
                      <>
                        <label
                          className="worksheet-input-label"
                          htmlFor={`${prefix}-${f.id}`}
                        >
                          {f.label}
                        </label>
                        {f.kind === "text" ? (
                          <textarea
                            id={`${prefix}-${f.id}`}
                            rows={f.wide ? 2 : 1}
                            maxLength={2000}
                            placeholder={f.placeholder}
                            value={String(values[f.id] ?? "")}
                            disabled={disabled}
                            onChange={(e) => change(f.id, e.target.value)}
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
                                    change(
                                      f.id,
                                      f.kind === "single"
                                        ? [n]
                                        : prev.includes(n)
                                          ? prev.filter((x) => x !== n)
                                          : [...prev, n],
                                      true,
                                    );
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
  const answers = useAnswers();
  const values = {
    ...sheet.own?.values,
    ...(!ctx.readOnly ? answers.draft("worksheet", sheet.id) : {}),
  } as WorksheetValues;
  const open = sheet.status === "open" && ctx.enabled && !ctx.readOnly;
  const status = answers.status("worksheet", sheet.id);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        answers.flush("worksheet", sheet.id);
      }}
      onBlur={() => {
        if (open) answers.flush("worksheet", sheet.id);
      }}
      onCompositionStart={() => answers.compose("worksheet", sheet.id, true)}
      onCompositionEnd={() => answers.compose("worksheet", sheet.id, false)}
    >
      <WorksheetInputs
        sheet={sheet}
        values={values}
        onChange={() => {}}
        onFieldChange={(id, value, immediate) =>
          answers.change("worksheet", sheet.id, { [id]: value }, immediate)
        }
        disabled={!open}
      />
      {!ctx.readOnly && (
        <>
          <p className="answer-inline-status" role="status">
            {status.error
              ? `未保存：${status.error}`
              : status.saving
                ? "保存中…"
                : status.dirty
                  ? "入力を自動保存します…"
                  : sheet.own
                    ? "入力は保存済みです。"
                    : "入力すると自動保存します。"}
            {sheet.status !== "open" && " 受付は終了しています。"}
          </p>
          <p className="worksheet-privacy">
            名前・メールアドレスと入力内容はホストが確認できます。入力は自動保存されます。共有された回答は「回答スライド」で参照できます。
          </p>
        </>
      )}
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
      className={`slide-worksheet ${interactive ? "is-interactive" : "is-preview"} ${onMoveStart ? "is-movable" : ""}`}
      data-slide-survey={interactive || undefined}
      aria-label={`ワークシート：${sheet.title}`}
      onPointerDown={
        interactive
          ? (e) => {
              if (onMoveStart && canDragForm(e)) onMoveStart(e);
              else e.stopPropagation();
            }
          : undefined
      }
      onClick={interactive ? (e) => e.stopPropagation() : undefined}
      onDoubleClick={interactive ? (e) => e.stopPropagation() : undefined}
      onKeyDown={interactive ? (e) => e.stopPropagation() : undefined}
      onTouchStart={interactive ? (e) => e.stopPropagation() : undefined}
      onTouchEnd={interactive ? (e) => e.stopPropagation() : undefined}
    >
      <header>
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
