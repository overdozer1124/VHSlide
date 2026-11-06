import { test, expect, type Page } from "@playwright/test";
import { sample } from "../../src/model";
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
test("worksheet choice aggregates remain private until shared and participant order stays fixed and movable", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  const firstContext = await browser.newContext(info.project.use),
    secondContext = await browser.newContext(info.project.use);
  const first = await firstContext.newPage(),
    second = await secondContext.newPage();
  try {
    await signIn(page, "aggregate-host");
    await signIn(first, "aggregate-first");
    await signIn(second, "aggregate-second");
    const created = await page.request.post("/api/decks", {
      headers,
      data: sample(),
    });
    const { id } = await created.json();
    const invite = await page.request.post(`/api/decks/${id}/invite`, {
      headers,
    });
    const token = new URL((await invite.json()).url).searchParams.get("join");
    for (const guest of [first, second]) {
      const result = await guest.request.post(`/api/invites/${token}/accept`, {
        headers,
      });
      const data = await result.json();
      if (data.requestId)
        expect(
          (
            await page.request.post(`/api/decks/${id}/join-requests/approve`, {
              headers,
              data: { requestIds: [data.requestId] },
            })
          ).status(),
        ).toBe(200);
    }
    const def = {
      title: "授業の質問",
      description: "",
      fields: [
        {
          id: "question",
          label: "どちらですか",
          kind: "single",
          options: ["はい", "いいえ"],
          placeholder: "",
          section: "",
          wide: true,
        },
      ],
    };
    const made = await page.request.post(`/api/decks/${id}/worksheets`, {
      headers,
      data: def,
    });
    expect(made.status()).toBe(200);
    const sheet = (await made.json()).worksheets[0];
    expect(
      (
        await page.request.post(
          `/api/decks/${id}/worksheets/${sheet.id}/status`,
          { headers, data: { status: "open" } },
        )
      ).status(),
    ).toBe(200);
    async function answer(p: Page, choice: number) {
      expect(
        (
          await p.request.post(
            `/api/decks/${id}/worksheets/${sheet.id}/answer`,
            { headers, data: { patch: true, values: { question: [choice] } } },
          )
        ).status(),
      ).toBe(200);
    }
    await answer(first, 0);
    await answer(second, 1);
    await answer(first, 1);
    let guestSheet = (
      await (await first.request.get(`/api/decks/${id}/worksheets`)).json()
    ).worksheets[0];
    expect(guestSheet.summaries).toBeUndefined();
    expect(guestSheet.results).toBeUndefined();
    await page.goto(`/?room=${id}`);
    await page.getByRole("button", { name: "フォーム", exact: true }).click();
    await page.getByRole("tab", { name: "ワークシート", exact: true }).click();
    await page
      .getByText("選択式の集計・公開・スライド配置", { exact: true })
      .click();
    await expect(page.getByLabel("選択式の集計結果")).toContainText(
      "2人が回答",
    );
    await page.getByRole("button", { name: "全項目を一覧" }).click();
    const rows = page.locator(".worksheet-frozen-table tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("aggregate-first");
    await expect(rows.nth(1)).toContainText("aggregate-second");
    await rows
      .nth(1)
      .getByRole("button", { name: /行をドラッグして移動/ })
      .dragTo(rows.nth(0));
    await expect(rows.nth(0)).toContainText("aggregate-second");
    await answer(first, 0);
    await expect(rows.nth(1)).toContainText("はい", { timeout: 15000 });
    await expect(rows.nth(0)).toContainText("aggregate-second");
    const pendingDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "入力結果をCSV保存" }).click();
    const stream = await (await pendingDownload).createReadStream();
    let csv = "";
    for await (const chunk of stream) csv += chunk.toString();
    expect(csv.indexOf("aggregate-second")).toBeLessThan(
      csv.indexOf("aggregate-first"),
    );
    await page.reload();
    await page.getByRole("button", { name: "フォーム", exact: true }).click();
    await page.getByRole("tab", { name: "ワークシート", exact: true }).click();
    await page.getByRole("button", { name: "全項目を一覧" }).click();
    await expect(rows.nth(0)).toContainText("aggregate-second");
    await page.getByRole("button", { name: "参加順に戻す" }).click();
    await expect(rows.nth(0)).toContainText("aggregate-first");
    await page
      .getByText("選択式の集計・公開・スライド配置", { exact: true })
      .click();
    await page.getByRole("button", { name: "集計を参加者に公開" }).click();
    await expect
      .poll(
        async () =>
          (
            await (
              await first.request.get(`/api/decks/${id}/worksheets`)
            ).json()
          ).worksheets[0]?.summaries?.question,
        { timeout: 30000 },
      )
      .toEqual({ count: 2, counts: [1, 1] });
    guestSheet = (
      await (await first.request.get(`/api/decks/${id}/worksheets`)).json()
    ).worksheets[0];
    expect(guestSheet.results).toBeUndefined();
    await page
      .getByRole("button", { name: "集計グラフをスライドに配置" })
      .click();
    const chart = page.locator(".editor-workspace svg.chart-graphic");
    await expect(chart).toHaveAttribute("aria-label", /どちらですか/);
    await expect(chart.locator("title").first()).toContainText("はい 1");
    await first.goto(`/?room=${id}`);
    await first.locator(".thumbnail").first().click();
    const guestChart = first.locator(".editor-workspace svg.chart-graphic");
    await expect(guestChart.locator("title").first()).toContainText("はい 1", {
      timeout: 15000,
    });
    await answer(second, 0);
    await page.bringToFront();
    await expect(chart.locator("title").first()).toContainText("はい 2", {
      timeout: 15000,
    });
    await first.bringToFront();
    await expect(guestChart.locator("title").first()).toContainText("はい 2", {
      timeout: 15000,
    });
    await page.bringToFront();
    await page.getByRole("button", { name: "フォーム", exact: true }).click();
    await page.getByRole("tab", { name: "ワークシート", exact: true }).click();
    await page
      .getByText("選択式の集計・公開・スライド配置", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "参加者への集計公開を停止" })
      .click();
    await expect
      .poll(
        async () =>
          (
            await (
              await first.request.get(`/api/decks/${id}/worksheets`)
            ).json()
          ).worksheets[0]?.summaries,
        { timeout: 30000 },
      )
      .toBeUndefined();
    await first.bringToFront();
    await expect(guestChart).toHaveAttribute(
      "aria-label",
      "集計は表示されていません",
      { timeout: 15000 },
    );
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});
