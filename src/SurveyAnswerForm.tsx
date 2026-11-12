import { useContext, useId } from "react";
import type { SurveyAnswer, SurveyView } from "./surveys";
import { SurveySlideContext } from "./SurveySlideContext";
import { useAnswers } from "./AnswerStore";
export function SurveyAnswerForm({
  survey,
  embedded = false,
  compact = false,
}: {
  survey: SurveyView;
  embedded?: boolean;
  compact?: boolean;
}) {
  const ctx = useContext(SurveySlideContext);
  const answers = useAnswers();
  const id = useId();
  const value = {
    choices: [],
    text: "",
    ...survey.own,
    ...(!ctx.readOnly ? answers.draft("survey", survey.id) : {}),
  } as SurveyAnswer;
  const open = survey.status === "open" && ctx.enabled && !ctx.readOnly;
  const status = answers.status("survey", survey.id);
  function change(next: SurveyAnswer, immediate = false) {
    answers.change("survey", survey.id, next, immediate);
  }
  return (
    <form
      className={compact ? "compact-answer" : ""}
      onSubmit={(e) => {
        e.preventDefault();
        answers.flush("survey", survey.id);
      }}
      onBlur={() => {
        if (open) answers.flush("survey", survey.id);
      }}
      onCompositionStart={() => answers.compose("survey", survey.id, true)}
      onCompositionEnd={() => answers.compose("survey", survey.id, false)}
    >
      <fieldset disabled={!open}>
        <legend className="sr-only">あなたの回答</legend>
        <div className="slide-survey-inputs">
          {survey.kind === "text" ? (
            <textarea
              aria-label={
                embedded ? "スライド内アンケートの回答" : "アンケートの回答"
              }
              rows={compact ? 2 : 4}
              maxLength={2000}
              value={value.text}
              onChange={(e) => change({ choices: [], text: e.target.value })}
            />
          ) : (
            survey.options.map((option, i) => (
              <label className="survey-choice" key={i}>
                <input
                  type={survey.kind === "single" ? "radio" : "checkbox"}
                  name={id}
                  checked={value.choices.includes(i)}
                  onChange={() =>
                    change(
                      {
                        text: "",
                        choices:
                          survey.kind === "single"
                            ? [i]
                            : value.choices.includes(i)
                              ? value.choices.filter((n) => n !== i)
                              : [...value.choices, i],
                      },
                      true,
                    )
                  }
                />
                <span>{option}</span>
              </label>
            ))
          )}
        </div>
      </fieldset>
      {survey.kind === "single" && open && value.choices.length > 0 && (
        <button
          type="button"
          className="answer-clear-choice"
          onClick={() => change({ text: "", choices: [] }, true)}
        >
          選択を取り消す
        </button>
      )}
      {!ctx.readOnly && (status.error || !embedded) && (
        <p
          className={`answer-inline-status ${status.error ? "is-error" : ""}`}
          role={status.error ? "alert" : "status"}
        >
          {status.error ? (
            `未保存：${status.error}`
          ) : (
            <>
              {!status.saving && !status.dirty && survey.own && (
                <span aria-hidden="true">✓ </span>
              )}
              {status.saving
                ? "保存中…"
                : status.dirty
                  ? "入力を自動保存します…"
                  : survey.own
                    ? "回答は保存済みです。"
                    : "入力すると自動保存します。"}
              {survey.status === "open"
                ? " 受付が終わるまでは直せます。"
                : survey.status === "draft"
                  ? " 先生が受付を始めると入力できます。"
                  : " 受付は終了しました。"}
            </>
          )}
        </p>
      )}
    </form>
  );
}
