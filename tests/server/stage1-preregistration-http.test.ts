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
let admin: string;

async function start() {
  app = createApplication({
    directory,
    origin,
    clientId: "test-client",
    stage1Features: true,
    verifyIdentity: async (credential) => {
      if (!/^(admin|student)$/.test(credential)) throw new Error("invalid");
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
  cookie = admin,
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
  directory = await mkdtemp(join(tmpdir(), "vhslide-stage1-prereg-http-"));
  await start();
  const login = await request(
    "/api/auth/google",
    "POST",
    { credential: "admin" },
    "",
  );
  assert.equal(login.status, 200);
  admin = login.headers.get("set-cookie")!.split(";")[0];
  const db = new DatabaseSync(join(directory, "vhslide.sqlite"));
  db.prepare(
    "INSERT INTO organizations(id,name,status,created_at) VALUES(?,?,?,?)",
  ).run("org1", "School", "有効", Date.now());
  db.prepare(
    `INSERT INTO organization_members(user_id,organization_id,role,is_school_admin,can_create_space,status,generation,created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run("admin", "org1", "teacher", 1, 0, "有効", 1, Date.now());
  db.close();
});
after(async () => {
  await app.close();
  await rm(directory, { recursive: true, force: true });
});

test("preregistration HTTP create/cancel with audit, then bind on login", async () => {
  const created = await request(
    "/api/organizations/org1/preregistrations",
    "POST",
    {
      email: "student@example.test",
      plannedRole: "student",
      plannedIsSchoolAdmin: true,
      plannedCanCreateSpace: true,
    },
  );
  assert.equal(created.status, 201, await created.clone().text());
  const body = (await created.json()) as {
    preregistration: { id: string; planned_is_school_admin: number };
  };
  assert.equal(body.preregistration.planned_is_school_admin, 1);

  const db = new DatabaseSync(join(directory, "vhslide.sqlite"));
  assert.equal(
    (
      db
        .prepare("SELECT action FROM audit_log WHERE action=?")
        .get("preregistration.create") as { action: string }
    ).action,
    "preregistration.create",
  );
  db.close();

  const studentLogin = await request(
    "/api/auth/google",
    "POST",
    { credential: "student" },
    "",
  );
  assert.equal(studentLogin.status, 200);
  const memberDb = new DatabaseSync(join(directory, "vhslide.sqlite"));
  const member = memberDb
    .prepare(
      "SELECT role, is_school_admin, can_create_space, status FROM organization_members WHERE user_id=? AND organization_id=?",
    )
    .get("student", "org1") as Record<string, unknown>;
  expectMember(member);
  memberDb.close();
});

test("preregistration cancel writes audit and blocks later bind", async () => {
  const created = await request(
    "/api/organizations/org1/preregistrations",
    "POST",
    { email: "other@example.test", plannedRole: "teacher" },
  );
  assert.equal(created.status, 201);
  const id = ((await created.json()) as { preregistration: { id: string } })
    .preregistration.id;
  const cancelled = await request(`/api/preregistrations/${id}`, "DELETE");
  assert.equal(cancelled.status, 200);
  const db = new DatabaseSync(join(directory, "vhslide.sqlite"));
  assert.ok(
    db
      .prepare("SELECT 1 AS ok FROM audit_log WHERE action=?")
      .get("preregistration.cancel"),
  );
  assert.equal(
    (
      db.prepare("SELECT status FROM preregistrations WHERE id=?").get(id) as {
        status: string;
      }
    ).status,
    "取消",
  );
  db.close();
});

function expectMember(member: Record<string, unknown>) {
  assert.equal(member.role, "student");
  assert.equal(Number(member.is_school_admin), 0);
  assert.equal(Number(member.can_create_space), 1);
  assert.equal(member.status, "有効");
}
