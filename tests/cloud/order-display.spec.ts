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

test("order field display: random never matches the listed order, as-listed keeps it, and the editor switches it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, "order-display-host");
  const { id } = await (
    await page.request.post("/api/decks", { headers, data: sample() })
  ).json();
  const definition = worksheetTemplate("blank");
  definition.title = "表示順の確認";
  const base = definition.fields[0];
  definition.fields = [
    {
      ...base,
      id: "order-random",
      kind: "order" as const,
      label: "ランダム表示",
      options: ["I", "am", "a", "student"],
      wide: true,
    },
    {
      ...base,
      id: "order-listed",
      kind: "order" as const,
      label: "入力した順で表示",
      options: ["I", "am", "a", "student"],
      wide: true,
      orderAsListed: true,
    },
  ];
  const created = await page.request.post(`/api/decks/${id}/worksheets`, {
    headers,
    data: definition,
  });
  expect(created.status()).toBe(200);
  const sheet = (await created.json()).worksheets[0];
  expect(sheet.fields[1].orderAsListed).toBe(true);
  await page.request.post(`/api/decks/${id}/worksheets/${sheet.id}/status`, {
    headers,
    data: { status: "open" },
  });

  const openAnswerView = async () => {
    const dialog = page.locator(".activity-panel");
    if (!(await dialog.isVisible())) {
      await page
        .getByRole("button", { name: "フォーム", exact: true })
        .click();
    }
    await dialog.getByRole("tab", { name: "ワークシート" }).click();
    await dialog
      .getByRole("button", { name: "自分で入力", exact: true })
      .click();
    return dialog;
  };
  const poolTexts = async (dialog: ReturnType<Page["locator"]>, index: number) =>
    (
      await dialog
        .locator(".worksheet-field")
        .nth(index)
        .locator(".worksheet-order-pool .worksheet-order-chip")
        .allTextContents()
    ).map((t) => t.trim());

  await page.goto(`/?room=${id}`);
  let dialog = await openAnswerView();
  // Random display: same items, never the listed order.
  expect(await poolTexts(dialog, 0)).not.toEqual(["I", "am", "a", "student"]);
  expect([...(await poolTexts(dialog, 0))].sort()).toEqual([
    "I",
    "a",
    "am",
    "student",
  ]);
  // As-listed display: exactly the order the teacher entered.
  expect(await poolTexts(dialog, 1)).toEqual(["I", "am", "a", "student"]);
  await page.locator(".activity-panel header button").click();
  await expect(dialog).toBeHidden();

  // Switch the first field to as-listed in the worksheet editor.
  dialog = page.locator(".activity-panel");
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await dialog.getByRole("tab", { name: "ワークシート" }).click();
  await dialog
    .getByRole("button", { name: "設定・内容の確認", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "項目を編集・追加", exact: true })
    .click();
  const displaySelect = dialog.getByRole("combobox", {
    name: "入力欄1の並び替え前の表示",
  });
  await expect(displaySelect).toHaveValue("shuffle");
  await displaySelect.selectOption("asis");
  await dialog
    .getByRole("button", { name: "変更を保存", exact: true })
    .click();
  await expect(dialog).toContainText("保存しました");
  await page.locator(".activity-panel header button").click();
  await expect(dialog).toBeHidden();

  dialog = await openAnswerView();
  expect(await poolTexts(dialog, 0)).toEqual(["I", "am", "a", "student"]);
});
