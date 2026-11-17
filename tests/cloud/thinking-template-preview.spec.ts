import { test, expect } from "@playwright/test";
import { scopeFixture } from "../support/scopeCloud";

// The template picker is three panes: the template list, a live
// miniature plus a short guide, and the parameters (with the create
// button) — so the teacher never scrolls the modal up and down
// between the drawing and the settings. The miniature keeps one
// size and one text scale for every template.
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

  // The picker is three panes side by side (list / preview+guide /
  // parameters), all the same height, and the preview box keeps the
  // SAME size for every template kind — the drawing used to scale
  // with the pane for some templates and stay fixed for others.
  const panes = {
    list: panel.locator(".thinking-templates"),
    side: panel.locator(".thinking-template-side"),
    params: panel.locator(".thinking-params"),
  };
  const listBox = await panes.list.boundingBox();
  const sideBox = await panes.side.boundingBox();
  const paramsBox = await panes.params.boundingBox();
  expect(listBox).not.toBeNull();
  // Side-by-side only on wide viewports; narrow ones stack the panes.
  if (sideBox!.x > listBox!.x) {
    // (a few px of slack: the list is a <fieldset>, whose legend makes
    // its border box land a fraction off the grid row on some displays)
    expect(Math.abs(listBox!.height - sideBox!.height)).toBeLessThanOrEqual(6);
    expect(Math.abs(sideBox!.height - paramsBox!.height)).toBeLessThanOrEqual(6);
    expect(paramsBox!.x).toBeGreaterThan(sideBox!.x);
  }
  // The create button lives in the parameters pane.
  await expect(
    panes.params.getByRole("button", { name: "思考ツールを作成" }),
  ).toBeVisible();

  const previewBox = await panel
    .locator(".thinking-preview")
    .boundingBox();
  expect(previewBox).not.toBeNull();
  const sameSize = async () => {
    const box = await panel.locator(".thinking-preview").boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - previewBox!.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.height - previewBox!.height)).toBeLessThanOrEqual(2);
  };
  await panel
    .locator(".thinking-templates label", { hasText: "心情円" })
    .click();
  await expect(figure.locator("figcaption")).toHaveText(
    "心情円（2つの気持ちの割合）の形",
  );
  await sameSize();
  await panel
    .locator(".thinking-templates label", { hasText: "ベン図（2つの円）" })
    .click();
  await expect(figure.locator("figcaption")).toHaveText(
    "ベン図（2つの円）の形",
  );
  await sameSize();

  // Switching to a board template swaps the preview and the guide.
  await panel
    .locator(".thinking-templates label", { hasText: "KWL" })
    .click();
  await sameSize();
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
