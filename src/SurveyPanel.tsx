import { useEffect, useRef, useState } from "react";
import { X, ClipboardList } from "lucide-react";
import { api } from "./cloud";
import type { SurveyKind, SurveyView } from "./surveys";

type Props = {
  deckId?: string;
  userId?: string;
  host: boolean;
  onInsert: (survey: SurveyView) => void;
  blocked?: boolean;
};
export function SurveyPanel({
  deckId,
  userId,
  host,
  onInsert,
  blocked,
}: Props) {
  const [open, setOpen] = useState(false);
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
  const dialogRef = useRef<HTMLElement>(null);
  const launchRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);
  const scope = `${deckId}:${userId}:${host}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const selected = surveys.find((s) => s.id === selectedId);
  const refreshVersion = useRef(0);
  useEffect(() => {
    setOpen(false);
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
          timer = setTimeout(() => void refresh(), open ? 3000 : 12000);
      }
    }
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [deckId, scope, open, blocked]);
  function select(survey: SurveyView) {
    setSelectedId(survey.id);
    setCreating(false);
    setDeleteId("");
    setChoices(survey.own?.choices ?? []);
    setText(survey.own?.text ?? "");
    setMessage("");
    setError("");
  }
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
  const active = surveys.filter((s) => s.status === "open");
  return (
    <>
      <button
        ref={launchRef}
        className="button outline survey-launch"
        disabled={blocked}
        onClick={() => setOpen(true)}
        aria-label={`アンケート${active.length ? `（受付中${active.length}件）` : ""}`}
      >
        <ClipboardList size={17} />
        <span>アンケート{active.length ? ` (${active.length})` : ""}</span>
      </button>
      {open && (
        <div
          className="survey-overlay"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
              launchRef.current?.focus();
            }
            if (e.key === "Tab") {
              const items = dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
              );
              if (items?.length) {
                const first = items[0],
                  last = items[items.length - 1];
                if (
                  e.shiftKey &&
                  (document.activeElement === first ||
                    document.activeElement === dialogRef.current)
                ) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }
          }}
        >
          <section
            className="survey-panel"
            role="dialog"
            aria-modal="true"
            aria-label="アンケート"
            tabIndex={-1}
            ref={dialogRef}
          >
            <header>
              <div>
                <h2>アンケート</h2>
                <p>
                  {host
                    ? "回答と集計はホストだけが確認できます。"
                    : "受付中の質問に回答できます。集計はホストが確認します。"}
                </p>
              </div>
              <button
                className="button outline"
                autoFocus
                aria-label="アンケートを閉じる"
                onClick={() => {
                  setOpen(false);
                  launchRef.current?.focus();
                }}
              >
                <X size={18} />
              </button>
            </header>
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
                            onChange={(e) =>
                              setKind(e.target.value as SurveyKind)
                            }
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
                                      o.map((v, j) =>
                                        j === i ? e.target.value : v,
                                      ),
                                    )
                                  }
                                />
                                <button
                                  type="button"
                                  className="button outline"
                                  aria-label={`選択肢${i + 1}を削除`}
                                  disabled={options.length <= 2}
                                  onClick={() =>
                                    setOptions((o) =>
                                      o.filter((_, j) => j !== i),
                                    )
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
                                    selected.status === "open"
                                      ? "closed"
                                      : "open",
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
                        {deleteId === selected.id && (
                          <div className="survey-delete">
                            <p>
                              このアンケートと全員の回答を削除します。元に戻せません。挿入済みの結果スライドは残ります。
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
                            <fieldset
                              disabled={busy || selected.status !== "open"}
                            >
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
                                  {selected.own
                                    ? "回答を変更して保存"
                                    : "回答を送信"}
                                </button>
                              )}
                            </fieldset>
                            {selected.status === "closed" && (
                              <p>
                                受付は終了しています。回答は変更できません。
                              </p>
                            )}
                          </form>
                        )}
                        {host && selected.results && (
                          <section
                            className="survey-results"
                            aria-label="集計結果"
                          >
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
                            <p>
                              挿入すると、集計結果や記述回答がスライドとして参加者にも公開されます。現在のページの右に追加し、記述回答は複数ページに分けます。挿入後の結果は自動更新されません。
                            </p>
                            <button
                              className="button primary"
                              disabled={busy || !selected.results.count}
                              onClick={() => {
                                try {
                                  onInsert(selected);
                                  setOpen(false);
                                  launchRef.current?.focus();
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
                  質問と回答はクラウドに保存されます。JSONや完全バックアップには含まれません。残したい集計結果はスライドへ挿入して保存してください。
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
          </section>
        </div>
      )}
    </>
  );
}
