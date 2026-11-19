import { test, expect, type Page } from "@playwright/test";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";

const headers = { Origin: scopeOrigin };

async function addGuest(page: Page, id: string, name: string) {
  expect(
    (
      await page.request.post(`/api/decks/${id}/recipients`, {
        headers,
        data: {
          recipients: [
            {
              email: `${name}@example.test`,
              access: {
                mode: "all",
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
}

test("emotion curve: points per scene and line, notes, console overlay", async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name.includes("touch"),
    "touch viewport taps differ on the fixture deck",
  );
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-curve-host`);
  const guestName = `${info.project.name}-curve-one`;
  await addGuest(page, id, guestName);
  const created = await page.request.post(`/api/decks/${id}/thinking`, {
    headers,
    data: {
      template: "curve",
      unit: "individual",
      definition: {
        title: "主人公の気持ち",
        yMin: "気持ちが下がる",
        yMax: "気持ちが上がる",
        scenes: [
          { id: "s1", label: "場面1" },
          { id: "s2", label: "場面2" },
          { id: "s3", label: "場面3" },
        ],
        lines: [
          { id: "l1", label: "主人公" },
          { id: "l2", label: "友だち" },
        ],
      },
    },
  });
  expect(created.status()).toBe(200);
  const toolId = (await created.json()).createdId as string;
  expect(
    (
      await page.request.post(`/api/decks/${id}/thinking/${toolId}/status`, {
        headers,
        data: { status: "open" },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  const panel = page.locator(".activity-panel");
  await panel.getByRole("tab", { name: "思考ツール" }).click();
  const card = panel.locator(".thinking-tool-card", {
    hasText: "主人公の気持ち",
  });
  await card.getByRole("button", { name: "スライドに配置" }).click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });

  // The student places three points on the first line, adds a note to
  // the first one, then switches lines and places one more point.
  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  await student.goto(`/?room=${id}`);
  const slide = student.locator(".slide-thinking.is-interactive");
  let entered = false;
  for (let attempt = 0; attempt < 5 && !entered; attempt++) {
    const cards = student.locator(".slide-card");
    if ((await cards.count()) > 0)
      await cards.first().click({ timeout: 8_000 }).catch(() => {});
    entered = await expect(slide)
      .toBeVisible({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!entered) {
      const back = student.getByRole("button", { name: "全体マップへ" });
      if ((await back.count()) > 0)
        await back.first().click({ timeout: 5_000 }).catch(() => {});
    }
  }
  await expect(slide).toBeVisible({ timeout: 15_000 });
  const plot = slide.locator(".thinking-curve-plot");
  await expect(plot).toBeVisible({ timeout: 15_000 });
  const box = (await plot.boundingBox())!;
  const tap = async (sceneIndex: number, v: number) => {
    await student.mouse.click(
      box.x + (box.width * (sceneIndex + 0.5)) / 3,
      box.y + box.height * (1 - v),
    );
  };
  await tap(0, 0.8);
  await tap(1, 0.3);
  await tap(2, 0.6);
  await expect(slide.locator(".thinking-point.is-mine")).toHaveCount(3, {
    timeout: 15_000,
  });
  await expect(plot.locator("svg polyline")).toHaveCount(1);
  // A note on the first point (click selects it; the note autosaves).
  await slide.locator(".thinking-point.is-mine").first().click();
  await slide.getByLabel("一言").fill("どきどきした");
  await student.waitForTimeout(1_500);
  // The second line: one point in the first scene.
  await slide.getByRole("tab", { name: /友だち/ }).click();
  await tap(0, 0.5);
  await expect(slide.locator(".thinking-point.is-mine")).toHaveCount(4, {
    timeout: 15_000,
  });

  // The stored points carry the composed keys and the note.
  const list = await page.request.get(`/api/decks/${id}/thinking`, {
    headers,
  });
  const view = (await list.json()).thinking.find(
    (t: { id: string }) => t.id === toolId,
  );
  const byKey = new Map<string, { value: { v?: number }; reason: string }>(
    view.points.map((p: { scene: string }) => [p.scene, p]),
  );
  expect([...byKey.keys()].sort()).toEqual([
    "s1:l1",
    "s1:l2",
    "s2:l1",
    "s3:l1",
  ]);
  expect(byKey.get("s1:l1")?.reason).toBe("どきどきした");
  expect(byKey.get("s1:l1")?.value.v).toBeGreaterThan(0.7);
  await context.close();

  // The console overlays the student's line with the average toggle,
  // and the per-student detail lists the note.
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await panel.getByRole("tab", { name: "思考ツール" }).click();
  await card.getByRole("button", { name: "結果を見る" }).click();
  const results = panel.locator(".thinking-results");
  await expect(results.locator(".thinking-results-count")).toHaveText(
    "1人が書き込み",
    { timeout: 15_000 },
  );
  await expect(
    results.getByRole("checkbox", { name: "クラスの平均の線" }),
  ).toBeChecked();
  await expect(
    results.locator(".thinking-curve-plot.is-results svg polyline"),
  ).toHaveCount(2, { timeout: 15_000 });
  await results.getByRole("button", { name: guestName }).click();
  await expect(
    results.locator(".thinking-curve-detail", { hasText: "どきどきした" }),
  ).toBeVisible({ timeout: 15_000 });
});
