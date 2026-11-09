import type { Deck } from "./model";
import { collectForeignForms, rewriteFormBindings } from "./formAdoption";
import { api } from "./cloud";

type Item = { id: string };
type Kind = "worksheets" | "surveys";

/** Stage imported forms as drafts until their pages are safely inserted. */
export async function prepareImportedForms(deck: Deck, destination: string) {
  const plan = collectForeignForms(deck, destination);
  const created: { kind: Kind; id: string }[] = [];
  const worksheets = new Map<string, string>();
  const surveys = new Map<string, string>();
  async function removeDrafts() {
    await Promise.allSettled(
      created.map(({ kind, id }) =>
        api(`/api/decks/${destination}/${kind}/${id}`, { method: "DELETE" }),
      ),
    );
  }
  try {
    const knownWorksheets = new Set(
      plan.worksheets.length
        ? (
            await api<{ worksheets: Item[] }>(
              `/api/decks/${destination}/worksheets`,
            )
          ).worksheets.map((x) => x.id)
        : [],
    );
    const knownSurveys = new Set(
      plan.surveys.length
        ? (
            await api<{ surveys: Item[] }>(`/api/decks/${destination}/surveys`)
          ).surveys.map((x) => x.id)
        : [],
    );
    for (const sheet of plan.worksheets) {
      const result = await api<{ worksheets: Item[] }>(
        `/api/decks/${destination}/worksheets`,
        { method: "POST", body: JSON.stringify(sheet.definition) },
      );
      const added = result.worksheets.filter((s) => !knownWorksheets.has(s.id));
      if (added.length !== 1)
        throw new Error("追加したワークシートを特定できませんでした。");
      created.push({ kind: "worksheets", id: added[0].id });
      result.worksheets.forEach((s) => knownWorksheets.add(s.id));
      worksheets.set(sheet.key, added[0].id);
    }
    for (const survey of plan.surveys) {
      const result = await api<{ surveys: Item[] }>(
        `/api/decks/${destination}/surveys`,
        {
          method: "POST",
          body: JSON.stringify({
            question: survey.question,
            kind: survey.kind,
            options: survey.options,
          }),
        },
      );
      const added = result.surveys.filter((s) => !knownSurveys.has(s.id));
      if (added.length !== 1)
        throw new Error("追加したアンケートを特定できませんでした。");
      created.push({ kind: "surveys", id: added[0].id });
      result.surveys.forEach((s) => knownSurveys.add(s.id));
      surveys.set(survey.key, added[0].id);
    }
    return {
      deck: rewriteFormBindings(deck, destination, worksheets, surveys),
      cleanup: removeDrafts,
      async activate() {
        const result = await Promise.allSettled(
          created.map(({ kind, id }) =>
            api(`/api/decks/${destination}/${kind}/${id}/status`, {
              method: "POST",
              body: JSON.stringify({ status: "open" }),
            }),
          ),
        );
        return result.filter((r) => r.status === "rejected").length;
      },
    };
  } catch (error) {
    await removeDrafts();
    throw error;
  }
}
