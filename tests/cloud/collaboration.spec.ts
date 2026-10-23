import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

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
async function signIn(page: Page, identity: string, invite?: string) {
  await google(page, identity);
  await page.goto(invite || "/");
  if (!invite)
    await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await page
    .getByRole("button", { name: "Googleでサインイン（テスト）", exact: true })
    .click();
  if (!invite) await expect(page.getByRole("dialog")).toContainText(identity);
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
    await signIn(other, `${name}-friend`, invitation);
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
    await page.getByRole("button", { name: "保存", exact: true }).click();
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
    await page.getByRole("button", { name: "保存", exact: true }).click();
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
    await signIn(other, guest, invite);
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
  await expect(page.locator(".pre-sharing [role=status]")).toHaveText(
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
    await signIn(pb, b, invite);
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
    await page.screenshot({ path: info.outputPath("shared-row-headings.png") });
    await other.reload();
    await saved(other);
    await expect(heading(other, "行2の見出し")).toHaveValue(guest);
  } finally {
    await context.close();
  }
});
