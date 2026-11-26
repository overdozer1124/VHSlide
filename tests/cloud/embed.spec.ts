import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blank } from "../../src/model";
const headers = { Origin: "http://127.0.0.1:3187" };
async function signIn(page: Page, name: string) {
  // The Cloudflare backend verifies real Google JWTs, so the test
  // harness issues a signed token per fixture name (same pattern as
  // scopeCloud's scopeLogin); the Node backend takes the bare name.
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential },
      })
    ).status(),
  ).toBe(200);
}

async function savedEmbed(page: Page, id: string) {
  const backup = await page.request.get(`/api/decks/${id}/backup`);
  const deck = (await backup.json()).deck;
  const element = deck.slides[0].elements.find(
    (e: { embed?: { url: string; poster?: string } }) => e.embed,
  );
  return element?.embed as
    | { url: string; poster?: string }
    | undefined;
}

// The framed app page served instead of example.com: a small DOM app with
// the REAL embed bridge inlined, so the test covers the whole snapshot
// protocol (request -> self-capture -> postMessage -> saved poster).
const bridgePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../textmine/assets/v1/embed-bridge.js",
);
const bridgeSource = existsSync(bridgePath)
  ? readFileSync(bridgePath, "utf8")
  : null;
const framedApp = bridgeSource
  ? `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;font-family:sans-serif}h1{background:#2f6a45;color:#ffffff;padding:24px;margin:0}p{padding:16px;font-size:20px;color:#263d39}</style>
</head><body><h1>テストアプリ</h1><p>これは埋め込み用の画面です。</p>
<p id="count">0</p><button id="inc" type="button">増やす</button>
<script>document.getElementById("inc").addEventListener("click",()=>{var c=document.getElementById("count");c.textContent=String(Number(c.textContent)+1);});</script>
<script>${bridgeSource}</script></body></html>`
  : "";

test("host embeds a web app, its thumbnail is captured once, guests just view", async ({
  page,
  browser,
}, info) => {
  test.skip(!bridgeSource, "textmine bridge build is missing");
  test.setTimeout(120_000);
  const context = await browser.newContext(info.project.use);
  const guest = await context.newPage();
  try {
    await signIn(page, "embed-host");
    await signIn(guest, "embed-guest");
    const created = await page.request.post("/api/decks", {
      headers,
      data: { version: 1, title: "アプリ埋め込み", slides: [blank(0, 0)] },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const invite = await page.request.post(`/api/decks/${id}/invite`, {
      headers,
    });
    const token = new URL((await invite.json()).url).searchParams.get("join");
    const accepted = await guest.request.post(`/api/invites/${token}/accept`, {
      headers,
    });
    const join = await accepted.json();
    if (join.requestId)
      expect(
        (
          await page.request.post(`/api/decks/${id}/join-requests/approve`, {
            headers,
            data: { requestIds: [join.requestId] },
          })
        ).status(),
      ).toBe(200);

    await page.route("https://example.com/app", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: framedApp,
      });
    });

    await page.goto(`/?room=${id}`);
    await page
      .getByRole("button", { name: "フォーム", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "アンケート", exact: true });
    await dialog.getByRole("tab", { name: "アプリ" }).click();
    const appDialog = page.getByRole("dialog", { name: "アプリ", exact: true });
    // The own-app preset fills the URL field.
    await appDialog
      .getByRole("button", { name: /テキストマイニング/ })
      .click();
    await expect(
      appDialog.getByLabel("埋め込むアプリのURL"),
    ).toHaveValue("https://vhslide-textmine.overdozer1124.workers.dev/");
    await appDialog
      .getByLabel("埋め込むアプリのURL")
      .fill("https://example.com/app");
    await expect(appDialog).toContainText("埋め込み先：example.com");
    await appDialog
      .getByRole("button", { name: "このアプリをスライドに配置" })
      .click();
    await expect(page.locator(".activity-panel")).toBeHidden();

    // Editor: the frame is covered by a move shield with an operate toggle.
    const frame = page.locator(".slide-embed").first();
    await expect(frame).toBeVisible();
    await expect(frame.locator("iframe")).toHaveAttribute(
      "src",
      "https://example.com/app",
    );
    await expect(frame.locator(".slide-embed-shield")).toBeVisible();
    await expect(
      frame.getByRole("button", { name: "アプリを操作する" }),
    ).toBeVisible();

    // Placing the app captures its screen once (host editor only) and the
    // poster is saved with the element.
    await expect
      .poll(async () => (await savedEmbed(page, id))?.poster ?? "", {
        timeout: 30_000,
      })
      .toMatch(/^data:image\/jpeg;base64,/);
    expect((await savedEmbed(page, id))?.url).toBe("https://example.com/app");

    // With the thumbnail laid under the frame, operating the app
    // still reaches it: the backdrop must not swallow the pointer.
    await frame.getByRole("button", { name: "アプリを操作する" }).click();
    const hit = await page.evaluate(() => {
      const el = document.querySelector(".slide-embed iframe");
      if (!el) return "none";
      const rect = el.getBoundingClientRect();
      const top = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return top?.tagName ?? "none";
    });
    expect(hit).toBe("IFRAME");
    const hostFrame = page.frameLocator(".slide-embed iframe");
    await hostFrame.locator("#inc").click();
    await expect(hostFrame.locator("#count")).toHaveText("1");
    await frame.getByRole("button", { name: /操作を終わる/ }).click();

    // Guest map: the captured image is the thumbnail; no live app loads.
    await guest.goto(`/?room=${id}`);
    const card = guest.locator(".slide-card").first();
    await expect(
      card.locator(".slide-embed-placeholder.has-poster img"),
    ).toBeVisible();
    await expect(card.locator("iframe")).toHaveCount(0);

    // The sidebar editor changes the URL; the old poster goes with it.
    const sidebar = page.locator(".embed-sidebar-editor");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator(".embed-sidebar-poster")).toBeVisible();
    await sidebar.locator('input[type="url"]').fill("https://example.org/other");
    await sidebar.getByRole("button", { name: "URLを変更" }).click();
    await expect(sidebar).toContainText("URLを変更しました。");
    await expect
      .poll(async () => (await savedEmbed(page, id))?.url)
      .toBe("https://example.org/other");
    expect((await savedEmbed(page, id))?.poster).toBeUndefined();

    // Guest map now falls back to the plain marker (no poster for this URL).
    await guest.goto(`/?room=${id}`);
    await expect(card.locator(".slide-embed-placeholder")).toContainText(
      "example.org",
    );
    await expect(card.locator(".slide-embed-placeholder img")).toHaveCount(0);
    await expect(card.locator("iframe")).toHaveCount(0);

    // Guest opens the slide: the app is live, with no editing shield.
    await card.click();
    const guestFrame = guest.locator(".slide-embed").first();
    await expect(guestFrame.locator("iframe")).toHaveAttribute(
      "src",
      "https://example.org/other",
    );
    await expect(guestFrame.locator("iframe")).toHaveAttribute(
      "sandbox",
      /allow-scripts/,
    );
    await expect(guestFrame.locator(".slide-embed-shield")).toHaveCount(0);
    await expect(
      guestFrame.getByRole("button", { name: "アプリを操作する" }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("host sets an app thumbnail from an image when the app sends none", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await signIn(page, "embed-poster-host");
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "アプリのサムネイル", slides: [blank(0, 0)] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();

  // A plain page without the bridge script: nothing is captured.
  await page.route("https://example.com/plain", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><h1>ふつうのページ</h1></body></html>",
    });
  });

  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "アンケート", exact: true });
  await dialog.getByRole("tab", { name: "アプリ" }).click();
  const appDialog = page.getByRole("dialog", { name: "アプリ", exact: true });
  await appDialog
    .getByLabel("埋め込むアプリのURL")
    .fill("https://example.com/plain");
  await appDialog
    .getByRole("button", { name: "このアプリをスライドに配置" })
    .click();
  await expect(page.locator(".activity-panel")).toBeHidden();
  await expect(page.locator(".slide-embed").first()).toBeVisible();
  expect((await savedEmbed(page, id))?.poster).toBeUndefined();

  // Pick an image in the sidebar editor: it becomes the thumbnail.
  const sidebar = page.locator(".embed-sidebar-editor");
  await expect(sidebar).toBeVisible();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await sidebar
    .getByLabel("サムネイルにする画像")
    .setInputFiles({ name: "thumb.png", mimeType: "image/png", buffer: png });
  await expect
    .poll(async () => (await savedEmbed(page, id))?.poster ?? "", {
      timeout: 15_000,
    })
    .toMatch(/^data:image\/jpeg;base64,/);
  await expect(sidebar.locator(".embed-sidebar-poster")).toBeVisible();
  await expect(sidebar).toContainText("サムネイルを設定しました。");

  // The map card now shows the image instead of the plain marker.
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  const card = page.locator(".slide-card").first();
  await expect(
    card.locator(".slide-embed-placeholder.has-poster img"),
  ).toBeVisible();
  await expect(card.locator("iframe")).toHaveCount(0);

});

test("uploaded own app gets its thumbnail captured automatically", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  // One account per project: both projects share one test server,
  // and the app list is per account.
  await signIn(page, `embed-auto-host-${info.project.name.replace("cloud-", "")}`);
  // Upload a plain single-file app: no bridge script of its own.
  const appHtml =
    "<!doctype html><html><head><meta charset=\"utf-8\"><style>" +
    "body{margin:0;font-family:sans-serif}" +
    "h1{background:#2f6a45;color:#ffffff;padding:24px;margin:0}" +
    "p{padding:16px;font-size:20px;color:#263d39}</style></head>" +
    "<body><h1>自動撮影ツール</h1><p>橋渡しなしの自作アプリです。</p></body></html>";
  const registered = await page.request.post("/api/user-apps", {
    headers,
    data: { kind: "upload", name: "自動撮影ツール", html: appHtml },
  });
  expect(registered.status()).toBe(201);

  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "自分のアプリの自動撮影", slides: [blank(0, 0)] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();

  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "アンケート", exact: true });
  await dialog.getByRole("tab", { name: "アプリ" }).click();
  const appDialog = page.getByRole("dialog", { name: "アプリ", exact: true });
  const row = appDialog.locator(".embed-myapp-row", {
    hasText: "自動撮影ツール",
  });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "配置" }).click();
  await expect(page.locator(".activity-panel")).toBeHidden();
  const frame = page.locator(".slide-embed").first();
  await expect(frame).toBeVisible();
  await expect(frame.locator("iframe")).toHaveAttribute(
    "src",
    /\/api\/pub\/apps\/[a-f0-9-]{36}$/,
  );

  // The server injected the bridge, so the editor's snapshot request
  // is answered and the poster lands on the element by itself.
  await expect
    .poll(async () => (await savedEmbed(page, id))?.poster ?? "", {
      timeout: 30_000,
    })
    .toMatch(/^data:image\/jpeg;base64,/);

  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  const card = page.locator(".slide-card").first();
  await expect(
    card.locator(".slide-embed-placeholder.has-poster img"),
  ).toBeVisible();
  await expect(card.locator("iframe")).toHaveCount(0);

});
