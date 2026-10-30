import { test, expect } from "@playwright/test";

test("work menu keeps new/open and direct save/present actions, with undo protection", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.evaluate(() =>
    localStorage.getItem("vhslide-deck-v1"),
  );
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "新しく", exact: true }),
  ).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "開く", exact: true }).click();
  await chooser;
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  await page.getByRole("menuitem", { name: "新しく", exact: true }).click();
  await expect(page.getByLabel("作品のタイトル")).toHaveValue("あたらしい作品");
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("vhslide-deck-v1")),
  ).toBe(before);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ファイルに保存", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await page.addInitScript(() => {
    document.documentElement.requestFullscreen = () =>
      Promise.reject(new Error("test"));
  });
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  await expect(page.locator(".present-mode")).toBeVisible();
  await page.getByRole("button", { name: "発表をおわる", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ファイル", exact: true }),
  ).toBeVisible();
});

test("header labels and save status remain visible in compact editing layouts", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  for (const width of [1366, 1280, 1024, 810]) {
    await page.setViewportSize({ width, height: 768 });
    for (const label of ["ファイル", "ファイルに保存", "発表する"])
      await expect(
        page.getByRole("button", { name: label, exact: true }),
      ).toBeVisible();
    await expect(page.locator(".header-document .save-state")).toBeVisible();
    expect(
      (await page.locator(".editor-layout").boundingBox())!.y,
    ).toBeLessThanOrEqual(104);
    const header = await page
      .locator(".app-header")
      .evaluate((e) => ({ width: e.clientWidth, scroll: e.scrollWidth }));
    expect(header.scroll).toBeLessThanOrEqual(header.width);
    await page.screenshot({ path: info.outputPath(`header-${width}.png`) });
  }
});
