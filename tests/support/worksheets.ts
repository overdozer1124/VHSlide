import { blank } from "../../src/model.ts";
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
export async function exerciseWorksheets(
  call: Call,
  id: string,
  other: string,
  owner: string,
  guest: string,
  stranger: string,
  restart: () => Promise<void>,
) {
  const base = `/api/decks/${id}/worksheets`;
  const definition: WorksheetDefinition = {
    title: "朝食の工夫",
    description: "資料から考える",
    fields: [
      {
        id: "reason",
        label: "理由",
        kind: "text",
        options: [],
        placeholder: "例",
        section: "考えよう",
        wide: true,
      },
      {
        id: "check",
        label: "朝食",
        kind: "checkbox",
        options: [],
        placeholder: "",
        section: "",
        wide: false,
      },
      {
        id: "choice",
        label: "目標",
        kind: "single",
        options: ["朝", "夜"],
        placeholder: "",
        section: "",
        wide: false,
      },
    ],
  };
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
    method = "POST",
  ) => {
    const r = await call(base + path, method, value, who);
    assert.equal(r.status, status, await r.clone().text());
    return r;
  };
  assert.equal((await call(base, "GET", undefined, "")).status, 401);
  assert.equal((await call(base, "GET", undefined, stranger)).status, 404);
  await post("", definition, guest, 403);
  await post("", { ...definition, fields: [] }, owner, 400);
  await post("", definition);
  const sheet = (await list())[0];
  assert.deepEqual(await list(guest), []);
  await post(`/${sheet.id}/status`, { status: "open" }, guest, 403);
  await post(`/${sheet.id}/answer`, { values: {} }, guest, 409);
  await post(`/${sheet.id}/status`, { status: "open" });
  await post(`/${sheet.id}/answer`, { values: {} }, guest);
  await post(`/${sheet.id}/answer`, { values: { check: "yes" } }, guest, 400);
  await post(
    `/${sheet.id}/answer`,
    { values: { reason: "あ".repeat(2001) } },
    guest,
    400,
  );
  await post(
    `/${sheet.id}/answer`,
    { values: { foreign: "secret" } },
    guest,
    400,
  );
  await post(`/${sheet.id}/answer`, { values: { choice: [0, 1] } }, guest, 400);
  await post(
    `/${sheet.id}/answer`,
    {
      values: { reason: '<script>日本語,"花"\n次', check: true, choice: [1] },
      author: "forged",
      name: "forged",
    },
    guest,
  );
  await post(
    `/${sheet.id}/answer`,
    { values: { reason: "ホストの考え" } },
    owner,
  );
  let host = (await list())[0];
  assert.equal(host.results!.responses.length, 2);
  const identity = (
    await (await call("/api/session", "GET", undefined, guest)).json()
  ).user;
  const answer = host.results!.responses.find(
    (r) => r.respondentId === identity.id,
  )!;
  assert.equal(answer.name, identity.name);
  assert.equal(answer.email, identity.email);
  assert.equal(answer.values.check, true);
  assert.equal(answer.values.reason, '<script>日本語,"花"\n次');
  assert.deepEqual(answer.values.choice, [1]);
  const own = (await list(guest))[0];
  assert.ok(!("results" in own));
  assert.equal(own.own!.respondentId, identity.id);
  assert.equal(JSON.stringify(own).includes("ホストの考え"), false);
  assert.equal(
    (
      await call(
        `/api/decks/${other}/worksheets/${sheet.id}/answer`,
        "POST",
        { values: {} },
        owner,
      )
    ).status,
    404,
  );
  assert.equal(
    (await call(base, "POST", definition, owner, "http://evil.test")).status,
    403,
  );
  await restart();
  host = (await list())[0];
  assert.equal(host.results!.responses.length, 2);
  assert.equal(
    host.results!.responses.find((r) => r.respondentId === identity.id)!.values
      .check,
    true,
  );
  // Independent free fields patch the same response without erasing other fields.
  await post(
    `/${sheet.id}/answer`,
    { patch: true, values: { reason: "自動保存した理由" } },
    guest,
  );
  await post(
    `/${sheet.id}/answer`,
    { patch: true, values: { choice: [0] } },
    guest,
  );
  const patched = (await list(guest))[0].own!.values;
  assert.equal(patched.reason, "自動保存した理由");
  assert.equal(patched.check, true);
  assert.deepEqual(patched.choice, [0]);
  const added = { ...definition.fields[0], id: "newfield", label: "追加欄" };
  await post(`/${sheet.id}/field`, { field: added }, guest, 403);
  await post(`/${sheet.id}/field`, { field: added });
  assert.equal((await list(guest))[0].own!.values.reason, "自動保存した理由");
  const slide = blank(0, 0);
  slide.elements = [
    {
      id: crypto.randomUUID(),
      type: "shape",
      shape: "rect",
      x: 20,
      y: 20,
      w: 400,
      h: 200,
      fill: "none",
      stroke: "#000000",
      text: "理由",
      fontSize: 20,
      responseField: {
        source: "worksheet",
        deckId: id,
        worksheetId: sheet.id,
        field: definition.fields[0],
        showLabel: true,
      },
    },
  ];
  const galleryPath = `/api/decks/${id}/gallery`;
  const galleryCall = async (
    action: string,
    who = owner,
    body: unknown = { slide },
    status = 200,
  ) => {
    const r = await call(
      galleryPath + action,
      action ? "POST" : "GET",
      action ? body : undefined,
      who,
    );
    assert.equal(r.status, status, await r.clone().text());
    return status === 200 ? (await r.json()).gallery : null;
  };
  assert.equal(await galleryCall("", guest), null);
  await galleryCall("/preview", guest, { slide }, 403);
  const preview = await galleryCall("/preview");
  assert.equal(preview.cards.length, 2);
  assert.ok(preview.cards.some((c: any) => c.email === identity.email));
  assert.equal(await galleryCall("", guest), null); // Preview never publishes.
  await galleryCall("/publish", owner, { slide, participants: [identity.id] });
  const snapshot = await galleryCall("", guest);
  assert.equal(snapshot.cards.length, 1);
  assert.equal(snapshot.cards[0].name, "回答 1");
  // A second slide can be published independently; guest reads stay anonymous.
  const secondSlide = structuredClone(slide);
  secondSlide.id = crypto.randomUUID();
  secondSlide.title = "別の回答スライド";
  const addSecond = await call(
    galleryPath + "/publish",
    "POST",
    { slide: secondSlide, append: true, live: true },
    owner,
  );
  assert.equal(addSecond.status, 200);
  let shared = await (await call(galleryPath, "GET", undefined, guest)).json();
  assert.equal(shared.galleries.length, 2);
  assert.ok(!JSON.stringify(shared).includes(identity.email));
  assert.ok(!JSON.stringify(shared).includes(identity.id));
  await post(
    `/${sheet.id}/answer`,
    { patch: true, values: { reason: "複数共有中の更新" } },
    guest,
  );
  shared = await (await call(galleryPath, "GET", undefined, guest)).json();
  assert.equal(
    shared.galleries[0].cards[0].worksheets[0].own.values.reason,
    "自動保存した理由",
  );
  assert.ok(
    shared.galleries[1].cards.some(
      (card: any) =>
        card.worksheets[0].own?.values.reason === "複数共有中の更新",
    ),
  );
  await post(
    `/${sheet.id}/answer`,
    { patch: true, values: { reason: "自動保存した理由" } },
    guest,
  );
  const forbiddenStop = await call(
    galleryPath + "/stop",
    "POST",
    { slideId: slide.id },
    guest,
  );
  assert.equal(forbiddenStop.status, 403);
  await restart();
  shared = await (await call(galleryPath, "GET", undefined, guest)).json();
  assert.equal(shared.galleries.length, 2);
  const stopSecond = await call(
    galleryPath + "/stop",
    "POST",
    { slideId: secondSlide.id },
    owner,
  );
  assert.equal(stopSecond.status, 200);
  shared = await (await call(galleryPath, "GET", undefined, guest)).json();
  assert.equal(shared.galleries.length, 1);
  assert.equal(shared.galleries[0].slide.id, slide.id);
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes(identity.email));
  assert.ok(!serialized.includes(identity.id));
  assert.ok(!serialized.includes('"check":'));
  assert.ok(!serialized.includes('"choice":'));
  await post(
    `/${sheet.id}/answer`,
    { patch: true, values: { reason: "更新された回答" } },
    guest,
  );
  assert.equal(
    (await galleryCall("", guest)).cards[0].worksheets[0].own.values.reason,
    "自動保存した理由",
  );
  await galleryCall("/publish", owner, {
    slide,
    participants: [identity.id],
    names: true,
    live: true,
  });
  await post(
    `/${sheet.id}/answer`,
    { patch: true, values: { reason: "再更新" } },
    guest,
  );
  const liveGallery = await galleryCall("", guest);
  assert.equal(liveGallery.cards[0].name, identity.name);
  assert.equal(liveGallery.cards[0].worksheets[0].own.values.reason, "再更新");
  await galleryCall("/stop", guest, {}, 403);
  await restart();
  assert.equal((await galleryCall("", guest)).cards.length, 1);
  await galleryCall("/stop");
  assert.equal(await galleryCall("", guest), null);
  // Anonymous IDs and display numbers survive a newly saved participant and restart.
  await post("", {
    title: "匿名ID固定",
    description: "",
    fields: [definition.fields[0]],
  });
  const future = (await list()).find((s) => s.title === "匿名ID固定")!;
  await post(`/${future.id}/status`, { status: "open" });
  await post(
    `/${future.id}/answer`,
    { values: { reason: "先に回答した参加者" } },
    guest,
  );
  const futureSlide = structuredClone(slide);
  futureSlide.elements[0].responseField = {
    source: "worksheet",
    deckId: id,
    worksheetId: future.id,
    field: definition.fields[0],
    showLabel: true,
  };
  const initial = await galleryCall("/publish", owner, {
    slide: futureSlide,
    live: true,
  });
  const before = initial.cards[0];
  await post(
    `/${future.id}/answer`,
    { values: { reason: "後から回答したホスト" } },
    owner,
  );
  await restart();
  const expanded = await galleryCall("", guest);
  assert.equal(expanded.cards.length, 2);
  const retained = expanded.cards.find(
    (c: any) => c.worksheets[0].own.values.reason === "先に回答した参加者",
  );
  assert.equal(retained.id, before.id);
  assert.equal(retained.name, before.name);
  assert.notEqual(retained.id, identity.id);
  await galleryCall("/stop");
  await post(`/${future.id}`, undefined, owner, 200, "DELETE");
  await post(`/${sheet.id}/status`, { status: "closed" });
  await post(`/${sheet.id}/answer`, { values: {} }, guest, 409);
  await post(`/${sheet.id}`, undefined, guest, 403, "DELETE");
  await call(
    `/api/decks/${id}/members/${identity.id}`,
    "DELETE",
    undefined,
    owner,
  );
  assert.equal((await call(base, "GET", undefined, guest)).status, 404);
  await post(`/${sheet.id}/answer`, { values: {} }, guest, 404);
  assert.equal((await list())[0].results!.responses.length, 2);
  await post(`/${sheet.id}`, undefined, owner, 200, "DELETE");
  assert.deepEqual(await list(), []);
}
