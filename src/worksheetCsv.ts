import type {
  WorksheetField,
  WorksheetValues,
  WorksheetView,
} from "./worksheets";
import { surveyResponseTime } from "./surveyCsv";
export function worksheetValueText(
  field: WorksheetField,
  values: WorksheetValues,
): string {
  const value = values[field.id];
  return field.kind === "checkbox"
    ? value === true
      ? "はい"
      : "いいえ"
    : field.kind === "text"
      ? String(value ?? "")
      : Array.isArray(value)
        ? value.map((i) => field.options[i]).join(" / ")
        : "";
}
export function worksheetCsv(sheet: WorksheetView): string {
  if (!sheet.results) throw new Error("ホストだけがCSVを保存できます。");
  const rows = [
    [
      "ワークシート",
      "回答者名",
      "メールアドレス",
      "最終保存日時（日本時間）",
      ...sheet.fields.map((f) => (f.section ? f.section + "：" : "") + f.label),
    ],
    ...sheet.results.responses.map((r) => [
      sheet.title,
      r.name,
      r.email,
      surveyResponseTime(r.updated),
      ...sheet.fields.map((f) => worksheetValueText(f, r.values)),
    ]),
  ];
  return (
    "\ufeff" +
    rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              (/^[\s\u0000-\u001f]*[=+@-]/.test(v) ? "'" + v : v).replace(
                /"/g,
                '""',
              ) +
              '"',
          )
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
