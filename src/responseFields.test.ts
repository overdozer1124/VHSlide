import { describe, it, expect } from "vitest";
import { blank, parseDeck, serializeDeck } from "./model";
import { makeResponseElement } from "./ResponseFieldTools";
describe("individual response bindings", () => {
  const deckId = "10000000-0000-4000-8000-000000000001",
    worksheetId = "10000000-0000-4000-8000-000000000002";
  const binding = {
    source: "worksheet" as const,
    deckId,
    worksheetId,
    showLabel: false,
    field: {
      id: "reason",
      label: "理由",
      kind: "text" as const,
      options: [],
      placeholder: "ここに入力",
      section: "",
      wide: true,
    },
  };
  it("round trips free layout and presentation without answers", () => {
    const slide = blank(0, 0);
    slide.elements = [
      {
        ...makeResponseElement(binding),
        fill: "none",
        strokeWidth: 0,
        x: 240,
        y: 80,
        w: 600,
        h: 240,
      },
    ];
    const parsed = parseDeck(
      serializeDeck({ version: 1, title: "授業", slides: [slide] }),
    );
    expect(parsed.slides[0].elements[0]).toMatchObject({
      x: 240,
      y: 80,
      w: 600,
      h: 240,
      fill: "none",
      strokeWidth: 0,
      responseField: binding,
    });
  });
  it("rejects overlapping activity types and invalid fields", () => {
    const slide = blank(0, 0);
    slide.elements = [
      {
        ...makeResponseElement(binding),
        worksheet: {
          ...binding,
          title: "二重定義",
          description: "",
          fields: [binding.field],
        },
      },
    ];
    expect(() =>
      parseDeck(JSON.stringify({ version: 1, title: "授業", slides: [slide] })),
    ).toThrow();
  });
});
