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
      a.press("Home").then(() => page.keyboard.type("Alice ")),
      b.press("Home").then(() => other.keyboard.type("Bob ")),
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
    await page.getByRole("button", { name: "クラウド", exact: true }).click();
    await page
      .getByRole("button", { name: `${name}-friendの参加を解除`, exact: true })
      .click();
    await expect(other.locator(".cloud-presence")).toContainText("共有停止");
    await page.screenshot({ path: info.outputPath("cloud-sharing.png") });
  } finally {
    await context.close();
  }
});
