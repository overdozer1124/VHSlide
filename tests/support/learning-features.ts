import { acceptAndApprove } from "./join-approval.ts";
import assert from "node:assert/strict";
import { backupSnapshot } from "../../src/backupData.ts";
import { blank } from "../../src/model.ts";
type Call = (
  path: string,
  method?: string,
  value?: any,
  cookie?: string,
) => Promise<any>;
export async function exerciseLearningFeatures(
  call: Call,
  owner: string,
  guest: string,
  restart: () => Promise<void>,
  removeSlide: (id: string) => Promise<void>,
) {
  const before = {
    version: 1,
    title: "版とごみ箱",
    slides: [blank(0, 0), blank(0, 1)],
    routes: [{ id: "route", name: "保存されたルート", slides: [] as string[] }],
  };
  before.routes[0].slides = before.slides.map((s) => s.id);
  const created = await call("/api/decks", "POST", before, owner);
  assert.equal(created.status, 201, await created.clone().text());
  const { id } = await created.json();
  const req = (p: string, m = "GET", v?: any, c = owner) => call(p, m, v, c);
  const get = async (p: string) => {
    const r = await req(p);
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  const invite = await (await req(`/api/decks/${id}/invite`, "POST")).json();
  const token = invite.token ?? new URL(invite.url).searchParams.get("join");
  await acceptAndApprove(req, id, token, guest, owner);
  for (const m of ["GET", "POST"])
    assert.equal(
      (
        await req(
          `/api/decks/${id}/history`,
          m,
          m === "POST" ? { label: "不正" } : undefined,
          guest,
        )
      ).status,
      404,
    );
  assert.equal(
    (await req(`/api/decks/${id}/trash`, "POST", undefined, guest)).status,
    404,
  );
  assert.equal(
    (await req(`/api/decks/${id}/history`, "POST", { label: "手動で保存" }))
      .status,
    200,
  );
  const first = (await get(`/api/decks/${id}/history`)).entries[0];
  const saved = (await get(`/api/decks/${id}/history/${first.id}`)).snapshot;
  assert.equal(saved.deck.routes[0].name, "保存されたルート");
  assert.equal(saved.sharing.length, 0);
  assert.equal(
    (await req(`/api/decks/${id}/history/${first.id}`, "GET", undefined, guest))
      .status,
    404,
  );
  await removeSlide(id);
  const deleted = (await get(`/api/decks/${id}/history`)).entries.find(
    (e: any) => e.reason === "削除する前",
  );
  assert.ok(deleted);
  assert.equal(
    (await get(`/api/decks/${id}/history/${deleted.id}`)).snapshot.deck.slides
      .length,
    2,
  );
  assert.equal((await get(`/api/decks/${id}/backup`)).deck.slides.length, 1);
  await restart();
  assert.equal(
    (await get(`/api/decks/${id}/history/${deleted.id}`)).snapshot.deck.slides
      .length,
    2,
  );
  for (let i = 0; i < 12; i++)
    assert.equal(
      (await req(`/api/decks/${id}/history`, "POST", { label: `版 ${i}` }))
        .status,
      200,
    );
  assert.equal((await get(`/api/decks/${id}/history`)).entries.length, 10);
  assert.equal((await req(`/api/decks/${id}/history/${first.id}`)).status, 404);
  assert.equal((await req(`/api/decks/${id}/trash`, "POST")).status, 200);
  assert.equal((await req(`/api/decks/${id}`)).status, 404);
  assert.equal((await req(`/api/decks/${id}/assets`, "POST")).status, 404);
  assert.equal(
    (await req(`/api/decks/${id}`, "GET", undefined, guest)).status,
    404,
  );
  assert.equal((await req(`/api/decks/${id}/history`)).status, 404);
  assert.ok(!(await get("/api/decks")).decks.some((d: any) => d.id === id));
  assert.ok((await get("/api/trash")).decks.some((d: any) => d.id === id));
  assert.ok(
    !(
      await (await req("/api/trash", "GET", undefined, guest)).json()
    ).decks.some((d: any) => d.id === id),
  );
  assert.equal(
    (await req(`/api/decks/${id}/untrash`, "POST", undefined, guest)).status,
    404,
  );
  assert.equal(
    (await req(`/api/invites/${token}/accept`, "POST", undefined, guest))
      .status,
    404,
  );
  await restart();
  assert.ok((await get("/api/trash")).decks.some((d: any) => d.id === id));
  assert.equal((await req(`/api/decks/${id}/untrash`, "POST")).status, 200);
  assert.equal(
    (await req(`/api/decks/${id}`, "GET", undefined, guest)).status,
    200,
  );
  assert.equal((await get(`/api/decks/${id}/history`)).entries.length, 10);
  assert.equal((await req(`/api/decks/${id}/trash`, "POST")).status, 200);
  assert.equal((await req(`/api/decks/${id}`, "DELETE")).status, 200);
  assert.ok(!(await get("/api/trash")).decks.some((d: any) => d.id === id));
  assert.equal((await req(`/api/decks/${id}/untrash`, "POST")).status, 404);
  const restoreInput = {
    title: "復元した作品",
    key: "d".repeat(64),
    contentHash: "e".repeat(64),
    applySharing: false,
  };
  const restored = await (
    await req("/api/restores", "POST", restoreInput)
  ).json();
  assert.equal(
    (
      await req(`/api/decks/${restored.id}/restore`, "POST", {
        snapshot: backupSnapshot(
          { version: 1, title: "復元した作品", slides: [blank(0, 0)] },
          [],
          [],
          [],
        ),
        applySharing: false,
      })
    ).status,
    200,
  );
  const intentional = { ...restoreInput, key: "c".repeat(64), newCopy: true };
  const copy = await req("/api/restores", "POST", intentional);
  assert.equal(copy.status, 201);
  const copied = await copy.json();
  assert.notEqual(copied.id, restored.id);
  assert.equal(
    (await (await req("/api/restores", "POST", intentional)).json()).id,
    copied.id,
  );
  assert.equal(
    (await req(`/api/decks/${copied.id}/restore`, "DELETE")).status,
    200,
  );
  assert.equal(
    (await req(`/api/decks/${restored.id}/trash`, "POST")).status,
    200,
  );
  assert.equal((await req("/api/restores", "POST", restoreInput)).status, 409);
  const next = await req("/api/restores", "POST", {
    ...restoreInput,
    key: "f".repeat(64),
  });
  assert.equal(next.status, 201);
  assert.notEqual((await next.json()).id, restored.id);
}
