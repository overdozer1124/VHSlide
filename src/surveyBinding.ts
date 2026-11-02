import type { SurveyKind } from "./surveys.ts";
export type SurveyBinding = {
  deckId: string;
  surveyId: string;
  question: string;
  kind: SurveyKind;
  options: string[];
};
/** Only a question snapshot and scoped reference are portable; never import answers. */
export function parseSurveyBinding(value: unknown): SurveyBinding {
  const v = value as SurveyBinding;
  if (
    !v ||
    typeof v.deckId !== "string" ||
    typeof v.surveyId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(v.deckId) ||
    !/^[a-f0-9-]{36}$/.test(v.surveyId) ||
    typeof v.question !== "string" ||
    !v.question.trim() ||
    v.question.length > 200 ||
    !["single", "multiple", "text"].includes(v.kind) ||
    !Array.isArray(v.options) ||
    v.options.length > 10 ||
    (v.kind === "text" ? v.options.length !== 0 : v.options.length < 2) ||
    v.options.some((o) => typeof o !== "string" || !o.trim() || o.length > 60)
  ) {
    throw new Error("スライド内アンケートの形式が正しくありません。");
  }
  return {
    deckId: v.deckId,
    surveyId: v.surveyId,
    question: v.question,
    kind: v.kind,
    options: [...v.options],
  };
}
