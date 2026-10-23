import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Miniflare } from "miniflare";
import * as Y from "yjs";
import { harness } from "./harness.ts";
import { blank, sample } from "../../src/model.ts";
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
  const { user } = (await (
    await request("/api/session", "GET", undefined, cookie)
  ).json()) as { user: { id: string } };
  assert.equal(
    (
      await request(
        `/api/decks/${id}/members/${encodeURIComponent(user.id)}`,
        "PATCH",
        { mode: "all", comment: true, rows: [], columns: [], slides: [] },
      )
    ).status,
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

test("stores 1000 pages and private photos through a runtime restart and rejects page 1001", async () => {
  const source = JSON.parse(
    await readFile("public/samples/vhslide-10x40.json", "utf8"),
  );
  const deck = {
    ...source,
    rowSelections: [],
    slides: Array.from({ length: 1000 }, (_, i) => {
      const original = source.slides[i % source.slides.length];
      return {
        ...original,
        id: `page-${i}`,
        x: i % 20,
        y: Math.floor(i / 20),
        elements: original.elements.map((element: object, j: number) => ({
          ...element,
          id: `element-${i}-${j}`,
        })),
      };
    }),
  };
  const id = await create(deck);
  const excessive = { ...deck, slides: [...deck.slides, blank(99, 99)] };
  assert.equal((await request("/api/decks", "POST", excessive)).status, 400);
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
  assert.equal(readSharedDeck(doc).slides.length, 1000);
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

test("host grants are enforced on live edits; read-only guests can comment but cannot change settings or other authors' notes", async () => {
  const id = await create();
  const token = await invitation(id);
  assert.equal(
    (await request(`/api/invites/${token}/accept`, "POST", undefined, friend))
      .status,
    200,
  );
  const initial = (await (
    await request(`/api/decks/${id}`, "GET", undefined, friend)
  ).json()) as any;
  assert.equal(initial.access.mode, "none");
  const deck = sample(),
    first = deck.slides[0];
  const state = new Y.Doc();
  Y.applyUpdate(state, fromBase64(initial.state));
  const current = readSharedDeck(state),
    own = current.slides[0],
    protectedSlide = current.slides[1];
  const setting = {
    mode: "scoped",
    comment: true,
    rows: [{ sheetId: "main", index: 1 }],
    columns: [{ sheetId: "main", index: 2 }],
    slides: [
      own.id,
      ...Array.from(
        { length: 999 },
        (_, i) => `unused-${String(i).padStart(70, "0")}`,
      ),
    ],
  };
  assert.equal(
    (await request(`/api/decks/${id}/members/friend`, "PATCH", setting, friend))
      .status,
    404,
  );
  assert.equal(
    (await request(`/api/decks/${id}/members/owner`, "PATCH", setting)).status,
    400,
  );
  const note = await request(
    `/api/decks/${id}/comments`,
    "POST",
    { slide: own.id, text: "いいね", x: 0.3, y: 0.4 },
    friend,
  );
  assert.equal(note.status, 200);
  const notes = (await (
    await request(`/api/decks/${id}/comments`)
  ).json()) as any;
  assert.equal(notes.comments[0].name, "児童 友だち");
  assert.equal(notes.comments[0].author, "friend");
  assert.equal(
    (
      await request(`/api/decks/${id}/comments`, "POST", {
        slide: own.id,
        text: "先生の付箋",
        x: 0.7,
        y: 0.5,
      })
    ).status,
    200,
  );
  const both = (await (
    await request(`/api/decks/${id}/comments`)
  ).json()) as any;
  const hostNote = both.comments.find((c: any) => c.author === "owner");
  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments/${hostNote.id}`,
        "DELETE",
        undefined,
        friend,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments/${notes.comments[0].id}`,
        "DELETE",
        undefined,
        friend,
      )
    ).status,
    200,
  );
  const peer = await connect(id, friend);
  assert.equal(
    (await request(`/api/decks/${id}/members/friend`, "PATCH", setting)).status,
    200,
  );
  await until(() => peer.messages.some((m) => m.type === "access"));
  const vector = Y.encodeStateVector(peer.doc);
  sharedText(peer.doc, own.id, own.elements[0].id)!.insert(0, "allowed");
  peer.ws.send(
    JSON.stringify({
      type: "update",
      id: "allowed",
      update: toBase64(Y.encodeStateAsUpdate(peer.doc, vector)),
    }),
  );
  await until(() =>
    peer.messages.some((m) => m.type === "ack" && m.id === "allowed"),
  );
  const badVector = Y.encodeStateVector(peer.doc);
  sharedText(
    peer.doc,
    protectedSlide.id,
    protectedSlide.elements[0].id,
  )!.insert(0, "forbidden");
  peer.ws.send(
    JSON.stringify({
      type: "update",
      id: "bad",
      update: toBase64(Y.encodeStateAsUpdate(peer.doc, badVector)),
    }),
  );
  await until(() =>
    peer.messages.some((m) => m.type === "error" && m.code === "forbidden"),
  );
  const saved = (await (await request(`/api/decks/${id}`)).json()) as any;
  const check = new Y.Doc();
  Y.applyUpdate(check, fromBase64(saved.state));
  assert.ok(
    sharedText(check, own.id, own.elements[0].id)!
      .toString()
      .startsWith("allowed"),
  );
  assert.ok(
    !sharedText(check, protectedSlide.id, protectedSlide.elements[0].id)!
      .toString()
      .includes("forbidden"),
  );
  const live = await connect(id, friend);
  assert.equal(
    (
      await request(`/api/decks/${id}/members/friend`, "PATCH", {
        ...setting,
        mode: "none",
        comment: false,
      })
    ).status,
    200,
  );
  const v = Y.encodeStateVector(live.doc);
  sharedText(live.doc, own.id, own.elements[0].id)!.insert(0, "revoked");
  live.ws.send(
    JSON.stringify({
      type: "update",
      id: "revoked",
      update: toBase64(Y.encodeStateAsUpdate(live.doc, v)),
    }),
  );
  await until(() =>
    live.messages.some((m) => m.type === "error" && m.code === "forbidden"),
  );
  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments`,
        "POST",
        { slide: own.id, text: "blocked", x: 0, y: 0 },
        friend,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/decks/${id}/assets`,
        "POST",
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        friend,
      )
    ).status,
    403,
  );
  peer.doc.destroy();
  live.doc.destroy();
  state.destroy();
  check.destroy();
});

test("pre-shared verified emails claim ordered row grants without an invite, preserve invite grants, update live and revoke without resurrection", async () => {
  const id = await create();
  const grant = (row: number) => ({
    mode: "scoped",
    comment: true,
    rows: [{ sheetId: "main", index: row }],
    columns: [],
    slides: [],
  });
  const preset = {
    recipients: [
      { email: "STUDENT-80@example.test", access: grant(0) },
      { email: "student-81@example.test", access: grant(1) },
    ],
  };
  const added = await request(`/api/decks/${id}/recipients`, "POST", preset);
  assert.equal(added.status, 200, await added.clone().text());
  const list = ((await added.json()) as any).recipients;
  assert.deepEqual(
    list.map((r: any) => r.email),
    ["student-80@example.test", "student-81@example.test"],
  );
  assert.ok(list.every((r: any) => !r.userId));
  const outsider = await login("student-82");
  assert.ok(
    !(
      (await (
        await request("/api/decks", "GET", undefined, outsider)
      ).json()) as any
    ).decks.some((d: any) => d.id === id),
  );
  assert.equal(
    (await request(`/api/decks/${id}/recipients`, "GET", undefined, outsider))
      .status,
    404,
  );
  assert.equal(
    (await request(`/api/decks/${id}/recipients`, "POST", preset, outsider))
      .status,
    404,
  );
  const a = await login("student-80"),
    b = await login("student-81");
  assert.ok(
    (
      (await (await request("/api/decks", "GET", undefined, a)).json()) as any
    ).decks.some((d: any) => d.id === id),
  );
  assert.deepEqual(
    (
      (await (
        await request(`/api/decks/${id}`, "GET", undefined, a)
      ).json()) as any
    ).access.rows,
    grant(0).rows,
  );
  const invitation = await request(`/api/decks/${id}/invite`, "POST");
  const token = new URL(
    ((await invitation.json()) as any).url,
  ).searchParams.get("join");
  assert.equal(
    (await request(`/api/invites/${token}/accept`, "POST", undefined, b))
      .status,
    200,
  );
  assert.deepEqual(
    (
      (await (
        await request(`/api/decks/${id}`, "GET", undefined, b)
      ).json()) as any
    ).access.rows,
    grant(1).rows,
  );
  const first = await connect(id, a),
    second = await connect(id, b),
    deck = readSharedDeck(first.doc),
    slide = deck.slides[0];
  const v = Y.encodeStateVector(first.doc);
  sharedText(first.doc, slide.id, slide.elements[0].id)!.insert(0, "my row ");
  first.ws.send(
    JSON.stringify({
      type: "update",
      id: "own-row",
      update: toBase64(Y.encodeStateAsUpdate(first.doc, v)),
    }),
  );
  await until(() =>
    first.messages.some((m) => m.type === "ack" && m.id === "own-row"),
  );
  await until(() =>
    sharedText(second.doc, slide.id, slide.elements[0].id)!
      .toString()
      .startsWith("my row"),
  );
  const bad = Y.encodeStateVector(second.doc);
  sharedText(second.doc, slide.id, slide.elements[0].id)!.insert(
    0,
    "other row ",
  );
  second.ws.send(
    JSON.stringify({
      type: "update",
      id: "other-row",
      update: toBase64(Y.encodeStateAsUpdate(second.doc, bad)),
    }),
  );
  await until(() =>
    second.messages.some((m) => m.type === "error" && m.code === "forbidden"),
  );
  assert.equal(
    (
      await request(`/api/decks/${id}/recipients`, "POST", {
        recipients: [{ email: "student-80@example.test", access: grant(1) }],
      })
    ).status,
    200,
  );
  await until(() =>
    first.messages.some(
      (m) => m.type === "access" && m.access.rows[0]?.index === 1,
    ),
  );
  assert.equal(
    (
      await request(`/api/decks/${id}/members/student-80`, "PATCH", {
        ...grant(0),
        mode: "all",
      })
    ).status,
    200,
  );
  let current = (
    (await (await request(`/api/decks/${id}/recipients`)).json()) as any
  ).recipients;
  assert.equal(current[0].access.mode, "all");
  assert.equal(
    (await request(`/api/decks/${id}/members/student-80`, "DELETE")).status,
    200,
  );
  assert.ok(
    !(
      (await (await request("/api/decks", "GET", undefined, a)).json()) as any
    ).decks.some((d: any) => d.id === id),
  );
  assert.equal(
    (await request(`/api/invites/${token}/accept`, "POST", undefined, a))
      .status,
    200,
  );
  assert.equal(
    (
      (await (
        await request(`/api/decks/${id}`, "GET", undefined, a)
      ).json()) as any
    ).access.mode,
    "none",
  );
  assert.equal(
    (
      await request(`/api/decks/${id}/recipients`, "POST", {
        recipients: [{ email: "student-83@example.test", access: grant(0) }],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/api/decks/${id}/recipients/${encodeURIComponent("student-83@example.test")}`,
        "DELETE",
      )
    ).status,
    200,
  );
  const removed = await login("student-83");
  assert.ok(
    !(
      (await (
        await request("/api/decks", "GET", undefined, removed)
      ).json()) as any
    ).decks.some((d: any) => d.id === id),
  );
  assert.equal(
    (
      await request(`/api/decks/${id}/recipients`, "POST", {
        recipients: [{ email: "owner@example.test", access: grant(0) }],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`/api/decks/${id}/recipients`, "POST", {
        recipients: [
          { email: "student-84@example.test", access: grant(0) },
          { email: "invalid", access: grant(0) },
        ],
      })
    ).status,
    400,
  );
  current = (
    (await (await request(`/api/decks/${id}/recipients`)).json()) as any
  ).recipients;
  assert.deepEqual(
    current.map((r: any) => r.email),
    ["student-81@example.test"],
  );
  first.doc.destroy();
  second.doc.destroy();
  await mf.dispose();
  mf = fixture.start();
  const restored = (
    (await (await request(`/api/decks/${id}/recipients`)).json()) as any
  ).recipients;
  assert.deepEqual(restored, current);
  assert.deepEqual(
    (
      (await (
        await request(`/api/decks/${id}`, "GET", undefined, b)
      ).json()) as any
    ).access.rows,
    grant(1).rows,
  );
});
