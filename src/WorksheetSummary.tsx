import type { WorksheetField, WorksheetView } from "./worksheets";

export function WorksheetSummary({
  sheet,
  host = false,
  onShare,
  onInsert,
}: {
  sheet: WorksheetView;
  host?: boolean;
  onShare?: (field: WorksheetField, published: boolean) => void;
  onInsert?: (field: WorksheetField) => void;
}) {
  const fields = sheet.fields.filter(
    (f) =>
      (f.kind === "single" || f.kind === "multiple") &&
      (host || f.aggregatePublic),
  );
  if (!fields.length) return null;
  return (
    <section className="worksheet-aggregates" aria-label="選択式の集計結果">
      <h4>選択式の集計結果</h4>
      {fields.map((field) => {
        const summary = sheet.summaries?.[field.id];
        return (
          <article className="worksheet-aggregate" key={field.id}>
            <strong>{field.label}</strong>
            <p>
              {summary?.count ?? 0}人が回答
              {field.kind === "multiple" ? "（複数選択）" : ""}
            </p>
            {field.options.map((option, i) => (
              <div className="worksheet-aggregate-row" key={i}>
                <span>{option}</span>
                <progress
                  max={Math.max(1, summary?.count ?? 0)}
                  value={summary?.counts[i] ?? 0}
                  aria-label={`${field.label}：${option}`}
                />
                <span>{summary?.counts[i] ?? 0}件</span>
              </div>
            ))}
            {host && (
              <div className="worksheet-aggregate-actions">
                <button
                  type="button"
                  className="button outline"
                  onClick={() => onShare?.(field, !field.aggregatePublic)}
                >
                  {field.aggregatePublic
                    ? "参加者への集計公開を停止"
                    : "集計を参加者に公開"}
                </button>
                <button
                  type="button"
                  className="button outline"
                  onClick={() => onInsert?.(field)}
                >
                  集計グラフをスライドに配置
                </button>
                <small>
                  {field.aggregatePublic
                    ? "集計を参加者に公開中"
                    : "集計はホストのみ"}
                  。氏名・記述した理由は公開しません。
                </small>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
