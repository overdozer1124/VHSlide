import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { sample, parseDeck, serializeDeck } from "../../src/model";
import { worksheetTemplate } from "../../src/worksheetTemplates";
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
  page.getByRole("button", { name: "フォーム", exact: true });
async function openWorksheets(page: Page) {
  await launcher(page).click();
  await page.getByRole("tab", { name: "ワークシート", exact: true }).click();
}
const modal = (page: Page) =>
  page.getByRole("dialog", { name: "ワークシート", exact: true });
test("host edits the student form layout while preserving answers and live updates", async ({
  page,
  browser,
}, info) => {
  const context = await browser.newContext(info.project.use),
    guest = await context.newPage();
  try {
    await signIn(page, "layout-modal-host");
    await signIn(guest, "layout-modal-guest");
    const headers = { Origin: "http://127.0.0.1:3187" };
    const { id } = await (
      await page.request.post("/api/decks", { headers, data: sample() })
    ).json();
    const invite = await (
      await page.request.post(`/api/decks/${id}/invite`, { headers })
    ).json();
    const token = new URL(invite.url).searchParams.get("join");
    const accepted = await (
      await guest.request.post(`/api/invites/${token}/accept`, { headers })
    ).json();
    if (accepted.status === "pending")
      await page.request.post(`/api/decks/${id}/join-requests/approve`, {
        headers,
        data: { requestIds: [accepted.requestId] },
      });
    const sheet = (
      await (
        await page.request.post(`/api/decks/${id}/worksheets`, {
          headers,
          data: worksheetTemplate("reason"),
        })
      ).json()
    ).worksheets[0];
    await page.request.post(`/api/decks/${id}/worksheets/${sheet.id}/status`, {
      headers,
      data: { status: "open" },
    });
    await page.goto(`/?room=${id}`);
    await guest.goto(`/?room=${id}`);
    await expect(page.locator(".slide-card")).toHaveCount(5);
    await openWorksheets(page);
    await openWorksheets(guest);
    await guest
      .getByRole("textbox", { name: "選んだ理由", exact: true })
      .fill("私の回答");
    await guest
      .getByRole("textbox", { name: "選んだ理由", exact: true })
      .blur();
    await expect(modal(guest)).toContainText("入力は保存済みです。");
    await page.getByRole("button", { name: "設定・内容の確認" }).click();
    await page
      .getByRole("button", { name: "入力画面のレイアウトを編集" })
      .click();
    const editor = page.getByRole("region", {
      name: "フォーム画面のレイアウト編集",
    });
    const card = editor.locator(".worksheet-positioned-field").first();
    const resize = editor.getByRole("button", {
      name: "1. 選んだ理由の大きさを変更",
    });
    await resize.scrollIntoViewIfNeeded();
    const box = (await resize.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 - 250,
      box.y + box.height / 2 + 40,
      { steps: 4 },
    );
    await page.mouse.up();
    await expect(card).not.toHaveAttribute("style", /width: 100%/);
    const resizeStyle = await card.getAttribute("style");
    await editor.getByRole("button", { name: "1. 選んだ理由を移動" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(card).not.toHaveAttribute("style", resizeStyle!);
    const finalStyle = (await card.getAttribute("style"))!
      .replace(/\s*z-index:\s*2;?/, "")
      .trim();
    await page.getByRole("button", { name: "レイアウトを保存" }).click();
    await expect(modal(page)).toContainText("画面のレイアウトを保存しました");
    const guestCard = guest
      .locator(
        ".worksheet-modal-layout:not(.is-editing) .worksheet-positioned-field",
      )
      .first();
    await expect(guestCard).toHaveAttribute("style", finalStyle!, {
      timeout: 15000,
    });
    await expect(
      guestCard.getByRole("textbox", { name: "選んだ理由" }),
    ).toHaveValue("私の回答");
    await guestCard
      .getByRole("textbox", { name: "選んだ理由" })
      .fill("保存後も入力");
    await guestCard.getByRole("textbox", { name: "選んだ理由" }).blur();
    await guest.reload();
    await openWorksheets(guest);
    await expect(
      guest
        .locator(".worksheet-modal-layout .worksheet-positioned-field")
        .first()
        .getByRole("textbox", { name: "選んだ理由" }),
    ).toHaveValue("保存後も入力");
    await expect(
      guest
        .locator(".worksheet-modal-layout .worksheet-positioned-field")
        .first(),
    ).toHaveAttribute("style", finalStyle!);
    await page
      .getByRole("button", { name: "入力画面のレイアウトを編集" })
      .click();
    await page.getByRole("button", { name: "標準の配置に戻す" }).click();
    await page.getByRole("button", { name: "レイアウトを保存" }).click();
    await expect(guest.locator(".worksheet-modal-layout")).toHaveCount(0, {
      timeout: 15000,
    });
    await expect(
      guest.getByRole("textbox", { name: "選んだ理由", exact: true }),
    ).toHaveValue("保存後も入力");
  } finally {
    await context.close();
  }
});
test("existing worksheet fields become individually movable and keep personal answers", async ({
  page,
  browser,
}, info) => {
  const context = await browser.newContext(info.project.use),
    guest = await context.newPage();
  try {
    await signIn(page, "layout-host");
    await signIn(guest, "layout-guest");
    const headers = { Origin: "http://127.0.0.1:3187" };
    const { id } = await (
      await page.request.post("/api/decks", { headers, data: sample() })
    ).json();
    const invite = await (
      await page.request.post(`/api/decks/${id}/invite`, { headers })
    ).json();
    const token = new URL(invite.url).searchParams.get("join");
    const accepted = await (
      await guest.request.post(`/api/invites/${token}/accept`, { headers })
    ).json();
    if (accepted.status === "pending")
      await page.request.post(`/api/decks/${id}/join-requests/approve`, {
        headers,
        data: { requestIds: [accepted.requestId] },
      });
    const created = await page.request.post(`/api/decks/${id}/worksheets`, {
      headers,
      data: worksheetTemplate("reason"),
    });
    expect(created.status()).toBe(200);
    const sheet = (await created.json()).worksheets[0];
    expect(
      (
        await page.request.post(
          `/api/decks/${id}/worksheets/${sheet.id}/status`,
          { headers, data: { status: "open" } },
        )
      ).status(),
    ).toBe(200);
    await page.goto(`/?room=${id}`);
    await guest.goto(`/?room=${id}`);
    await expect(page.locator(".slide-card")).toHaveCount(5);
    await openWorksheets(page);
    await page
      .getByRole("button", { name: "このワークシートをスライドに配置" })
      .click();
    await guest.locator(".thumbnail").first().click();
    const guestForm = guest.locator(".editor-workspace .slide-worksheet");
    await guestForm
      .getByRole("textbox", { name: "選んだ理由" })
      .fill("保存済みの答え");
    await guestForm.getByRole("textbox", { name: "選んだ理由" }).blur();
    await expect(guestForm).toContainText("入力は保存済みです。");
    const hostForm = page.locator(".editor-workspace .slide-worksheet");
    await hostForm.locator("header h3").click();
    await page.getByRole("button", { name: "入力欄を個別に配置" }).click();
    await expect(
      page.locator(".editor-workspace .slide-worksheet"),
    ).toHaveCount(0);
    await expect(page.locator(".editor-workspace .response-field")).toHaveCount(
      3,
    );
    const guestField = guest
      .locator(".editor-workspace .response-field")
      .first();
    await expect(
      guestField.getByRole("textbox", { name: "理由と工夫：選んだ理由" }),
    ).toHaveValue("保存済みの答え");
    await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
    await expect(
      page.locator(".editor-workspace .slide-worksheet"),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "やり直す", exact: true }).click();
    await expect(page.locator(".editor-workspace .response-field")).toHaveCount(
      3,
    );
    await expect(
      guestField.getByRole("textbox", { name: "理由と工夫：選んだ理由" }),
    ).toHaveValue("保存済みの答え");
    const hostField = page.locator(".editor-workspace .response-field").first();
    const position = await hostField.boundingBox();
    const label = await hostField
      .locator(".worksheet-input-label")
      .boundingBox();
    await page.mouse.move(label!.x + 10, label!.y + 8);
    await page.mouse.down();
    await page.mouse.move(label!.x + 45, label!.y + 8, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () => (await hostField.boundingBox())!.x)
      .toBeGreaterThan(position!.x + 10);
    const handle = page.getByRole("button", {
      name: "要素の右の枠でサイズを変更",
    });
    const h = await handle.boundingBox();
    const before = (await hostField.boundingBox())!.width;
    await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
    await page.mouse.down();
    await page.mouse.move(h!.x + h!.width / 2 - 50, h!.y + h!.height / 2, {
      steps: 4,
    });
    await page.mouse.up();
    await expect
      .poll(async () => (await hostField.boundingBox())!.width)
      .toBeLessThan(before - 10);
    const bottom = await page
      .getByRole("button", { name: "要素の下の枠でサイズを変更" })
      .boundingBox();
    const beforeHeight = (await hostField.boundingBox())!.height;
    await page.mouse.move(
      bottom!.x + bottom!.width / 2,
      bottom!.y + bottom!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bottom!.x + bottom!.width / 2,
      bottom!.y + bottom!.height / 2 - 35,
      { steps: 4 },
    );
    await page.mouse.up();
    await expect
      .poll(async () => (await hostField.boundingBox())!.height)
      .toBeLessThan(beforeHeight - 10);
    await guestField
      .getByRole("textbox", { name: "理由と工夫：選んだ理由" })
      .fill("移動後の答え");
    await guestField
      .getByRole("textbox", { name: "理由と工夫：選んだ理由" })
      .blur();
    await openWorksheets(page);
    await page.getByRole("button", { name: /回答結果（1人）/ }).click();
    await expect(modal(page)).toContainText("移動後の答え");
  } finally {
    await context.close();
  }
});
test("radar worksheets chart each participant's scores and export separate columns", async ({
  page,
  browser,
}, info) => {
  const context = await browser.newContext(info.project.use);
  const guest = await context.newPage();
  try {
    await signIn(page, "radar-host");
    await signIn(guest, "radar-guest");
    const headers = { Origin: "http://127.0.0.1:3187" };
    const { id } = await (
      await page.request.post("/api/decks", { headers, data: sample() })
    ).json();
    const invite = await (
      await page.request.post(`/api/decks/${id}/invite`, { headers })
    ).json();
    const token = new URL(invite.url).searchParams.get("join");
    const accepted = await (
      await guest.request.post(`/api/invites/${token}/accept`, { headers })
    ).json();
    if (accepted.status === "pending")
      await page.request.post(`/api/decks/${id}/join-requests/approve`, {
        headers,
        data: { requestIds: [accepted.requestId] },
      });
    await page.goto(`/?room=${id}`);
    await guest.goto(`/?room=${id}`);
    await expect(page.locator(".slide-card")).toHaveCount(5);
    await openWorksheets(page);
    await modal(page)
      .getByRole("button", { name: "新しいワークシート" })
      .click();
    await page
      .getByRole("combobox", { name: "ワークシートのひな形" })
      .selectOption("radar");
    await page
      .getByRole("textbox", { name: "レーダーチャートの項目1" })
      .fill("安全\n快適\n活動");
    await page
      .getByRole("textbox", { name: "レーダーチャートの場面1" })
      .fill("登山\n式典");
    await page.getByRole("button", { name: "下書きを作成" }).click();
    await expect(modal(page)).toContainText("下書きを作成しました");
    await page.getByRole("button", { name: "受付を開始", exact: true }).click();
    await page
      .getByRole("button", { name: "このワークシートをスライドに配置" })
      .click();
    await guest.locator(".thumbnail").first().click();
    const form = guest.locator(".editor-workspace .slide-worksheet");
    const chart = form.getByRole("img", { name: "登山のレーダーチャート" });
    await expect(chart).toBeVisible();
    await form.getByRole("spinbutton", { name: "登山：安全" }).fill("5");
    await expect(chart.locator(".radar-point")).toHaveCount(1);
    await expect(chart.locator(".radar-area")).toHaveCount(0);
    await form.getByRole("spinbutton", { name: "登山：快適" }).fill("3");
    await form.getByRole("spinbutton", { name: "登山：活動" }).fill("4");
    await form.getByRole("spinbutton", { name: "式典：安全" }).fill("2");
    await form.getByRole("spinbutton", { name: "式典：安全" }).blur();
    await expect(chart.locator(".radar-area")).toHaveCount(1);
    await expect(form).toContainText("入力は保存済みです。");
    await guest.reload();
    await guest.locator(".thumbnail").first().click();
    await expect(
      guest
        .locator(".editor-workspace .slide-worksheet")
        .getByRole("spinbutton", { name: "登山：安全" }),
    ).toHaveValue("5");
    await openWorksheets(page);
    await page.getByRole("button", { name: /回答結果（1人）/ }).click();
    await expect(modal(page)).toContainText("radar-guest");
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "入力結果をCSV保存" }).click();
    const csv = await readFile((await (await downloading).path())!, "utf8");
    expect(csv).toContain("項目ごとの評価：登山：安全");
    expect(csv).toContain('"5","3","4","2","",""');
  } finally {
    await context.close();
  }
});
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
    await openWorksheets(page);
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
      .getByRole("button", { name: "セクション2に入力欄を追加", exact: true })
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
    ).toHaveCount(0);
    const beforeMove = (await hostCard.boundingBox())!;
    const header = (await hostCard.locator("header h3").boundingBox())!;
    const start = { x: header.x + 30, y: header.y + 10 };
    if (info.project.name.includes("touch")) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ id: 1, ...start }],
      });
      for (let i = 1; i <= 3; i++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            { id: 1, x: start.x + (15 * i) / 3, y: start.y + (8 * i) / 3 },
          ],
        });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
    } else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 15, start.y + 8, { steps: 3 });
      await page.mouse.up();
    }
    await expect
      .poll(async () => (await hostCard.boundingBox())!.x)
      .toBeGreaterThan(beforeMove.x);
    if (!info.project.name.includes("touch")) {
      const scroll = await hostCard.evaluate((node) => {
        const el = node as HTMLElement;
        el.style.height = "180px";
        const r = el.getBoundingClientRect(),
          scale = r.width / el.offsetWidth;
        return {
          overflow: el.scrollHeight > el.clientHeight,
          x: r.right - 7 * scale,
          y: r.top + 25,
          left: r.left + 4,
          mid: r.top + r.height / 2,
        };
      });
      if (scroll.overflow) {
        const positionBefore = (await hostCard.boundingBox())!;
        await page.mouse.move(scroll.left, scroll.mid);
        await page.mouse.wheel(0, 100);
        await expect
          .poll(() => hostCard.evaluate((el) => el.scrollTop))
          .toBeGreaterThan(0);
        await hostCard.evaluate((el) => {
          el.scrollTop = 0;
        });
        await page.mouse.move(scroll.x, scroll.y);
        await page.mouse.down();
        await page.mouse.move(scroll.x, scroll.y + 45, { steps: 3 });
        await page.mouse.up();
        const positionAfter = (await hostCard.boundingBox())!;
        expect(positionAfter.x).toBe(positionBefore.x);
        expect(positionAfter.y).toBe(positionBefore.y);
      }
      await hostCard.evaluate((node) => {
        (node as HTMLElement).style.height = "";
      });
    }

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
    await card.locator("textarea,input").first().blur();
    await expect(card).toContainText("入力は保存済みです。");
    await openWorksheets(page);
    await page.getByRole("button", { name: "設定・内容の確認" }).click();
    await page.getByRole("button", { name: "項目を編集・追加" }).click();
    await page.getByRole("button", { name: "入力欄2を下へ移動" }).click();
    await page
      .getByRole("spinbutton", { name: "ワークシート全体の文字の大きさ" })
      .fill("23");
    await page
      .locator(".worksheet-field-editor")
      .first()
      .getByText("入力欄の大きさ・文字を調整")
      .click();
    await page.getByRole("spinbutton", { name: "入力欄1の幅" }).fill("70");
    await page.getByRole("spinbutton", { name: "入力欄1の高さ" }).fill("110");
    await page
      .getByRole("spinbutton", { name: "入力欄1の文字の大きさ" })
      .fill("22");
    await page.getByRole("textbox", { name: "項目名1" }).fill("選んだ理由");
    await page
      .getByRole("button", { name: "セクション2に入力欄を追加", exact: true })
      .click();
    await page.getByRole("textbox", { name: "項目名5" }).fill("新しい質問");
    await page.getByRole("button", { name: "変更を保存" }).click();
    await expect(modal(page)).toContainText("保存しました。");
    await page.getByRole("button", { name: "ワークシートを閉じる" }).click();
    await expect(
      card.getByRole("textbox", { name: "新しい質問", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      card.getByRole("textbox", { name: "選んだ理由", exact: true }),
    ).toHaveValue(answer);
    await expect(card.locator(".worksheet-input-label").nth(1)).toHaveText(
      "他の人の意見から見つけたこと",
    );
    await expect(
      card
        .getByRole("textbox", { name: "選んだ理由", exact: true })
        .locator(".."),
    ).toHaveCSS("width", /.+px/);
    await expect(
      card.getByRole("textbox", { name: "選んだ理由", exact: true }),
    ).toHaveCSS("height", "110px");
    await expect(
      card
        .getByRole("textbox", { name: "選んだ理由", exact: true })
        .locator(".."),
    ).toHaveAttribute("style", /width: 70%/);
    await expect(card).toHaveAttribute("style", /--form-font-size: 23px/);
    await card
      .getByRole("textbox", { name: "新しい質問", exact: true })
      .fill("追加した回答");
    await card.getByRole("textbox", { name: "新しい質問", exact: true }).blur();
    await expect(card).toContainText("入力は保存済みです。");
    await expect(card.locator(".answer-inline-status")).toContainText("✓");
    await expect(card).not.toContainText(
      "名前・メールアドレスと入力内容はホストが確認できます。",
    );
    await hostCard.locator("header h3").click();
    await page
      .getByRole("spinbutton", { name: "フォームの文字の大きさ" })
      .fill("24");
    await page.getByRole("button", { name: "スライド上で文章を編集" }).click();
    await hostCard
      .getByRole("textbox", { name: "ワークシートのタイトルを編集" })
      .fill("編集したワークシート");
    await page.getByRole("button", { name: "文章の変更を保存" }).click();
    await expect(hostCard).toContainText("編集したワークシート");
    await expect(card).toContainText("編集したワークシート", {
      timeout: 15000,
    });
    await expect(
      card.getByRole("textbox", { name: "選んだ理由", exact: true }),
    ).toHaveValue(answer);
    await hostCard.locator("header h3").click();
    await page.getByRole("button", { name: "スライド上で文章を編集" }).click();
    await hostCard
      .getByRole("textbox", { name: "ワークシートのタイトルを編集" })
      .fill("朝食の理由と工夫");
    await page.getByRole("button", { name: "文章の変更を保存" }).click();
    await expect(hostCard).toContainText("朝食の理由と工夫");
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
    await presented.locator("textarea,input").first().blur();
    await expect(presented).toContainText("入力は保存済みです。");
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
    await followed.locator("textarea,input").first().blur();
    await expect(followed).toContainText("入力は保存済みです。");
    const fixedPage = await guest
      .locator(".host-follow-page")
      .getAttribute("data-follow-page");
    await page.getByRole("button", { name: "ゲストの画面を固定" }).click();
    await expect(guest.locator(".host-follow-overlay")).toContainText(
      "スライドを固定表示中",
    );
    await page.getByRole("button", { name: "発表する", exact: true }).click();
    await page.keyboard.press("ArrowRight");
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      fixedPage!,
    );
    const fixedInput = followed.getByRole("textbox", {
      name: "選んだ理由",
      exact: true,
    });
    await fixedInput.fill(answer + "追記");
    await fixedInput.blur();
    await expect(followed).toContainText("入力は保存済みです。");
    await fixedInput.fill(answer);
    await fixedInput.blur();
    await expect(followed).toContainText("入力は保存済みです。");
    await page.mouse.move(10, 10);
    await page.getByRole("button", { name: "画面の同期を再開" }).click();
    await expect(guest.locator(".host-follow-page")).not.toHaveAttribute(
      "data-follow-page",
      fixedPage!,
    );
    await page.mouse.move(10, 10);
    await page
      .getByRole("button", { name: "発表をおわる", exact: true })
      .click();
    await page
      .getByRole("button", { name: "全員の画面を同期", exact: true })
      .click();
    await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
    await openWorksheets(page);
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
    expect(csv).toContain("追加した回答");
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
    await openWorksheets(page);
    await page.getByRole("button", { name: "新しいワークシート" }).click();
    await page
      .getByRole("combobox", { name: "ワークシートのひな形" })
      .selectOption("check");
    await page.getByRole("button", { name: "下書きを作成" }).click();
    await expect(modal(page)).toContainText("保存しました");
    await page.getByRole("button", { name: "受付を開始", exact: true }).click();
    await openWorksheets(guest);
    await modal(guest)
      .getByRole("button", { name: /食生活セルフチェック/ })
      .click();
    await modal(guest)
      .getByRole("checkbox", { name: "朝食をほぼ毎日食べている", exact: true })
      .check();
    await expect(modal(guest).locator(".worksheet-score")).toContainText(
      "1 / 10",
    );
    await modal(guest).locator("textarea,input").first().blur();
    await expect(modal(guest)).toContainText("入力は保存済みです。");
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
  await openWorksheets(page);
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
  await openWorksheets(page);
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
  await openWorksheets(page);
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
  // This static result fixture remains the two supplied respondents.
  await expect(results).toContainText("student-a@example.test");
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

test("survey and worksheet share one wide dialog, select defaults and preserve drafts across accessible tabs", async ({
  page,
}, info) => {
  await signIn(page, "activity-host");
  const headers = { Origin: "http://127.0.0.1:3187" };
  const created = await page.request.post("/api/decks", {
    headers,
    data: sample(),
  });
  const { id } = await created.json();
  expect(
    (
      await page.request.post(`/api/decks/${id}/surveys`, {
        headers,
        data: { question: "授業で分かったこと", kind: "text" },
      })
    ).status(),
  ).toBe(200);
  const { worksheetTemplate } = await import("../../src/worksheetTemplates");
  expect(
    (
      await page.request.post(`/api/decks/${id}/worksheets`, {
        headers,
        data: worksheetTemplate("reason"),
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(`/api/decks/${id}/worksheets`, {
        headers,
        data: { ...worksheetTemplate("blank"), title: "別のワークシート" },
      })
    ).status(),
  ).toBe(200);
  const sheets = (
    await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
  ).worksheets;
  const reasonToOpen = sheets.find((s: any) => s.title !== "別のワークシート");
  expect(
    (
      await page.request.post(
        `/api/decks/${id}/worksheets/${reasonToOpen.id}/status`,
        { headers, data: { status: "open" } },
      )
    ).status(),
  ).toBe(200);
  // Open first, before selecting any list item.
  await page.goto(`/?room=${id}`);
  await expect(page.locator(".slide-card")).toHaveCount(5);
  await openWorksheets(page);
  const window = page.locator(".activity-panel");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const dialogId = await window.getAttribute("id");
  await expect(
    window.getByRole("tab", { name: "ワークシート", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const worksheetPane = window.getByRole("tabpanel", {
    name: "ワークシート",
    exact: true,
  });
  await expect(worksheetPane.locator(".survey-item.active")).toContainText(
    sheets[0].title,
  );
  const reason = sheets.find((s: any) => s.title !== "別のワークシート");
  await worksheetPane
    .locator("aside")
    .getByRole("button", {
      name: new RegExp(reason.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    })
    .click();
  await window.getByRole("button", { name: "自分で入力", exact: true }).click();
  // This draft is deliberately not sent to the server.
  const input = window.getByRole("textbox", {
    name: "選んだ理由",
    exact: true,
  });
  await input.fill("まだ保存していない自分の考え");
  const width = (await window.boundingBox())!.width;
  await window.getByRole("tab", { name: "アンケート", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(await window.getAttribute("id")).toBe(dialogId);
  expect((await window.boundingBox())!.width).toBe(width);
  const surveyPane = window.getByRole("tabpanel", {
    name: "アンケート",
    exact: true,
  });
  await expect(surveyPane.locator(".survey-item.active")).toContainText(
    "授業で分かったこと",
  );
  await window
    .getByRole("button", { name: "新しいアンケート", exact: true })
    .click();
  await window
    .getByRole("textbox", { name: "アンケートの質問", exact: true })
    .fill("作成途中のアンケート");
  await window.getByRole("tab", { name: "ワークシート", exact: true }).click();
  await expect(worksheetPane.locator(".survey-item.active")).toContainText(
    reason.title,
  );
  await expect(input).toHaveValue("まだ保存していない自分の考え");
  await window.getByRole("tab", { name: "アンケート", exact: true }).click();
  await expect(
    window.getByRole("textbox", { name: "アンケートの質問", exact: true }),
  ).toHaveValue("作成途中のアンケート");
  const surveyTab = window.getByRole("tab", {
    name: "アンケート",
    exact: true,
  });
  await surveyTab.focus();
  await page.keyboard.press("End");
  await expect(
    window.getByRole("tab", { name: "回答スライド", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(
    window.getByRole("tab", { name: "回答欄を追加", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(
    window.getByRole("tab", { name: "ワークシート", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(surveyTab).toHaveAttribute("aria-selected", "true");
  await expect(surveyTab).toHaveCSS("background-color", "rgb(54, 93, 80)");
  await page.screenshot({
    path: info.outputPath("unified-activities.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(launcher(page)).toBeFocused();
  await openWorksheets(page);
  await expect(worksheetPane.locator(".survey-item.active")).toContainText(
    reason.title,
  );
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

test("sections can be added and renamed independently while retaining existing answers", async ({
  page,
}) => {
  await signIn(page, "sections-host");
  const headers = { Origin: "http://127.0.0.1:3187" };
  const created = await page.request.post("/api/decks", {
    headers,
    data: sample(),
  });
  const { id } = await created.json();
  const definition = worksheetTemplate("reason");
  const made = await page.request.post(`/api/decks/${id}/worksheets`, {
    headers,
    data: definition,
  });
  expect(made.status()).toBe(200);
  const worksheet = (await made.json()).worksheets[0];
  expect(
    (
      await page.request.post(
        `/api/decks/${id}/worksheets/${worksheet.id}/status`,
        { headers, data: { status: "open" } },
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(
        `/api/decks/${id}/worksheets/${worksheet.id}/answer`,
        {
          headers,
          data: {
            values: { [definition.fields[0].id]: "元の回答" },
            patch: true,
          },
        },
      )
    ).status(),
  ).toBe(200);
  await page.goto(`/?room=${id}`);
  await openWorksheets(page);
  await page.getByRole("button", { name: "設定・内容の確認" }).click();
  await page.getByRole("button", { name: "項目を編集・追加" }).click();
  await page.getByLabel("セクション1の見出し").fill("改めた見出し");
  await page
    .getByRole("button", { name: "セクションを追加", exact: true })
    .click();
  await page.getByLabel("セクション3の見出し").fill("新しいまとまり");
  await page.getByRole("button", { name: "セクション3に入力欄を追加" }).click();
  await page
    .getByRole("textbox", { name: "項目名4", exact: true })
    .fill("新しい質問");
  await page
    .getByRole("button", { name: "セクションを追加", exact: true })
    .click();
  await page.getByLabel("セクション4の見出し").fill("後で作成するセクション");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(modal(page)).toContainText("保存しました。");
  const saved = (
    await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
  ).worksheets[0];
  expect(saved.sections.map((s: { title: string }) => s.title)).toEqual([
    "改めた見出し",
    "話し合い",
    "新しいまとまり",
    "後で作成するセクション",
  ]);
  expect(saved.fields[0].id).toBe(definition.fields[0].id);
  expect(saved.own.values[definition.fields[0].id]).toBe("元の回答");
  await page.getByRole("button", { name: "項目を編集・追加" }).click();
  await expect(page.getByLabel("セクション3の見出し")).toHaveValue(
    "新しいまとまり",
  );
  await expect(page.getByLabel("セクション4の見出し")).toHaveValue(
    "後で作成するセクション",
  );
  await expect(
    page.getByRole("textbox", { name: "項目名4", exact: true }),
  ).toHaveValue("新しい質問");
  await expect(
    page.getByRole("combobox", { name: "入力欄1の移動先セクション" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "入力欄1のセクションを移動" }).click();
  await page
    .getByRole("combobox", { name: "入力欄1の移動先セクション" })
    .selectOption({ label: "セクション 4：後で作成するセクション" });
  await expect(
    page
      .getByRole("region", { name: "セクション4" })
      .getByRole("textbox", { name: "項目名4" }),
  ).toHaveValue(definition.fields[0].label);
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(modal(page)).toContainText("保存しました。");
  const moved = (
    await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
  ).worksheets[0];
  expect(
    moved.fields.find((f: { id: string }) => f.id === definition.fields[0].id),
  ).toMatchObject({
    sectionId: moved.sections[3].id,
    section: "後で作成するセクション",
  });
  expect(moved.own.values[definition.fields[0].id]).toBe("元の回答");
  await page.getByRole("button", { name: "項目を編集・追加" }).click();
  const section4 = page.getByRole("region", { name: "セクション4" });
  const addBox = await section4
    .getByRole("button", { name: "セクション4に入力欄を追加" })
    .boundingBox();
  const mergeBox = await section4
    .getByRole("button", { name: "セクション4を統合" })
    .boundingBox();
  const deleteBox = await section4
    .getByRole("button", { name: "空のセクションを削除" })
    .boundingBox();
  expect(Math.abs(addBox!.y - mergeBox!.y)).toBeLessThan(1);
  expect(Math.abs(addBox!.height - deleteBox!.height)).toBeLessThan(1);
  await section4.getByRole("button", { name: "セクション4を上へ移動" }).click();
  await expect(page.getByLabel("セクション3の見出し")).toHaveValue(
    "後で作成するセクション",
  );
  await page.getByRole("button", { name: "セクション3を統合" }).click();
  await page
    .getByRole("group", { name: "セクション3の統合先" })
    .getByRole("button", { name: "上のセクションと統合" })
    .click();
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(modal(page)).toContainText("保存しました。");
  const merged = (
    await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
  ).worksheets[0];
  expect(merged.sections.map((s: { title: string }) => s.title)).toEqual([
    "改めた見出し",
    "話し合い",
    "新しいまとまり",
  ]);
  expect(
    merged.fields.find((f: { id: string }) => f.id === definition.fields[0].id),
  ).toMatchObject({ sectionId: merged.sections[1].id, section: "話し合い" });
  expect(merged.own.values[definition.fields[0].id]).toBe("元の回答");
});

test("check counts stay inside their own sections in normal and custom layouts", async ({
  page,
}) => {
  await signIn(page, "section-scores-host");
  const headers = { Origin: "http://127.0.0.1:3187" };
  const { id } = await (
    await page.request.post("/api/decks", { headers, data: sample() })
  ).json();
  const template = worksheetTemplate("check");
  const sections = [
    { id: "first", title: "朝のチェック" },
    { id: "second", title: "夜のチェック" },
    { id: "notes", title: "ふり返り" },
  ];
  const fields = template.fields.slice(0, 4).map((f, index) => ({
    ...f,
    label: `確認${index + 1}`,
    sectionId: index < 2 ? "first" : "second",
    section: index < 2 ? sections[0].title : sections[1].title,
  }));
  fields.push({
    ...fields[0],
    id: crypto.randomUUID(),
    label: "メモ",
    kind: "text",
    sectionId: "notes",
    section: sections[2].title,
  });
  for (const custom of [false, true]) {
    const definition = {
      title: custom ? "自由配置" : "セクション別",
      description: "",
      sections,
      fields,
      ...(custom
        ? {
            modalLayout: {
              items: fields.map((f, i) => ({
                id: f.id,
                x: 0,
                y: i * 160,
                w: 1000,
                h: 150,
              })),
            },
          }
        : {}),
    };
    const created = await page.request.post(`/api/decks/${id}/worksheets`, {
      headers,
      data: definition,
    });
    expect(created.status()).toBe(200);
    const worksheet = (await created.json()).worksheets.find(
      (s: { title: string }) => s.title === definition.title,
    );
    expect(
      (
        await page.request.post(
          `/api/decks/${id}/worksheets/${worksheet.id}/status`,
          { headers, data: { status: "open" } },
        )
      ).status(),
    ).toBe(200);
  }
  await page.goto(`/?room=${id}`);
  await openWorksheets(page);
  for (const title of ["セクション別", "自由配置"]) {
    await modal(page).getByRole("button", { name: title }).click();
    await modal(page)
      .getByRole("button", { name: "自分で入力", exact: true })
      .click();
    const scores = modal(page).locator(".worksheet-score");
    await expect(scores).toHaveCount(2);
    await expect(scores.nth(0)).toContainText("0 / 2");
    await expect(scores.nth(1)).toContainText("0 / 2");
    await modal(page).getByRole("checkbox", { name: "確認1" }).check();
    await expect(scores.nth(0)).toContainText("1 / 2");
    await expect(scores.nth(1)).toContainText("0 / 2");
    await modal(page).getByRole("checkbox", { name: "確認3" }).check();
    await expect(scores.nth(0)).toContainText("1 / 2");
    await expect(scores.nth(1)).toContainText("1 / 2");
    if (title === "セクション別") {
      await expect(
        modal(page)
          .locator(".worksheet-group")
          .filter({ hasText: "朝のチェック" })
          .locator(".worksheet-score"),
      ).toContainText("1 / 2");
      await expect(
        modal(page)
          .locator(".worksheet-group")
          .filter({ hasText: "ふり返り" })
          .locator(".worksheet-score"),
      ).toHaveCount(0);
    } else {
      await expect(
        modal(page).locator(
          `[data-field-id="${fields[1].id}"] .worksheet-score`,
        ),
      ).toContainText("1 / 2");
      await expect(
        modal(page).locator(
          `[data-field-id="${fields[3].id}"] .worksheet-score`,
        ),
      ).toContainText("1 / 2");
    }
  }
});

test("students paste an image, draw, save privately, and the host views their answer", async ({
  page,
  browser,
}, info) => {
  const guestContext = await browser.newContext(info.project.use);
  const otherContext = await browser.newContext(info.project.use);
  const guest = await guestContext.newPage(),
    other = await otherContext.newPage();
  try {
    await signIn(page, "drawing-host");
    await signIn(guest, "drawing-guest");
    await signIn(other, "drawing-other");
    const headers = { Origin: "http://127.0.0.1:3187" };
    const { id } = await (
      await page.request.post("/api/decks", { headers, data: sample() })
    ).json();
    const invite = await (
      await page.request.post(`/api/decks/${id}/invite`, { headers })
    ).json();
    const token = new URL(invite.url).searchParams.get("join");
    for (const participant of [guest, other]) {
      const accepted = await (
        await participant.request.post(`/api/invites/${token}/accept`, {
          headers,
        })
      ).json();
      if (accepted.status === "pending")
        await page.request.post(`/api/decks/${id}/join-requests/approve`, {
          headers,
          data: { requestIds: [accepted.requestId] },
        });
    }
    const template = worksheetTemplate("blank");
    template.title = "描いて考えよう";
    template.fields[0].kind = "drawing";
    template.fields[0].label = "自分の絵";
    const created = await page.request.post(`/api/decks/${id}/worksheets`, {
      headers,
      data: template,
    });
    expect(created.status()).toBe(200);
    const sheet = (await created.json()).worksheets[0];
    expect(
      (
        await page.request.post(
          `/api/decks/${id}/worksheets/${sheet.id}/status`,
          { headers, data: { status: "open" } },
        )
      ).status(),
    ).toBe(200);
    await guest.goto(`/?room=${id}`);
    await openWorksheets(guest);
    await modal(guest)
      .getByRole("button", { name: "自分の絵の画像・手描きを編集" })
      .click();
    const canvas = modal(guest).getByLabel("自分の絵の手描き欄");
    await expect(canvas).toBeVisible();
    const emptyRect = (await canvas.boundingBox())!;
    await guest.mouse.move(emptyRect.x + 20, emptyRect.y + 20);
    await guest.mouse.down();
    await guest.mouse.move(emptyRect.x + 50, emptyRect.y + 50);
    await guest.mouse.up();
    await expect(
      modal(guest).getByRole("button", { name: "戻す", exact: true }),
    ).toBeEnabled();
    await modal(guest)
      .getByRole("button", { name: "戻す", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await (
              await guest.request.get(`/api/decks/${id}/worksheets`)
            ).json()
          ).worksheets[0].own?.values[template.fields[0].id],
        { timeout: 15000 },
      )
      .toBe("");
    // Paste a PNG into the focused answer area; the saved answer is a bounded JPEG.
    await canvas.focus();
    await canvas.evaluate((node) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        ),
        (c) => c.charCodeAt(0),
      );
      const data = new DataTransfer();
      data.items.add(new File([bytes], "example.png", { type: "image/png" }));
      node.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(modal(guest)).toContainText("入力は保存済みです。", {
      timeout: 15000,
    });
    let saved = (
      await (await guest.request.get(`/api/decks/${id}/worksheets`)).json()
    ).worksheets[0].own.values[template.fields[0].id] as string;
    expect(saved).toMatch(/^data:image\/jpeg;base64,/);
    const rect = (await canvas.boundingBox())!;
    await guest.mouse.move(
      rect.x + rect.width * 0.2,
      rect.y + rect.height * 0.2,
    );
    await guest.mouse.down();
    await guest.mouse.move(
      rect.x + rect.width * 0.6,
      rect.y + rect.height * 0.6,
      { steps: 8 },
    );
    await guest.mouse.up();
    await expect
      .poll(
        async () =>
          (
            await (
              await guest.request.get(`/api/decks/${id}/worksheets`)
            ).json()
          ).worksheets[0].own.values[template.fields[0].id],
        { timeout: 15000 },
      )
      .not.toBe(saved);
    saved = (
      await (await guest.request.get(`/api/decks/${id}/worksheets`)).json()
    ).worksheets[0].own.values[template.fields[0].id];
    const otherView = (
      await (await other.request.get(`/api/decks/${id}/worksheets`)).json()
    ).worksheets[0];
    expect(otherView.own).toBeUndefined();
    expect(otherView.results).toBeUndefined();
    expect(JSON.stringify(otherView)).not.toContain(saved);
    await guest.reload();
    await openWorksheets(guest);
    await modal(guest)
      .getByRole("button", { name: "自分の絵の画像・手描きを編集" })
      .click();
    await expect(modal(guest).getByLabel("自分の絵の手描き欄")).toBeVisible();
    await page.goto(`/?room=${id}`);
    await openWorksheets(page);
    await page.getByRole("button", { name: /回答結果（1人）/ }).click();
    await expect(
      modal(page).getByRole("img", { name: "自分の絵の画像・手描き回答" }),
    ).toBeVisible();
    await expect(modal(page)).toContainText("CSVには画像の有無を記録します");
    await page
      .getByRole("button", { name: "このワークシートをスライドに配置" })
      .click();
    await guest.reload();
    await guest.locator(".thumbnail").first().click();
    await guest
      .locator(".editor-workspace .slide-worksheet")
      .getByRole("button", { name: "自分の絵の画像・手描きを編集" })
      .click();
    const slideCanvas = guest
      .locator(".editor-workspace .slide-worksheet")
      .getByLabel("自分の絵の手描き欄");
    await expect(slideCanvas).toBeVisible();
    const slideRect = (await slideCanvas.boundingBox())!;
    await guest.mouse.move(
      slideRect.x + slideRect.width * 0.25,
      slideRect.y + slideRect.height * 0.25,
    );
    await guest.mouse.down();
    await guest.mouse.move(
      slideRect.x + slideRect.width * 0.5,
      slideRect.y + slideRect.height * 0.5,
      { steps: 5 },
    );
    await guest.mouse.up();
    await expect
      .poll(
        async () =>
          (
            await (
              await guest.request.get(`/api/decks/${id}/worksheets`)
            ).json()
          ).worksheets[0].own.values[template.fields[0].id],
        { timeout: 15000 },
      )
      .not.toBe(saved);
    await expect(page.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    const shared = await (await page.request.get(`/api/decks/${id}`)).json();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(shared.state));
    const slide = readSharedDeck(doc).slides.find((s) =>
      s.elements.some((e) => e.worksheet?.worksheetId === sheet.id),
    )!;
    doc.destroy();
    expect(
      (
        await page.request.post(`/api/decks/${id}/gallery/publish`, {
          headers,
          data: { slide, participants: null, names: false, live: false },
        })
      ).status(),
    ).toBe(200);
    const gallery = (
      await (await other.request.get(`/api/decks/${id}/gallery`)).json()
    ).gallery;
    expect(
      gallery.cards[0].worksheets[0].own.values[template.fields[0].id],
    ).toMatch(/^data:image\/jpeg;base64,/);
  } finally {
    await guestContext.close();
    await otherContext.close();
  }
});

test("drawing field shows its guidance until an image is added", async ({
  page,
}) => {
  await signIn(page, "drawing-guidance-host");
  const headers = { Origin: "http://127.0.0.1:3187" };
  const { id } = await (
    await page.request.post("/api/decks", { headers, data: sample() })
  ).json();
  const template = worksheetTemplate("blank");
  template.title = "染織を調べよう";
  template.fields[0].kind = "drawing";
  template.fields[0].label = "調べた染織の画像を貼り付けよう";
  template.fields[0].placeholder = "あなたが調べた染織の画像を貼り付けよう";
  const created = await page.request.post(`/api/decks/${id}/worksheets`, {
    headers,
    data: template,
  });
  expect(created.status()).toBe(200);
  const sheet = (await created.json()).worksheets[0];
  expect(
    (
      await page.request.post(
        `/api/decks/${id}/worksheets/${sheet.id}/status`,
        { headers, data: { status: "open" } },
      )
    ).status(),
  ).toBe(200);
  await page.goto(`/?room=${id}`);
  await openWorksheets(page);
  await modal(page)
    .getByRole("button", { name: "自分で入力", exact: true })
    .click();
  const view = modal(page).getByRole("button", {
    name: "調べた染織の画像を貼り付けようの画像・手描きを編集",
  });
  await expect(view).toContainText("あなたが調べた染織の画像を貼り付けよう");
  await view.click();
  const drawing = modal(page).locator(".worksheet-drawing");
  await drawing.locator('input[type="file"]').setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
        ).worksheets[0].own?.values[template.fields[0].id],
      { timeout: 15000 },
    )
    .toMatch(/^data:image\/jpeg;base64,/);
  await drawing
    .getByRole("button", { name: "完了", exact: true })
    .click();
  await expect(view.locator("img")).toBeVisible();
  await expect(view).not.toContainText(
    "あなたが調べた染織の画像を貼り付けよう",
  );
});

test("host edits worksheet items from the right sidebar", async ({ page }) => {
  await signIn(page, "sidebar-editor-host");
  const headers = { Origin: "http://127.0.0.1:3187" };
  const { id } = await (
    await page.request.post("/api/decks", { headers, data: sample() })
  ).json();
  const template = worksheetTemplate("blank");
  template.title = "サイドバー編集の確認";
  template.fields[0].label = "元の項目名";
  const created = await page.request.post(`/api/decks/${id}/worksheets`, {
    headers,
    data: template,
  });
  expect(created.status()).toBe(200);
  const sheet = (await created.json()).worksheets[0];
  expect(
    (
      await page.request.post(
        `/api/decks/${id}/worksheets/${sheet.id}/status`,
        { headers, data: { status: "open" } },
      )
    ).status(),
  ).toBe(200);
  await page.goto(`/?room=${id}`);
  await openWorksheets(page);
  await modal(page)
    .getByRole("button", { name: /サイドバー編集の確認/ })
    .click();
  await page
    .getByRole("button", { name: "このワークシートをスライドに配置" })
    .click();
  const card = page.locator(".editor-workspace .slide-worksheet");
  await expect(card).toContainText("元の項目名");
  await card.locator("header h3").click();
  const sidebar = page.locator(".form-sidebar-editor");
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByLabel("項目名1")).toHaveValue("元の項目名");
  await sidebar.getByLabel("項目名1").fill("サイドバーで直した項目名");
  await sidebar.getByRole("button", { name: "保存する" }).first().click();
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
        ).worksheets[0].fields[0].label,
      { timeout: 15000 },
    )
    .toBe("サイドバーで直した項目名");
  await expect(card).toContainText("サイドバーで直した項目名");
});
