import { expect, it } from "vitest";
import { blank, parseDeck, type Element } from "./model";
import { worksheetTemplate } from "./worksheetTemplates";
import { separateWorksheet } from "./worksheetLayout";

it("creates separate editable fields tied to the original worksheet and keeps them on the slide", () => {
  const sheet = worksheetTemplate("reason");
  const source: Element = {
    id: "form",
    type: "shape",
    shape: "rounded",
    x: 20,
    y: 15,
    w: 920,
    h: 510,
    fill: "#ffffff",
    stroke: "#dc8945",
    worksheet: {
      ...sheet,
      deckId: crypto.randomUUID(),
      worksheetId: crypto.randomUUID(),
    },
  };
  const parts = separateWorksheet(source, sheet, () => crypto.randomUUID());
  const fields = parts.filter((e) => e.responseField);
  expect(fields).toHaveLength(sheet.fields.length);
  expect(
    fields.map(
      (e) =>
        e.responseField?.source === "worksheet" && e.responseField.field.id,
    ),
  ).toEqual(sheet.fields.map((f) => f.id));
  expect(
    fields.every(
      (e) =>
        e.responseField?.deckId === source.worksheet!.deckId &&
        e.responseField?.source === "worksheet" &&
        e.responseField.worksheetId === source.worksheet!.worksheetId,
    ),
  ).toBe(true);
  expect(fields[0].responseField?.showSection).toBe(true);
  expect(parts.some((e) => e.text === sheet.title)).toBe(true);
  expect(
    parts.every(
      (e) =>
        e.x >= 0 &&
        e.y >= 0 &&
        e.w >= 20 &&
        e.h >= 20 &&
        e.x + e.w <= 960.1 &&
        e.y + e.h <= 540.1,
    ),
  ).toBe(true);
  const book = {
    version: 1,
    title: "レイアウト",
    slides: [{ ...blank(0, 0), elements: parts }],
  };
  const parsed = parseDeck(JSON.stringify(book));
  expect(parsed.slides[0].elements.filter((e) => e.responseField).map((e) => e.responseField)).toEqual(fields.map((e) => e.responseField));
});
