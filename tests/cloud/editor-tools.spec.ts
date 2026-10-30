import { test, expect } from "@playwright/test";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";

test("read-only guests retain notes, display access and commenting without gaining object editing", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-tools-host`);
  const name = `${info.project.name}-tools-viewer`;
  expect(
    (
      await page.request.post(`/api/decks/${id}/recipients`, {
        headers: { Origin: scopeOrigin },
        data: {
          recipients: [
            {
              email: `${name}@example.test`,
              access: {
                mode: "none",
                comment: true,
                rows: [],
                columns: [],
                slides: [],
              },
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  const context = await browser.newContext({ baseURL: scopeOrigin });
  const guest = await context.newPage();
  try {
    await scopeLogin(guest, name);
    await guest.goto(`/?room=${id}`);
    await expect(guest.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await guest.locator(".thumbnail").first().click();
    await expect(guest.locator(".workspace-flight")).toHaveCount(0);
    for (const label of [
      "文字",
      "画像",
      "手描き",
      "表を追加",
      "図形を追加",
      "線を追加",
      "もっと見る（図解・グラフ）",
    ])
      await expect(
        guest.getByRole("button", { name: label, exact: true }),
      ).toBeDisabled();
    await expect(
      guest.getByRole("button", { name: "付箋を追加", exact: true }),
    ).toBeEnabled();
    await guest
      .getByRole("button", { name: "スピーカーノート", exact: true })
      .click();
    await expect(
      guest.getByLabel("このスライドのスピーカーノート", { exact: true }),
    ).toHaveAttribute("readonly", "");
    const before = (
      await (await page.request.get(`/api/decks/${id}/backup`)).json()
    ).deck;
    await guest
      .getByRole("button", { name: "表示の設定", exact: true })
      .click();
    await expect(
      guest.getByRole("dialog", { name: "表示の設定", exact: true }),
    ).toBeVisible();
    await guest.getByRole("switch", { name: "縦の連動", exact: true }).click();
    await expect(
      guest.getByRole("switch", { name: "縦の連動", exact: true }),
    ).toBeChecked();
    expect(
      (await (await page.request.get(`/api/decks/${id}/backup`)).json()).deck,
    ).toEqual(before);
    await guest.keyboard.press("Escape");
    await expect(
      guest.getByRole("button", { name: "表示の設定", exact: true }),
    ).toBeFocused();
    await expect(
      guest.getByRole("button", { name: "全員の画面を同期", exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
