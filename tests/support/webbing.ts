import assert from "node:assert/strict";
import type { WebbingView } from "../../src/webbing.ts";
type Call = (
  path: string,
  method?: string,
  value?: unknown,
  cookie?: string,
  source?: string,
) => Promise<any>;
export async function exerciseWebbing(
  call: Call,
  id: string,
  otherDeck: string,
  owner: string,
  guest: string,
  stranger: string,
  restart: () => Promise<void>,
) {
  const base = `/api/decks/${id}/webbing`;
  const list = async (who = owner): Promise<WebbingView[]> => {
    const r = await call(base, "GET", undefined, who);
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).webbing;
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
  // Only the host creates maps; a draft is invisible to guests.
  await write("", { title: "将来の夢" }, guest, 403);
  await write("", { title: "" }, owner, 400);
  const created = await (await write("", { title: "将来の夢" })).json();
  const mapId: string = created.createdId;
  assert.ok(mapId);
  assert.deepEqual(await list(guest), []);
  const draft = (await list())[0];
  assert.equal(draft.status, "draft");
  assert.equal(draft.nodes.length, 1);
  const root = draft.nodes[0];
  assert.equal(root.parentId, null);
  assert.equal(root.text, "将来の夢");
  // Guests cannot write into a draft; the host opens reception first.
  await write(
    `/${mapId}/node-add`,
    { parentId: root.id, text: "宇宙飛行士", x: 300, y: 200 },
    guest,
    409,
  );
  await write(`/${mapId}/status`, { status: "open" }, guest, 403);
  await write(`/${mapId}/status`, { status: "open" });
  const added = await (
    await write(
      `/${mapId}/node-add`,
      { parentId: root.id, text: "宇宙飛行士", x: 300, y: 200 },
      guest,
    )
  ).json();
  const nodeId: string = added.createdId;
  assert.ok(nodeId);
  // The map id means nothing on another deck.
  assert.equal(
    (
      await call(
        `/api/decks/${otherDeck}/webbing/${mapId}/node-add`,
        "POST",
        { parentId: root.id, text: "x", x: 1, y: 1 },
        guest,
      )
    ).status,
    404,
  );
  // A guest cannot edit the host's theme node; the host can edit a guest's.
  await write(
    `/${mapId}/node-edit`,
    { nodeId: root.id, text: "書き換え" },
    guest,
    403,
  );
  await write(`/${mapId}/node-edit`, { nodeId, x: 320 }, owner);
  // While the author edits (holds the lock), even the host is blocked.
  await write(`/${mapId}/lock`, { nodeId }, guest);
  const lockedView = (await list(guest))[0];
  assert.equal(lockedView.locks.length, 1);
  assert.equal(lockedView.locks[0].userId.length > 0, true);
  await write(
    `/${mapId}/node-edit`,
    { nodeId, text: "上書き" },
    owner,
    409,
  );
  await write(`/${mapId}/node-edit`, { nodeId, text: "宇宙飛行士になる" }, guest);
  await write(`/${mapId}/unlock`, { nodeId }, guest);
  await write(`/${mapId}/node-edit`, { nodeId, text: "宇宙飛行士になる！" }, owner);
  // Deleting a branch removes its children too; guests cannot delete others'.
  const child = await (
    await write(
      `/${mapId}/node-add`,
      { parentId: nodeId, text: "小枝", x: 380, y: 260 },
      guest,
    )
  ).json();
  assert.ok(child.createdId);
  await write(`/${mapId}/node-delete`, { nodeId }, stranger, 404);
  await write(`/${mapId}/node-delete`, { nodeId: root.id }, owner, 400);
  await write(`/${mapId}/node-delete`, { nodeId }, owner);
  assert.equal((await list())[0].nodes.length, 1);
  // Content survives a restart; only the host deletes the map.
  await restart();
  const after = await list();
  assert.equal(after.length, 1);
  assert.equal(after[0].nodes.length, 1);
  await write(`/${mapId}`, {}, guest, 403, "DELETE");
  await write(`/${mapId}`, {}, owner, 200, "DELETE");
  assert.deepEqual(await list(), []);
}
