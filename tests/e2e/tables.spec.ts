import { test, expect } from "@playwright/test";
const data = (page: import("@playwright/test").Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
test("creates and directly edits a table, preserves layout, undo, resize, JSON and presentation", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  await page.getByRole("button", { name: "表を追加", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "表の行数", exact: true })
    .fill("2");
  await page
    .getByRole("spinbutton", { name: "表の列数", exact: true })
    .fill("3");
  await page
    .getByRole("button", { name: "この大きさで表を追加", exact: true })
    .click();
  const cell = page.getByRole("textbox", { name: "表 1行 1列", exact: true });
  if (info.project.name === "touch") await cell.tap();
  else await cell.click();
  await cell.fill("比較する観点");
  await cell.press("Tab");
  await expect(
    page.getByRole("textbox", { name: "表 1行 2列", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "表 2行 1列", exact: true })
    .fill("日本語\n2行目");
  await page.getByRole("tab", { name: "表全体", exact: true }).click();
  await page.getByRole("button", { name: "行を追加", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "表 3行 1列", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "列を追加", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "表 3行 4列", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("表の文字の位置", { exact: true })
    .selectOption("center");
  await page
    .getByRole("spinbutton", { name: "表の文字の大きさ", exact: true })
    .fill("28");
  await page.getByRole("tab", { name: "表全体", exact: true }).click();
  await page.getByText("行・列を削除", { exact: true }).click();
  await page
    .getByRole("button", { name: "最後の行を削除", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "表 3行 1列", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "表 3行 1列", exact: true }),
  ).toHaveCount(1);
  await expect(cell).toHaveValue("比較する観点");
  await page
    .getByRole("textbox", { name: "表 3行 4列", exact: true })
    .fill("<img src=x onerror=alert(1)>" + "長い文".repeat(200));
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("tab", { name: "表全体", exact: true }).click();
  await page.getByText("行・列を削除", { exact: true }).click();
  await page
    .getByRole("button", { name: "最後の行を削除", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "表 3行 4列", exact: true }),
  ).toHaveValue(/長い文/);
  const table = page.locator(".editor-workspace .slide-table"),
    element = page.locator(".editor-workspace .selected-element");
  const bounds = await table.boundingBox(),
    outer = await element.boundingBox();
  expect(bounds!.height).toBeLessThanOrEqual(outer!.height + 2);
  const box = await page
    .getByRole("button", { name: "要素のサイズを変更", exact: true })
    .boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 30,
    box!.y + box!.height / 2 + 20,
  );
  await page.mouse.up();
  const saved = await data(page);
  expect(
    saved.slides[0].elements.find((e: any) => e.type === "table").w,
  ).toBeGreaterThan(760);
  await page.screenshot({ path: info.outputPath("table-editor.png") });
  await page.reload();
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  await expect(cell).toHaveValue("比較する観点");
  const imported = await data(page);
  imported.title = "表を読み込み";
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "table.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(imported)),
    });
  await expect(page.locator(".deck-title")).toHaveValue("表を読み込み");
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  const review = page.getByRole("dialog", {
    name: "表示チェック",
    exact: true,
  });
  await expect(review).toContainText("全文が表示されません");
  await review
    .getByRole("button", { name: "このまま進む", exact: true })
    .click();
  await expect(page.locator(".present-mode .slide-table")).toContainText(
    "比較する観点",
  );
  await expect(page.locator(".present-mode textarea")).toHaveCount(0);
  await expect(page.locator(".present-mode .slide-table img")).toHaveCount(0);
  const shown = await page.locator(".present-mode .slide-table").boundingBox();
  const frame = await page
    .locator(".present-mode .slide-table")
    .locator("..")
    .boundingBox();
  expect(shown!.height).toBeLessThanOrEqual(frame!.height + 2);
  await page.mouse.move(100, 10);
  await page.getByRole("button", { name: "発表をおわる", exact: true }).click();
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  await page.getByRole("menuitem", { name: /^PDFで保存/ }).click();
  await page
    .getByRole("button", { name: "対象をすべて選ぶ", exact: true })
    .click();
  await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  // The same unchanged overflow was acknowledged before presenting.
  await expect(
    page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".print-export .slide-table")).toContainText(
    "比較する観点",
  );
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({
    path: info.outputPath("table-print.pdf"),
    printBackground: true,
  });
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`table insertion is physically clickable without scrolling the toolbar at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page
      .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
      .click();
    const trigger = page.getByRole("button", { name: "表を追加", exact: true });
    if (info.project.name === "touch") await trigger.tap();
    else await trigger.click();
    const panel = page.getByRole("dialog", {
      name: "追加する表の大きさ",
      exact: true,
    });
    // Hit testing catches clipping that Playwright's automatic scrollIntoView can conceal.
    const add = page.getByRole("button", {
      name: "この大きさで表を追加",
      exact: true,
    });
    await expect
      .poll(() =>
        add.evaluate((node) => {
          const r = node.getBoundingClientRect(),
            hit = document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
          return !!hit && (node === hit || node.contains(hit));
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: info.outputPath(`table-insert-${viewport.width}.png`),
    });
    const box = (await add.boundingBox())!;
    if (info.project.name === "touch")
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(
      page.getByRole("textbox", { name: "表 1行 1列", exact: true }),
    ).toBeVisible();
    await expect(panel).toHaveCount(0);
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(panel).toHaveCount(0);
    await trigger.click();
    await page.setViewportSize({ width: 600, height: 500 });
    await expect
      .poll(() =>
        panel.evaluate((node) => {
          const r = node.getBoundingClientRect();
          return (
            r.x >= 0 &&
            r.y >= 0 &&
            r.right <= window.innerWidth &&
            r.bottom <= window.innerHeight
          );
        }),
      )
      .toBe(true);
    if (info.project.name === "touch") await page.touchscreen.tap(598, 498);
    else await page.mouse.click(598, 498);
    await expect(panel).toHaveCount(0);
  });
}
