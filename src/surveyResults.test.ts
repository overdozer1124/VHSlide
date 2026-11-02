import { describe, it, expect } from "vitest";
import {
  resolveSurveyResult,
  linkSurveyResult,
  snapshotSurveyResults,
  parseSurveyResultBinding,
} from "./surveyResults";
import { insertSurveyResults } from "./surveySlides";
import { sample, parseDeck, serializeDeck } from "./model";
import type { SurveyView } from "./surveys";
const deckId = "11111111-1111-1111-1111-111111111111";
const survey: SurveyView = {
  id: "22222222-2222-2222-2222-222222222222",
  question: "季節",
  kind: "single",
  options: ["春", "夏"],
  status: "open",
  created: 1,
  results: { count: 1, counts: [1, 0], texts: [] },
};
const live = { ...survey, chartSummary: { count: 2, counts: [0, 2] } };
describe("linked survey results", () => {
  it("inserts portable references, resolves only shared numeric summary and preserves styling", () => {
    const book = sample();
    const r = insertSurveyResults(book, book.slides[0], survey, deckId);
    const slide = r.book.slides.find((s) => s.id === r.first)!;
    const chart = slide.elements.find((e) => e.chart)!;
    expect(chart.surveyResult?.part).toBe("chart");
    expect(parseDeck(serializeDeck(r.book))).toEqual(r.book);
    const next = resolveSurveyResult(chart, {
      deckId,
      enabled: true,
      surveys: [live],
    });
    expect(next.chart!.series.map((p) => p.value)).toEqual([0, 2]);
    expect(next.chart!.series.map((p) => p.color)).toEqual(
      chart.chart!.series.map((p) => p.color),
    );
    expect(chart.chart!.series.map((p) => p.value)).toEqual([1, 0]);
    const caption = slide.elements.find(
      (e) => e.surveyResult?.part === "caption",
    )!;
    expect(
      resolveSurveyResult(caption, { deckId, enabled: true, surveys: [live] })
        .text,
    ).toContain("2人が回答");
  });
  it("never uses host-private results, another deck, blocked context, deleted surveys or stopped sharing", () => {
    const b = sample();
    const r = insertSurveyResults(b, b.slides[0], survey, deckId);
    const chart = r.book.slides
      .find((s) => s.id === r.first)!
      .elements.find((e) => e.chart)!;
    for (const data of [
      { deckId, enabled: false, surveys: [live] },
      { deckId: "other", enabled: true, surveys: [live] },
      { deckId, enabled: true, surveys: [] },
      { deckId, enabled: true, surveys: [survey] },
    ])
      expect(resolveSurveyResult(chart, data)).toBe(chart);
  });
  it("links existing matching charts explicitly and refuses ambiguous or mismatched targets", () => {
    const b = sample();
    const r = insertSurveyResults(b, b.slides[0], survey);
    const at = r.book.slides.find((s) => s.id === r.first)!;
    expect(at.elements.find((e) => e.chart)!.surveyResult).toBeUndefined();
    const linked = linkSurveyResult(r.book, at, survey, deckId);
    expect(
      linked.slides.find((s) => s.id === at.id)!.elements.find((e) => e.chart)!
        .surveyResult?.surveyId,
    ).toBe(survey.id);
    expect(() => linkSurveyResult(b, b.slides[0], survey, deckId)).toThrow();
    const chart = at.elements.find((e) => e.chart)!;
    const twice = {
      ...at,
      elements: [...at.elements, { ...chart, id: "second" }],
    };
    expect(() => linkSurveyResult(r.book, twice, survey, deckId)).toThrow();
    expect(() =>
      linkSurveyResult(r.book, twice, survey, deckId, "second"),
    ).not.toThrow();
  });
  it("exports latest numeric fallback and excludes identities", () => {
    const b = sample();
    const r = insertSurveyResults(b, b.slides[0], survey, deckId);
    const frozen = snapshotSurveyResults(r.book, {
      deckId,
      enabled: true,
      surveys: [
        {
          ...live,
          results: {
            count: 2,
            counts: [0, 2],
            texts: [],
            responses: [
              {
                name: "PRIVATE",
                email: "private@test",
                respondentId: "secret",
                updated: 1,
                choices: [1],
                text: "",
              },
            ],
          },
        },
      ],
    });
    const json = serializeDeck(frozen);
    expect(json).not.toContain("PRIVATE");
    expect(json).not.toContain("private@test");
    expect(json).not.toContain("secret");
    expect(
      frozen.slides
        .find((s) => s.id === r.first)!
        .elements.find((e) => e.chart)!
        .chart!.series.map((p) => p.value),
    ).toEqual([0, 2]);
  });
  it("rejects invalid bindings and incompatible element types", () => {
    expect(() =>
      parseSurveyResultBinding({
        deckId,
        surveyId: survey.id,
        part: "responses",
      }),
    ).toThrow();
    const b = sample();
    b.slides[0].elements[0].surveyResult = {
      deckId,
      surveyId: survey.id,
      part: "chart",
    };
    expect(() => parseDeck(serializeDeck(b))).toThrow();
    expect(
      parseSurveyResultBinding({
        deckId,
        surveyId: survey.id,
        part: "chart",
        results: { private: true },
      }),
    ).not.toHaveProperty("results");
  });
});
