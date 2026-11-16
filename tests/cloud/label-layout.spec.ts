import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { blank } from "../../src/model";
const headers = { Origin: "http://127.0.0.1:3187" };
async function signIn(page: Page, name: string) {
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential },
      })
    ).status(),
  ).toBe(200);
}
const launcher = (page: Page) =>
  page.getByRole("button", { name: "フォーム", exact: true });

test("a field label can move to the left, turn vertical and shrink so a short frame keeps its input area", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "label-layout-host");
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "見出しの配置", slides: [blank(0, 0)] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await page.locator(".thumbnail").first().click();
  await launcher(page).click();
  await page.getByRole("tab", { name: "回答欄を追加", exact: true }).click();
  const tools = page.getByRole("region", {
    name: "回答欄の追加",
    exact: true,
  });
  await tools
    .getByRole("textbox", { name: "新しい入力項目名" })
    .fill("名称");
  await tools.getByRole("button", { name: /^記述/ }).click();
  await tools
    .getByRole("button", { name: "受付を開始してスライドに追加", exact: true })
    .click();
  const field = page.locator(".editor-workspace .response-field");
  await expect(field).toBeVisible();
  const area = field.locator(".worksheet-field");
  const input = field.locator("textarea");
  await expect(input).toBeVisible();
  const before = await input.evaluate((el) => el.clientHeight);

  // Select the field and change its label settings in the sidebar editor.
  await field.click({ position: { x: 40, y: 8 } });
  const sidebar = page.locator(".form-sidebar-editor");
  await expect(sidebar).toBeVisible();
  await sidebar.getByText("入力欄の大きさ・文字を調整").click();
  await sidebar
    .getByRole("combobox", { name: "入力欄1の見出しの位置" })
    .selectOption("left");
  await sidebar
    .getByRole("checkbox", { name: "入力欄1の見出しを縦書きにする" })
    .check();
  await sidebar
    .getByRole("checkbox", { name: "入力欄1の見出しを詰める" })
    .check();
  await sidebar.getByRole("button", { name: "保存する" }).first().click();

  // The settings are stored on the worksheet definition.
  await expect
    .poll(
      async () => {
        const sheets = (
          await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
        ).worksheets;
        const f = sheets[0]?.fields[0];
        return [f?.labelLayout, f?.labelVertical, f?.labelCompact];
      },
      { timeout: 15000 },
    )
    .toEqual(["left", true, true]);

  // The placed field now renders its label as a narrow vertical strip on
  // the left, and the textarea reclaims the height the label used to eat.
  await expect
    .poll(async () => (await area.getAttribute("class")) ?? "", {
      timeout: 15000,
    })
    .toContain("label-left");
  expect(await area.getAttribute("class")).toContain("label-vertical");
  expect(await area.getAttribute("class")).toContain("label-compact");
  const label = field.locator("label.worksheet-input-label");
  await expect(label).toBeVisible();
  const writingMode = await label.evaluate(
    (el) => getComputedStyle(el).writingMode,
  );
  expect(writingMode).toBe("vertical-rl");
  const labelBox = await label.boundingBox();
  const inputBox = await input.boundingBox();
  expect(labelBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(inputBox!.x + 1);
  expect(labelBox!.width).toBeLessThanOrEqual(56);
  const after = await input.evaluate((el) => el.clientHeight);
  expect(after).toBeGreaterThan(before + 8);
});
