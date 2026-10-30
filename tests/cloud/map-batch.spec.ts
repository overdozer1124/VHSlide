import { test, expect } from "@playwright/test";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";
import { defaultAccess } from "../../src/permissions";

test("host bulk axes synchronize and scoped participants keep their original row, cannot bulk edit axes or delete others", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-batch-host`),
    guest = `${info.project.name}-batch-guest`;
  expect(
    (
      await page.request.post(`/api/decks/${id}/recipients`, {
        headers: { Origin: scopeOrigin },
        data: {
          recipients: [
            {
              email: `${guest}@example.test`,
              access: {
                ...defaultAccess(),
                mode: "scoped",
                rows: [{ sheetId: "main", index: 1, axisId: "1" }],
              },
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  const context = await browser.newContext({
      baseURL: scopeOrigin,
      viewport: { width: 1440, height: 1000 },
    }),
    other = await context.newPage();
  try {
    await scopeLogin(other, guest);
    await other.goto(`/?room=${id}`);
    await expect(other.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await expect(
      other.getByRole("button", { name: "マップのその他", exact: true }),
    ).toHaveCount(0);
    await expect(
      other.getByRole("button", { name: "行・列を一括操作", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "行・列を一括操作", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "行・列の一括操作",
      exact: true,
    });
    await panel.getByLabel("一括操作の開始番号").fill("2");
    await panel.getByLabel("一括操作の数").fill("2");
    await panel
      .getByRole("button", { name: "まとめて追加", exact: true })
      .click();
    await expect(page.locator(".slide-card")).toHaveCount(15);
    await expect(other.locator(".slide-card")).toHaveCount(15);
    await expect(
      other.locator('[data-page-id="p01"] .thumbnail-footer-input'),
    ).toBeEditable();
    await expect(
      other.locator('[data-page-id="p00"] .thumbnail-footer-input'),
    ).not.toBeEditable();
    await expect(other.locator('[data-page-id="p01"] .page-number')).toHaveText(
      "4.1",
    );
    await other
      .getByRole("button", { name: "スライドを複数選択", exact: true })
      .click();
    await other
      .getByRole("button", { name: "表示中をすべて選択", exact: true })
      .click();
    await expect(
      other.getByRole("button", { name: "選択したページを削除", exact: true }),
    ).toBeDisabled();
    await other
      .getByRole("button", { name: "選択を解除", exact: true })
      .click();
    await other.locator('[data-page-id="p01"] .thumbnail').click();
    await other
      .locator('[data-page-id="p11"] .thumbnail')
      .click({ modifiers: ["Control"] });
    await expect(
      other.getByRole("button", { name: "選択したページを削除", exact: true }),
    ).toBeEnabled();
    await other
      .getByRole("button", { name: "選択したページを削除", exact: true })
      .click();
    await other
      .getByRole("button", { name: "この2ページを削除する", exact: true })
      .click();
    await expect(other.locator(".slide-card")).toHaveCount(13);
    await expect(page.locator(".slide-card")).toHaveCount(13);
    await expect(page.locator('[data-page-id="p00"]')).toBeVisible();
    await page
      .getByRole("button", { name: "行・列を一括操作", exact: true })
      .click();
    await panel.getByLabel("一括操作", { exact: true }).selectOption("delete");
    await panel.getByLabel("一括操作の開始番号").fill("2");
    await panel.getByLabel("一括操作の数").fill("2");
    await panel
      .getByRole("button", { name: "この範囲を削除", exact: true })
      .click();
    await expect(page.locator(".slide-card")).toHaveCount(7);
    await expect(other.locator(".slide-card")).toHaveCount(7);
    await expect(other.locator('[data-page-id="p21"] .page-number')).toHaveText(
      "2.3",
    );
    await expect(
      other.locator('[data-page-id="p21"] .thumbnail-footer-input'),
    ).not.toBeEditable(); // selection mode intentionally makes footers read-only
    await other
      .getByRole("button", { name: "選択を終了", exact: true })
      .click();
    await expect(
      other.locator('[data-page-id="p21"] .thumbnail-footer-input'),
    ).toBeEditable();
  } finally {
    await context.close();
  }
});
