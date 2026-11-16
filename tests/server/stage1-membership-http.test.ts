import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createApplication } from "../../server/app.ts";

const origin = "http://vhslide.test";
let directory: string, base: string, app: ReturnType<typeof createApplication>;
let adminCookie: string;

async function start() {
  app = createApplication({
    directory,
    origin,
    clientId: "test-client",
    stage1Features: true,
    verifyIdentity: async (credential) => {
      if (!/^(admin|member)$/.test(credential)) throw new Error("invalid");
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
  cookie = adminCookie,
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
  directory = await mkdtemp(join(tmpdir(), "vhslide-stage1-membership-http-"));
  await start();
  const login = await request(
    "/api/auth/google",
    "POST",
    { credential: "admin" },
    "",
  );
  assert.equal(login.status, 200);
  adminCookie = login.headers.get("set-cookie")!.split(";")[0];
  await request("/api/auth/google", "POST", { credential: "member" }, "");
  const db = new DatabaseSync(join(directory, "vhslide.sqlite"));
  db.prepare(
    "INSERT INTO organizations(id,name,status,created_at) VALUES(?,?,?,?)",
  ).run("org1", "School", "有効", Date.now());
  db.prepare(
    `INSERT INTO organization_members(user_id,organization_id,role,is_school_admin,can_create_space,status,generation,created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run("admin", "org1", "teacher", 1, 0, "有効", 1, Date.now());
  db.prepare(
    `INSERT INTO organization_members(user_id,organization_id,role,is_school_admin,can_create_space,status,generation,created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run("member", "org1", "student", 1, 1, "有効", 1, Date.now());
  db.close();
});
after(async () => {
  await app.close();
  await rm(directory, { recursive: true, force: true });
});

test("membership invalidate/reactivate bumps generation and writes audit", async () => {
  const invalidated = await request(
    "/api/organizations/org1/members/member/invalidate",
    "POST",
    {},
  );
  assert.equal(invalidated.status, 200, await invalidated.clone().text());
  const body = (await invalidated.json()) as { generation: number };
  assert.equal(body.generation, 2);

  const db = new DatabaseSync(join(directory, "vhslide.sqlite"));
  const row = db
    .prepare(
      "SELECT status, generation FROM organization_members WHERE user_id=? AND organization_id=?",
    )
    .get("member", "org1") as { status: string; generation: number };
  assert.equal(row.status, "無効");
  assert.equal(Number(row.generation), 2);
  assert.ok(
    db
      .prepare("SELECT 1 AS ok FROM audit_log WHERE action=?")
      .get("membership.invalidate"),
  );
  db.close();

  const again = await request(
    "/api/organizations/org1/members/member/invalidate",
    "POST",
    {},
  );
  assert.equal(again.status, 404);

  const restored = await request(
    "/api/organizations/org1/members/member/reactivate",
    "POST",
    { role: "teacher" },
  );
  assert.equal(restored.status, 200, await restored.clone().text());
  const restoredBody = (await restored.json()) as {
    member: { status: string; generation: number; role: string };
  };
  assert.equal(restoredBody.member.status, "有効");
  assert.equal(Number(restoredBody.member.generation), 2);
  assert.equal(restoredBody.member.role, "teacher");

  const after = new DatabaseSync(join(directory, "vhslide.sqlite"));
  const flags = after
    .prepare(
      "SELECT is_school_admin, can_create_space FROM organization_members WHERE user_id=? AND organization_id=?",
    )
    .get("member", "org1") as {
    is_school_admin: number;
    can_create_space: number;
  };
  assert.equal(Number(flags.is_school_admin), 0);
  assert.equal(Number(flags.can_create_space), 0);
  assert.ok(
    after
      .prepare("SELECT 1 AS ok FROM audit_log WHERE action=?")
      .get("membership.reactivate"),
  );
  after.close();
});
