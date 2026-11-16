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

test("label settings can change in the sidebar even after the worksheet has answers", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "label-answered-host");
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "回答ありの見出し", slides: [blank(0, 0)] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await page.locator(".thumbnail").first().click();
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
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

  // An answer arrives (the worksheet now has response data).
  const sheets = (
    await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
  ).worksheets;
  const worksheetId = sheets[0].id;
  const fieldId = sheets[0].fields[0].id;
  expect(
    (
      await page.request.post(
        `/api/decks/${id}/worksheets/${worksheetId}/answer`,
        {
          headers,
          data: { values: { [fieldId]: "生徒の回答" }, patch: true },
        },
      )
    ).status(),
  ).toBe(200);
  await expect
    .poll(
      async () => {
        const list = (
          await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
        ).worksheets;
        return list[0]?.results?.responses?.length ?? 0;
      },
      { timeout: 15000 },
    )
    .toBe(1);

  // Fresh page load, then edit the placed field in the sidebar.
  await page.reload();
  await page.locator(".thumbnail").first().click();
  const placed = page.locator(".editor-workspace .response-field");
  await expect(placed).toBeVisible();
  await placed.click({ position: { x: 40, y: 8 } });
  const sidebar = page.locator(".form-sidebar-editor");
  await expect(sidebar).toBeVisible();
  await sidebar.getByText("入力欄の大きさ・文字を調整").click();
  await sidebar
    .getByRole("combobox", { name: "入力欄1の見出しの位置" })
    .selectOption("left");
  await sidebar
    .getByRole("checkbox", { name: "入力欄1の見出しを縦書きにする" })
    .check();
  await sidebar.getByRole("button", { name: "保存する" }).first().click();
  await expect(sidebar).toContainText("保存しました", { timeout: 15000 });

  await expect
    .poll(
      async () => {
        const list = (
          await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
        ).worksheets;
        const f = list[0]?.fields[0];
        return [f?.labelLayout, f?.labelVertical];
      },
      { timeout: 15000 },
    )
    .toEqual(["left", true]);
  await expect
    .poll(
      async () =>
        (await placed.locator(".worksheet-field").getAttribute("class")) ?? "",
      { timeout: 15000 },
    )
    .toContain("label-left");
});
