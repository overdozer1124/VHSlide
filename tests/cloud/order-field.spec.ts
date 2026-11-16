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

test("ordering field: shuffled pool, tap to build a sequence, results keep the order", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "order-field-host");
  const { id } = await (
    await page.request.post("/api/decks", { headers, data: sample() })
  ).json();
  const definition = worksheetTemplate("blank");
  definition.title = "並べ替えの確認";
  definition.fields[0].kind = "order";
  definition.fields[0].label = "英文を並べ替えよう";
  definition.fields[0].options = ["I", "am", "a", "student"];
  definition.fields[0].wide = true;
  const created = await page.request.post(`/api/decks/${id}/worksheets`, {
    headers,
    data: definition,
  });
  expect(created.status()).toBe(200);
  const sheet = (await created.json()).worksheets[0];
  const fieldId = sheet.fields[0].id;
  await page.request.post(`/api/decks/${id}/worksheets/${sheet.id}/status`, {
    headers,
    data: { status: "open" },
  });

  await page.goto(`/?room=${id}`);
  const dialog = page.locator(".activity-panel");
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await dialog.getByRole("tab", { name: "ワークシート" }).click();
  await dialog
    .getByRole("button", { name: "自分で入力", exact: true })
    .click();

  const field = dialog.locator(".worksheet-field").first();
  const pool = field.locator(".worksheet-order-pool .worksheet-order-chip");
  await expect(pool).toHaveCount(4);
  const poolTexts = (await pool.allTextContents()).map((t) => t.trim());
  expect([...poolTexts].sort()).toEqual(["I", "a", "am", "student"]);
  // The pool never starts out already in the listed (answer) order.
  expect(poolTexts).not.toEqual(["I", "am", "a", "student"]);

  const tap = (text: string) =>
    field
      .locator(".worksheet-order-pool .worksheet-order-chip", { hasText: text })
      .first()
      .click();
  // Start with a wrong item, then remove it from the sequence again.
  await tap("student");
  const sequence = field.locator(
    ".worksheet-order-sequence .worksheet-order-chip",
  );
  await expect(sequence).toHaveCount(1);
  await sequence.first().click();
  await expect(sequence).toHaveCount(0);
  await expect(pool).toHaveCount(4);

  // Build the sentence in order.
  for (const text of ["I", "am", "a", "student"]) await tap(text);
  await expect(sequence).toHaveCount(4);
  await expect(pool).toHaveCount(0);
  const sequenceTexts = (await sequence.allTextContents()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  );
  expect(sequenceTexts).toEqual(["1I", "2am", "3a", "4student"]);

  // Answers in this view save automatically as they change.
  await expect
    .poll(
      async () => {
        const sheets = (
          await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
        ).worksheets;
        return sheets[0]?.own?.values?.[fieldId];
      },
      { timeout: 15000 },
    )
    .toEqual([0, 1, 2, 3]);

  // The host results view shows the chosen sequence as text.
  await dialog
    .getByRole("button", { name: /回答結果（1人）/ })
    .click();
  await expect(dialog).toContainText("I → am → a → student");
});
