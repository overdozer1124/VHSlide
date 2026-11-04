import type { Element } from "./model";
import { H, W } from "./model";
import type { WorksheetDefinition } from "./worksheets";
import { parseResponseField } from "./responseFields";

/** Replace the embedded form with independently movable elements bound to the same answers. */
export function separateWorksheet(
  element: Element,
  sheet: WorksheetDefinition,
  id: () => string,
): Element[] {
  const binding = element.worksheet;
  if (!binding || !sheet.fields.length)
    throw Error("ワークシートを確認してください。");
  const columns =
    sheet.fields.length <= 3 ? 1 : sheet.fields.length <= 12 ? 2 : 4;
  const rows = Math.ceil(sheet.fields.length / columns);
  const gap = 8,
    titleHeight = 42,
    descriptionHeight = sheet.description ? 32 : 0;
  const width = Math.min(
    W,
    Math.max(element.w, columns * 100 + (columns + 1) * gap),
  );
  const height = Math.min(
    H,
    Math.max(
      element.h,
      titleHeight + descriptionHeight + rows * 40 + (rows + 2) * gap,
    ),
  );
  const x = Math.max(0, Math.min(W - width, element.x)),
    y = Math.max(0, Math.min(H - height, element.y));
  const size = element.formFontSize ?? sheet.fontSize ?? 18;
  const background: Element = {
    id: id(),
    type: "shape",
    shape: "rounded",
    x,
    y,
    w: width,
    h: height,
    fill: element.fill ?? "#ffffff",
    stroke: element.stroke ?? "#dc8945",
    strokeWidth: element.strokeWidth ?? 2,
    ...(element.groupId ? { groupId: element.groupId } : {}),
    ...(element.link ? { link: element.link } : {}),
    ...(element.opacity === undefined ? {} : { opacity: element.opacity }),
  };
  const title: Element = {
    id: id(),
    type: "text",
    x: x + gap,
    y: y + gap,
    w: width - gap * 2,
    h: titleHeight - gap,
    text: sheet.title,
    fontSize: Math.max(16, Math.min(60, size * 1.4)),
    color: "#29323b",
  };
  const description: Element[] = sheet.description
    ? [
        {
          id: id(),
          type: "text",
          x: x + gap,
          y: y + titleHeight,
          w: width - gap * 2,
          h: descriptionHeight,
          text: sheet.description,
          fontSize: size,
          color: "#526b60",
        },
      ]
    : [];
  const fieldTop = y + titleHeight + descriptionHeight + gap;
  const fieldWidth =
    ((width - gap * (columns + 1)) / columns) * (columns === 1 ? 0.88 : 1);
  const fieldHeight =
    (height - titleHeight - descriptionHeight - gap * (rows + 1)) / rows;
  const fields: Element[] = sheet.fields.map((field, index) => ({
    id: id(),
    type: "shape",
    shape: "rounded",
    x: x + gap + (index % columns) * (fieldWidth + gap),
    y: fieldTop + Math.floor(index / columns) * (fieldHeight + gap),
    w: fieldWidth,
    h: fieldHeight,
    fill: "#ffffff",
    stroke: "#e4a36e",
    strokeWidth: 1,
    color: "#29323b",
    fontSize: field.fontSize ?? size,
    text: field.label,
    responseField: parseResponseField({
      source: "worksheet",
      deckId: binding.deckId,
      worksheetId: binding.worksheetId,
      field,
      showLabel: true,
      showSection: !!field.section,
    }),
  }));
  return [background, title, ...description, ...fields];
}
