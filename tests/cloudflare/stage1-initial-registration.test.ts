import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Miniflare } from "miniflare";
import { harness } from "./harness.ts";

const origin = "http://vhslide.test";

test("cloudflare verify worker routes reject platform apply and unknown operators", async () => {
  const storage = await mkdtemp(join(tmpdir(), "vhslide-cf-initial-"));
  const fixture = await harness(storage, origin, undefined, {
    STAGE1_FEATURES: "1",
    STAGE1_ENV_ID: "verify-env",
  });
  const mf: Miniflare = fixture.start();
  try {
    const hidden = await mf.dispatchFetch(`${origin}/platform/apply`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(hidden.status, 404);

    const issued = await mf.dispatchFetch(
      `${origin}/api/stage1/operators/nonce`,
      { method: "POST", headers: { Origin: origin } },
    );
    assert.equal(issued.status, 200, await issued.clone().text());
    const nonce = ((await issued.json()) as { nonce: string }).nonce;
    const cookie = issued.headers.get("set-cookie") || "";
    assert.match(cookie, /vhslide_admin_ctx=/);
    const denied = await mf.dispatchFetch(
      `${origin}/api/stage1/operators/verify`,
      {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({
          credential: await fixture.sign("raw-sub-operator", undefined, {
            nonce,
          }),
        }),
      },
    );
    assert.equal(denied.status, 403, await denied.clone().text());
  } finally {
    await mf.dispose();
    await rm(storage, { recursive: true, force: true });
  }
});

test("operator routes stay hidden when stage 1 is off", async () => {
  const storage = await mkdtemp(join(tmpdir(), "vhslide-cf-initial-off-"));
  const fixture = await harness(storage, origin);
  const mf = fixture.start();
  try {
    const issued = await mf.dispatchFetch(
      `${origin}/api/stage1/operators/nonce`,
      { method: "POST", headers: { Origin: origin } },
    );
    assert.equal(issued.status, 404);
  } finally {
    await mf.dispose();
    await rm(storage, { recursive: true, force: true });
  }
});
