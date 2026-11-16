import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { blank } from "../../src/model";
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

// Regression: the sidebar worksheet save used to send the whole worksheet
// view (including every response) as "expected", so once photo/drawing
// answers piled up, the request exceeded the body limit and the save was
// rejected with a size error. Only the definition may be sent.
test("sidebar label settings save even when drawing answers make results large", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, "label-big-host");
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "写真の回答がある見出し", slides: [blank(0, 0)] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();

  const definition = worksheetTemplate("blank");
  definition.title = "写真ワークシート";
  const base = definition.fields[0];
  definition.fields = [1, 2, 3].map((n) => ({
    ...base,
    id: `photo-field-${n}`,
    kind: "drawing" as const,
    label: `写真${n}`,
    options: [],
  }));
  const made = await page.request.post(`/api/decks/${id}/worksheets`, {
    headers,
    data: definition,
  });
  expect(made.status()).toBe(200);
  const sheet = (await made.json()).worksheets[0];
  await page.request.post(`/api/decks/${id}/worksheets/${sheet.id}/status`, {
    headers,
    data: { status: "open" },
  });
  // One respondent answers all three photo fields (saved per field, as the
  // real client does); the stored results grow past the request body cap.
  const photo = `data:image/jpeg;base64,/9j/${"A".repeat(110_000)}`;
  for (const f of definition.fields) {
    expect(
      (
        await page.request.post(
          `/api/decks/${id}/worksheets/${sheet.id}/answer`,
          { headers, data: { values: { [f.id]: photo }, patch: true } },
        )
      ).status(),
    ).toBe(200);
  }
  await expect
    .poll(
      async () => {
        const list = (
          await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
        ).worksheets;
        return JSON.stringify(list[0]?.results ?? {}).length;
      },
      { timeout: 15000 },
    )
    .toBeGreaterThan(300_000);

  // Place the worksheet on the slide and edit the first field's label in
  // the sidebar.
  await page.goto(`/?room=${id}`);
  await page.locator(".thumbnail").first().click();
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await page.getByRole("tab", { name: "ワークシート", exact: true }).click();
  const dialog = page.locator(".activity-panel");
  await dialog
    .getByRole("button", { name: "このワークシートをスライドに配置" })
    .click();
  // Placing the worksheet closes the panel by itself.
  await expect(page.locator(".activity-panel")).toBeHidden();
  const placed = page.locator(".editor-workspace .slide-worksheet");
  await expect(placed).toBeVisible();
  await placed.locator("header h3").click({ timeout: 20_000 });
  const sidebar = page.locator(".form-sidebar-editor");
  await expect(sidebar).toBeVisible({ timeout: 20_000 });
  const group = sidebar.getByRole("group", { name: "入力欄 1" });
  await group.locator("summary").click({ timeout: 20_000 });
  const position = group.getByRole("combobox", {
    name: "入力欄1の見出しの位置",
  });
  await expect(position).toBeVisible({ timeout: 20_000 });
  await position.selectOption("left", { timeout: 20_000 });
  await sidebar
    .getByRole("checkbox", { name: "入力欄1の見出しを縦書きにする" })
    .check();
  await sidebar.getByRole("button", { name: "保存する" }).first().click();
  await expect(sidebar).toContainText("保存しました", { timeout: 15000 });
  await expect(sidebar).not.toContainText("送信データは");
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
});
