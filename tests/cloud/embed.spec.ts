import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
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

async function savedEmbedUrl(page: Page, id: string) {
  const backup = await page.request.get(`/api/decks/${id}/backup`);
  const deck = (await backup.json()).deck;
  const element = deck.slides[0].elements.find(
    (e: { embed?: { url: string } }) => e.embed,
  );
  return element?.embed?.url as string | undefined;
}

test("host embeds a web app in a slide and a guest can open it", async ({
  page,
  browser,
}, info) => {
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
    await expect.poll(() => savedEmbedUrl(page, id)).toBe(
      "https://example.com/app",
    );

    // The sidebar editor changes the URL.
    const sidebar = page.locator(".embed-sidebar-editor");
    await expect(sidebar).toBeVisible();
    await sidebar.locator("input").fill("https://example.org/other");
    await sidebar.getByRole("button", { name: "URLを変更" }).click();
    await expect(sidebar).toContainText("URLを変更しました。");
    await expect.poll(() => savedEmbedUrl(page, id)).toBe(
      "https://example.org/other",
    );

    // Guest map: a placeholder, no live app in the thumbnail.
    await guest.goto(`/?room=${id}`);
    const card = guest.locator(".slide-card").first();
    await expect(card.locator(".slide-embed-placeholder")).toContainText(
      "example.org",
    );
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
