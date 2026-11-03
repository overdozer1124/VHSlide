import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { blank } from "../../src/model";
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
const launcher = (page: Page) =>
  page.getByRole("button", { name: "フォーム", exact: true });
test("free input creation, blur/idle autosave, pending recovery, read-only anonymous slide sharing and live changes", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const context = await browser.newContext(info.project.use);
  const guest = await context.newPage();
  try {
    await signIn(page, "free-host");
    await signIn(guest, "free-guest");
    const created = await page.request.post("/api/decks", {
      headers,
      data: {
        version: 1,
        title: "自由な回答欄",
        slides: [blank(0, 0), blank(0, 1)],
      },
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
    await page.goto(`/?room=${id}`);
    await guest.goto(`/?room=${id}`);
    await expect(page.locator(".slide-card")).toHaveCount(2);
    await expect(guest.locator(".slide-card")).toHaveCount(2);
    await page.locator(".thumbnail").first().click();
    await guest.locator(".thumbnail").first().click();
    await page.getByRole("button", { name: "フォーム", exact: true }).click();
    await page.getByRole("tab", { name: "回答欄を追加", exact: true }).click();
    const tools = page.getByRole("region", {
      name: "回答欄の追加",
      exact: true,
    });
    const creator = page.getByRole("dialog", {
      name: "回答欄の追加",
      exact: true,
    });
    await expect(creator).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
      creator.getByRole("heading", {
        name: "ユーザーフォーム",
        exact: true,
      }),
    ).toBeVisible();
    const sharedModalId = await creator.getAttribute("id");

    await expect(
      tools.getByRole("button", { name: "新しく作る", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      tools.getByRole("button", { name: "スライドに追加", exact: true }),
    ).toBeDisabled();
    await tools
      .getByRole("button", { name: "作成済みの項目を使う", exact: true })
      .click();
    await expect(tools).toContainText("作成済みの項目はありません");
    await tools
      .getByRole("button", { name: "新しく作る", exact: true })
      .click();
    await tools
      .getByRole("textbox", { name: "新しい入力項目名" })
      .fill("観察から気づいたこと");
    await expect(creator.locator(".response-field-preview")).toContainText(
      "観察から気づいたこと",
    );
    await tools.getByRole("button", { name: /^単一選択/ }).click();
    await expect(creator.locator(".response-field-preview")).toContainText(
      "はい",
    );
    await tools.getByRole("button", { name: /^記述/ }).click();
    await page.keyboard.press("Escape");
    await expect(creator).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "フォーム", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "フォーム", exact: true }).click();
    await page.getByRole("tab", { name: "回答欄を追加", exact: true }).click();
    await expect(
      tools.getByRole("textbox", { name: "新しい入力項目名" }),
    ).toHaveValue("観察から気づいたこと");
    await creator
      .getByRole("tab", { name: "ワークシート", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveAttribute(
      "id",
      sharedModalId!,
    );
    await page
      .getByRole("dialog")
      .getByRole("tab", { name: "回答欄を追加", exact: true })
      .click();
    await expect(
      tools.getByRole("textbox", { name: "新しい入力項目名" }),
    ).toHaveValue("観察から気づいたこと");
    await page.screenshot({
      path: info.outputPath("response-field-creator.png"),
      fullPage: true,
    });
    let releaseCreate: (() => void) | undefined;
    await page.route(`**/api/decks/${id}/worksheets`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await new Promise<void>((resolve) => {
        releaseCreate = resolve;
      });
      await route.continue();
    });
    await tools.getByRole("button", { name: "スライドに追加" }).click();
    await expect(
      creator.getByRole("button", { name: "回答欄の追加を閉じる" }),
    ).toBeDisabled();
    await expect(
      creator.getByRole("tab", { name: "アンケート", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(creator).toBeVisible();
    await expect.poll(() => !!releaseCreate).toBe(true);
    releaseCreate!();
    await expect(creator).not.toBeVisible();
    await page.unroute(`**/api/decks/${id}/worksheets`);
    await expect(
      page.getByRole("status").filter({ hasText: "回答欄を追加しました" }),
    ).toBeVisible();

    const hostField = page
      .locator(".editor-workspace [data-response-field]")
      .first();
    await expect(
      hostField.getByRole("button", { name: "入力欄を移動" }),
    ).toHaveCount(0);
    const initial = (await hostField.boundingBox())!;
    const label = (await hostField
      .locator(".worksheet-input-label")
      .first()
      .boundingBox())!;
    const start = {
      x: label.x + label.width / 2,
      y: label.y + label.height / 2,
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 15, start.y + 8, { steps: 3 });
    await page.mouse.up();
    await expect
      .poll(async () => (await hostField.boundingBox())!.x)
      .toBeGreaterThan(initial.x);
    expect(
      Math.abs((await hostField.boundingBox())!.width - initial.width),
    ).toBeLessThan(0.5);
    const appearance = page.getByRole("region", {
      name: "入力欄の設定",
      exact: true,
    });
    await appearance
      .getByRole("checkbox", { name: "背景を透明にする" })
      .check();
    await appearance.getByRole("checkbox", { name: "枠線を非表示" }).check();
    await appearance.getByRole("checkbox", { name: "項目名を表示" }).uncheck();
    const field = guest.locator(".editor-workspace [data-response-field]");
    await expect(field).toHaveCount(1);
    const input = field.getByRole("textbox", {
      name: "観察から気づいたこと",
      exact: true,
    });
    await expect(input).toBeEnabled({ timeout: 10000 });
    await expect(field).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(field).toHaveCSS("border-top-width", "0px");
    let requests = 0;
    guest.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/answer")) requests++;
    });
    await input.fill("一秒後に保存");
    await expect(guest.getByLabel("回答の保存状態")).toHaveText(
      "回答は保存済みです",
    );
    expect(requests).toBe(1);
    await input.dispatchEvent("compositionstart");
    await input.fill("日本語を変換中");
    await guest.waitForTimeout(1200); // No request may leave while an IME composition is active.
    expect(requests).toBe(1);
    await input.dispatchEvent("compositionend");
    await expect(guest.getByLabel("回答の保存状態")).toHaveText(
      "回答は保存済みです",
    );
    expect(requests).toBe(2);
    await input.fill("入力欄を離れて保存");
    await input.blur();
    await expect
      .poll(async () => {
        const r = await guest.request.get(`/api/decks/${id}/worksheets`);
        return (await r.json()).worksheets[0]?.own?.values;
      })
      .toEqual(
        expect.objectContaining({
          [Object.keys(
            (
              await (
                await guest.request.get(`/api/decks/${id}/worksheets`)
              ).json()
            ).worksheets[0].own.values,
          )[0]]: "入力欄を離れて保存",
        }),
      );
    await guest.route("**/worksheets/*/answer", (route) => route.abort());
    await input.fill("通信復帰後の回答");
    await input.blur();
    await expect(guest.getByLabel("回答の保存状態")).toContainText("未保存");
    await guest.reload();
    await expect(guest.locator(".slide-card")).toHaveCount(2);
    await guest.locator(".thumbnail").first().click();
    await expect(input).toHaveValue("通信復帰後の回答");
    await guest.unroute("**/worksheets/*/answer");
    await guest.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(guest.getByLabel("回答の保存状態")).toHaveText(
      "回答は保存済みです",
    );
    // Open the gallery from a different, empty page.
    await page.locator(".rail-trigger").nth(1).click();
    await expect(page.locator(".rail-trigger").nth(1)).toHaveClass(
      /rail-active/,
    );
    await launcher(page).click();
    await page.getByRole("tab", { name: "回答スライド", exact: true }).click();
    await expect(page.locator(".gallery-slide-choice")).toHaveCount(1);
    await page.locator(".gallery-slide-choice").first().click();
    await expect(page.locator(".gallery-card")).toHaveCount(1);
    await expect(page.locator(".gallery-card textarea")).toHaveValue(
      "通信復帰後の回答",
    );
    await expect(page.locator(".gallery-card textarea")).toBeDisabled();
    const galleryPane = page.getByRole("tabpanel", { name: "回答スライド" });
    const paneBox = (await galleryPane.boundingBox())!;
    await page.mouse.move(paneBox.x + paneBox.width - 20, paneBox.y + paneBox.height / 2);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => galleryPane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.locator(".gallery-card footer").first().scrollIntoViewIfNeeded();
    expect(
      (await (await guest.request.get(`/api/decks/${id}/gallery`)).json())
        .gallery,
    ).toBe(null);
    await page
      .getByRole("button", { name: "選択したスライドの回答を全員に共有" })
      .click();
    await launcher(guest).click();
    await guest.getByRole("tab", { name: "回答スライド", exact: true }).click();
    await expect(guest.locator(".gallery-card")).toHaveCount(1);
    await expect(guest.locator(".gallery-card")).toContainText("回答 1");
    await expect(guest.locator(".gallery-card")).not.toContainText(
      "free-guest",
    );
    await page
      .getByRole("checkbox", { name: "保存された回答を自動更新" })
      .check();
    await page
      .getByRole("button", { name: "選択したスライドの回答を全員に共有" })
      .click();
    await guest.getByRole("button", { name: "回答スライドを閉じる" }).click();
    await input.fill("みんなへの最新の回答");
    await input.blur();
    await expect(guest.getByLabel("回答の保存状態")).toHaveText(
      "回答は保存済みです",
    );
    await launcher(guest).click();
    await expect(guest.locator(".gallery-card textarea")).toHaveValue(
      "みんなへの最新の回答",
    );
    await page.getByRole("button", { name: "共有を停止" }).click();
    await expect(guest.locator(".gallery-card")).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("free-input-gallery.png"),
      fullPage: true,
    });
    const original = (
      await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
    ).worksheets[0];
    expect(
      (
        await page.request.post(
          `/api/decks/${id}/worksheets/${original.id}/answer`,
          {
            headers,
            data: {
              patch: true,
              values: { [original.fields[0].id]: "ホストの入力" },
            },
          },
        )
      ).status(),
    ).toBe(200);
    await page.locator(".gallery-slide-choice").first().click();
    await expect(page.locator(".gallery-card")).toHaveCount(2);
    const comparisons = page.getByRole("checkbox", {
      name: "比較",
      exact: true,
    });
    await comparisons.nth(0).check();
    await comparisons.nth(1).check();
    await page.getByRole("button", { name: "選択した回答を比較" }).click();
    await expect(page.locator(".gallery-card")).toHaveCount(2);
    await page
      .getByRole("button", { name: "拡大", exact: true })
      .first()
      .click();
    const enlarged = page.getByRole("dialog", {
      name: "回答スライドの拡大",
      exact: true,
    });
    await expect(enlarged.getByRole("textbox")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(enlarged).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "回答スライド", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "比較を解除" }).click();
    await page.getByRole("button", { name: "回答スライドを閉じる" }).click();
    await page.getByRole("button", { name: "全体マップへ" }).click();
    await page.locator(".thumbnail").first().click();
    await page
      .locator(".editor-workspace .element-drag-border.border-left")
      .first()
      .click({ timeout: 10_000 });
    await appearance
      .getByRole("button", { name: "別の回答項目として複製" })
      .click({ timeout: 10_000 });
    await expect(
      guest.locator(".editor-workspace [data-response-field]"),
    ).toHaveCount(2);
    await expect(
      guest.locator(".editor-workspace [data-response-field] textarea").nth(1),
    ).toHaveValue("");
    await page.getByRole("button", { name: "フォーム", exact: true }).click();
    await page.getByRole("tab", { name: "回答欄を追加", exact: true }).click();
    await tools.getByText("入力欄の配置ひな形", { exact: true }).click();
    await tools
      .getByRole("textbox", { name: "ひな形の名前" })
      .fill("観察の配置");
    await tools
      .getByRole("button", { name: "このページの入力欄の配置を保存" })
      .click();
    await tools
      .getByRole("button", { name: "新しい項目として配置", exact: true })
      .click();
    await expect(
      guest.locator(".editor-workspace [data-response-field]"),
    ).toHaveCount(4);
    const sheets = (
      await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
    ).worksheets;
    expect(sheets).toHaveLength(2);
    expect(sheets.every((sheet: any) => sheet.fields.length === 2)).toBe(true);
    expect(
      sheets.find((sheet: any) => sheet.id !== original.id).own,
    ).toBeUndefined();
  } finally {
    await context.close();
  }
});
