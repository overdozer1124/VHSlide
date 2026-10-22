import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
test("create, edit, persist, export/import and present a two-dimensional story", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "全体マップ" })).toBeVisible();
  await expect(page.locator(".slide-card")).toHaveCount(5);
  await page.screenshot({
    path: testInfo.outputPath("map.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "わたしたちのまちの右に次の話題を追加",
      exact: true,
    })
    .click();
  await expect(page.locator(".slide-card")).toHaveCount(6);
  await page
    .getByRole("button", {
      name: "わたしたちのまちの下に詳しいページを追加",
      exact: true,
    })
    .click();
  await expect(page.locator(".slide-card")).toHaveCount(7);
  // Touch-friendly cell swap, then verify undo/redo preserve the grid.
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  );
  await page
    .getByRole("button", { name: "自然がいっぱいを移動", exact: true })
    .click();
  await page
    .getByRole("button", { name: "人とつながるを移動先にする", exact: true })
    .click();
  let d = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  );
  expect(d.slides.find((s: any) => s.title === "自然がいっぱい").x).toBe(3);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
    ),
  ).toEqual(before);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  await page.getByRole("button", { name: "文字", exact: true }).click();
  await page
    .getByRole("textbox", { name: "スライド内の文字", exact: true })
    .fill("わたしたちの発見\n公園のひみつ");
  await page.getByRole("button", { name: "B 太字", exact: true }).click();
  await page.getByRole("spinbutton", { name: "文字の大きさ" }).fill("36");
  await expect(page.locator(".selected-element")).toContainText(
    "わたしたちの発見",
  );
  // Resize via pointer capture in the real browser.
  const selected = page.locator(".selected-element");
  const box = await selected.boundingBox();
  await page.mouse.move(box!.x + 10, box!.y + 10);
  await page.mouse.down();
  await page.mouse.move(box!.x + 50, box!.y + 30, { steps: 4 });
  await page.mouse.up();
  await page.getByLabel("図形を追加").selectOption("circle");
  await expect(page.locator(".selected-element svg ellipse")).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("editor.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await page.reload();
  await expect(page.locator(".slide-card")).toHaveCount(7);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const file = await download;
  const exported = JSON.parse(await fs.readFile((await file.path())!, "utf8"));
  expect(exported.slides).toHaveLength(7);
  expect(
    exported.slides[0].elements.some(
      (e: any) => e.text === "わたしたちの発見\n公園のひみつ",
    ),
  ).toBe(true);
  exported.title = "JSONから復元した作品";
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "story.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(exported)),
    });
  await expect(
    page.getByRole("textbox", { name: "作品のタイトル" }),
  ).toHaveValue(exported.title);
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  await expect(page.locator(".minimap-caption")).toHaveText("1.1 現在地");
  await page.getByRole("button", { name: "下のページ", exact: true }).click();
  await expect(page.locator(".minimap-caption")).toHaveText("2.1 現在地");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".minimap-caption")).toHaveText("1.2 現在地");
  await page.screenshot({ path: testInfo.outputPath("presentation.png") });
  await page.getByRole("button", { name: "発表をおわる", exact: true }).click();
  expect(errors).toEqual([]);
});
test("rejects invalid import without losing the current work", async ({
  page,
}) => {
  await page.goto("/");
  const title = await page
    .getByRole("textbox", { name: "作品のタイトル" })
    .inputValue();
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":4,"slides":[]}'),
    });
  await expect(page.getByRole("status")).toContainText(
    "対応するVHSlideファイルではありません",
  );
  await expect(
    page.getByRole("textbox", { name: "作品のタイトル" }),
  ).toHaveValue(title);
});

test("embedded images survive upload, clipboard paste, drop and reload; resizing changes geometry", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=";
  await page
    .locator("input[type=file]")
    .nth(1)
    .setInputFiles({
      name: "dot.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
  await expect(page.locator(".editor-workspace .slide-image")).toHaveCount(1);
  const handle = page.getByRole("button", { name: "要素のサイズを変更" });
  const box = await handle.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 70, box!.y + 60, { steps: 6 });
  await page.mouse.up();
  let data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  );
  expect(data.slides[0].elements.at(-1).w).toBeGreaterThan(20);
  await page.locator(".editor-workspace").evaluate((node, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    node.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await expect(page.locator(".editor-workspace .slide-image")).toHaveCount(2);
  await page.locator(".editor-workspace").evaluate((node, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    node.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await expect(page.locator(".editor-workspace .slide-image")).toHaveCount(3);
  await page.reload();
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  await expect(page.locator(".editor-workspace .slide-image")).toHaveCount(3);
  expect(
    await page
      .locator(".editor-workspace .slide-image")
      .evaluateAll((imgs) =>
        imgs.every((img) => (img as HTMLImageElement).naturalWidth > 0),
      ),
  ).toBe(true);
});

test("row and column moves preserve all pages; delete and new project are undoable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "話題1を移動", exact: true }).click();
  await page
    .getByRole("button", { name: "自然がいっぱいを移動先にする", exact: true })
    .click();
  let data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  );
  expect(
    data.slides.find((s: any) => s.title === "まちを歩いてみたら"),
  ).toMatchObject({ x: 1, y: 1 });
  await page
    .getByRole("button", { name: "高さ1のページをまとめて移動", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "お気に入りの公園を移動先にする",
      exact: true,
    })
    .click();
  data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  );
  expect(
    data.slides.find((s: any) => s.title === "人とつながる"),
  ).toMatchObject({ x: 2, y: 1 });
  await page
    .getByRole("button", { name: "わたしたちのまちを削除", exact: true })
    .click();
  await expect(page.locator(".slide-card")).toHaveCount(4);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect(page.locator(".slide-card")).toHaveCount(5);
  await page.getByRole("button", { name: "新しく", exact: true }).click();
  await expect(page.locator(".slide-card")).toHaveCount(1);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect(page.locator(".slide-card")).toHaveCount(5);
});

test("native drag swaps grid cells", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "touch", "タッチ端末は移動ボタンを使う");
  await page.goto("/");
  await page
    .locator(".slide-card")
    .nth(1)
    .dragTo(page.locator(".grid-cell").nth(2));
  const data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  );
  expect(data.slides.find((s: any) => s.title === "自然がいっぱい").x).toBe(2);
  expect(data.slides.find((s: any) => s.title === "人とつながる").x).toBe(1);
});

test("touch taps and directional swipe navigate the story", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "touch", "タッチ専用チェック");
  await page.goto("/");
  await page
    .getByRole("button", { name: "わたしたちのまちを移動", exact: true })
    .tap();
  await page
    .getByRole("button", { name: "自然がいっぱいを移動先にする", exact: true })
    .tap();
  await page.getByRole("button", { name: "発表する", exact: true }).tap();
  await page.locator(".present-mode").evaluate((node) => {
    const touch = (x: number, y: number) =>
      new Touch({ identifier: 1, target: node, clientX: x, clientY: y });
    node.dispatchEvent(
      new TouchEvent("touchstart", {
        touches: [touch(500, 400)],
        bubbles: true,
      }),
    );
    node.dispatchEvent(
      new TouchEvent("touchend", {
        changedTouches: [touch(500, 200)],
        bubbles: true,
      }),
    );
  });
  await expect(page.locator(".minimap-caption")).toHaveText("2.1 現在地");
  await page.getByRole("button", { name: "次の話題", exact: true }).tap();
  await expect(page.locator(".minimap-caption")).toHaveText("2.2 現在地");
});
