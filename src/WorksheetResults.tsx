import { useEffect, useState } from "react";
import type { WorksheetView } from "./worksheets";
import { worksheetValueText } from "./worksheetCsv";
import { surveyResponseTime } from "./surveyCsv";
import { useWorksheets } from "./WorksheetContext";

/** Host-only results. Callers must also enforce host access at the API boundary. */
export function WorksheetResults({
  sheet,
  busy,
  onDownload,
}: {
  sheet: WorksheetView;
  busy: boolean;
  onDownload: (order: string[]) => void;
}) {
  const ctx = useWorksheets();
  const orderKey = `vhslide-worksheet-order:${ctx.deckId}:${ctx.userId}:${sheet.id}`;
  const [customOrder, setCustomOrder] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(orderKey) ?? "[]");
      return Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [];
    } catch {
      return [];
    }
  });
  const [dragged, setDragged] = useState<string>();
  const [view, setView] = useState<"person" | "table">("person");
  const [search, setSearch] = useState("");
  const [personId, setPersonId] = useState("");
  const unordered = sheet.results?.responses ?? [];
  const rank = new Map(customOrder.map((id, index) => [id, index]));
  const responses = [...unordered].sort(
    (a, b) =>
      (rank.get(a.respondentId) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.respondentId) ?? Number.MAX_SAFE_INTEGER),
  );
  function move(id: string, before: string, after = false) {
    const order = responses.map((r) => r.respondentId);
    const from = order.indexOf(id),
      target = order.indexOf(before);
    if (from < 0 || target < 0 || from === target) return;
    order.splice(from, 1);
    order.splice(order.indexOf(before) + (after ? 1 : 0), 0, id);
    setCustomOrder(order);
    try {
      localStorage.setItem(orderKey, JSON.stringify(order));
    } catch {
      /* Keep the order for this session. */
    }
  }
  useEffect(() => {
    if (!responses.some((r) => r.respondentId === personId))
      setPersonId(responses[0]?.respondentId ?? "");
  }, [responses, personId]);
  const query = search.trim().toLocaleLowerCase();
  const filtered = responses.filter((r) =>
    `${r.name} ${r.email}`.toLocaleLowerCase().includes(query),
  );
  const person =
    filtered.find((r) => r.respondentId === personId) ?? filtered[0];
  return (
    <section className="worksheet-results" aria-label="ワークシート入力結果">
      <div className="worksheet-results-heading">
        <div>
          <h3>
            回答結果 <span>{responses.length}人</span>
          </h3>
          <p>
            保存された最新の回答を表示します。途中保存・未入力の項目も含みます。
          </p>
        </div>
        <button
          className="button outline"
          disabled={busy || !responses.length}
          onClick={() => onDownload(responses.map((r) => r.respondentId))}
        >
          入力結果をCSV保存
        </button>
      </div>
      {!responses.length ? (
        <div className="worksheet-empty">
          <h4>まだ保存された回答がありません</h4>
          <p>参加者が「入力を保存」を押すと、ここに表示されます。</p>
        </div>
      ) : (
        <>
          <div className="worksheet-result-tools">
            <div
              className="worksheet-segment"
              role="group"
              aria-label="回答結果の表示方法"
            >
              <button
                type="button"
                aria-pressed={view === "person"}
                onClick={() => setView("person")}
              >
                参加者ごと
              </button>
              <button
                type="button"
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
              >
                全項目を一覧
              </button>
            </div>
            <label className="worksheet-search">
              参加者を検索
              <input
                type="search"
                placeholder="名前・メールアドレス"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          <p className="worksheet-result-count">
            {filtered.length}人を表示 / 保存した参加者 {responses.length}人 ·
            CSVには検索に関係なく全員・全項目を保存します。
          </p>
          {customOrder.length > 0 && (
            <button
              type="button"
              className="button outline"
              onClick={() => {
                setCustomOrder([]);
                try {
                  localStorage.removeItem(orderKey);
                } catch {
                  /* Use the default for this session. */
                }
              }}
            >
              参加順に戻す
            </button>
          )}
          {!filtered.length ? (
            <p className="worksheet-empty" role="status">
              該当する参加者がいません。検索条件を変更してください。
            </p>
          ) : view === "person" && person ? (
            <div className="worksheet-person-layout">
              <nav className="worksheet-people" aria-label="回答した参加者">
                {filtered.map((r) => (
                  <button
                    type="button"
                    key={r.respondentId}
                    aria-pressed={person.respondentId === r.respondentId}
                    onClick={() => setPersonId(r.respondentId)}
                  >
                    <strong>{r.name}</strong>
                    <span>{r.email || "メールアドレス未登録"}</span>
                  </button>
                ))}
              </nav>
              <article
                className="worksheet-person-detail"
                aria-label="選択した参加者の回答"
              >
                <header>
                  <h4>{person.name}</h4>
                  <p className="worksheet-person-email">
                    {person.email || "メールアドレス未登録"}
                  </p>
                  <p>
                    最終保存：
                    <time dateTime={new Date(person.updated).toISOString()}>
                      {surveyResponseTime(person.updated)}
                    </time>
                    （日本時間）
                  </p>
                </header>
                <dl>
                  {sheet.fields.map((f, index) => (
                    <div key={f.id} className="worksheet-answer-item">
                      <dt>
                        {f.section && <span>{f.section}</span>}
                        <strong>
                          {index + 1}. {f.label}
                        </strong>
                      </dt>
                      <dd>
                        {worksheetValueText(f, person.values) || (
                          <span className="worksheet-unanswered">未入力</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            </div>
          ) : (
            <div className="worksheet-all-results">
              <p className="worksheet-scroll-hint" id="worksheet-table-hint">
                左の氏名・メールアドレスと右の最終保存日時は固定です。中央の回答欄を横にスクロールして、全項目を確認できます。
                氏名の移動ボタンはドラッグまたは上下ボタンで並べ替えられます。
              </p>
              <div
                className="worksheet-comparison-wrap worksheet-frozen-wrap"
                role="region"
                aria-label="全項目の回答一覧"
                aria-describedby="worksheet-table-hint"
                tabIndex={0}
              >
                <table
                  className="worksheet-comparison worksheet-frozen-table"
                  style={{
                    width: `max(100%, calc(var(--worksheet-person-width) + var(--worksheet-time-width) + ${sheet.fields.length * 280}px))`,
                  }}
                >
                  <caption className="sr-only">
                    全参加者の全項目への回答。氏名・メールと最終保存日時は左右に固定表示します。
                  </caption>
                  <colgroup>
                    <col className="worksheet-col-person" />
                    {sheet.fields.map((f) => (
                      <col key={f.id} />
                    ))}
                    <col className="worksheet-col-time" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col" className="worksheet-pin-left">
                        氏名・メールアドレス
                      </th>
                      {sheet.fields.map((f, i) => (
                        <th
                          scope="col"
                          key={f.id}
                          className="worksheet-field-heading"
                        >
                          {f.section && <span>{f.section}</span>}
                          <strong>
                            {i + 1}. {f.label}
                          </strong>
                        </th>
                      ))}
                      <th scope="col" className="worksheet-pin-right">
                        最終保存<span>（日本時間）</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, index) => (
                      <tr
                        key={r.respondentId}
                        onDragOver={(event) => {
                          if (dragged && dragged !== r.respondentId)
                            event.preventDefault();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (dragged) {
                            const box =
                              event.currentTarget.getBoundingClientRect();
                            move(
                              dragged,
                              r.respondentId,
                              event.clientY > box.top + box.height / 2,
                            );
                          }
                          setDragged(undefined);
                        }}
                      >
                        <th scope="row" className="worksheet-pin-left">
                          <div className="worksheet-row-order">
                            <button
                              type="button"
                              draggable
                              aria-label={`${r.name}の行をドラッグして移動`}
                              title="ドラッグして行を移動"
                              onDragStart={(event) => {
                                setDragged(r.respondentId);
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  "text/plain",
                                  r.respondentId,
                                );
                              }}
                              onDragEnd={() => setDragged(undefined)}
                            >
                              ⠿
                            </button>
                            <button
                              type="button"
                              aria-label={`${r.name}の行を上へ移動`}
                              disabled={index === 0}
                              onClick={() =>
                                move(
                                  r.respondentId,
                                  filtered[index - 1].respondentId,
                                )
                              }
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label={`${r.name}の行を下へ移動`}
                              disabled={index === filtered.length - 1}
                              onClick={() =>
                                move(
                                  r.respondentId,
                                  filtered[index + 1].respondentId,
                                  true,
                                )
                              }
                            >
                              ↓
                            </button>
                          </div>
                          <strong>{r.name}</strong>
                          <span>{r.email || "メールアドレス未登録"}</span>
                        </th>
                        {sheet.fields.map((f) => (
                          <td key={f.id} className="worksheet-answer-cell">
                            {worksheetValueText(f, r.values) || (
                              <span className="worksheet-unanswered">
                                未入力
                              </span>
                            )}
                          </td>
                        ))}
                        <td className="worksheet-pin-right">
                          <time dateTime={new Date(r.updated).toISOString()}>
                            {surveyResponseTime(r.updated)}
                          </time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
