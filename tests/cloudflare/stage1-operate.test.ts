import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Miniflare } from "miniflare";
import { harness } from "./harness.ts";

const origin = "http://vhslide.test";

test("cloudflare operations console stays closed without the feature and refuses a normal user", async () => {
  const storage = await mkdtemp(join(tmpdir(), "vhslide-cf-operate-"));
  try {
    const off = await harness(storage, origin);
    const offWorker: Miniflare = off.start();
    const hidden = await offWorker.dispatchFetch(
      `${origin}/api/stage1/console`,
      {
        headers: { Origin: origin },
      },
    );
    assert.equal(hidden.status, 404);
    const organizations = await offWorker.dispatchFetch(
      `${origin}/api/organizations`,
      {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "加賀小学校" }),
      },
    );
    assert.equal(organizations.status, 401);
    await offWorker.dispose();

    const fixture = await harness(storage, origin, undefined, {
      STAGE1_FEATURES: "1",
      STAGE1_ENV_ID: "verify-env",
    });
    const mf: Miniflare = fixture.start();
    const login = await mf.dispatchFetch(`${origin}/api/auth/google`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ credential: await fixture.sign("plain") }),
    });
    assert.equal(login.status, 200, await login.clone().text());
    assert.equal(
      (await login.clone().text()).includes("is_super_admin"),
      false,
    );
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const denied = await mf.dispatchFetch(`${origin}/api/organizations`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ name: "加賀小学校" }),
    });
    assert.equal(denied.status, 403, await denied.clone().text());
    const closed = await mf.dispatchFetch(
      `${origin}/api/stage1/operators/add`,
      {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({ subject: "added" }),
      },
    );
    assert.equal(closed.status, 404, await closed.clone().text());
    const entry = await mf.dispatchFetch(`${origin}/api/stage1/operate-entry`, {
      headers: { Origin: origin, Cookie: cookie },
    });
    assert.equal(entry.status, 404, await entry.clone().text());
    assert.equal(
      (await entry.clone().text()).includes("is_super_admin"),
      false,
    );
    const page = await mf.dispatchFetch(`${origin}/operate.html`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.equal(html.includes('data-page="stage1-operate"'), true);
    assert.equal(html.includes("サインアウト"), true);
    assert.equal(html.includes("役割について"), true);
    assert.equal(html.includes("いまのサインイン"), true);
    await mf.dispose();
  } finally {
    await rm(storage, { recursive: true, force: true });
  }
});
