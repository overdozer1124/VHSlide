import { test, expect } from "@playwright/test";

test.use({ reducedMotion: "reduce" });

test("narrow toolbars keep the form readable and expose hidden actions", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".slide-card").first()).toBeVisible();
  const map = page.locator(".map-workspace-bar");
  const form = map.getByRole("button", { name: "フォーム", exact: true });
  const formBox = (await form.boundingBox())!;
  const barBox = (await map.boundingBox())!;
  expect(formBox.x + formBox.width).toBeLessThanOrEqual(
    barBox.x + barBox.width + 1,
  );
  expect(barBox.height).toBeLessThanOrEqual(48);
  const right = page.getByRole("button", {
    name: "全体マップのツールバーを右へスクロール",
  });
  const left = page.getByRole("button", {
    name: "全体マップのツールバーを左へスクロール",
  });
  await expect(right).toBeVisible();
  for (let i = 0; i < 10 && (await right.isEnabled()); i++) {
    await right.click();
    await page.waitForTimeout(80);
  }
  await expect(right).toBeDisabled();
  const help = page.getByRole("button", { name: "ヘルプ", exact: true });
  const helpBox = (await help.boundingBox())!;
  expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(
    barBox.x + barBox.width + 1,
  );
  await help.click();
  await expect(page.getByRole("menu", { name: "ヘルプ" })).toContainText(
    "使い方",
  );
  await page.keyboard.press("Escape");
  for (let i = 0; i < 10 && (await left.isEnabled()); i++) {
    await left.click();
    await page.waitForTimeout(80);
  }
  await expect(left).toBeDisabled();
  await page.getByRole("button", { name: "ページを編集", exact: true }).click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  const toolbar = page.locator(".editor-toolbar");
  expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(52);
  await expect(
    toolbar.getByRole("button", { name: "フォーム", exact: true }),
  ).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "全体マップへ", exact: true }),
  ).toContainText("マップ");
  const editorRight = page.getByRole("button", {
    name: "編集ツールバーを右へスクロール",
  });
  await expect(editorRight).toBeVisible();
  for (let i = 0; i < 10 && (await editorRight.isEnabled()); i++) {
    await editorRight.click();
    await page.waitForTimeout(80);
  }
  await expect(editorRight).toBeDisabled();
  await expect(help).toBeVisible();
  if (info.project.name === "touch") {
    const size = await help.boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(40);
  }
  await page.screenshot({ path: info.outputPath("toolbar-mobile.png") });
});
