import { describe, expect, it } from "vitest";
import type { Deck, Element } from "./model";
import type { WorksheetField } from "./worksheets";
import { collectForeignForms, rewriteFormBindings } from "./formAdoption";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SHEET_A = "33333333-3333-4333-8333-333333333333";
const SHEET_B = "44444444-4444-4444-8444-444444444444";
const SURVEY_A = "55555555-5555-4555-8555-555555555555";

const textField = (id: string, label: string): WorksheetField => ({
  id,
  label,
  kind: "text",
  options: [],
  placeholder: "",
  section: "",
  wide: true,
});

const el = (patch: Partial<Element>): Element => ({
  id: crypto.randomUUID(),
  type: "shape",
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  ...patch,
});

const deckOf = (elements: Element[]): Deck => ({
  version: 1,
  title: "テスト",
  slides: [
    { id: "s1", x: 0, y: 0, title: "p1", background: "#fff", elements },
  ],
});

const wsField = (worksheetId: string, field: WorksheetField, deckId = OTHER) =>
  el({
    responseField: {
      source: "worksheet",
      deckId,
      worksheetId,
      field,
      showLabel: true,
    },
  });

describe("collectForeignForms", () => {
  it("collects worksheet fields from response fields in order, deduplicated", () => {
    const deck = deckOf([
      wsField(SHEET_A, textField("q1", "質問1")),
      wsField(SHEET_A, textField("q2", "質問2")),
      wsField(SHEET_A, textField("q1", "質問1")),
      wsField(SHEET_B, textField("r1", "別シート")),
    ]);
    const { worksheets } = collectForeignForms(deck, OWNER);
    expect(worksheets).toHaveLength(2);
    expect(worksheets[0].sourceId).toBe(SHEET_A);
    expect(worksheets[0].definition.fields.map((f) => f.id)).toEqual([
      "q1",
      "q2",
    ]);
    expect(worksheets[0].definition.title).toBe("ワークシート");
    expect(worksheets[1].definition.title).toBe("ワークシート2");
  });

  it("ignores bindings that already belong to the owner deck", () => {
    const deck = deckOf([wsField(SHEET_A, textField("q1", "質問1"), OWNER)]);
    const { worksheets, surveys } = collectForeignForms(deck, OWNER);
    expect(worksheets).toHaveLength(0);
    expect(surveys).toHaveLength(0);
  });

  it("prefers an embedded worksheet definition over field snapshots", () => {
    const deck = deckOf([
      el({
        worksheet: {
          deckId: OTHER,
          worksheetId: SHEET_A,
          title: "本シート",
          description: "説明",
          fields: [textField("q1", "質問1"), textField("q2", "質問2")],
        },
      }),
      wsField(SHEET_A, textField("q1", "質問1")),
    ]);
    const { worksheets } = collectForeignForms(deck, OWNER);
    expect(worksheets).toHaveLength(1);
    expect(worksheets[0].definition.title).toBe("本シート");
    expect(worksheets[0].definition.fields).toHaveLength(2);
  });

  it("skips a worksheet whose definition no longer validates", () => {
    const deck = deckOf([
      el({
        worksheet: {
          deckId: OTHER,
          worksheetId: SHEET_A,
          title: "空",
          description: "",
          fields: [],
        },
      }),
    ]);
    const { worksheets } = collectForeignForms(deck, OWNER);
    expect(worksheets).toHaveLength(0);
  });

  it("collects surveys from response fields and embedded surveys", () => {
    const deck = deckOf([
      el({
        responseField: {
          source: "survey",
          deckId: OTHER,
          surveyId: SURVEY_A,
          question: "どうでしたか",
          kind: "single",
          options: ["はい", "いいえ"],
          showLabel: true,
        },
      }),
    ]);
    const { surveys } = collectForeignForms(deck, OWNER);
    expect(surveys).toHaveLength(1);
    expect(surveys[0].question).toBe("どうでしたか");
  });
});

describe("rewriteFormBindings", () => {
  it("rewrites mapped bindings to the new deck and ids", () => {
    const deck = deckOf([
      wsField(SHEET_A, textField("q1", "質問1")),
      el({
        worksheet: {
          deckId: OTHER,
          worksheetId: SHEET_A,
          title: "本シート",
          description: "",
          fields: [textField("q1", "質問1")],
        },
      }),
      wsField(SHEET_B, textField("r1", "対象外")),
    ]);
    const NEW_SHEET = "66666666-6666-4666-8666-666666666666";
    const next = rewriteFormBindings(
      deck,
      OWNER,
      new Map([[`${OTHER}:${SHEET_A}`, NEW_SHEET]]),
      new Map(),
    );
    const [a, b, c] = next.slides[0].elements;
    expect(a.responseField).toMatchObject({
      deckId: OWNER,
      worksheetId: NEW_SHEET,
    });
    expect(b.worksheet).toMatchObject({
      deckId: OWNER,
      worksheetId: NEW_SHEET,
    });
    expect(c.responseField).toMatchObject({
      deckId: OTHER,
      worksheetId: SHEET_B,
    });
  });

  it("returns the deck unchanged when nothing is mapped", () => {
    const deck = deckOf([wsField(SHEET_A, textField("q1", "質問1"))]);
    expect(rewriteFormBindings(deck, OWNER, new Map(), new Map())).toBe(deck);
  });
});
