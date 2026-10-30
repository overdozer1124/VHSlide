import { test, expect } from "@playwright/test";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";
test("guest secondary menu preserves restricted slides and exposes no host controls", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-more-host`),
    name = `${info.project.name}-more-guest`;
  expect(
    (
      await page.request.post(`/api/decks/${id}/recipients`, {
        headers: { Origin: scopeOrigin },
        data: {
          recipients: [
            {
              email: `${name}@example.test`,
              access: {
                mode: "scoped",
                comment: true,
                rows: [{ sheetId: "main", index: 0 }],
                columns: [],
                slides: [],
              },
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  if (
    !(await page.getByRole("dialog", { name: "ゲストの表示設定" }).isVisible())
  )
    await page
      .getByRole("button", { name: "ゲストの設定", exact: true })
      .click();
  await page.getByLabel("ゲストの表示範囲").selectOption("assigned");
  const context = await browser.newContext({ baseURL: scopeOrigin }),
    guest = await context.newPage();
  try {
    await scopeLogin(guest, name);
    await guest.goto(`/?room=${id}`);
    await expect(guest.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await expect(guest.locator(".slide-card")).toHaveCount(3);
    await guest.setViewportSize({ width: 810, height: 768 });
    expect(
      (await guest.getByLabel("作品のタイトル").boundingBox())!.y,
    ).toBeGreaterThanOrEqual(0);
    await guest.screenshot({ path: info.outputPath("guest-header-810.png") });
    const more = guest.getByRole("button", { name: "その他", exact: true });
    await more.click();
    await expect(
      guest
        .getByRole("menu", { name: "その他", exact: true })
        .getByRole("menuitem"),
    ).toHaveCount(2);
    await guest
      .getByRole("menuitem", { name: "更新履歴", exact: true })
      .click();
    await expect(
      guest.getByRole("region", { name: "更新履歴", exact: true }),
    ).toBeVisible();
    await guest.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await expect(guest.locator(".slide-card")).toHaveCount(3);
    await expect(
      guest.getByRole("button", { name: "全員の画面を同期", exact: true }),
    ).toHaveCount(0);
    await expect(guest.getByLabel("ゲストの表示範囲")).toHaveCount(0);
    await expect(guest.getByLabel("ゲストのページ追加")).toHaveCount(0);
    await expect(
      guest.getByRole("button", { name: "ゲストの設定", exact: true }),
    ).toHaveCount(0);
    await expect(
      guest.getByRole("button", { name: "この3ページを発表", exact: true }),
    ).toBeEnabled();
    await expect(
      guest.getByRole("button", { name: "マップをフィルタ", exact: true }),
    ).toBeDisabled();
    await guest.locator(".thumbnail").first().click();
    await expect(guest.locator(".workspace-flight")).toHaveCount(0);
    await expect(
      guest.getByRole("button", { name: "付箋を追加", exact: true }),
    ).toBeEnabled();
    await more.click();
    await guest.getByRole("menuitem", { name: "使い方", exact: true }).click();
    await expect(
      guest.getByRole("button", { name: "使い方を閉じる", exact: true }),
    ).toBeFocused();
    await guest.keyboard.press("Escape");
    await expect(more).toBeFocused();
  } finally {
    await context.close();
  }
});

test("host header keeps gather beside presenting and settings usable on Chromebook widths", async ({
  page,
}, info) => {
  await scopeFixture(page, `${info.project.name}-header-host`);
  for (const width of [1366, 1280, 1024, 810]) {
    await page.setViewportSize({ width, height: 768 });
    const gather = page.getByRole("button", {
      name: "全員の画面を同期",
      exact: true,
    });
    await expect(gather).toBeEnabled();
    await expect(
      page.locator(".app-header .host-follow-controls"),
    ).toContainText("全員を集合");
    await expect(page.locator(".cloud-presence .save-state")).toBeVisible();
    const rect = (await gather.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    expect(
      await page
        .locator(".app-header")
        .evaluate((e) => e.scrollWidth - e.clientWidth),
    ).toBeLessThanOrEqual(0);
    await page
      .getByRole("button", { name: "ゲストの設定", exact: true })
      .click();
    await expect(page.getByLabel("ゲストの表示範囲")).toBeFocused();
    await page.getByLabel("ゲストの表示範囲").selectOption("assigned");
    await page
      .getByLabel("ゲストのページ追加", { exact: true })
      .selectOption("insert");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "ゲストの設定", exact: true }),
    ).toBeFocused();
    await gather.click();
    await expect(gather).toHaveText("集合を終了");
    await expect(gather).toBeEnabled();
    await page.screenshot({
      path: info.outputPath(`host-header-${width}.png`),
    });
    await gather.click();
    await expect(gather).toHaveText("全員を集合");
    await page.locator(".thumbnail").first().click();
    await expect(page.locator(".workspace-flight")).toHaveCount(0);
    expect(
      (await page.locator(".editor-layout").boundingBox())!.y,
    ).toBeLessThanOrEqual(104);
    await expect(gather).toBeVisible();
    await page
      .getByRole("button", { name: "全体マップへ", exact: true })
      .click();
    await expect(page.locator(".workspace-flight")).toHaveCount(0);
  }
});
