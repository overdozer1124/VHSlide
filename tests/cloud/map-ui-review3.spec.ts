import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  scopeFixture,
  scopeLogin,
  scopeOrigin,
} from "../support/scopeCloud";
import { defaultAccess } from "../../src/permissions";

const settingsButton = (page: Page) =>
  page.getByRole("button", { name: "マップの表示設定", exact: true });

test("map review 3: current-page badge and locate button, batch moved into display settings, zoom never falls into the numbered overview, self-filter note explains and clears", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const id = await scopeFixture(page, `${info.project.name}-uireview-host`);
  await page.goto(`/?room=${id}`);

  // G2: the current page carries a visible badge, and the toolbar keeps a
  // one-row locate button next to the zoom controls.
  const active = page.locator(".slide-card.active-card");
  await expect(active.locator(".current-badge")).toHaveText("いまのページ");
  const toolbar = page.locator(".map-toolbar");
  await expect(
    toolbar.getByRole("button", { name: "いまのページを表示" }),
  ).toBeVisible();
  expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(60);
  // Move to another page and back: the badge follows the current page.
  await page.locator('[data-page-id="p11"] .thumbnail').click();
  await page
    .getByRole("button", { name: "全体マップへ", exact: true })
    .click();
  await expect(
    page.locator('[data-page-id="p11"] .current-badge'),
  ).toHaveText("いまのページ");
  await page
    .getByRole("button", { name: "いまのページを表示", exact: true })
    .first()
    .click();

  // G1: the batch operation no longer sits in the toolbar; it lives in
  // the display settings under its own section heading.
  await expect(
    toolbar.getByRole("button", { name: "行・列を一括操作", exact: true }),
  ).toHaveCount(0);
  await settingsButton(page).click();
  const panel = page.locator(".map-display-settings");
  await expect(panel.locator("h4")).toHaveText("シート全体の操作");
  await panel
    .getByRole("button", { name: "行・列を一括操作", exact: true })
    .click();
  const batch = page.getByRole("region", {
    name: "行・列の一括操作",
    exact: true,
  });
  await expect(batch).toBeVisible();
  await batch.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(batch).toBeHidden();

  // G8: zooming out stops at the smallest thumbnail step and never falls
  // into the numbered overview.
  const zoomOut = page.getByRole("button", { name: "マップを縮小" });
  for (let i = 0; i < 12 && (await zoomOut.isEnabled()); i++) {
    await zoomOut.click();
    await expect(page.locator(".number-tile")).toHaveCount(0);
  }
  await expect(zoomOut).toBeDisabled();
  await expect(page.locator(".map-scale-reset")).toContainText("%");
  // The numbered overview is reached only from the display settings, and
  // the zoom controls stay out of it while it is on.
  await settingsButton(page).click();
  await page.getByRole("button", { name: "番号だけの一覧" }).click();
  await expect(page.locator(".number-tile").first()).toBeVisible();
  await expect(page.locator(".map-scale-reset")).toHaveText("番号");
  await expect(page.locator(".map-scale-reset")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "マップを拡大" }),
  ).toBeDisabled();
  await settingsButton(page).click();
  await page.getByRole("button", { name: "番号だけの一覧" }).click();
  await expect(page.locator(".number-tile")).toHaveCount(0);
  // Restore the standard size for the filter steps below.
  await page.locator(".map-scale-reset").click();

  // G3: a self-applied filter note says the order is unchanged and offers
  // the release right there.
  await page
    .getByRole("button", { name: "マップをフィルタ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "フィルタする行2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "フィルタを適用", exact: true })
    .click();
  const note = page.locator(".filtered-note");
  await expect(note).toContainText("元の並びは変わっていません");
  await note
    .getByRole("button", { name: "フィルタを解除", exact: true })
    .click();
  await expect(note).toHaveCount(0);
  await expect(page.locator(".slide-card")).toHaveCount(9);
});

test("map review 3: a scoped guest cannot act on pages outside their rows, and a forced filter explains itself without a release button", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180_000);
  const id = await scopeFixture(
    page,
    `${info.project.name}-uireview-scope-host`,
  );
  const guest = `${info.project.name}-uireview-scope-guest`;
  expect(
    (
      await page.request.post(`/api/decks/${id}/recipients`, {
        headers: { Origin: scopeOrigin },
        data: {
          recipients: [
            {
              email: `${guest}@example.test`,
              access: {
                ...defaultAccess(),
                mode: "scoped",
                slides: [],
                rows: [{ sheetId: "main", index: 0 }],
              },
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  const ctx = await browser.newContext({
    baseURL: scopeOrigin,
    viewport: { width: 1440, height: 1000 },
  });
  const other = await ctx.newPage();
  try {
    await scopeLogin(other, guest);
    await other.goto(`/?room=${id}`);
    await expect(other.locator(".slide-card")).toHaveCount(9);
    // G10(b): pages outside the guest's rows show their move/delete
    // buttons disabled; pages inside the rows stay usable.
    await expect(
      other.getByRole("button", { name: "ページ2.1を削除", exact: true }),
    ).toBeDisabled();
    await expect(
      other.getByRole("button", { name: "ページ2.1を移動", exact: true }),
    ).toBeDisabled();
    await expect(
      other.getByRole("button", { name: "ページ1.1を削除", exact: true }),
    ).toBeEnabled();
    await expect(
      other.getByRole("button", { name: "ページ1.1を移動", exact: true }),
    ).toBeEnabled();

    // G9: once the host forces the assigned-only view, the note explains
    // the restriction and no release button is offered anywhere.
    if (
      !(await page
        .getByRole("dialog", { name: "ゲストの表示設定" })
        .isVisible())
    )
      await page
        .getByRole("button", { name: "ゲストの設定", exact: true })
        .click();
    await page.getByLabel("ゲストの表示範囲").selectOption("assigned");
    await expect(other.locator(".slide-card")).toHaveCount(3);
    await expect(other.locator(".filtered-note")).toContainText(
      "先生の設定で、自分の担当ページだけを表示しています",
    );
    await expect(
      other.getByRole("button", { name: "フィルタ解除", exact: true }),
    ).toHaveCount(0);
    await expect(
      other.getByRole("button", { name: "フィルタを解除", exact: true }),
    ).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
