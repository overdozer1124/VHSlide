import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const tab = (p: Page, name: string) =>
  p.getByRole("tab", { name, exact: true });
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
const input = (p: Page) =>
  p.getByRole("textbox", { name: "シート名を編集", exact: true });
async function start(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem("vhslide-deck-v1")) return;
    localStorage.setItem(
      "vhslide-deck-v1",
      JSON.stringify({
        version: 1,
        title: "シート操作",
        activeSheetId: "a",
        sheets: ["a", "b", "c", "d"].map((id, i) => ({
          id,
          name: `シート${i + 1}`,
        })),
        slides: ["a", "b", "c", "d"].flatMap((id) =>
          [0, 1].map((x) => ({
            id: `${id}-${x}`,
            sheetId: id,
            x,
            y: 0,
            title: `${id}ページ${x + 1}`,
            background: "#ffffff",
            elements: [],
          })),
        ),
      }),
    );
  });
  await page.goto("/");
}

test("double click edits the tab name inline, enter/blur commit, escape cancels and validation retains the draft", async ({
  page,
}) => {
  await start(page);
  await button(page, "aページ2を編集").click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await tab(page, "シート1").dblclick();
  await expect(input(page)).toHaveValue("シート1");
  expect(
    await input(page).evaluate(
      (e: HTMLInputElement) => e.selectionEnd! - e.selectionStart!,
    ),
  ).toBe(4);
  await input(page).fill("研究");
  await input(page).press("Enter");
  await expect(tab(page, "研究")).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("aページ2");
  await tab(page, "研究").dblclick();
  await input(page).fill("取り消す");
  await input(page).press("Escape");
  await expect(tab(page, "研究")).toBeVisible();
  await tab(page, "研究").focus();
  await page.keyboard.press("F2");
  await input(page).fill("シート2");
  await input(page).press("Enter");
  await expect(page.locator(".toast")).toContainText(
    "同じ名前のシートがあります",
  );
  await expect(input(page)).toHaveValue("シート2");
  await input(page).fill("発表");
  await button(page, "シートの操作").click();
  await expect(tab(page, "発表")).toBeVisible();
  await page.reload();
  await expect(tab(page, "発表")).toBeVisible();
});

test("right click targets the clicked sheet without switching, closes outside or with Escape, and renames from the menu", async ({
  page,
}) => {
  await start(page);
  await tab(page, "シート3").click({ button: "right" });
  const menu = page.getByRole("region", { name: "シートの操作メニュー" });
  await expect(menu).toContainText("シート3");
  await expect(tab(page, "シート1")).toHaveAttribute("aria-selected", "true");
  await button(page, "名前の変更").click();
  await input(page).fill("別のシート");
  await input(page).press("Enter");
  await expect(tab(page, "別のシート")).toHaveAttribute(
    "aria-selected",
    "false",
  );
  await tab(page, "別のシート").click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await tab(page, "別のシート").focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await button(page, "マップをフィルタ").click();
  await expect(menu).toHaveCount(0);
});

async function drag(
  page: Page,
  from: string,
  to: string,
  side: "before" | "after",
  touch: boolean,
) {
  const a = (await tab(page, from).boundingBox())!,
    b = (await tab(page, to).boundingBox())!;
  const x = a.x + a.width / 2,
    y = a.y + a.height / 2;
  const dest = b.x + (side === "before" ? 4 : b.width - 4);
  if (touch) {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x, y }],
    });
    await page.waitForTimeout(330); // deliberate long press activates drag rather than horizontal scrolling
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 1, x: dest, y }],
    });
    await expect(
      page.locator(`.sheet-tab-item[data-insert="${side}"]`),
    ).toHaveCount(1);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 8, y, { steps: 2 });
    await page.mouse.move(dest, y, { steps: 10 });
    await expect(
      page.locator(`.sheet-tab-item[data-insert="${side}"]`),
    ).toHaveCount(1);
    await page.mouse.up();
  }
}
test("drag reorders across tabs in both directions, preserves the editor and undo restores the whole move", async ({
  page,
}, info) => {
  await start(page);
  await button(page, "aページ2を編集").click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides,
  );
  await drag(
    page,
    "シート1",
    "シート4",
    "after",
    info.project.name === "touch",
  );
  await expect(page.getByRole("tab")).toHaveText([
    "シート2",
    "シート3",
    "シート4",
    "シート1",
  ]);
  await expect(tab(page, "シート1")).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("textbox", { name: "ページの名前", exact: true }),
  ).toHaveValue("aページ2");
  await button(page, "もとに戻す").click();
  await expect(page.getByRole("tab")).toHaveText([
    "シート1",
    "シート2",
    "シート3",
    "シート4",
  ]);
  await drag(
    page,
    "シート4",
    "シート1",
    "before",
    info.project.name === "touch",
  );
  await expect(page.getByRole("tab")).toHaveText([
    "シート4",
    "シート1",
    "シート2",
    "シート3",
  ]);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides,
    ),
  ).toEqual(before);
  await page.reload();
  await expect(page.getByRole("tab")).toHaveText([
    "シート4",
    "シート1",
    "シート2",
    "シート3",
  ]);
});

test("Escape and dropping outside the sheet bar cancel a mouse reorder", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "マウスのキャンセル操作");
  await start(page);
  const a = (await tab(page, "シート1").boundingBox())!;
  const b = (await tab(page, "シート4").boundingBox())!;
  const x = a.x + a.width / 2,
    y = a.y + a.height / 2;
  for (const escape of [true, false]) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 4, y, { steps: 12 });
    await expect(page.locator(".sheet-tab-item[data-insert]")).toHaveCount(1);
    if (escape) await page.keyboard.press("Escape");
    else await page.mouse.move(b.x + b.width - 4, y - 100, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByRole("tab")).toHaveText([
      "シート1",
      "シート2",
      "シート3",
      "シート4",
    ]);
    await expect(page.locator(".sheet-drag-preview")).toHaveCount(0);
  }
});
