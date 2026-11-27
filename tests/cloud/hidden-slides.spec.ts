import { test, expect, type Page } from "@playwright/test";
import { WebSocket } from "ws";
import { COLLABORATION_PROTOCOL } from "../../src/collaborationProtocol";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";

async function controller(page: Page, id: string) {
  const cookie = (await page.context().cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const ws = new WebSocket(`ws://127.0.0.1:3187/api/decks/${id}/live`, {
    headers: { Origin: scopeOrigin, Cookie: cookie },
  });
  const messages: any[] = [];
  ws.on("message", (data, binary) => {
    if (!binary) messages.push(JSON.parse(data.toString()));
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  await expect
    .poll(() => messages.some((m) => m.type === "follow-state"))
    .toBe(true);
  return {
    close: () => ws.close(),
    send: async (action: string, target?: object, sessionId?: string) => {
      const request = crypto.randomUUID();
      ws.send(
        JSON.stringify({
          type: "follow-control",
          protocol: COLLABORATION_PROTOCOL,
          id: request,
          action,
          target,
          sessionId,
        }),
      );
      await expect
        .poll(() => messages.some((m) => m.requestId === request))
        .toBe(true);
      const message = messages.find((m) => m.requestId === request);
      expect(message.type).toBe("follow-state");
      return message.state;
    },
  };
}

test("hidden slides and rows stay invisible to students, including follow", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-hide-host`),
    name = `${info.project.name}-hide-guest`;
  expect(
    (
      await page.request.post(`/api/decks/${id}/recipients`, {
        headers: { Origin: scopeOrigin },
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

  // Host hides one slide from the map card menu.
  const card = page.locator('[data-page-id="p11"]');
  await card.click({ button: "right" });
  await page
    .locator(".thumbnail-menu")
    .getByRole("menuitem", { name: "生徒から隠す" })
    .click();
  await expect(card).toHaveClass(/is-student-hidden/);
  await expect(card.locator(".student-hidden-badge")).toBeVisible();
  await expect
    .poll(() =>
      card
        .locator(".thumbnail .slide-canvas")
        .evaluate((el) => getComputedStyle(el).filter),
    )
    .toContain("grayscale");

  // Host hides the whole third row from the editor rail's row menu.
  await page.locator('[data-page-id="p00"] .thumbnail').click();
  await expect(page.locator(".editor-workspace")).toBeVisible();
  await page
    .getByRole("button", { name: "3段目の横のページをひらく" })
    .click({ button: "right" });
  await page
    .locator(".thumbnail-menu")
    .getByRole("menuitem", { name: "この段を生徒から隠す" })
    .click();
  await expect(
    page.getByRole("button", { name: "3段目の横のページをひらく" }),
  ).toHaveClass(/is-student-hidden/);
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await expect(page.locator('[data-page-id="p02"]')).toHaveClass(
    /is-student-hidden/,
  );

  // The editor flags the hidden slide outside the canvas, and the
  // slide itself stays editable.
  await page.locator('[data-page-id="p11"] .thumbnail').click();
  await expect(page.locator(".student-hidden-chip")).toContainText(
    "生徒に非表示中",
  );
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();

  const context = await browser.newContext({ baseURL: scopeOrigin });
  const guest = await context.newPage();
  const host = await controller(page, id);
  try {
    await scopeLogin(guest, name);
    await guest.goto(`/?room=${id}`);
    await expect(guest.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    // The guest map omits the hidden slide and the whole hidden row.
    for (const gone of ["p11", "p02", "p12", "p22"])
      await expect(guest.locator(`[data-page-id="${gone}"]`)).toHaveCount(0);
    for (const seen of ["p00", "p10", "p20", "p01", "p21"])
      await expect(guest.locator(`[data-page-id="${seen}"]`)).toHaveCount(1);
    const axes = await guest.locator(".row-axis").allTextContents();
    expect(axes.join(" ")).toContain("A班");
    expect(axes.join(" ")).toContain("B班");
    expect(axes.join(" ")).not.toContain("C班");

    // The guest opens a visible slide in the editor.
    await guest.locator('[data-page-id="p10"] .thumbnail').click();
    await expect(
      guest.locator(".editor-workspace .slide-canvas"),
    ).toContainText("S1.2");

    // Follow starts on the hidden slide: nothing is shown yet.
    const running = await host.send("start", {
      mode: "page",
      sheetId: "main",
      pageId: "p11",
    });
    await expect(guest.locator(".host-follow-overlay")).toBeVisible();
    await expect(
      guest.locator(".host-follow-page[data-follow-page]"),
    ).toHaveCount(0);
    // A visible slide follows normally.
    await host.send(
      "move",
      { mode: "page", sheetId: "main", pageId: "p10" },
      running.sessionId,
    );
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p10",
    );
    // Moving to the hidden slide leaves the guest on the previous one.
    await host.send(
      "move",
      { mode: "page", sheetId: "main", pageId: "p11" },
      running.sessionId,
    );
    await guest.waitForTimeout(800);
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p10",
    );
    // The followed map also omits hidden pages and the hidden row.
    await host.send(
      "move",
      { mode: "map", sheetId: "main", pageId: "p21" },
      running.sessionId,
    );
    const followMap = guest.getByLabel("ホストの全体マップ", { exact: true });
    await expect(followMap).toBeVisible();
    await expect(
      followMap.locator('[data-follow-page="p11"]'),
    ).toHaveCount(0);
    await expect(
      followMap.locator('[data-follow-page="p02"]'),
    ).toHaveCount(0);
    await expect(
      followMap.locator('[data-follow-page="p21"]'),
    ).toHaveCount(1);
    await expect(followMap).toContainText("A班");
    await expect(followMap).not.toContainText("C班");
    // Back to a visible page, then follow ends: the guest stays there.
    await host.send(
      "move",
      { mode: "page", sheetId: "main", pageId: "p21" },
      running.sessionId,
    );
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p21",
    );
    await host.send("stop", undefined, running.sessionId);
    await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
    await expect(
      guest.locator(".editor-workspace .slide-canvas"),
    ).toContainText("S2.3");
  } finally {
    host.close();
    await context.close();
  }
});
