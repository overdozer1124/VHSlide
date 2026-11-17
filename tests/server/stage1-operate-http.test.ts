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
let adminCookie: string, plainCookie: string;

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
  directory = await mkdtemp(join(tmpdir(), "vhslide-stage1-operate-"));
  app = createApplication({
    directory,
    origin,
    clientId: "test-client",
    stage1Features: true,
    stage1EnvId: "verify-env",
    verifyIdentity: async (credential) => {
      if (!/^(super|plain|added)$/.test(credential)) throw new Error("invalid");
      return {
        id: credential,
        name: credential,
        email: `${credential}@example.test`,
      };
    },
    verifyOperatorCredential: async (credential) => {
      const [sub, nonce] = credential.split("|");
      if (!sub || !nonce) throw new Error("invalid");
      return { sub, nonce };
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  for (const id of ["super", "plain"]) {
    const login = await request(
      "/api/auth/google",
      "POST",
      { credential: id },
      "",
    );
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    if (id === "super") adminCookie = cookie;
    else plainCookie = cookie;
  }
  const db = new DatabaseSync(join(directory, "vhslide.sqlite"));
  db.prepare("UPDATE users SET is_super_admin=1 WHERE id=?").run("super");
  db.prepare(
    "INSERT INTO stage1_operators(subject, added_at, added_by) VALUES(?,?,?)",
  ).run("super", Date.now(), "super");
  db.close();
});

after(async () => {
  await app.close();
  await rm(directory, { recursive: true, force: true });
});

test("session stays free of the super-admin flag and only a super admin creates a school", async () => {
  const session = await request("/api/session");
  const sessionBody = await session.json();
  assert.equal(JSON.stringify(sessionBody).includes("is_super_admin"), false);
  const denied = await request(
    "/api/organizations",
    "POST",
    { name: "加賀小学校" },
    plainCookie,
  );
  assert.equal(denied.status, 403);
  const created = await request("/api/organizations", "POST", {
    name: " 加賀小学校 ",
  });
  assert.equal(created.status, 201, await created.clone().text());
  const school = (
    (await created.json()) as { school: { id: string; name: string } }
  ).school;
  assert.equal(school.name, "加賀小学校");
  const view = (await (await request("/api/stage1/console")).json()) as {
    createSchool: boolean;
    schools: { id: string }[];
  };
  assert.equal(view.createSchool, true);
  assert.equal(view.schools[0]?.id, school.id);
  assert.equal(JSON.stringify(view).includes("is_super_admin"), false);
  const plain = await request(
    "/api/stage1/console",
    "GET",
    undefined,
    plainCookie,
  );
  const plainView = await plain.json();
  assert.equal((plainView as { createSchool: boolean }).createSchool, false);
  assert.deepEqual((plainView as { applyTo: { name: string }[] }).applyTo, [
    { id: school.id, name: "加賀小学校" },
  ]);
});

test("lists stay on public columns and operator sign-in does not return a subject", async () => {
  const schools = (await (await request("/api/organizations")).json()) as {
    schools: { id: string }[];
  };
  const id = schools.schools[0].id;
  const applied = await request(
    `/api/organizations/${id}/school-admin-applications`,
    "POST",
    {},
    plainCookie,
  );
  assert.equal(applied.status, 201, await applied.clone().text());
  const listed = await request(
    `/api/organizations/${id}/school-admin-applications`,
  );
  const applications = (await listed.json()) as {
    applications: { applicant: { email: string } }[];
  };
  assert.equal(
    applications.applications[0]?.applicant.email,
    "plain@example.test",
  );
  assert.equal(JSON.stringify(applications).includes("is_super_admin"), false);
  const issued = await request("/api/stage1/operators/nonce", "POST", {});
  assert.equal(issued.status, 200);
  const nonce = ((await issued.json()) as { nonce: string }).nonce;
  const cookie = `${adminCookie}; ${issued.headers.get("set-cookie")!.split(";")[0]}`;
  const added = await request(
    "/api/stage1/operators/add-by-sign-in",
    "POST",
    {
      credential: `super|${nonce}`,
      targetCredential: `added|${nonce}`,
      expectedGeneration: 0,
    },
    cookie,
  );
  const addedText = await added.text();
  assert.equal(added.status, 200, addedText);
  assert.equal(addedText.includes("added"), false);
  const db = new DatabaseSync(join(directory, "vhslide.sqlite"));
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM stage1_operators WHERE subject=?")
        .get("added") as { n: number }
    ).n,
    1,
  );
  db.close();
});
