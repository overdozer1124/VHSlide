import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { blank } from "../../src/model";
const headers = { Origin: "http://127.0.0.1:3187" };
async function signIn(page: Page, name: string) {
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential: name },
      })
    ).status(),
  ).toBe(200);
}

// The real analyzer (kuromoji + dictionary) lives on the vhslide-textmine
// worker; here it is stubbed so the test covers the console wiring only:
// button -> load -> analyze the field's answers -> render words and pairs.
const stubAnalyzer = `
export function createAnalyzer() {
  return Promise.resolve({
    analyze: (texts) => ({
      words: [
        { word: "栄養素", respondents: texts.length, count: 3, score: 1.5 },
        { word: "野菜", respondents: 1, count: 1, score: 0.5 },
      ],
      pairs: [{ a: "野菜", b: "大切", respondents: 1 }],
      texts: texts.length,
      tokens: 9,
    }),
  });
}
export default createAnalyzer;
`;

test("console text mining analyzes a text field's answers", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120_000);
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
  const context = await browser.newContext(info.project.use);
  const guest = await context.newPage();
  try {
    await signIn(page, "mine-host");
    await signIn(guest, "mine-guest");
    const created = await page.request.post("/api/decks", {
      headers,
      data: { version: 1, title: "言葉の分析", slides: [blank(0, 0)] },
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const invite = await page.request.post(`/api/decks/${id}/invite`, {
      headers,
    });
    const token = new URL((await invite.json()).url).searchParams.get("join");
    const accepted = await guest.request.post(`/api/invites/${token}/accept`, {
      headers,
    });
    const join = await accepted.json();
    if (join.requestId)
      expect(
        (
          await page.request.post(`/api/decks/${id}/join-requests/approve`, {
            headers,
            data: { requestIds: [join.requestId] },
          })
        ).status(),
      ).toBe(200);
    const sheet = await page.request.post(`/api/decks/${id}/worksheets`, {
      headers,
      data: {
        title: "ふりかえり",
        description: "今日の学習の感想を書きましょう。",
        fields: [
          {
            id: "q1",
            label: "感想",
            kind: "text",
            options: [],
            placeholder: "",
            section: "",
            wide: false,
          },
        ],
      },
    });
    expect(sheet.status()).toBe(200);
    const sheets = (await sheet.json()).worksheets;
    const wid = sheets[0].id;
    expect(
      (
        await page.request.post(`/api/decks/${id}/worksheets/${wid}/status`, {
          headers,
          data: { status: "open" },
        })
      ).status(),
    ).toBe(200);
    for (const [who, text] of [
      [page, "野菜を食べることは大切だと思います。"],
      [guest, "栄養素をとることが大切です。"],
    ] as const)
      expect(
        (
          await who.request.post(`/api/decks/${id}/worksheets/${wid}/answer`, {
            headers,
            data: { values: { q1: text } },
          })
        ).status(),
      ).toBe(200);

    await page.goto(`/?room=${id}`);
    await page.getByRole("button", { name: "授業コンソール" }).click();
    const region = page.getByRole("region", { name: "授業コンソール" });
    await region.getByRole("tab", { name: "設問ごとの集計" }).click();
    const mine = region.locator(".console-textmine");
    await expect(mine).toBeVisible();
    await mine.getByRole("button", { name: "言葉を分析する" }).click();
    await expect(mine.locator(".console-textmine-table")).toContainText(
      "栄養素",
    );
    await expect(mine).toContainText("2人の回答から分析しました");
    await expect(mine).toContainText("野菜 × 大切（1人）");
  } finally {
    await context.close();
  }
});
