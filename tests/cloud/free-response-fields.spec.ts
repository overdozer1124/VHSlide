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
      tools.getByRole("button", { name: "受付を開始してスライドに追加", exact: true }),
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
    await expect(field).toHaveCount(1, { timeout: 15_000 });
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
    await page.mouse.move(
      paneBox.x + paneBox.width - 20,
      paneBox.y + paneBox.height / 2,
    );
    await page.mouse.wheel(0, 600);
    await expect
      .poll(() => galleryPane.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await page.locator(".gallery-card footer").first().scrollIntoViewIfNeeded();
    expect(
      (await (await guest.request.get(`/api/decks/${id}/gallery`)).json())
        .gallery,
    ).toBe(null);
    await page
      .getByRole("button", { name: "選択したスライドの回答を全員に共有" })
      .click();
    // A second published slide is independently selectable in the read-only workspace.
    const publicGallery = (
      await (await page.request.get(`/api/decks/${id}/gallery`)).json()
    ).gallery;
    const secondSlide = {
      ...publicGallery.slide,
      id: crypto.randomUUID(),
      title: "別の共有スライド",
    };
    expect(
      (
        await page.request.post(`/api/decks/${id}/gallery/publish`, {
          headers,
          data: { slide: secondSlide, append: true },
        })
      ).status(),
    ).toBe(200);
    await launcher(guest).click();
    await guest.getByRole("tab", { name: "回答スライド", exact: true }).click();
    const openShared = guest.getByRole("button", {
      name: "共有された回答を開く",
    });
    await expect(openShared).toBeEnabled();
    await openShared.click();
    const workspace = guest.getByRole("dialog", {
      name: "共有された回答スライド",
    });
    await expect(workspace).toBeVisible();
    await expect(workspace.locator(".response-workspace-card")).toHaveCount(1);
    await guest.screenshot({
      path: info.outputPath("shared-response-map.png"),
    });
    await expect(workspace.locator(".response-workspace-card")).toContainText(
      "回答 1",
    );
    await expect(workspace).not.toContainText("free-guest");
    await workspace.getByRole("button", { name: "拡大", exact: true }).click();
    await expect(workspace).toContainText("125%");
    await expect(
      workspace.getByLabel("スライドを選択").locator("option"),
    ).toHaveCount(2);
    await workspace.getByLabel("スライドを選択").selectOption(secondSlide.id);
    await expect(
      workspace.getByText("別の共有スライド · 1人の回答"),
    ).toBeVisible();
    await workspace.getByRole("button", { name: "回答 1の回答を閲覧" }).click();
    await expect(workspace).toContainText("閲覧のみ");
    await expect(
      workspace.getByRole("complementary", { name: "回答一覧" }),
    ).toBeVisible();
    await expect(workspace.getByRole("textbox")).toBeDisabled();
    await guest.screenshot({
      path: info.outputPath("shared-response-detail.png"),
    });
    await workspace.getByRole("button", { name: "回答一覧へ" }).click();
    await page
      .getByRole("checkbox", { name: "保存された回答を自動更新" })
      .check();
    await page
      .getByRole("button", { name: "選択したスライドの回答を全員に共有" })
      .click();
    await workspace.getByRole("button", { name: "作品に戻る" }).click();
    await input.fill("みんなへの最新の回答");
    await input.blur();
    await expect(guest.getByLabel("回答の保存状態")).toHaveText(
      "回答は保存済みです",
    );
    await launcher(guest).click();
    await guest.getByRole("button", { name: "共有された回答を開く" }).click();
    await expect(
      workspace.locator(".response-workspace-card textarea"),
    ).toHaveValue("みんなへの最新の回答");
    await page
      .getByRole("button", { name: "すべての共有を停止", exact: true })
      .click();
    await expect(workspace.locator(".response-workspace-card")).toHaveCount(0);
    await workspace.getByRole("button", { name: "作品に戻る" }).click();
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

test("creates an image and drawing response field directly on a slide", async ({
  page,
}) => {
  await signIn(page, "drawing-field-host");
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "画像回答", slides: [blank(0, 0)] },
  });
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await expect(
    page.getByRole("button", { name: "ゲストの設定" }),
  ).toBeVisible();
  await page.locator(".thumbnail").first().click();
  await launcher(page).click();
  await page.getByRole("tab", { name: "回答欄を追加", exact: true }).click();
  const tools = page.getByRole("region", { name: "回答欄の追加", exact: true });
  await tools
    .getByRole("textbox", { name: "新しい入力項目名" })
    .fill("絵で説明しよう");
  await tools.getByRole("button", { name: /^画像・手描き/ }).click();
  await expect(tools).not.toContainText("選択肢（1行1項目");
  await tools
    .getByRole("button", { name: "受付を開始してスライドに追加", exact: true })
    .click();
  const field = page.locator(".editor-workspace .response-field");
  await field
    .getByRole("button", { name: "絵で説明しようの画像・手描きを編集" })
    .click();
  await expect(field.getByLabel("絵で説明しようの手描き欄")).toBeVisible();
  const worksheets = (
    await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
  ).worksheets;
  expect(worksheets[0].fields[0].kind).toBe("drawing");
  expect(worksheets[0].status).toBe("open");
});

test("keeps an added image even if editing ends while it is still loading", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "drawing-race-host");
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "画像の読み込み競合", slides: [blank(0, 0)] },
  });
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await page.locator(".thumbnail").first().click();
  await launcher(page).click();
  await page.getByRole("tab", { name: "回答欄を追加", exact: true }).click();
  const tools = page.getByRole("region", { name: "回答欄の追加", exact: true });
  await tools
    .getByRole("textbox", { name: "新しい入力項目名" })
    .fill("大きな画像");
  await tools.getByRole("button", { name: /^画像・手描き/ }).click();
  await tools
    .getByRole("button", { name: "受付を開始してスライドに追加", exact: true })
    .click();
  const field = page.locator(".editor-workspace .response-field");
  await field
    .getByRole("button", { name: "大きな画像の画像・手描きを編集" })
    .click();
  await expect(field.getByLabel("大きな画像の手描き欄")).toBeVisible();
  // Hand the field a very large photo and leave edit mode in the same
  // turn, before the image can finish decoding — the file dialog and the
  // focus changes around it can close the editor in just this window.
  await field.evaluate(async (section) => {
    const canvas = document.createElement("canvas");
    canvas.width = 12000;
    canvas.height = 9000;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#a03c31";
    ctx.fillRect(0, 0, 12000, 9000);
    ctx.fillStyle = "#f4e3c1";
    for (let i = 0; i < 2000; i++)
      ctx.fillRect((i * 197) % 11800, (i * 389) % 8800, 90, 60);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    const input = section.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob!], "photo.jpg", { type: "image/jpeg" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  await expect
    .poll(
      async () => {
        const sheets = (
          await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
        ).worksheets;
        return Object.values(sheets[0]?.own?.values ?? {})[0];
      },
      { timeout: 30_000 },
    )
    .toMatch(/^data:image\/jpeg;base64,/);
  await expect(field.locator(".worksheet-drawing-view img")).toBeVisible();
});

test("keeps edit mode open while a picked image is still loading", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "drawing-guard-host");
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "読み込み中の編集維持", slides: [blank(0, 0)] },
  });
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await page.locator(".thumbnail").first().click();
  await launcher(page).click();
  await page.getByRole("tab", { name: "回答欄を追加", exact: true }).click();
  const tools = page.getByRole("region", { name: "回答欄の追加", exact: true });
  await tools
    .getByRole("textbox", { name: "新しい入力項目名" })
    .fill("大きな画像");
  await tools.getByRole("button", { name: /^画像・手描き/ }).click();
  await tools
    .getByRole("button", { name: "受付を開始してスライドに追加", exact: true })
    .click();
  const field = page.locator(".editor-workspace .response-field");
  await field
    .getByRole("button", { name: "大きな画像の画像・手描きを編集" })
    .click();
  await expect(field.getByLabel("大きな画像の手描き欄")).toBeVisible();
  // Pick a very large photo and immediately click outside the field, as
  // the closing file dialog's click can land on the page in some
  // environments; edit mode must survive until the image has loaded.
  await field.evaluate(async (section) => {
    const canvas = document.createElement("canvas");
    canvas.width = 12000;
    canvas.height = 9000;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#31572c";
    ctx.fillRect(0, 0, 12000, 9000);
    ctx.fillStyle = "#ecf39e";
    for (let i = 0; i < 2000; i++)
      ctx.fillRect((i * 197) % 11800, (i * 389) % 8800, 90, 60);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    section
      .querySelector<HTMLElement>("label.worksheet-drawing-upload")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = section.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob!], "photo.jpg", { type: "image/jpeg" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
  });
  await expect
    .poll(
      async () => {
        const sheets = (
          await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
        ).worksheets;
        return Object.values(sheets[0]?.own?.values ?? {})[0];
      },
      { timeout: 30_000 },
    )
    .toMatch(/^data:image\/jpeg;base64,/);
  // The editor stayed open through the load, and shows the added image.
  await expect(field.getByLabel("大きな画像の手描き欄")).toBeVisible();
  await expect(
    field.getByRole("button", { name: "消去", exact: true }),
  ).toBeEnabled();
});

test("the drawing canvas adopts the placed frame's aspect", async ({
  page,
}) => {
  await signIn(page, "drawing-aspect-host");
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "枠の形に合わせる", slides: [blank(0, 0)] },
  });
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await page.locator(".thumbnail").first().click();
  await launcher(page).click();
  await page.getByRole("tab", { name: "回答欄を追加", exact: true }).click();
  const tools = page.getByRole("region", { name: "回答欄の追加", exact: true });
  await tools
    .getByRole("textbox", { name: "新しい入力項目名" })
    .fill("形の確認");
  await tools.getByRole("button", { name: /^画像・手描き/ }).click();
  await tools
    .getByRole("button", { name: "受付を開始してスライドに追加", exact: true })
    .click();
  const field = page.locator(".editor-workspace .response-field");
  await field
    .getByRole("button", { name: "形の確認の画像・手描きを編集" })
    .click();
  const canvas = field.getByLabel("形の確認の手描き欄");
  await expect(canvas).toBeVisible();
  const dims = await canvas.evaluate((node) => {
    const c = node as HTMLCanvasElement;
    return { width: c.width, height: c.height };
  });
  // The default drawing frame is 560x340 slide units; the canvas must
  // follow it (889x540) instead of the fixed 960x540.
  expect(Math.abs(dims.width / dims.height - 560 / 340)).toBeLessThan(0.03);
  expect(dims).not.toEqual({ width: 960, height: 540 });
});

test("sidebar shows only the selected response field's item", async ({
  page,
}) => {
  await signIn(page, "sidebar-single-host");
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "サイドバー単一項目", slides: [blank(0, 0)] },
  });
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await page.locator(".thumbnail").first().click();
  const tools = page.getByRole("region", {
    name: "回答欄の追加",
    exact: true,
  });
  for (const label of ["1つ目の項目", "2つ目の項目"]) {
    await launcher(page).click();
    await page
      .getByRole("tab", { name: "回答欄を追加", exact: true })
      .click();
    await tools
      .getByRole("textbox", { name: "新しい入力項目名" })
      .fill(label);
    await tools.getByRole("button", { name: /^記述/ }).click();
    // The second field goes into the already-open worksheet, whose
    // placement button is labelled just "スライドに追加".
    const start = tools.getByRole("button", {
      name: "受付を開始してスライドに追加",
      exact: true,
    });
    if (await start.isVisible().catch(() => false)) {
      await start.click();
    } else {
      await tools
        .getByRole("button", { name: "スライドに追加", exact: true })
        .click();
    }
  }
  const second = page.locator(".editor-workspace .response-field", {
    hasText: "2つ目の項目",
  });
  // Click the top edge (away from the corner resize handles) to select it.
  await second.click({ position: { x: 40, y: 8 } });
  const sidebar = page.locator(".form-sidebar-editor");
  await expect(sidebar).toBeVisible();
  // Only the selected field's editor is shown, not the whole worksheet.
  await expect(sidebar.locator("fieldset.worksheet-field-editor")).toHaveCount(
    1,
  );
  await expect(
    sidebar.getByRole("textbox", { name: "項目名2" }),
  ).toHaveValue("2つ目の項目");
  await sidebar
    .getByRole("textbox", { name: "項目名2" })
    .fill("直した2つ目の項目");
  await sidebar
    .getByRole("button", { name: "保存する" })
    .first()
    .click();
  await expect
    .poll(
      async () => {
        const sheets = (
          await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
        ).worksheets;
        return sheets.flatMap((s: any) =>
          s.fields.map((f: any) => f.label),
        );
      },
      { timeout: 15000 },
    )
    .toEqual(expect.arrayContaining(["1つ目の項目", "直した2つ目の項目"]));
});
