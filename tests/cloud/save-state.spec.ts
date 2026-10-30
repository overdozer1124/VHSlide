import { test, expect, type Page } from "@playwright/test";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";
import { defaultAccess } from "../../src/permissions";
async function backup(page: Page) {
  await page.getByRole("button", { name: "ファイル", exact: true }).click();
  await page.getByRole("menuitem", { name: /完全バックアップ（ZIP）/ }).click();
  return page.getByRole("dialog", {
    name: "完全バックアップと復元",
    exact: true,
  });
}
async function edit(page: Page) {
  await page.locator('[data-page-id="p00"] .thumbnail').click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
}
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
test("failed notes remain retryable after leaving the editor; header and ZIP never claim they are fully saved", async ({
  page,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-save-host`);
  await edit(page);
  let fail = true;
  await page.route("**/comments/*", (route) =>
    route.request().method() === "PUT" && fail
      ? route.abort()
      : route.continue(),
  );
  await button(page, "付箋を追加").click();
  await page
    .getByRole("textbox", { name: "付箋のコメント", exact: true })
    .fill("未送信の付箋を保持する");
  await expect(page.locator(".sticky-error")).toBeVisible();
  await expect(page.locator(".cloud-presence .save-state")).toContainText(
    "本文は保存済み・付箋1件を再試行",
  );
  await page.screenshot({ path: info.outputPath("note-save-error.png") });
  await button(page, "全体マップへ").click();
  await expect(page.locator(".sticky-note")).toHaveCount(0);
  await expect(button(page, "付箋の保存を再試行")).toBeVisible();
  const dialog = await backup(page);
  await expect(
    dialog.getByRole("button", { name: "完全バックアップを保存", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText("本文・付箋の保存完了");
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  // A local/new work must not silently discard the failed note.
  await button(page, "ファイル").click();
  await page.getByRole("menuitem", { name: "新しく", exact: true }).click();
  await expect(page.locator(".toast")).toContainText(
    "付箋の保存が完了していません",
  );
  await expect(page.locator(".slide-card")).toHaveCount(9);
  fail = false;
  await button(page, "付箋の保存を再試行").click();
  await expect(page.locator(".cloud-presence .save-state")).toContainText(
    "クラウドに保存済み",
  );
  await expect(button(page, "付箋の保存を再試行")).toHaveCount(0);
  const comments = (
    await (await page.request.get(`/api/decks/${id}/comments`)).json()
  ).comments;
  expect(comments).toHaveLength(1);
  expect(comments[0].text).toBe("未送信の付箋を保持する");
  const ready = await backup(page);
  await expect(
    ready.getByRole("button", { name: "完全バックアップを保存", exact: true }),
  ).toBeEnabled();
  const download = page.waitForEvent("download");
  await ready
    .getByRole("button", { name: "完全バックアップを保存", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.vhslide\.zip$/);
  await expect(ready).toContainText("ダウンロード先を確認");
  await page.screenshot({ path: info.outputPath("backup-dialog.png") });
});
test("the latest failed draft wins and global retry can also finish a failed note deletion", async ({
  page,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-save-latest`);
  await edit(page);
  let fail = true;
  await page.route("**/comments/*", (r) =>
    fail && ["PUT", "DELETE"].includes(r.request().method())
      ? r.abort()
      : r.continue(),
  );
  await button(page, "付箋を追加").click();
  const input = page.getByRole("textbox", {
    name: "付箋のコメント",
    exact: true,
  });
  await input.fill("前の入力");
  await expect(page.locator(".sticky-error")).toBeVisible();
  await input.fill("最後の入力を残す");
  await button(page, "全体マップへ").click();
  await expect(button(page, "付箋の保存を再試行")).toBeVisible();
  fail = false;
  await button(page, "付箋の保存を再試行").click();
  await expect(button(page, "付箋の保存を再試行")).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/decks/${id}/comments`)).json())
      .comments[0].text,
  ).toBe("最後の入力を残す");
  await edit(page);
  fail = true;
  await button(page, "付箋を削除").click();
  await expect(page.locator(".sticky-error")).toBeVisible();
  await button(page, "全体マップへ").click();
  fail = false;
  await button(page, "付箋の保存を再試行").click();
  await expect(button(page, "付箋の保存を再試行")).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/decks/${id}/comments`)).json())
      .comments,
  ).toHaveLength(0);
});
test("read-only participants see a reason rather than a host backup action", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-save-owner`),
    guest = `${info.project.name}-save-viewer`;
  expect(
    (
      await page.request.post(`/api/decks/${id}/recipients`, {
        headers: { Origin: scopeOrigin },
        data: {
          recipients: [
            { email: `${guest}@example.test`, access: defaultAccess() },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  const context = await browser.newContext({ baseURL: scopeOrigin }),
    other = await context.newPage();
  try {
    await scopeLogin(other, guest);
    await other.goto(`/?room=${id}`);
    await expect(other.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    const dialog = await backup(other);
    await expect(dialog).toContainText("作成できるのはホストだけ");
    await expect(
      dialog.getByRole("button", {
        name: "完全バックアップを保存",
        exact: true,
      }),
    ).toHaveCount(0);
    expect([403, 404]).toContain(
      (await other.request.get(`/api/decks/${id}/backup`)).status(),
    );
  } finally {
    await context.close();
  }
});

test("returning to a failed existing note restores its latest draft and retry never overwrites it with an older value", async ({
  page,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-save-return`);
  await edit(page);
  await button(page, "付箋を追加").click();
  const input = page.getByRole("textbox", {
    name: "付箋のコメント",
    exact: true,
  });
  await input.fill("最初の保存");
  await expect(page.locator(".sticky-note")).toContainText("保存済み");
  await button(page, "付箋の色とサイズ").click();
  await page.locator('.sticky-palette [aria-pressed="true"]').click();
  await expect(page.locator(".cloud-presence .save-state")).toContainText(
    "クラウドに保存済み",
  );
  await button(page, "付箋の色とサイズ").click();
  let fail = true;
  await page.route("**/comments/*", (r) =>
    fail && r.request().method() === "PUT" ? r.abort() : r.continue(),
  );
  await input.fill("未保存の編集");
  await expect(page.locator(".sticky-error")).toBeVisible();
  await button(page, "全体マップへ").click();
  await edit(page);
  await expect(input).toHaveValue("未保存の編集");
  await input.fill("戻ってからの最新入力");
  fail = false;
  await button(page, "付箋の保存を再試行").click();
  await expect(button(page, "付箋の保存を再試行")).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/decks/${id}/comments`)).json())
      .comments[0].text,
  ).toBe("戻ってからの最新入力");
});
test("clearing an unsaved new note never replays its old failed text", async ({
  page,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-save-empty`);
  await edit(page);
  let fail = true;
  await page.route("**/comments/*", (r) =>
    fail && r.request().method() === "PUT" ? r.abort() : r.continue(),
  );
  await button(page, "付箋を追加").click();
  const input = page.getByRole("textbox", {
    name: "付箋のコメント",
    exact: true,
  });
  await input.fill("送信しない文章");
  await expect(page.locator(".sticky-error")).toBeVisible();
  await input.fill("");
  await button(page, "全体マップへ").click();
  fail = false;
  await expect(button(page, "付箋の保存を再試行")).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/decks/${id}/comments`)).json())
      .comments,
  ).toHaveLength(0);
});
