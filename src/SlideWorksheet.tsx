import { FormDraftInput } from "./formEditing";
import { WorksheetRadar } from "./WorksheetRadar";
import { WorksheetDrawing } from "./WorksheetDrawing";
import { WorksheetModalLayout } from "./WorksheetModalLayout";
import type { FormDraft } from "./formEditing";
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
import { worksheetReasonKey } from "./worksheets";
import { WorksheetSummary } from "./WorksheetSummary";
import {
  worksheetFieldGroups,
  worksheetScoreFieldsForLayout,
} from "./worksheetSections";
export function WorksheetInputs({
  sheet,
  values,
  onChange,
  disabled = false,
  preview = false,
  onFieldChange,
  onEdit,
  editLayout,
  ignoreFieldLayout = false,
  hideScore = false,
  scoreFields,
  drawingAspect,
}: {
  sheet: WorksheetDefinition;
  values: WorksheetValues;
  onChange: (v: WorksheetValues) => void;
  disabled?: boolean;
  preview?: boolean;
  onEdit?: (definition: WorksheetDefinition) => void;
  editLayout?: WorksheetDefinition;
  ignoreFieldLayout?: boolean;
  hideScore?: boolean;
  scoreFields?: WorksheetField[];
  drawingAspect?: number;
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
  const editField = (id: string, patch: Partial<WorksheetField>) =>
    onEdit?.({
      ...sheet,
      fields: sheet.fields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    });
  const groups = worksheetFieldGroups(sheet.fields, editLayout?.fields);
  return (
    <>
      <div className="worksheet-fields">
        {groups.map((group) => {
          const checks =
            scoreFields ?? group.fields.filter((f) => f.kind === "checkbox");
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
              {(group.section || (onEdit && group.originalSection)) && (
                <h4>
                  {onEdit ? (
                    <FormDraftInput
                      label="セクション名を編集"
                      value={group.section}
                      maxLength={200}
                      onChange={(section) => {
                        const ids = new Set(
                          group.fields.map((field) => field.id),
                        );
                        onEdit({
                          ...sheet,
                          ...(group.sectionId && sheet.sections
                            ? {
                                sections: sheet.sections.map((s) =>
                                  s.id === group.sectionId
                                    ? { ...s, title: section }
                                    : s,
                                ),
                              }
                            : {}),
                          fields: sheet.fields.map((field) =>
                            ids.has(field.id) ? { ...field, section } : field,
                          ),
                        });
                      }}
                    />
                  ) : (
                    group.section
                  )}
                </h4>
              )}
              <div
                className={`worksheet-group-fields ${wide ? "two-columns" : ""}`}
              >
                {group.fields.map((f) => (
                  <div
                    className={`worksheet-field ${f.wide ? "wide" : ""}`}
                    style={
                      ignoreFieldLayout
                        ? undefined
                        : ({
                            width:
                              f.widthPercent === undefined
                                ? undefined
                                : `${f.widthPercent}%`,
                            fontSize: f.fontSize,
                            "--field-font-size":
                              f.fontSize === undefined
                                ? undefined
                                : `${f.fontSize}px`,
                            "--field-input-height":
                              f.inputHeight === undefined
                                ? undefined
                                : `${f.inputHeight}px`,
                          } as React.CSSProperties)
                    }
                    key={f.id}
                  >
                    {onEdit && f.kind === "checkbox" ? (
                      <div className="worksheet-check">
                        <span aria-hidden="true">□</span>
                        <FormDraftInput
                          label="チェック項目を編集"
                          value={f.label}
                          maxLength={200}
                          onChange={(label) => editField(f.id, { label })}
                        />
                      </div>
                    ) : f.kind === "checkbox" ? (
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
                        {onEdit ? (
                          <FormDraftInput
                            label="入力項目名を編集"
                            value={f.label}
                            maxLength={200}
                            onChange={(label) => editField(f.id, { label })}
                          />
                        ) : (
                          <label
                            className={
                              f.hideLabel
                                ? "sr-only"
                                : "worksheet-input-label"
                            }
                            htmlFor={`${prefix}-${f.id}`}
                          >
                            {f.label}
                          </label>
                        )}
                        {f.kind === "radar" ? (
                          <WorksheetRadar
                            field={f}
                            value={
                              Array.isArray(values[f.id])
                                ? (values[f.id] as (number | null)[])
                                : []
                            }
                            disabled={disabled || !!onEdit}
                            onChange={(value) => change(f.id, value)}
                          />
                        ) : f.kind === "drawing" ? (
                          <WorksheetDrawing
                            label={f.label}
                            value={
                              typeof values[f.id] === "string"
                                ? (values[f.id] as string)
                                : ""
                            }
                            disabled={disabled || !!onEdit}
                            preview={preview}
                            aspect={drawingAspect}
                            placeholder={f.placeholder || undefined}
                            onChange={(value) => change(f.id, value)}
                          />
                        ) : onEdit && f.kind === "text" ? (
                          <FormDraftInput
                            label="入力欄の案内文を編集"
                            value={f.placeholder}
                            maxLength={200}
                            placeholder="入力欄の案内文"
                            onChange={(placeholder) =>
                              editField(f.id, { placeholder })
                            }
                          />
                        ) : onEdit ? (
                          <div className="form-draft-options">
                            {f.options.map((option, i) => (
                              <div key={i}>
                                <span aria-hidden="true">
                                  {f.kind === "single" ? "○" : "□"}
                                </span>
                                <FormDraftInput
                                  label={`選択肢${i + 1}を編集`}
                                  value={option}
                                  maxLength={100}
                                  onChange={(text) =>
                                    editField(f.id, {
                                      options: f.options.map((previous, n) =>
                                        n === i ? text : previous,
                                      ),
                                    })
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        ) : f.kind === "text" ? (
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
                          <>
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
                          {f.kind === "single" &&
                            !disabled &&
                            !preview &&
                            !onEdit &&
                            Array.isArray(values[f.id]) &&
                            (values[f.id] as number[]).length > 0 && (
                              <button
                                type="button"
                                className="answer-clear-choice"
                                onClick={() => change(f.id, [], true)}
                              >
                                選択を取り消す
                              </button>
                            )}
                          </>
                        )}
                        {f.reason && (
                          <div className="worksheet-reason">
                            <label htmlFor={`${prefix}-${f.id}-reason`}>
                              理由・考え
                            </label>
                            <textarea
                              id={`${prefix}-${f.id}-reason`}
                              maxLength={2000}
                              placeholder="選んだ理由や考えを入力"
                              value={String(
                                values[worksheetReasonKey(f.id)] ?? "",
                              )}
                              disabled={disabled || !!onEdit}
                              onChange={(e) =>
                                change(worksheetReasonKey(f.id), e.target.value)
                              }
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
              {!hideScore && checks.length > 0 && (
                <p className="worksheet-score">
                  チェックした数：
                  {preview
                    ? "—"
                    : checks.filter((f) => values[f.id] === true).length}{" "}
                  / {checks.length}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
export function WorksheetAnswer({
  sheet,
  edit,
  editLayout,
  onEdit,
  modal = false,
}: {
  sheet: WorksheetView;
  edit?: WorksheetDefinition;
  editLayout?: WorksheetDefinition;
  onEdit?: (definition: WorksheetDefinition) => void;
  modal?: boolean;
}) {
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
      {modal && sheet.modalLayout ? (
        <WorksheetModalLayout
          sheet={sheet}
          renderField={(field) => (
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
              values={values}
              onChange={() => {}}
              onFieldChange={(id, value, immediate) =>
                answers.change(
                  "worksheet",
                  sheet.id,
                  { [id]: value },
                  immediate,
                )
              }
              disabled={!open}
              hideScore={!worksheetScoreFieldsForLayout(sheet, field.id)}
              scoreFields={worksheetScoreFieldsForLayout(sheet, field.id)}
            />
          )}
        />
      ) : (
        <WorksheetInputs
          sheet={edit ?? sheet}
          onEdit={onEdit}
          editLayout={editLayout}
          values={values}
          onChange={() => {}}
          onFieldChange={(id, value, immediate) =>
            answers.change("worksheet", sheet.id, { [id]: value }, immediate)
          }
          disabled={!open}
        />
      )}
      {!edit && !ctx.readOnly && <WorksheetSummary sheet={sheet} />}
      {!ctx.readOnly && !edit && (status.error || modal) && (
        <p
          className={`answer-inline-status ${status.error ? "is-error" : ""}`}
          role={status.error ? "alert" : "status"}
        >
          {status.error ? (
            `未保存：${status.error}`
          ) : (
            <>
              {!status.saving && !status.dirty && sheet.own && (
                <span aria-hidden="true">✓ </span>
              )}
              {status.saving
                ? "保存中…"
                : status.dirty
                  ? "入力を自動保存します…"
                  : sheet.own
                    ? "入力は保存済みです。"
                    : "入力すると自動保存します。"}
              {sheet.status === "open"
                ? " 受付が終わるまでは直せます。"
                : sheet.status === "draft"
                  ? " 先生が受付を始めると入力できます。"
                  : " 受付は終了しました。"}
            </>
          )}
        </p>
      )}
    </form>
  );
}
export function SlideWorksheet({
  element,
  interactive = false,
  onMoveStart,
  draft,
  onDraftChange,
}: {
  element: Element;
  interactive?: boolean;
  onMoveStart?: (event: PointerEvent) => void;
  draft?: FormDraft;
  onDraftChange?: (draft: FormDraft) => void;
}) {
  const ctx = useWorksheets();
  const binding = element.worksheet!;
  const live =
    interactive && ctx.enabled && binding.deckId === ctx.deckId
      ? ctx.sheets.find((s) => s.id === binding.worksheetId)
      : undefined;
  const edit =
    draft?.kind === "worksheet" && draft.elementId === element.id
      ? draft
      : undefined;
  const sheet = edit?.value ?? live ?? binding;
  return (
    <section
      className={`slide-worksheet ${interactive ? "is-interactive" : "is-preview"} ${onMoveStart ? "is-movable" : ""}`}
      data-slide-survey={interactive || undefined}
      aria-label={`ワークシート：${sheet.title}`}
      style={
        {
          "--form-font-size": `${element.formFontSize ?? sheet.fontSize ?? 18}px`,
        } as React.CSSProperties
      }
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
        <h3>
          {edit ? (
            <FormDraftInput
              label="ワークシートのタイトルを編集"
              value={edit.value.title}
              maxLength={200}
              onChange={(title) =>
                onDraftChange?.({ ...edit, value: { ...edit.value, title } })
              }
            />
          ) : (
            sheet.title
          )}
        </h3>
        {edit ? (
          <p>
            <FormDraftInput
              label="ワークシートの説明を編集"
              value={edit.value.description}
              maxLength={1000}
              placeholder="説明を入力"
              onChange={(description) =>
                onDraftChange?.({
                  ...edit,
                  value: { ...edit.value, description },
                })
              }
            />
          </p>
        ) : (
          sheet.description && <p>{sheet.description}</p>
        )}
      </header>
      {live ? (
        <WorksheetAnswer
          key={`${ctx.deckId}:${ctx.userId}:${live.id}`}
          sheet={live}
          edit={edit?.value}
          editLayout={edit?.expected}
          onEdit={
            edit ? (value) => onDraftChange?.({ ...edit, value }) : undefined
          }
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
              ? "この開き方では入力できません。クラウドの共有作品から開くと、受付中に入力できます。"
              : "プレビュー · 個人の入力内容は含みません。"}
          </p>
        </>
      )}
    </section>
  );
}
