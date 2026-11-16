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

// Slide-placed response fields must not render explanatory notes under the
// input (the user asked for no text outside the input field); only a save
// error may be shown.
test("a response field on a slide shows no note text under the input", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "field-notes-host");
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "注意書きの確認", slides: [blank(0, 0)] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await expect(page.locator(".slide-card").first()).toBeVisible();
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

  // Close reception: the field can no longer be answered.
  const sheets = (
    await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
  ).worksheets;
  expect(
    (
      await page.request.post(
        `/api/decks/${id}/worksheets/${sheets[0].id}/status`,
        { headers, data: { status: "closed" } },
      )
    ).status(),
  ).toBe(200);
  await page.reload();
  await page.locator(".thumbnail").first().click();
  const placed = page.locator(".editor-workspace .response-field");
  await expect(placed).toBeVisible();
  await expect(placed.locator("textarea")).toBeDisabled();
  // No explanatory note under the input.
  await expect(placed.locator("small")).toHaveCount(0);
  await expect(placed).not.toContainText("入力できません");
  await expect(placed).not.toContainText("受付は終了しました");
  await expect(placed).not.toContainText("入力できます");
});
