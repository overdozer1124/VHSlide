import { it, expect, vi } from "vitest";
vi.mock("./cloud", () => ({ api: vi.fn() }));
import { parseSurveyBinding } from "./surveyBinding";
import { parseDeck, serializeDeck, sample, uid } from "./model";
import { createSharedDeck, readSharedDeck } from "./sharedDeck";
const binding = {
  deckId: "11111111-1111-1111-1111-111111111111",
  surveyId: "22222222-2222-2222-2222-222222222222",
  question: "好きな季節",
  kind: "single" as const,
  options: ["春", "夏"],
};
it("retains the portable survey reference through JSON and shared state without retaining answers", () => {
  const book = sample();
  book.slides[0].elements.push({
    id: uid(),
    type: "shape",
    shape: "rounded",
    x: 60,
    y: 50,
    w: 840,
    h: 440,
    fill: "#ffffff",
    stroke: "#587d59",
    survey: {
      ...binding,
      results: { texts: ["private answer"] },
      own: { text: "private" },
    } as any,
  });
  const parsed = parseDeck(serializeDeck(book));
  expect(parsed.slides[0].elements.at(-1)?.survey).toEqual(binding);
  const doc = createSharedDeck(parsed);
  try {
    expect(readSharedDeck(doc).slides[0].elements.at(-1)?.survey).toEqual(
      binding,
    );
  } finally {
    doc.destroy();
  }
  expect(JSON.stringify(parsed)).not.toContain("private");
});
it("rejects invalid or unbounded question references while preserving known fields only", () => {
  for (const patch of [
    { deckId: "https://evil.test" },
    { surveyId: "" },
    { kind: "html" },
    { question: "" },
    { options: ["one"] },
    { options: Array(11).fill("x") },
    { options: ["x", "a".repeat(61)] },
  ])
    expect(() => parseSurveyBinding({ ...binding, ...patch })).toThrow();
  expect(
    parseSurveyBinding({ ...binding, executable: "javascript:alert(1)" }),
  ).toEqual(binding);
});

it("renders thumbnails without answers and disables a copied survey in a different work", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { SlideSurvey } = await import("./SlideSurvey");
  const { SurveySlideContext } = await import("./SurveySlideContext");
  const slide = sample().slides[0];
  slide.elements = [
    {
      id: uid(),
      type: "shape",
      shape: "rounded",
      x: 60,
      y: 50,
      w: 840,
      h: 440,
      fill: "#ffffff",
      stroke: "#587d59",
      survey: binding,
    },
  ];
  const view = (deckId: string, interactive: boolean) =>
    renderToStaticMarkup(
      createElement(
        SurveySlideContext.Provider,
        {
          value: {
            deckId,
            userId: "actor",
            enabled: true,
            surveys: [
              {
                ...binding,
                id: binding.surveyId,
                status: "open",
                created: 1,
                own: { choices: [0], text: "" },
                results: {
                  count: 1,
                  counts: [1, 0],
                  texts: ["private result"],
                },
              },
            ],
            onUpdated: () => {},
          },
        },
        createElement(SlideSurvey, { element: slide.elements[0], interactive }),
      ),
    );
  const preview = view(binding.deckId, false);
  expect(preview).toContain("好きな季節");
  expect(preview).not.toContain("<input");
  expect(preview).not.toContain("private result");
  const copied = view("33333333-3333-3333-3333-333333333333", true);
  expect(copied).not.toContain("<form");
  expect(copied).toContain("元のクラウド作品");
  const live = view(binding.deckId, true);
  expect(live).toContain("<form");
  expect(live).not.toContain("private result");
});
