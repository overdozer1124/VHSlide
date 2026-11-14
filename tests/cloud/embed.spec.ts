import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blank } from "../../src/model";
const headers = { Origin: "http://127.0.0.1:3187" };
async function signIn(page: Page, name: string) {
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential: name },
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
    await sidebar.locator("input").fill("https://example.org/other");
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
