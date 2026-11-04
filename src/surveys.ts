import type { HistorySQL } from "./historyStore.ts";
export type SurveyKind = "single" | "multiple" | "text";
export type SurveyStatus = "draft" | "open" | "closed";
export type Survey = {
  id: string;
  question: string;
  kind: SurveyKind;
  options: string[];
  status: SurveyStatus;
  created: number;
};
export type SurveyAnswer = { choices: number[]; text: string };
export type SurveyResponse = SurveyAnswer & {
  respondentId: string;
  name: string;
  email: string;
  updated: number;
};
export type SurveyView = Survey & {
  own?: SurveyAnswer;
  chartPublished?: boolean;
  chartSummary?: { count: number; counts: number[] };
  results?: {
    count: number;
    counts: number[];
    texts: string[];
    responses?: SurveyResponse[];
  };
};
export class SurveyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const insist = (ok: unknown, status: number, message: string): void => {
  if (!ok) throw new SurveyError(status, message);
};
export const surveySchema = `
CREATE TABLE IF NOT EXISTS surveys(id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, question TEXT NOT NULL, kind TEXT NOT NULL, options TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS survey_chart_publications(survey TEXT PRIMARY KEY REFERENCES surveys(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS surveys_deck ON surveys(deck);
CREATE TABLE IF NOT EXISTS survey_answers(survey TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE, author TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(survey,author));`;
function read(row: Record<string, any>): Survey {
  return {
    id: row.id,
    question: row.question,
    kind: row.kind,
    options: JSON.parse(row.options),
    status: row.status,
    created: row.created,
  };
}
export function surveyList(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
): SurveyView[] {
  return [
    ...sql("SELECT * FROM surveys WHERE deck=? ORDER BY created DESC,id", deck),
  ]
    .filter((row) => host || row.status !== "draft")
    .map((row) => {
      const survey = read(row);
      const own = [
        ...sql(
          "SELECT value FROM survey_answers WHERE survey=? AND author=?",
          survey.id,
          actor,
        ),
      ][0];
      const result: SurveyView = {
        ...survey,
        ...(own ? { own: JSON.parse(own.value) } : {}),
      };
      const published =
        [
          ...sql(
            "SELECT survey FROM survey_chart_publications WHERE survey=?",
            survey.id,
          ),
        ].length > 0;
      if (host) result.chartPublished = published;
      if (published && survey.kind !== "text") {
        const values = [
          ...sql("SELECT value FROM survey_answers WHERE survey=?", survey.id),
        ].map((a) => JSON.parse(a.value) as SurveyAnswer);
        result.chartSummary = {
          count: values.length,
          counts: survey.options.map(
            (_, i) => values.filter((a) => a.choices.includes(i)).length,
          ),
        };
      }
      if (host) {
        const answers = [
          ...sql(
            "SELECT a.author,a.value,a.updated,u.name,u.email FROM survey_answers a LEFT JOIN users u ON u.id=a.author WHERE a.survey=? ORDER BY a.updated,a.author",
            survey.id,
          ),
        ].map((row): SurveyResponse => ({
          ...(JSON.parse(row.value) as SurveyAnswer),
          respondentId: row.author,
          name: row.name || "名前未登録",
          email: row.email || "",
          updated: row.updated,
        }));
        result.results = {
          count: answers.length,
          counts: survey.options.map(
            (_, i) => answers.filter((a) => a.choices.includes(i)).length,
          ),
          texts: survey.kind === "text" ? answers.map((a) => a.text) : [],
          responses: answers,
        };
      }
      return result;
    });
}
/** Must run within the caller's transaction after current membership validation. */
export function surveyCommand(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  action: string,
  id: string | undefined,
  input: unknown,
) {
  const value = input as Record<string, unknown>;
  insist(
    value && typeof value === "object" && !Array.isArray(value),
    400,
    "アンケートの入力を確認してください。",
  );
  if (action === "create") {
    insist(host, 403, "アンケートを作成できるのはホストだけです。");
    insist(
      [...sql("SELECT id FROM surveys WHERE deck=?", deck)].length < 30,
      413,
      "アンケートは作品ごとに30件までです。",
    );
    insist(
      typeof value.question === "string" &&
        value.question.trim().length > 0 &&
        value.question.length <= 200,
      400,
      "質問は1〜200文字で入力してください。",
    );
    insist(
      ["single", "multiple", "text"].includes(String(value.kind)),
      400,
      "回答形式を確認してください。",
    );
    const options = value.kind === "text" ? [] : value.options;
    insist(
      Array.isArray(options) &&
        (value.kind === "text" ||
          (options.length >= 2 && options.length <= 10)) &&
        options.every(
          (o) => typeof o === "string" && o.trim().length > 0 && o.length <= 60,
        ) &&
        new Set((options as string[]).map((o) => o.trim())).size ===
          (options as string[]).length,
      400,
      "選択肢は重複しない2〜10項目、各60文字までです。",
    );
    const survey = {
      id: crypto.randomUUID(),
      question: (value.question as string).trim().replace(/\s+/g, " "),
      kind: value.kind as SurveyKind,
      options: (options as string[]).map((o) => o.trim()),
      status: "draft" as const,
      created: Date.now(),
    };
    sql(
      "INSERT INTO surveys VALUES(?,?,?,?,?,?,?)",
      survey.id,
      deck,
      survey.question,
      survey.kind,
      JSON.stringify(survey.options),
      survey.status,
      survey.created,
    );
    return;
  }
  const row = [
    ...sql("SELECT * FROM surveys WHERE deck=? AND id=?", deck, id ?? ""),
  ][0];
  insist(row, 404, "アンケートが見つかりません。");
  const survey = read(row);
  if (action === "edit") {
    insist(host, 403, "内容を編集できるのはホストだけです。");
    const before = value.expected as {
      question?: unknown;
      kind?: unknown;
      options?: unknown;
    };
    insist(
      before &&
        before.question === survey.question &&
        before.kind === survey.kind &&
        JSON.stringify(before.options) === JSON.stringify(survey.options),
      409,
      "他の画面で内容が変更されました。最新の内容を読み込んでから編集してください。",
    );
    insist(
      typeof value.question === "string" &&
        value.question.trim().length > 0 &&
        value.question.length <= 200,
      400,
      "質問は1〜200文字で入力してください。",
    );
    const options = value.options;
    insist(
      Array.isArray(options) &&
        (survey.kind === "text"
          ? options.length === 0
          : options.length >= survey.options.length && options.length <= 10) &&
        options.every(
          (o) => typeof o === "string" && o.trim() && o.length <= 60,
        ) &&
        new Set(options.map((o: string) => o.trim())).size === options.length,
      400,
      "選択肢は重複しない各60文字以内で入力してください。",
    );
    sql(
      "UPDATE surveys SET question=?,options=? WHERE id=? AND deck=?",
      (value.question as string).trim().replace(/\s+/g, " "),
      JSON.stringify((options as string[]).map((o) => o.trim())),
      survey.id,
      deck,
    );
  } else if (action === "publish") {
    insist(host, 403, "集計の共有を変更できるのはホストだけです。");
    insist(
      survey.kind !== "text" &&
        survey.status !== "draft" &&
        typeof value.enabled === "boolean",
      400,
      "受付を開始済みの選択式アンケートを指定してください。",
    );
    if (value.enabled)
      sql(
        "INSERT OR IGNORE INTO survey_chart_publications VALUES(?)",
        survey.id,
      );
    else sql("DELETE FROM survey_chart_publications WHERE survey=?", survey.id);
  } else if (action === "status") {
    insist(host, 403, "受付を変更できるのはホストだけです。");
    insist(
      ["open", "closed"].includes(String(value.status)),
      400,
      "受付状態を確認してください。",
    );
    sql(
      "UPDATE surveys SET status=? WHERE id=? AND deck=?",
      value.status as string,
      survey.id,
      deck,
    );
  } else if (action === "delete") {
    insist(host, 403, "削除できるのはホストだけです。");
    sql("DELETE FROM surveys WHERE id=? AND deck=?", survey.id, deck);
  } else if (action === "answer") {
    insist(
      survey.status === "open",
      409,
      "このアンケートは回答を受け付けていません。",
    );
    if (value.clear === true) {
      insist(
        Array.isArray(value.choices) &&
          value.choices.length === 0 &&
          value.text === "",
        400,
        "回答の取り消し内容を確認してください。",
      );
      sql(
        "DELETE FROM survey_answers WHERE survey=? AND author=?",
        survey.id,
        actor,
      );
      return;
    }
    const choices = value.choices;
    insist(
      Array.isArray(choices) &&
        choices.length <= 10 &&
        choices.every(
          (i) => Number.isInteger(i) && i >= 0 && i < survey.options.length,
        ) &&
        new Set(choices).size === choices.length &&
        typeof value.text === "string",
      400,
      "回答の内容を確認してください。",
    );
    if (survey.kind === "text")
      insist(
        (choices as number[]).length === 0 &&
          (value.text as string).trim().length > 0 &&
          (value.text as string).length <= 2000,
        400,
        "回答は1〜2000文字で入力してください。",
      );
    else
      insist(
        (value.text as string).length === 0 &&
          (choices as number[]).length > 0 &&
          (survey.kind !== "single" || (choices as number[]).length === 1),
        400,
        "選択肢を選んでください（単一選択は1つ）。",
      );
    const prior = [
      ...sql(
        "SELECT author FROM survey_answers WHERE survey=? AND author=?",
        survey.id,
        actor,
      ),
    ][0];
    insist(
      prior ||
        [
          ...sql(
            "SELECT COUNT(*) AS n FROM survey_answers WHERE survey=?",
            survey.id,
          ),
        ][0].n < 500,
      413,
      "回答は1アンケート500人までです。",
    );
    sql(
      "INSERT INTO survey_answers VALUES(?,?,?,?) ON CONFLICT(survey,author) DO UPDATE SET value=excluded.value,updated=excluded.updated",
      survey.id,
      actor,
      JSON.stringify({ choices, text: (value.text as string).trim() }),
      Date.now(),
    );
  } else throw new SurveyError(404, "アンケートの操作が見つかりません。");
}
