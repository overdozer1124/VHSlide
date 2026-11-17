import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createApplication } from "../../server/app.ts";
import { sample } from "../../src/model.ts";

const origin = "http://vhslide.test";
let directory: string, base: string, app: ReturnType<typeof createApplication>;
let alice: string;

async function start(stage1Features: boolean) {
  app = createApplication({
    directory,
    origin,
    clientId: "test-client",
    stage1Features,
    verifyIdentity: async (credential) => {
      if (credential !== "alice") throw new Error("invalid");
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
) {
  return fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie ?? "",
      "Content-Type": "application/json",
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "vhslide-stage1-cap-"));
});
after(async () => {
  if (app) await app.close();
  await rm(directory, { recursive: true, force: true });
});

test("capabilities is hidden unless stage1 features are on", async () => {
  await start(false);
  const login = await request(
    "/api/auth/google",
    "POST",
    { credential: "alice" },
    "",
  );
  assert.equal(login.status, 200);
  alice = login.headers.get("set-cookie")!.split(";")[0];
  const created = await request("/api/decks", "POST", sample());
  assert.equal(created.status, 201);
  const id = (await created.json()).id as string;
  assert.equal((await request(`/api/decks/${id}/capabilities`)).status, 404);
  await app.close();

  await start(true);
  const again = await request(
    "/api/auth/google",
    "POST",
    { credential: "alice" },
    "",
  );
  alice = again.headers.get("set-cookie")!.split(";")[0];
  const listed = await (await request("/api/decks")).json();
  assert.ok(listed.decks?.length);
  const response = await request(
    `/api/decks/${listed.decks[0].id}/capabilities`,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.kind, "general");
  assert.equal(body.host, true);
  assert.equal(body.member, true);
  assert.equal(body.userId, "alice");
  assert.equal(body.access.mode, "all");
  assert.equal("is_super_admin" in body, false);
});
