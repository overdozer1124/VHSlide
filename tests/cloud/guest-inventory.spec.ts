import { test, expect } from "@playwright/test";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";

// Real local Room/Directory, with the project's input device also applied to
// the separately authenticated guest (not just the host page fixture).
for (const role of ["assigned", "commenter", "viewer"] as const) {
  test(`guest inventory: ${role} keeps primary actions reachable at school screen widths`, async ({
    page,
    browser,
  }, info) => {
    const id = await scopeFixture(
      page,
      `${info.project.name}-inventory-${role}-host`,
    );
    const name = `${info.project.name}-inventory-${role}-guest`;
    expect(
      (
        await page.request.post(`/api/decks/${id}/recipients`, {
          headers: { Origin: scopeOrigin },
          data: {
            recipients: [
              {
                email: `${name}@example.test`,
                access: {
                  mode: role === "assigned" ? "scoped" : "none",
                  comment: role !== "viewer",
                  rows:
                    role === "assigned" ? [{ sheetId: "main", index: 0 }] : [],
                  columns: [],
                  slides: [],
                },
              },
            ],
          },
        })
      ).status(),
    ).toBe(200);
    if (role === "assigned") {
      await page
        .getByRole("button", { name: "ゲストの設定", exact: true })
        .click();
      await page.getByLabel("ゲストの表示範囲").selectOption("assigned");
      await page.keyboard.press("Escape");
    }
    const context = await browser.newContext({
      baseURL: scopeOrigin,
      hasTouch: !!info.project.use.hasTouch,
      isMobile: !!info.project.use.isMobile,
      deviceScaleFactor: info.project.use.deviceScaleFactor,
      viewport: { width: 1024, height: 768 },
    });
    const guest = await context.newPage();
    const errors: string[] = [];
    guest.on("pageerror", (error) => errors.push(error.message));
    try {
      await scopeLogin(guest, name);
      await guest.goto(`/?room=${id}`);
      await expect(guest.locator(".cloud-presence")).toContainText(
        "クラウドに保存済み",
      );
      await expect(guest.locator(".slide-card")).toHaveCount(
        role === "assigned" ? 3 : 9,
      );
      expect(await guest.evaluate(() => navigator.maxTouchPoints > 0)).toBe(
        !!info.project.use.hasTouch,
      );
      for (const width of [1366, 1024, 810]) {
        await guest.setViewportSize({ width, height: 768 });
        await expect(
          guest.getByRole("button", { name: "ファイル", exact: true }),
        ).toBeEnabled();
        await guest
          .getByRole("button", { name: "ファイル", exact: true })
          .click();
        await expect(
          guest.getByRole("menuitem", { name: /^JSONで保存/ }),
        ).toBeEnabled();
        await guest.keyboard.press("Escape");
        const present = guest.getByRole("button", {
          name: role === "assigned" ? "この3ページを発表" : "発表する",
          exact: true,
        });
        await expect(present).toBeEnabled();
        for (const button of [
          present,
          guest.getByRole("button", { name: "ファイル", exact: true }),
        ]) {
          const box = (await button.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
        await expect(
          guest.getByRole("button", { name: "ゲストの設定", exact: true }),
        ).toHaveCount(0);
        await expect(
          guest.getByRole("button", { name: "全員の画面を同期", exact: true }),
        ).toHaveCount(0);
        if (role !== "assigned") {
          await expect(guest.locator(".map-readonly-note")).toContainText(
            "ページの追加・移動・削除はできません",
          );
          expect(
            await guest
              .locator(
                ".map-panel .delete, .map-panel .add-dot, .map-panel .empty-cell, .map-panel [data-map-drag-handle]",
              )
              .evaluateAll((nodes) =>
                nodes.every((node) => node.matches(":disabled")),
              ),
          ).toBe(true);
          await expect(
            guest.locator(".map-scroll [data-map-drag-source]"),
          ).toHaveCount(0);
          await expect(
            guest.locator('.slide-card[draggable="true"]'),
          ).toHaveCount(0);
        }
        await guest.screenshot({
          path: info.outputPath(`${role}-map-${width}.png`),
        });
        await guest.locator(".thumbnail").first().click();
        await expect(guest.locator(".workspace-flight")).toHaveCount(0);
        expect(
          (await guest.locator(".editor-layout").boundingBox())!.y,
        ).toBeLessThanOrEqual(104);
        const text = guest.getByRole("button", { name: "文字", exact: true });
        if (role === "assigned") await expect(text).toBeEnabled();
        else await expect(text).toBeDisabled();
        const note = guest.getByRole("button", {
          name: "付箋を追加",
          exact: true,
        });
        if (role === "viewer") await expect(note).toBeDisabled();
        else await expect(note).toBeEnabled();
        await guest.screenshot({
          path: info.outputPath(`${role}-editor-${width}.png`),
        });
        await guest
          .getByRole("button", { name: "全体マップへ", exact: true })
          .click();
        await expect(guest.locator(".workspace-flight")).toHaveCount(0);
      }
      if (role === "viewer") {
        const before = (
          await (await page.request.get(`/api/decks/${id}/backup`)).json()
        ).deck;
        await guest
          .locator(".slide-card .thumbnail")
          .first()
          .click({ button: "right" });
        const menu = guest.getByRole("menu", {
          name: "ページの操作",
          exact: true,
        });
        await expect(menu).toContainText(
          "閲覧のみのため、ページの複製・削除はできません。",
        );
        await expect(menu).toBeFocused();
        await expect(menu.locator("button:not(:disabled)")).toHaveCount(0);
        await guest.keyboard.press("Escape");
        await expect(
          guest.locator(".slide-card .thumbnail").first(),
        ).toBeFocused();

        await guest
          .getByRole("button", { name: "スライドを複数選択", exact: true })
          .click();
        await guest.locator(".slide-card .thumbnail").nth(0).click();
        await guest
          .locator(".slide-card .thumbnail")
          .nth(1)
          .click({ modifiers: ["Control"] });
        await expect(
          guest.getByRole("button", { name: "比較", exact: true }),
        ).toBeEnabled();
        await expect(
          guest.getByRole("button", {
            name: "選択したページでフィルタ",
            exact: true,
          }),
        ).toBeEnabled();
        await expect(
          guest.getByRole("button", {
            name: "選択したページを削除",
            exact: true,
          }),
        ).toBeDisabled();
        await guest.keyboard.press("Delete");
        await expect(guest.locator(".selection-delete-confirm")).toHaveCount(0);
        await guest.getByRole("button", { name: "比較", exact: true }).click();
        await expect(
          guest.getByLabel("スライドの比較").locator(".slide-canvas"),
        ).toHaveCount(2);
        await guest
          .getByRole("button", { name: "閉じる", exact: true })
          .click();
        await guest
          .getByRole("button", { name: "選択を終了", exact: true })
          .click();

        if (info.project.use.hasTouch) {
          const box = (await guest
            .locator(".slide-card .thumbnail")
            .first()
            .boundingBox())!;
          const session = await context.newCDPSession(guest);
          await session.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ id: 1, x: box.x + 40, y: box.y + 40 }],
          });
          // The former drag threshold is 280ms: allow it to elapse, then move.
          await guest.waitForTimeout(350);
          await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ id: 1, x: box.x + 100, y: box.y + 60 }],
          });
          await expect(guest.locator(".map-touch-preview")).toHaveCount(0);
          await session.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await session.detach();
          await expect(guest.locator(".move-banner")).toHaveCount(0);
          await guest.keyboard.press("Escape");
        }
        await expect(
          guest.locator(".slide-card .delete").first(),
        ).toBeDisabled();
        await guest
          .locator(".slide-card .delete")
          .first()
          .click({ force: true });
        await expect(guest.locator(".slide-card")).toHaveCount(9);
        await expect(
          guest.locator(".toast").filter({ hasText: "ページを削除しました。" }),
        ).toHaveCount(0);
        expect(
          (await (await page.request.get(`/api/decks/${id}/backup`)).json())
            .deck,
        ).toEqual(before);
        await page.locator(".slide-card .delete").first().click();
        await expect(page.locator(".slide-card")).toHaveCount(8);
        await expect(page.locator(".toast")).toContainText(
          "ページを削除しました。",
        );
        await page
          .getByRole("button", { name: "もとに戻す", exact: true })
          .click();
        await expect(page.locator(".slide-card")).toHaveCount(9);
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("live permission changes cancel a pending map move and restore authorized controls", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(
    page,
    `${info.project.name}-live-controls-host`,
  );
  const name = `${info.project.name}-live-controls-guest`;
  const grant = async (mode: "all" | "none") => {
    expect(
      (
        await page.request.post(`/api/decks/${id}/recipients`, {
          headers: { Origin: scopeOrigin },
          data: {
            recipients: [
              {
                email: `${name}@example.test`,
                access: {
                  mode,
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
  };
  await grant("all");
  const before = (
    await (await page.request.get(`/api/decks/${id}/backup`)).json()
  ).deck;
  const context = await browser.newContext({
    baseURL: scopeOrigin,
    hasTouch: !!info.project.use.hasTouch,
    isMobile: !!info.project.use.isMobile,
    viewport: { width: 1024, height: 768 },
  });
  try {
    const guest = await context.newPage();
    await scopeLogin(guest, name);
    await guest.goto(`/?room=${id}`);
    const handle = guest.locator(".slide-card [data-map-drag-handle]").first();
    await expect(handle).toBeEnabled();
    await handle.click();
    await expect(guest.locator(".move-banner")).toBeVisible();
    await grant("none");
    await expect(guest.locator(".map-readonly-note")).toBeVisible();
    await expect(guest.locator(".move-banner")).toHaveCount(0);
    await expect(handle).toBeDisabled();
    await guest
      .locator(".slide-card .thumbnail")
      .first()
      .click({ button: "right" });
    const menu = guest.getByRole("menu", { name: "ページの操作", exact: true });
    await expect(
      menu.getByRole("menuitem", { name: "このページを削除", exact: true }),
    ).toBeDisabled();
    await grant("all");
    await expect(guest.locator(".map-readonly-note")).toHaveCount(0);
    // Removing the notice can scroll the document and dismiss a fixed menu.
    // Check access through a fresh invocation rather than requiring it to stay open.
    await guest.keyboard.press("Escape");
    await expect(handle).toBeEnabled();
    await guest
      .getByRole("button", { name: "ページ1.1のページメニュー", exact: true })
      .click();
    await expect(
      menu.getByRole("menuitem", { name: "このページを削除", exact: true }),
    ).toBeEnabled();
    await guest.keyboard.press("Escape");
    await expect(handle).toBeEnabled();
    await handle.click();
    await expect(guest.locator(".move-banner")).toBeVisible();
    await guest
      .getByRole("button", { name: "キャンセル", exact: true })
      .click();
    await expect(guest.locator(".move-banner")).toHaveCount(0);
    expect(
      (await (await page.request.get(`/api/decks/${id}/backup`)).json()).deck,
    ).toEqual(before);
  } finally {
    await context.close();
  }
});
