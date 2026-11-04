import { FormDraftInput } from "./formEditing";
import type { FormDraft } from "./formEditing";
import { canDragForm } from "./formDrag";
import { useContext } from "react";
import type { PointerEvent } from "react";
import type { Element } from "./model";
import { SurveySlideContext } from "./SurveySlideContext";
import { SurveyAnswerForm } from "./SurveyAnswerForm";

export function SlideSurvey(props: {
  element: Element;
  interactive?: boolean;
  onMoveStart?: (event: PointerEvent) => void;
  draft?: FormDraft;
  onDraftChange?: (draft: FormDraft) => void;
}) {
  const context = useContext(SurveySlideContext);
  return (
    <SurveyCard
      key={`${context.deckId}:${context.userId}:${props.element.survey?.surveyId}`}
      {...props}
    />
  );
}
function SurveyCard({
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
  const context = useContext(SurveySlideContext);
  const binding = element.survey!;
  const survey =
    interactive && context.enabled && binding.deckId === context.deckId
      ? context.surveys.find((s) => s.id === binding.surveyId)
      : undefined;
  const edit =
    draft?.kind === "survey" && draft.elementId === element.id
      ? draft
      : undefined;
  const question = edit?.value ?? survey ?? binding;
  return (
    <section
      className={`slide-survey ${interactive ? "is-interactive" : "is-preview"} ${onMoveStart ? "is-movable" : ""}`}
      data-slide-survey={interactive || undefined}
      aria-label={`スライド内アンケート：${question.question}`}
      style={
        {
          background: element.fill === "none" ? "#ffffff" : element.fill,
          borderColor: element.stroke,
          "--form-font-size": `${element.formFontSize ?? 20}px`,
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
        <span>
          アンケート ·{" "}
          {question.kind === "text"
            ? "記述式"
            : question.kind === "multiple"
              ? "複数選択"
              : "1つ選ぶ"}
        </span>
        <h3>
          {edit ? (
            <FormDraftInput
              label="アンケートの質問を編集"
              value={edit.value.question}
              maxLength={200}
              onChange={(question) =>
                onDraftChange?.({ ...edit, value: { ...edit.value, question } })
              }
            />
          ) : (
            question.question
          )}
        </h3>
      </header>
      {edit ? (
        <div className="slide-survey-preview form-draft-options">
          {edit.value.kind === "text" ? (
            <div className="slide-survey-placeholder">ここに回答を入力</div>
          ) : (
            edit.value.options.map((option, index) => (
              <div key={index}>
                <span aria-hidden="true">
                  {edit.value.kind === "single" ? "○" : "□"}
                </span>
                <FormDraftInput
                  label={`選択肢${index + 1}を編集`}
                  value={option}
                  maxLength={60}
                  onChange={(text) =>
                    onDraftChange?.({
                      ...edit,
                      value: {
                        ...edit.value,
                        options: edit.value.options.map((previous, i) =>
                          i === index ? text : previous,
                        ),
                      },
                    })
                  }
                />
              </div>
            ))
          )}
        </div>
      ) : !interactive || !survey ? (
        <>
          <div className="slide-survey-preview">
            {question.kind === "text" ? (
              <div className="slide-survey-placeholder">ここに回答を入力</div>
            ) : (
              question.options.map((option, i) => <div key={i}>○ {option}</div>)
            )}
          </div>
          <p>
            {interactive
              ? binding.deckId !== context.deckId
                ? "回答は元のクラウド作品で受け付けます。"
                : "未公開・削除済み、または接続を確認中です。"
              : "共有作品の編集・発表画面から回答できます。"}
          </p>
        </>
      ) : (
        <SurveyAnswerForm survey={survey} embedded />
      )}
    </section>
  );
}
