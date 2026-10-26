import { test, expect } from "@playwright/test";
import { blank, moveRowGroup } from "../../src/model";
import { sheetDeck, mergeSheet } from "../../src/workbook";
import { defaultAccess } from "../../src/permissions";
import {
  scopeFixture,
  scopeLogin,
  changeScopeBook,
  scopeOrigin,
} from "../support/scopeCloud";

test("bound row filters survive reordering; a presentation never adopts new matching pages and exits when its own pages disappear", async ({
  page,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-scope-live`);
  await page
    .getByRole("button", { name: "マップをフィルタ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "フィルタする行2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "フィルタを適用", exact: true })
    .click();
  await changeScopeBook(page, id, (b) =>
    mergeSheet(
      b,
      moveRowGroup(sheetDeck({ ...b, activeSheetId: "main" }), 1, 2),
    ),
  );
  await expect(
    page.locator('[data-page-id="p01"] .filtered-origin'),
  ).toContainText("3行：B班");
  await expect(page.locator(".slide-card")).toHaveCount(3);
  await page
    .getByRole("button", { name: "この3ページを発表", exact: true })
    .click();
  await expect(page.locator(".minimap-caption")).toContainText("3.1");
  await changeScopeBook(page, id, (b) => ({
    ...b,
    slides: [...b.slides, { ...blank(3, 2), id: "later", title: "後から追加" }],
  }));
  await expect(page.locator(".minimap .occupied")).toHaveCount(3);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".present-slide")).toContainText("S2.3");
  await expect(
    page.getByRole("button", { name: "次の話題", exact: true }),
  ).toBeDisabled();
  await changeScopeBook(page, id, (b) => ({
    ...b,
    slides: b.slides.filter((s) => s.id !== "p21"),
  }));
  await expect(page.locator(".present-slide")).toContainText("S2.2");
  await changeScopeBook(page, id, (b) => ({
    ...b,
    slides: b.slides.filter((s) => !["p01", "p11"].includes(s.id)),
  }));
  await expect(page.locator(".present-mode")).toHaveCount(0);
  await expect(page.locator(".slide-card")).toHaveCount(1);
  await expect(page.locator(".toast")).toContainText("すべて削除");
  await expect(page.locator('[data-page-id="later"]')).toBeVisible();
});
test("PDF preparation is invalidated by source changes and selected deletions instead of exporting stale or hidden pages", async ({
  page,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-scope-pdf`);
  await page
    .getByRole("button", { name: "マップをフィルタ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "フィルタする列2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "フィルタを適用", exact: true })
    .click();
  await page
    .getByRole("button", { name: "保存方法を選ぶ", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /PDFで保存/ }).click();
  await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".print-page")).toHaveCount(3);
  await changeScopeBook(page, id, (b) => ({
    ...b,
    slides: b.slides.map((s) =>
      s.id === "p10"
        ? {
            ...s,
            elements: s.elements.map((e) => ({ ...e, text: "REMOTE UPDATED" })),
          }
        : s,
    ),
  }));
  await expect(page.locator(".print-export")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toContainText("更新されました");
  await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "印刷・PDFに保存", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".print-page").first()).toContainText(
    "REMOTE UPDATED",
  );
  await changeScopeBook(page, id, (b) => ({
    ...b,
    slides: b.slides.filter((s) => s.id !== "p10"),
  }));
  await expect(page.locator(".print-export")).toHaveCount(0);
  await expect(
    page.getByLabel("対象スライド").getByRole("checkbox"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "PDFの準備", exact: true }).click();
  await expect(page.locator(".print-page")).toHaveCount(2);
});
test("viewers retain ordinary comparison and presentation scopes but a revoked participant cannot keep projecting a cached work", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-scope-owner`),
    guest = `${info.project.name}-scope-viewer`,
    email = `${guest}@example.test`;
  const share = (mode: string) =>
    page.request.post(`/api/decks/${id}/recipients`, {
      headers: { Origin: scopeOrigin },
      data: { recipients: [{ email, access: { ...defaultAccess(), mode } }] },
    });
  expect((await share("all")).status()).toBe(200);
  const context = await browser.newContext({
      baseURL: scopeOrigin,
      viewport: { width: 1366, height: 768 },
    }),
    other = await context.newPage();
  try {
    await scopeLogin(other, guest);
    await other.goto(`/?room=${id}`);
    await expect(other.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await other
      .getByRole("button", { name: "マップをフィルタ", exact: true })
      .click();
    await other
      .getByRole("button", { name: "フィルタする列2", exact: true })
      .click();
    await other
      .getByRole("button", { name: "フィルタを適用", exact: true })
      .click();
    expect((await share("none")).status()).toBe(200);
    await expect(other.locator(".cloud-presence")).toContainText("閲覧のみ");
    await other.getByRole("button", { name: "比較", exact: true }).click();
    await expect(
      other.getByLabel("対象スライド").getByRole("checkbox"),
    ).toHaveCount(3);
    await other.getByRole("button", { name: "閉じる", exact: true }).click();
    await other
      .getByRole("button", { name: "この3ページを発表", exact: true })
      .click();
    await expect(other.locator(".present-mode")).toBeVisible();
    expect((await share("all")).status()).toBe(200);
    expect((await share("none")).status()).toBe(200);
    await expect(other.locator(".present-mode")).toBeVisible();
    expect(
      (
        await page.request.delete(
          `/api/decks/${id}/recipients/${encodeURIComponent(email)}`,
          { headers: { Origin: scopeOrigin } },
        )
      ).status(),
    ).toBe(200);
    await expect(
      other.getByRole("heading", {
        name: "作品へのアクセスを確認してください",
        exact: true,
      }),
    ).toBeVisible();
    await expect(other.locator(".slide-canvas")).toHaveCount(0);
    await expect(other.locator(".map-scroll")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
test("an authentication close stops projection without silently switching to another sheet", async ({
  page,
}, info) => {
  let stop: () => void = () => {};
  await page.routeWebSocket("**/live", (ws) => {
    ws.connectToServer();
    stop = () =>
      ws.close({ code: 4001, reason: "local authentication expiry" });
  });
  await scopeFixture(page, `${info.project.name}-scope-expiry`);
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  await expect(page.locator(".present-mode")).toBeVisible();
  stop();
  await expect(
    page.getByRole("heading", {
      name: "作品へのアクセスを確認してください",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".slide-canvas")).toHaveCount(0);
});
