import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { sample } from "../../src/model";

async function signIn(page: Page, name: string) {
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  const r = await page.request.post("/api/auth/google", {
    headers: { Origin: "http://127.0.0.1:3187" },
    data: { credential },
  });
  expect(r.status()).toBe(200);
}
const launch = (page: Page) =>
  page.getByRole("button", { name: /^アンケート(?:（|$)/ });
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "アンケート", exact: true });
test("host creates both question types, guests answer privately and results become editable slides", async ({
  page,
  browser,
}, info) => {
  const guestContext = await browser.newContext(info.project.use);
  const guest = await guestContext.newPage();
  try {
    await signIn(page, "survey-host");
    await signIn(guest, "survey-guest");
    const origin = { Origin: "http://127.0.0.1:3187" };
    const created = await page.request.post("/api/decks", {
      headers: origin,
      data: sample(),
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const invite = await page.request.post(`/api/decks/${id}/invite`, {
      headers: origin,
    });
    const token = new URL((await invite.json()).url).searchParams.get("join");
    const pending = await guest.request.post(`/api/invites/${token}/accept`, {
      headers: origin,
    });
    const request = await pending.json();
    if (request.status === "pending") {
      expect(
        (
          await page.request.post(`/api/decks/${id}/join-requests/approve`, {
            headers: origin,
            data: { requestIds: [request.requestId] },
          })
        ).status(),
      ).toBe(200);
    }
    await page.goto(`/?room=${id}`);
    await guest.goto(`/?room=${id}`);
    await expect(page.locator(".slide-card")).toHaveCount(5);
    await expect(guest.locator(".slide-card")).toHaveCount(5);
    await launch(page).click();
    await dialog(page)
      .getByRole("button", { name: "新しいアンケート" })
      .click();
    await page
      .getByRole("textbox", { name: "アンケートの質問" })
      .fill("好きな季節は？");
    await page
      .getByRole("textbox", { name: "選択肢1", exact: true })
      .fill("春");
    await page
      .getByRole("textbox", { name: "選択肢2", exact: true })
      .fill("夏");
    await page.getByRole("button", { name: "下書きを作成" }).click();
    await expect(dialog(page)).toContainText("下書きを作成しました");
    await page.getByRole("button", { name: "受付を開始", exact: true }).click();
    await expect(dialog(page)).toContainText("受付状態を更新しました");
    await launch(guest).click();
    await dialog(guest)
      .getByRole("button", { name: /好きな季節は？/ })
      .click();
    await guest.getByRole("radio", { name: "春", exact: true }).check();
    await guest.getByRole("button", { name: "回答を送信" }).click();
    await expect(dialog(guest)).toContainText("回答を保存しました");
    await expect(guest.getByRole("region", { name: "集計結果" })).toHaveCount(
      0,
    );
    await expect(
      guest.getByRole("button", { name: "集計結果をスライドに挿入" }),
    ).toHaveCount(0);
    await guest.getByRole("radio", { name: "夏", exact: true }).check();
    await guest.getByRole("button", { name: "回答を変更して保存" }).click();
    await expect(dialog(page)).toContainText("集計結果 · 1人が回答");
    await expect(
      page.locator(".survey-result").filter({ hasText: "夏" }),
    ).toContainText("1件 (100%)");
    await page
      .getByRole("button", { name: "集計結果をスライドに挿入" })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator(".slide-card")).toHaveCount(6);
    await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
    await expect(page.locator(".slide-card")).toHaveCount(5);
    await page.getByRole("button", { name: "やり直す", exact: true }).click();
    await expect(page.locator(".slide-card")).toHaveCount(6);
    await launch(page).click();
    await page.getByRole("button", { name: "新しいアンケート" }).click();
    await page
      .getByRole("textbox", { name: "アンケートの質問" })
      .fill("今日の発見");
    await page
      .getByRole("combobox", { name: "アンケートの回答形式" })
      .selectOption("text");
    await page.getByRole("button", { name: "下書きを作成" }).click();
    await expect(dialog(page)).toContainText("下書きを作成しました");
    await page.getByRole("button", { name: "受付を開始", exact: true }).click();
    await dialog(guest)
      .getByRole("button", { name: /今日の発見/ })
      .click();
    const answer = "<script>も文字として表示🌸\n春の花を見つけた";
    await guest
      .getByRole("textbox", { name: "アンケートの回答", exact: true })
      .fill(answer);
    await guest.getByRole("button", { name: "回答を送信" }).click();
    await expect(dialog(guest)).toContainText("回答を保存しました");
    await expect(page.locator(".survey-results li")).toHaveText(answer);
    await page.getByRole("button", { name: "受付を終了", exact: true }).click();
    await expect(
      guest.getByRole("textbox", { name: "アンケートの回答", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "集計結果をスライドに挿入" })
      .click();
    await expect(page.locator(".slide-card")).toHaveCount(7);
    await expect(guest.locator(".slide-card")).toHaveCount(7);
    await page.reload();
    await expect(page.locator(".slide-card")).toHaveCount(7);
    await launch(page).click();
    await dialog(page)
      .getByRole("button", { name: /今日の発見/ })
      .click();
    await expect(page.locator(".survey-results li")).toHaveText(answer);
    await page.screenshot({
      path: info.outputPath("survey-results.png"),
      fullPage: true,
    });
    const guestData = await (
      await guest.request.get(`/api/decks/${id}/surveys`)
    ).json();
    expect(guestData.surveys.every((s: any) => !s.results)).toBe(true);
  } finally {
    await guestContext.close();
  }
});
