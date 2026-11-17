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
 * individual privacy, per-student class points, group sharing inside
 * the group only, permission denials for a second student (review
 * 🔴2), poll version integration and durable restart. Runs against
 * both servers. `guest2` is a second deck member; when empty, the
 * two-student denial checks are skipped.
 */
export async function exerciseThinking(
  call: Call,
  id: string,
  otherDeck: string,
  owner: string,
  guest: string,
  stranger: string,
  restart: () => Promise<void>,
  guest2 = "",
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
  // A second student never receives the first student's individual
  // points, and writing or clearing under someone else's owner is 403.
  if (guest2) {
    const othersView = await list(guest2);
    assert.equal(
      othersView.find((t) => t.id === toolId)?.points.length,
      0,
    );
    await write(
      `/${toolId}/point`,
      { scene: "s2", value: { x: 0.5, y: 0.5 }, owner: "another-student" },
      guest2,
      403,
    );
    await write(
      `/${toolId}/clear`,
      { scene: "s2", owner: "another-student" },
      guest2,
      403,
    );
  }
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
  // Class unit (review 🔴1): every student places their own point.
  // There is no shared point and no lock — a second writer is not
  // blocked, each participant receives only their own point with no
  // author identity attached, and the host receives everyone's points
  // with names for the distribution.
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
  await write(`/${classId}/point`, { scene: "", value: { v: 0.8 } }, guest);
  const guestClass = (await list(guest)).find((t) => t.id === classId);
  assert.equal(guestClass?.points.length, 1);
  assert.equal(guestClass?.points[0].value.v, 0.8);
  assert.equal(guestClass?.points[0].authorId, "");
  assert.equal(guestClass?.points[0].authorName, "");
  assert.equal(guestClass?.locks.length, 0);
  if (guest2) {
    const g2Class = (await list(guest2)).find((t) => t.id === classId);
    assert.equal(g2Class?.points.length, 0);
  }
  const hostClass = (await list()).find((t) => t.id === classId);
  assert.equal(hostClass?.points.length, 2);
  assert.ok(hostClass?.points.every((p) => p.authorName !== ""));
  // Clearing under someone else's owner is refused; your own clears.
  await write(
    `/${classId}/clear`,
    { scene: "", owner: "another-student" },
    guest,
    403,
  );
  await write(`/${classId}/clear`, { scene: "" }, guest);
  assert.equal(
    (await list()).find((t) => t.id === classId)?.points.length,
    1,
  );
  await write(`/${classId}/clear`, { scene: "" });
  assert.equal(
    (await list()).find((t) => t.id === classId)?.points.length,
    0,
  );
  // Group unit (review 🔴2): a point is shared inside its group only.
  // A student in no group sees nothing and cannot write; a student in
  // another group neither receives the point nor writes under its
  // owner, while same-group members see the author's name.
  const groupsBase = `/api/decks/${id}/groups`;
  const groupCall = async (
    path: string,
    value: unknown,
    who = owner,
    status = 200,
  ) => {
    const r = await call(groupsBase + path, "POST", value, who);
    assert.equal(r.status, status, await r.clone().text());
    return r;
  };
  await groupCall("", { names: ["1班", "2班"] });
  const groupView = await (
    await call(groupsBase, "GET", undefined, guest)
  ).json();
  const [g1, g2] = groupView.groups;
  const groupCreated = await (
    await write("", {
      template: "emotion",
      unit: "group",
      definition: { title: "班の気持ち", xMin: "いや", xMax: "よい" },
    })
  ).json();
  const groupToolId: string = groupCreated.createdId;
  await write(`/${groupToolId}/status`, { status: "open" });
  assert.equal(
    (await list(guest)).find((t) => t.id === groupToolId)?.points.length,
    0,
  );
  await write(
    `/${groupToolId}/point`,
    { scene: "", value: { v: 0.5 } },
    guest,
    409,
  );
  await groupCall("/join", { groupId: g1.id }, guest);
  if (guest2) await groupCall("/join", { groupId: g2.id }, guest2);
  await write(`/${groupToolId}/point`, { scene: "", value: { v: 0.3 } }, guest);
  const g1View = (await list(guest)).find((t) => t.id === groupToolId);
  assert.equal(g1View?.points.length, 1);
  assert.equal(g1View?.points[0].owner, g1.id);
  assert.notEqual(g1View?.points[0].authorName, "");
  if (guest2) {
    const g2View = (await list(guest2)).find((t) => t.id === groupToolId);
    assert.equal(g2View?.points.length, 0);
    await write(
      `/${groupToolId}/point`,
      { scene: "", value: { v: 0.9 }, owner: g1.id },
      guest2,
      403,
    );
    await write(`/${groupToolId}/point`, { scene: "", value: { v: 0.9 } }, guest2);
    assert.equal(
      (await list(guest2)).find((t) => t.id === groupToolId)?.points.length,
      1,
    );
  }
  // Data survives a restart.
  await restart();
  const after = await list();
  assert.equal(after.length, 3);
  assert.equal(
    after.find((t) => t.id === toolId)?.points.length,
    2,
  );
  // Deleting is host-only and removes the tool.
  await write(`/${classId}`, {}, guest, 403, "DELETE");
  await write(`/${classId}`, {}, owner, 200, "DELETE");
  assert.equal((await list()).length, 2);
}
