import { test, expect } from "@playwright/test";
import { blank, type Deck } from "../../src/model";
import { createTable } from "../../src/tableData";
const picture =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const initial: Deck = {
  version: 1,
  title: "内容の編集",
  slides: [
    {
      ...blank(0, 0),
      title: "内容の編集",
      elements: [
        {
          id: "words",
          type: "text",
          x: 80,
          y: 60,
          w: 700,
          h: 130,
          text: "Hello World",
          fontSize: 32,
          color: "#173d38",
        },
        {
          id: "photo",
          type: "image",
          x: 600,
          y: 230,
          w: 240,
          h: 220,
          src: picture,
        },
        {
          id: "table",
          type: "table",
          x: 80,
          y: 240,
          w: 450,
          h: 220,
          table: createTable(2, 2, () => crypto.randomUUID()),
          fontSize: 24,
          color: "#173d38",
          fill: "#ffffff",
          stroke: "#79958b",
          textAlign: "left",
        },
      ],
    },
  ],
};
test.beforeEach(async ({ page }) => {
  // A signed-out API fixture exposes the cloud dialog without contacting a service.
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { clientId: "", notice: "" } }),
  );
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { user: null } }),
  );
  await page.addInitScript((d) => {
    if (!localStorage.getItem("vhslide-deck-v1"))
      localStorage.setItem("vhslide-deck-v1", JSON.stringify(d));
  }, initial);
  await page.goto("/");
  await page
    .getByRole("button", { name: "内容の編集を編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
});
const saved = (page: any) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides[0].elements,
  );
test("whole-box alignment updates rich paragraphs while paragraph-left remains explicit", async ({
  page,
}) => {
  const object = page.locator(
    '.editor-page-current .element[data-element-id="words"]',
  );
  await object.click();
  const editor = page.getByRole("textbox", {
    name: "スライド内の文字",
    exact: true,
  });
  await editor.press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "文字を右揃え", exact: true }).click();
  await expect(object.locator(".rich-paragraph")).toHaveCSS(
    "text-align",
    "right",
  );
  await object.click();
  await expect(editor.locator("p")).toHaveCSS("text-align", "right");
  await page.locator(".text-selection-controls summary").click();
  await page.getByLabel("選択段落の揃え", { exact: true }).selectOption("");
  await expect(editor.locator("p")).toHaveCSS("text-align", "left");
  await editor.press("Escape");
  await expect(object.locator(".rich-paragraph")).toHaveCSS(
    "text-align",
    "left",
  );
});
test("selected text has persistent range styles and paragraphs; local undo and plain paste remain editable", async ({
  page,
}, info) => {
  const words = page.locator(
    '.editor-page-current .element[data-element-id="words"]',
  );
  await words.dblclick();
  const input = words.getByRole("textbox");
  await expect(input).toBeVisible();
  await input.evaluate((n) => {
    const t = n.querySelector("p")?.firstChild ?? n.firstChild!;
    const r = document.createRange();
    r.setStart(t, 0);
    r.setEnd(t, 5);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(
    page.getByRole("heading", { name: "選択した5文字", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "選択文字を下線", exact: true })
    .click();
  await page
    .getByRole("button", { name: "選択文字を斜体", exact: true })
    .click();
  await expect
    .poll(async () => JSON.stringify((await saved(page))[0].richText))
    .toContain('"underline":true');
  const size = page.getByRole("spinbutton", {
    name: "選択文字の大きさ",
    exact: true,
  });
  await size.fill("");
  await size.pressSequentially("36");
  await size.press("Enter");
  await expect
    .poll(async () => JSON.stringify((await saved(page))[0].richText))
    .toContain('"size":"36px"');
  await page
    .getByLabel("選択文字の書体", { exact: true })
    .selectOption("serif");
  await page.getByText("段落の設定", { exact: true }).click();
  await page
    .getByLabel("選択段落のリスト", { exact: true })
    .selectOption("ordered");
  await page.getByLabel("選択段落の行間", { exact: true }).selectOption("1.5");
  await page
    .getByLabel("選択段落の揃え", { exact: true })
    .selectOption("right");
  await expect
    .poll(async () => JSON.stringify((await saved(page))[0].richText))
    .toContain('"list":"ordered"');
  await input.press("Escape");
  await expect(words.locator(".rich-text-view")).toContainText("Hello World");
  await page.reload();
  await page
    .getByRole("button", { name: "内容の編集を編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await expect(
    page
      .locator('.editor-page-current .element[data-element-id="words"] span')
      .filter({ hasText: "Hello" })
      .first(),
  ).toHaveCSS("font-style", "italic");
  await page
    .locator('.editor-page-current .element[data-element-id="words"]')
    .dblclick();
  const again = page.locator(
    '.editor-page-current [data-element-id="words"] [role=textbox]',
  );
  await again.press("ControlOrMeta+End");
  await again.press("Enter");
  await again.pressSequentially("second");
  await expect
    .poll(async () => (await saved(page))[0].text)
    .toContain("second");
  await again.press("ControlOrMeta+z");
  await page.screenshot({ path: info.outputPath("text-formatting.png") });
  await again.press("Escape");
  await page
    .getByRole("button", { name: "保存方法を選ぶ", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^PDFで保存/ }).click();
  await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  ).toBeEnabled();
  const exported = page
    .locator(".print-export .rich-text-view span")
    .filter({ hasText: "Hello" })
    .first();
  await expect(exported).toHaveCSS("font-style", "italic");
  await expect(exported).toHaveCSS("text-decoration-line", "underline");
  if (info.project.name === "desktop")
    await page.pdf({
      path: info.outputPath("rich-text.pdf"),
      printBackground: true,
      preferCSSPageSize: true,
    });
});
test("crop is staged and cancellable, description persists, replacing keeps identity and geometry", async ({
  page,
}, info) => {
  const photo = page.locator(
    '.editor-page-current .element[data-element-id="photo"]',
  );
  await photo.click();
  await page
    .getByRole("textbox", { name: "画像の説明", exact: true })
    .fill("赤い花の写真");
  await page
    .getByRole("button", { name: "切り抜き・位置調整", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "画像を切り抜く",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "正方形", exact: true }).click();
  const zoom = dialog.getByRole("slider", {
    name: "画像の拡大率",
    exact: true,
  });
  await zoom.fill("2");
  expect((await saved(page))[1].crop).toBeUndefined();
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  expect((await saved(page))[1].crop).toBeUndefined();
  await page
    .getByRole("button", { name: "切り抜き・位置調整", exact: true })
    .click();
  await page
    .getByRole("slider", { name: "画像の拡大率", exact: true })
    .fill("2");
  await page.screenshot({ path: info.outputPath("image-crop.png") });
  await page
    .getByRole("button", { name: "切り抜きを適用", exact: true })
    .click();
  const before = (await saved(page))[1];
  expect(before.crop.w).toBeLessThan(1);
  await expect(photo.getByRole("img")).toHaveAttribute("alt", "赤い花の写真");
  await page.getByLabel("差し替える画像", { exact: true }).setInputFiles({
    name: "replace.png",
    mimeType: "image/png",
    buffer: Buffer.from(picture.split(",")[1], "base64"),
  });
  await expect
    .poll(async () => (await saved(page))[1].crop.w)
    .toBeGreaterThan(before.crop.w);
  const after = (await saved(page))[1];
  for (const key of ["id", "x", "y", "w", "h", "altText"])
    expect(after[key]).toBe(before[key]);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect
    .poll(async () => (await saved(page))[1].crop.w)
    .toBe(before.crop.w);
});
test("cell range styling, insertion, widths and TSV paste preserve stable cells and survive reload", async ({
  page,
}, info) => {
  const cell = (r: number, c: number) =>
    page.getByRole("textbox", { name: `表 ${r}行 ${c}列`, exact: true });
  await cell(1, 1).fill("見出し");
  await cell(2, 1).fill("保持する文字");
  await page.getByRole("tab", { name: "セル", exact: true }).click();
  await page
    .getByRole("button", { name: "セルの範囲を選ぶ", exact: true })
    .click();
  if (info.project.name === "touch") {
    await cell(1, 1).tap();
    await cell(2, 2).tap();
  } else {
    await cell(1, 1).click();
    await cell(2, 2).click();
  }
  await expect(
    page.getByRole("heading", { name: "4セルを選択中", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "セルを太字", exact: true }).click();
  await page
    .getByLabel("セルの上下揃え", { exact: true })
    .selectOption("middle");
  await page
    .getByRole("button", { name: "範囲選択を終了", exact: true })
    .click();
  await cell(2, 1).click();
  await page.getByText("選択位置の行・列を操作", { exact: true }).click();
  await page.getByRole("button", { name: "上に行を挿入", exact: true }).click();
  await expect(cell(3, 1)).toHaveValue("保持する文字");
  await cell(3, 1).click();
  await page.getByRole("slider", { name: "選択列の幅", exact: true }).fill("2");
  const t = await saved(page);
  expect(Object.values(t[2].table.widths)).toContain(2);
  await cell(1, 1).evaluate((n) =>
    n.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      }),
    ),
  ); // empty paste leaves content intact
  await cell(3, 2).click();
  await page.getByRole("tab", { name: "セル", exact: true }).click();
  await page
    .getByRole("button", { name: "セルの範囲を選ぶ", exact: true })
    .click();
  if (info.project.name === "touch") {
    await cell(1, 1).tap();
    await cell(2, 2).tap();
  } else {
    await cell(1, 1).click();
    await cell(2, 2).click();
  }
  await expect(
    page.getByRole("heading", { name: "4セルを選択中", exact: true }),
  ).toBeVisible();
  // Range paste targets the canvas; settings controls no longer consume editing keys.
  await page.locator(".editor-page-current .slide-canvas").evaluate((n) => {
    const d = new DataTransfer();
    d.setData("text/plain", "A\tB\tC\nD\tE\tF");
    n.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: d,
      }),
    );
  });
  await expect(cell(2, 3)).toHaveValue("F");
  await expect(cell(3, 1)).toHaveValue("保持する文字");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Delete");
  await expect(cell(2, 3)).toHaveValue("");
  await expect(page.locator(".editor-page-current .slide-table")).toHaveCount(
    1,
  );
  await expect(cell(3, 1)).toHaveValue("保持する文字");
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect(cell(2, 3)).toHaveValue("F");

  await cell(1, 1).focus();
  await cell(1, 1).evaluate((n) =>
    n.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    ),
  );
  await expect(cell(1, 1)).toHaveValue("A");
  const beforeModal = await saved(page);
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "クラウドの作品", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(cell(2, 3)).toHaveValue("F");
  expect(await saved(page)).toEqual(beforeModal);
  await page
    .getByRole("button", { name: "クラウドの作品を閉じる", exact: true })
    .click();
  await page.screenshot({ path: info.outputPath("table-cells.png") });
  await page.reload();
  await page
    .getByRole("button", { name: "内容の編集を編集", exact: true })
    .click();
  await expect(cell(2, 3)).toHaveValue("F");
});

test("plain clipboard text cannot import HTML, and image paste still adds a slide image while typing", async ({
  page,
}) => {
  const words = page.locator(
    '.editor-page-current .element[data-element-id="words"]',
  );
  await words.dblclick();
  const input = words.getByRole("textbox");
  await input.evaluate((n) => {
    const d = new DataTransfer();
    d.setData("text/plain", " safe text");
    d.setData(
      "text/html",
      '<img src=x onerror="window.__badPaste=true"><b>unsafe</b>',
    );
    n.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: d,
      }),
    );
  });
  await expect
    .poll(async () => (await saved(page))[0].text)
    .toContain(" safe text");
  expect(await page.evaluate(() => "__badPaste" in window)).toBe(false);
  await expect(words.locator("img")).toHaveCount(0);
  await input.evaluate((n, png) => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0)),
      d = new DataTransfer();
    d.items.add(new File([bytes], "clipboard.png", { type: "image/png" }));
    n.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: d,
      }),
    );
  }, picture.split(",")[1]);
  await expect(page.locator(".editor-page-current .slide-image")).toHaveCount(
    2,
  );
  expect((await saved(page))[0].text).toContain(" safe text");
});
