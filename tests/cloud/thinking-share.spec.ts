import { expect, test, type Page } from "@playwright/test";
import {
  scopeFixture,
  scopeLogin,
  scopeOrigin,
} from "../support/scopeCloud";

const headers = { Origin: scopeOrigin };

/**
 * Stage 4c: the host picks one student's chart in the console
 * gallery and shows it to the whole class through follow mode.
 * Students see the chart large and read-only, labeled with the
 * same roster number the host sees (names stay hidden), the share
 * payload carries no ids or authors, and stopping the share cuts
 * student access.
 */

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

async function writeCard(page: Page, zoneLabel: string, text: string) {
  const slide = page.locator(".slide-thinking.is-interactive");
  const zone = slide
    .locator(".thinking-zone")
    .filter({
      has: page.locator(".thinking-zone-label", { hasText: zoneLabel }),
    })
    .first();
  await zone.click();
  await zone.getByLabel("カードの内容").fill(text);
  await zone.getByRole("button", { name: "追加する" }).click();
  await expect(zone.locator(".thinking-card", { hasText: text })).toBeVisible({
    timeout: 15_000,
  });
}

test("host shows one student's chart to the class, then stops", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  // Touch taps land on the fixture deck's shapes instead of driving
  // this flow (the same reason as the text-mining spec); the share
  // flow itself is platform behavior, covered on desktop.
  test.skip(
    info.project.name.includes("touch"),
    "desktop-only: touch taps hit fixture shapes",
  );
  const id = await scopeFixture(page, `${info.project.name}-share-host`);
  const guestName = `${info.project.name}-share-ana`;
  await addGuest(page, id, guestName);
  const created = await page.request.post(`/api/decks/${id}/thinking`, {
    headers,
    data: {
      template: "venn2",
      unit: "individual",
      definition: { title: "分析のベン図", cardColors: [] },
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

  // Host places the board on the first slide (scopeFixture already
  // opened the room).
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  const panel = page.locator(".activity-panel");
  await panel.getByRole("tab", { name: "思考ツール" }).click();
  const card = panel.locator(".thinking-tool-card", {
    hasText: "分析のベン図",
  });
  await card.getByRole("button", { name: "スライドに配置" }).click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });

  // The student writes one card in zone A. Entering from the map
  // is retried with bounded waits (presence/sync re-renders can
  // swallow a click), as in the text-mining spec.
  const ctx = await browser.newContext({ baseURL: scopeOrigin });
  const student = await ctx.newPage();
  await scopeLogin(student, guestName);
  await student.goto(`/?room=${id}`);
  const board = student.locator(".slide-thinking.is-interactive");
  let entered = false;
  for (let attempt = 0; attempt < 5 && !entered; attempt++) {
    const cards = student.locator(".slide-card");
    if ((await cards.count()) > 0)
      await cards.first().click({ timeout: 8_000 }).catch(() => {});
    entered = await expect(board)
      .toBeVisible({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!entered) {
      const back = student.getByRole("button", { name: "全体マップへ" });
      if ((await back.count()) > 0)
        await back.first().click({ timeout: 5_000 }).catch(() => {});
    }
  }
  await expect(board).toBeVisible({ timeout: 15_000 });
  await writeCard(student, "A", "あなの考えカード");

  // The teacher writes on the student's chart too — before the
  // review fix, a names-on share labeled the chart with the
  // teacher's name, taken from this card's author (🔴1).
  const hostList = await (
    await page.request.get(`/api/decks/${id}/thinking?caps=board`)
  ).json();
  const anaCard = hostList.thinking[0].cards.find(
    (c: { text: string }) => c.text === "あなの考えカード",
  );
  expect(anaCard).toBeTruthy();
  const teacherCard = await page.request.post(
    `/api/decks/${id}/thinking/${toolId}/card?caps=board`,
    {
      headers,
      data: {
        zone: "a",
        text: "先生の書き込み",
        color: "",
        owner: anaCard.owner,
      },
    },
  );
  expect(teacherCard.status()).toBe(200);

  // Host: console → thinking results → per-student gallery.
  await page.getByRole("button", { name: "授業コンソール" }).click();
  const console_ = page.getByRole("region", { name: "授業コンソール" });
  await console_.getByRole("tab", { name: "思考ツール" }).click();
  const results = console_.locator(".thinking-results");
  await results.getByRole("tab", { name: "生徒ごと" }).click();
  const thumb = results.locator(".thinking-thumb", { hasText: "生徒1" });
  await expect(thumb).toBeVisible({ timeout: 20_000 });
  await thumb.click();

  const overlay = student.locator(
    '.host-follow-overlay[data-mode="thinking"]',
  );
  const stopButton = results.getByRole("button", {
    name: "見せるのをやめる",
  });

  // Show WITHOUT names (the explicit choice, 🔴2): the student
  // sees the roster number label, and the payload holds no ids or
  // author names.
  const anonResponse = student.waitForResponse(
    (r) => r.url().includes("/thinking-share") && r.status() === 200,
    { timeout: 30_000 },
  );
  const anonButton = results.getByRole("button", {
    name: "名前を出さずに全員に見せる",
  });
  await expect(anonButton).toBeVisible({ timeout: 15_000 });
  await anonButton.click();
  await expect(overlay).toBeVisible({ timeout: 20_000 });
  await expect(overlay.locator(".thinking-gallery-expanded h4")).toHaveText(
    "生徒1のチャート",
  );
  await expect(
    overlay.locator(".thinking-card", { hasText: "あなの考えカード" }),
  ).toHaveCount(1);
  await expect(
    overlay.locator(".thinking-card", { hasText: "先生の書き込み" }),
  ).toHaveCount(1);
  await expect(
    results.locator(".thinking-gallery-show"),
  ).toContainText("（名前なし）");
  const payload = await (await anonResponse).text();
  expect(payload).not.toContain(guestName);
  expect(payload).not.toContain("author");
  expect(payload).not.toContain(toolId);

  // Stopping the share removes the overlay and cuts the endpoint.
  const shareUrl = (await anonResponse).url();
  await expect(stopButton).toBeVisible({ timeout: 15_000 });
  await stopButton.click();
  await expect(overlay).toHaveCount(0, { timeout: 20_000 });
  const after = await student.request.get(shareUrl);
  expect(after.status()).toBe(404);

  // Show WITH names: the heading is the OWNER's name even though
  // the teacher's card sits on the chart (🔴1), and the host's
  // status line says so (🔴2).
  const namedResponse = student.waitForResponse(
    (r) => r.url().includes("/thinking-share") && r.status() === 200,
    { timeout: 30_000 },
  );
  const namedButton = results.getByRole("button", {
    name: "名前つきで全員に見せる",
  });
  await expect(namedButton).toBeVisible({ timeout: 15_000 });
  await namedButton.click();
  await expect(overlay).toBeVisible({ timeout: 20_000 });
  await expect(overlay.locator(".thinking-gallery-expanded h4")).toHaveText(
    `${guestName}のチャート`,
  );
  await expect(
    results.locator(".thinking-gallery-show"),
  ).toContainText("（名前つき）");
  await namedResponse;
  await expect(stopButton).toBeVisible({ timeout: 15_000 });
  await stopButton.click();
  await expect(overlay).toHaveCount(0, { timeout: 20_000 });
  await ctx.close();
});
