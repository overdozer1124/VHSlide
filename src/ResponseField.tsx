import { canDragForm } from "./formDrag";
import { useContext } from "react";
import type { PointerEvent } from "react";
import type { Element } from "./model";
import { useWorksheets } from "./WorksheetContext";
import { SurveySlideContext } from "./SurveySlideContext";
import { useAnswers } from "./AnswerStore";
import { WorksheetInputs } from "./SlideWorksheet";
import { SurveyAnswerForm } from "./SurveyAnswerForm";
import type { WorksheetValues } from "./worksheets";
export function ResponseField({
  element: e,
  interactive = false,
  onMoveStart,
}: {
  element: Element;
  interactive?: boolean;
  onMoveStart?: (event: PointerEvent) => void;
}) {
  const binding = e.responseField!;
  const worksheets = useWorksheets();
  const surveys = useContext(SurveySlideContext);
  const answers = useAnswers();
  const sheet =
    binding.source === "worksheet" &&
    interactive &&
    worksheets.enabled &&
    binding.deckId === worksheets.deckId
      ? worksheets.sheets.find((s) => s.id === binding.worksheetId)
      : undefined;
  const survey =
    binding.source === "survey" &&
    interactive &&
    surveys.enabled &&
    binding.deckId === surveys.deckId
      ? surveys.surveys.find((s) => s.id === binding.surveyId)
      : undefined;
  const field =
    binding.source === "worksheet"
      ? (sheet?.fields.find((f) => f.id === binding.field.id) ?? binding.field)
      : undefined;
  const open = !!sheet && sheet.status === "open" && !worksheets.readOnly;
  const fieldStatus = answers.status("worksheet", sheet?.id ?? "");
  const values = {
    ...sheet?.own?.values,
    ...(!worksheets.readOnly && sheet
      ? answers.draft("worksheet", sheet.id)
      : {}),
  } as WorksheetValues;
  const label = field
    ? binding.showSection && field.section
      ? `${field.section}：${field.label}`
      : field.label
    : binding.source === "survey"
      ? binding.question
      : "";
  // The host can hide a field's heading in the worksheet editor; that choice
  // wins over this placement's own "show label" setting.
  const hideLabel = !binding.showLabel || !!field?.hideLabel;
  return (
    <section
      className={`response-field ${hideLabel ? "hide-label" : ""} ${interactive ? "interactive" : "preview"} ${onMoveStart ? "is-movable" : ""}`}
      data-slide-survey={interactive || undefined}
      data-response-field={binding.source}
      style={{
        background:
          e.fill === "none" ? "transparent" : (e.fill ?? "transparent"),
        borderStyle: "solid",
        borderWidth: e.strokeWidth ?? 1,
        borderColor: e.stroke ?? "transparent",
        color: e.color ?? "#173d38",
        fontSize: e.fontSize ?? 20,
        borderRadius: e.shape === "rect" ? 0 : 12,
        padding: 8,
      }}
      onPointerDown={
        interactive
          ? (ev) => {
              if (onMoveStart && canDragForm(ev)) onMoveStart(ev);
              else ev.stopPropagation();
            }
          : undefined
      }
      onClick={interactive ? (ev) => ev.stopPropagation() : undefined}
      onDoubleClick={interactive ? (ev) => ev.stopPropagation() : undefined}
      onKeyDown={interactive ? (ev) => ev.stopPropagation() : undefined}
      onTouchStart={interactive ? (ev) => ev.stopPropagation() : undefined}
      onTouchEnd={interactive ? (ev) => ev.stopPropagation() : undefined}
      aria-label={`入力欄：${label}`}
    >
      {field ? (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (sheet) answers.flush("worksheet", sheet.id);
          }}
          onBlur={() => {
            if (open) answers.flush("worksheet", sheet!.id);
          }}
          onCompositionStart={() => {
            if (sheet) answers.compose("worksheet", sheet.id, true);
          }}
          onCompositionEnd={() => {
            if (sheet) answers.compose("worksheet", sheet.id, false);
          }}
        >
          <WorksheetInputs
            ignoreFieldLayout
            drawingAspect={e.h > 0 ? e.w / e.h : undefined}
            sheet={{
              title: label,
              description: "",
              fields: [{ ...field, label, section: "", wide: true }],
            }}
            values={values}
            onChange={() => {}}
            onFieldChange={(id, value, immediate) => {
              if (open)
                answers.change(
                  "worksheet",
                  sheet!.id,
                  { [id]: value },
                  immediate,
                );
            }}
            disabled={!open}
            preview={!interactive}
          />
        </form>
      ) : (
        <>
          {binding.showLabel && <h4>{label}</h4>}
          {survey ? (
            <SurveyAnswerForm survey={survey} embedded compact />
          ) : (
            <div className="response-field-placeholder">
              {binding.source === "survey" && binding.kind !== "text"
                ? binding.options.map((o, i) => <p key={i}>□ {o}</p>)
                : "ここに入力"}
            </div>
          )}
        </>
      )}
      {interactive && field && sheet && (
        open ? (
          fieldStatus.error ? (
            <p className="answer-inline-status is-error" role="alert">
              {`未保存：${fieldStatus.error}`}
            </p>
          ) : null
        ) : (
          <small>
            {worksheets.readOnly
              ? "この開き方では入力できません。"
              : sheet.status === "draft"
                ? "先生が受付を始めると入力できます。"
                : "受付は終了しました。"}
          </small>
        )
      )}
      {interactive && !sheet && !survey && (
        <small>
          この開き方では入力できません。クラウドの共有作品から開くと、受付中に入力できます。
        </small>
      )}
    </section>
  );
}
