import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import * as Y from "yjs";
import { WebSocket } from "ws";
import { createApplication } from "../../server/app.ts";
import { sample, blank } from "../../src/model.ts";
import {
  readSharedDeck,
  sharedText,
  toBase64,
  fromBase64,
} from "../../src/sharedDeck.ts";

const origin = "http://vhslide.test";
let directory: string, base: string, app: ReturnType<typeof createApplication>;
let alice: string, bob: string, eve: string;
async function start() {
  app = createApplication({
    directory,
    origin,
    clientId: "test-client",
    verifyIdentity: async (credential) => {
      if (!/^(alice|bob|eve|student-\d+)$/.test(credential))
        throw new Error("invalid");
      return {
        id: credential,
        name: credential,
        email: `${credential}@example.test`,
      };
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
}
async function request(
  path: string,
  method = "GET",
  value?: unknown,
  cookie = alice,
  requestOrigin = origin,
) {
  return fetch(base + path, {
    method,
    headers: {
      Origin: requestOrigin,
      Cookie: cookie ?? "",
      ...(value instanceof Buffer
        ? { "Content-Type": "image/png" }
        : { "Content-Type": "application/json" }),
    },
    ...(value === undefined
      ? {}
      : { body: value instanceof Buffer ? value : JSON.stringify(value) }),
  });
}
async function signIn(name: string) {
  const response = await request(
    "/api/auth/google",
    "POST",
    { credential: name },
    "",
  );
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function create() {
  const response = await request("/api/decks", "POST", sample());
  assert.equal(response.status, 201);
  return (await response.json()).id as string;
}
async function invite(id: string, cookie: string) {
  const response = await request(`/api/decks/${id}/invite`, "POST");
  const token = new URL((await response.json()).url).searchParams.get("join");
  const accepted = await request(
    `/api/invites/${token}/accept`,
    "POST",
    undefined,
    cookie,
  );
  assert.equal(accepted.status, 200);
  const { user } = await (
    await request("/api/session", "GET", undefined, cookie)
  ).json();
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
  return token;
}
async function connect(id: string, cookie: string) {
  const ws = new WebSocket(
    `${base.replace("http", "ws")}/api/decks/${id}/live`,
    { headers: { Origin: origin, Cookie: cookie } },
  );
  const doc = new Y.Doc();
  const messages: any[] = [];
  await new Promise<void>((done, fail) => {
    ws.on("error", fail);
    ws.on("message", (data, binary) => {
      if (binary) {
        Y.applyUpdate(doc, new Uint8Array(data as Buffer));
        done();
      } else messages.push(JSON.parse(data.toString()));
    });
  });
  return { ws, doc, messages };
}
async function until(check: () => boolean) {
  const end = Date.now() + 8000;
  while (!check()) {
    assert.ok(Date.now() < end, "timed out waiting for sync");
    await new Promise((done) => setTimeout(done, 20));
  }
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "vhslide-server-"));
  await start();
  alice = await signIn("alice");
  bob = await signIn("bob");
  eve = await signIn("eve");
});
after(async () => {
  await app.close();
  await rm(directory, { recursive: true, force: true });
});

test("requires Google identity and same-origin writes, and protects sessions", async () => {
  assert.equal(
    (await request("/api/decks", "POST", { version: 3 })).status,
    400,
  );
  assert.equal((await request("/api/decks", "GET", undefined, "")).status, 401);
  assert.equal(
    (await request("/api/auth/google", "POST", { credential: "forged" }, ""))
      .status,
    401,
  );
  assert.equal(
    (await request("/api/decks", "POST", sample(), alice, "http://evil.test"))
      .status,
    403,
  );
  const login = await request(
    "/api/auth/google",
    "POST",
    { credential: "alice" },
    "",
  );
  assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
  assert.match(login.headers.get("set-cookie")!, /SameSite=Lax/);
});
test("shares only through authenticated invitations and can revoke a member immediately", async () => {
  const id = await create();
  assert.equal(
    (await request(`/api/decks/${id}`, "GET", undefined, bob)).status,
    404,
  );
  const token = await invite(id, bob);
  assert.equal(
    (await request(`/api/decks/${id}`, "GET", undefined, bob)).status,
    200,
  );
  assert.equal(
    (await request(`/api/decks/${id}/invite`, "POST", undefined, bob)).status,
    404,
  );
  const peer = await connect(id, bob);
  const closed = once(peer.ws, "close");
  assert.equal(
    (await request(`/api/decks/${id}/members/bob`, "DELETE")).status,
    200,
  );
  assert.equal((await closed)[0], 4003);
  assert.equal(
    (await request(`/api/decks/${id}`, "GET", undefined, bob)).status,
    404,
  );
  await request(`/api/decks/${id}/invite`, "DELETE");
  assert.equal(
    (await request(`/api/invites/${token}/accept`, "POST", undefined, eve))
      .status,
    404,
  );
  peer.doc.destroy();
});
test("stores private photos, validates file type, and denies cross-project asset references", async () => {
  const id = await create(),
    other = await create();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  const uploaded = await request(`/api/decks/${id}/assets`, "POST", png);
  assert.equal(uploaded.status, 201);
  const { src } = await uploaded.json();
  assert.equal((await request(src, "GET", undefined, eve)).status, 404);
  const picture = await request(src);
  assert.equal(picture.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await picture.arrayBuffer()), png);
  assert.equal(
    (
      await request(
        `/api/decks/${id}/assets`,
        "POST",
        Buffer.from("<svg></svg>"),
      )
    ).status,
    400,
  );
  const peer = await connect(other, alice);
  const slide = readSharedDeck(peer.doc).slides[0];
  const elements = peer.doc
    .getMap<Y.Map<unknown>>("slides")
    .get(slide.id)!
    .get("elements") as Y.Map<Y.Map<unknown>>;
  const element = new Y.Map<unknown>();
  elements.set("bad-photo", element);
  for (const [key, value] of Object.entries({
    type: "image",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    src,
    rank: 100,
  }))
    element.set(key, value);
  peer.ws.send(
    JSON.stringify({
      type: "update",
      id: "bad",
      update: toBase64(Y.encodeStateAsUpdate(peer.doc)),
    }),
  );
  await until(() => peer.messages.some((m) => m.type === "error"));
  const state = (await (await request(`/api/decks/${other}`)).json()).state;
  const restored = new Y.Doc();
  Y.applyUpdate(restored, fromBase64(state));
  assert.equal(
    readSharedDeck(restored).slides[0].elements.some(
      (e) => e.id === "bad-photo",
    ),
    false,
  );
  peer.ws.terminate();
  peer.doc.destroy();
  restored.destroy();
});
test("40 authenticated peers merge simultaneous text edits and survive a server restart", async () => {
  const id = await create();
  const inviteResponse = await request(`/api/decks/${id}/invite`, "POST");
  const token = new URL((await inviteResponse.json()).url).searchParams.get(
    "join",
  );
  const cookies: string[] = [];
  for (let i = 0; i < 40; i++) {
    const cookie = await signIn(`student-${i}`);
    cookies.push(cookie);
    assert.equal(
      (await request(`/api/invites/${token}/accept`, "POST", undefined, cookie))
        .status,
      200,
    );
  }
  for (let i = 0; i < 40; i++)
    assert.equal(
      (
        await request(`/api/decks/${id}/members/student-${i}`, "PATCH", {
          mode: "all",
          comment: true,
          rows: [],
          columns: [],
          slides: [],
        })
      ).status,
      200,
    );
  const clients = await Promise.all(
    cookies.map((cookie) => connect(id, cookie)),
  );
  const original = readSharedDeck(clients[0].doc).slides[0],
    element = original.elements[0];
  clients.forEach((client, i) => {
    sharedText(client.doc, original.id, element.id)!.insert(0, `[${i}]`);
    client.ws.send(
      JSON.stringify({
        type: "update",
        id: String(i),
        update: toBase64(Y.encodeStateAsUpdate(client.doc)),
      }),
    );
  });
  await until(() =>
    clients.every(
      (client) =>
        (
          sharedText(client.doc, original.id, element.id)!
            .toString()
            .match(/\[\d+\]/g) ?? []
        ).length === 40,
    ),
  );
  const expected = readSharedDeck(clients[0].doc);
  for (const client of clients) {
    assert.deepEqual(readSharedDeck(client.doc), expected);
    client.ws.terminate();
    client.doc.destroy();
  }
  await request(
    `/api/decks/${id}/comments/77777777-1234-4567-8901-123456789abc`,
    "PUT",
    {
      slide: expected.slides[0].id,
      text: "再起動後も付箋の見た目を保存",
      x: 0.2,
      y: 0.3,
      color: "#d2edff",
      w: 0.37,
      h: 0.43,
    },
  );
  await app.close();
  await start();
  const notesAfter = (await (await request(`/api/decks/${id}/comments`)).json())
    .comments;
  assert.equal(notesAfter[0].color, "#d2edff");
  assert.equal(notesAfter[0].w, 0.37);
  assert.equal(notesAfter[0].h, 0.43);
  const result = await request(`/api/decks/${id}`);
  assert.equal(result.status, 200);
  const restored = new Y.Doc();
  Y.applyUpdate(restored, fromBase64((await result.json()).state));
  assert.deepEqual(readSharedDeck(restored), expected);
  restored.destroy();
});
test("rejects foreign WebSocket origins and invalid updates, without breaking other works", async () => {
  const id = await create();
  const ws = new WebSocket(
    `${base.replace("http", "ws")}/api/decks/${id}/live`,
    { headers: { Origin: "http://evil.test", Cookie: alice } },
  );
  await new Promise<void>((done, fail) => {
    ws.on("unexpected-response", (_req, response) => {
      assert.equal(response.statusCode, 403);
      response.resume();
      ws.terminate();
      done();
    });
    ws.on("error", () => {});
    setTimeout(() => fail(new Error("upgrade timeout")), 2000).unref();
  });
  const peer = await connect(id, alice);
  peer.ws.send("not-json");
  await until(() => peer.messages.some((m) => m.type === "error"));
  assert.equal((await request("/healthz", "GET", undefined, "")).status, 200);
  peer.ws.terminate();
  peer.doc.destroy();
});
test("sign-out revokes active sockets and persisted session access", async () => {
  const cookie = await signIn("eve");
  const response = await request(
    "/api/decks",
    "POST",
    { version: 1, title: "Eve", slides: [blank(0, 0)] },
    cookie,
  );
  const id = (await response.json()).id;
  const peer = await connect(id, cookie),
    closed = once(peer.ws, "close");
  await request("/api/logout", "POST", undefined, cookie);
  assert.equal((await closed)[0], 4001);
  assert.equal(
    (await request(`/api/decks/${id}`, "GET", undefined, cookie)).status,
    401,
  );
  peer.doc.destroy();
});

test("host grants are enforced on live edits; read-only guests can comment but cannot change settings or other authors' notes", async () => {
  const id = await create();
  const made = await request(`/api/decks/${id}/invite`, "POST");
  const token = new URL((await made.json()).url).searchParams.get("join");
  assert.equal(
    (await request(`/api/invites/${token}/accept`, "POST", undefined, bob))
      .status,
    200,
  );
  const initial = (await (
    await request(`/api/decks/${id}`, "GET", undefined, bob)
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
    (await request(`/api/decks/${id}/members/bob`, "PATCH", setting, bob))
      .status,
    404,
  );
  assert.equal(
    (await request(`/api/decks/${id}/members/alice`, "PATCH", setting)).status,
    400,
  );
  const note = await request(
    `/api/decks/${id}/comments`,
    "POST",
    { slide: own.id, text: "いいね", x: 0.3, y: 0.4 },
    bob,
  );
  assert.equal(note.status, 200);
  const notes = (await (
    await request(`/api/decks/${id}/comments`)
  ).json()) as any;
  assert.equal(notes.comments[0].name, "bob");
  assert.equal(notes.comments[0].author, "bob");
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
  const hostNote = both.comments.find((c: any) => c.author === "alice");
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
    (await request(`/api/decks/${id}/comments/${draftId}`, "PUT", edited, bob))
      .status,
    200,
  );
  assert.equal(
    (await request(`/api/decks/${id}/comments/${draftId}`, "PUT", edited, bob))
      .status,
    200,
  );
  const created = (await (
    await request(`/api/decks/${id}/comments`)
  ).json()) as any;
  assert.equal(created.comments.length, 3, "new drafts are created only once");
  assert.equal(
    created.comments.find((c: any) => c.id === draftId).author,
    "bob",
  );
  assert.equal(
    (
      await request(
        `/api/decks/${id}/comments/${draftId}`,
        "DELETE",
        undefined,
        bob,
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
        bob,
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
        bob,
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
        bob,
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
    "bob",
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
        bob,
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
        bob,
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
        bob,
      )
    ).status,
    200,
  );
  const peer = await connect(id, bob);
  assert.equal(
    (await request(`/api/decks/${id}/members/bob`, "PATCH", setting)).status,
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
  const live = await connect(id, bob);
  assert.equal(
    (
      await request(`/api/decks/${id}/members/bob`, "PATCH", {
        ...setting,
        mode: "none",
        comment: false,
      })
    ).status,
    200,
  );

  assert.equal(
    (await request(`/api/decks/${id}/comments/${draftId}`, "PUT", edited, bob))
      .status,
    403,
    "revoked comment permission also prevents updates",
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
        bob,
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
        bob,
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

  const outsider = await signIn("student-82");
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
  const a = await signIn("student-80"),
    b = await signIn("student-81");
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
  const removed = await signIn("student-83");
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
        recipients: [{ email: "alice@example.test", access: grant(0) }],
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
  await app.close();
  await start();
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
