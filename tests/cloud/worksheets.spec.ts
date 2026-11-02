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
