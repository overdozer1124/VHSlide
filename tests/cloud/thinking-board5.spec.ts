import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  scopeFixture,
  scopeLogin,
  scopeOrigin,
} from "../support/scopeCloud";

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

/** Stage 4 remaining templates: a fishbone board end to end, plus
 * the board5 capability gate at the API level (older clients must
 * not see the new templates at all). */
async function enterSlide(student: Page) {
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
  return slide;
}

test("fishbone board: card in a bone, board5 gate, host gallery", async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name.includes("touch"),
    "touch viewport taps differ on the fixture deck",
  );
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-bfive-host`);
  const guestName = `${info.project.name}-bfive-one`;
  await addGuest(page, id, guestName);
  const created = await page.request.post(`/api/decks/${id}/thinking`, {
    headers,
    data: {
      template: "fishbone",
      unit: "individual",
      definition: { title: "川の水が減ったわけ", zones: [], cardColors: [] },
    },
  });
  expect(created.status()).toBe(200);
  const toolId = (await created.json()).createdId as string;

  // The board5 gate: without the capability the tool is not listed.
  const without = await page.request.get(
    `/api/decks/${id}/thinking?caps=board`,
  );
  expect((await without.json()).thinking ?? []).toEqual(
    expect.not.arrayContaining([expect.objectContaining({ id: toolId })]),
  );
  const withCap = await page.request.get(
    `/api/decks/${id}/thinking?caps=board,board5`,
  );
  expect((await withCap.json()).thinking ?? []).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: toolId, template: "fishbone" }),
    ]),
  );

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
    hasText: "川の水が減ったわけ",
  });
  await card.getByRole("button", { name: "スライドに配置" }).click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });

  // The student writes a card into the top-left bone.
  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  await student.goto(`/?room=${id}`);
  const slide = await enterSlide(student);
  const board = slide.locator(".thinking-board");
  await expect(board.locator(".thinking-board-art")).toBeVisible();
  await expect(board.locator(".thinking-figure-title")).toHaveText(
    "川の水が減ったわけ",
  );
  const zone = board.locator(".thinking-zone").first();
  await zone.getByRole("button", { name: "＋カードを書く" }).click();
  await zone.getByLabel("カードの内容").fill("雨が少ない");
  await zone.getByRole("button", { name: "追加する" }).click();
  await expect(board.locator(".thinking-card-text", { hasText: "雨が少ない" })).toBeVisible({
    timeout: 15_000,
  });

  // The saved card sits in zone a.
  const saved = await page.request.get(
    `/api/decks/${id}/thinking?caps=board,board5`,
  );
  const tool = (await saved.json()).thinking.find(
    (t: { id: string }) => t.id === toolId,
  );
  expect(tool.cards).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ zone: "a", text: "雨が少ない" }),
    ]),
  );

  // The results screen lists the student's chart; opening it shows
  // the card on the fishbone.
  await page.reload();
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  const panel2 = page.locator(".activity-panel");
  await panel2.getByRole("tab", { name: "思考ツール" }).click();
  const card2 = panel2.locator(".thinking-tool-card", {
    hasText: "川の水が減ったわけ",
  });
  await card2.getByRole("button", { name: "結果を見る" }).click();
  const results = page.locator(".thinking-results");
  await results.getByRole("tab", { name: "生徒ごと" }).click();
  const thumb = results.locator(".thinking-thumb", { hasText: "生徒1" });
  await expect(thumb).toBeVisible({ timeout: 20_000 });
  await thumb.click();
  const expanded = results.locator(".thinking-gallery-expanded");
  await expect(expanded).toBeVisible({ timeout: 15_000 });
  await expect(
    expanded.locator(".thinking-card-text", { hasText: "雨が少ない" }),
  ).toBeVisible();
  await expect(expanded.locator(".thinking-board-art")).toBeVisible();
  await context.close();
});
