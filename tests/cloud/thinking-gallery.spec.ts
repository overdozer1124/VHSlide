import { test, expect, type Page } from "@playwright/test";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";

const headers = { Origin: scopeOrigin };

async function addGuest(page: Page, id: string, name: string) {
  expect(
    (
      await page.request.post(`/api/decks/${id}/recipients`, {
        headers,
        data: {
          recipients: [
            {
              email: `${name}@example.test`,
              access: { mode: "all", comment: true, rows: [], columns: [], slides: [] },
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
}

async function writeCard(page: Page, text: string) {
  const slide = page.locator(".slide-thinking.is-interactive");
  const zone = slide.locator(".thinking-zone").first();
  await zone.getByRole("button", { name: "＋カードを書く" }).click();
  await zone.getByLabel("カードの内容").fill(text);
  await zone.getByRole("button", { name: "追加する" }).click();
  await expect(zone.locator(".thinking-card", { hasText: text })).toBeVisible({
    timeout: 15_000,
  });
}

test("the results gallery shows one chart per student, names on demand", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-gallery-host`);
  const guestName = `${info.project.name}-gallery-one`;
  const guest2Name = `${info.project.name}-gallery-two`;
  await addGuest(page, id, guestName);
  await addGuest(page, id, guest2Name);
  const created = await page.request.post(`/api/decks/${id}/thinking`, {
    headers,
    data: {
      template: "venn2",
      unit: "individual",
      definition: { title: "ギャラリーのベン図", cardColors: [] },
    },
  });
  expect(created.status()).toBe(200);
  const toolId = (await created.json()).createdId as string;
  expect(
    (
      await page.request.post(`/api/decks/${id}/thinking/${toolId}/status`, {
        headers,
        data: { status: "open" },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  const panel = page.locator(".activity-panel");
  await panel.getByRole("tab", { name: "思考ツール" }).click();
  const card = panel.locator(".thinking-tool-card", { hasText: "ギャラリーのベン図" });
  await card.getByRole("button", { name: "スライドに配置" }).click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });

  for (const [name, text] of [
    [guestName, "ひとりめのカード"],
    [guest2Name, "ふたりめのカード"],
  ] as const) {
    const context = await browser.newContext({ baseURL: scopeOrigin });
    const student = await context.newPage();
    await scopeLogin(student, name);
    await student.goto(`/?room=${id}`);
    await student.locator(".slide-card").first().click();
    await expect(
      student.locator(".slide-thinking.is-interactive"),
    ).toBeVisible({ timeout: 15_000 });
    await writeCard(student, text);
    await context.close();
  }

  // Back on the host: open the results and switch to the gallery.
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await panel.getByRole("tab", { name: "思考ツール" }).click();
  await card.getByRole("button", { name: "結果を見る" }).click();
  const results = panel.locator(".thinking-results");
  await expect(results.locator(".thinking-results-count")).toHaveText(
    "カード2枚",
    { timeout: 15_000 },
  );
  await results.getByRole("tab", { name: "生徒ごと" }).click();
  const gallery = results.locator(".thinking-gallery");
  await expect(gallery.locator(".thinking-thumb")).toHaveCount(2);
  await expect(gallery).toContainText("生徒1（1枚）");
  await expect(gallery).toContainText("生徒2（1枚）");
  // Pseudonyms only until the host asks for names.
  await expect(gallery).not.toContainText(guestName);
  await expect(gallery).not.toContainText(guest2Name);

  // Expanding one chart shows that student's card in the board shape.
  await gallery.locator(".thinking-thumb").first().click();
  const expanded = gallery.locator(".thinking-gallery-expanded");
  await expect(expanded.locator("h4")).toHaveText("生徒1のチャート");
  await expect(expanded.locator(".thinking-card")).toHaveCount(1);
  await expect(expanded).toContainText(/ひとりめのカード|ふたりめのカード/);

  // Names on demand.
  await results.getByRole("button", { name: "名前を出す" }).click();
  await expect(gallery).toContainText(guestName);
  await expect(gallery).toContainText(guest2Name);
});
