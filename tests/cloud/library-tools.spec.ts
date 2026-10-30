import { test, expect, type Page } from "@playwright/test";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";
import { readFile } from "node:fs/promises";
import { scopeBook } from "../support/scopeBook";
import { readBackupArchive } from "../../src/backupArchive";
async function library(page: Page) {
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await page.getByRole("tab", { name: /作品一覧/ }).click();
  return page.getByRole("dialog", { name: "クラウドの作品", exact: true });
}
const more = (page: Page) =>
  page.getByRole("button", { name: "作品一覧のその他", exact: true });
test("library secondary tools preserve modal keyboard focus, exports and restore preview", async ({
  page,
}, info) => {
  await scopeFixture(page, `${info.project.name}-library-tools`);
  const extra = await page.request.post("/api/decks", {
    headers: { Origin: scopeOrigin },
    data: { ...scopeBook(), title: "ごみ箱の確認作品" },
  });
  expect(extra.status()).toBe(201);
  const { id: trashed } = await extra.json();
  expect(
    (
      await page.request.post(`/api/decks/${trashed}/trash`, {
        headers: { Origin: scopeOrigin },
      })
    ).status(),
  ).toBe(200);
  const dialog = await library(page);
  const backup = page.locator(".cloud-panel .backup-panel");
  await expect(backup).toBeHidden();
  for (const width of [1366, 1024, 810]) {
    await page.setViewportSize({ width, height: 768 });
    await more(page).click();
    const menu = page.getByRole("menu", {
      name: "作品一覧のその他",
      exact: true,
    });
    await expect(menu.getByRole("menuitem")).toHaveCount(2);
    expect(
      await menu.evaluate((e) => !!e.closest('.cloud-panel[role="dialog"]')),
    ).toBe(true);
    const r = (await menu.boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(width);
    expect(r.y + r.height).toBeLessThanOrEqual(768);
    await page.screenshot({
      path: info.outputPath(`library-menu-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(more(page)).toBeFocused();
    await more(page).click();
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest(".cloud-panel"),
      ),
    ).toBe(true);
  }
  await more(page).click();
  await page
    .getByRole("menuitem", { name: "ごみ箱を開く", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "クラウド作品のごみ箱", exact: true }),
  ).toBeFocused();
  const trash = page.getByRole("region", {
    name: "クラウド作品のごみ箱",
    exact: true,
  });
  await expect(trash).toContainText("ごみ箱の確認作品");
  await trash
    .getByRole("button", { name: "作品一覧に戻す", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "作品を開く：ごみ箱の確認作品",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "ごみ箱を閉じる", exact: true })
    .click();
  await expect(more(page)).toBeFocused();
  await more(page).click();
  await page
    .getByRole("menuitem", { name: "バックアップと復元", exact: true })
    .click();
  await expect(backup).toBeVisible();
  await page
    .getByRole("button", { name: "バックアップと復元を閉じる", exact: true })
    .click();
  await expect(backup).toBeHidden();
  await more(page).click();
  await page
    .getByRole("menuitem", { name: "バックアップと復元", exact: true })
    .click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "完全バックアップを保存", exact: true })
    .click();
  const download = await downloading;
  const file = (await download.path())!;
  const archive = await readBackupArchive(new Uint8Array(await readFile(file)));
  expect(archive.snapshot.deck.title).toBe("範囲の検証");
  await expect(backup).toContainText("ZIPファイルを作成しました");
  await page
    .getByLabel("復元するバックアップ", { exact: true })
    .setInputFiles(file);
  await expect(
    page.getByLabel("復元内容の確認", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "共有アカウントと編集権限も確認して復元する",
      exact: true,
    }),
  ).not.toBeChecked();
});

test("unfinished restore and recovery failures remain visible without opening secondary tools", async ({
  page,
}, info) => {
  const source = await scopeFixture(
    page,
    `${info.project.name}-library-pending`,
  );
  const before = (
    await (await page.request.get(`/api/decks/${source}/backup`)).json()
  ).deck;
  const created = await page.request.post("/api/restores", {
    headers: { Origin: scopeOrigin },
    data: {
      title: "再開する作品",
      key: "a".repeat(64),
      contentHash: "b".repeat(64),
      applySharing: false,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await library(page);
  await expect(page.getByLabel("未完了の復元", { exact: true })).toBeVisible();
  await expect(page.getByLabel("未完了の復元", { exact: true })).toContainText(
    "再開する作品",
  );
  await expect(
    page.getByRole("button", { name: "ファイルを選んで再開", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "この復元を取り消す", exact: true })
    .click();
  await expect(page.locator(".backup-message")).toContainText(
    "復元を取り消しました",
  );
  expect(
    (await (await page.request.get("/api/restores")).json()).jobs.some(
      (j: any) => j.id === id,
    ),
  ).toBe(false);
  expect(
    (await (await page.request.get(`/api/decks/${source}/backup`)).json()).deck,
  ).toEqual(before);
});

test("failure to discover unfinished restores stays visible and can be retried", async ({
  page,
}, info) => {
  await scopeFixture(page, `${info.project.name}-library-retry`);
  let fail = true;
  await page.route("**/api/restores", (r) =>
    r.request().method() === "GET" && fail
      ? r.fulfill({ status: 503, json: { error: "確認通信の試験" } })
      : r.continue(),
  );
  await library(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "未完了の復元を確認できません" }),
  ).toContainText("確認通信の試験");
  fail = false;
  await page
    .getByRole("button", { name: "未完了の復元を再確認", exact: true })
    .click();
  await expect(page.locator(".cloud-panel .backup-panel")).toBeHidden();
  await expect(more(page)).toBeFocused();
});

test("a viewer can find their own recovery tools but cannot export the host backup", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-library-host`);
  const name = `${info.project.name}-library-viewer`;
  expect(
    (
      await page.request.post(`/api/decks/${id}/recipients`, {
        headers: { Origin: scopeOrigin },
        data: {
          recipients: [
            {
              email: `${name}@example.test`,
              access: {
                mode: "none",
                comment: true,
                rows: [],
                columns: [],
                slides: [],
              },
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  const context = await browser.newContext({ baseURL: scopeOrigin });
  const guest = await context.newPage();
  try {
    await scopeLogin(guest, name);
    await guest.goto(`/?room=${id}`);
    await expect(guest.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await library(guest);
    await more(guest).click();
    await guest
      .getByRole("menuitem", { name: "バックアップと復元", exact: true })
      .click();
    await expect(guest.locator(".backup-panel")).toContainText("ホストだけ");
    await expect(
      guest.getByRole("button", {
        name: "完全バックアップを保存",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      guest.getByRole("button", { name: "バックアップから復元", exact: true }),
    ).toBeEnabled();
  } finally {
    await context.close();
  }
});
