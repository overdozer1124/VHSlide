import type { WorksheetDefinition } from "./worksheets";

/** Preserve the order and identity of legacy contiguous section groups. */
export function sectionWorksheet(
  sheet: WorksheetDefinition,
): WorksheetDefinition {
  if (sheet.sections) return structuredClone(sheet);
  const sections: NonNullable<WorksheetDefinition["sections"]> = [];
  let last: string | undefined;
  let id = "";
  const fields = sheet.fields.map((field) => {
    if (last !== field.section || !id) {
      last = field.section;
      id = crypto.randomUUID();
      sections.push({ id, title: field.section });
    }
    return { ...field, sectionId: id };
  });
  return { ...sheet, sections, fields };
}
