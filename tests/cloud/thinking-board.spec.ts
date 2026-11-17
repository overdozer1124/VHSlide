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

async function createTool(
  page: Page,
  id: string,
  body: Record<string, unknown>,
): Promise<string> {
  const created = await page.request.post(`/api/decks/${id}/thinking`, {
    headers,
    data: body,
  });
  expect(created.status()).toBe(200);
  const toolId = (await created.json()).createdId as string;
  expect(toolId).toBeTruthy();
  expect(
    (
      await page.request.post(`/api/decks/${id}/thinking/${toolId}/status`, {
        headers,
        data: { status: "open" },
      })
    ).status(),
  ).toBe(200);
  return toolId;
}

async function placeTool(page: Page, title: string) {
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  const panel = page.locator(".activity-panel");
  await panel.getByRole("tab", { name: "思考ツール" }).click();
  const card = panel.locator(".thinking-tool-card", { hasText: title });
  await card.getByRole("button", { name: "スライドに配置" }).click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });
}

async function openSlide(page: Page) {
  await page.locator(".slide-card").first().click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });
}

type CardRow = {
  id: string;
  zone: string;
  text: string;
  authorName: string;
  mine: boolean;
};
async function cardsOf(
  page: Page,
  id: string,
  toolId: string,
): Promise<CardRow[]> {
  const data = await (
    await page.request.get(`/api/decks/${id}/thinking?caps=board`, { headers })
  ).json();
  const tool = data.thinking.find((t: { id: string }) => t.id === toolId);
  return (tool?.cards ?? []) as CardRow[];
}

async function writeCard(page: Page, zoneIndex: number, text: string) {
  const slide = page.locator(".slide-thinking.is-interactive");
  const zone = slide.locator(".thinking-zone").nth(zoneIndex);
  await zone.getByRole("button", { name: "＋カードを書く" }).click();
  await zone.getByLabel("カードの内容").fill(text);
  await zone.getByRole("button", { name: "追加する" }).click();
  await expect(zone.locator(".thinking-card", { hasText: text })).toBeVisible({
    timeout: 15_000,
  });
}

test("a class Venn board shares cards: anyone moves, only the author edits", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-board-host`);
  const guestName = `${info.project.name}-board-student`;
  const guest2Name = `${info.project.name}-board-friend`;
  await addGuest(page, id, guestName);
  await addGuest(page, id, guest2Name);
  const toolId = await createTool(page, id, {
    template: "venn2",
    unit: "class",
    definition: {
      title: "ベン図で比べよう",
      cardColors: [{ color: "yellow", label: "自分の考え" }],
    },
  });
  await page.goto(`/?room=${id}`);
  await placeTool(page, "ベン図で比べよう");

  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  await student.goto(`/?room=${id}`);
  await openSlide(student);
  // The student writes a card into zone A (the first zone).
  await writeCard(student, 0, "Aだけの考え");
  await expect.poll(async () => (await cardsOf(student, id, toolId)).length).toBe(1);
  let cards = await cardsOf(student, id, toolId);
  expect(cards[0].zone).toBe("a");
  expect(cards[0].mine).toBe(true);

  // The author moves it to the overlap from the card menu.
  const slide = student.locator(".slide-thinking.is-interactive");
  await slide.locator(".thinking-card", { hasText: "Aだけの考え" }).click();
  const panel = slide.locator(".thinking-card-panel");
  await expect(panel).toBeVisible();
  await panel.getByLabel("移す先の区切り").selectOption({ label: "AとBの重なり" });
  await panel.getByRole("button", { name: "移す" }).click();
  await expect
    .poll(async () => (await cardsOf(student, id, toolId))[0]?.zone)
    .toBe("ab");

  // A second student sees the shared card without the author's name,
  // can move it back, but gets no edit or delete buttons.
  const context2 = await browser.newContext({ baseURL: scopeOrigin });
  const student2 = await context2.newPage();
  await scopeLogin(student2, guest2Name);
  await student2.goto(`/?room=${id}`);
  await openSlide(student2);
  const slide2 = student2.locator(".slide-thinking.is-interactive");
  await expect(
    slide2.locator(".thinking-card", { hasText: "Aだけの考え" }),
  ).toBeVisible({ timeout: 15_000 });
  cards = await cardsOf(student2, id, toolId);
  expect(cards[0].authorName).toBe("");
  expect(cards[0].mine).toBe(false);
  await slide2.locator(".thinking-card", { hasText: "Aだけの考え" }).click();
  const panel2 = slide2.locator(".thinking-card-panel");
  await expect(panel2).toBeVisible();
  await expect(panel2.getByRole("button", { name: "内容を変える" })).toHaveCount(0);
  await expect(panel2.getByRole("button", { name: "削除" })).toHaveCount(0);
  await panel2.getByLabel("移す先の区切り").selectOption({ label: "B" });
  await panel2.getByRole("button", { name: "移す" }).click();
  await expect
    .poll(async () => (await cardsOf(student2, id, toolId))[0]?.zone)
    .toBe("b");

  // The author edits the text; the host sees the card with the name.
  await slide.locator(".thinking-card", { hasText: "Aだけの考え" }).click();
  const panelA = slide.locator(".thinking-card-panel");
  await panelA.getByRole("button", { name: "内容を変える" }).click();
  await slide.getByLabel("カードの内容を変える").fill("書き直した考え");
  await slide.getByRole("button", { name: "保存する" }).click();
  await expect
    .poll(async () => (await cardsOf(page, id, toolId))[0]?.text)
    .toBe("書き直した考え");
  cards = await cardsOf(page, id, toolId);
  expect(cards[0].authorName).not.toBe("");
  await context.close();
  await context2.close();
});

test("an individual T-chart board keeps cards private", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-tchart-host`);
  const guestName = `${info.project.name}-tchart-student`;
  const guest2Name = `${info.project.name}-tchart-friend`;
  await addGuest(page, id, guestName);
  await addGuest(page, id, guest2Name);
  const toolId = await createTool(page, id, {
    template: "tchart",
    unit: "individual",
    definition: { title: "Tチャート" },
  });
  await page.goto(`/?room=${id}`);
  await placeTool(page, "Tチャート");

  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  await student.goto(`/?room=${id}`);
  await openSlide(student);
  await writeCard(student, 1, "個人のカード");
  await expect.poll(async () => (await cardsOf(student, id, toolId)).length).toBe(1);
  // The host receives the card; another student receives nothing and
  // sees no card on the slide.
  expect((await cardsOf(page, id, toolId)).length).toBe(1);
  const context2 = await browser.newContext({ baseURL: scopeOrigin });
  const student2 = await context2.newPage();
  await scopeLogin(student2, guest2Name);
  expect((await cardsOf(student2, id, toolId)).length).toBe(0);
  await student2.goto(`/?room=${id}`);
  await openSlide(student2);
  await expect(
    student2.locator(".slide-thinking.is-interactive .thinking-card"),
  ).toHaveCount(0);
  await context.close();
  await context2.close();
});
