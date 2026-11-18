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
    "INSERT INTO stage1_operators(subject, public_id, added_at, added_by) VALUES(?,?,?,?)",
  ).run("super", "public-super", Date.now(), "super");
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
  const entry = await request("/api/stage1/operate-entry");
  const entryBody = await entry.json();
  assert.equal(entry.status, 200);
  assert.deepEqual(entryBody, { href: "/operate.html" });
  assert.equal(JSON.stringify(entryBody).includes("is_super_admin"), false);
  const operatorDb = new DatabaseSync(join(directory, "vhslide.sqlite"));
  operatorDb
    .prepare(
      "INSERT INTO stage1_operators(subject, public_id, added_at, added_by) VALUES(?,?,?,?)",
    )
    .run("plain", "public-plain", Date.now(), "plain");
  operatorDb.close();
  const hidden = await request(
    "/api/stage1/operate-entry",
    "GET",
    undefined,
    plainCookie,
  );
  assert.equal(hidden.status, 404);
  const cleanup = new DatabaseSync(join(directory, "vhslide.sqlite"));
  cleanup
    .prepare("DELETE FROM stage1_operators WHERE subject=?")
    .run("plain");
  cleanup.close();
  const sessionAfter = await request("/api/session");
  assert.equal(
    JSON.stringify(await sessionAfter.json()).includes("is_super_admin"),
    false,
  );
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
  for (const path of [
    "/api/stage1/operators/add",
    "/api/stage1/operators/revoke",
    "/api/stage1/operators/rotate",
    "/api/stage1/operators/add-by-sign-in",
    "/api/stage1/operators/revoke-by-sign-in",
    "/api/stage1/operators/rotate-by-sign-in",
  ]) {
    const closed = await request(path, "POST", { subject: "added" });
    assert.equal(closed.status, 404, path);
  }
  const issued = await request("/api/stage1/operators/nonce", "POST", {});
  assert.equal(issued.status, 200);
  const nonce = ((await issued.json()) as { nonce: string }).nonce;
  const cookie = `${adminCookie}; ${issued.headers.get("set-cookie")!.split(";")[0]}`;
  const invited = await request(
    "/api/stage1/operators/invitations",
    "POST",
    { credential: `super|${nonce}`, email: "Added@Example.test" },
    cookie,
  );
  const invitedText = await invited.text();
  assert.equal(invited.status, 201, invitedText);
  assert.equal(invitedText.includes("super"), false);
  const invitation = (
    JSON.parse(invitedText) as { invitation: { id: string; email: string } }
  ).invitation;
  assert.equal(invitation.email, "added@example.test");
  const login = await request(
    "/api/auth/google",
    "POST",
    { credential: "added" },
    "",
  );
  assert.equal(login.status, 200);
  const addedCookie = login.headers.get("set-cookie")!.split(";")[0];
  const mine = (await (
    await request("/api/stage1/console", "GET", undefined, addedCookie)
  ).json()) as { myInvitation: { id: string } | null };
  assert.equal(mine.myInvitation?.id, invitation.id);
  const accepted = await request(
    `/api/stage1/operators/invitations/${invitation.id}/accept`,
    "POST",
    {},
    addedCookie,
  );
  const acceptedText = await accepted.text();
  assert.equal(accepted.status, 200, acceptedText);
  assert.equal(acceptedText.includes("added"), false);
  const operators = await request("/api/stage1/operators");
  const operatorText = await operators.text();
  assert.equal(operators.status, 200, operatorText);
  assert.equal(operatorText.includes('"subject"'), false);
  const roster = JSON.parse(operatorText) as {
    operators: { id: string; email: string }[];
    generation: number;
  };
  assert.equal(roster.generation, 1);
  const addedOperator = roster.operators.find(
    (item) => item.email === "added@example.test",
  );
  assert.ok(addedOperator);
  assert.notEqual(addedOperator.id, "added");
  const revokeNonce = await request("/api/stage1/operators/nonce", "POST", {});
  const revokeValue = ((await revokeNonce.json()) as { nonce: string }).nonce;
  const revokeCookie = `${adminCookie}; ${revokeNonce.headers.get("set-cookie")!.split(";")[0]}`;
  const revoked = await request(
    `/api/stage1/operators/${addedOperator.id}/revoke`,
    "POST",
    { credential: `super|${revokeValue}`, expectedGeneration: 1 },
    revokeCookie,
  );
  assert.equal(revoked.status, 200, await revoked.clone().text());
  const lastNonce = await request("/api/stage1/operators/nonce", "POST", {});
  const lastValue = ((await lastNonce.json()) as { nonce: string }).nonce;
  const lastCookie = `${adminCookie}; ${lastNonce.headers.get("set-cookie")!.split(";")[0]}`;
  const operatorsAfter = (await (
    await request("/api/stage1/operators")
  ).json()) as {
    operators: { id: string }[];
  };
  const denied = await request(
    `/api/stage1/operators/${operatorsAfter.operators[0].id}/revoke`,
    "POST",
    { credential: `super|${lastValue}`, expectedGeneration: 2 },
    lastCookie,
  );
  assert.equal(denied.status, 409);
});
