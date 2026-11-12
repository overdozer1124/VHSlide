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
