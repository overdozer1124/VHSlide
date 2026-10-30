import { test, expect } from "@playwright/test";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";
import { defaultAccess } from "../../src/permissions";
test("host enforces assigned slides and later restores all slides", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-force-host`),
    guest = `${info.project.name}-force-guest`;
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
                slides: [],
                rows: [{ sheetId: "main", index: 0 }],
              },
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  const ctx = await browser.newContext({ baseURL: scopeOrigin });
  const other = await ctx.newPage();
  try {
    await scopeLogin(other, guest);
    await other.goto(`/?room=${id}`);
    await expect(other.locator(".slide-card")).toHaveCount(9);
    if (
      !(await page
        .getByRole("dialog", { name: "ゲストの表示設定" })
        .isVisible())
    )
      await page
        .getByRole("button", { name: "ゲストの設定", exact: true })
        .click();
    await page.getByLabel("ゲストの表示範囲").selectOption("assigned");
    await expect(other.locator(".slide-card")).toHaveCount(3);
    await expect(
      other.getByRole("button", { name: "マップをフィルタ", exact: true }),
    ).toBeDisabled();
    await other.locator(".thumbnail").first().click();
    await expect(other.locator(".editor-pager")).toBeVisible();
    await expect(
      other.getByRole("button", { name: "担当ページを追加", exact: true }),
    ).toHaveCount(0);
    await other.locator(".rail-trigger").first().click();
    await expect(other.locator(".row-flyout")).toBeVisible();
    await expect(other.locator(".row-insert-column")).toHaveCount(1);
    await other
      .getByRole("button", {
        name: "1行目の3枚目の後にページを追加",
        exact: true,
      })
      .click();
    await expect(page.locator(".slide-card")).toHaveCount(10);
    if (
      !(await page
        .getByRole("dialog", { name: "ゲストの表示設定" })
        .isVisible())
    )
      await page
        .getByRole("button", { name: "ゲストの設定", exact: true })
        .click();
    await page
      .getByLabel("ゲストのページ追加", { exact: true })
      .selectOption("none");
    await other.locator(".rail-trigger").first().click();
    await expect(other.locator(".row-insert-column").last()).toBeDisabled();
    if (
      !(await page
        .getByRole("dialog", { name: "ゲストの表示設定" })
        .isVisible())
    )
      await page
        .getByRole("button", { name: "ゲストの設定", exact: true })
        .click();
    await page
      .getByLabel("ゲストのページ追加", { exact: true })
      .selectOption("insert");
    await expect(other.locator(".row-insert-column")).toHaveCount(4);
    await expect(other.locator(".row-insert-column").first()).toBeEnabled();
    await other
      .getByRole("button", {
        name: "1行目の1枚目の後にページを追加",
        exact: true,
      })
      .click();
    await expect(page.locator(".slide-card")).toHaveCount(11);
    if (
      !(await page
        .getByRole("dialog", { name: "ゲストの表示設定" })
        .isVisible())
    )
      await page
        .getByRole("button", { name: "ゲストの設定", exact: true })
        .click();
    await page
      .getByLabel("ゲストのページ追加", { exact: true })
      .selectOption("append");

    await expect(other.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await other
      .getByRole("button", { name: "スピーカーノート", exact: true })
      .click();
    await other
      .getByLabel("このスライドのスピーカーノート", { exact: true })
      .fill("担当ページの発表メモ");
    await other
      .getByRole("button", { name: "スピーカーノートを閉じる", exact: true })
      .click();
    await other.getByRole("button", { name: "手描き", exact: true }).click();
    const ink = other.locator(".editor-workspace .ink-editing");
    await expect(ink).toBeVisible();
    const bounds = (await ink.boundingBox())!;
    await other.mouse.move(bounds.x + 30, bounds.y + 30);
    await other.mouse.down();
    await other.mouse.move(bounds.x + 140, bounds.y + 80, { steps: 8 });
    await other.mouse.up();
    await expect(ink.locator("path")).toHaveCount(1);
    await expect(other.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );

    await other.getByRole("button", { name: "消しゴム", exact: true }).click();
    await other.mouse.move(bounds.x + 70, bounds.y + 20);
    await other.mouse.down();
    await other.mouse.move(bounds.x + 70, bounds.y + 100, { steps: 8 });
    await other.mouse.up();
    await expect(ink.locator("mask")).toHaveCount(1);
    await expect(other.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await other
      .getByRole("group", { name: "描画ツール", exact: true })
      .getByRole("button", { name: "四角形", exact: true })
      .click();
    await other.getByLabel("線の色", { exact: true }).fill("#ff0000");
    await other.getByLabel("線の太さ", { exact: true }).fill("8");
    await other
      .getByRole("group", { name: "線の種類" })
      .getByRole("button", { name: "破線", exact: true })
      .click();
    await other.getByLabel("図形を塗りつぶす", { exact: true }).check();
    await other.getByLabel("図形の塗り色", { exact: true }).fill("#0000ff");
    await other.mouse.move(bounds.x + 20, bounds.y + 20);
    await other.mouse.down();
    await other.mouse.move(bounds.x + 100, bounds.y + 100, { steps: 5 });
    await other.mouse.up();
    await expect(ink.locator("[data-ink-paint]")).toHaveCount(2);
    await expect(other.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await other.reload();
    await expect(other.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await expect(
      other.getByRole("button", { name: "マップをフィルタ", exact: true }),
    ).toBeDisabled();
    await other.locator(".thumbnail").nth(1).click();
    await expect(other.locator(".workspace-flight")).toHaveCount(0);
    await other
      .getByRole("button", { name: "スピーカーノート", exact: true })
      .click();
    await expect(
      other.getByLabel("このスライドのスピーカーノート", { exact: true }),
    ).toHaveValue("担当ページの発表メモ");
    await other
      .getByRole("button", { name: "スピーカーノートを閉じる", exact: true })
      .click();
    await expect(
      other.locator(".editor-workspace .ink-object mask"),
    ).toHaveCount(1);
    await expect(
      other.locator(".editor-workspace .ink-object [data-ink-paint]"),
    ).toHaveCount(2);
    const styled = other
      .locator(".editor-workspace .ink-object [data-ink-paint]")
      .last();
    await expect(styled).toHaveAttribute("stroke", "#ff0000");
    await expect(styled).toHaveAttribute("stroke-width", "8");
    await expect(styled).toHaveAttribute("stroke-dasharray", "32 24");
    await expect(styled).toHaveAttribute("fill", "#0000ff");
    if (
      !(await page
        .getByRole("dialog", { name: "ゲストの表示設定" })
        .isVisible())
    )
      await page
        .getByRole("button", { name: "ゲストの設定", exact: true })
        .click();
    await page.getByLabel("ゲストの表示範囲").selectOption("all");
    await other
      .getByRole("button", { name: "全体マップへ", exact: true })
      .click();
    await expect(other.locator(".slide-card")).toHaveCount(11);
  } finally {
    await ctx.close();
  }
});
