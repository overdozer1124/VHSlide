import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createApplication } from "../../server/app.ts";
import {
  applyPlatformApproval,
  issueAdminNonce,
  nodeOperatorSql,
} from "../../src/stage1InitialRegistration.ts";

const origin = "http://vhslide.test";
let directory: string;
let base: string;
let app: ReturnType<typeof createApplication>;

async function start(stage1Features: boolean) {
  app = createApplication({
    directory,
    origin,
    clientId: "test-client",
    stage1Features,
    stage1EnvId: "verify-env",
    verifyIdentity: async (credential) => {
      if (!/^(admin|next)$/.test(credential)) throw new Error("invalid");
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
}

async function request(
  path: string,
  method = "GET",
  value?: unknown,
  cookie = "",
) {
  return fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "vhslide-stage1-initial-"));
  await start(true);
});

after(async () => {
  await app.close();
  await rm(directory, { recursive: true, force: true });
});

test("stage 1 routes stay hidden when the feature is off", async () => {
  const offDir = await mkdtemp(join(tmpdir(), "vhslide-stage1-off-"));
  const off = createApplication({
    directory: offDir,
    origin,
    clientId: "test-client",
    stage1Features: false,
  });
  off.server.listen(0, "127.0.0.1");
  await once(off.server, "listening");
  const offBase = `http://127.0.0.1:${(off.server.address() as { port: number }).port}`;
  try {
    const issued = await fetch(offBase + "/api/stage1/operators/nonce", {
      method: "POST",
      headers: { Origin: origin },
    });
    assert.equal(issued.status, 404);
  } finally {
    await off.close();
    await rm(offDir, { recursive: true, force: true });
  }
});

test("the normal server does not expose the platform route", async () => {
  const hidden = await request("/platform/apply", "POST", {});
  assert.equal(hidden.status, 404);
  const admin = await request("/admin/registry/add", "POST", {});
  assert.equal(admin.status, 404);
});

test("operator nonce, bind, and recovery stay behind the registry", async () => {
  const issued = await request("/api/stage1/operators/nonce", "POST", {});
  assert.equal(issued.status, 200, await issued.clone().text());
  const nonce = ((await issued.json()) as { nonce: string }).nonce;
  const ctx = /vhslide_admin_ctx=([^;]+)/.exec(
    issued.headers.get("set-cookie") || "",
  )?.[1];
  assert.ok(ctx);
  const missing = await request(
    "/api/stage1/operators/verify",
    "POST",
    { credential: `raw-sub-operator|${nonce}` },
    `vhslide_admin_ctx=${ctx}`,
  );
  assert.equal(missing.status, 403, await missing.clone().text());

  const db = new DatabaseSync(join(directory, "vhslide.sqlite"));
  db.exec("PRAGMA busy_timeout=5000");
  const sql = nodeOperatorSql(db);
  const bootNonce = "nonce-bootstrap-1";
  const bootCtx = "b".repeat(43);
  db.exec("BEGIN IMMEDIATE");
  issueAdminNonce(sql, {
    nonce: bootNonce,
    ctxHash: createHash("sha256").update(bootCtx).digest("hex"),
    expiresAt: Date.now() + 60_000,
  });
  applyPlatformApproval(sql, {
    now: Date.now(),
    expiresAt: Date.now() + 60_000,
    operationId: "operation-bootstrap",
    subject: "raw-sub-operator",
    nonce: bootNonce,
    ctxHash: createHash("sha256").update(bootCtx).digest("hex"),
    presented: {
      purpose: "bootstrap",
      envId: "verify-env",
      oneTime: "one-time-secret",
    },
    expected: {
      purpose: "bootstrap",
      envId: "verify-env",
      oneTime: "one-time-secret",
      subject: "raw-sub-operator",
    },
    auditId: "audit-bootstrap-http",
  });
  db.exec("COMMIT");
  db.close();

  const login = await request(
    "/api/auth/google",
    "POST",
    { credential: "admin" },
    "",
  );
  assert.equal(login.status, 200, await login.clone().text());
  const again = await request("/api/stage1/operators/nonce", "POST", {});
  const nonce2 = ((await again.json()) as { nonce: string }).nonce;
  const ctx2 = /vhslide_admin_ctx=([^;]+)/.exec(
    again.headers.get("set-cookie") || "",
  )?.[1];
  const bound = await request(
    "/api/stage1/super-admin/bind",
    "POST",
    {
      credential: `raw-sub-operator|${nonce2}`,
      subject: "admin",
      operationId: "bind-op-http01",
    },
    `vhslide_admin_ctx=${ctx2}`,
  );
  assert.equal(bound.status, 200, await bound.clone().text());
  const body = (await bound.json()) as { is_super_admin?: unknown };
  assert.equal("is_super_admin" in body, false);

  const third = await request("/api/stage1/operators/nonce", "POST", {});
  const nonce3 = ((await third.json()) as { nonce: string }).nonce;
  const ctx3 = /vhslide_admin_ctx=([^;]+)/.exec(
    third.headers.get("set-cookie") || "",
  )?.[1];
  const repeat = await request(
    "/api/stage1/super-admin/bind",
    "POST",
    {
      credential: `raw-sub-operator|${nonce3}`,
      subject: "admin",
      operationId: "bind-op-http02",
    },
    `vhslide_admin_ctx=${ctx3}`,
  );
  assert.equal(repeat.status, 409, await repeat.clone().text());
});
