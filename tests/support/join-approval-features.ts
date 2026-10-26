import assert from "node:assert/strict";
import { sample } from "../../src/model.ts";
type Call = (
  path: string,
  method?: string,
  value?: any,
  cookie?: string,
) => Promise<any>;
export async function exerciseJoinApprovals(
  call: Call,
  owner: string,
  guests: string[],
  restart: () => Promise<void>,
) {
  const req = (p: string, m = "GET", v?: any, c = owner) => call(p, m, v, c);
  const data = async (p: string, c = owner) => {
    const r = await req(p, "GET", undefined, c);
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  const book = sample();
  book.title = "承認待ちの非公開作品";
  book.slides[0].elements.push({
    id: "photo-approval",
    type: "image",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  });
  const made = await req("/api/decks", "POST", book);
  assert.equal(made.status, 201);
  const { id } = await made.json();
  const state = await data(`/api/decks/${id}`);
  const { fromBase64, readSharedDeck } =
    await import("../../src/sharedDeck.ts");
  const Y = await import("yjs");
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(state.state));
  const photo = readSharedDeck(doc).slides[0].elements.find(
    (e) => e.id === "photo-approval",
  )!.src!;
  doc.destroy();
  const invitation = await req(`/api/decks/${id}/invite`, "POST"),
    token = new URL((await invitation.json()).url).searchParams.get("join");
  const ask = async (c: string, t = token) => {
    const r = await req(`/api/invites/${t}/accept`, "POST", undefined, c);
    return { status: r.status, data: await r.json() };
  };
  const a = await ask(guests[0]),
    b = await ask(guests[1]);
  assert.equal(a.status, 202);
  assert.equal(b.status, 202);
  assert.equal((await ask(guests[0])).data.requestId, a.data.requestId);
  for (const p of [
    `/api/decks/${id}`,
    photo,
    `/api/decks/${id}/comments`,
    `/api/decks/${id}/row-accounts`,
    `/api/decks/${id}/history`,
    `/api/decks/${id}/backup`,
    `/api/decks/${id}/live`,
  ])
    assert.equal((await req(p, "GET", undefined, guests[0])).status, 404, p);
  assert.equal(
    (await data("/api/decks", guests[0])).decks.some((d: any) => d.id === id),
    false,
  );
  assert.equal(
    (await data("/api/decks")).decks.find((d: any) => d.id === id)
      .pendingRequests,
    2,
  );
  assert.equal(
    (await req(`/api/decks/${id}/join-requests`, "GET", undefined, guests[0]))
      .status,
    404,
  );
  assert.equal(
    (
      await req(
        `/api/decks/${id}/join-requests/approve`,
        "POST",
        { requestIds: [a.data.requestId] },
        guests[0],
      )
    ).status,
    404,
  );
  const wrong = await data(`/api/join-requests/${a.data.requestId}`, guests[1]);
  assert.deepEqual(wrong, { status: "expired" });
  assert.equal(JSON.stringify(a.data).includes(id), false);
  await restart();
  assert.equal(
    (await data(`/api/join-requests/${a.data.requestId}`, guests[0])).status,
    "pending",
  );
  const initial = await data(`/api/decks/${id}/join-requests`);
  assert.equal(initial.requests.length, 2);
  assert.ok(initial.requests.every((r: any) => r.name && r.email));
  assert.equal(
    (
      await req(`/api/decks/${id}/join-requests/approve`, "POST", {
        requestIds: [a.data.requestId, crypto.randomUUID()],
      })
    ).status,
    409,
  );
  assert.equal(
    (await req(`/api/decks/${id}`, "GET", undefined, guests[0])).status,
    404,
  );
  const approve = () =>
    req(`/api/decks/${id}/join-requests/approve`, "POST", {
      requestIds: [a.data.requestId],
    });
  assert.equal((await approve()).status, 200);
  assert.equal((await approve()).status, 200);
  assert.equal(
    (await data(`/api/join-requests/${a.data.requestId}`, guests[0])).id,
    id,
  );
  assert.equal((await data(`/api/decks/${id}`, guests[0])).access.mode, "none");
  assert.equal(
    (await req(`/api/decks/${id}`, "GET", undefined, guests[1])).status,
    404,
  );
  assert.equal(
    (
      await req(`/api/decks/${id}/join-requests/reject`, "POST", {
        requestIds: [b.data.requestId],
      })
    ).status,
    200,
  );
  assert.equal((await ask(guests[1])).data.status, "rejected");
  const c = await ask(guests[2]);
  assert.equal(c.status, 202);
  const rotated = await req(`/api/decks/${id}/invite`, "POST"),
    newToken = new URL((await rotated.json()).url).searchParams.get("join");
  assert.equal(
    (await data(`/api/join-requests/${c.data.requestId}`, guests[2])).status,
    "expired",
  );
  assert.equal(
    (
      await req(`/api/decks/${id}/join-requests/approve`, "POST", {
        requestIds: [c.data.requestId],
      })
    ).status,
    409,
  );
  const nextB = await ask(guests[1], newToken),
    nextC = await ask(guests[2], newToken);
  assert.equal(nextB.status, 202);
  assert.equal(nextC.status, 202);
  assert.equal(
    (
      await req(`/api/decks/${id}/join-requests/approve`, "POST", {
        requestIds: [nextB.data.requestId, nextC.data.requestId],
      })
    ).status,
    200,
  );
  const user = (await data("/api/session", guests[1])).user;
  assert.equal(
    (await req(`/api/decks/${id}/members/${user.id}`, "DELETE")).status,
    200,
  );
  const again = await ask(guests[1], newToken);
  assert.equal(again.status, 202);
  assert.equal(
    (await req(`/api/decks/${id}`, "GET", undefined, guests[1])).status,
    404,
  );
  assert.equal(
    (
      await req(`/api/decks/${id}/join-requests/approve`, "POST", {
        requestIds: [nextB.data.requestId],
      })
    ).status,
    409,
  );
  assert.equal((await req(`/api/decks/${id}/trash`, "POST")).status, 200);
  assert.equal(
    (await data(`/api/join-requests/${again.data.requestId}`, guests[1]))
      .status,
    "expired",
  );
  assert.equal(
    (
      await req(`/api/decks/${id}/join-requests/approve`, "POST", {
        requestIds: [again.data.requestId],
      })
    ).status,
    404,
  );
}
