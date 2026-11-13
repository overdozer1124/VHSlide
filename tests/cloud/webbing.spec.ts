import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { sample } from "../../src/model";

test("grouped webbing maps split writing by the deck's shared groups", async ({
  page,
  browser,
}, info) => {
  const anaContext = await browser.newContext(info.project.use);
  const bobContext = await browser.newContext(info.project.use);
  const ana = await anaContext.newPage();
  const bob = await bobContext.newPage();
  try {
    await signIn(page, "group-host");
    await signIn(ana, "group-ana");
    await signIn(bob, "group-bob");
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
    for (const guest of [ana, bob]) {
      const pending = await guest.request.post(
        `/api/invites/${token}/accept`,
        { headers: origin },
      );
      const request = await pending.json();
      if (request.status === "pending") {
        expect(
          (
            await page.request.post(
              `/api/decks/${id}/join-requests/approve`,
              {
                headers: origin,
                data: { requestIds: [request.requestId] },
              },
            )
          ).status(),
        ).toBe(200);
      }
    }
    await page.goto(`/?room=${id}`);
    // The host defines the deck's groups inside the webbing panel, then
    // creates a grouped map from them.
    await launch(page).click();
    const dialog = page.getByRole("dialog", {
      name: "アンケート",
      exact: true,
    });
    await dialog.getByRole("tab", { name: "ウェブマップ" }).click();
    const webDialog = page.getByRole("dialog", {
      name: "ウェブマップ",
      exact: true,
    });
    await webDialog.getByText(/グループごとに分ける/).click();
    await webDialog.locator(".webbing-group-setup textarea").fill("1班\n2班");
    await webDialog
      .getByRole("button", { name: "この内容でグループを作成" })
      .click();
    await expect(webDialog.getByText(/この作品のグループ：/)).toBeVisible({
      timeout: 20_000,
    });
    await webDialog.getByLabel("中心のテーマ").fill("班で考えよう");
    await webDialog.getByRole("button", { name: "マップを作成" }).click();
    await expect(webDialog.getByText("グループ別")).toBeVisible();
    await webDialog.getByRole("button", { name: "受付を開始" }).click();
    await webDialog
      .getByRole("button", { name: "このマップをスライドに配置" })
      .click();
    await expect(mapOn(page)).toBeVisible();

    // Guests open the same slide.
    for (const guest of [ana, bob]) {
      await guest.goto(`/?room=${id}`);
      await guest.locator(".slide-card").first().click();
      await expect(mapOn(guest)).toBeVisible();
    }
    const anaMap = mapOn(ana);
    const bobMap = mapOn(bob);

    // Ana joins 1班 and writes in it.
    await anaMap.getByRole("button", { name: "1班に参加" }).click();
    await expect(nodeOn(ana, "班で考えよう")).toBeVisible({
      timeout: 20_000,
    });
    await nodeOn(ana, "班で考えよう").click();
    await anaMap.getByRole("button", { name: "子を追加" }).click();
    await anaMap.getByLabel("新しい書き込み").fill("1班のアイデア");
    await anaMap.getByRole("button", { name: "追加する" }).click();
    await expect(nodeOn(ana, "1班のアイデア")).toBeVisible({
      timeout: 20_000,
    });

    // Bob joins 2班, views 1班 read-only, then writes in his own group.
    await bobMap.getByRole("button", { name: "2班に参加" }).click();
    await bobMap.getByRole("tab", { name: /1班/ }).click();
    await expect(nodeOn(bob, "1班のアイデア")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      bobMap.getByText(/1班のマップを表示しています/),
    ).toBeVisible();
    await nodeOn(bob, "1班のアイデア").click();
    await expect(bobMap.getByRole("button", { name: "子を追加" })).toHaveCount(
      0,
    );
    await expect(bobMap.getByRole("button", { name: "編集" })).toHaveCount(0);
    await bobMap.getByRole("tab", { name: /2班/ }).click();
    await nodeOn(bob, "班で考えよう").click();
    await bobMap.getByRole("button", { name: "子を追加" }).click();
    await bobMap.getByLabel("新しい書き込み").fill("2班のアイデア");
    await bobMap.getByRole("button", { name: "追加する" }).click();
    await expect(nodeOn(bob, "2班のアイデア")).toBeVisible({
      timeout: 20_000,
    });

    // Ana can view Bob's group too.
    await anaMap.getByRole("tab", { name: /2班/ }).click();
    await expect(nodeOn(ana, "2班のアイデア")).toBeVisible({
      timeout: 20_000,
    });

    // Zoom is per-viewer: the map grows for Ana, and resets to fit.
    const rootBox = await nodeOn(ana, "班で考えよう").boundingBox();
    expect(rootBox).not.toBeNull();
    await anaMap.getByRole("button", { name: "拡大" }).click();
    await anaMap.getByRole("button", { name: "拡大" }).click();
    await expect(anaMap.locator(".webbing-zoom-label")).toHaveText("169%");
    await expect
      .poll(
        async () =>
          (await nodeOn(ana, "班で考えよう").boundingBox())?.width ?? 0,
      )
      .toBeGreaterThan(rootBox!.width * 1.5);
    // Panning by dragging the background moves the map.
    const wrapBox = await anaMap
      .locator(".webbing-stage-wrap")
      .boundingBox();
    expect(wrapBox).not.toBeNull();
    const beforePan = await nodeOn(ana, "班で考えよう").boundingBox();
    await ana.mouse.move(
      wrapBox!.x + wrapBox!.width * 0.25,
      wrapBox!.y + wrapBox!.height * 0.8,
    );
    await ana.mouse.down();
    await ana.mouse.move(
      wrapBox!.x + wrapBox!.width * 0.25 + 90,
      wrapBox!.y + wrapBox!.height * 0.8 + 40,
      { steps: 8 },
    );
    await ana.mouse.up();
    const afterPan = await nodeOn(ana, "班で考えよう").boundingBox();
    expect(Math.abs(afterPan!.x - beforePan!.x)).toBeGreaterThan(50);
    await anaMap.getByRole("button", { name: "全体表示に戻す" }).click();
    await expect(anaMap.locator(".webbing-zoom-label")).toHaveText("100%");

    // The host checks every group's answers at once in the teacher
    // console: one card per group with its writings.
    await page.getByRole("button", { name: "授業コンソール" }).click();
    const consoleView = page.getByRole("region", { name: "授業コンソール" });
    await consoleView
      .getByRole("tab", { name: "グループ別マップ" })
      .click();
    const card1 = consoleView.locator(".console-group-card", {
      hasText: "1班（参加 1人）",
    });
    await expect(card1.locator(".console-webbing-text", { hasText: "1班のアイデア" })).toBeVisible({
      timeout: 20_000,
    });
    const card2 = consoleView.locator(".console-group-card", {
      hasText: "2班（参加 1人）",
    });
    await expect(card2.locator(".console-webbing-text", { hasText: "2班のアイデア" })).toBeVisible();
    await expect(
      consoleView.getByText("班で考えよう", { exact: true }).first(),
    ).toBeVisible();

    // A group card opens enlarged: the map at a readable size with its
    // writings beside it, in a dialog the host can close again.
    await card1.click();
    const enlarged = page.getByRole("dialog", { name: /1班.*のマップ/ });
    await expect(enlarged).toBeVisible();
    await expect(
      enlarged.locator(".console-webbing-mini.is-large"),
    ).toBeVisible();
    await expect(
      enlarged.locator(".console-webbing-text", {
        hasText: "1班のアイデア",
      }),
    ).toBeVisible();
    await enlarged.getByRole("button", { name: "閉じる" }).click();
    await expect(enlarged).toHaveCount(0);
  } finally {
    await anaContext.close();
    await bobContext.close();
  }
});

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
  page.getByRole("button", { name: "フォーム", exact: true });
const mapOn = (page: Page) =>
  page.locator("[data-webbing-map].is-interactive").first();
const nodeOn = (page: Page, text: string) =>
  mapOn(page).locator(".webbing-node").filter({ hasText: text }).first();

test("guests write into one shared webbing map with authorship and edit locks", async ({
  page,
  browser,
}, info) => {
  const anaContext = await browser.newContext(info.project.use);
  const bobContext = await browser.newContext(info.project.use);
  const ana = await anaContext.newPage();
  const bob = await bobContext.newPage();
  try {
    await signIn(page, "webbing-host");
    await signIn(ana, "webbing-ana");
    await signIn(bob, "webbing-bob");
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
    for (const guest of [ana, bob]) {
      const pending = await guest.request.post(
        `/api/invites/${token}/accept`,
        { headers: origin },
      );
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
    }
    await page.goto(`/?room=${id}`);
    // Host creates the map, opens reception and places it on the slide.
    await launch(page).click();
    const dialog = page.getByRole("dialog", { name: "アンケート", exact: true });
    await dialog.getByRole("tab", { name: "ウェブマップ" }).click();
    const webDialog = page.getByRole("dialog", {
      name: "ウェブマップ",
      exact: true,
    });
    await webDialog.getByLabel("中心のテーマ").fill("将来の夢");
    await webDialog.getByRole("button", { name: "マップを作成" }).click();
    await webDialog.getByRole("button", { name: "受付を開始" }).click();
    await webDialog
      .getByRole("button", { name: "このマップをスライドに配置" })
      .click();
    await expect(mapOn(page)).toBeVisible();
    await expect(nodeOn(page, "将来の夢")).toBeVisible();

    // Guests open the same slide.
    for (const guest of [ana, bob]) {
      await guest.goto(`/?room=${id}`);
      await guest.locator(".slide-card").first().click();
      await expect(mapOn(guest)).toBeVisible();
      await expect(nodeOn(guest, "将来の夢")).toBeVisible();
    }

    // Ana adds a child to the theme node.
    await nodeOn(ana, "将来の夢").click();
    await mapOn(ana).getByRole("button", { name: "子を追加" }).click();
    await mapOn(ana).getByLabel("新しい書き込み").fill("宇宙飛行士");
    await mapOn(ana).getByRole("button", { name: "追加する" }).click();
    await expect(nodeOn(ana, "宇宙飛行士")).toBeVisible();
    await expect(nodeOn(ana, "宇宙飛行士")).toContainText("webbing-ana");

    // Bob sees Ana's node appear, but cannot edit or delete it.
    await expect(nodeOn(bob, "宇宙飛行士")).toBeVisible({ timeout: 15000 });
    await nodeOn(bob, "宇宙飛行士").click();
    const bobTools = mapOn(bob).locator(".webbing-node-tools");
    await expect(bobTools.getByRole("button", { name: "子を追加" })).toBeVisible();
    await expect(bobTools.getByRole("button", { name: "編集" })).toHaveCount(0);
    await expect(bobTools.getByRole("button", { name: "削除" })).toHaveCount(0);

    // Bob adds his own node.
    await nodeOn(bob, "将来の夢").click();
    await mapOn(bob).getByRole("button", { name: "子を追加" }).click();
    await mapOn(bob).getByLabel("新しい書き込み").fill("サッカー選手");
    await mapOn(bob).getByRole("button", { name: "追加する" }).click();
    await expect(nodeOn(bob, "サッカー選手")).toBeVisible();
    await expect(nodeOn(ana, "サッカー選手")).toBeVisible({ timeout: 15000 });

    // While Ana edits her node, Bob sees the lock and cannot open the editor.
    await nodeOn(ana, "宇宙飛行士").click();
    await mapOn(ana).getByRole("button", { name: "編集" }).click();
    await expect(mapOn(ana).getByLabel("書き込みを編集")).toBeVisible();
    await expect(nodeOn(bob, "宇宙飛行士")).toContainText(
      "webbing-anaさんが編集中",
      { timeout: 15000 },
    );
    await nodeOn(bob, "宇宙飛行士").click();
    await expect(
      mapOn(bob).locator(".webbing-node-tools").getByRole("button", { name: "編集" }),
    ).toHaveCount(0);
    await mapOn(ana).getByLabel("書き込みを編集").fill("宇宙飛行士になる");
    await mapOn(ana).getByRole("button", { name: "保存" }).click();
    await expect(nodeOn(bob, "宇宙飛行士になる")).toBeVisible({
      timeout: 15000,
    });

    // The host can delete Bob's node; it disappears for everyone.
    await expect(nodeOn(page, "サッカー選手")).toBeVisible({ timeout: 15000 });
    await nodeOn(page, "サッカー選手").click();
    await mapOn(page).getByRole("button", { name: "削除" }).click();
    await mapOn(page).getByRole("button", { name: "削除する" }).click();
    await expect(nodeOn(page, "サッカー選手")).toHaveCount(0);
    await expect(nodeOn(bob, "サッカー選手")).toHaveCount(0, {
      timeout: 15000,
    });

    // Ana can delete her own node.
    await nodeOn(ana, "宇宙飛行士になる").click();
    await mapOn(ana).getByRole("button", { name: "削除" }).click();
    await mapOn(ana).getByRole("button", { name: "削除する" }).click();
    await expect(nodeOn(ana, "宇宙飛行士になる")).toHaveCount(0);
  } finally {
    await anaContext.close();
    await bobContext.close();
  }
});
