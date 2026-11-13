import assert from "node:assert/strict";
type Call = (
  path: string,
  method?: string,
  value?: unknown,
  cookie?: string,
  source?: string,
) => Promise<any>;

/** Per-slide answer counts for the console rail: only slides with at
 * least one saved answer appear, matching the gallery preview's cards. */
export async function exerciseGalleryCounts(
  call: Call,
  id: string,
  owner: string,
  guest: string,
  stranger: string,
) {
  const ok = async (
    path: string,
    method: string,
    value: unknown,
    who: string,
  ) => {
    const r = await call(path, method, value, who);
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  const created = await ok(`/api/decks/${id}/worksheets`, "POST", {
    title: "件数テスト",
    description: "説明",
    fields: [
      {
        id: "memo",
        label: "メモ",
        kind: "text",
        options: [],
        placeholder: "",
        section: "",
        wide: true,
      },
    ],
  }, owner);
  const sheet = created.worksheets[0];
  await ok(
    `/api/decks/${id}/worksheets/${sheet.id}/status`,
    "POST",
    { status: "open" },
    owner,
  );
  const fieldSlide = {
    id: "slide-field",
    elements: [
      {
        responseField: {
          deckId: id,
          source: "worksheet",
          worksheetId: sheet.id,
          surveyId: "",
          field: { id: "memo" },
        },
      },
    ],
  };
  const sheetSlide = {
    id: "slide-sheet",
    elements: [
      {
        worksheet: {
          deckId: id,
          worksheetId: sheet.id,
          fields: [{ id: "memo" }],
        },
      },
    ],
  };
  const plainSlide = { id: "slide-plain", elements: [] };
  const counts = (who: string) =>
    call(
      `/api/decks/${id}/gallery/counts`,
      "POST",
      { slides: [fieldSlide, sheetSlide, plainSlide] },
      who,
    );

  // Host-only, members-only.
  assert.equal((await counts(stranger)).status, 404);
  assert.equal((await counts(guest)).status, 403);
  assert.equal((await counts("")).status, 401);

  // Nobody answered yet: no entries at all.
  assert.deepEqual((await (await counts(owner)).json()).counts, {});

  // One guest answer lights up both binding shapes for that worksheet.
  await ok(
    `/api/decks/${id}/worksheets/${sheet.id}/answer`,
    "POST",
    { values: { memo: "数えるための回答" } },
    guest,
  );
  assert.deepEqual((await (await counts(owner)).json()).counts, {
    "slide-field": 1,
    "slide-sheet": 1,
  });
}
