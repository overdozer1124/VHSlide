import assert from "node:assert/strict";
import type {
  WorksheetView,
  WorksheetDefinition,
} from "../../src/worksheets.ts";
type Call = (
  path: string,
  method?: string,
  value?: unknown,
  cookie?: string,
  source?: string,
) => Promise<any>;

/** Copying sections/fields between worksheets, and merging one
 * worksheet into another with its answers carried over. */
export async function exerciseWorksheetMerge(
  call: Call,
  id: string,
  other: string,
  owner: string,
  guest: string,
  stranger: string,
  restart: () => Promise<void>,
) {
  void other;
  void stranger;
  const base = `/api/decks/${id}/worksheets`;
  const list = async (who = owner): Promise<WorksheetView[]> => {
    const r = await call(base, "GET", undefined, who);
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).worksheets;
  };
  const post = async (
    path: string,
    value: unknown,
    who = owner,
    status = 200,
  ) => {
    const r = await call(base + path, "POST", value, who);
    assert.equal(r.status, status, await r.clone().text());
    return r;
  };
  const targetDef: WorksheetDefinition = {
    title: "統合先",
    description: "d",
    fields: [
      {
        id: "t1",
        label: "導入の考え",
        kind: "text",
        options: [],
        placeholder: "",
        section: "導入",
        wide: true,
      },
    ],
  };
  const sourceDef: WorksheetDefinition = {
    title: "統合元",
    description: "d",
    sections: [
      { id: "seca", title: "考えよう" },
      { id: "secb", title: "まとめ" },
    ],
    fields: [
      {
        id: "s1",
        label: "理由",
        kind: "text",
        options: [],
        placeholder: "",
        section: "考えよう",
        sectionId: "seca",
        wide: true,
      },
      {
        id: "s2",
        label: "目標",
        kind: "single",
        options: ["朝", "夜"],
        placeholder: "",
        section: "まとめ",
        sectionId: "secb",
        wide: false,
      },
      {
        id: "s3",
        label: "感想",
        kind: "text",
        options: [],
        placeholder: "",
        section: "まとめ",
        sectionId: "secb",
        wide: true,
      },
    ],
  };
  await post("", targetDef);
  await post("", sourceDef);
  const sheets = await list();
  const target = sheets.find((s) => s.title === "統合先")!;
  const source = sheets.find((s) => s.title === "統合元")!;
  await post(`/${target.id}/status`, { status: "open" });
  await post(`/${source.id}/status`, { status: "open" });
  await post(`/${target.id}/answer`, { values: { t1: "自分の導入" } }, guest);
  await post(
    `/${source.id}/answer`,
    { values: { s1: "理由です", s2: [1], s3: "感想です" } },
    guest,
  );

  // Gates: host only, distinct existing source.
  await post(`/${target.id}/copy`, { sourceId: source.id }, guest, 403);
  await post(`/${target.id}/merge`, { sourceId: source.id }, guest, 403);
  await post(
    `/${target.id}/copy`,
    { sourceId: "123e4567-e89b-42d3-a456-426614174000" },
    owner,
    404,
  );
  await post(`/${target.id}/copy`, { sourceId: target.id }, owner, 400);
  await post(`/${target.id}/merge`, { sourceId: target.id }, owner, 400);

  // Copy a single field: fresh id, section adopted by title, and the
  // target gains a sections list covering its existing field too.
  await post(`/${target.id}/copy`, { sourceId: source.id, fieldIds: ["s3"] });
  let t = (await list()).find((s) => s.id === target.id)!;
  assert.equal(t.fields.length, 2);
  const copied = t.fields.find((f) => f.label === "感想")!;
  assert.notEqual(copied.id, "s3");
  assert.equal(copied.section, "まとめ");
  const summary = t.sections!.find((s) => s.title === "まとめ")!;
  assert.equal(copied.sectionId, summary.id);
  assert.equal(
    t.fields.find((f) => f.id === "t1")!.sectionId,
    t.sections!.find((s) => s.title === "導入")!.id,
  );
  // Answers do not move with a copy.
  const guestCopy = t.results!.responses.find(
    (r) => r.values["t1"] === "自分の導入",
  )!;
  assert.ok(guestCopy);
  assert.notEqual(guestCopy.values[copied.id], "感想です");

  // Copy a whole section by its id.
  await post(`/${target.id}/copy`, {
    sourceId: source.id,
    sectionKeys: ["seca"],
  });
  t = (await list()).find((s) => s.id === target.id)!;
  assert.equal(t.fields.length, 3);
  const copiedReason = t.fields.find((f) => f.label === "理由")!;
  assert.notEqual(copiedReason.id, "s1");
  assert.equal(t.sections!.filter((s) => s.title === "考えよう").length, 1);

  // Merge a sheet whose field id collides with the target's: the
  // colliding field is remapped, the other keeps its id, and every
  // respondent's answers are carried over.
  const clashDef: WorksheetDefinition = {
    title: "衝突元",
    description: "d",
    fields: [
      {
        id: "t1",
        label: "別の導入",
        kind: "text",
        options: [],
        placeholder: "",
        section: "",
        wide: true,
      },
      {
        id: "s9",
        label: "追加分",
        kind: "text",
        options: [],
        placeholder: "",
        section: "",
        wide: true,
      },
    ],
  };
  await post("", clashDef);
  const clash = (await list()).find((s) => s.title === "衝突元")!;
  await post(`/${clash.id}/status`, { status: "open" });
  await post(
    `/${clash.id}/answer`,
    { values: { t1: "衝突側の回答", s9: "追加の回答" } },
    guest,
  );
  await post(`/${clash.id}/answer`, { values: { s9: "ホストの追加回答" } }, owner);
  await post(`/${target.id}/merge`, { sourceId: clash.id });
  let after = await list();
  assert.ok(!after.some((s) => s.id === clash.id));
  t = after.find((s) => s.id === target.id)!;
  assert.equal(t.fields.length, 5);
  assert.ok(t.fields.some((f) => f.id === "s9"));
  const remapped = t.fields.find((f) => f.label === "別の導入")!;
  assert.notEqual(remapped.id, "t1");
  const guestMerged = t.results!.responses.find(
    (r) => r.values["t1"] === "自分の導入",
  )!;
  assert.equal(guestMerged.values[remapped.id], "衝突側の回答");
  assert.equal(guestMerged.values["s9"], "追加の回答");
  assert.ok(
    t.results!.responses.some((r) => r.values["s9"] === "ホストの追加回答"),
  );

  // Merge the sectioned source: non-colliding ids are preserved, so
  // its answers land under their original keys.
  await post(`/${target.id}/merge`, { sourceId: source.id });
  await restart();
  after = await list();
  assert.ok(!after.some((s) => s.id === source.id));
  t = after.find((s) => s.id === target.id)!;
  assert.ok(t.fields.some((f) => f.id === "s1"));
  assert.ok(t.fields.some((f) => f.id === "s2"));
  const guestFinal = t.results!.responses.find(
    (r) => r.values["t1"] === "自分の導入",
  )!;
  assert.equal(guestFinal.values["s1"], "理由です");
  assert.deepEqual(guestFinal.values["s2"], [1]);
  assert.equal(guestFinal.values["s3"], "感想です");
}
