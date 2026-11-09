import type {
  WorksheetField,
  WorksheetValues,
  WorksheetView,
} from "./worksheets";
import { surveyResponseTime } from "./surveyCsv";
import { worksheetReasonKey } from "./worksheets";
export function worksheetValueText(
  field: WorksheetField,
  values: WorksheetValues,
): string {
  if (
    !Object.hasOwn(values, field.id) &&
    !Object.hasOwn(values, worksheetReasonKey(field.id))
  )
    return "";
  const value = values[field.id];
  if (field.kind === "radar" && field.radar && Array.isArray(value)) {
    const { axes, series } = field.radar;
    return series
      .flatMap((name, s) =>
        axes.map((axis, a) => {
          const n = value[s * axes.length + a];
          return n == null ? "" : `${name}・${axis}: ${n}`;
        }),
      )
      .filter(Boolean)
      .join(" / ");
  }
  const answer =
    field.kind === "drawing"
      ? value
        ? "画像・手描きの回答あり"
        : ""
      : field.kind === "checkbox"
        ? value === true
          ? "はい"
          : "いいえ"
        : field.kind === "text"
          ? String(value ?? "")
          : Array.isArray(value)
            ? value.map((i) => (i === null ? "" : field.options[i])).join(" / ")
            : "";
  const reason = field.reason
    ? String(values[worksheetReasonKey(field.id)] ?? "")
    : "";
  return reason
    ? [answer, `理由：${reason}`].filter(Boolean).join("\n")
    : answer;
}
export function worksheetCsv(sheet: WorksheetView): string {
  if (!sheet.results) throw new Error("ホストだけがCSVを保存できます。");
  const rows = [
    [
      "ワークシート",
      "回答者名",
      "メールアドレス",
      "最終保存日時（日本時間）",
      ...sheet.fields.flatMap((f) =>
        f.kind === "radar" && f.radar
          ? f.radar.series.flatMap((series) =>
              f.radar!.axes.map((axis) => `${f.label}：${series}：${axis}`),
            )
          : f.reason
            ? [
                (f.section ? f.section + "：" : "") + f.label,
                (f.section ? f.section + "：" : "") + f.label + "：理由",
              ]
            : [(f.section ? f.section + "：" : "") + f.label],
      ),
    ],
    ...sheet.results.responses.map((r) => [
      sheet.title,
      r.name,
      r.email,
      surveyResponseTime(r.updated),
      ...sheet.fields.flatMap((f) =>
        f.kind === "radar" && f.radar
          ? f.radar.series.flatMap((_, s) =>
              f.radar!.axes.map((__, a) => {
                const value = r.values[f.id];
                return Array.isArray(value) &&
                  value[s * f.radar!.axes.length + a] != null
                  ? String(value[s * f.radar!.axes.length + a])
                  : "";
              }),
            )
          : f.reason
            ? [
                worksheetValueText({ ...f, reason: undefined }, r.values),
                String(r.values[worksheetReasonKey(f.id)] ?? ""),
              ]
            : [worksheetValueText(f, r.values)],
      ),
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
