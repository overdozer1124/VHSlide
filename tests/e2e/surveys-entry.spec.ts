import { test, expect } from "@playwright/test";

test("local survey entry explains sharing, traps focus and closes without changing the work", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".slide-card")).toHaveCount(5);
  const launch = page.getByRole("button", { name: "アンケート", exact: true });
  await launch.click();
  const dialog = page.getByRole("dialog", { name: "アンケート", exact: true });
  await expect(dialog).toContainText("アンケートはクラウドの作品で使えます");
  await expect(
    dialog.getByRole("button", { name: "新しいアンケート" }),
  ).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "アンケートを閉じる" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "アンケートを閉じる" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(launch).toBeFocused();
  await expect(page.locator(".slide-card")).toHaveCount(5);
});
