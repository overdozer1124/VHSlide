import assert from "node:assert/strict";
import type { ThinkingView } from "../../src/thinkingTools.ts";
type Call = (
  path: string,
  method?: string,
  value?: unknown,
  cookie?: string,
  source?: string,
) => Promise<any>;

const AXIS = {
  title: "賛成と自信",
  xMin: "反対",
  xMax: "賛成",
  yMin: "自信がない",
  yMax: "自信がある",
  scenes: [
    { id: "s1", label: "読む前" },
    { id: "s2", label: "話し合いの後" },
  ],
  reason: true,
};

/**
 * Thinking tools (point kind): host-only management, per-scene points,
 * individual privacy, class lock behaviour, poll version integration and
 * durable restart. Runs against both servers.
 */
export async function exerciseThinking(
  call: Call,
  id: string,
  otherDeck: string,
  owner: string,
  guest: string,
  stranger: string,
  restart: () => Promise<void>,
) {
  const base = `/api/decks/${id}/thinking`;
  const list = async (who = owner): Promise<ThinkingView[]> => {
    const r = await call(base, "GET", undefined, who);
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).thinking;
  };
  const write = async (
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
  // Membership and authentication gates.
  assert.equal((await call(base, "GET", undefined, stranger)).status, 404);
  assert.equal((await call(base, "GET", undefined, "")).status, 401);
  assert.equal(
    (await call(`/api/decks/${otherDeck}/thinking`, "GET", undefined, guest))
      .status,
    404,
  );
  // Only the host creates tools; definitions are validated.
  await write(
    "",
    { template: "axis2", unit: "individual", definition: AXIS },
    guest,
    403,
  );
  await write(
    "",
    { template: "axis2", unit: "individual", definition: { title: "x" } },
    owner,
    400,
  );
  const created = await (
    await write("", {
      template: "axis2",
      unit: "individual",
      definition: AXIS,
    })
  ).json();
  const toolId: string = created.createdId;
  assert.ok(toolId);
  // A draft is invisible to guests and takes no points.
  assert.deepEqual(await list(guest), []);
  await write(
    `/${toolId}/point`,
    { scene: "s1", value: { x: 0.5, y: 0.5 } },
    guest,
    409,
  );
  await write(`/${toolId}/status`, { status: "open" }, guest, 403);
  await write(`/${toolId}/status`, { status: "open" });
  // The guest places a point in the current (first) scene.
  await write(`/${toolId}/point`, {
    scene: "s1",
    value: { x: 0.25, y: 0.75 },
    reason: "たぶん賛成",
  }, guest);
  const guestsView = await list(guest);
  assert.equal(guestsView.length, 1);
  assert.equal(guestsView[0].points.length, 1);
  assert.deepEqual(guestsView[0].points[0].value, { x: 0.25, y: 0.75 });
  assert.equal(guestsView[0].points[0].reason, "たぶん賛成");
  // Teacher scene mode: the second scene refuses student writes until
  // the host switches; the host sees every point.
  await write(
    `/${toolId}/point`,
    { scene: "s2", value: { x: 0.5, y: 0.5 } },
    guest,
    409,
  );
  await write(`/${toolId}/scene`, { scene: "s2" }, guest, 403);
  await write(`/${toolId}/scene`, { scene: "s2" });
  await write(`/${toolId}/point`, {
    scene: "s2",
    value: { x: 0.9, y: 0.9 },
  }, guest);
  assert.equal((await list())[0].points.length, 2);
  // Bad values are rejected.
  await write(
    `/${toolId}/point`,
    { scene: "s2", value: { x: 2, y: 0.5 } },
    guest,
    400,
  );
  // The poll carries the thinking version: empty asks for the list, the
  // returned version suppresses it.
  const poll1 = await (
    await call(`/api/decks/${id}/poll?tv=`, "GET", undefined, owner)
  ).json();
  assert.equal(typeof poll1.thinking.version, "number");
  assert.equal(poll1.thinking.thinking.length, 1);
  const poll2 = await (
    await call(
      `/api/decks/${id}/poll?tv=${poll1.thinking.version}`,
      "GET",
      undefined,
      owner,
    )
  ).json();
  assert.equal(poll2.thinking, undefined);
  // Class unit: one shared point; the lock keeps a second writer out and
  // only the author (or host) clears it.
  const classCreated = await (
    await write("", {
      template: "axis1",
      unit: "class",
      definition: { title: "気持ち", xMin: "いや", xMax: "よい" },
    })
  ).json();
  const classId: string = classCreated.createdId;
  await write(`/${classId}/status`, { status: "open" });
  await write(`/${classId}/point`, { scene: "", value: { v: 0.4 } });
  await write(
    `/${classId}/point`,
    { scene: "", value: { v: 0.8 } },
    guest,
    409,
  );
  await write(`/${classId}/clear`, { scene: "" }, guest, 403);
  await write(`/${classId}/clear`, { scene: "" });
  assert.equal(
    (await list()).find((t) => t.id === classId)?.points.length,
    0,
  );
  // Data survives a restart.
  await restart();
  const after = await list();
  assert.equal(after.length, 2);
  assert.equal(
    after.find((t) => t.id === toolId)?.points.length,
    2,
  );
  // Deleting is host-only and removes the tool.
  await write(`/${classId}`, {}, guest, 403, "DELETE");
  await write(`/${classId}`, {}, owner, 200, "DELETE");
  assert.equal((await list()).length, 1);
}
