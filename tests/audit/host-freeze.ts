/** Investigation only: synthetic identities, temporary storage, local servers.
 * Uses the frozen dist build; does not rebuild or deploy unfinished UI work. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { createApplication } from "../../server/app.ts";
import { sample } from "../../src/model.ts";
import { harness } from "../cloudflare/harness.ts";

const output = "docs/audit-evidence/host-freeze-2026-10-26";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const results: any[] = [];
try {
  for (const backend of ["node", "cloudflare"] as const) {
    const storage = await mkdtemp(join(tmpdir(), "vhslide-host-freeze-"));
    const origin = "http://127.0.0.1:3188";
    const fixture =
      backend === "cloudflare"
        ? await harness(storage, origin, 3188)
        : undefined;
    const mf = fixture?.start();
    const app =
      backend === "node"
        ? createApplication({
            directory: storage,
            origin,
            clientId: "test.apps.googleusercontent.com",
            verifyIdentity: async (credential) => ({
              id: credential,
              name: credential,
              email: `${credential}@example.test`,
            }),
          })
        : undefined;
    if (app) {
      app.server.listen(3188, "127.0.0.1");
      await once(app.server, "listening");
    }
    if (mf) await mf.ready;
    try {
      for (const scenario of [
        "ordinary",
        "large-map",
        "disconnect",
        "temporary-error",
        "rate-limit",
      ] as const) {
        const context = await browser.newContext({
          viewport: { width: 1366, height: 768 },
        });
        const page = await context.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.route("https://**", (route) => route.abort());
        let connections = 0,
          armed = false,
          injected = false;
        const serverErrors: any[] = [];
        await page.routeWebSocket("**/live", (ws) => {
          connections++;
          const server = ws.connectToServer();
          server.onMessage((message) => {
            if (typeof message === "string") {
              const value = JSON.parse(message);
              if (value.type === "error") serverErrors.push(value);
            }
            ws.send(message);
          });
          ws.onMessage((message) => {
            if (armed && !injected) {
              injected = true;
              if (scenario === "disconnect") {
                ws.close({
                  code: 1011,
                  reason: "local audit transient disconnect",
                });
                return;
              }
              if (scenario === "temporary-error") {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "local audit temporary storage failure",
                  }),
                );
                ws.close({ code: 4002, reason: "local audit" });
                return;
              }
              if (scenario === "rate-limit") {
                // Replay an otherwise valid frame on this same connection.
                // Artificial traffic, not a claim that ordinary UI reaches 1200/min.
                for (let i = 0; i < 1201; i++) server.send(message);
                return;
              }
            }
            server.send(message);
          });
        });
        const identity = `host-${backend}-${scenario}`;
        const credential = fixture ? await fixture.sign(identity) : identity;
        const login = await page.request.post(`${origin}/api/auth/google`, {
          headers: { Origin: origin },
          data: { credential },
        });
        assert.equal(login.status(), 200);
        const book = sample();
        if (scenario === "large-map") {
          const template = book.slides[0];
          book.slides = Array.from({ length: 400 }, (_, i) => ({
            ...structuredClone(template),
            id: crypto.randomUUID(),
            x: i % 10,
            y: Math.floor(i / 10),
            title: i === 0 ? template.title : `synthetic-${i}`,
            elements: template.elements.map((e) => ({
              ...structuredClone(e),
              id: crypto.randomUUID(),
            })),
          }));
        }
        const create = await page.request.post(`${origin}/api/decks`, {
          headers: { Origin: origin },
          data: book,
        });
        assert.equal(create.status(), 201);
        const { id } = await create.json();
        await page.goto(`${origin}/?room=${id}`);
        const presence = page.locator(".cloud-presence");
        await expect(presence).toContainText("クラウドに保存済み", {
          timeout: 15000,
        });
        await page
          .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
          .click();
        const textButton = page
          .locator(".editor-toolbar")
          .getByRole("button", { name: "文字", exact: true });
        await expect(textButton).toBeEnabled();
        armed = true;
        await page.locator(".deck-title").fill(`audit-${scenario}`);
        if (scenario === "ordinary" || scenario === "large-map") {
          for (let i = 0; i < 20; i++) {
            await page.locator(".deck-title").fill(`audit-normal-${i}`);
            await expect
              .poll(async () => {
                const r = await page.request.get(
                  `${origin}/api/decks/${id}/backup`,
                );
                return (await r.json()).deck.title;
              })
              .toBe(`audit-normal-${i}`);
            await expect(presence).toContainText("クラウドに保存済み");
          }
          await expect(textButton).toBeEnabled();
        } else if (scenario === "disconnect") {
          await expect
            .poll(() => connections, { timeout: 15000 })
            .toBeGreaterThan(1);
          await expect(presence).toContainText("クラウドに保存済み");
          await expect(textButton).toBeEnabled();
          const backup = await page.request.get(
            `${origin}/api/decks/${id}/backup`,
          );
          assert.equal((await backup.json()).deck.title, "audit-disconnect");
        } else {
          await expect(presence).toContainText("共有停止", { timeout: 30000 });
          await expect(textButton).toBeDisabled();
          if (scenario === "rate-limit")
            assert.ok(
              serverErrors.some((e) => e.message.includes("操作が多い")),
            );
          const before = connections;
          // Observation window, not a permanent-failure proof by itself;
          // the no-retry conclusion is also established from stopped guards.
          await page.waitForTimeout(3500);
          assert.equal(connections, before);
        }
        const stoppedBeforeReload = await textButton.isDisabled();
        const statusBeforeReload = await presence.innerText();
        const shellInert = await page
          .locator(".app-shell")
          .evaluate((e) => (e as HTMLElement).inert);
        const roleResponse = await page.request.get(
          `${origin}/api/decks/${id}`,
        );
        const role = await roleResponse.json();
        assert.equal(role.owner, identity);
        assert.equal(shellInert, false);
        await page.screenshot({ path: `${output}/${backend}-${scenario}.png` });
        // Verify navigation is still usable: editing rejection is not a full DOM lock.
        await page
          .getByRole("button", { name: "全体マップへ", exact: true })
          .click();
        await expect(page.locator(".map-toolbar")).toBeVisible();
        await page.reload();
        await expect(presence).toContainText(/クラウドに保存済み|共有停止/, {
          timeout: 15000,
        });
        await page
          .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
          .click();
        const reloadRestoresEditControls = await textButton.isEnabled();
        const statusAfterReload = await presence.innerText();
        if (scenario !== "rate-limit")
          assert.equal(reloadRestoresEditControls, true);
        assert.deepEqual(pageErrors, []);
        const row = {
          backend,
          scenario,
          stoppedBeforeReload,
          statusBeforeReload,
          shellInert,
          serverErrors,
          connections,
          reloadRestoresEditControls,
          statusAfterReload,
          navigationWorksWhenStopped: true,
          pageErrors,
        };
        results.push(row);
        console.log(JSON.stringify(row));
        await context.close();
      }
    } finally {
      await app?.close();
      await mf?.dispose();
      await rm(storage, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
  const index = await readFile("dist/index.html");
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        chromium: browser.version(),
        distIndexSha256: createHash("sha256").update(index).digest("hex"),
        results,
      },
      null,
      2,
    ),
  );
}
