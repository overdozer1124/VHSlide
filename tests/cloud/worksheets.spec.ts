import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { sample, parseDeck, serializeDeck } from "../../src/model";
import { fromBase64, readSharedDeck } from "../../src/sharedDeck";
import * as Y from "yjs";
async function signIn(page: Page, name: string) {
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers: { Origin: "http://127.0.0.1:3187" },
        data: { credential },
      })
    ).status(),
  ).toBe(200);
}
const launcher = (page: Page) =>
  page.getByRole("button", { name: /^ワークシート(?:（|$)/ });
const modal = (page: Page) =>
  page.getByRole("dialog", { name: "ワークシート", exact: true });
test("worksheet templates embed on slides, save per account, export named CSV and preserve privacy", async ({
  page,
  browser,
}, info) => {
  const guestContext = await browser.newContext(info.project.use);
  const guest = await guestContext.newPage();
  try {
    await signIn(page, "worksheet-host");
    await signIn(guest, "worksheet-guest");
    const headers = { Origin: "http://127.0.0.1:3187" };
    const created = await page.request.post("/api/decks", {
      headers,
      data: sample(),
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const invite = await page.request.post(`/api/decks/${id}/invite`, {
      headers,
    });
    const token = new URL((await invite.json()).url).searchParams.get("join");
    const r = await (
      await guest.request.post(`/api/invites/${token}/accept`, { headers })
    ).json();
    if (r.status === "pending")
      expect(
        (
          await page.request.post(`/api/decks/${id}/join-requests/approve`, {
            headers,
            data: { requestIds: [r.requestId] },
          })
        ).status(),
      ).toBe(200);
    await page.goto(`/?room=${id}`);
    await guest.goto(`/?room=${id}`);
    await expect(page.locator(".slide-card")).toHaveCount(5);
    await expect(guest.locator(".slide-card")).toHaveCount(5);
    await launcher(page).click();
    await modal(page)
      .getByRole("button", { name: "新しいワークシート" })
      .click();
    await page
      .getByRole("combobox", { name: "ワークシートのひな形" })
      .selectOption("reason");
    await page
      .getByRole("textbox", { name: "ワークシートのタイトル" })
      .fill("朝食の理由と工夫");
    await page
      .getByRole("button", { name: "入力欄を追加", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "項目名4", exact: true })
      .fill("今日から実践");
    await page
      .getByRole("combobox", { name: "入力形式4", exact: true })
      .selectOption("checkbox");
    await page.getByRole("button", { name: "下書きを作成" }).click();
    await expect(modal(page)).toContainText("保存しました");
    await page.getByRole("button", { name: "受付を開始", exact: true }).click();
    await expect(modal(page)).toContainText("入力受付中");
    await page
      .getByRole("button", { name: "このワークシートをスライドに配置" })
      .click();
    const hostCard = page.locator(".editor-workspace .slide-worksheet");
    await expect(hostCard).toBeVisible();
    await expect(
      hostCard.getByRole("button", { name: "ワークシートを移動" }),
    ).toBeVisible();
    await guest.locator(".thumbnail").first().click();
    const card = guest.locator(".editor-workspace .slide-worksheet");
    await expect(card).toBeVisible();
    await expect(
      card.getByRole("button", { name: "ワークシートを移動" }),
    ).toHaveCount(0);
    const answer = '朝は食欲がわかない,"理由"\n夜に準備する🌸';
    await card
      .getByRole("textbox", { name: "選んだ理由", exact: true })
      .fill(answer);
    await card
      .getByRole("textbox", { name: "考えた工夫", exact: true })
      .fill("食べやすいものを準備する");
    await card
      .getByRole("checkbox", { name: "今日から実践", exact: true })
      .check();
    await card.getByRole("button", { name: "入力を保存", exact: true }).click();
    await expect(card).toContainText("入力を保存しました");
    await expect(
      hostCard.getByRole("textbox", { name: "選んだ理由", exact: true }),
    ).toHaveValue("");
    await expect(guest.locator(".worksheet-results")).toHaveCount(0);
    await guest.reload();
    await expect(guest.locator(".slide-card")).toHaveCount(5);
    await guest.locator(".thumbnail").first().click();
    const reloaded = guest.locator(".editor-workspace .slide-worksheet");
    await expect(
      reloaded.getByRole("textbox", { name: "選んだ理由", exact: true }),
    ).toHaveValue(answer);
    await expect(
      reloaded.getByRole("checkbox", { name: "今日から実践", exact: true }),
    ).toBeChecked();
    await guest.getByRole("button", { name: "発表する", exact: true }).click();
    const presented = guest.locator(".present-mode .slide-worksheet");
    await expect(
      presented.getByRole("textbox", { name: "選んだ理由", exact: true }),
    ).toHaveValue(answer);
    await presented
      .getByRole("textbox", { name: "選んだ理由", exact: true })
      .press("ArrowLeft");
    await presented
      .getByRole("button", { name: "入力を変更して保存", exact: true })
      .click();
    await expect(presented).toContainText("入力を保存しました");
    await guest.mouse.move(10, 10);
    await guest
      .getByRole("button", { name: "発表をおわる", exact: true })
      .click();
    await page
      .getByRole("button", { name: "全員の画面を同期", exact: true })
      .click();
    const followed = guest.locator(".host-follow-overlay .slide-worksheet");
    await expect(
      followed.getByRole("textbox", { name: "選んだ理由", exact: true }),
    ).toHaveValue(answer);
    await followed
      .getByRole("button", { name: "入力を変更して保存", exact: true })
      .click();
    await expect(followed).toContainText("入力を保存しました");
    await page
      .getByRole("button", { name: "全員の画面を同期", exact: true })
      .click();
    await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
    await launcher(page).click();
    await modal(page)
      .getByRole("button", { name: /朝食の理由と工夫/ })
      .click();
    await expect(page.locator(".worksheet-results")).toContainText(
      "worksheet-guest",
    );
    await expect(page.locator(".worksheet-results")).toContainText(
      "食べやすいものを準備する",
    );
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "入力結果をCSV保存" }).click();
    const download = await downloading;
    const csv = await readFile((await download.path())!, "utf8");
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain("worksheet-guest@example.test");
    expect(csv).toContain('"朝は食欲がわかない,""理由""\n夜に準備する🌸"');
    expect(csv).toContain('"はい"');
    await page.screenshot({
      path: info.outputPath("worksheet-results.png"),
      fullPage: true,
    });
    const response = await (await page.request.get(`/api/decks/${id}`)).json();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(response.state));
    const book = readSharedDeck(doc);
    doc.destroy();
    const portable = serializeDeck(book);
    expect(portable).not.toContain("夜に準備する");
    expect(portable).not.toContain("worksheet-guest@example.test");
    expect(
      parseDeck(portable).slides[0].elements.some((e) => !!e.worksheet),
    ).toBe(true);
    await page.getByRole("button", { name: "受付を終了", exact: true }).click();
    await page.getByRole("button", { name: "ワークシートを閉じる" }).click();
    await expect(
      reloaded.getByRole("textbox", { name: "選んだ理由", exact: true }),
    ).toBeDisabled();
    // A second template provides an independently saved checklist with a live count.
    await launcher(page).click();
    await page.getByRole("button", { name: "新しいワークシート" }).click();
    await page
      .getByRole("combobox", { name: "ワークシートのひな形" })
      .selectOption("check");
    await page.getByRole("button", { name: "下書きを作成" }).click();
    await expect(modal(page)).toContainText("保存しました");
    await page.getByRole("button", { name: "受付を開始", exact: true }).click();
    await launcher(guest).click();
    await modal(guest)
      .getByRole("button", { name: /食生活セルフチェック/ })
      .click();
    await modal(guest)
      .getByRole("checkbox", { name: "朝食をほぼ毎日食べている", exact: true })
      .check();
    await expect(modal(guest).locator(".worksheet-score")).toContainText(
      "1 / 10",
    );
    await modal(guest)
      .getByRole("button", { name: "入力を保存", exact: true })
      .click();
    await expect(modal(guest)).toContainText("入力を保存しました");
    await expect(
      modal(guest).getByRole("button", { name: "入力結果をCSV保存" }),
    ).toHaveCount(0);
  } finally {
    await guestContext.close();
  }
});

test("every unmodified worksheet template creates a draft, including the initial reason template", async ({
  page,
}) => {
  await signIn(page, "draft-host");
  const created = await page.request.post("/api/decks", {
    headers: { Origin: "http://127.0.0.1:3187" },
    data: sample(),
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await expect(page.locator(".slide-card")).toHaveCount(5);
  await launcher(page).click();
  for (const kind of ["initial", "check", "reflection", "plan", "blank"]) {
    await modal(page)
      .getByRole("button", { name: "新しいワークシート", exact: true })
      .click();
    if (kind !== "initial")
      await page
        .getByRole("combobox", { name: "ワークシートのひな形" })
        .selectOption(kind);
    const title = await page
      .getByRole("textbox", { name: "ワークシートのタイトル" })
      .inputValue();
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/decks/${id}/worksheets`) &&
        r.request().method() === "POST",
      { timeout: 10000 },
    );
    await page
      .getByRole("button", { name: "下書きを作成", exact: true })
      .click();
    const saved = await response;
    expect(saved.status(), await saved.text()).toBe(200);
    await expect(
      modal(page).getByRole("heading", { name: title, exact: true, level: 3 }),
    ).toBeVisible();
    await expect(modal(page)).toContainText("保存しました");
  }
});

test("draft validation and save failures remain visible and preserve the edited worksheet for retry", async ({
  page,
}) => {
  await signIn(page, "draft-error-host");
  const created = await page.request.post("/api/decks", {
    headers: { Origin: "http://127.0.0.1:3187" },
    data: sample(),
  });
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await expect(page.locator(".slide-card")).toHaveCount(5);
  await launcher(page).click();
  await modal(page)
    .getByRole("button", { name: "新しいワークシート", exact: true })
    .click();
  await page.getByRole("textbox", { name: "項目名2", exact: true }).fill("");
  await page.getByRole("button", { name: "下書きを作成", exact: true }).click();
  await expect(modal(page).getByRole("alert")).toContainText("入力欄 2");
  await expect(modal(page).getByRole("alert")).toBeInViewport();
  await page
    .getByRole("textbox", { name: "項目名2", exact: true })
    .fill("考えた工夫・編集済み");
  await page.route(`**/api/decks/${id}/worksheets`, async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 503,
        json: { error: "接続を確認して再試行してください。" },
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "下書きを作成", exact: true }).click();
  await expect(modal(page).getByRole("alert")).toContainText("接続を確認");
  await expect(modal(page).getByRole("alert")).toBeInViewport();
  await expect(
    page.getByRole("textbox", { name: "項目名2", exact: true }),
  ).toHaveValue("考えた工夫・編集済み");
  await page.unroute(`**/api/decks/${id}/worksheets`);
  await page.getByRole("button", { name: "下書きを作成", exact: true }).click();
  await expect(modal(page)).toContainText("下書きを作成しました");
  await expect(
    modal(page).getByRole("heading", {
      name: "朝食を食べない理由に、どんな工夫ができる？",
      level: 3,
      exact: true,
    }),
  ).toBeVisible();
});

test("host reads long answers by person or question without squeezed identity columns, searches and exports everyone", async ({
  page,
}, info) => {
  await signIn(page, "results-host");
  const headers = { Origin: "http://127.0.0.1:3187" };
  const created = await page.request.post("/api/decks", {
    headers,
    data: sample(),
  });
  const { id } = await created.json();
  const fields = Array.from({ length: 40 }, (_, i) => ({
    id: `field-${i}`,
    label: i === 0 ? "選んだ理由" : `ふり返りの項目 ${i + 1}`,
    section: i < 3 ? "理由と工夫" : "ふり返り",
    kind: i === 1 ? "checkbox" : "text",
    options: [],
    placeholder: "ここに入力",
    wide: true,
  }));
  expect(
    (
      await page.request.post(`/api/decks/${id}/worksheets`, {
        headers,
        data: {
          title: "授業のふり返り",
          description: "資料から考えたことを整理しよう。",
          fields,
        },
      })
    ).status(),
  ).toBe(200);
  const data = await (
    await page.request.get(`/api/decks/${id}/worksheets`)
  ).json();
  const sheet = data.worksheets[0];
  const long =
    "朝食を食べるために、前の日から準備する。\n" +
    "自分の生活に合わせた工夫を考えました。".repeat(25);
  sheet.status = "open";
  sheet.results.responses = [
    {
      respondentId: "student-a",
      name: "同じ名前",
      email: "student-a@example.test",
      updated: Date.UTC(2026, 10, 2, 1, 30),
      values: { "field-0": long, "field-1": true },
    },
    {
      respondentId: "student-b",
      name: "同じ名前",
      email: "student-b@example.test",
      updated: Date.UTC(2026, 10, 2, 2, 30),
      values: {
        "field-0": "別の人の考え\n温かいスープを用意する",
        "field-1": false,
      },
    },
  ];
  await page.route(`**/api/decks/${id}/worksheets`, (r) =>
    r.fulfill({ json: data }),
  );
  await page.goto(`/?room=${id}`);
  await expect(page.locator(".slide-card")).toHaveCount(5);
  await launcher(page).click();
  await modal(page)
    .getByRole("button", { name: /授業のふり返り/ })
    .click();
  const results = page.locator(".worksheet-results");
  const detail = results.getByRole("article", { name: "選択した参加者の回答" });
  await expect(results).toBeInViewport();
  await expect(detail).toContainText("student-a@example.test");
  await expect(detail).toContainText(long);
  await expect(detail).toContainText("未入力");
  await expect(
    modal(page).getByRole("button", { name: "入力を保存", exact: true }),
  ).toHaveCount(0);
  await results
    .getByRole("navigation", { name: "回答した参加者" })
    .getByRole("button")
    .filter({ hasText: "student-b@example.test" })
    .click();
  await expect(detail).toContainText("温かいスープを用意する");
  await expect(detail).toContainText("いいえ");
  const search = results.getByRole("searchbox", { name: "参加者を検索" });
  await search.fill("student-b");
  await expect(results.getByRole("navigation").getByRole("button")).toHaveCount(
    1,
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "入力結果をCSV保存" }).click();
  const download = await downloading;
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("student-a@example.test");
  expect(csv).toContain("student-b@example.test");
  await search.fill("該当なし");
  await expect(results).toContainText("該当する参加者がいません");
  await search.fill("");
  await results
    .getByRole("button", { name: "全項目を一覧", exact: true })
    .click();
  await expect(results.locator("tbody tr")).toHaveCount(2);
  await expect(results.locator("thead th")).toHaveCount(42);
  await expect(results.locator("tbody tr").first()).toContainText(long);
  await expect(results.getByRole("combobox")).toHaveCount(0);
  await expect(
    results
      .locator("tbody tr")
      .first()
      .locator(".worksheet-answer-cell")
      .nth(1),
  ).toHaveText("はい");
  await expect(
    results.locator("tbody tr").last().locator(".worksheet-answer-cell").nth(1),
  ).toHaveText("いいえ");
  const viewport = results.getByRole("region", { name: "全項目の回答一覧" });
  await viewport.scrollIntoViewIfNeeded();
  const left = results.locator("tbody .worksheet-pin-left").first();
  const right = results.locator("tbody .worksheet-pin-right").first();
  const leftHeader = results.locator("thead .worksheet-pin-left");
  const rightHeader = results.locator("thead .worksheet-pin-right");
  const answerCell = results.locator(".worksheet-answer-cell").first();
  const box = async (locator: typeof left) => (await locator.boundingBox())!;
  const initial = {
    left: await box(left),
    right: await box(right),
    leftHeader: await box(leftHeader),
    rightHeader: await box(rightHeader),
    answer: await box(answerCell),
    viewport: await box(viewport),
  };
  expect(initial.left.width).toBeGreaterThanOrEqual(200);
  expect(initial.right.x + initial.right.width).toBeLessThanOrEqual(
    initial.viewport.x + initial.viewport.width + 2,
  );
  await viewport.evaluate((el) => {
    el.scrollLeft = 1200;
  });
  await expect
    .poll(async () => Math.abs((await box(left)).x - initial.left.x))
    .toBeLessThan(1);
  expect(Math.abs((await box(right)).x - initial.right.x)).toBeLessThan(1);
  expect(
    Math.abs((await box(leftHeader)).x - initial.leftHeader.x),
  ).toBeLessThan(1);
  expect(
    Math.abs((await box(rightHeader)).x - initial.rightHeader.x),
  ).toBeLessThan(1);
  expect((await box(answerCell)).x).toBeLessThan(initial.answer.x - 1000);
  await viewport.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const lastField = await box(
    results.locator("thead .worksheet-field-heading").last(),
  );
  expect(lastField.x + lastField.width).toBeLessThanOrEqual(
    (await box(rightHeader)).x + 1,
  );
  expect(lastField.x + lastField.width).toBeGreaterThan(
    (await box(leftHeader)).x + initial.leftHeader.width,
  );
  await expect(left).toContainText("student-a@example.test");
  await expect(right.locator("time")).toContainText("2026/11/2");
  const headerY = (await box(leftHeader)).y;
  await viewport.evaluate((el) => {
    el.scrollTop = 100;
  });
  expect(await viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(Math.abs((await box(leftHeader)).y - headerY)).toBeLessThan(1);
  expect(Math.abs((await box(right)).x - initial.right.x)).toBeLessThan(1);
  await viewport.evaluate((el) => {
    el.scrollTop = 0;
    el.scrollLeft = 18 * 280;
  });
  expect(
    await modal(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("worksheet-comparison.png"),
    fullPage: true,
  });
  await results
    .getByRole("button", { name: "参加者ごと", exact: true })
    .click();
  await expect(detail).toContainText("student-b@example.test");
  await expect(
    results.getByRole("button", { name: "参加者ごと", exact: true }),
  ).toHaveCSS("background-color", "rgb(54, 93, 80)");
  await page.screenshot({
    path: info.outputPath("worksheet-person-results.png"),
    fullPage: true,
  });
  await modal(page)
    .getByRole("button", { name: "自分で入力", exact: true })
    .click();
  await expect(
    modal(page).getByRole("textbox", { name: "選んだ理由", exact: true }),
  ).toBeVisible();
  await modal(page)
    .getByRole("textbox", { name: "選んだ理由", exact: true })
    .fill("まだ保存していない考え");
  await modal(page)
    .getByRole("button", { name: /回答結果（2人）/ })
    .click();
  await expect(results).not.toContainText("まだ保存していない考え");
  await modal(page)
    .getByRole("button", { name: "自分で入力", exact: true })
    .click();
  await expect(
    modal(page).getByRole("textbox", { name: "選んだ理由", exact: true }),
  ).toHaveValue("まだ保存していない考え");
  await modal(page)
    .getByRole("button", { name: "設定・内容の確認", exact: true })
    .click();
  await expect(
    modal(page).getByRole("region", { name: "ワークシートの設定" }),
  ).toContainText("入力項目：40項目");
  await expect(
    modal(page).getByRole("button", {
      name: "ワークシートを削除",
      exact: true,
    }),
  ).not.toBeVisible();
  await modal(page)
    .getByRole("button", { name: "ワークシートを閉じる" })
    .focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    modal(page).locator(".worksheet-delete summary"),
    await page.evaluate(() => document.activeElement?.outerHTML ?? "no focus"),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    modal(page).getByRole("button", { name: "ワークシートを閉じる" }),
  ).toBeFocused();
  await modal(page)
    .getByRole("button", { name: /回答結果（2人）/ })
    .click();
  await expect(results).toBeInViewport();
  await expect(
    modal(page).getByRole("button", { name: "ワークシートを閉じる" }),
  ).toBeInViewport();
});
