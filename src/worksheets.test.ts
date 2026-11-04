import { describe, it, expect } from "vitest";
import {
  parseWorksheet,
  parseWorksheetBinding,
  parseWorksheetValues,
} from "./worksheets";
import {
  worksheetTemplate,
  worksheetTemplateNames,
} from "./worksheetTemplates";
import { worksheetCsv } from "./worksheetCsv";
import { sample, parseDeck, serializeDeck } from "./model";
describe("worksheets", () => {
  it("validates radar scores and exports each axis and series in separate CSV columns", () => {
    const sheet = worksheetTemplate("radar");
    const f = sheet.fields[0];
    const scores = [1, 2, 3, 4, 5, null, 5, 4, 3, 2, 1, null];
    expect(parseWorksheetValues(sheet, { [f.id]: scores })[f.id]).toEqual(
      scores,
    );
    expect(() => parseWorksheetValues(sheet, { [f.id]: [9] })).toThrow();
    expect(() =>
      parseWorksheetValues(sheet, { [f.id]: [9, ...scores.slice(1)] }),
    ).toThrow();
    const csv = worksheetCsv({
      ...sheet,
      id: "sheet",
      created: 0,
      status: "open",
      results: {
        responses: [
          {
            respondentId: "u",
            name: "生徒",
            email: "a@test",
            updated: 0,
            values: { [f.id]: scores },
          },
        ],
      },
    });
    expect(csv).toContain('"項目ごとの評価：場面1：項目1"');
    expect(csv).toContain('"項目ごとの評価：場面2：項目6"');
    expect(csv).toContain('"1","2","3","4","5","","5","4","3","2","1",""');
  });
  it("preserves optional layout settings through serialization and rejects invalid dimensions", () => {
    const sheet = worksheetTemplate("blank");
    const styled = {
      ...sheet,
      fontSize: 24,
      fields: [
        {
          ...sheet.fields[0],
          widthPercent: 70,
          inputHeight: 120,
          fontSize: 22,
        },
      ],
    };
    expect(parseWorksheet(styled)).toEqual(styled);
    const book = sample();
    book.slides[0].elements.push({
      id: crypto.randomUUID(),
      type: "shape",
      shape: "rounded",
      fill: "#ffffff",
      stroke: "#dc8945",
      x: 0,
      y: 0,
      w: 900,
      h: 500,
      worksheet: {
        ...styled,
        deckId: crypto.randomUUID(),
        worksheetId: crypto.randomUUID(),
      },
    });
    expect(parseDeck(serializeDeck(book))).toEqual(book);
    expect(() =>
      parseWorksheet({
        ...styled,
        fields: [{ ...styled.fields[0], widthPercent: 101 }],
      }),
    ).toThrow();
    expect(() =>
      parseWorksheet({
        ...styled,
        fields: [{ ...styled.fields[0], inputHeight: -1 }],
      }),
    ).toThrow();
    expect(() => parseWorksheet({ ...styled, fontSize: 999 })).toThrow();
  });
  it("validates every classroom template and preserves only portable definitions", () => {
    for (const kind of Object.keys(
      worksheetTemplateNames,
    ) as (keyof typeof worksheetTemplateNames)[]) {
      const definition = worksheetTemplate(kind);
      expect(parseWorksheet(definition)).toEqual(definition);
      const sheet = parseWorksheetBinding({
        ...definition,
        deckId: crypto.randomUUID(),
        worksheetId: crypto.randomUUID(),
        results: { secret: "private" },
        own: { secret: "private" },
      });
      expect(sheet).not.toHaveProperty("results");
      expect(sheet).not.toHaveProperty("own");
      const book = sample();
      book.slides[0].elements.push({
        id: crypto.randomUUID(),
        type: "shape",
        shape: "rounded",
        fill: "#ffffff",
        stroke: "#dc8945",
        x: 0,
        y: 0,
        w: 900,
        h: 500,
        worksheet: sheet,
      });
      expect(parseDeck(serializeDeck(book))).toEqual(book);
    }
  });
  it("accepts partial work and unchecked checklists, rejects invalid types and foreign fields", () => {
    const sheet = worksheetTemplate("check");
    const values = parseWorksheetValues(sheet, {});
    expect(Object.values(values).every((v) => v === false)).toBe(true);
    expect(() =>
      parseWorksheetValues(sheet, { [sheet.fields[0].id]: "yes" }),
    ).toThrow();
    expect(() => parseWorksheetValues(sheet, { foreign: "bad" })).toThrow();
    const text = worksheetTemplate("reason");
    expect(parseWorksheetValues(text, {})[text.fields[0].id]).toBe("");
    expect(() =>
      parseWorksheetValues(text, { [text.fields[0].id]: "あ".repeat(2001) }),
    ).toThrow();
  });
  it("rejects duplicate ids, unsafe keys, too many fields, invalid choices and mixed bindings", () => {
    const sheet = worksheetTemplate("blank");
    expect(() =>
      parseWorksheet({ ...sheet, fields: [sheet.fields[0], sheet.fields[0]] }),
    ).toThrow();
    expect(() =>
      parseWorksheet({
        ...sheet,
        fields: [{ ...sheet.fields[0], id: "__proto__" }],
      }),
    ).toThrow();
    expect(() =>
      parseWorksheet({
        ...sheet,
        fields: Array.from({ length: 41 }, (_, i) => ({
          ...sheet.fields[0],
          id: String(i),
        })),
      }),
    ).toThrow();
    const choice = {
      ...sheet,
      fields: [
        { ...sheet.fields[0], kind: "single" as const, options: ["A", "B"] },
      ],
    };
    expect(() =>
      parseWorksheetValues(choice, { [choice.fields[0].id]: [0, 1] }),
    ).toThrow();
    expect(() =>
      parseWorksheetValues(choice, { [choice.fields[0].id]: [2] }),
    ).toThrow();
    const book = sample();
    book.slides[0].elements.push({
      id: crypto.randomUUID(),
      type: "text",
      x: 0,
      y: 0,
      w: 900,
      h: 500,
      worksheet: parseWorksheetBinding({
        ...sheet,
        deckId: crypto.randomUUID(),
        worksheetId: crypto.randomUUID(),
      }),
    });
    expect(() => parseDeck(serializeDeck(book))).toThrow();
  });
  it("exports one row per account with all fields, BOM, multiline quoting and formula protection", () => {
    const sheet = worksheetTemplate("blank");
    const id = sheet.fields[0].id;
    const csv = worksheetCsv({
      ...sheet,
      id: "s",
      created: 0,
      status: "open",
      results: {
        responses: [
          {
            respondentId: "u",
            name: "=1+1",
            email: "a@test",
            updated: 0,
            values: { [id]: '日本語,"花"\n次' },
          },
        ],
      },
    });
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"日本語,""花""\n次"');
    expect(() =>
      worksheetCsv({ ...sheet, id: "s", created: 0, status: "open" }),
    ).toThrow("ホスト");
  });
});
