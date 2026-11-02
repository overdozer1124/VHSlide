import { useContext } from "react";
import type { PointerEvent } from "react";
import type { Element } from "./model";
import { SurveySlideContext } from "./SurveySlideContext";
import { SurveyAnswerForm } from "./SurveyAnswerForm";

export function SlideSurvey(props: {
  element: Element;
  interactive?: boolean;
  onMoveStart?: (event: PointerEvent) => void;
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
}: {
  element: Element;
  interactive?: boolean;
  onMoveStart?: (event: PointerEvent) => void;
}) {
  const context = useContext(SurveySlideContext);
  const binding = element.survey!;
  const survey =
    interactive && context.enabled && binding.deckId === context.deckId
      ? context.surveys.find((s) => s.id === binding.surveyId)
      : undefined;
  const question = survey ?? binding;
  return (
    <section
      className={`slide-survey ${interactive ? "is-interactive" : "is-preview"}`}
      data-slide-survey={interactive || undefined}
      aria-label={`スライド内アンケート：${question.question}`}
      style={{
        background: element.fill === "none" ? "#ffffff" : element.fill,
        borderColor: element.stroke,
      }}
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
            className="survey-move-handle"
            aria-label="アンケートを移動"
            title="ドラッグしてアンケートを移動"
            onPointerDown={onMoveStart}
          >
            移動
          </button>
        )}
        <span>
          アンケート ·{" "}
          {question.kind === "text"
            ? "記述式"
            : question.kind === "multiple"
              ? "複数選択"
              : "1つ選ぶ"}
        </span>
        <h3>{question.question}</h3>
      </header>
      {!interactive || !survey ? (
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
