import type { WorksheetField } from "./worksheets.ts";
import { parseWorksheet } from "./worksheets.ts";
import { parseSurveyBinding } from "./surveyBinding.ts";
import type { SurveyBinding } from "./surveyBinding.ts";
export type ResponseFieldBinding = (
  | {
      source: "worksheet";
      deckId: string;
      worksheetId: string;
      field: WorksheetField;
    }
  | ({ source: "survey" } & SurveyBinding)
) & { showLabel: boolean };
export function parseResponseField(value: unknown): ResponseFieldBinding {
  const v = value as ResponseFieldBinding;
  if (!v || typeof v.showLabel !== "boolean")
    throw Error("入力欄の形式が正しくありません。");
  if (v.source === "survey")
    return {
      source: "survey",
      ...parseSurveyBinding(v),
      showLabel: v.showLabel,
    };
  if (
    v.source !== "worksheet" ||
    typeof v.deckId !== "string" ||
    typeof v.worksheetId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(v.deckId) ||
    !/^[a-f0-9-]{36}$/.test(v.worksheetId)
  )
    throw Error("入力欄の参照が正しくありません。");
  const field = parseWorksheet({
    title: "入力欄",
    description: "",
    fields: [v.field],
  }).fields[0];
  return {
    source: "worksheet",
    deckId: v.deckId,
    worksheetId: v.worksheetId,
    field,
    showLabel: v.showLabel,
  };
}
