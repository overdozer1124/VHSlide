import assert from "node:assert/strict";
type Call = (
  path: string,
  method?: string,
  value?: unknown,
  cookie?: string,
  source?: string,
) => Promise<any>;

/** The combined deck poll: one request returns only the features whose
 * change counter moved since the versions the client sent. */
export async function exerciseDeckPoll(
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
  // Fixtures: one open worksheet with a text field, one open map.
  const created = await ok(`/api/decks/${id}/worksheets`, "POST", {
    title: "統合ポーリング",
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
  const mapCreated = await ok(`/api/decks/${id}/webbing`, "POST", {
    title: "統合マップ",
  }, owner);
  const mapId = mapCreated.createdId;
  assert.ok(mapId, "webbing create returns createdId");
  await ok(
    `/api/decks/${id}/webbing/${mapId}/status`,
    "POST",
    { status: "open" },
    owner,
  );

  const pollPath = (v: { wv?: string; mv?: string; gv?: string }) =>
    `/api/decks/${id}/poll?wv=${v.wv ?? ""}&mv=${v.mv ?? ""}&gv=${v.gv ?? ""}`;
  const poll = async (path: string, who = owner) => {
    const r = await call(path, "GET", undefined, who);
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };

  // Membership and authentication gates match the single-feature lists.
  assert.equal(
    (await call(pollPath({}), "GET", undefined, stranger)).status,
    404,
  );
  assert.equal((await call(pollPath({}), "GET", undefined, "")).status, 401);

  // First poll (no versions) returns every feature with its version.
  const first = await poll(pollPath({}));
  assert.ok(Array.isArray(first.worksheets.worksheets));
  assert.ok(Array.isArray(first.webbing.webbing));
  assert.ok(Array.isArray(first.groups.groups));
  const v = {
    wv: String(first.worksheets.version),
    mv: String(first.webbing.version),
    gv: String(first.groups.version),
  };

  // Nothing changed: the same versions come back as an empty object.
  assert.deepEqual(await poll(pollPath(v)), {});

  // A guest answer moves only the worksheets counter.
  await ok(
    `/api/decks/${id}/worksheets/${sheet.id}/answer`,
    "POST",
    { values: { memo: "統合ポーリングの回答" } },
    guest,
  );
  const afterAnswer = await poll(pollPath(v));
  assert.ok(afterAnswer.worksheets, "worksheets changed");
  assert.equal(afterAnswer.webbing, undefined);
  assert.equal(afterAnswer.groups, undefined);
  v.wv = String(afterAnswer.worksheets.version);

  // A webbing write moves only the webbing counter.
  const map = first.webbing.webbing.find((m: any) => m.id === mapId);
  const root = map.nodes.find((n: any) => n.parentId === null);
  await ok(
    `/api/decks/${id}/webbing/${mapId}/node-add`,
    "POST",
    { parentId: root.id, text: "統合ポーリングの枝", x: 200, y: 150 },
    guest,
  );
  const afterNode = await poll(pollPath(v));
  assert.ok(afterNode.webbing, "webbing changed");
  assert.equal(afterNode.worksheets, undefined);
  assert.equal(afterNode.groups, undefined);
  v.mv = String(afterNode.webbing.version);

  // Settled again.
  assert.deepEqual(await poll(pollPath(v)), {});
}
