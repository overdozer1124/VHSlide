import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { sample } from "../../src/model";
import { worksheetTemplate } from "../../src/worksheetTemplates";
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

test("label settings set in the worksheet editor reach the answer dialog", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "label-panel-host");
  const { id } = await (
    await page.request.post("/api/decks", { headers, data: sample() })
  ).json();
  const definition = worksheetTemplate("blank");
  definition.title = "見出し設定の確認";
  definition.fields[0].kind = "text";
  definition.fields[0].label = "名称";
  definition.fields[0].wide = true;
  const created = await page.request.post(`/api/decks/${id}/worksheets`, {
    headers,
    data: definition,
  });
  expect(created.status()).toBe(200);
  const worksheetId = (await created.json()).worksheets[0].id;
  await page.request.post(`/api/decks/${id}/worksheets/${worksheetId}/status`, {
    headers,
    data: { status: "open" },
  });

  await page.goto(`/?room=${id}`);
  const dialog = page.locator(".activity-panel");
  await page
    .getByRole("button", { name: "フォーム", exact: true })
    .click();
  await dialog.getByRole("tab", { name: "ワークシート" }).click();
  await dialog
    .getByRole("button", { name: "設定・内容の確認", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "項目を編集・追加", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "ワークシートを編集" }),
  ).toBeVisible();
  await dialog.getByText("入力欄の大きさ・文字を調整").first().click();
  await dialog
    .getByRole("combobox", { name: "入力欄1の見出しの位置" })
    .selectOption("left");
  await dialog
    .getByRole("checkbox", { name: "入力欄1の見出しを縦書きにする" })
    .check();
  await dialog
    .getByRole("checkbox", { name: "入力欄1の見出しを詰める" })
    .check();
  await dialog.getByRole("button", { name: "変更を保存", exact: true }).click();

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

  // Back in the answer view, the field renders with its label on the left.
  await dialog
    .getByRole("button", { name: "自分で入力", exact: true })
    .click();
  const area = dialog.locator(".worksheet-field").first();
  await expect
    .poll(async () => (await area.getAttribute("class")) ?? "", {
      timeout: 15000,
    })
    .toContain("label-left");
  expect(await area.getAttribute("class")).toContain("label-vertical");
  const label = area.locator("label.worksheet-input-label");
  const writingMode = await label.evaluate(
    (el) => getComputedStyle(el).writingMode,
  );
  expect(writingMode).toBe("vertical-rl");
  const labelBox = await label.boundingBox();
  const inputBox = await area.locator("textarea").boundingBox();
  expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(inputBox!.x + 1);
});
