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
let adminCookie: string, applicantCookie: string;

async function start() {
  app = createApplication({
    directory,
    origin,
    clientId: "test-client",
    stage1Features: true,
    verifyIdentity: async (credential) => {
      if (!/^(super|applicant)$/.test(credential)) throw new Error("invalid");
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
  directory = await mkdtemp(join(tmpdir(), "vhslide-stage1-school-admin-http-"));
  await start();
  const superLogin = await request(
    "/api/auth/google",
    "POST",
    { credential: "super" },
    "",
  );
  assert.equal(superLogin.status, 200);
  adminCookie = superLogin.headers.get("set-cookie")!.split(";")[0];
  const applicantLogin = await request(
    "/api/auth/google",
    "POST",
    { credential: "applicant" },
    "",
  );
  assert.equal(applicantLogin.status, 200);
  applicantCookie = applicantLogin.headers.get("set-cookie")!.split(";")[0];
  const db = new DatabaseSync(join(directory, "vhslide.sqlite"));
  db.prepare("UPDATE users SET is_super_admin=1 WHERE id=?").run("super");
  db.prepare(
    "INSERT INTO organizations(id,name,status,created_at) VALUES(?,?,?,?)",
  ).run("org1", "School", "有効", Date.now());
  db.close();
});
after(async () => {
  await app.close();
  await rm(directory, { recursive: true, force: true });
});

test("school-admin apply/appoint/revoke with audit in same flow", async () => {
  const forbidden = await request(
    "/api/school-admin-applications/missing/decide",
    "POST",
    { decision: "登録" },
    applicantCookie,
  );
  assert.equal(forbidden.status, 403);

  const applied = await request(
    "/api/organizations/org1/school-admin-applications",
    "POST",
    {},
    applicantCookie,
  );
  assert.equal(applied.status, 201, await applied.clone().text());
  const applicationId = (
    (await applied.json()) as { application: { id: string } }
  ).application.id;

  const decided = await request(
    `/api/school-admin-applications/${applicationId}/decide`,
    "POST",
    { decision: "登録" },
  );
  assert.equal(decided.status, 200, await decided.clone().text());

  const db = new DatabaseSync(join(directory, "vhslide.sqlite"));
  const member = db
    .prepare(
      "SELECT is_school_admin, role, status FROM organization_members WHERE user_id=? AND organization_id=?",
    )
    .get("applicant", "org1") as {
    is_school_admin: number;
    role: string | null;
    status: string;
  };
  assert.equal(Number(member.is_school_admin), 1);
  assert.equal(member.role, null);
  assert.equal(member.status, "有効");
  assert.ok(
    db
      .prepare("SELECT 1 AS ok FROM audit_log WHERE action=?")
      .get("school_admin.apply"),
  );
  assert.ok(
    db
      .prepare("SELECT 1 AS ok FROM audit_log WHERE action=?")
      .get("school_admin.appoint"),
  );
  db.close();

  const revoked = await request(
    "/api/organizations/org1/school-admins/applicant",
    "DELETE",
  );
  assert.equal(revoked.status, 200);
  const after = new DatabaseSync(join(directory, "vhslide.sqlite"));
  assert.equal(
    Number(
      (
        after
          .prepare(
            "SELECT is_school_admin FROM organization_members WHERE user_id=? AND organization_id=?",
          )
          .get("applicant", "org1") as { is_school_admin: number }
      ).is_school_admin,
    ),
    0,
  );
  assert.ok(
    after
      .prepare("SELECT 1 AS ok FROM audit_log WHERE action=?")
      .get("school_admin.revoke"),
  );
  after.close();
});
