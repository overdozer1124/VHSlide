import { useActivityPanel } from "./ActivitiesPanel";
import {
  surveyAnswerText,
  surveyResponseTime,
  surveyResponsesCsv,
} from "./surveyCsv";
import type { SurveySlideData } from "./SurveySlideContext";
import { useEffect, useRef, useState } from "react";
import { api } from "./cloud";
import type { SurveyKind, SurveyView } from "./surveys";

type Props = {
  deckId?: string;
  userId?: string;
  host: boolean;
  onInsert: (survey: SurveyView) => void;
  onEmbed?: (survey: SurveyView) => void;
  onData?: (data: SurveySlideData) => void;
  refreshToken?: number;
  pollActive?: boolean;
  blocked?: boolean;
};
export function SurveyPanel({
  deckId,
  userId,
  host,
  onInsert,
  onEmbed,
  onData,
  refreshToken,
  pollActive,
  blocked,
}: Props) {
  const activity = useActivityPanel();
  const open = activity.open && activity.active === "survey";
  const close = activity.close;
  const [surveys, setSurveys] = useState<SurveyView[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState("");
  const [kind, setKind] = useState<SurveyKind>("single");
  const [options, setOptions] = useState(["", ""]);
  const [selectedId, setSelectedId] = useState("");
  const [choices, setChoices] = useState<number[]>([]);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const scope = `${deckId}:${userId}:${host}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const selected = surveys.find((s) => s.id === selectedId);
  const refreshVersion = useRef(0);
  useEffect(() => {
    setSurveys([]);
    setSelectedId("");
    setError("");
    setCreating(false);
    setBusy(false);
    setDeleteId("");
    setMessage("");
  }, [scope]);
  useEffect(() => {
    if (!deckId || blocked) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const version = refreshVersion.current;
      try {
        const data = await api<{ surveys: SurveyView[] }>(
          `/api/decks/${deckId}/surveys`,
        );
        if (
          !stopped &&
          currentScope.current === scope &&
          version === refreshVersion.current
        ) {
          setSurveys(data.surveys);
          setError("");
        }
      } catch (e) {
        if (!stopped && currentScope.current === scope) {
          setSurveys([]);
          setError((e as Error).message);
        }
      } finally {
        if (!stopped)
          timer = setTimeout(
            () => void refresh(),
            open || pollActive ? 3000 : 12000,
          );
      }
    }
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [deckId, scope, open, blocked, refreshToken, pollActive]);
  function select(survey: SurveyView) {
    setSelectedId(survey.id);
    setCreating(false);
    setDeleteId("");
    setChoices(survey.own?.choices ?? []);
    setText(survey.own?.text ?? "");
    setMessage("");
    setError("");
  }
  useEffect(() => {
    if (
      !creating &&
      surveys.length &&
      !surveys.some((s) => s.id === selectedId)
    )
      select(surveys[0]);
  }, [creating, surveys, selectedId]);
  async function command(path: string, value: unknown, method = "POST") {
    if (!deckId || busy) return;
    const requestScope = scope;
    setBusy(true);
    setError("");
    setMessage("");
    ++refreshVersion.current;
    try {
      const data = await api<{ surveys: SurveyView[] }>(
        `/api/decks/${deckId}/surveys${path}`,
        {
          method,
          ...(method === "POST" ? { body: JSON.stringify(value) } : {}),
        },
      );
      if (currentScope.current !== requestScope) return;
      ++refreshVersion.current;
      setSurveys(data.surveys);
      setDeleteId("");
      if (path === "") {
        setCreating(false);
        setQuestion("");
        setOptions(["", ""]);
        if (data.surveys[0]) select(data.surveys[0]);
        setMessage(
          "下書きを作成しました。「受付を開始」で参加者に公開します。",
        );
      } else if (path.endsWith("/answer"))
        setMessage("回答を保存しました。受付中は変更できます。");
      else if (method === "DELETE") {
        setSelectedId("");
        setMessage("アンケートと回答を削除しました。");
      } else setMessage("受付状態を更新しました。");
    } catch (e) {
      if (currentScope.current === requestScope) setError((e as Error).message);
    } finally {
      if (currentScope.current === requestScope) setBusy(false);
    }
  }
  async function downloadResponses(surveyId: string) {
    if (!deckId || !host || busy) return;
    const requestScope = scope;
    setBusy(true);
    setError("");
    setMessage("");
    ++refreshVersion.current;
    try {
      const data = await api<{ surveys: SurveyView[] }>(
        `/api/decks/${deckId}/surveys`,
      );
      if (!alive.current || currentScope.current !== requestScope) return;
      const survey = data.surveys.find((s) => s.id === surveyId);
      if (!survey) throw new Error("アンケートが見つかりません。");
      ++refreshVersion.current;
      setSurveys(data.surveys);
      const url = URL.createObjectURL(
        new Blob([surveyResponsesCsv(survey)], {
          type: "text/csv;charset=utf-8",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `アンケート_${survey.question.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 80)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("最新の回答結果をCSVで保存しました。");
    } catch (e) {
      if (alive.current && currentScope.current === requestScope)
        setError((e as Error).message);
    } finally {
      if (alive.current && currentScope.current === requestScope)
        setBusy(false);
    }
  }
  useEffect(() => {
    onData?.({ deckId, userId, surveys: blocked ? [] : surveys });
  }, [deckId, userId, surveys, blocked, onData]);
  if (!activity.open) return null;
  return (
    <>
      <p>
        {host
          ? "回答と集計はホストだけが確認できます。"
          : "回答者名・メールアドレスと回答内容はホストが確認します。"}
      </p>
      {!deckId ? (
        <p>
          アンケートはクラウドの作品で使えます。「クラウド」から作品を作成または開いて、参加者を招待してください。
        </p>
      ) : (
        <>
          <div className="survey-layout">
            <aside aria-label="アンケート一覧">
              {host && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => {
                    setCreating(true);
                    setSelectedId("");
                    setQuestion("");
                    setOptions(["", ""]);
                    setMessage("");
                  }}
                >
                  新しいアンケート
                </button>
              )}
              {!surveys.length && (
                <p>
                  {host
                    ? "質問を作成し、回答の受付を開始しましょう。"
                    : "現在、公開されているアンケートはありません。"}
                </p>
              )}
              {surveys.map((s) => (
                <button
                  key={s.id}
                  className={`survey-item ${selectedId === s.id ? "active" : ""}`}
                  disabled={busy}
                  onClick={() => select(s)}
                >
                  <strong>{s.question}</strong>
                  <span>
                    {s.status === "draft"
                      ? "下書き"
                      : s.status === "open"
                        ? "受付中"
                        : "受付終了"}{" "}
                    ·{" "}
                    {s.kind === "text"
                      ? "記述式"
                      : s.kind === "multiple"
                        ? "複数選択"
                        : "単一選択"}
                    {s.own ? " · 回答済み" : ""}
                  </span>
                </button>
              ))}
            </aside>
            <main>
              {creating && host ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void command("", { question, kind, options });
                  }}
                >
                  <h3>新しいアンケート</h3>
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
                  <label>
                    回答形式
                    <select
                      value={kind}
                      aria-label="アンケートの回答形式"
                      onChange={(e) => setKind(e.target.value as SurveyKind)}
                      disabled={busy}
                    >
                      <option value="single">選択式（1つ選ぶ）</option>
                      <option value="multiple">選択式（複数選ぶ）</option>
                      <option value="text">記述式</option>
                    </select>
                  </label>
                  {kind !== "text" && (
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
                              setOptions((o) =>
                                o.map((v, j) => (j === i ? e.target.value : v)),
                              )
                            }
                          />
                          <button
                            type="button"
                            className="button outline"
                            aria-label={`選択肢${i + 1}を削除`}
                            disabled={options.length <= 2}
                            onClick={() =>
                              setOptions((o) => o.filter((_, j) => j !== i))
                            }
                          >
                            削除
                          </button>
                        </div>
                      ))}
                      <button
                        className="button outline"
                        type="button"
                        disabled={options.length >= 10}
                        onClick={() => setOptions((o) => [...o, ""])}
                      >
                        選択肢を追加
                      </button>
                    </fieldset>
                  )}
                  <p>
                    1人1回答。受付中は自分の回答を変更できます。作成後の質問と選択肢は変更できません。
                  </p>
                  <button className="button primary" disabled={busy}>
                    下書きを作成
                  </button>
                </form>
              ) : selected ? (
                <>
                  <h3>{selected.question}</h3>
                  {host && (
                    <div className="survey-controls">
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() =>
                          void command(`/${selected.id}/status`, {
                            status:
                              selected.status === "open" ? "closed" : "open",
                          })
                        }
                      >
                        {selected.status === "open"
                          ? "受付を終了"
                          : selected.status === "closed"
                            ? "受付を再開"
                            : "受付を開始"}
                      </button>
                      <button
                        className="button outline"
                        disabled={busy}
                        onClick={() => setDeleteId(selected.id)}
                      >
                        アンケートを削除
                      </button>
                    </div>
                  )}
                  {host && onEmbed && (
                    <div className="survey-embed-action">
                      <button
                        className="button primary"
                        disabled={busy || selected.status === "draft"}
                        onClick={() => {
                          try {
                            onEmbed(selected);
                            close();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        このアンケートをスライドに配置
                      </button>
                      <p>
                        受付を開始したアンケートを、現在のページに配置します。質問と選択肢がスライドに表示され、参加者はその場で回答できます。
                      </p>
                    </div>
                  )}
                  {deleteId === selected.id && (
                    <div className="survey-delete">
                      <p>
                        このアンケートと全員の回答を削除します。元に戻せません。配置済みの質問や、挿入済みの結果スライドは残ります。
                      </p>
                      <button
                        className="button danger"
                        disabled={busy}
                        onClick={() =>
                          void command(`/${selected.id}`, {}, "DELETE")
                        }
                      >
                        回答ごと削除する
                      </button>
                      <button
                        className="button outline"
                        onClick={() => setDeleteId("")}
                      >
                        キャンセル
                      </button>
                    </div>
                  )}
                  {selected.status !== "draft" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void command(`/${selected.id}/answer`, {
                          choices,
                          text,
                        });
                      }}
                    >
                      <fieldset disabled={busy || selected.status !== "open"}>
                        <legend>
                          {host ? "自分も回答する" : "あなたの回答"}
                        </legend>
                        {selected.kind === "text" ? (
                          <textarea
                            aria-label="アンケートの回答"
                            value={
                              selected.status === "open"
                                ? text
                                : (selected.own?.text ?? "")
                            }
                            onChange={(e) => setText(e.target.value)}
                            maxLength={2000}
                            required
                            rows={4}
                          />
                        ) : (
                          selected.options.map((option, i) => (
                            <label className="survey-choice" key={i}>
                              <input
                                type={
                                  selected.kind === "single"
                                    ? "radio"
                                    : "checkbox"
                                }
                                name="survey-choice"
                                checked={(selected.status === "open"
                                  ? choices
                                  : (selected.own?.choices ?? [])
                                ).includes(i)}
                                onChange={() => {
                                  setChoices(
                                    selected.kind === "single"
                                      ? [i]
                                      : choices.includes(i)
                                        ? choices.filter((v) => v !== i)
                                        : [...choices, i],
                                  );
                                  setText("");
                                }}
                              />
                              <span>{option}</span>
                            </label>
                          ))
                        )}
                        {selected.status === "open" && (
                          <button
                            className="button primary"
                            disabled={
                              selected.kind === "text"
                                ? !text.trim()
                                : !choices.length
                            }
                          >
                            {selected.own ? "回答を変更して保存" : "回答を送信"}
                          </button>
                        )}
                      </fieldset>
                      {selected.status === "closed" && (
                        <p>受付は終了しています。回答は変更できません。</p>
                      )}
                    </form>
                  )}
                  {host && selected.results && (
                    <section className="survey-results" aria-label="集計結果">
                      <h4>集計結果 · {selected.results.count}人が回答</h4>
                      {selected.kind === "text" ? (
                        <ol>
                          {selected.results.texts.map((answer, i) => (
                            <li key={i}>{answer}</li>
                          ))}
                        </ol>
                      ) : (
                        <>
                          <p>
                            {selected.kind === "multiple"
                              ? "複数選択のため、割合の合計が100%を超える場合があります。"
                              : "回答者に対する割合です。"}
                          </p>
                          {selected.options.map((option, i) => (
                            <div className="survey-result" key={i}>
                              <span>{option}</span>
                              <meter
                                min={0}
                                max={Math.max(1, selected.results!.count)}
                                value={selected.results!.counts[i]}
                              />
                              <strong>
                                {selected.results!.counts[i]}件 (
                                {selected.results!.count
                                  ? Math.round(
                                      (selected.results!.counts[i] /
                                        selected.results!.count) *
                                        100,
                                    )
                                  : 0}
                                %)
                              </strong>
                            </div>
                          ))}
                        </>
                      )}
                      <section
                        className="survey-responses"
                        aria-label="回答者ごとの回答"
                      >
                        <div className="survey-response-heading">
                          <h4>回答者ごとの回答</h4>
                          <button
                            className="button outline"
                            disabled={busy || !selected.results.count}
                            onClick={() => void downloadResponses(selected.id)}
                          >
                            回答結果をCSV保存
                          </button>
                        </div>
                        <p>
                          回答者名・メールアドレス・回答はホストだけに表示します。CSVには各参加者の最新の回答と回答日時を保存します。
                        </p>
                        {!selected.results.count ? (
                          <p>まだ回答がありません。</p>
                        ) : (
                          <div className="survey-response-table-wrap">
                            <table className="survey-response-table">
                              <thead>
                                <tr>
                                  <th scope="col">回答者名</th>
                                  <th scope="col">メールアドレス</th>
                                  <th scope="col">回答</th>
                                  <th scope="col">最終回答（日本時間）</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(selected.results.responses ?? []).map(
                                  (answer) => (
                                    <tr key={answer.respondentId}>
                                      <th scope="row">{answer.name}</th>
                                      <td>
                                        {answer.email || answer.respondentId}
                                      </td>
                                      <td className="survey-response-answer">
                                        {surveyAnswerText(selected, answer)}
                                      </td>
                                      <td>
                                        <time
                                          dateTime={new Date(
                                            answer.updated,
                                          ).toISOString()}
                                        >
                                          {surveyResponseTime(answer.updated)}
                                        </time>
                                      </td>
                                    </tr>
                                  ),
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>
                      <p>
                        スライドに挿入する集計には、回答者名・メールアドレスを含めません。
                      </p>
                      <p>
                        挿入すると、集計結果や記述回答がスライドとして参加者にも公開されます。現在のページの右に追加し、記述回答は複数ページに分けます。挿入後の結果は自動更新されません。
                      </p>
                      <button
                        className="button primary"
                        disabled={busy || !selected.results.count}
                        onClick={() => {
                          try {
                            onInsert(selected);
                            close();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        集計結果をスライドに挿入
                      </button>
                    </section>
                  )}
                </>
              ) : (
                <p>一覧からアンケートを選んでください。</p>
              )}
            </main>
          </div>
          <p className="survey-storage-note">
            質問と回答はクラウドに保存されます。JSONや完全バックアップには含まれません。回答結果はCSVで保存でき、集計結果はスライドへ挿入して残せます。
          </p>
        </>
      )}
      {error && (
        <p className="survey-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">保存中…</p>}
    </>
  );
}
