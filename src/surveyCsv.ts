import type { SurveyAnswer, SurveyView } from "./surveys";
export function surveyAnswerText(
  survey: SurveyView,
  answer: SurveyAnswer,
): string {
  return survey.kind === "text"
    ? answer.text
    : survey.options.filter((_, i) => answer.choices.includes(i)).join(" / ");
}
export function surveyResponseTime(time: number): string {
  return new Date(time).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour12: false,
  });
}
function cell(value: string): string {
  // User-entered spreadsheet formulas must remain literal text when opened in Excel.
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
/** One selected question, one row per participant's latest saved response. */
export function surveyResponsesCsv(survey: SurveyView): string {
  if (!survey.results?.responses)
    throw new Error("ホストが回答結果を取得してからCSVを保存してください。");
  const kind = { single: "単一選択", multiple: "複数選択", text: "記述式" }[
    survey.kind
  ];
  const rows: string[][] = [
    [
      "質問",
      "回答形式",
      "回答者名",
      "メールアドレス",
      "回答",
      "最終回答日時（日本時間）",
      ...survey.options.map((option, i) => `選択肢${i + 1}：${option}`),
    ],
  ];
  for (const answer of survey.results.responses) {
    rows.push([
      survey.question,
      kind,
      answer.name,
      answer.email,
      surveyAnswerText(survey, answer),
      surveyResponseTime(answer.updated),
      ...survey.options.map((_, i) => (answer.choices.includes(i) ? "1" : "0")),
    ]);
  }
  return `\ufeff${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
