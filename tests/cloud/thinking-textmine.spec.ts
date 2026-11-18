import { test, expect, type Page } from "@playwright/test";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";

const headers = { Origin: scopeOrigin };

// The real analyzer (kuromoji + dictionary) lives on the vhslide-textmine
// worker; here it is stubbed so the test covers the wiring only: the
// panel must hand the analyzer one text per author (respondents echo
// texts.length), per zone or across all zones.
const stubAnalyzer = `
export function createAnalyzer() {
  return Promise.resolve({
    analyze: (texts) => ({
      words: [
        { word: "野菜", respondents: texts.length, count: 3, score: 1.5 },
      ],
      pairs: [],
      texts: texts.length,
      tokens: 9,
    }),
  });
}
export default createAnalyzer;
`;

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

async function writeCard(page: Page, zoneLabel: string, text: string) {
  const slide = page.locator(".slide-thinking.is-interactive");
  // Zones render in template order (for the Venn: A, B, then the
  // overlap), so pick the zone by its label, not by position.
  const zone = slide
    .locator(".thinking-zone")
    .filter({
      has: page.locator(".thinking-zone-label", { hasText: zoneLabel }),
    })
    .first();
  await zone.getByRole("button", { name: "＋カードを書く" }).click();
  await zone.getByLabel("カードの内容").fill(text);
  await zone.getByRole("button", { name: "追加する" }).click();
  await expect(zone.locator(".thinking-card", { hasText: text })).toBeVisible({
    timeout: 15_000,
  });
}

test("board results analyze card words per zone, counted by author", async ({
  page,
  browser,
}, info) => {
  // Desktop only: on the touch viewport the fixture deck's map taps
  // land on slide shapes instead of the cards this flow drives. The
  // wiring covered here (grouping + panel) is viewport-independent
  // and the console's own text-mining spec covers the shared panel.
  test.skip(
    info.project.name.includes("touch"),
    "touch viewport taps differ on the fixture deck",
  );
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-mine-host`);
  const guestName = `${info.project.name}-mine-one`;
  const guest2Name = `${info.project.name}-mine-two`;
  await addGuest(page, id, guestName);
  await addGuest(page, id, guest2Name);
  const created = await page.request.post(`/api/decks/${id}/thinking`, {
    headers,
    data: {
      template: "venn2",
      unit: "individual",
      definition: { title: "分析のベン図", cardColors: [] },
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
  const card = panel.locator(".thinking-tool-card", { hasText: "分析のベン図" });
  await card.getByRole("button", { name: "スライドに配置" }).click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });

  // Student one writes two cards in zone A; student two writes one in
  // zone A and one in the overlap zone.
  const plan: [string, [string, string][]][] = [
    [guestName, [["A", "野菜が大切"], ["A", "野菜を食べる"]]],
    [guest2Name, [["A", "運動も大切"], ["AとBの重なり", "両方とも大切"]]],
  ];
  for (const [name, writes] of plan) {
    const context = await browser.newContext({ baseURL: scopeOrigin });
    const student = await context.newPage();
    await scopeLogin(student, name);
    await student.goto(`/?room=${id}`);
    // The map keeps re-rendering as presence/sync updates land, so
    // a click can stall on actionability or be swallowed. Every
    // wait here is explicitly bounded (an unbounded locator wait
    // would run to the test timeout) and the entry is retried
    // until the placed board is on screen.
    const board = student.locator(".slide-thinking.is-interactive");
    let entered = false;
    for (let attempt = 0; attempt < 5 && !entered; attempt++) {
      const cards = student.locator(".slide-card");
      if ((await cards.count()) > 0)
        await cards.first().click({ timeout: 8_000 }).catch(() => {});
      entered = await expect(board)
        .toBeVisible({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (!entered) {
        const back = student.getByRole("button", { name: "全体マップへ" });
        if ((await back.count()) > 0)
          await back.first().click({ timeout: 5_000 }).catch(() => {});
      }
    }
    await expect(board).toBeVisible({ timeout: 15_000 });
    for (const [zone, text] of writes) await writeCard(student, zone, text);
    await context.close();
  }

  // Stub the analyzer only now: registering the route earlier delays
  // the room's live sync enough to starve the students' pages.
  await page.route(
    "https://vhslide-textmine.overdozer1124.workers.dev/v1/analyzer.js",
    async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "text/javascript",
        },
        body: stubAnalyzer,
      });
    },
  );
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await panel.getByRole("tab", { name: "思考ツール" }).click();
  await card.getByRole("button", { name: "結果を見る" }).click();
  const results = panel.locator(".thinking-results");
  await expect(results.locator(".thinking-results-count")).toHaveText(
    "カード4枚",
    { timeout: 15_000 },
  );
  const mine = results.locator(".thinking-textmine");
  await expect(mine.locator("h4")).toHaveText("言葉の分析");

  // All zones: two authors, even though one of them wrote two cards.
  await mine.getByRole("button", { name: "言葉を分析する" }).click();
  await expect(mine.locator(".console-textmine-note").first()).toHaveText(
    "2人の回答から分析しました。言葉の大きさは、書いた人数の多さです。",
    { timeout: 15_000 },
  );

  // The overlap zone only: a single author.
  await mine.getByRole("tab", { name: "AとBの重なり" }).click();
  await mine.getByRole("button", { name: "言葉を分析する" }).click();
  await expect(mine.locator(".console-textmine-note").first()).toHaveText(
    "1人の回答から分析しました。言葉の大きさは、書いた人数の多さです。",
    { timeout: 15_000 },
  );
});
