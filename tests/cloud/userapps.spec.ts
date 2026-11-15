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

const APP_HTML =
  "<!doctype html><html><body><p id=\"marker\">アップロード成功</p></body></html>";

test("host registers own apps (URL and HTML upload) and places an upload", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
  const context = await browser.newContext(info.project.use);
  const guest = await context.newPage();
  try {
    await signIn(page, "ua-host");
    await signIn(guest, "ua-guest");
    const created = await page.request.post("/api/decks", {
      headers,
      data: { version: 1, title: "自分のアプリ", slides: [blank(0, 0)] },
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
    await expect(appDialog).toContainText("自分のアプリ");

    // Register by URL.
    const linkBox = appDialog.locator(".embed-myapp-add", {
      hasText: "URLで追加",
    });
    await linkBox.locator('input[type="text"]').fill("外部ツール");
    await linkBox
      .locator('input[type="url"]')
      .fill("https://example.com/tool");
    await linkBox.getByRole("button", { name: "URLを追加" }).click();
    await expect(
      appDialog.locator(".embed-myapp-row", { hasText: "外部ツール" }),
    ).toBeVisible();

    // Register by uploading a single HTML file.
    const uploadBox = appDialog.locator(".embed-myapp-add", {
      hasText: "HTMLファイルで追加",
    });
    await uploadBox.locator('input[type="text"]').fill("自作ツール");
    await uploadBox.locator('input[type="file"]').setInputFiles({
      name: "tool.html",
      mimeType: "text/html",
      buffer: Buffer.from(APP_HTML),
    });
    await uploadBox
      .getByRole("button", { name: "アップロードして追加" })
      .click();
    const uploadRow = appDialog.locator(".embed-myapp-row", {
      hasText: "自作ツール",
    });
    await expect(uploadRow).toBeVisible();
    await expect(uploadRow).toContainText("アップロード");

    // Place the uploaded app: the frame points at the isolated pub URL.
    await uploadRow.getByRole("button", { name: "配置" }).click();
    await expect(page.locator(".activity-panel")).toBeHidden();
    const frame = page.locator(".slide-embed").first();
    const src = await frame.locator("iframe").getAttribute("src");
    expect(src).toMatch(/\/pub\/apps\/[a-f0-9-]{36}$/);

    // The deck stores that URL, and the pub endpoint serves the HTML
    // itself under a sandbox CSP.
    const backup = await page.request.get(`/api/decks/${id}/backup`);
    const deck = (await backup.json()).deck;
    const element = deck.slides[0].elements.find(
      (e: { embed?: { url: string } }) => e.embed,
    );
    expect(element.embed.url).toBe(src);
    const served = await page.request.get(src!);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-security-policy"]).toContain("sandbox");
    expect(await served.text()).toContain("アップロード成功");

    // Guest opens the slide and the uploaded app actually runs.
    await guest.goto(`/?room=${id}`);
    await guest.locator(".slide-card").first().click();
    await expect(
      guest.frameLocator(".slide-embed iframe").locator("#marker"),
    ).toHaveText("アップロード成功");

    // Deleting the URL app removes its row.
    await page
      .getByRole("button", { name: "フォーム", exact: true })
      .click();
    const again = page.getByRole("dialog", { name: "アプリ", exact: true });
    const linkRow = again.locator(".embed-myapp-row", {
      hasText: "外部ツール",
    });
    await linkRow.getByRole("button", { name: "削除" }).click();
    await expect(linkRow).toHaveCount(0);
  } finally {
    await context.close();
  }
});
