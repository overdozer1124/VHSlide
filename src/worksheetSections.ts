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

/** Reorder entire sections, keeping their fields in the same order. */
export function moveWorksheetSection(
  sheet: WorksheetDefinition,
  id: string,
  direction: -1 | 1,
): WorksheetDefinition {
  const sections = [...(sheet.sections ?? [])];
  const index = sections.findIndex((s) => s.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= sections.length) return sheet;
  [sections[index], sections[target]] = [sections[target], sections[index]];
  const fields = sections.flatMap((section) =>
    sheet.fields.filter((field) => field.sectionId === section.id),
  );
  return { ...sheet, sections, fields };
}

/** Merge into the adjacent section, keeping its heading and all field IDs. */
export function mergeWorksheetSection(
  sheet: WorksheetDefinition,
  id: string,
  direction: -1 | 1,
): WorksheetDefinition {
  const sections = sheet.sections ?? [];
  const index = sections.findIndex((s) => s.id === id);
  const destination = sections[index + direction];
  if (index < 0 || !destination) return sheet;
  return {
    ...sheet,
    sections: sections.filter((s) => s.id !== id),
    fields: sheet.fields.map((field) =>
      field.sectionId === id
        ? { ...field, sectionId: destination.id, section: destination.title }
        : field,
    ),
  };
}
