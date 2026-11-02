import { useContext, useId, useState } from "react";
import type { PointerEvent } from "react";
import type { Element } from "./model";
import type { SurveyView } from "./surveys";
import { SurveySlideContext } from "./SurveySlideContext";
import { api } from "./cloud";

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
  const [draft, setDraft] = useState<{ choices: number[]; text: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const id = useId();
  const value = (survey?.status === "open" ? draft : undefined) ??
    survey?.own ?? { choices: [], text: "" };
  const question = survey ?? binding;
  const open = survey?.status === "open";
  async function submit() {
    if (!survey || !open || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await api<{ surveys: SurveyView[] }>(
        `/api/decks/${context.deckId}/surveys/${binding.surveyId}/answer`,
        { method: "POST", body: JSON.stringify(value) },
      );
      context.onUpdated(data.surveys, context.deckId, context.userId);
      setDraft(undefined);
      setMessage("回答を保存しました。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy || !open}>
            <legend className="sr-only">あなたの回答</legend>
            <div className="slide-survey-inputs">
              {survey.kind === "text" ? (
                <textarea
                  aria-label="スライド内アンケートの回答"
                  rows={4}
                  maxLength={2000}
                  required
                  value={value.text}
                  onChange={(e) =>
                    setDraft({ choices: [], text: e.target.value })
                  }
                />
              ) : (
                survey.options.map((option, i) => (
                  <label key={i}>
                    <input
                      type={survey.kind === "single" ? "radio" : "checkbox"}
                      name={id}
                      checked={value.choices.includes(i)}
                      onChange={() =>
                        setDraft({
                          text: "",
                          choices:
                            survey.kind === "single"
                              ? [i]
                              : value.choices.includes(i)
                                ? value.choices.filter((v) => v !== i)
                                : [...value.choices, i],
                        })
                      }
                    />
                    <span>{option}</span>
                  </label>
                ))
              )}
            </div>
            {open && (
              <button
                type="submit"
                disabled={
                  busy ||
                  (survey.kind === "text"
                    ? !value.text.trim()
                    : !value.choices.length)
                }
              >
                {busy
                  ? "保存中…"
                  : survey.own
                    ? "回答を変更して保存"
                    : "回答を送信"}
              </button>
            )}
          </fieldset>
          <p>
            {survey.status === "draft"
              ? "下書き · 回答の受付前です。"
              : !open
                ? "受付は終了しています。"
                : survey.own
                  ? "回答済み · 受付中は変更できます。"
                  : "受付中 · 回答はホストだけが確認できます。"}
          </p>
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </section>
  );
}
