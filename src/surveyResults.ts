import type { Deck, Element, Slide } from "./model.ts";
import type { SurveyView } from "./surveys.ts";
import { chartColors } from "./chartData.ts";
export type SurveyResultBinding = {
  deckId: string;
  surveyId: string;
  part: "chart" | "caption";
};
export function parseSurveyResultBinding(value: unknown): SurveyResultBinding {
  const v = value as SurveyResultBinding;
  if (
    !v ||
    typeof v.deckId !== "string" ||
    typeof v.surveyId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(v.deckId) ||
    !/^[a-f0-9-]{36}$/.test(v.surveyId) ||
    !["chart", "caption"].includes(v.part)
  )
    throw Error("アンケート集計の参照が正しくありません。");
  return { deckId: v.deckId, surveyId: v.surveyId, part: v.part };
}
export type SurveyResultData = {
  deckId?: string;
  enabled: boolean;
  surveys: SurveyView[];
};
export function resolveSurveyResult(
  e: Element,
  data: SurveyResultData,
): Element {
  const b = e.surveyResult;
  if (!b || !data.enabled || b.deckId !== data.deckId) return e;
  const survey = data.surveys.find((s) => s.id === b.surveyId);
  const summary = survey?.chartSummary;
  if (!survey || !summary || survey.kind === "text") return e;
  if (b.part === "chart" && e.chart)
    return {
      ...e,
      chart: {
        ...e.chart,
        series: survey.options.map((label, i) => ({
          id: e.chart!.series[i]?.id ?? `option-${i}`,
          label,
          value: summary.counts[i] ?? 0,
          color:
            e.chart!.series[i]?.color ?? chartColors[i % chartColors.length],
        })),
      },
    };
  if (b.part === "caption")
    return {
      ...e,
      text: `${summary.count}人が回答${survey.kind === "multiple" ? "・複数選択（各項目の件数）" : ""} ／ アンケートと自動連動`,
      richText: undefined,
    };
  return e;
}
export function linkSurveyResult(
  book: Deck,
  at: Slide,
  survey: SurveyView,
  deckId: string,
  selectedId?: string,
): Deck {
  if (survey.kind === "text") throw Error("連動できるのは選択式のグラフです。");
  const candidates = at.elements.filter(
    (e) =>
      e.type === "chart" &&
      e.chart?.series.length === survey.options.length &&
      e.chart.series.every((p, i) => p.label === survey.options[i]),
  );
  const chart =
    candidates.find((e) => e.id === selectedId) ??
    (candidates.length === 1 ? candidates[0] : undefined);
  if (!chart)
    throw Error(
      "このアンケートと選択肢が一致するグラフを1つ選択してから実行してください。",
    );
  const captions = at.elements.filter(
    (e) => e.type === "text" && /^\d+人が回答.*時点/.test(e.text ?? ""),
  );
  const captionId =
    at.elements.filter((e) => e.type === "chart").length === 1 &&
    captions.length === 1
      ? captions[0].id
      : undefined;
  return {
    ...book,
    slides: book.slides.map((s) =>
      s.id !== at.id
        ? s
        : {
            ...s,
            elements: s.elements.map((e) =>
              e.id === chart.id
                ? {
                    ...e,
                    surveyResult: parseSurveyResultBinding({
                      deckId,
                      surveyId: survey.id,
                      part: "chart",
                    }),
                  }
                : e.id === captionId
                  ? {
                      ...e,
                      surveyResult: parseSurveyResultBinding({
                        deckId,
                        surveyId: survey.id,
                        part: "caption",
                      }),
                    }
                  : e,
            ),
          },
    ),
  };
}
/** Update portable fallback values without including any respondent records. */
export function snapshotSurveyResults(
  book: Deck,
  data: SurveyResultData,
): Deck {
  return {
    ...book,
    slides: book.slides.map((s) => ({
      ...s,
      elements: s.elements.map((e) => {
        const rendered = resolveSurveyResult(e, data);
        return rendered !== e && e.surveyResult?.part === "caption"
          ? {
              ...rendered,
              text: rendered.text?.replace(
                "アンケートと自動連動",
                `${new Date().toLocaleString("ja-JP")} 時点（オンラインで自動更新）`,
              ),
            }
          : rendered;
      }),
    })),
  };
}
