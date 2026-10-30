/** Synthetic local browser checks; never contacts a production room. */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import {
  chromium,
  expect,
  request as playwrightRequest,
} from "@playwright/test";
import { createApplication } from "../../server/app.ts";
import { sample } from "../../src/model.ts";
import * as Y from "yjs";
import { readSharedDeck } from "../../src/sharedDeck.ts";
const temp = await mkdtemp(join(tmpdir(), "vhslide-privacy-browser-")),
  base = "http://127.0.0.1:3188";
const app = createApplication({
  directory: temp,
  origin: base,
  clientId: "privacy-test",
  verifyIdentity: async (credential) => ({
    id: credential,
    name: credential,
    email: `${credential}@example.test`,
  }),
});
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  app.server.listen(3188, "127.0.0.1");
  await once(app.server, "listening");
  const context = await browser.newContext(),
    page = await context.newPage();
  const outgoing: string[] = [];
  page.on("request", (r) => outgoing.push(r.url()));
  await page.route("https://accounts.google.com/gsi/client", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "window.google={accounts:{id:{initialize(){},renderButton(){}}}}",
    }),
  );
  await page.goto(base);
  const headers = { Origin: base };
  assert.equal(
    (
      await page.request.post(base + "/api/auth/google", {
        headers,
        data: { credential: "privacy-student-a" },
      })
    ).status(),
    200,
  );
  const book = sample();
  book.title = "FICTIONAL_CACHE_TITLE";
  book.slides[0].elements[0].text =
    '<img src="https://privacy-attacker.invalid/leak" onerror="window.privacyExecuted=true">';
  const photo = await readFile(
    new URL("./fixtures/privacy-photo.jpg", import.meta.url),
  );
  book.slides[0].elements.push({
    id: "privacy-jpeg",
    type: "image",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    src: `data:image/jpeg;base64,${photo.toString("base64")}`,
  });
  const create = await page.request.post(base + "/api/decks", {
    headers,
    data: book,
  });
  assert.equal(create.status(), 201);
  const { id } = await create.json();
  const inviteResponse = await page.request.post(
    base + `/api/decks/${id}/invite`,
    { headers },
  );
  const joinToken = new URL((await inviteResponse.json()).url).searchParams.get(
    "join",
  )!;
  await page.goto(base + "/?room=" + id);
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  await page.locator(".deck-title").fill("FICTIONAL_CACHE_TITLE_UPDATED");
  await expect
    .poll(async () => {
      const r = await page.request.get(base + `/api/decks/${id}/backup`);
      return (await r.json()).deck.title;
    })
    .toBe("FICTIONAL_CACHE_TITLE_UPDATED");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const r = indexedDB.open("vhslide-cloud", 1);
            r.onsuccess = () => {
              const q = r.result
                .transaction("documents")
                .objectStore("documents")
                .count();
              q.onsuccess = () => {
                resolve(q.result);
                r.result.close();
              };
            };
            r.onerror = () => reject(r.error);
          }),
      ),
    )
    .toBeGreaterThan(0);
  assert.equal(
    await page.evaluate(() => (window as any).privacyExecuted),
    undefined,
  );
  assert.equal(
    outgoing.some((u) => u.includes("privacy-attacker.invalid")),
    false,
  );
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  // Offline sign-out is refused by the application before contacting the server.
  await context.setOffline(true);
  await expect(page.locator(".cloud-presence")).toContainText("再接続中");
  await page.getByRole("button", { name: "サインアウト", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("保存の完了を待つか");
  assert.ok(
    (await context.cookies()).some((c) => c.name === "vhslide_session"),
  );
  await context.setOffline(false);
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  await page.getByRole("button", { name: "サインアウト", exact: true }).click();
  await expect(page.locator(".cloud-presence")).toHaveCount(0);
  const session = await (await page.request.get(base + "/api/session")).json();
  assert.equal(session.user, null);
  const residual = await page.evaluate(async () => {
    const local = Object.keys(localStorage)
      .filter((k) => k.startsWith("vhslide-cloud-deck:"))
      .map((k) => ({
        key: k,
        privateMarkerPresent: localStorage
          .getItem(k)!
          .includes("FICTIONAL_CACHE_TITLE_UPDATED"),
      }));
    const cache = await new Promise<any[]>((resolve, reject) => {
      const r = indexedDB.open("vhslide-cloud", 1);
      r.onsuccess = () => {
        const db = r.result,
          t = db.transaction("documents"),
          s = t.objectStore("documents"),
          keys = s.getAllKeys(),
          values = s.getAll();
        t.oncomplete = () => {
          resolve(
            values.result.map((v, i) => ({
              key: String(keys.result[i]),
              raw: Array.from(v.data ?? v) as number[],
            })),
          );
          db.close();
        };
        t.onerror = () => reject(t.error);
      };
      r.onerror = () => reject(r.error);
    });
    return { local, cache };
  });
  for (const entry of residual.cache) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Uint8Array.from(entry.raw));
    entry.privateMarkerPresent = readSharedDeck(doc).title.startsWith(
      "FICTIONAL_CACHE_TITLE",
    );
    entry.byteLength = entry.raw.length;
    delete entry.raw;
    doc.destroy();
  }
  assert.ok(residual.local.some((x) => x.privateMarkerPresent));
  assert.ok(residual.cache.some((x) => x.privateMarkerPresent));
  assert.equal(
    (
      await page.request.post(base + "/api/auth/google", {
        headers,
        data: { credential: "privacy-student-b" },
      })
    ).status(),
    200,
  );
  await page.reload();
  assert.equal(
    (await page.request.get(base + `/api/decks/${id}`)).status(),
    404,
  );
  const canStillInspect = await page.evaluate(() =>
    Object.keys(localStorage).some(
      (k) =>
        k.startsWith("vhslide-cloud-deck:") &&
        localStorage.getItem(k)!.includes("FICTIONAL_CACHE_TITLE_UPDATED"),
    ),
  );
  assert.equal(canStillInspect, true);
  const pending = await page.request.post(
    base + `/api/invites/${joinToken}/accept`,
    { headers },
  );
  assert.equal(pending.status(), 202);
  const { requestId } = await pending.json();
  assert.equal(
    (await page.request.get(base + `/api/decks/${id}`)).status(),
    404,
  );
  const teacher = await playwrightRequest.newContext();
  try {
    assert.equal(
      (
        await teacher.post(base + "/api/auth/google", {
          headers,
          data: { credential: "privacy-student-a" },
        })
      ).status(),
      200,
    );
    assert.equal(
      (
        await teacher.post(base + `/api/decks/${id}/join-requests/approve`, {
          headers,
          data: { requestIds: [requestId] },
        })
      ).status(),
      200,
    );
  } finally {
    await teacher.dispose();
  }
  await page.goto(base + "/?room=" + id);
  await expect(page.locator(".cloud-presence")).toContainText("閲覧のみ");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const download = await downloading,
    exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  assert.equal(exported.title, "FICTIONAL_CACHE_TITLE_UPDATED");
  assert.ok(
    exported.slides[0].elements.some((e: any) =>
      e.text?.includes("privacy-attacker.invalid"),
    ),
  );
  const image = exported.slides[0].elements.find(
    (e: any) => e.id === "privacy-jpeg",
  );
  assert.ok(image.src.startsWith("data:image/jpeg;base64,"));
  assert.deepEqual(Buffer.from(image.src.split(",")[1], "base64"), photo);

  const result = {
    environment:
      "Linux Chromium, independent local Node server, fictional students",
    logoutInvalidatesServerSession: true,
    invitationRequiresHostApproval: true,
    plainTextMarkupDidNotExecute: true,
    noAttackerDomainRequest: true,
    readOnlyMemberCanExportFullJSONWithOriginalPhotos: true,
    offlineLogoutRefused: true,
    nextUserCannotReadThroughServer: true,
    nextUserCanReadPreviousUsersLocalStorage: true,
    residual,
  };
  await writeFile(
    "/tmp/vhslide-privacy-browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  await context.close();
} finally {
  await browser.close();
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
