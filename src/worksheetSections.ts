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

/** Move a field to the end of a section without changing its identity. */
export function moveWorksheetFieldToSection(
  sheet: WorksheetDefinition,
  fieldId: string,
  destinationId: string,
): WorksheetDefinition {
  const sections = sheet.sections ?? [];
  const destinationIndex = sections.findIndex((s) => s.id === destinationId);
  const field = sheet.fields.find((f) => f.id === fieldId);
  if (destinationIndex < 0 || !field || field.sectionId === destinationId)
    return sheet;

  const destination = sections[destinationIndex];
  const fields = sheet.fields.filter((f) => f.id !== fieldId);
  const laterSections = new Set(
    sections.slice(destinationIndex + 1).map((s) => s.id),
  );
  const next = fields.findIndex(
    (f) => f.sectionId && laterSections.has(f.sectionId),
  );
  fields.splice(next < 0 ? fields.length : next, 0, {
    ...field,
    sectionId: destination.id,
    section: destination.title,
  });
  return { ...sheet, fields };
}
