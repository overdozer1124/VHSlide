import type { Deck, Element } from "./model";
import type { FormDraft } from "./formEditing";
/** Refresh portable copies in all slides without including any answers. */
export function syncFormDefinitions(book: Deck, draft: FormDraft): Deck {
  let changed = false;
  const slides = book.slides.map((slide) => {
    let slideChanged = false;
    const elements = slide.elements.map((old): Element => {
      let next = old;
      if (draft.kind === "worksheet") {
        if (
          old.worksheet?.deckId === draft.deckId &&
          old.worksheet.worksheetId === draft.id
        )
          next = {
            ...next,
            worksheet: {
              ...old.worksheet,
              ...draft.value,
              fontSize: draft.value.fontSize,
              modalLayout: draft.value.modalLayout,
            },
          };
        if (
          old.responseField?.source === "worksheet" &&
          old.responseField.deckId === draft.deckId &&
          old.responseField.worksheetId === draft.id
        ) {
          const fieldId = old.responseField.field.id;
          const field = draft.value.fields.find((item) => item.id === fieldId);
          if (field)
            next = { ...next, responseField: { ...old.responseField, field } };
        }
      } else {
        if (
          old.survey?.deckId === draft.deckId &&
          old.survey.surveyId === draft.id
        )
          next = { ...next, survey: { ...old.survey, ...draft.value } };
        if (
          old.responseField?.source === "survey" &&
          old.responseField.deckId === draft.deckId &&
          old.responseField.surveyId === draft.id
        )
          next = {
            ...next,
            responseField: { ...old.responseField, ...draft.value },
          };
      }
      if (next !== old) {
        slideChanged = true;
        changed = true;
      }
      return next;
    });
    return slideChanged ? { ...slide, elements } : slide;
  });
  return changed ? { ...book, slides } : book;
}
