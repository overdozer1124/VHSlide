import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { backupSnapshot } from "../../src/backupData.ts";
import { blank } from "../../src/model.ts";

type Request = (
  path: string,
  method?: string,
  value?: unknown,
  cookie?: string,
  headers?: Record<string, string>,
) => Promise<any>;
export async function exerciseBackupProtocol(
  request: Request,
  owner: string,
  guest: string,
  restart: () => Promise<void>,
  changeSlide: (id: string) => Promise<void>,
) {
  const call = (
    path: string,
    method = "GET",
    value?: unknown,
    cookie = owner,
    headers?: Record<string, string>,
  ) => request(path, method, value, cookie, headers);
  const get = async (path: string) => {
    const r = await call(path);
    assert.equal(r.status, 200, await r.clone().text());
    return await r.json();
  };
  const input = {
    title: "再開試験",
    key: "a".repeat(64),
    contentHash: "a".repeat(64),
    applySharing: false,
  };
  const created = await Promise.all([
    call("/api/restores", "POST", input),
    call("/api/restores", "POST", input),
  ]);
  assert.deepEqual(created.map((r) => r.status).sort(), [200, 201]);
  const [a, b] = await Promise.all(created.map((r) => r.json()));
  assert.equal(a.id, b.id);
  const id = a.id;
  assert.equal(
    (await call(`/api/restores/${id}`, "GET", undefined, guest)).status,
    404,
  );
  assert.equal((await get(`/api/restores/${id}`)).status, "uploading");
  assert.ok((await get("/api/restores")).jobs.some((j: any) => j.id === id));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  const digest = createHash("sha256").update(png).digest("hex");
  const upload = () =>
    call(`/api/decks/${id}/assets`, "POST", png, owner, {
      "X-Restore-Image": digest,
    });
  const photos = await Promise.all([upload(), upload()]);
  for (const p of photos) assert.equal(p.status, 201, await p.clone().text());
  const [p1, p2] = await Promise.all(photos.map((p) => p.json()));
  assert.equal(p1.src, p2.src);
  assert.equal((await get(`/api/restores/${id}`)).images, 1);
  assert.equal(
    (
      await call(`/api/decks/${id}/assets`, "POST", png, owner, {
        "X-Restore-Image": "f".repeat(64),
      })
    ).status,
    400,
  );
  // Reserved job, bytes and session survive a runtime restart before finalization.
  await restart();
  assert.equal((await get(`/api/restores/${id}`)).status, "uploading");
  assert.equal((await get(`/api/restores/${id}`)).images, 1);
  const replay = await call("/api/restores", "POST", input);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).id, id);
  assert.equal((await (await upload()).json()).src, p1.src);
  const slide = blank(0, 0);
  slide.elements.push({
    id: "photo",
    type: "image",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    src: p1.src,
  });
  const snapshot = backupSnapshot(
    { version: 1, title: "再開試験", slides: [slide] },
    [
      {
        id: "n",
        slide: slide.id,
        author: "old",
        name: "元の投稿者",
        text: "付箋",
        x: 0.2,
        y: 0.3,
        created: 1,
      },
    ],
    [],
    [],
  );
  const body = { snapshot, applySharing: false };
  // Only the response is lost; the committed result is discoverable by job ID.
  const committed = await call(`/api/decks/${id}/restore`, "POST", body);
  assert.equal(committed.status, 200);
  await committed.arrayBuffer();
  assert.equal((await get(`/api/restores/${id}`)).status, "ready");
  const notes = (await get(`/api/decks/${id}/comments`)).comments;
  assert.equal(notes.length, 1);
  assert.equal((await call(`/api/decks/${id}/restore`, "DELETE")).status, 409);
  await restart();
  const finish = await call(`/api/decks/${id}/restore`, "POST", body);
  assert.equal(finish.status, 200);
  assert.equal((await finish.json()).id, id);
  assert.deepEqual((await get(`/api/decks/${id}/comments`)).comments, notes);
  assert.equal((await get(`/api/restores/${id}`)).images, 1);
  const fromOtherTab = await call("/api/restores", "POST", {
    ...input,
    key: "b".repeat(64),
  });
  assert.equal((await fromOtherTab.json()).id, id);
  const another = await call("/api/restores", "POST", {
    ...input,
    key: "c".repeat(64),
    contentHash: "b".repeat(64),
  });
  assert.equal(another.status, 201);
  const anotherId = (await another.json()).id;
  assert.equal(
    (
      await call("/api/restores", "POST", {
        ...input,
        contentHash: "b".repeat(64),
      })
    ).status,
    409,
    "existing idempotency key must win over another content match",
  );
  assert.equal(
    (await call(`/api/decks/${anotherId}/restore`, "DELETE")).status,
    200,
  );
  assert.equal((await get(`/api/restores/${anotherId}`)).status, "cancelled");
  let backed = await get(`/api/decks/${id}/backup`);
  const verify = (checkpoint: unknown) =>
    call(`/api/decks/${id}/backup/verify`, "POST", { checkpoint });
  assert.equal((await verify(backed.checkpoint)).status, 200);
  assert.ok(
    (
      await call(
        `/api/decks/${id}/backup/verify`,
        "POST",
        { checkpoint: backed.checkpoint },
        guest,
      )
    ).status >= 400,
  );
  await changeSlide(id);
  assert.equal(
    (await verify(backed.checkpoint)).status,
    409,
    "Yjs changes invalidate the checkpoint",
  );
  backed = await get(`/api/decks/${id}/backup`);
  const access = {
    mode: "none",
    comment: true,
    rows: [],
    columns: [],
    slides: [],
  };
  assert.equal(
    (
      await call(`/api/decks/${id}/recipients`, "POST", {
        recipients: [{ email: "pending@example.test", access }],
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(`/api/decks/${id}/recipients/pending%40example.test`, "DELETE"))
      .status,
    200,
  );
  assert.equal(
    (await verify(backed.checkpoint)).status,
    409,
    "sharing ABA must invalidate checkpoint",
  );
  backed = await get(`/api/decks/${id}/backup`);
  const note = (await get(`/api/decks/${id}/comments`)).comments[0];
  assert.equal(
    (
      await call(`/api/decks/${id}/comments/${note.id}`, "PUT", {
        ...note,
        text: "変更",
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(`/api/decks/${id}/comments/${note.id}`, "PUT", note)).status,
    200,
  );
  assert.equal(
    (await verify(backed.checkpoint)).status,
    409,
    "note ABA must invalidate checkpoint",
  );
  backed = await get(`/api/decks/${id}/backup`);
  await restart();
  const afterRestart = await get(`/api/decks/${id}/backup`);
  for (const part of ["directory", "room"])
    assert.ok(
      BigInt(afterRestart.checkpoint[part]) >= BigInt(backed.checkpoint[part]),
      "restart must never reset revisions",
    );
  assert.equal((await verify(afterRestart.checkpoint)).status, 200);
  // Both possible serialization orders are safe, without requiring a scheduler-specific winner.
  const race = await call("/api/restores", "POST", {
      ...input,
      key: "d".repeat(64),
      contentHash: "c".repeat(64),
    }),
    raceId = (await race.json()).id;
  const empty = backupSnapshot(
    { version: 1, title: "競合", slides: [blank(0, 0)] },
    [],
    [],
    [],
  );
  const [cancel, finalize] = await Promise.all([
    call(`/api/decks/${raceId}/restore`, "DELETE"),
    call(`/api/decks/${raceId}/restore`, "POST", {
      snapshot: empty,
      applySharing: false,
    }),
  ]);
  if (finalize.status === 200) {
    assert.equal(cancel.status, 409);
    assert.equal((await get(`/api/restores/${raceId}`)).status, "ready");
  } else {
    assert.equal(cancel.status, 200);
    assert.ok([404, 409].includes(finalize.status));
    assert.equal((await get(`/api/restores/${raceId}`)).status, "cancelled");
  }
  assert.equal(
    (await get(`/api/restores/${id}`)).status,
    "ready",
    "unrelated completed work survives cancellation",
  );
}
