import type { Deck } from "./model";
import { parseWorksheet } from "./worksheets";
import type { WorksheetDefinition, WorksheetField } from "./worksheets";
import type { SurveyBinding } from "./surveyBinding";

/**
 * Form adoption: a deck copied or loaded from a file can carry worksheet /
 * survey bindings that still point at the deck they were created in. Those
 * forms only accept answers inside their original deck, so when the deck is
 * saved to the cloud as a new work, the forms are re-registered under the
 * new deck and every binding is rewritten to the new registration.
 */

export interface ForeignWorksheet {
  /** `${deckId}:${worksheetId}` of the original binding. */
  key: string;
  sourceDeckId: string;
  sourceId: string;
  definition: WorksheetDefinition;
}

export interface ForeignSurvey {
  /** `${deckId}:${surveyId}` of the original binding. */
  key: string;
  sourceDeckId: string;
  sourceId: string;
  question: string;
  kind: SurveyBinding["kind"];
  options: string[];
}

export interface ForeignForms {
  worksheets: ForeignWorksheet[];
  surveys: ForeignSurvey[];
}

const keyOf = (deckId: string, id: string) => `${deckId}:${id}`;

export function collectForeignForms(
  deck: Deck,
  ownerDeckId: string,
): ForeignForms {
  const embedded = new Map<string, WorksheetDefinition>();
  const fieldsByKey = new Map<
    string,
    { sourceDeckId: string; sourceId: string; fields: WorksheetField[] }
  >();
  const surveys = new Map<string, ForeignSurvey>();
  const order: string[] = [];

  const noteSurvey = (binding: SurveyBinding) => {
    if (binding.deckId === ownerDeckId) return;
    const key = keyOf(binding.deckId, binding.surveyId);
    if (!surveys.has(key)) {
      surveys.set(key, {
        key,
        sourceDeckId: binding.deckId,
        sourceId: binding.surveyId,
        question: binding.question,
        kind: binding.kind,
        options: [...binding.options],
      });
      order.push(key);
    }
  };

  for (const slide of deck.slides)
    for (const element of slide.elements) {
      if (element.worksheet && element.worksheet.deckId !== ownerDeckId) {
        const binding = element.worksheet;
        const key = keyOf(binding.deckId, binding.worksheetId);
        if (!embedded.has(key)) {
          embedded.set(key, {
            title: binding.title,
            description: binding.description,
            fields: binding.fields,
            ...(binding.sections ? { sections: binding.sections } : {}),
            ...(binding.fontSize !== undefined
              ? { fontSize: binding.fontSize }
              : {}),
            ...(binding.modalLayout !== undefined
              ? { modalLayout: binding.modalLayout }
              : {}),
          });
          if (!fieldsByKey.has(key)) {
            fieldsByKey.set(key, {
              sourceDeckId: binding.deckId,
              sourceId: binding.worksheetId,
              fields: [],
            });
            order.push(key);
          }
        }
      }
      const field = element.responseField;
      if (field?.source === "worksheet" && field.deckId !== ownerDeckId) {
        const key = keyOf(field.deckId, field.worksheetId);
        let group = fieldsByKey.get(key);
        if (!group) {
          group = {
            sourceDeckId: field.deckId,
            sourceId: field.worksheetId,
            fields: [],
          };
          fieldsByKey.set(key, group);
          order.push(key);
        }
        if (!group.fields.some((f) => f.id === field.field.id))
          group.fields.push(field.field);
      } else if (field?.source === "survey") noteSurvey(field);
      if (element.survey) noteSurvey(element.survey);
    }

  const worksheets: ForeignWorksheet[] = [];
  let unnamed = 0;
  for (const key of order) {
    const group = fieldsByKey.get(key);
    if (!group) continue;
    const definition = embedded.get(key) ?? {
      title: unnamed === 0 ? "ワークシート" : `ワークシート${unnamed + 1}`,
      description: "",
      fields: group.fields,
    };
    if (!embedded.has(key)) unnamed++;
    try {
      worksheets.push({
        key,
        sourceDeckId: group.sourceDeckId,
        sourceId: group.sourceId,
        definition: parseWorksheet(definition),
      });
    } catch {
      // A binding whose snapshot no longer validates stays a static
      // preview, exactly as before adoption existed.
    }
  }
  return {
    worksheets,
    surveys: order
      .filter((key) => surveys.has(key))
      .map((key) => surveys.get(key)!),
  };
}

/**
 * Returns a deck whose form bindings point at `ownerDeckId` and at the
 * re-registered form ids in `worksheetIds` / `surveyIds` (keyed by the
 * original `${deckId}:${id}`). Bindings without a mapping are kept as-is.
 */
export function rewriteFormBindings(
  deck: Deck,
  ownerDeckId: string,
  worksheetIds: Map<string, string>,
  surveyIds: Map<string, string>,
): Deck {
  let changed = false;
  const slides = deck.slides.map((slide) => {
    let slideChanged = false;
    const elements = slide.elements.map((element) => {
      let next = element;
      if (next.surveyResult) {
        const mapped = surveyIds.get(
          keyOf(next.surveyResult.deckId, next.surveyResult.surveyId),
        );
        if (mapped) {
          next = {
            ...next,
            surveyResult: {
              ...next.surveyResult,
              deckId: ownerDeckId,
              surveyId: mapped,
            },
          };
          slideChanged = true;
        }
      }
      if (next.worksheetResult) {
        const mapped = worksheetIds.get(
          keyOf(next.worksheetResult.deckId, next.worksheetResult.worksheetId),
        );
        if (mapped) {
          next = {
            ...next,
            worksheetResult: {
              ...next.worksheetResult,
              deckId: ownerDeckId,
              worksheetId: mapped,
            },
          };
          slideChanged = true;
        }
      }
      if (next.worksheet) {
        const mapped = worksheetIds.get(
          keyOf(next.worksheet.deckId, next.worksheet.worksheetId),
        );
        if (mapped) {
          next = {
            ...next,
            worksheet: {
              ...next.worksheet,
              deckId: ownerDeckId,
              worksheetId: mapped,
            },
          };
          slideChanged = true;
        }
      }
      const field = next.responseField;
      if (field?.source === "worksheet") {
        const mapped = worksheetIds.get(keyOf(field.deckId, field.worksheetId));
        if (mapped) {
          next = {
            ...next,
            responseField: {
              ...field,
              deckId: ownerDeckId,
              worksheetId: mapped,
            },
          };
          slideChanged = true;
        }
      } else if (field?.source === "survey") {
        const mapped = surveyIds.get(keyOf(field.deckId, field.surveyId));
        if (mapped) {
          next = {
            ...next,
            responseField: { ...field, deckId: ownerDeckId, surveyId: mapped },
          };
          slideChanged = true;
        }
      }
      if (next.survey) {
        const mapped = surveyIds.get(
          keyOf(next.survey.deckId, next.survey.surveyId),
        );
        if (mapped) {
          next = {
            ...next,
            survey: { ...next.survey, deckId: ownerDeckId, surveyId: mapped },
          };
          slideChanged = true;
        }
      }
      return next;
    });
    if (slideChanged) changed = true;
    return slideChanged ? { ...slide, elements } : slide;
  });
  return changed ? { ...deck, slides } : deck;
}
