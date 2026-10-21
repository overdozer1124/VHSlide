import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Miniflare } from "miniflare";
import * as Y from "yjs";
import { harness } from "./harness.ts";
import { sample } from "../../src/model.ts";
import {
  fromBase64,
  readSharedDeck,
  sharedText,
  toBase64,
} from "../../src/sharedDeck.ts";

const origin = "http://vhslide.test";
let storage: string,
  fixture: Awaited<ReturnType<typeof harness>>,
  mf: Miniflare;
let owner: string, friend: string, stranger: string;
async function request(
  path: string,
  method = "GET",
  value?: unknown,
  cookie = owner,
  source = origin,
) {
  return mf.dispatchFetch(origin + path, {
    method,
    headers: { Origin: source, Cookie: cookie || "" },
    ...(value === undefined
      ? {}
      : { body: value instanceof Uint8Array ? value : JSON.stringify(value) }),
  });
}
async function login(id: string) {
  const r = await request(
    "/api/auth/google",
    "POST",
    { credential: await fixture.sign(id) },
    "",
  );
  assert.equal(r.status, 200, await r.clone().text());
  return r.headers.get("set-cookie")!.split(";")[0];
}
async function create(deck = sample(), cookie = owner) {
  const r = await request("/api/decks", "POST", deck, cookie);
  assert.equal(r.status, 201, await r.clone().text());
  return ((await r.json()) as { id: string }).id;
}
async function invitation(id: string) {
  const r = await request(`/api/decks/${id}/invite`, "POST");
  assert.equal(r.status, 200);
  return new URL(((await r.json()) as { url: string }).url).searchParams.get(
    "join",
  );
}
async function joinRoom(id: string, cookie: string, invite?: string | null) {
  const token = invite || (await invitation(id));
  assert.equal(
    (await request(`/api/invites/${token}/accept`, "POST", undefined, cookie))
      .status,
    200,
  );
}
async function connect(id: string, cookie = owner) {
  const r = await mf.dispatchFetch(`${origin}/api/decks/${id}/live`, {
    headers: { Upgrade: "websocket", Origin: origin, Cookie: cookie },
  });
  assert.equal(r.status, 101, r.status === 101 ? "" : await r.text());
  const ws = r.webSocket!,
    doc = new Y.Doc(),
    messages: any[] = [];
  let done!: () => void;
  const ready = new Promise<void>((resolve) => (done = resolve));
  ws.addEventListener("message", (event) => {
    if (typeof event.data === "string") messages.push(JSON.parse(event.data));
    else {
      Y.applyUpdate(doc, new Uint8Array(event.data as ArrayBuffer));
      done();
    }
  });
  ws.accept();
  await ready;
  return { ws, doc, messages };
}
async function until(condition: () => boolean) {
  const end = Date.now() + 10_000;
  while (!condition()) {
    assert.ok(Date.now() < end, "timed out waiting for sync");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
before(async () => {
  storage = await mkdtemp(join(tmpdir(), "vhslide-cf-"));
  fixture = await harness(storage, origin);
  mf = fixture.start();
  owner = await login("owner");
  friend = await login("friend");
  stranger = await login("stranger");
});
after(async () => {
  await mf.dispose();
  await rm(storage, { recursive: true, force: true });
});

test("checks real JWT signatures/audience, session cookies, origin and membership", async () => {
  const config = (await (await request("/api/config")).json()) as any;
  assert.match(config.notice, /無料プラン/);
  assert.equal((await request("/api/decks", "GET", undefined, "")).status, 401);
  assert.equal(
    (await request("/api/auth/google", "POST", { credential: "forged" }, ""))
      .status,
    401,
  );
  assert.equal(
    (
      await request(
        "/api/auth/google",
        "POST",
        { credential: await fixture.sign("bad", "wrong") },
        "",
      )
    ).status,
    401,
  );
  assert.equal(
    (await request("/api/decks", "POST", sample(), owner, "http://evil.test"))
      .status,
    403,
  );
  assert.equal(
    (await request("/internal/touched", "POST", { id: "x" })).status,
    200,
  ); // Static assets, never the private directory.
  const id = await create();
  assert.equal(
    (await request(`/api/decks/${id}`, "GET", undefined, friend)).status,
    404,
  );
  await joinRoom(id, friend);
  assert.equal(
    (await request(`/api/decks/${id}/invite`, "POST", undefined, friend))
      .status,
    404,
  );
  const peer = await connect(id, friend);
  const closed = new Promise<number>((resolve) =>
    peer.ws.addEventListener("close", (event) => resolve(event.code)),
  );
  assert.equal(
    (await request(`/api/decks/${id}/members/friend`, "DELETE")).status,
    200,
  );
  assert.equal(await closed, 4003);
  assert.equal(
    (await request(`/api/decks/${id}`, "GET", undefined, friend)).status,
    404,
  );
  peer.doc.destroy();
});

test("imports all 400 pages and keeps private photos through a runtime restart", async () => {
  const deck = JSON.parse(
    await readFile("public/samples/vhslide-10x40.json", "utf8"),
  );
  const id = await create(deck);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  const upload = await request(`/api/decks/${id}/assets`, "POST", png);
  assert.equal(upload.status, 201);
  const src = ((await upload.json()) as { src: string }).src;
  assert.equal((await request(src, "GET", undefined, stranger)).status, 404);
  assert.equal(
    (
      await request(
        `/api/decks/${id}/assets`,
        "POST",
        new Uint8Array([1, 2, 3]),
      )
    ).status,
    400,
  );
  await mf.dispose();
  mf = fixture.start();
  const restored = (await (await request(`/api/decks/${id}`)).json()) as {
    state: string;
  };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(restored.state));
  assert.equal(readSharedDeck(doc).slides.length, 400);
  assert.deepEqual(Buffer.from(await (await request(src)).arrayBuffer()), png);
  doc.destroy();
});

test("40 authenticated WebSockets converge on simultaneous edits and persist acknowledgements", async () => {
  const id = await create(),
    token = await invitation(id),
    peers: Awaited<ReturnType<typeof connect>>[] = [];
  for (let i = 0; i < 40; i++) {
    const cookie = await login(`student-${i}`);
    await joinRoom(id, cookie, token);
    peers.push(await connect(id, cookie));
  }
  const deck = readSharedDeck(peers[0].doc),
    slide = deck.slides[0],
    element = slide.elements[0];
  for (let i = 0; i < peers.length; i++) {
    const peer = peers[i],
      vector = Y.encodeStateVector(peer.doc);
    sharedText(peer.doc, slide.id, element.id)!.insert(0, `[${i}]`);
    peer.ws.send(
      JSON.stringify({
        type: "update",
        id: `edit-${i}`,
        update: toBase64(Y.encodeStateAsUpdate(peer.doc, vector)),
      }),
    );
  }
  await until(() =>
    peers.every((peer, i) =>
      peer.messages.some((m) => m.type === "ack" && m.id === `edit-${i}`),
    ),
  );
  await until(() =>
    peers.every((peer) => {
      const text = sharedText(peer.doc, slide.id, element.id)!.toString();
      return Array.from({ length: 40 }, (_, i) => `[${i}]`).every((marker) =>
        text.includes(marker),
      );
    }),
  );
  const expected = sharedText(peers[0].doc, slide.id, element.id)!.toString();
  for (const peer of peers) {
    assert.equal(
      sharedText(peer.doc, slide.id, element.id)!.toString(),
      expected,
    );
    peer.ws.close();
    peer.doc.destroy();
  }
  await mf.dispose();
  mf = fixture.start();
  const restored = (await (await request(`/api/decks/${id}`)).json()) as {
    state: string;
  };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(restored.state));
  assert.equal(sharedText(doc, slide.id, element.id)!.toString(), expected);
  doc.destroy();
});

test("refuses foreign assets and closes a signed-out connection", async () => {
  const id = await create(),
    other = await create();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  const foreign = (
    (await (
      await request(`/api/decks/${other}/assets`, "POST", png)
    ).json()) as { src: string }
  ).src;
  const peer = await connect(id),
    vector = Y.encodeStateVector(peer.doc),
    first = [...peer.doc.getMap<Y.Map<any>>("slides").values()][0];
  const element = new Y.Map<any>();
  (first.get("elements") as Y.Map<any>).set("foreign-photo", element);
  for (const [key, value] of Object.entries({
    type: "image",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    src: foreign,
    rank: 5,
  }))
    element.set(key, value);
  peer.ws.send(
    JSON.stringify({
      type: "update",
      id: "bad-asset",
      update: toBase64(Y.encodeStateAsUpdate(peer.doc, vector)),
    }),
  );
  await until(() => peer.messages.some((m) => m.type === "error"));
  assert.ok(!peer.messages.some((m) => m.type === "ack"));
  peer.doc.destroy();
  const fresh = await connect(id);
  const closed = new Promise<number>((resolve) =>
    fresh.ws.addEventListener("close", (event) => resolve(event.code)),
  );
  assert.equal((await request("/api/logout", "POST")).status, 200);
  assert.equal(await closed, 4003);
  assert.equal((await request(`/api/decks/${id}`)).status, 401);
  fresh.doc.destroy();
  owner = await login("owner");
});

test("reserves photo space atomically and stops uploading at the owner's limit", async () => {
  const quotaOwner = await login("quota"),
    id = await create(sample(), quotaOwner);
  const bytes = new Uint8Array(6_000_000);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  for (let i = 0; i < 8; i++)
    assert.equal(
      (await request(`/api/decks/${id}/assets`, "POST", bytes, quotaOwner))
        .status,
      201,
    );
  const smaller = bytes.slice(0, 1_500_000);
  const results = await Promise.all([
    request(`/api/decks/${id}/assets`, "POST", smaller, quotaOwner),
    request(`/api/decks/${id}/assets`, "POST", smaller, quotaOwner),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 413]);
  const deleted = await request(
    `/api/decks/${id}`,
    "DELETE",
    undefined,
    quotaOwner,
  );
  assert.equal(deleted.status, 200, await deleted.text());
  const again = await create(sample(), quotaOwner);
  assert.equal(
    (await request(`/api/decks/${again}/assets`, "POST", smaller, quotaOwner))
      .status,
    201,
  );
});
