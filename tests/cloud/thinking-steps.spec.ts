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
              access: {
                mode: "all",
                comment: true,
                rows: [],
                columns: [],
                slides: [],
              },
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
}

test("step chart: cards in order, reorder with buttons, console list", async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name.includes("touch"),
    "touch viewport taps differ on the fixture deck",
  );
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-steps-host`);
  const guestName = `${info.project.name}-steps-one`;
  await addGuest(page, id, guestName);
  const created = await page.request.post(`/api/decks/${id}/thinking`, {
    headers,
    data: {
      template: "steps",
      unit: "individual",
      definition: {
        title: "実験の手順",
        zones: [{ id: "all", label: "手順" }],
        cardColors: [],
      },
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
  const card = panel.locator(".thinking-tool-card", {
    hasText: "実験の手順",
  });
  await card.getByRole("button", { name: "スライドに配置" }).click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });

  // The student enters the deck and writes three steps.
  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  await student.goto(`/?room=${id}`);
  const slide = student.locator(".slide-thinking.is-interactive");
  let entered = false;
  for (let attempt = 0; attempt < 5 && !entered; attempt++) {
    const cards = student.locator(".slide-card");
    if ((await cards.count()) > 0)
      await cards.first().click({ timeout: 8_000 }).catch(() => {});
    entered = await expect(slide)
      .toBeVisible({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!entered) {
      const back = student.getByRole("button", { name: "全体マップへ" });
      if ((await back.count()) > 0)
        await back.first().click({ timeout: 5_000 }).catch(() => {});
    }
  }
  await expect(slide).toBeVisible({ timeout: 15_000 });
  const steps = slide.locator(".thinking-steps");
  await expect(steps).toBeVisible({ timeout: 15_000 });
  const addStep = async (text: string) => {
    await steps.getByLabel("次の手順").fill(text);
    await steps.getByRole("button", { name: "カードを足す" }).click();
    await expect(
      steps.locator(".thinking-step-text", { hasText: text }),
    ).toBeVisible({ timeout: 15_000 });
  };
  await addStep("水を入れる");
  await addStep("火にかける");
  await addStep("まぜる");
  await expect(steps.locator(".thinking-step-card")).toHaveCount(3);

  // Move the last step up twice: it becomes the first step.
  const lastMove = steps
    .locator(".thinking-step-card")
    .nth(2)
    .getByRole("button", { name: "3番目を上へ" });
  await lastMove.click();
  await expect(steps.locator(".thinking-step-text").first()).toHaveText(
    "水を入れる",
    { timeout: 15_000 },
  );
  await steps
    .locator(".thinking-step-card")
    .nth(1)
    .getByRole("button", { name: "2番目を上へ" })
    .click();
  await expect(steps.locator(".thinking-step-text").first()).toHaveText(
    "まぜる",
    { timeout: 15_000 },
  );

  // The stored order matches what the student sees.
  const list = await page.request.get(
    `/api/decks/${id}/thinking?caps=board,steps`,
    { headers },
  );
  const view = (await list.json()).thinking.find(
    (t: { id: string }) => t.id === toolId,
  );
  const stored = [...view.cards].sort(
    (a: { sort: number }, b: { sort: number }) => a.sort - b.sort,
  );
  expect(stored.map((c: { text: string }) => c.text)).toEqual([
    "まぜる",
    "水を入れる",
    "火にかける",
  ]);
  await context.close();

  // The console lists the student's sequence in order.
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await panel.getByRole("tab", { name: "思考ツール" }).click();
  await card.getByRole("button", { name: "結果を見る" }).click();
  const results = panel.locator(".thinking-results");
  await expect(
    results.locator(".thinking-thumb-label", { hasText: "3枚" }),
  ).toBeVisible({ timeout: 15_000 });
  await results.locator(".thinking-thumb").first().click();
  const expanded = results.locator(".thinking-steps-list.is-readonly");
  await expect(expanded).toBeVisible({ timeout: 15_000 });
  await expect(
    expanded.locator(".thinking-step-text").first(),
  ).toHaveText("まぜる");
});
