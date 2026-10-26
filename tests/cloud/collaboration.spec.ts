import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { backupChanged } from "../../src/backupProtocol";

async function google(page: Page, identity: string) {
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (
          await page.request.get(
            `/__test/token?name=${encodeURIComponent(identity)}`,
          )
        ).text()
      : identity;
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.google={accounts:{id:{initialize(options){this.callback=options.callback},renderButton(element){const button=document.createElement('button');button.textContent='Googleでサインイン（テスト）';button.onclick=()=>this.callback({credential:${JSON.stringify(credential)}});element.appendChild(button)}}}};`,
    }),
  );
}
async function signIn(
  page: Page,
  identity: string,
  invite?: string,
  hostPage?: Page,
) {
  await google(page, identity);
  await page.goto(invite || "/");
  if (!invite)
    await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await page
    .getByRole("button", { name: "Googleでサインイン（テスト）", exact: true })
    .click();
  if (!invite) await expect(page.getByRole("dialog")).toContainText(identity);
  if (invite?.includes("join=") && hostPage) {
    await expect
      .poll(
        () =>
          new URL(page.url()).searchParams.get("request") ||
          new URL(page.url()).searchParams.get("room"),
      )
      .toMatch(/^[a-f0-9-]{36}$/);
    if (!new URL(page.url()).searchParams.has("request")) return;
    const work = new URL(hostPage.url()).searchParams.get("room"),
      requestId = new URL(page.url()).searchParams.get("request");
    const r = await hostPage.request.post(
      `/api/decks/${work}/join-requests/approve`,
      {
        headers: { Origin: "http://127.0.0.1:3187" },
        data: { requestIds: [requestId] },
      },
    );
    expect(r.status()).toBe(200);
    await page
      .getByRole("button", { name: "承認状況を確認", exact: true })
      .click();
  }
}
async function openEditor(page: Page) {
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
}
async function saved(page: Page) {
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
}

test("recovers unsent text from this browser after reopening the app", async ({
  page,
}, info) => {
  await signIn(
    page,
    info.project.name === "cloud-touch" ? "touch-recovery" : "desktop-recovery",
  );
  await page
    .getByRole("button", { name: "この作品をクラウドに保存", exact: true })
    .click();
  await saved(page);
  const url = page.url();
  await openEditor(page);
  const layout = (await page.locator(".editor-layout").boundingBox())!;
  expect(layout.y).toBeLessThanOrEqual(104);
  await page.locator(".editor-workspace .element").first().click();
  const text = page.getByRole("textbox", {
    name: "スライド内の文字",
    exact: true,
  });
  await expect(text).toBeFocused();
  await page.context().setOffline(true);
  await expect(page.locator(".cloud-presence")).toContainText("再接続中");
  await text.press("End");
  await page.keyboard.type(" recover-me");
  await expect(text).toContainText("recover-me");
  if (info.project.name === "cloud-touch") {
    // Leaving a Quill editor by swiping must keep its unsent Yjs text.
    const canvas = (await page
      .locator(".editor-workspace .slide-canvas")
      .boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    for (const dx of [-85, 85]) {
      const target = dx < 0 ? (await text.boundingBox())! : canvas;
      const start = {
        id: 1,
        x: target.x + target.width * (dx < 0 ? 0.7 : 0.95),
        y: target.y + target.height * (dx < 0 ? 0.5 : 0.8),
      };
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [start],
      });
      for (let step = 1; step <= 6; step++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ ...start, x: start.x + (dx * step) / 6 }],
        });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(
        page.getByRole("textbox", { name: "ページの名前", exact: true }),
      ).toHaveValue(dx < 0 ? "自然がいっぱい" : "わたしたちのまち");
    }
    await page.locator(".editor-workspace .element").first().click();
    await expect(text).toContainText("recover-me");
    // Pinching over an active Quill textbox must also preserve unsent Yjs text.
    const box = (await page.locator(".editor-pager").boundingBox())!;
    const textBox = (await text.boundingBox())!;
    const cx = textBox.x + textBox.width / 2;
    const cy = textBox.y + textBox.height / 2;
    const radius = Math.min(45, textBox.width * 0.35, box.width * 0.2);
    for (const [type, spread] of [
      ["touchStart", radius],
      ["touchMove", radius * 0.5],
      ["touchEnd", 0],
    ] as const) {
      await cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: spread
          ? [
              { id: 1, x: cx - spread, y: cy },
              { id: 2, x: cx + spread, y: cy },
            ]
          : [],
      });
    }
    await expect(page.locator(".map-scroll")).toBeVisible();
    await page
      .getByRole("button", { name: "ページを編集", exact: true })
      .click();
    await page.locator(".editor-workspace .element").first().click();
    await expect(text).toContainText("recover-me");
  }
  // Let the browser's durable transaction complete, then leave without reconnecting.
  await page.waitForTimeout(300);
  await page.goto("about:blank");
  await page.context().setOffline(false);
  await page.goto(url);
  await saved(page);
  await openEditor(page);
  await expect(page.locator(".editor-workspace")).toContainText("recover-me");
});

test("two users sign in, join by invitation, edit the same text, reconnect, and export photos", async ({
  page,
  browser,
}, info) => {
  const name =
    info.project.name === "cloud-touch" ? "touch-owner" : "desktop-owner";
  await signIn(page, name);
  await page
    .getByRole("button", { name: "この作品をクラウドに保存", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await saved(page);
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await page
    .getByRole("button", { name: "共同編集の招待リンクを作る", exact: true })
    .click();
  const invitation = await page
    .getByRole("textbox", { name: "共同編集の招待リンク", exact: true })
    .inputValue();
  await page
    .getByRole("button", { name: "クラウドの作品を閉じる", exact: true })
    .click();
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3187",
    viewport: { width: 1440, height: 1000 },
  });
  const other = await context.newPage();
  try {
    await signIn(other, `${name}-friend`, invitation, page);
    await saved(other);
    await page.evaluate(async (user) => {
      const room = new URL(location.href).searchParams.get("room");
      const response = await fetch(
        `/api/decks/${room}/members/${encodeURIComponent(user)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "all",
            comment: true,
            rows: [],
            columns: [],
            slides: [],
          }),
        },
      );
      if (!response.ok) throw new Error(await response.text());
    }, `${name}-friend`);
    await expect(page.locator(".cloud-presence")).toContainText("2人が参加中");
    await openEditor(page);
    await openEditor(other);
    await page.locator(".editor-workspace .element").first().click();
    await other.locator(".editor-workspace .element").first().click();
    const a = page.getByRole("textbox", {
      name: "スライド内の文字",
      exact: true,
    });
    const b = other.getByRole("textbox", {
      name: "スライド内の文字",
      exact: true,
    });
    await expect(a).toBeFocused();
    await expect(b).toBeFocused();
    await Promise.all([
      a.press("Home").then(() => page.keyboard.insertText("Alice ")),
      b.press("Home").then(() => other.keyboard.insertText("Bob ")),
    ]);
    await expect(a).toContainText("Alice");
    await expect(a).toContainText("Bob");
    await expect(b).toContainText("Alice");
    await expect(b).toContainText("Bob");
    await saved(page);
    await saved(other);
    // Each browser must undo/redo only its own Quill input, even in the same box.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
    for (const user of [page, other]) {
      await expect(user.locator(".editor-workspace")).not.toContainText(
        "Alice",
      );
      await expect(user.locator(".editor-workspace")).toContainText("Bob");
    }
    await expect(
      page.getByRole("button", { name: "もとに戻す", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "やり直す", exact: true }).click();
    await expect(other.locator(".editor-workspace")).toContainText("Alice");
    await other.keyboard.press("Escape");
    await other
      .getByRole("button", { name: "もとに戻す", exact: true })
      .click();
    for (const user of [page, other]) {
      await expect(user.locator(".editor-workspace")).toContainText("Alice");
      await expect(user.locator(".editor-workspace")).not.toContainText("Bob");
    }
    await expect(
      other.getByRole("button", { name: "もとに戻す", exact: true }),
    ).toBeDisabled();
    await other.getByRole("button", { name: "やり直す", exact: true }).click();
    await expect(page.locator(".editor-workspace")).toContainText("Bob");
    await saved(page);
    await saved(other);
    await page.locator(".editor-workspace .element").first().click();
    await other.locator(".editor-workspace .element").first().click();
    await page.context().setOffline(true);
    await expect(page.locator(".cloud-presence")).toContainText("再接続中");
    await a.press("End");
    await page.keyboard.type(" offline");
    await b.press("End");
    await other.keyboard.type(" online");
    await page.context().setOffline(false);
    await saved(page);
    await expect(a).toContainText("online");
    await expect(b).toContainText("offline");
    await page.keyboard.press("Escape");
    // Alignment is element formatting, shared with an active Quill editor.
    await page
      .getByRole("button", { name: "文字を右揃え", exact: true })
      .click();
    await page
      .getByRole("button", { name: "文字を下揃え", exact: true })
      .click();
    for (const user of [page, other]) {
      const layout = user
        .locator(".editor-workspace .element")
        .first()
        .locator(".text-layout");
      await expect(layout).toHaveCSS("text-align", "right");
      await expect(layout).toHaveAttribute("data-vertical-align", "bottom");
    }
    await expect(b).toHaveCSS("text-align", "right");
    await expect(b.locator("p")).toHaveCSS("text-align", "right");
    await expect(b).toBeFocused();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
      "base64",
    );
    await page
      .locator('input[type="file"]')
      .nth(1)
      .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    await expect(
      other.locator(".editor-workspace img.slide-image"),
    ).toHaveCount(1);
    await saved(page);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "ファイルに保存", exact: true }).click();
    const file = await download,
      exported = JSON.parse(await readFile((await file.path())!, "utf8"));
    expect(exported.slides[0].elements[0]).toMatchObject({
      textAlign: "right",
      verticalAlign: "bottom",
    });
    expect(
      exported.slides
        .flatMap((s: any) => s.elements)
        .find((e: any) => e.type === "image").src,
    ).toMatch(/^data:image\/png;base64,/);
    await other.reload();
    await saved(other);
    await openEditor(other);
    await expect(
      other
        .locator(".editor-workspace .element")
        .first()
        .locator(".text-layout"),
    ).toHaveAttribute("data-vertical-align", "bottom");
    await expect(other.locator(".editor-workspace")).toContainText("offline");
    await expect(
      other.locator(".editor-workspace img.slide-image"),
    ).toHaveCount(1);
    // The selected sheet is personal, while its content and tab order are shared.
    await page
      .getByRole("button", { name: "空のシートを追加", exact: true })
      .click();
    await expect(other.getByRole("tab")).toHaveCount(2);
    await expect(
      other.getByRole("tab", { name: "シート1", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "文字", exact: true }).click();
    const sheetText = page.getByRole("textbox", {
      name: "スライド内の文字",
      exact: true,
    });
    await sheetText.fill("別シートの共同編集");
    await sheetText.press("Escape");
    await other.getByRole("tab", { name: "シート2", exact: true }).click();
    await expect(other.locator(".editor-workspace")).toContainText(
      "別シートの共同編集",
    );
    await other.getByRole("tab", { name: "シート1", exact: true }).click();
    await expect(other.locator(".editor-workspace")).toContainText("offline");
    await page
      .getByRole("button", { name: "シートの操作", exact: true })
      .click();
    await page
      .getByRole("button", { name: "シートを左へ移動", exact: true })
      .click();
    await page.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect
      .poll(() => other.getByRole("tab").allTextContents())
      .toEqual(["シート2", "シート1"]);
    await other.reload();
    await saved(other);
    await expect(
      other.getByRole("tab", { name: "シート1", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    // Filtering is personal and must never trim the shared document or export.
    await page.getByRole("tab", { name: "シート1", exact: true }).click();
    await page
      .getByRole("button", { name: "全体マップへ", exact: true })
      .click();
    await page
      .getByRole("button", { name: "マップをフィルタ", exact: true })
      .click();
    await page
      .getByRole("button", { name: "フィルタする列2", exact: true })
      .click();
    await page
      .getByRole("button", { name: "フィルタを適用", exact: true })
      .click();
    await expect(page.locator(".slide-card")).toHaveCount(2);
    await expect(other.locator(".slide-card")).toHaveCount(5);
    await page
      .getByRole("button", { name: "自然がいっぱいを編集", exact: true })
      .click();
    await page
      .getByRole("button", { name: "1段目の横のページをひらく", exact: true })
      .click();
    await expect(page.locator(".row-page")).toHaveCount(1);
    await page
      .getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true })
      .click();
    await page.getByRole("button", { name: "文字", exact: true }).click();
    const filteredInput = page.getByRole("textbox", {
      name: "スライド内の文字",
      exact: true,
    });
    await filteredInput.fill("フィルタ内の共同編集");
    await filteredInput.press("Escape");
    await other
      .getByRole("button", { name: "自然がいっぱいを編集", exact: true })
      .click();
    await expect(other.locator(".editor-workspace")).toContainText(
      "フィルタ内の共同編集",
    );
    const fullDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "ファイルに保存", exact: true }).click();
    const fullFile = await fullDownload,
      fullExport = JSON.parse(await readFile((await fullFile.path())!, "utf8"));
    expect(fullExport.slides).toHaveLength(6);
    expect(fullExport.sheets).toHaveLength(2);
    await page.getByRole("button", { name: "クラウド", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: `${name}-friendの参加を解除`,
        exact: true,
      }),
    ).toBeVisible();
    expect(await page.evaluate(() => innerWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    await page
      .getByRole("button", { name: `${name}-friendの参加を解除`, exact: true })
      .click();
    await expect(other.locator(".cloud-presence")).toContainText("共有停止");
    await page.screenshot({ path: info.outputPath("cloud-sharing.png") });
  } finally {
    await context.close();
  }
});

test("host selects editing scopes visually, guests stay read-only elsewhere and exchange persistent sticky comments", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90000);
  const owner = `permissions-${info.project.name}`,
    guest = `${owner}-guest`;
  const button = (p: Page, name: string) =>
    p.getByRole("button", { name, exact: true });
  await signIn(page, owner);
  await button(page, "この作品をクラウドに保存").click();
  await saved(page);
  await button(page, "クラウド").click();
  await button(page, "共同編集の招待リンクを作る").click();
  const invite = await page
    .getByRole("textbox", { name: "共同編集の招待リンク", exact: true })
    .inputValue();
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3187",
    viewport: { width: 1440, height: 1000 },
  });
  const other = await context.newPage();
  try {
    await signIn(other, guest, invite, page);
    await saved(other);
    await openEditor(other);
    await expect(
      other.getByRole("textbox", { name: "ページの名前", exact: true }),
    ).toHaveAttribute("readonly", "");
    await expect(button(other, "文字")).toBeDisabled();
    await expect(button(other, "空のシートを追加")).toBeDisabled();
    await button(other, "付箋を追加").click();
    const sticky = other.getByRole("textbox", {
      name: "付箋のコメント",
      exact: true,
    });
    await expect(sticky).toBeFocused();
    await sticky.fill("ここをもっと説明してほしいです");
    await expect(other.locator(".sticky-note")).toContainText("保存済み");
    await button(other, "付箋の色とサイズ").click();
    await button(other, "ピンクの付箋").click();
    await button(other, "付箋のサイズ：大").click();
    await expect(other.locator(".sticky-note")).toHaveCSS(
      "background-color",
      "rgb(255, 217, 227)",
    );
    await expect(other.locator(".sticky-note")).toContainText("保存済み");

    await expect(
      other.getByRole("button", { name: "付箋を投稿", exact: true }),
    ).toHaveCount(0);
    await button(page, "参加者一覧を更新").click();
    await button(page, `${guest}の編集権限を設定`).click();
    await page
      .getByRole("combobox", { name: "編集の権限", exact: true })
      .selectOption("scoped");
    await button(page, "編集を許可する行2").click();
    await button(page, "編集を許可する列3").click();
    await button(page, "編集を許可するスライド1.1 わたしたちのまち").click();
    await page.screenshot({ path: info.outputPath("permissions.png") });
    await button(page, "権限を保存").click();
    await expect(button(other, "文字")).toBeEnabled();
    await button(page, "クラウドの作品を閉じる").click();
    await openEditor(page);
    await expect(page.locator(".sticky-note textarea")).toHaveValue(
      "ここをもっと説明してほしいです",
    );
    await expect(page.locator(".sticky-note")).toHaveCSS(
      "background-color",
      "rgb(255, 217, 227)",
    );
    await page.screenshot({ path: info.outputPath("comments.png") });
    await other.locator(".editor-workspace .element").first().click();
    const text = other.getByRole("textbox", {
      name: "スライド内の文字",
      exact: true,
    });
    await expect(text).toBeFocused();
    await text.press("Home");
    await other.keyboard.type("guest edit ");
    await saved(other);
    await expect(page.locator(".editor-workspace")).toContainText("guest edit");
    await other.keyboard.press("Escape");
    await button(other, "1段目の横のページをひらく").click();
    await button(other, "1.2 自然がいっぱいを編集").click();
    await expect(button(other, "文字")).toBeDisabled();
    await expect(
      other.getByRole("textbox", { name: "ページの名前", exact: true }),
    ).toHaveAttribute("readonly", "");
    await button(other, "横のページ一覧を閉じる").click();
    await button(page, "クラウド").click();
    await button(page, `${guest}の編集権限を設定`).click();
    await page
      .getByRole("combobox", { name: "編集の権限", exact: true })
      .selectOption("none");
    await page
      .getByRole("checkbox", { name: "付箋コメントを許可", exact: true })
      .uncheck();
    await button(page, "権限を保存").click();
    await expect(button(other, "付箋を追加")).toBeDisabled();
    await other.reload();
    await saved(other);
    await openEditor(other);
    await expect(button(other, "文字")).toBeDisabled();
    await expect(other.locator(".sticky-note textarea")).toHaveValue(
      "ここをもっと説明してほしいです",
    );
  } finally {
    await context.close();
  }
});

test("pasted accounts receive ordered rows before joining, open without an invite, and retain assignments through invite entry", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90000);
  const owner = `roster-${info.project.name}`,
    a = `${owner}-a`,
    b = `${owner}-b`;
  const button = (p: Page, name: string) =>
    p.getByRole("button", { name, exact: true });
  await signIn(page, owner);
  await button(page, "この作品をクラウドに保存").click();
  await saved(page);
  await button(page, "クラウド").click();
  await button(page, "共同編集の招待リンクを作る").click();
  const invite = await page
    .getByRole("textbox", { name: "共同編集の招待リンク", exact: true })
    .inputValue();
  await button(page, "共有するアカウントを追加").click();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copiedLink: string }).copiedLink = text;
        },
      },
    }),
  );
  await button(page, "作品リンクをコピー").click();
  await expect(page.locator(".cloud-copy-feedback").first()).toHaveText(
    "コピーしました",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { copiedLink: string }).copiedLink,
    ),
  ).toContain("/?room=");

  const paste = page.getByRole("textbox", {
    name: "事前共有するメールアドレス",
    exact: true,
  });
  await paste.fill(
    `${a.toUpperCase()}@EXAMPLE.TEST,\n児童B <${b}@example.test>\n${a}@example.test`,
  );
  const preview = page.getByRole("region", {
    name: "事前共有のプレビュー",
    exact: true,
  });
  await expect(preview.locator("li")).toHaveCount(2);
  await expect(preview.locator("li").nth(0)).toContainText("1行目");
  await expect(preview.locator("li").nth(1)).toContainText("2行目");
  await page
    .getByRole("combobox", { name: "割り当てを開始する行", exact: true })
    .selectOption("99");
  await expect(page.locator(".pre-sharing [role=alert]")).toContainText(
    "100行を超えます",
  );
  await expect(button(page, "事前共有を保存")).toBeDisabled();
  await page
    .getByRole("combobox", { name: "割り当てを開始する行", exact: true })
    .selectOption("0");
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("pre-sharing-preview.png") });
  await button(page, "事前共有を保存").click();
  await expect(page.locator(".pre-share-account")).toHaveCount(2);
  await expect(paste).toHaveValue("");
  await page.reload();
  await saved(page);
  await button(page, "クラウド").click();
  await button(page, "共有するアカウントを追加").click();
  await expect(page.locator(".pre-share-account")).toHaveCount(2);
  await expect(
    page.getByRole("combobox", { name: "割り当てを開始する行", exact: true }),
  ).toHaveValue("2");
  const ca = await browser.newContext({
      baseURL: "http://127.0.0.1:3187",
      viewport: { width: 1440, height: 1000 },
    }),
    cb = await browser.newContext({
      baseURL: "http://127.0.0.1:3187",
      viewport: { width: 1440, height: 1000 },
    });
  const pa = await ca.newPage(),
    pb = await cb.newPage();
  try {
    await signIn(pa, a);
    await button(pa, "作品を開く：わたしたちのまちの、いいところ").click();
    await saved(pa);
    await openEditor(pa);
    await expect(button(pa, "文字")).toBeEnabled();
    await expect(button(pa, "空のシートを追加")).toBeDisabled();
    await pa.locator(".editor-workspace .element").first().click();
    const text = pa.getByRole("textbox", {
      name: "スライド内の文字",
      exact: true,
    });
    await text.press("Home");
    await pa.keyboard.type("assigned ");
    await saved(pa);
    await pa.keyboard.press("Escape");
    await signIn(pb, b, invite, page);
    await saved(pb);
    await openEditor(pb);
    await expect(button(pb, "文字")).toBeDisabled();
    await button(pb, "2段目の横のページをひらく").click();
    await expect(button(pb, "文字")).toBeEnabled();
    await button(page, "参加者一覧を更新").click();
    await expect(
      page
        .locator(".pre-share-account")
        .filter({ hasText: `${a}@example.test` }),
    ).toContainText("参加済み");
    await button(page, `${a}@example.testの事前編集権限を設定`).click();
    await page
      .getByRole("combobox", { name: "編集の権限", exact: true })
      .selectOption("none");
    await button(page, "事前編集権限を保存").click();
    await expect(button(pa, "文字")).toBeDisabled();
    await button(page, `${b}@example.testの事前共有を解除`).click();
    await expect(pb.locator(".cloud-presence")).toContainText("共有停止");
    await expect(page.locator(".pre-share-account")).toHaveCount(1);
  } finally {
    await ca.close();
    await cb.close();
  }
});

test("sticky cards save in place, flush on navigation, and move by mouse or touch", async ({
  page,
}, info) => {
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await signIn(page, `sticky-${info.project.name}`);
  await button("この作品をクラウドに保存").click();
  await saved(page);
  const room = new URL(page.url()).searchParams.get("room")!;
  await openEditor(page);
  await button("付箋を追加").click();
  const inputs = page.getByRole("textbox", {
    name: "付箋のコメント",
    exact: true,
  });
  await expect(inputs.first()).toBeFocused();
  // Hold a save open while the author continues typing. Both versions must
  // serialize correctly rather than a busy flag dropping the second one.
  await page.route("**/comments/*", async (route) => {
    if (route.request().method() === "PUT")
      await new Promise((resolve) => setTimeout(resolve, 350));
    await route.continue();
  });
  const firstRequest = page.waitForRequest(
    (r) => r.method() === "PUT" && r.url().includes("/comments/"),
  );
  await inputs.first().fill("最初の入力");
  await firstRequest;
  await inputs.first().fill("続けて入力した内容も保存");
  await button("付箋を追加").click();
  await expect(inputs).toHaveCount(2);
  await inputs.last().fill("画面を移る直前の入力");
  await button("全体マップへ").click();
  await expect
    .poll(async () => {
      const data = await (
        await page.request.get(`/api/decks/${room}/comments`)
      ).json();
      return data.comments.map((n: { text: string }) => n.text).sort();
    })
    .toEqual(["続けて入力した内容も保存", "画面を移る直前の入力"].sort());
  await openEditor(page);
  const note = page.locator(".sticky-note").first();
  const handle = note.getByRole("button", { name: "付箋を移動", exact: true });
  const before = (await note.boundingBox())!;
  const h = (await handle.boundingBox())!;
  const x = h.x + h.width / 2,
    y = h.y + h.height / 2;
  if (info.project.name === "cloud-touch") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x, y }],
    });
    for (let step = 1; step <= 5; step++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { id: 1, x: x - (80 * step) / 5, y: y + (35 * step) / 5 },
        ],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 80, y + 35, { steps: 5 });
    await page.mouse.up();
  }
  await expect
    .poll(async () => Math.round((await note.boundingBox())!.x))
    .toBeLessThan(Math.round(before.x - 50));
  await expect(note).toContainText("保存済み");
  const moved = (
    await (await page.request.get(`/api/decks/${room}/comments`)).json()
  ).comments;
  await page.screenshot({ path: info.outputPath("direct-sticky-notes.png") });
  await page.reload();
  await saved(page);
  await openEditor(page);
  await expect(inputs).toHaveCount(2);
  expect(
    (await (await page.request.get(`/api/decks/${room}/comments`)).json())
      .comments,
  ).toEqual(moved);
  // Bring an overlapping card to the front by focusing its text, just as
  // clicking the exposed part of a sticky does.
  await inputs.first().focus();
  await page
    .locator(".sticky-note")
    .first()
    .getByRole("button", { name: "付箋を削除", exact: true })
    .click();
  await expect(inputs).toHaveCount(1);
});

test("failed sticky autosaves keep the input and can be retried", async ({
  page,
}, info) => {
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await signIn(page, `sticky-retry-${info.project.name}`);
  await button("この作品をクラウドに保存").click();
  await saved(page);
  await openEditor(page);
  let fail = true;
  await page.route("**/comments/*", async (route) => {
    if (route.request().method() === "PUT" && fail) {
      fail = false;
      await route.abort();
    } else await route.continue();
  });
  await button("付箋を追加").click();
  const input = page.getByRole("textbox", {
    name: "付箋のコメント",
    exact: true,
  });
  await input.fill("通信が失敗しても入力を残す");
  await expect(page.locator(".sticky-error")).toBeVisible();
  await expect(input).toHaveValue("通信が失敗しても入力を残す");
  await button("再試行").click();
  await expect(page.locator(".sticky-note")).toContainText("保存済み");
  await expect(page.locator(".sticky-error")).toHaveCount(0);
  await page.reload();
  await saved(page);
  await openEditor(page);
  await expect(input).toHaveValue("通信が失敗しても入力を残す");
});

test("host edits shared map headings and row account names update vertically for guests", async ({
  page,
  browser,
}, info) => {
  const owner = `headings-${info.project.name}`,
    guest = `${owner}-guest`;
  const button = (p: Page, name: string) =>
    p.getByRole("button", { name, exact: true });
  await signIn(page, owner);
  await button(page, "この作品をクラウドに保存").click();
  await saved(page);
  await button(page, "クラウド").click();
  await button(page, "共有するアカウントを追加").click();
  await page
    .getByRole("textbox", { name: "事前共有するメールアドレス", exact: true })
    .fill(`${guest}@example.test`);
  await button(page, "事前共有を保存").click();
  await expect(page.locator(".pre-share-account")).toHaveCount(1);
  await button(page, "クラウドの作品を閉じる").click();
  const toggle = page.getByRole("switch", {
    name: "行に共有相手の名前を表示",
    exact: true,
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const heading = (p: Page, name: string) =>
    p.getByRole("textbox", { name, exact: true });
  await expect(heading(page, "行1の見出し")).toHaveValue(guest);
  await heading(page, "列2の見出し").fill("共同調査");
  await heading(page, "列2の見出し").press("Enter");
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3187",
    viewport: { width: 1366, height: 768 },
  });
  const other = await context.newPage();
  try {
    await signIn(other, guest);
    await button(other, "作品を開く：わたしたちのまちの、いいところ").click();
    await saved(other);
    await expect(heading(other, "列2の見出し")).toHaveValue("共同調査");
    await expect(heading(other, "列2の見出し")).toHaveAttribute("readonly", "");
    await expect(heading(other, "行1の見出し")).toHaveValue(guest);
    await expect(heading(other, "行1の見出し")).toHaveCSS(
      "writing-mode",
      "vertical-rl",
    );
    await expect(
      other.getByRole("switch", {
        name: "行に共有相手の名前を表示",
        exact: true,
      }),
    ).toBeDisabled();
    await heading(page, "行1の見出し").fill("1班");
    await heading(page, "行1の見出し").press("Enter");
    await expect(heading(other, "行1の見出し")).toHaveValue("1班");
    await heading(page, "行1の見出し").fill("");
    await heading(page, "行1の見出し").press("Enter");
    await expect(heading(other, "行1の見出し")).toHaveValue(guest);

    const footer = (p: Page, position: string) =>
      p.getByRole("textbox", { name: `${position}のフッター`, exact: true });
    await expect(footer(other, "1.1")).toHaveValue(guest);
    await expect(footer(other, "2.1")).toHaveAttribute("readonly", "");
    await footer(other, "1.1").fill("わたしの調査");
    await footer(other, "1.1").press("Enter");
    await expect(footer(page, "1.1")).toHaveValue("わたしの調査");
    await openEditor(other);
    const assignees = other.getByRole("group", {
      name: "このスライドの共有者",
      exact: true,
    });
    // The actual shared names stay visible even with a custom thumbnail label.
    await expect(assignees).toContainText(guest);
    await expect(assignees).not.toContainText("わたしの調査");
    await expect(other.locator(".workspace-flight")).toHaveCount(0);
    await other.screenshot({
      path: info.outputPath("editor-shared-names.png"),
    });
    await button(other, "全体マップへ").click();
    await footer(other, "1.1").fill("");
    await footer(other, "1.1").press("Enter");
    await expect(footer(page, "1.1")).toHaveValue(guest);
    // Moving the assignment changes the name's row on all clients without reloading.
    const room = new URL(page.url()).searchParams.get("room")!;
    const response = await page.request.post(`/api/decks/${room}/recipients`, {
      headers: { Origin: "http://127.0.0.1:3187" },
      data: {
        recipients: [
          {
            email: `${guest}@example.test`,
            access: {
              mode: "scoped",
              comment: true,
              rows: [{ sheetId: "main", index: 1 }],
              columns: [],
              slides: [],
            },
          },
        ],
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    await expect(heading(other, "行1の見出し")).toHaveValue("");
    await expect(heading(other, "行2の見出し")).toHaveValue(guest);
    await expect(footer(page, "2.1")).toHaveValue(guest);
    await expect(footer(other, "1.1")).toHaveAttribute("readonly", "");
    await openEditor(other);
    await expect(assignees).toHaveCount(0);
    await button(other, "2段目の横のページをひらく").click();
    await button(other, "2.1 まちを歩いてみたらを編集").click();
    await expect(assignees).toContainText(guest);
    await button(other, "全体マップへ").click();
    await page.screenshot({ path: info.outputPath("shared-row-headings.png") });
    await other.reload();
    await saved(other);
    await expect(heading(other, "行2の見出し")).toHaveValue(guest);
  } finally {
    await context.close();
  }
});

test("sticky color, presets and direct resize persist with mouse and touch", async ({
  page,
}, info) => {
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await signIn(page, `sticky-style-${info.project.name}`);
  await button("この作品をクラウドに保存").click();
  await saved(page);
  await openEditor(page);
  // Measure preset growth above the accessible 120px minimum note width.
  // Touch still uses real touch events; narrow-canvas layout is a separate concern.
  await button("右のサイドバーをたたむ").click();
  await expect
    .poll(
      async () =>
        (await page.locator(".editor-workspace .slide-canvas").boundingBox())!
          .width,
    )
    .toBeGreaterThan(450);
  await button("付箋を追加").click();
  const note = page.locator(".sticky-note");
  await page
    .getByRole("textbox", { name: "付箋のコメント", exact: true })
    .fill("色と大きさを変える");
  await expect(note).toContainText("保存済み");
  const before = (await note.boundingBox())!;
  await button("付箋の色とサイズ").click();
  await button("水色の付箋").click();
  await button("付箋のサイズ：大").click();
  await expect(note).toHaveCSS("background-color", "rgb(210, 237, 255)");
  expect((await note.boundingBox())!.width).toBeGreaterThan(before.width + 15);
  const grip = button("付箋のサイズを変更"),
    r = (await grip.boundingBox())!,
    x = r.x + r.width / 2,
    y = r.y + r.height / 2;
  const large = (await note.boundingBox())!.width;
  if (info.project.name === "cloud-touch") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x, y }],
    });
    for (let i = 1; i <= 5; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ id: 1, x: x + (45 * i) / 5, y: y + (25 * i) / 5 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 45, y + 25, { steps: 5 });
    await page.mouse.up();
  }
  await expect
    .poll(async () => (await note.boundingBox())!.width)
    .toBeGreaterThan(large + 25);
  await expect(note).toContainText("保存済み");
  const width = (await note.boundingBox())!.width;
  await page.screenshot({ path: info.outputPath("styled-sticky.png") });
  await page.reload();
  await saved(page);
  await openEditor(page);
  await expect(note).toHaveCSS("background-color", "rgb(210, 237, 255)");
  expect((await note.boundingBox())!.width).toBeCloseTo(width, 0);
  await button("付箋の色とサイズ").click();
  await button("付箋のサイズ：小").click();
  await button("付箋の色とサイズ").click();
  const palette = (await page.locator(".sticky-palette").boundingBox())!,
    canvas = (await page.locator(".editor-pager").boundingBox())!;
  expect(palette.x).toBeGreaterThanOrEqual(canvas.x - 1);
  expect(palette.x + palette.width).toBeLessThanOrEqual(
    canvas.x + canvas.width + 1,
  );
});

test("cloud workspace cards and bulk sharing support mixed accounts, row assignment and retry after partial removal", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90000);
  await page.setViewportSize(
    info.project.name === "cloud-touch"
      ? { width: 390, height: 740 }
      : { width: 1366, height: 768 },
  );
  const owner = `manager-${info.project.name}`,
    guest = `${owner}-guest`,
    a = `${owner}-a@example.test`,
    b = `${owner}-b@example.test`;
  const button = (p: Page, name: string) =>
    p.getByRole("button", { name, exact: true });
  await signIn(page, owner);
  await button(page, "この作品をクラウドに保存").click();
  await saved(page);
  await button(page, "クラウド").click();
  const dialog = page.getByRole("dialog", {
    name: "クラウドの作品",
    exact: true,
  });
  await expect(page.locator(".app-shell")).toHaveAttribute("inert", "");
  const bounds = (await dialog.boundingBox())!;
  if (info.project.name === "cloud-desktop") {
    expect(bounds.width).toBeGreaterThan(1000);
    expect(bounds.x).toBeGreaterThan(0);
  } else {
    expect(bounds.width).toBe(390);
    expect(bounds.x).toBe(0);
  }
  await page.getByRole("tab", { name: "作品一覧", exact: false }).click();
  const card = page.locator(".cloud-deck").first();
  await expect(card.locator(".cloud-deck-cta")).toHaveText("開く");
  if (info.project.name === "cloud-desktop") await card.hover();
  await page.screenshot({ path: info.outputPath("cloud-library-cards.png") });
  await page
    .getByRole("textbox", { name: "クラウドの作品を検索", exact: true })
    .fill("存在しない作品");
  await expect(page.locator(".cloud-deck")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "クラウドの作品を検索", exact: true })
    .fill("");
  await page.getByRole("tab", { name: "共有管理", exact: true }).click();
  await button(page, "共有するアカウントを追加").click();
  await page
    .getByRole("textbox", { name: "事前共有するメールアドレス", exact: true })
    .fill(`${a}\n${b}`);
  await button(page, "事前共有を保存").click();
  await expect(page.locator(".pre-share-account")).toHaveCount(2);
  await button(page, "共有するアカウントを追加").click();
  await expect(page.locator(".pre-share-account")).toHaveCount(2);
  await button(page, "共同編集の招待リンクを作る").click();
  const invite = await page
    .getByRole("textbox", { name: "共同編集の招待リンク", exact: true })
    .inputValue();
  const context = await browser.newContext({
      baseURL: "http://127.0.0.1:3187",
      viewport: { width: 1366, height: 768 },
    }),
    other = await context.newPage();
  try {
    await signIn(other, guest, invite, page);
    await saved(other);
    await openEditor(other);
    await expect(button(other, "文字")).toBeDisabled();
    await button(page, "参加者一覧を更新").click();
    await expect(page.locator(".sharing-person")).toHaveCount(3);
    const select = (email: string) =>
      page.getByRole("checkbox", { name: `${email}を選択`, exact: true });
    const guestEmail = `${guest}@example.test`;
    await select(a).check();
    await select(guestEmail).check();
    await button(page, "一括で権限を設定").click();
    await page
      .getByRole("combobox", { name: "編集の権限", exact: true })
      .selectOption("all");
    await button(page, "選択した2人に適用").click();
    await expect(page.locator(".sharing-feedback")).toContainText(
      "2件の権限を更新しました",
    );
    await expect(button(other, "文字")).toBeEnabled();
    const room = new URL(page.url()).searchParams.get("room")!;
    let recipients = (
      await (await page.request.get(`/api/decks/${room}/recipients`)).json()
    ).recipients;
    expect(recipients.find((r: any) => r.email === a).access.mode).toBe("all");
    expect(
      recipients.find((r: any) => r.email === b).access.rows[0].index,
    ).toBe(1);
    await select(a).check();
    await select(guestEmail).check();
    await button(page, "一括で権限を設定").click();
    await page
      .getByRole("combobox", { name: "一括の割り当て方法", exact: true })
      .selectOption("rows");
    await page
      .getByRole("combobox", {
        name: "一括で割り当てを開始する行",
        exact: true,
      })
      .selectOption("4");
    await button(page, "選択した2人に適用").click();
    await expect(page.locator(".sharing-feedback")).toContainText(
      "2件の権限を更新しました",
    );
    await expect(
      page.locator(".sharing-person").filter({ hasText: guestEmail }),
    ).toContainText("6行目");
    await expect(
      page.locator(".sharing-person").filter({ hasText: a }),
    ).toContainText("5行目");
    await expect(button(other, "文字")).toBeDisabled();
    await page
      .getByRole("textbox", { name: "共有アカウントを検索", exact: true })
      .fill(guestEmail);
    await page
      .getByRole("checkbox", {
        name: "表示中のアカウントをすべて選択",
        exact: true,
      })
      .check();
    await page
      .getByRole("textbox", { name: "共有アカウントを検索", exact: true })
      .fill("");
    await select(a).check();
    await page.screenshot({
      path: info.outputPath("cloud-sharing-selection.png"),
    });
    await button(page, "選択した共有を解除").click();
    await expect(
      page.getByRole("group", { name: "共有解除の確認", exact: true }),
    ).toContainText("2人");
    // Existing APIs preserve server-side authorization; simulate a dropped second request.
    await page.route(`**/api/decks/${room}/members/**`, async (route) => {
      if (route.request().method() === "DELETE")
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "接続を確認してください" }),
        });
      else await route.continue();
    });
    await button(page, "2人の共有を解除する").click();
    await expect(page.locator(".sharing-feedback")).toContainText(
      "2件中1件が完了",
    );
    await expect(select(guestEmail)).toBeChecked();
    await expect(select(a)).toHaveCount(0);
    await page.unroute(`**/api/decks/${room}/members/**`);
    await button(page, "選択した共有を解除").click();
    await button(page, "1人の共有を解除する").click();
    await expect(page.locator(".sharing-feedback")).toContainText(
      "1件の共有を解除しました",
    );
    await expect(page.locator(".sharing-person")).toHaveCount(1);
    await expect(page.locator(".sharing-person")).toContainText(b);
    await expect(other.locator(".cloud-presence")).toContainText("共有停止");
    recipients = (
      await (await page.request.get(`/api/decks/${room}/recipients`)).json()
    ).recipients;
    expect(recipients).toHaveLength(1);
    expect(recipients[0].email).toBe(b);
    expect(recipients[0].access.rows[0].index).toBe(1);
    await button(page, "クラウドの作品を閉じる").focus();
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest(".cloud-panel"),
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".app-shell")).not.toHaveAttribute("inert", "");
  } finally {
    await context.close();
  }
});

test("legacy offline row moves are kept for JSON recovery and never automatically uploaded", async ({
  page,
}, info) => {
  const { fromBase64, readSharedDeck } =
    await import("../../src/sharedDeck.ts");
  const { blank } = await import("../../src/model.ts");
  const Y = await import("yjs");
  const deck = {
    version: 1 as const,
    title: "旧版の未送信配置",
    slides: [blank(0, 0), blank(0, 1)],
  };
  await signIn(page, `legacy-layout-${info.project.name}`);
  const {
    id,
    user,
    state: originalState,
  } = await page.evaluate(async (deck) => {
    const made = await fetch("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deck),
    });
    if (!made.ok) throw new Error(await made.text());
    const work = await made.json(),
      session = await (await fetch("/api/session")).json();
    const saved = await (await fetch(`/api/decks/${work.id}`)).json();
    return {
      id: work.id as string,
      user: session.user.id as string,
      state: saved.state as string,
    };
  }, deck);
  // An offline cache must descend from the actual server document; an unrelated
  // Y.Doc with identical JSON would test arbitrary CRDT map conflicts instead.
  const legacy = new Y.Doc();
  Y.applyUpdate(legacy, fromBase64(originalState));
  const slides = legacy.getMap<import("yjs").Map<unknown>>("slides");
  slides.get(deck.slides[0].id)!.set("position", { x: 0, y: 1 });
  slides.get(deck.slides[1].id)!.set("position", { x: 0, y: 0 });
  const bytes = Array.from(Y.encodeStateAsUpdate(legacy));
  legacy.destroy();
  await page.evaluate(
    async ({ id, user, bytes }) => {
      await new Promise<void>((done, fail) => {
        const request = indexedDB.open("vhslide-cloud", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("documents");
        request.onerror = () => fail(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("documents", "readwrite");
          tx.objectStore("documents").put(
            new Uint8Array(bytes),
            `${user}/${id}`,
          );
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onerror = () => fail(tx.error);
        };
      });
    },
    { id, user, bytes },
  );
  await page.goto(`/?room=${id}`);
  await expect(page.locator(".cloud-presence")).toContainText("共有停止");
  await expect(
    page.getByText("旧版の未送信の配置変更を端末から復元しました。", {
      exact: false,
    }),
  ).toBeVisible();
  // The authoritative state is exactly the original Yjs document, not the cached move.
  const state = await page.evaluate(
    async (id) =>
      (await (await fetch(`/api/decks/${id}`)).json()).state as string,
    id,
  );
  const server = new Y.Doc();
  Y.applyUpdate(server, fromBase64(state));
  expect(
    readSharedDeck(server).slides.find((s) => s.id === deck.slides[0].id)!.y,
  ).toBe(0);
  server.destroy();
  await expect(
    page.getByRole("button", { name: "ファイルに保存", exact: true }),
  ).toBeEnabled();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "ファイルに保存", exact: true }).click();
  const file = await (await downloading).path();
  const recovered = JSON.parse(await readFile(file!, "utf8"));
  expect(
    recovered.slides.find((s: { id: string }) => s.id === deck.slides[0].id).y,
  ).toBe(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await page.getByRole("tab", { name: /作品一覧/ }).click();
  await page
    .getByRole("button", { name: `作品を開く：${deck.title}`, exact: true })
    .click();
  await saved(page);
});

test("full ZIP backups preserve failed jobs and resume after reload with lost upload and commit responses", async ({
  page,
}, info) => {
  await signIn(page, `backup-${info.project.name}`);
  await page
    .getByRole("button", { name: "この作品をクラウドに保存", exact: true })
    .click();
  await saved(page);
  const source = new URL(page.url()).searchParams.get("room")!;
  await openEditor(page);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .locator('input[type="file"]')
    .nth(1)
    .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".editor-workspace img.slide-image")).toHaveCount(
    1,
  );
  await saved(page);
  await page.getByRole("button", { name: "付箋を追加", exact: true }).click();
  await page
    .getByRole("textbox", { name: "付箋のコメント", exact: true })
    .fill("バックアップする感想");
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/decks/${source}/comments`)).json())
          .comments[0]?.text,
    )
    .toBe("バックアップする感想");
  const access = {
    mode: "scoped",
    comment: true,
    rows: [{ sheetId: "main", index: 0, axisId: "0" }],
    columns: [],
    slides: [],
  };
  const email = `backup-guest-${info.project.name}@example.test`;
  await page.evaluate(
    async ({ source, email, access }) => {
      const r = await fetch(`/api/decks/${source}/recipients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: [{ email, access }] }),
      });
      if (!r.ok) throw new Error(await r.text());
    },
    { source, email, access },
  );
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await page.getByRole("tab", { name: /作品一覧/ }).click();
  const saving = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "完全バックアップを保存", exact: true })
    .click();
  const download = await saving;
  expect(download.suggestedFilename()).toMatch(/\.vhslide\.zip$/);
  const bytes = await readFile((await download.path())!);
  const { readBackupArchive } = await import("../../src/backupArchive.ts");
  const archive = await readBackupArchive(bytes);
  expect(archive.images.size).toBe(1);
  expect(archive.snapshot.comments[0].text).toBe("バックアップする感想");
  expect(archive.snapshot.sharing[0].email).toBe(email);
  // Worker ZIP construction must still be followed by authoritative revision verification.
  let blockedDownloads = 0;
  const unexpectedDownload = () => {
    blockedDownloads++;
  };
  page.on("download", unexpectedDownload);
  await page.route(`**/api/decks/${source}/backup/verify`, async (route) => {
    const r = await page.request.post(`/api/decks/${source}/recipients`, {
      headers: { Origin: "http://127.0.0.1:3187" },
      data: { recipients: [{ email, name: "取得中の変更", access }] },
    });
    expect(r.ok()).toBe(true);
    await route.continue();
  });
  await page
    .getByRole("button", { name: "完全バックアップを保存", exact: true })
    .click();
  await expect(page.locator(".backup-message")).toContainText("変更");
  expect(blockedDownloads).toBe(0);
  page.off("download", unexpectedDownload);
  await page.unroute(`**/api/decks/${source}/backup/verify`);
  const input = page.locator('input[aria-label="復元するバックアップ"]');
  await input.setInputFiles({
    name: "broken.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("broken"),
  });
  await expect(
    page.getByRole("button", { name: "バックアップから復元", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".backup-message")).not.toBeEmpty();
  await input.setInputFiles({
    name: "saved.vhslide.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  // The confirmation is a named block, while the checkbox is an explicit opt-in.
  const share = page.getByRole("checkbox", {
    name: "共有アカウントと編集権限も確認して復元する",
    exact: true,
  });
  await expect(share).not.toBeChecked();
  await share.check();
  await expect(
    page.getByRole("list", { name: "復元する共有アカウント", exact: true }),
  ).toContainText(email);
  await page
    .getByRole("button", { name: "新しい作品に復元する", exact: true })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("room"))
    .not.toBe(source);
  await saved(page);
  const target = new URL(page.url()).searchParams.get("room")!;
  const restored = await (
    await page.request.get(`/api/decks/${target}/backup`)
  ).json();
  expect(restored.comments[0].authorName).toMatch(/（復元）$/);
  expect(restored.sharing[0].access).toEqual(access);
  expect(
    restored.deck.slides
      .flatMap((s: any) => s.elements)
      .find((e: any) => e.type === "image").src,
  ).toContain(`/api/decks/${target}/assets/`);
  const sourceAfter = await (
    await page.request.get(`/api/decks/${source}/backup`)
  ).json();
  expect(sourceAfter.deck).toEqual(archive.snapshot.deck);
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await page.getByRole("tab", { name: /作品一覧/ }).click();
  await page.locator('input[aria-label="復元するバックアップ"]').setInputFiles({
    name: "saved.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  for (const failure of [
    { status: 503, message: "写真の復元テスト失敗" },
    { status: 413, message: "写真の保存容量が不足しています" },
  ]) {
    await page.route("**/api/decks/*/assets", async (route) => {
      if (route.request().method() === "POST")
        await route.fulfill({
          status: failure.status,
          contentType: "application/json",
          body: JSON.stringify({ error: failure.message }),
        });
      else await route.continue();
    });
    await page
      .getByRole("button", { name: "新しい作品に復元する", exact: true })
      .click();
    await expect(page.locator(".backup-message")).toContainText(
      failure.message,
    );
    await page.unroute("**/api/decks/*/assets");
  }
  const works = await (await page.request.get("/api/decks")).json();
  expect(works.decks).toHaveLength(3);
  expect(works.decks.some((d: any) => d.status === "restoring")).toBe(true);
  expect(new URL(page.url()).searchParams.get("room")).toBe(target);
  const pendingId = works.decks.find((d: any) => d.status === "restoring").id;
  await page.unroute("**/api/decks/*/assets");
  await page.reload();
  await saved(page);
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await page.getByRole("tab", { name: /作品一覧/ }).click();
  await expect(page.getByLabel("未完了の復元", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "ファイルを選んで再開", exact: true })
    .click();
  await page.locator('input[aria-label="復元するバックアップ"]').setInputFiles({
    name: "saved.zip",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await expect(
    page.getByRole("checkbox", {
      name: "共有アカウントと編集権限も確認して復元する",
      exact: true,
    }),
  ).not.toBeChecked();
  let lostUpload = false,
    lostCommit = 0;
  await page.route("**/api/decks/*/assets", async (route) => {
    if (route.request().method() === "POST" && !lostUpload) {
      lostUpload = true;
      const r = await route.fetch();
      expect(r.status()).toBe(201);
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await page.route("**/api/decks/*/restore", async (route) => {
    if (route.request().method() === "POST" && lostCommit < 3) {
      lostCommit++;
      const r = await route.fetch();
      expect(r.status()).toBe(200);
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "復元を再開する", exact: true })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("room"))
    .toBe(pendingId);
  await saved(page);
  expect(lostUpload).toBe(true);
  expect(lostCommit).toBe(3);
  const job = await (
    await page.request.get(`/api/restores/${pendingId}`)
  ).json();
  expect(job.status).toBe("ready");
  expect(job.images).toBe(1);
  const after = await (await page.request.get("/api/decks")).json();
  expect(after.decks).toHaveLength(3);
  expect(after.decks.some((d: any) => d.status === "restoring")).toBe(false);
});

test("restores a signed-in room in the background without flashing the cloud dialog", async ({
  page,
}, info) => {
  await signIn(page, `quiet-reload-${info.project.name}`);
  await page
    .getByRole("button", { name: "この作品をクラウドに保存", exact: true })
    .click();
  await saved(page);
  const room = new URL(page.url()).searchParams.get("room")!;
  const endpoint = `**/api/decks/${room}`;
  await page.addInitScript(() => {
    const state = window as typeof window & { cloudDialogAppeared: boolean };
    state.cloudDialogAppeared = false;
    const selector = '[role="dialog"][aria-label="クラウドの作品"]';
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (
            node instanceof Element &&
            (node.matches(selector) || node.querySelector(selector))
          )
            state.cloudDialogAppeared = true;
    }).observe(document, { childList: true, subtree: true });
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(endpoint, async (route) => {
    await gate;
    await route.continue();
  });
  const opening = page.waitForRequest((request) =>
    request.url().endsWith(`/api/decks/${room}`),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await opening;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByRole("dialog", { name: "クラウドの作品", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).cloudDialogAppeared)).toBe(
    false,
  );
  release();
  await saved(page);
  expect(await page.evaluate(() => (window as any).cloudDialogAppeared)).toBe(
    false,
  );
  await page.unroute(endpoint);
  // Explicit opening remains available after background restoration.
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "クラウドの作品", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  // A failed automatic opening still provides a visible recovery path.
  await page.route(endpoint, (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "この作品を開けません（テスト）" }),
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "クラウドの作品", exact: true }),
  ).toContainText("この作品を開けません（テスト）");
  await page.unroute(endpoint);
  // Expired sessions must still expose sign-in for the room URL.
  await page.context().clearCookies();
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Googleでサインイン（テスト）",
      exact: true,
    }),
  ).toBeVisible();
});

test("cloud versions restore photos and notes into a new work and trash can undo work removal", async ({
  page,
}, info) => {
  await signIn(page, `tools-${info.project.name}`);
  const { sample } = await import("../../src/model.ts");
  const original = sample();
  original.slides[0].elements.push({
    id: "photo-history",
    type: "image",
    x: 10,
    y: 10,
    w: 100,
    h: 100,
    src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  });
  const create = await page.request.post("/api/decks", {
    headers: { Origin: "http://127.0.0.1:3187" },
    data: original,
  });
  expect(create.status()).toBe(201);
  const { id: source } = await create.json();
  await page.goto(`/?room=${source}`);
  await saved(page);
  const note = await page.request.post(`/api/decks/${source}/comments`, {
    headers: { Origin: "http://127.0.0.1:3187" },
    data: {
      slide: original.slides[0].id,
      text: "版に残す付箋",
      x: 0.2,
      y: 0.2,
    },
  });
  expect(note.ok()).toBe(true);
  await page
    .getByRole("button", { name: "保存方法を選ぶ", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^保存した版/ }).click();
  await page
    .getByRole("textbox", { name: "保存する版の名前", exact: true })
    .fill("授業のはじめ");
  await page.getByRole("button", { name: "版を保存", exact: true }).click();
  await expect(page.getByText(/授業のはじめ ·/)).toBeVisible();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.locator(".deck-title").fill("変更後の作品");
  await saved(page);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/decks/${source}/backup`)).json())
          .deck.title,
    )
    .toBe("変更後の作品");
  await page
    .getByRole("button", { name: "保存方法を選ぶ", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^保存した版/ }).click();
  await page
    .getByRole("button", { name: "この版を確認", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("過去の版の確認")).toContainText("付箋1枚");
  await page.route("**/api/decks/*/assets", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "履歴写真の復元テスト失敗" }),
        })
      : route.continue(),
  );
  await page
    .getByRole("button", { name: "この版を別作品に復元", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "保存した版", exact: true })
      .getByRole("status"),
  ).toContainText("履歴写真の復元テスト失敗");
  const pending = (
    await (await page.request.get("/api/restores")).json()
  ).jobs.find((j: any) => j.status === "uploading").id;
  await page.unroute("**/api/decks/*/assets");
  await page.reload();
  await saved(page);
  await page
    .getByRole("button", { name: "保存方法を選ぶ", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^保存した版/ }).click();
  await page
    .getByRole("button", { name: "この版を確認", exact: true })
    .first()
    .click();
  let lostHistoryCommit = 0;
  await page.route("**/api/decks/*/restore", async (route) => {
    if (route.request().method() === "POST" && lostHistoryCommit < 3) {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      lostHistoryCommit++;
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "この版を別作品に復元", exact: true })
    .click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("room"))
    .toBe(pending);
  const target = new URL(page.url()).searchParams.get("room")!;
  expect(target).toBe(pending);
  expect(lostHistoryCommit).toBe(3);
  await page.unroute("**/api/decks/*/restore");
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/decks/${target}/backup`)).json())
          .deck.title,
    )
    .toBe(original.title);
  const backup = await (
    await page.request.get(`/api/decks/${target}/backup`)
  ).json();
  expect(backup.comments[0].text).toBe("版に残す付箋");
  expect(backup.sharing).toHaveLength(0);
  expect(
    backup.deck.slides[0].elements.find((e: any) => e.id === "photo-history")
      .src,
  ).toContain(`/api/decks/${target}/assets/`);
  expect(
    (await (await page.request.get(`/api/decks/${source}/backup`)).json()).deck
      .title,
  ).toBe("変更後の作品");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.locator(".deck-title").fill("編集した復元作品");
  await saved(page);
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/decks/${target}/backup`);
      const value = await response.json();
      // A save racing this capture must fail closed; retry only that known conflict.
      if (response.status() === 409) {
        expect(value.error).toBe(backupChanged);
        return undefined;
      }
      expect(response.status()).toBe(200);
      return value.deck.title;
    })
    .toBe("編集した復元作品");
  await page.goto(`/?room=${source}`);
  await saved(page);
  await page
    .getByRole("button", { name: "保存方法を選ぶ", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^保存した版/ }).click();
  await page
    .getByRole("button", { name: "この版を確認", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "この版を別作品に復元", exact: true })
    .click();
  await expect
    .poll(() => {
      const room = new URL(page.url()).searchParams.get("room");
      return room && room !== source && room !== target ? room : "";
    })
    .toMatch(/^[a-f0-9-]{36}$/);
  const repeated = new URL(page.url()).searchParams.get("room")!;
  expect(repeated).not.toBe(target);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/decks/${repeated}/backup`)).json())
          .deck.title,
    )
    .toBe(original.title);
  expect(
    (await (await page.request.get(`/api/decks/${target}/backup`)).json()).deck
      .title,
  ).toBe("編集した復元作品");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await page.getByRole("tab", { name: /作品一覧/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "変更後の作品をクラウドから削除",
      exact: true,
    })
    .click();
  await expect
    .poll(async () =>
      (await (await page.request.get("/api/trash")).json()).decks.some(
        (d: any) => d.id === source,
      ),
    )
    .toBe(true);
  await page.getByText("ごみ箱を開く", { exact: true }).click();
  const trash = page.getByRole("region", {
    name: "クラウド作品のごみ箱",
    exact: true,
  });
  await expect(trash).toContainText("変更後の作品");
  await trash
    .getByRole("button", { name: "作品一覧に戻す", exact: true })
    .click();
  await expect
    .poll(async () => (await page.request.get(`/api/decks/${source}`)).status())
    .toBe(200);
});

test("assigned slide jump respects row grants and clients cannot edit presentation routes or versions", async ({
  page,
  browser,
}, info) => {
  const host = `assignment-host-${info.project.name}`,
    guest = `assignment-guest-${info.project.name}`;
  await signIn(page, host);
  await page
    .getByRole("button", { name: "この作品をクラウドに保存", exact: true })
    .click();
  await saved(page);
  const source = new URL(page.url()).searchParams.get("room")!;
  const access = {
    mode: "scoped",
    comment: true,
    rows: [{ sheetId: "main", index: 1 }],
    columns: [],
    slides: [],
  };
  const grant = await page.request.post(`/api/decks/${source}/recipients`, {
    headers: { Origin: "http://127.0.0.1:3187" },
    data: { recipients: [{ email: `${guest}@example.test`, access }] },
  });
  expect(grant.ok()).toBe(true);
  const context = await browser.newContext(info.project.use),
    other = await context.newPage();
  try {
    await signIn(other, guest, page.url());
    await saved(other);
    await other
      .getByRole("button", { name: "マップをフィルタ", exact: true })
      .click();
    await other.getByRole("button", { name: /自分の担当を選択/ }).click();
    await other
      .getByRole("button", { name: "フィルタを適用", exact: true })
      .click();
    await expect(other.locator(".map-scroll [data-page-id]")).toHaveCount(2);
    await other
      .getByRole("button", { name: "保存方法を選ぶ", exact: true })
      .click();
    await other.getByRole("menuitem", { name: /^保存した版/ }).click();
    await expect(
      other.getByText("保存した版の確認・復元はホストだけが行えます。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      other.getByRole("button", { name: "版を保存", exact: true }),
    ).toHaveCount(0);
    await other.getByRole("button", { name: "閉じる", exact: true }).click();
    await other
      .getByRole("button", { name: "発表方法を選ぶ", exact: true })
      .click();
    await other.getByRole("menuitem", { name: /^発表ルートを編集/ }).click();
    await other
      .getByRole("button", { name: "対象をすべて選ぶ", exact: true })
      .click();
    await expect(
      other.getByRole("button", { name: "選択順でルートを保存", exact: true }),
    ).toBeDisabled();
  } finally {
    await context.close();
  }
});

test("host approves only checked invitation requests, approves all, and must readmit revoked accounts", async ({
  page,
  browser,
}, info) => {
  const prefix = `approve-${info.project.name}`;
  await signIn(page, prefix + "-host");
  await page
    .getByRole("button", { name: "この作品をクラウドに保存", exact: true })
    .click();
  await saved(page);
  await page.locator(".deck-title").fill("承認するまで非公開の作品");
  const work = new URL(page.url()).searchParams.get("room")!;
  const headers = { Origin: "http://127.0.0.1:3187" };
  const made = await page.request.post(`/api/decks/${work}/invite`, {
    headers,
  });
  const invite = (await made.json()).url;
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await page.getByRole("tab", { name: /共有管理/ }).click();
  const contexts = await Promise.all(
      Array.from({ length: 3 }, () => browser.newContext(info.project.use)),
    ),
    students = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    for (let i = 0; i < students.length; i++) {
      await signIn(
        students[i],
        `${prefix}-student-${["a", "b", "c"][i]}`,
        invite,
      );
      await expect(
        students[i].getByRole("region", {
          name: "参加申請の状況",
          exact: true,
        }),
      ).toContainText("ホストの承認を待っています");
      expect(
        (await students[i].request.get(`/api/decks/${work}`)).status(),
      ).toBe(404);
      await expect(students[i].locator(".deck-title")).not.toHaveValue(
        "承認するまで非公開の作品",
      );
    }
    const pending = page.getByRole("region", {
      name: "参加待ちのアカウント",
      exact: true,
    });
    await pending
      .getByRole("button", { name: "参加待ちを更新", exact: true })
      .click();
    await expect(pending.getByRole("checkbox")).toHaveCount(4); // select-all plus three accounts
    for (let i = 0; i < 2; i++)
      await pending
        .getByRole("checkbox", {
          name: `${prefix}-student-${["a", "b", "c"][i]}@example.testの参加申請を選択`,
          exact: true,
        })
        .check();
    await pending
      .getByRole("button", { name: "選択したアカウントを承認", exact: true })
      .click();
    await expect(pending.getByRole("status")).toContainText("2人の参加を承認");
    for (let i = 0; i < 2; i++) {
      await expect(students[i].locator(".cloud-presence")).toContainText(
        "閲覧のみ",
        { timeout: 15000 },
      );
      await expect(students[i].locator(".deck-title")).toHaveValue(
        "承認するまで非公開の作品",
      );
    }
    expect((await students[2].request.get(`/api/decks/${work}`)).status()).toBe(
      404,
    );
    const forged = await students[0].request.post(
      `/api/decks/${work}/join-requests/approve`,
      {
        headers,
        data: {
          requestIds: [new URL(students[2].url()).searchParams.get("request")],
        },
      },
    );
    expect(forged.status()).toBe(404);
    await pending
      .getByRole("checkbox", { name: "参加待ちを全選択", exact: true })
      .check();
    await pending
      .getByRole("button", { name: "選択したアカウントを承認", exact: true })
      .click();
    await expect(students[2].locator(".cloud-presence")).toContainText(
      "閲覧のみ",
      { timeout: 15000 },
    );
    // Revoke A, then use the same still-valid invitation: a new approval is mandatory.
    const a = (await (await students[0].request.get("/api/session")).json())
      .user;
    expect(
      (
        await page.request.delete(`/api/decks/${work}/members/${a.id}`, {
          headers,
        })
      ).status(),
    ).toBe(200);
    await students[0].goto(invite);
    await expect(
      students[0].getByRole("region", { name: "参加申請の状況", exact: true }),
    ).toContainText("ホストの承認を待っています");
    expect((await students[0].request.get(`/api/decks/${work}`)).status()).toBe(
      404,
    );
    await students[0].reload(); // durable request pointer resumes without another accept
    await expect(
      students[0].getByRole("region", { name: "参加申請の状況", exact: true }),
    ).toContainText("ホストの承認を待っています");
    await pending
      .getByRole("button", { name: "参加待ちを更新", exact: true })
      .click();
    await pending
      .getByRole("button", {
        name: `${prefix}-student-a@example.testの参加を承認`,
        exact: true,
      })
      .click();
    await expect(students[0].locator(".cloud-presence")).toContainText(
      "閲覧のみ",
      { timeout: 15000 },
    );
    await expect(pending.getByRole("checkbox")).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
