import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Miniflare } from "miniflare";
import { harness } from "./harness.ts";

const origin = "http://vhslide.test";
const scriptPath = ".wrangler-platform-temporary/platform-temporary.js";
const oneTime = "platform-one-time-test";
const subject = "raw-sub-operator";

test("temporary platform build applies bootstrap inside one transaction", async () => {
  const storage = await mkdtemp(join(tmpdir(), "vhslide-cf-platform-"));
  const fixture = await harness(
    storage,
    origin,
    undefined,
    {
      STAGE1_FEATURES: "1",
      STAGE1_ENV_ID: "verify-env",
      STAGE1_PURPOSE: "bootstrap",
      STAGE1_OPERATION_ID: "op-bootstrap-test",
      STAGE1_EXPIRES_AT: String(Date.now() + 60 * 60_000),
      STAGE1_SUBJECT: subject,
      STAGE1_ONE_TIME: oneTime,
    },
    scriptPath,
  );
  const mf: Miniflare = fixture.start();
  try {
    const issued = await mf.dispatchFetch(
      `${origin}/api/stage1/operators/nonce`,
      { method: "POST", headers: { Origin: origin } },
    );
    assert.equal(issued.status, 200, await issued.clone().text());
    const nonce = ((await issued.json()) as { nonce: string }).nonce;
    const cookie = issued.headers.get("set-cookie") || "";
    const credential = await fixture.sign(subject, undefined, { nonce });
    const send = (body: Record<string, string>, token = credential) =>
      mf.dispatchFetch(`${origin}/platform/apply`, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ credential: token, ...body }),
      });
    const wrongSubject = await send(
      {
        purpose: "bootstrap",
        envId: "verify-env",
        oneTime,
      },
      await fixture.sign("raw-sub-other", undefined, { nonce }),
    );
    assert.equal(wrongSubject.status, 403, await wrongSubject.clone().text());
    const wrongValue = await send({
      purpose: "bootstrap",
      envId: "verify-env",
      oneTime: "wrong-value",
    });
    assert.equal(wrongValue.status, 403, await wrongValue.clone().text());
    const applied = await send({
      purpose: "bootstrap",
      envId: "verify-env",
      oneTime,
    });
    assert.equal(applied.status, 200, await applied.clone().text());
    assert.deepEqual(await applied.json(), { generation: 1 });
    const issuedAgain = await mf.dispatchFetch(
      `${origin}/api/stage1/operators/nonce`,
      { method: "POST", headers: { Origin: origin } },
    );
    const nonceAgain = ((await issuedAgain.json()) as { nonce: string }).nonce;
    const again = await mf.dispatchFetch(`${origin}/platform/apply`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: issuedAgain.headers.get("set-cookie") || "",
      },
      body: JSON.stringify({
        credential: await fixture.sign(subject, undefined, {
          nonce: nonceAgain,
        }),
        purpose: "bootstrap",
        envId: "verify-env",
        oneTime,
      }),
    });
    assert.equal(again.status, 409, await again.clone().text());
    const hidden = await mf.dispatchFetch(`${origin}/admin/operators`, {
      method: "POST",
      headers: { Origin: origin },
    });
    assert.equal(hidden.status, 404);
  } finally {
    await mf.dispose();
    await rm(storage, { recursive: true, force: true });
  }
});
