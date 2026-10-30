import { test, expect, type Page } from "@playwright/test";
import { sample } from "../../src/model";

async function setup(page: Page, name: string, waitForSync = true) {
  await page.route("https://accounts.google.com/**", (r) => r.abort());
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  const login = await page.request.post("/api/auth/google", {
    headers: { Origin: "http://127.0.0.1:3187" },
    data: { credential },
  });
  expect(login.status()).toBe(200);
  const create = await page.request.post("/api/decks", {
    headers: { Origin: "http://127.0.0.1:3187" },
    data: sample(),
  });
  expect(create.status()).toBe(201);
  const { id } = await create.json();
  await page.goto(`/?room=${id}`);
  await expect(page.locator(".cloud-presence")).toBeVisible();
  if (waitForSync)
    await expect(page.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
  return { id, title: page.locator(".deck-title") };
}
async function titleOnServer(page: Page, id: string) {
  return (await (await page.request.get(`/api/decks/${id}/backup`)).json()).deck
    .title;
}

test("a missing initial handshake has a deadline and preserves edits before synchronization", async ({
  page,
}, info) => {
  await page.clock.install();
  let connections = 0,
    suppressed = 0;
  await page.routeWebSocket("**/live", (ws) => {
    const first = ++connections === 1,
      server = ws.connectToServer();
    server.onMessage((message) => {
      if (first) suppressed++;
      else ws.send(message);
    });
  });
  const { id, title } = await setup(
    page,
    `${info.project.name}-handshake`,
    false,
  );
  await expect.poll(() => suppressed).toBeGreaterThan(1);
  await title.fill("typed before first sync");
  await page.clock.fastForward(20001);
  await expect(
    page.getByRole("button", { name: "接続を再試行", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(1200);
  await expect.poll(() => connections).toBe(2);
  await expect
    .poll(() => titleOnServer(page, id))
    .toBe("typed before first sync");
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
});

for (const failure of [
  "before-save",
  "after-save",
  "silent-ack",
  "rate-limit",
  "rejected",
] as const) {
  test(`host preserves edits and classifies ${failure} without reloading`, async ({
    page,
  }, info) => {
    let connections = 0,
      armed = false,
      injected = false;
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.clock.install();
    await page.routeWebSocket("**/live", (ws) => {
      connections++;
      const server = ws.connectToServer();
      server.onMessage((message) => {
        const ack =
          typeof message === "string" && JSON.parse(message).type === "ack";
        if (
          armed &&
          !injected &&
          ack &&
          (failure === "after-save" || failure === "silent-ack")
        ) {
          injected = true;
          if (failure === "after-save")
            ws.close({ code: 1011, reason: "local lost ACK" });
          return;
        }
        ws.send(message);
      });
      ws.onMessage((message) => {
        if (
          armed &&
          !injected &&
          ["before-save", "rate-limit", "rejected"].includes(failure)
        ) {
          injected = true;
          const retryable = failure !== "rejected";
          ws.send(
            JSON.stringify({
              type: "error",
              message: "local recovery fixture",
              code:
                failure === "rate-limit"
                  ? "rate_limited"
                  : retryable
                    ? "temporarily_unavailable"
                    : "rejected",
              retryable,
              retryAfterMs: failure === "rate-limit" ? 60000 : 1000,
            }),
          );
          ws.close({
            code: retryable ? 1013 : 4002,
            reason: "local recovery fixture",
          });
          return;
        }
        server.send(message);
      });
    });
    const { id, title } = await setup(page, `${info.project.name}-${failure}`);
    if (failure === "before-save") {
      await page
        .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
        .click();
      await expect(page.locator(".workspace-flight")).toHaveCount(0);
    }
    const originalURL = page.url();
    armed = true;
    await title.fill("first unsent change");
    await page.clock.runFor(200);
    await expect.poll(() => injected).toBe(true);
    if (failure === "before-save") {
      await expect(
        page
          .locator(".editor-toolbar")
          .getByRole("button", { name: "文字", exact: true }),
      ).toBeEnabled();
      await expect
        .poll(async () => {
          const r = (await page.locator(".editor-pager").boundingBox())!;
          return r.y + r.height;
        })
        .toBeLessThanOrEqual(page.viewportSize()!.height);
      await page.screenshot({
        path: info.outputPath("editor-reconnection.png"),
      });
    }
    if (failure === "rejected") {
      await expect(page.locator(".cloud-presence")).toContainText("共有停止");
      const count = connections;
      await page.clock.fastForward(90000);
      expect(connections).toBe(count);
      await expect(
        page.getByRole("button", { name: "接続を再試行", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("status", { name: "クラウド接続の状態" }),
      ).toContainText("local recovery fixture");
    } else {
      if (failure === "silent-ack") await page.clock.fastForward(20001);
      await expect(
        page.getByRole("button", { name: "接続を再試行", exact: true }),
      ).toBeVisible();
      await title.fill("latest preserved change");
      await page.clock.runFor(200);
      if (failure === "rate-limit") {
        const count = connections;
        await page
          .getByRole("button", { name: "接続を再試行", exact: true })
          .click();
        await page.clock.fastForward(58000);
        expect(connections).toBe(count);
        await page.clock.fastForward(2200);
      } else await page.clock.fastForward(1200);
      await expect.poll(() => connections).toBeGreaterThan(1);
      await expect
        .poll(() => titleOnServer(page, id))
        .toBe("latest preserved change");
      await expect(page.locator(".cloud-presence")).toContainText(
        "クラウドに保存済み",
      );
      await expect(
        page.getByRole("status", { name: "クラウド接続の状態" }),
      ).toHaveCount(0);
      // Reconnecting must not clear this browser's Yjs UndoManager.
      await page
        .getByRole("button", { name: "もとに戻す", exact: true })
        .click();
      await page.clock.runFor(200);
      await expect
        .poll(() => titleOnServer(page, id))
        .not.toBe("latest preserved change");
    }
    expect(page.url()).toBe(originalURL);
    expect(pageErrors).toEqual([]);
  });
}

test("bounded retries can be resumed without discarding the pending document", async ({
  page,
}, info) => {
  await page.clock.install();
  let failures = 0,
    reject = false;
  await page.routeWebSocket("**/live", (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (reject) {
        failures++;
        ws.send(
          JSON.stringify({
            type: "error",
            code: "temporarily_unavailable",
            retryable: true,
            retryAfterMs: 1000,
            message: "local repeated failure",
          }),
        );
        ws.close({ code: 1013 });
      } else server.send(message);
    });
  });
  const { id, title } = await setup(page, `${info.project.name}-bounded`);
  reject = true;
  await title.fill("preserve across all attempts");
  await page.clock.runFor(200);
  for (let i = 1; i <= 6; i++) {
    await expect.poll(() => failures).toBe(i);
    await page.clock.fastForward(1000 * 2 ** (i - 1) + 10);
  }
  await expect.poll(() => failures).toBe(7);
  await expect(page.locator(".cloud-presence")).toContainText("共有停止");
  await page.clock.fastForward(90000);
  expect(failures).toBe(7);
  reject = false;
  await page.getByRole("button", { name: "接続を再試行", exact: true }).click();
  await page.clock.fastForward(1200);
  await expect
    .poll(() => titleOnServer(page, id))
    .toBe("preserve across all attempts");
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
});
