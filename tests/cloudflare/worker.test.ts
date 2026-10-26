import { COLLABORATION_PROTOCOL } from "../../src/collaborationProtocol.ts";
import { exerciseDeletedMedia } from "../support/deleted-media.ts";
import { exerciseJoinApprovals } from "../support/join-approval-features.ts";
import { acceptAndApprove } from "../support/join-approval.ts";
import { swapRowGroups } from "../../src/model.ts";
import { applyDeckChange } from "../../src/sharedDeck.ts";
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
  await acceptAndApprove(request, id, token, cookie, owner);
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
  await request(
    `/api/decks/${id}/comments/77777777-1234-4567-8901-123456789abc`,
    "PUT",
    {
      slide: deck.slides[0].id,
      text: "再起動後も付箋の見た目を保存",
      x: 0.2,
      y: 0.3,
      color: "#d2edff",
      w: 0.37,
      h: 0.43,
    },
  );
  await mf.dispose();
  mf = fixture.start();
  const notesAfter = (await (
    await request(`/api/decks/${id}/comments`)
  ).json()) as any;
  assert.equal(notesAfter.comments[0].color, "#d2edff");
  assert.equal(notesAfter.comments[0].w, 0.37);
  assert.equal(notesAfter.comments[0].h, 0.43);
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
  const cookies: string[] = [],
    joins: string[] = [];
  for (let i = 0; i < 40; i++) {
    const cookie = await login(`student-${i}`);
    cookies.push(cookie);
    const r = await request(
      `/api/invites/${token}/accept`,
      "POST",
      undefined,
      cookie,
    );
    assert.equal(r.status, 202);
    joins.push(((await r.json()) as any).requestId);
  }
  assert.equal(
    (
      await request(`/api/decks/${id}/join-requests/approve`, "POST", {
        requestIds: joins,
      })
    ).status,
    200,
  );
  for (const cookie of cookies) {
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
        protocol: COLLABORATION_PROTOCOL,
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
      protocol: COLLABORATION_PROTOCOL,
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
  await acceptAndApprove(request, id, token, friend, owner);
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
  const edited = {
    slide: own.id,
    text: "直接編集した付箋",
    x: 0.12,
    y: 0.22,
    color: "#ffd9e3",
    w: 0.38,
    h: 0.48,
  };
  const ownNoteId = notes.comments[0].id;
  const draftId = "bbbbbbbb-1234-4567-8901-123456789abc";
  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments/${draftId}`,
        "PUT",
        edited,
        friend,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments/${draftId}`,
        "PUT",
        edited,
        friend,
      )
    ).status,
    200,
  );
  const created = (await (
    await request(`/api/decks/${id}/comments`)
  ).json()) as any;
  assert.equal(created.comments.length, 3, "new drafts are created only once");
  assert.equal(
    created.comments.find((c: any) => c.id === draftId).author,
    "friend",
  );
  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments/${draftId}`,
        "DELETE",
        undefined,
        friend,
      )
    ).status,
    200,
  );

  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments/${ownNoteId}`,
        "PUT",
        edited,
        friend,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments/${ownNoteId}`,
        "PUT",
        edited,
        friend,
      )
    ).status,
    200,
  );
  let changed = (await (
    await request(`/api/decks/${id}/comments`)
  ).json()) as any;
  assert.equal(changed.comments.length, 2, "retry must not create duplicates");
  const styled = changed.comments.find((c: any) => c.id === ownNoteId);
  assert.equal(styled.color, "#ffd9e3");
  assert.equal(styled.w, 0.38);
  assert.equal(styled.h, 0.48);

  assert.equal(
    changed.comments.find((c: any) => c.id === ownNoteId).text,
    edited.text,
  );
  assert.equal(
    changed.comments.find((c: any) => c.id === ownNoteId).x,
    edited.x,
  );
  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments/${hostNote.id}`,
        "PUT",
        edited,
        friend,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`/api/decks/${id}/comments/${ownNoteId}`, "PUT", {
        ...edited,
        text: "先生からの補足",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/api/decks/${id}/comments/${ownNoteId}`, "PUT", {
        slide: own.id,
        text: "旧クライアントの編集",
        x: 0.2,
        y: 0.3,
      })
    ).status,
    200,
  );
  changed = (await (await request(`/api/decks/${id}/comments`)).json()) as any;
  assert.equal(
    changed.comments.find((c: any) => c.id === ownNoteId).author,
    "friend",
    "host editing preserves authorship",
  );
  assert.equal(
    changed.comments.find((c: any) => c.id === ownNoteId).color,
    "#ffd9e3",
  );
  for (const style of [{ color: "bad" }, { w: 0.81 }, { h: 0.1 }])
    assert.equal(
      (
        await request(`/api/decks/${id}/comments/${ownNoteId}`, "PUT", {
          ...edited,
          ...style,
        })
      ).status,
      400,
    );

  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments/${ownNoteId}`,
        "PUT",
        { ...edited, text: "", x: 2 },
        friend,
      )
    ).status,
    400,
  );

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
      protocol: COLLABORATION_PROTOCOL,
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
      protocol: COLLABORATION_PROTOCOL,
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

  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments/${draftId}`,
        "PUT",
        edited,
        friend,
      )
    ).status,
    403,
    "revoked comment permission also prevents updates",
  );
  const v = Y.encodeStateVector(live.doc);
  sharedText(live.doc, own.id, own.elements[0].id)!.insert(0, "revoked");
  live.ws.send(
    JSON.stringify({
      type: "update",
      protocol: COLLABORATION_PROTOCOL,
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
  const rowNames = (await (
    await request(`/api/decks/${id}/row-accounts`)
  ).json()) as any;
  assert.deepEqual(rowNames.rows, {
    main: { 0: ["student-80"], 1: ["student-81"] },
  });
  assert.ok(!JSON.stringify(rowNames).includes("example.test"));

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
    (await request(`/api/decks/${id}/row-accounts`, "GET", undefined, outsider))
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
      protocol: COLLABORATION_PROTOCOL,
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
      protocol: COLLABORATION_PROTOCOL,
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
  await acceptAndApprove(request, id, token, a, owner);
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

test("legacy row grants follow a host reorder, protected edits and obsolete clients are rejected", async () => {
  const id = await create();
  await joinRoom(id, friend);
  const access = {
    mode: "scoped",
    comment: true,
    rows: [{ sheetId: "main", index: 0 }],
    columns: [],
    slides: [],
  };
  assert.equal(
    (await request(`/api/decks/${id}/members/friend`, "PATCH", access)).status,
    200,
  );
  const host = await connect(id, owner),
    guest = await connect(id, friend);
  const before = readSharedDeck(host.doc),
    own = before.slides.find((s) => s.y === 0)!,
    protectedPage = before.slides.find((s) => s.y === 1)!;
  const vector = Y.encodeStateVector(host.doc);
  applyDeckChange(host.doc, before, swapRowGroups(before, 0, 1));
  host.ws.send(
    JSON.stringify({
      type: "update",
      protocol: COLLABORATION_PROTOCOL,
      id: "reorder",
      update: toBase64(Y.encodeStateAsUpdate(host.doc, vector)),
    }),
  );
  await until(() =>
    host.messages.some((m) => m.type === "ack" && m.id === "reorder"),
  );
  await until(
    () =>
      readSharedDeck(guest.doc).slides.find((s) => s.id === own.id)?.y === 1,
  );
  let v = Y.encodeStateVector(guest.doc);
  sharedText(guest.doc, own.id, own.elements[0].id)!.insert(0, "担当のまま");
  guest.ws.send(
    JSON.stringify({
      type: "update",
      protocol: COLLABORATION_PROTOCOL,
      id: "own",
      update: toBase64(Y.encodeStateAsUpdate(guest.doc, v)),
    }),
  );
  await until(() =>
    guest.messages.some((m) => m.type === "ack" && m.id === "own"),
  );
  v = Y.encodeStateVector(guest.doc);
  sharedText(guest.doc, protectedPage.id, protectedPage.elements[0].id)!.insert(
    0,
    "不許可",
  );
  guest.ws.send(
    JSON.stringify({
      type: "update",
      protocol: COLLABORATION_PROTOCOL,
      id: "forbidden",
      update: toBase64(Y.encodeStateAsUpdate(guest.doc, v)),
    }),
  );
  await until(() => guest.messages.some((m) => m.code === "forbidden"));
  const persisted = (await (await request(`/api/decks/${id}`)).json()) as {
    state: string;
  };
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(persisted.state));
  assert.equal(readSharedDeck(doc).sheets![0].rowIds!["1"], "0");
  assert.ok(
    sharedText(doc, own.id, own.elements[0].id)!
      .toString()
      .includes("担当のまま"),
  );
  assert.ok(
    !sharedText(doc, protectedPage.id, protectedPage.elements[0].id)!
      .toString()
      .includes("不許可"),
  );
  const obsolete = await connect(id, owner);
  obsolete.ws.send(
    JSON.stringify({
      type: "update",
      id: "old-client",
      protocol: 4,
      update: toBase64(Y.encodeStateAsUpdate(obsolete.doc)),
    }),
  );
  await until(() =>
    obsolete.messages.some(
      (m) => m.type === "error" && m.message.includes("再読み込み"),
    ),
  );
  assert.ok(!obsolete.messages.some((m) => m.type === "ack"));
  for (const client of [host, guest, obsolete]) {
    client.ws.close();
    client.doc.destroy();
  }
  doc.destroy();
});

test("full backups restore only into private new works, preserve photos and notes, and require explicit sharing", async () => {
  const id = await create();
  await joinRoom(id, friend);
  const host = await connect(id, owner);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  const asset = (await (
    await request(`/api/decks/${id}/assets`, "POST", png)
  ).json()) as { src: string };
  const before = readSharedDeck(host.doc),
    deck = structuredClone(swapRowGroups(before, 0, 1));
  deck.slides[0].elements.push({
    id: "backup-photo",
    type: "image",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    src: asset.src,
  });
  const vector = Y.encodeStateVector(host.doc);
  applyDeckChange(host.doc, before, deck);
  host.ws.send(
    JSON.stringify({
      type: "update",
      protocol: COLLABORATION_PROTOCOL,
      id: "backup-photo",
      update: toBase64(Y.encodeStateAsUpdate(host.doc, vector)),
    }),
  );
  await until(() =>
    host.messages.some((m) => m.type === "ack" && m.id === "backup-photo"),
  );
  const grant = {
    mode: "scoped",
    comment: true,
    rows: [{ sheetId: "main", index: 1, axisId: "0" }],
    columns: [],
    slides: [],
  };
  assert.equal(
    (await request(`/api/decks/${id}/members/friend`, "PATCH", grant)).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments`,
        "POST",
        {
          slide: deck.slides[0].id,
          text: "感想",
          x: 0.3,
          y: 0.4,
          color: "#aaddff",
          w: 0.4,
          h: 0.5,
        },
        friend,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(`/api/decks/${id}/backup`, "GET", undefined, friend)).status,
    404,
  );
  const backup = (await (
    await request(`/api/decks/${id}/backup`)
  ).json()) as any;
  assert.equal(backup.format, "vhslide-backup");
  assert.equal(
    backup.deck.slides
      .flatMap((s: any) => s.elements)
      .filter((e: any) => e.type === "image").length,
    1,
  );
  assert.equal(backup.comments[0].text, "感想");
  assert.equal(backup.comments[0].author, undefined);
  assert.equal(backup.sharing[0].access.rows[0].axisId, "0");
  assert.equal(
    (
      await request(`/api/decks/${id}/restore`, "POST", {
        snapshot: backup,
        applySharing: false,
      })
    ).status,
    409,
  );
  async function prepare() {
    const response = await request("/api/restores", "POST", {
      title: backup.deck.title,
    });
    assert.equal(response.status, 201);
    const result = (await response.json()) as { id: string };
    assert.ok((await request(`/api/decks/${result.id}`)).status >= 400);
    assert.ok(
      (await request(`/api/decks/${result.id}/invite`, "POST")).status >= 400,
    );
    const uploaded = await request(
      `/api/decks/${result.id}/assets`,
      "POST",
      png,
    );
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const saved = (await uploaded.json()) as { src: string };
    const snapshot = structuredClone(backup);
    snapshot.deck.slides
      .flatMap((s: any) => s.elements)
      .filter((e: any) => e.type === "image")
      .forEach((e: any) => (e.src = saved.src));
    return { id: result.id, snapshot, src: saved.src };
  }
  const first = await prepare();
  assert.ok(
    (
      await request(`/api/decks/${first.id}/restore`, "POST", {
        snapshot: backup,
        applySharing: false,
      })
    ).status >= 400,
  );
  const completed = await request(`/api/decks/${first.id}/restore`, "POST", {
    snapshot: first.snapshot,
    applySharing: false,
  });
  assert.equal(completed.status, 200, await completed.text());
  assert.equal(
    (await request(`/api/decks/${first.id}/restore`, "DELETE")).status,
    409,
  );
  assert.equal(
    (
      await request(`/api/decks/${first.id}/restore`, "POST", {
        snapshot: first.snapshot,
        applySharing: false,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(`/api/decks/${first.id}`, "GET", undefined, friend)).status,
    404,
  );
  const restored = (await (
    await request(`/api/decks/${first.id}/backup`)
  ).json()) as any;
  assert.deepEqual(restored.deck, first.snapshot.deck);
  assert.equal(restored.comments[0].color, "#aaddff");
  assert.equal(restored.comments[0].created, backup.comments[0].created);
  assert.ok(restored.comments[0].authorName.endsWith("（復元）"));
  assert.equal(restored.sharing.length, 0);
  const photo = await request(first.src);
  assert.equal(photo.status, 200);
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
  const second = await prepare();
  assert.equal(
    (
      await request(`/api/decks/${second.id}/restore`, "POST", {
        snapshot: second.snapshot,
        applySharing: true,
      })
    ).status,
    200,
  );
  const joined = (await (
    await request(`/api/decks/${second.id}`, "GET", undefined, friend)
  ).json()) as any;
  assert.deepEqual(joined.access, grant);
  const sourceNow = (await (
    await request(`/api/decks/${id}/backup`)
  ).json()) as any;
  assert.deepEqual(sourceNow.deck, backup.deck);
  assert.deepEqual(sourceNow.comments, backup.comments);
  const cancelled = await prepare();
  assert.equal(
    (await request(`/api/decks/${cancelled.id}/restore`, "DELETE")).status,
    200,
  );
  assert.equal((await request(`/api/decks/${cancelled.id}`)).status, 404);
  const ns = await mf.getDurableObjectNamespace("ROOMS");
  const deletedRoom = ns.get(ns.idFromName(cancelled.id));
  const lateAsset = crypto.randomUUID();
  const late = await deletedRoom.fetch(`https://internal/assets/${lateAsset}`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  assert.equal(late.status, 409);
  assert.equal(
    (await deletedRoom.fetch(`https://internal/assets/${lateAsset}`)).status,
    404,
  );
  assert.equal(
    (
      await deletedRoom.fetch("https://internal/init", {
        method: "POST",
        body: JSON.stringify({ id: cancelled.id, deck: sample() }),
      })
    ).status,
    409,
  );
  host.ws.close();
  host.doc.destroy();
});

test("revision checkpoints and durable idempotent restore jobs survive restart and cancellation races", async () => {
  const { exerciseBackupProtocol } =
    await import("../support/backup-protocol.ts");
  const owner = await login("protocol-owner"),
    guest = await login("protocol-guest");
  await exerciseBackupProtocol(
    async (path, method = "GET", value, cookie = owner, headers = {}) =>
      mf.dispatchFetch(origin + path, {
        method,
        headers: { Origin: origin, Cookie: cookie, ...headers },
        ...(value === undefined
          ? {}
          : {
              body: value instanceof Uint8Array ? value : JSON.stringify(value),
            }),
      }),
    owner,
    guest,
    async () => {
      await mf.dispose();
      mf = fixture.start();
    },
    async (id) => {
      const p = await connect(id, owner),
        before = readSharedDeck(p.doc),
        after = structuredClone(before),
        vector = Y.encodeStateVector(p.doc);
      after.slides[0].title = "変更";
      applyDeckChange(p.doc, before, after);
      p.ws.send(
        JSON.stringify({
          type: "update",
          protocol: COLLABORATION_PROTOCOL,
          id: "protocol-test",
          update: toBase64(Y.encodeStateAsUpdate(p.doc, vector)),
        }),
      );
      await until(() =>
        p.messages.some((m) => m.type === "ack" && m.id === "protocol-test"),
      );
      p.ws.close();
      p.doc.destroy();
    },
  );
});

test("learning versions, deletion checkpoints and work trash enforce ownership and survive restart", async () => {
  const { exerciseLearningFeatures } =
    await import("../support/learning-features.ts");
  const owner = await login("tools-owner"),
    guest = await login("tools-guest");
  await exerciseLearningFeatures(
    request,
    owner,
    guest,
    async () => {
      await mf.dispose();
      mf = fixture.start();
    },
    async (id) => {
      const peer = await connect(id, owner),
        before = readSharedDeck(peer.doc),
        after = structuredClone(before),
        vector = Y.encodeStateVector(peer.doc);
      after.slides = after.slides.filter((s) => s.y === 0);
      applyDeckChange(peer.doc, before, after);
      peer.ws.send(
        JSON.stringify({
          type: "update",
          protocol: COLLABORATION_PROTOCOL,
          id: "history-delete",
          update: toBase64(Y.encodeStateAsUpdate(peer.doc, vector)),
        }),
      );
      await until(() =>
        peer.messages.some(
          (m) => m.type === "ack" && m.id === "history-delete",
        ),
      );
      peer.ws.close();
      peer.doc.destroy();
    },
  );
});

test("invitation approval gates private data, survives restart, supports checked batches and refuses revoked admission replay", async () => {
  const teacher = await login("join-teacher"),
    a = await login("join-a"),
    b = await login("join-b"),
    c = await login("join-c");
  await exerciseJoinApprovals(request, teacher, [a, b, c], async () => {
    await mf.dispose();
    mf = fixture.start();
  });
});

test("deleted media is private; live references and uploads work, forged resurrection is denied, host recovery survives restart", async () => {
  const host = await login("media-host"),
    editor = await login("media-editor"),
    viewer = await login("media-viewer");
  await exerciseDeletedMedia(
    request,
    host,
    editor,
    viewer,
    async () => {
      await mf.dispose();
      mf = fixture.start();
    },
    async (id, cookie, change, allowed) => {
      const peer = await connect(id, cookie);
      try {
        const before = readSharedDeck(peer.doc),
          vector = Y.encodeStateVector(peer.doc);
        applyDeckChange(peer.doc, before, change(before));
        const key = crypto.randomUUID();
        peer.ws.send(
          JSON.stringify({
            type: "update",
            protocol: COLLABORATION_PROTOCOL,
            id: key,
            update: toBase64(Y.encodeStateAsUpdate(peer.doc, vector)),
          }),
        );
        await until(() =>
          peer.messages.some(
            (m) => m.type === "error" || (m.type === "ack" && m.id === key),
          ),
        );
        if (allowed)
          assert.ok(
            peer.messages.some((m) => m.type === "ack" && m.id === key),
            JSON.stringify(peer.messages),
          );
        else {
          assert.ok(
            peer.messages.some(
              (m) => m.type === "error" && m.code === "forbidden",
            ),
          );
          assert.match(
            peer.messages.find((m) => m.type === "error").message,
            /ホスト/,
          );
        }
      } finally {
        peer.ws.close();
        peer.doc.destroy();
      }
    },
  );
});
