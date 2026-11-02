import { axisId } from "./axes";
import { describe, it, expect } from "vitest";
import { sample, parseDeck, serializeDeck } from "./model";
import { insertSurveyResults } from "./surveySlides";
import type { SurveyView } from "./surveys";
const survey: SurveyView = {
  id: "survey",
  question: "好きな季節",
  kind: "single",
  status: "closed",
  created: 1,
  options: ["春", "夏"],
  results: { count: 3, counts: [1, 2], texts: [] },
};
describe("survey result snapshots", () => {
  it("inserts an editable chart column, shifts existing topics, preserves the original and survives export", () => {
    const book = sample(),
      original = structuredClone(book);
    const result = insertSurveyResults(book, book.slides[0], survey);
    expect(book).toEqual(original);
    const page = result.book.slides.find((s) => s.id === result.first)!;
    expect(page).toMatchObject({ x: 1, y: 0 });
    expect(axisId(result.book, "main", "columns", 2)).toBe(
      axisId(book, "main", "columns", 1),
    );
    expect(axisId(result.book, "main", "columns", 1)).not.toBe(
      axisId(book, "main", "columns", 1),
    );
    expect(result.book.slides.find((s) => s.id === book.slides[1].id)!.x).toBe(
      2,
    );
    expect(
      page.elements
        .find((e) => e.type === "chart")!
        .chart!.series.map((p) => p.value),
    ).toEqual([1, 2]);
    expect(parseDeck(serializeDeck(result.book))).toEqual(result.book);
    survey.results!.counts[0] = 99;
    expect(
      page.elements.find((e) => e.type === "chart")!.chart!.series[0].value,
    ).toBe(1);
    survey.results!.counts[0] = 1;
  });
  it("paginates long Unicode answers without truncation into valid bounded slides", () => {
    const book = sample();
    const answer = "🌸春の発見".repeat(250);
    const { book: next } = insertSurveyResults(book, book.slides[0], {
      ...survey,
      kind: "text",
      options: [],
      results: { count: 1, counts: [], texts: [answer] },
    });
    const added = next.slides.filter(
      (s) => !book.slides.some((old) => old.id === s.id),
    );
    expect(added.length).toBeGreaterThan(1);
    const content = added
      .flatMap((s) => s.elements.slice(2))
      .map((e) => e.text)
      .join("\n");
    expect(content.replace(/【回答 1】|\n/g, "")).toBe(answer);
    expect(added.map((s) => s.y)).toEqual(added.map((_, i) => i));
    expect(() => parseDeck(serializeDeck(next))).not.toThrow();
  });
  it("keeps respondent identities out of shared result snapshots", () => {
    const book = sample();
    const identified = structuredClone(survey);
    identified.results!.responses = [
      {
        respondentId: "private-id",
        name: "private-name",
        email: "private@example.test",
        choices: [1],
        text: "",
        updated: 1,
      },
    ];
    const result = insertSurveyResults(book, book.slides[0], identified);
    const json = serializeDeck(result.book);
    expect(json).not.toContain("private-id");
    expect(json).not.toContain("private-name");
    expect(json).not.toContain("private@example.test");
  });
  it("refuses absent results, zero responses and a full grid without changing the work", () => {
    const book = sample(),
      before = serializeDeck(book);
    expect(() =>
      insertSurveyResults(book, book.slides[0], {
        ...survey,
        results: undefined,
      }),
    ).toThrow();
    expect(() =>
      insertSurveyResults(book, book.slides[0], {
        ...survey,
        results: { count: 0, counts: [0, 0], texts: [] },
      }),
    ).toThrow();
    book.slides[1].x = 99;
    expect(() => insertSurveyResults(book, book.slides[0], survey)).toThrow(
      /100列/,
    );
    book.slides[1].x = 1;
    expect(serializeDeck(book)).toBe(before);
  });
});
