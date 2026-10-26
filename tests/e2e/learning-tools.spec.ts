import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
async function openTools(page: any, action: string) {
  if (action === "比較")
    return page.getByRole("button", { name: "比較", exact: true }).click();
  await page
    .getByRole("button", {
      name: action === "発表ルート" ? "発表方法を選ぶ" : "保存方法を選ぶ",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: action === "発表ルート" ? "発表ルートを編集" : action,
      exact: false,
    })
    .click();
}
test("selects, compares, prints and follows a saved route without changing source slides", async ({
  page,
}) => {
  await page.goto("/");
  await openTools(page, "比較");
  const checkboxes = page.getByLabel("対象スライド").getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(2).check();
  await page
    .getByRole("button", {
      name: "選んだスライドを比較（最大4枚）",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("スライドの比較").locator(".slide-canvas"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await openTools(page, "PDFで保存");
  await page.getByRole("button", { name: "選択を解除", exact: true }).click();
  await checkboxes.nth(0).check();
  await checkboxes.nth(2).check();
  await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".print-export .print-page")).toHaveCount(2);
  if (test.info().project.name === "desktop") {
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
    });
    expect([
      ...pdf.toString("latin1").matchAll(/\/Type\s*\/Page\b/g),
    ]).toHaveLength(2);
    const size = /\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/.exec(
      pdf.toString("latin1"),
    )!;
    expect(Math.abs(Number(size[1]) - 720)).toBeLessThan(0.5);
    expect(Math.abs(Number(size[2]) - 405)).toBeLessThan(0.5);
    await writeFile("/tmp/vhslide-comparison.pdf", pdf);
  }
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await openTools(page, "発表ルート");
  await checkboxes.nth(0).check();
  await checkboxes.nth(2).check();
  await page
    .getByRole("textbox", { name: "発表ルート名", exact: true })
    .fill("比較発表");
  await page
    .getByRole("button", { name: "選択順でルートを保存", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "比較発表で発表", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.reload();
  await openTools(page, "発表ルート");
  await page
    .getByRole("button", { name: "比較発表で発表", exact: true })
    .click();
  await expect(page.getByLabel("発表ルートの現在地")).toHaveText(
    "ルート 1 / 2",
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("発表ルートの現在地")).toHaveText(
    "ルート 2 / 2",
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("発表ルートの現在地")).toHaveText(
    "ルート 2 / 2",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet-bar")).toBeVisible();
});
test("saves a local version persistently and restores a copy with the current work preserved", async ({
  page,
}) => {
  await page.goto("/");
  await openTools(page, "保存した版");
  await page
    .getByRole("textbox", { name: "保存する版の名前", exact: true })
    .fill("授業前");
  await page.getByRole("button", { name: "版を保存", exact: true }).click();
  await expect(
    page.getByText("授業前 · わたしたちのまちの、いいところ"),
  ).toBeVisible();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.reload();
  await openTools(page, "保存した版");
  await page
    .getByRole("button", { name: "この版を確認", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("過去の版の確認")).toBeVisible();
  await page
    .getByRole("button", { name: "この版を別作品に復元", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "保存した版", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".deck-title")).toHaveValue(/（復元）$/);
  await openTools(page, "保存した版");
  await expect(page.getByText(/復元前の作品 ·/)).toBeVisible();
});

test("does not offer successful PDF output when an image cannot be decoded", async ({
  page,
}) => {
  await page.goto("/");
  const { sample } = await import("../../src/model");
  const book = sample();
  book.slides[0].elements.push({
    id: "broken-photo",
    type: "image",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    src: "data:image/png;base64,AAAA",
  });
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "broken-image.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(book)),
    });
  await openTools(page, "PDFで保存");
  await page.getByLabel("対象スライド").getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  await expect(
    page.getByText(
      "画像を読み込めません。接続を確認し、PDFの準備をやり直してください。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  ).toBeDisabled();
});

test("presentation routes move across sheets in both directions", async ({
  page,
}) => {
  await page.goto("/");
  const { blank } = await import("../../src/model");
  const a = { ...blank(0, 0), title: "前半のページ" },
    b = { ...blank(0, 0), sheetId: "second", title: "後半のページ" };
  const book = {
    version: 1,
    title: "シートをまたぐ発表",
    sheets: [
      { id: "main", name: "前半" },
      { id: "second", name: "後半" },
    ],
    slides: [a, b],
    routes: [{ id: "cross-sheet", name: "全体の発表", slides: [a.id, b.id] }],
  };
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "route.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(book)),
    });
  await openTools(page, "発表ルート");
  await page
    .getByRole("button", { name: "全体の発表で発表", exact: true })
    .click();
  await expect(page.locator(".present-caption")).toContainText("前半のページ");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".present-caption")).toContainText("後半のページ");
  await expect(page.getByLabel("発表ルートの現在地")).toHaveText(
    "ルート 2 / 2",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".present-caption")).toContainText("前半のページ");
});

test("local versions work offline without native randomUUID", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "保存方法を選ぶ", exact: true }),
  ).toBeVisible();
  await page.context().setOffline(true);
  await openTools(page, "保存した版");
  await page
    .getByRole("textbox", { name: "保存する版の名前", exact: true })
    .fill("オフラインで保存");
  await page.getByRole("button", { name: "版を保存", exact: true }).click();
  await expect(page.getByText(/オフラインで保存 ·/)).toBeVisible();
});

test("a failed pre-delete version preserves the work and deletion can be retried after storage recovers", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  );
  await page.evaluate(() => {
    (window as any).realHistoryDB = indexedDB;
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: {
        open() {
          const request: any = {
            error: new DOMException("容量不足（テスト）", "QuotaExceededError"),
          };
          setTimeout(() => request.onerror?.(), 0);
          return request;
        },
      },
    });
  });
  const remove = async () => {
    await page
      .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "このページを削除", exact: true })
      .click();
  };
  await remove();
  await expect(
    page.getByText(/削除を中止しました。版を保存できません。/),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
    ),
  ).toEqual(before);
  await page.evaluate(() =>
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: (window as any).realHistoryDB,
    }),
  );
  await remove();
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides.length,
        ),
    )
    .toBe(4);
});

test("purpose-specific entrances keep menus keyboard-accessible and restore focus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "学習・発表", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "自分の担当", exact: true }),
  ).toHaveCount(0);
  const saveMenu = page.getByRole("button", {
    name: "保存方法を選ぶ",
    exact: true,
  });
  await saveMenu.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: /^JSONで保存/ }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: /^PDFで保存/ }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "PDFで保存", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "選んだスライドを比較（最大4枚）",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(saveMenu).toBeFocused();
  await saveMenu.click();
  await page.locator(".deck-title").click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ファイルに保存", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await page
    .getByRole("button", { name: "マップをフィルタ", exact: true })
    .click();
  const filter = page.getByRole("region", {
    name: "マップのフィルタ設定",
    exact: true,
  });
  await filter.getByRole("button", { name: /自分の担当を選択/ }).click();
  await expect(filter).toContainText("5ページ選択中");
  await filter
    .getByRole("button", { name: "フィルタを適用", exact: true })
    .click();
  await expect(page.locator(".map-scroll [data-page-id]")).toHaveCount(5);
  const compare = page.getByRole("button", { name: "比較", exact: true });
  await compare.click();
  await expect(
    page.getByRole("dialog", { name: "スライドを比較", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "PDFの準備", exact: true }),
  ).toHaveCount(0);
  for (let i = 0; i < 4; i++)
    await page.getByLabel("対象スライド").getByRole("checkbox").nth(i).check();
  await page
    .getByRole("button", {
      name: "選んだスライドを比較（最大4枚）",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("対象スライド")).toHaveCount(0);
  await expect(
    page.getByLabel("スライドの比較").locator(".slide-canvas"),
  ).toHaveCount(4);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const dialog = document
          .querySelector("dialog")!
          .getBoundingClientRect();
        return [
          ...document.querySelectorAll(".compare-grid .slide-canvas"),
        ].every((el) => {
          const box = el.getBoundingClientRect();
          return (
            box.top >= dialog.top &&
            box.bottom <= dialog.bottom &&
            box.right <= dialog.right &&
            box.left >= dialog.left
          );
        });
      }),
    )
    .toBe(true);

  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(compare).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "この5ページを発表", exact: true })
    .click();
  await expect(page.locator(".present-caption")).toBeAttached();
});

test("a thousand-page picker only renders previews near the scroll viewport", async ({
  page,
}) => {
  await page.goto("/");
  const { blank } = await import("../../src/model");
  const book = {
    version: 1,
    title: "1000枚の選択",
    slides: Array.from({ length: 1000 }, (_, i) => ({
      ...blank(i % 10, Math.floor(i / 10)),
      title: `ページ${i + 1}`,
    })),
  };
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "1000.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(book)),
    });
  await openTools(page, "比較");
  const picker = page.getByLabel("対象スライド");
  await expect(picker.getByRole("checkbox")).toHaveCount(1000);
  await expect
    .poll(() => picker.locator(".slide-canvas").count())
    .toBeGreaterThan(0);
  expect(await picker.locator(".slide-canvas").count()).toBeLessThan(30);
  await picker.evaluate((e) => e.scrollTo({ top: e.scrollHeight }));
  await picker.getByRole("checkbox").last().check();
  await expect(picker.getByRole("checkbox").last()).toBeChecked();
  await expect
    .poll(() => picker.locator(".slide-canvas").count())
    .toBeLessThan(30);
});
