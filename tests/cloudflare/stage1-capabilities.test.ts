import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Miniflare } from "miniflare";
import { harness } from "./harness.ts";
import { sample } from "../../src/model.ts";

const origin = "http://vhslide.test";
let storage: string;
let fixture: Awaited<ReturnType<typeof harness>>;
let mf: Miniflare;
let owner: string;

async function request(
  path: string,
  method = "GET",
  value?: unknown,
  cookie = owner,
) {
  return mf.dispatchFetch(origin + path, {
    method,
    headers: { Origin: origin, Cookie: cookie || "" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
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

before(async () => {
  storage = await mkdtemp(join(tmpdir(), "vhslide-cf-stage1-cap-"));
});
after(async () => {
  if (mf) await mf.dispose();
  await rm(storage, { recursive: true, force: true });
});

test("cloudflare capabilities is 404 unless STAGE1_FEATURES is on", async () => {
  fixture = await harness(storage, origin);
  mf = await fixture.start();
  owner = await login("owner");
  const created = await request("/api/decks", "POST", sample());
  assert.equal(created.status, 201, await created.clone().text());
  const id = ((await created.json()) as { id: string }).id;
  assert.equal((await request(`/api/decks/${id}/capabilities`)).status, 404);
  await mf.dispose();

  fixture = await harness(storage, origin, undefined, {
    STAGE1_FEATURES: "1",
  });
  mf = await fixture.start();
  owner = await login("owner");
  const listed = (await (await request("/api/decks")).json()) as {
    decks: { id: string }[];
  };
  assert.ok(listed.decks?.length);
  const response = await request(
    `/api/decks/${listed.decks[0].id}/capabilities`,
  );
  assert.equal(response.status, 200, await response.clone().text());
  const body = (await response.json()) as {
    kind: string;
    host: boolean;
    member: boolean;
    userId: string;
    access: { mode: string };
    is_super_admin?: unknown;
  };
  assert.equal(body.kind, "general");
  assert.equal(body.host, true);
  assert.equal(body.member, true);
  assert.equal(body.userId, "owner");
  assert.equal(body.access.mode, "all");
  assert.equal("is_super_admin" in body, false);
});
