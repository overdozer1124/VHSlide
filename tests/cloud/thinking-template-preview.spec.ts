import { test, expect } from "@playwright/test";
import { scopeFixture } from "../support/scopeCloud";

// The template picker shows a live miniature of the selected template
// plus a short guide, and the thinking pane scrolls so the create
// button at the bottom of the long form stays reachable (the pane
// used to clip it: the panel is fixed-height with overflow hidden).
test("template preview, guide and a reachable create button", async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-preview-host`);
  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  const panel = page.locator(".activity-panel");
  await panel.getByRole("tab", { name: "思考ツール" }).click();

  // Default template (axis2): preview figure and guide are visible.
  const figure = panel.locator(".thinking-template-figure");
  await expect(figure).toBeVisible();
  await expect(figure.locator("figcaption")).toHaveText(
    "座標軸（2つの軸）の形",
  );
  await expect(panel.locator(".thinking-preview.is-point")).toBeVisible();
  await expect(panel.locator(".thinking-template-guide")).toContainText(
    "2つの軸で作る座標",
  );

  // Switching to a board template swaps the preview and the guide.
  await panel
    .locator(".thinking-templates label", { hasText: "KWL" })
    .click();
  await expect(figure.locator("figcaption")).toHaveText("KWLの形");
  const preview = panel.locator(".thinking-preview.is-board");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("知っていること（K）");
  await expect(preview).toContainText("分かったこと（L）");
  await expect(panel.locator(".thinking-template-guide")).toContainText(
    "学習のはじめにKとWを書き",
  );

  // Editing a zone name updates the preview label live.
  await panel.getByLabel("区切り「a」の名前").fill("知っているよ");
  await expect(preview).toContainText("知っているよ");

  // The bottom of the long form (title + create button) is reachable
  // by scrolling the pane, and creating the tool works from the UI.
  await panel
    .getByPlaceholder("例：物語を読んだ気持ち")
    .fill("国語のふり返り");
  await panel
    .getByRole("button", { name: "思考ツールを作成" })
    .click();
  await expect(
    panel.locator(".thinking-tool-card", { hasText: "国語のふり返り" }),
  ).toBeVisible({ timeout: 15_000 });
});
