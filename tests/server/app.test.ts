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
  await app.close();
  await start();
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
