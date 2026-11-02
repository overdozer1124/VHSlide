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
