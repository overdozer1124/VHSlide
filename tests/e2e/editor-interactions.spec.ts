import { test, expect } from "@playwright/test";
import type { Page, Locator } from "@playwright/test";
const data = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
async function editor(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
}
async function dragStart(page: Page, node: Locator) {
  const b = (await node.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2, {
    steps: 3,
  });
  await expect(page.locator(".rail-drag-preview")).toBeVisible();
}
async function dragTo(page: Page, node: Locator) {
  const b = (await node.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
}

test("row choices stay independent after selection, keyboard navigation and JSON reload", async ({
  page,
}) => {
  await editor(page);
  await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  await page
    .getByRole("button", { name: "1.3 人とつながるを編集", exact: true })
    .click();
  await expect(page.locator(".rail-trigger").nth(0)).toContainText(
    "人とつながる",
  );
  await expect(page.locator(".rail-trigger").nth(1)).toContainText(
    "まちを歩いてみたら",
  );
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "まちを歩いてみたら",
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "お気に入りの公園",
  );
  await expect(page.locator(".rail-trigger").nth(0)).toContainText(
    "人とつながる",
  );
  await expect(page.locator(".rail-trigger").nth(1)).toContainText(
    "お気に入りの公園",
  );
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "人とつながる",
  );
  const saved = await data(page);
  expect(saved.rowSelections).toHaveLength(2);
  await page.reload();
  await page
    .getByRole("button", { name: "人とつながるを編集", exact: true })
    .click();
  await expect(page.locator(".rail-trigger").nth(0)).toContainText(
    "人とつながる",
  );
  await expect(page.locator(".rail-trigger").nth(1)).toContainText(
    "お気に入りの公園",
  );
});

test("text edits directly inside its box, preserves the caret and does not navigate on arrows", async ({
  page,
}) => {
  await editor(page);
  await page.getByRole("button", { name: "文字", exact: true }).click();
  const input = page.getByRole("textbox", {
    name: "スライド内の文字",
    exact: true,
  });
  await expect(input).toBeFocused();
  await input.fill("最初のことば");
  await page.keyboard.press("End");
  await page.keyboard.type(" ABC");
  await expect(input).toHaveText("最初のことば ABC");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("!");
  await expect(input).toHaveText("最初のことば AB!C");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("日本語の入力");
  await expect(input).toContainText("日本語の入力");
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "わたしたちのまち",
  );
  const text = (await data(page)).slides[0].elements.at(-1).text;
  expect(text).toContain("AB!");
  expect(text).toContain("\n");
  expect(text).toContain("日本語");
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  const element = page.locator(".editor-workspace .element").last();
  await element.click();
  await expect(
    page.getByRole("textbox", { name: "スライド内の文字", exact: true }),
  ).toContainText("日本語の入力");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "スライド内の文字", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "文字の内容", exact: true }),
  ).toHaveCount(0);
});

test("dragging a left thumbnail reorders the whole row and undo restores every page", async ({
  page,
}) => {
  await editor(page);
  const before = await data(page);
  await dragStart(page, page.locator(".rail-trigger").nth(0));
  await dragTo(page, page.locator('[data-drop-row="1"] .rail-trigger'));
  await page.mouse.up();
  const moved = await data(page);
  for (const original of before.slides)
    expect(moved.slides.find((s: any) => s.id === original.id)).toMatchObject({
      x: original.x,
      y: 1 - original.y,
    });
  await expect(page.locator(".rail-drag-preview")).toHaveCount(0);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  expect(await data(page)).toEqual(before);
});

test("one thumbnail can cross rows, unfold its destination and drop into an empty cell", async ({
  page,
}) => {
  await editor(page);
  const before = await data(page);
  await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  await dragStart(
    page,
    page.getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true }),
  );
  await dragTo(page, page.locator('[data-drop-row="1"] .rail-trigger'));
  await expect(
    page.getByRole("region", { name: "2段目の横のページ一覧" }),
  ).toBeVisible();
  await dragTo(page, page.locator('[data-drop-cell="2,1"] .row-page'));
  await page.mouse.up();
  const moved = await data(page),
    source = before.slides.find((s: any) => s.title === "自然がいっぱい");
  expect(moved.slides.find((s: any) => s.id === source.id)).toMatchObject({
    x: 2,
    y: 1,
  });
  expect(moved.slides.filter((s: any) => s.id !== source.id)).toEqual(
    before.slides.filter((s: any) => s.id !== source.id),
  );
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "自然がいっぱい",
  );
  await expect(page.locator(".rail-trigger").nth(1)).toContainText(
    "自然がいっぱい",
  );
});

test("dropping onto another page swaps contents and cancelling a drag does not mutate the deck", async ({
  page,
}) => {
  await editor(page);
  const before = await data(page);
  await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  await dragStart(
    page,
    page.getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true }),
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await data(page)).toEqual(before);
  await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  await dragStart(
    page,
    page.getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true }),
  );
  await dragTo(page, page.locator('[data-drop-row="1"] .rail-trigger'));
  await page.mouse.up();
  const moved = await data(page);
  expect(
    moved.slides.find((s: any) => s.title === "自然がいっぱい"),
  ).toMatchObject({ x: 0, y: 1 });
  expect(
    moved.slides.find((s: any) => s.title === "まちを歩いてみたら"),
  ).toMatchObject({ x: 1, y: 0 });
  expect(moved.slides).toHaveLength(5);
});

test("touch long-press moves a whole row without changing the sidebar width", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "実タッチ用のチェック");
  await editor(page);
  const before = await data(page),
    width = (await page.locator(".two-d-rail").boundingBox())!.width;
  const source = (await page.locator(".rail-trigger").nth(0).boundingBox())!,
    target = (await page.locator(".rail-trigger").nth(1).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const start = {
    x: Math.round(source.x + source.width / 2),
    y: Math.round(source.y + source.height / 2),
  };
  const end = {
    x: Math.round(target.x + target.width / 2),
    y: Math.round(target.y + target.height / 2),
  };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...start, id: 1 }],
  });
  await expect(page.locator(".rail-drag-preview")).toBeVisible();
  for (let i = 1; i <= 10; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + ((end.x - start.x) * i) / 10,
          y: start.y + ((end.y - start.y) * i) / 10,
          id: 1,
        },
      ],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(
    (await data(page)).slides.find((s: any) => s.id === before.slides[0].id).y,
  ).toBe(1);
  expect((await page.locator(".two-d-rail").boundingBox())!.width).toBe(width);
});

test("arrow navigation continues after the clicked thumbnail flyout closes", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "マウスで一覧を離れる操作");
  await editor(page);
  await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  await page
    .getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true })
    .click();
  await page.mouse.move(1100, 800);
  await expect(page.locator(".row-flyout")).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "人とつながる",
  );
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "まちを歩いてみたら",
  );
});

test("a single page can be dropped into a new last row", async ({ page }) => {
  await editor(page);
  await page.getByRole("button", { name: "1段目の横のページをひらく" }).click();
  await dragStart(
    page,
    page.getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true }),
  );
  await dragTo(page, page.locator(".rail-new-row-drop"));
  await page.mouse.up();
  expect(
    (await data(page)).slides.find((s: any) => s.title === "自然がいっぱい"),
  ).toMatchObject({ x: 1, y: 2 });
  await expect(page.locator(".rail-trigger")).toHaveCount(3);
  await expect(
    page.locator(".rail-trigger.rail-active .rail-coordinate"),
  ).toHaveText("3.2");
  await expect(page.locator(".canvas-title > span")).toHaveText("3.2 / 16:9");
});

test("Japanese composition remains in the canvas textbox across live updates", async ({
  page,
}) => {
  await editor(page);
  await page.getByRole("button", { name: "文字", exact: true }).click();
  const input = page.getByRole("textbox", {
    name: "スライド内の文字",
    exact: true,
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "にほん",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await expect(input).toBeFocused();
  await cdp.send("Input.insertText", { text: "日本" });
  await expect(input).toHaveText("日本");
  expect((await data(page)).slides[0].elements.at(-1).text).toBe("日本");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("textbox", { name: "ページの名前" })).toHaveValue(
    "わたしたちのまち",
  );
});

test("touch drags an individual page across an unfolding row", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "touch", "実タッチで展開中の移動を確認");
  await editor(page);
  await page.getByRole("button", { name: "1段目の横のページをひらく" }).tap();
  const source = (await page
    .getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true })
    .boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  let current = {
    x: Math.round(source.x + source.width / 2),
    y: Math.round(source.y + source.height / 2),
  };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...current, id: 1 }],
  });
  await expect(page.locator(".rail-drag-preview")).toBeVisible();
  async function moveTo(node: Locator) {
    const b = (await node.boundingBox())!;
    const next = {
      x: Math.round(b.x + b.width / 2),
      y: Math.round(b.y + b.height / 2),
    };
    for (let i = 1; i <= 10; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: current.x + ((next.x - current.x) * i) / 10,
            y: current.y + ((next.y - current.y) * i) / 10,
            id: 1,
          },
        ],
      });
    current = next;
  }
  await moveTo(page.locator('[data-drop-row="1"] .rail-trigger'));
  await expect(
    page.getByRole("region", { name: "2段目の横のページ一覧" }),
  ).toBeVisible();
  await moveTo(page.locator('[data-drop-cell="2,1"] .row-page'));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(
    (await data(page)).slides.find((s: any) => s.title === "自然がいっぱい"),
  ).toMatchObject({ x: 2, y: 1 });
});
