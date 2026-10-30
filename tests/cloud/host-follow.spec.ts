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
    current: () =>
      messages.filter((m) => m.type === "follow-state").at(-1)?.state,
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
test("step 2 receives page and map targets without replacing the guest editor", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-follow-host`),
    name = `${info.project.name}-follow-guest`;
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
  const context = await browser.newContext({ baseURL: scopeOrigin });
  const guest = await context.newPage();
  const host = await controller(page, id);
  try {
    await scopeLogin(guest, name);
    await guest.goto(`/?room=${id}`);
    await expect(guest.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await guest.locator(".thumbnail").first().click();
    await expect(guest.locator(".workspace-flight")).toHaveCount(0);
    const before = await guest
      .locator(".editor-workspace .slide-canvas")
      .elementHandle();
    const running = await host.send("start", {
      mode: "page",
      sheetId: "main",
      pageId: "p11",
    });
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p11",
    );
    const assertFillsPage = async () => {
      await expect
        .poll(async () => {
          const frame = await guest.locator(".host-follow-page").boundingBox();
          const canvas = await guest
            .locator(".host-follow-page .slide-canvas")
            .boundingBox();
          const viewport = guest.viewportSize()!;
          if (!frame || !canvas) return { fills: false, fits: false };
          const ratio =
            canvas.width /
            Math.min(frame.width - 20, ((frame.height - 55) * 16) / 9);
          return {
            fills: ratio > 0.9 && ratio < 1.1,
            fits:
              canvas.x >= -1 &&
              canvas.y >= -1 &&
              canvas.x + canvas.width <= viewport.width + 1 &&
              canvas.y + canvas.height <= viewport.height + 1,
          };
        })
        .toEqual({ fills: true, fits: true });
    };
    await assertFillsPage();
    await expect(
      guest.locator(".host-follow-overlay > header strong"),
    ).toHaveText(`${info.project.name}-follow-hostさんの画面を表示中`);
    for (const size of [
      { width: 1366, height: 768 },
      { width: 1024, height: 600 },
      { width: 1920, height: 1080 },
    ]) {
      await guest.setViewportSize(size);
      await assertFillsPage();
    }
    await guest.screenshot({ path: info.outputPath("guest-page-fit.png") });
    await host.send(
      "move",
      { mode: "map", sheetId: "other", pageId: "q00" },
      running.sessionId,
    );
    await expect(
      guest.getByLabel("ホストの全体マップ", { exact: true }),
    ).toBeVisible();
    await host.send(
      "move",
      { mode: "page", sheetId: "main", pageId: "p11" },
      running.sessionId,
    );
    await assertFillsPage();
    await host.send("stop", undefined, running.sessionId);
    await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
    expect(await before!.evaluate((n) => n.isConnected)).toBe(true);
  } finally {
    host.close();
    await context.close();
  }
});

test("step 3 host toggles once and guests cannot navigate, edit or leave following", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-host-toggle`),
    name = `${info.project.name}-locked-guest`;
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
  const context = await browser.newContext({ baseURL: scopeOrigin }),
    guest = await context.newPage();
  try {
    await scopeLogin(guest, name);
    await guest.goto(`/?room=${id}`);
    await expect(guest.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await guest.locator(".thumbnail").first().click();
    await expect(guest.locator(".workspace-flight")).toHaveCount(0);
    const original = await guest
      .locator(".editor-workspace .slide-canvas")
      .elementHandle();
    const toggle = page.getByRole("button", {
      name: "全員の画面を同期",
      exact: true,
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(
      guest.getByLabel("ホストの全体マップ", { exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "全員の画面を同期", exact: true }),
    ).toHaveCount(0);
    await page.locator(".thumbnail").nth(4).click();
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p11",
    );
    await guest.keyboard.press("Escape");
    await guest.keyboard.press("ArrowRight");
    await guest.keyboard.press("Control+z");
    await guest.keyboard.type("変更しない");
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p11",
    );
    await page
      .getByRole("button", { name: "全体マップへ", exact: true })
      .click();
    await expect(
      guest.getByLabel("ホストの全体マップ", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".workspace-flight")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("host-map.png") });
    await guest.screenshot({ path: info.outputPath("guest-follow-map.png") });
    const observer = await controller(page, id);
    try {
      const revision = observer.current().revision;
      await expect
        .poll(() => observer.current()?.revision, { timeout: 20000 })
        .toBeGreaterThan(revision);
      await expect(guest.locator(".host-follow-overlay")).toHaveCount(1);
    } finally {
      observer.close();
    }
    await toggle.click();
    await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
    expect(await original!.evaluate((n) => n.isConnected)).toBe(true);
    await expect(guest.locator(".canvas-page-position")).toContainText("1.1");
  } finally {
    await context.close();
  }
});

test("step 4 preserves the live text editor, selected text and caret across interruption", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-editing-host`),
    name = `${info.project.name}-editing-guest`;
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
  const context = await browser.newContext({ baseURL: scopeOrigin }),
    guest = await context.newPage();
  try {
    await scopeLogin(guest, name);
    await guest.goto(`/?room=${id}`);
    await expect(guest.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await guest.locator(".thumbnail").first().click();
    await expect(guest.locator(".workspace-flight")).toHaveCount(0);
    await guest.locator(".editor-workspace .element").first().click();
    const input = guest.locator(".editor-workspace .ql-editor");
    await input.fill("編集中の内容を保持します");
    await input.evaluate((n) => {
      (n as HTMLElement).focus();
      const t = n.querySelector("p")!.firstChild!,
        r = document.createRange();
      r.setStart(t, 2);
      r.setEnd(t, 5);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
    });
    await expect
      .poll(() => input.evaluate(() => window.getSelection()?.toString()))
      .not.toBe("");
    const before = await input.evaluate(() =>
        window.getSelection()!.toString(),
      ),
      editor = await input.elementHandle();
    await guest.evaluate(() => {
      const v = { notice: 0, page: 0 };
      (window as any).__followTiming = v;
      new MutationObserver(() => {
        if (document.querySelector(".host-follow-notice") && !v.notice)
          v.notice = performance.now();
        if (document.querySelector(".host-follow-page") && !v.page)
          v.page = performance.now();
      }).observe(document.body, { subtree: true, childList: true });
    });
    await page.locator(".thumbnail").nth(4).click();
    const toggle = page.getByRole("button", {
      name: "全員の画面を同期",
      exact: true,
    });
    await toggle.click();
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p11",
    );
    await expect(
      guest.getByText(
        "ホストが集合をかけました。編集中の内容はそのまま保持されています。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(await editor!.evaluate((n) => n.isConnected)).toBe(true);
    await expect(input).toHaveText("編集中の内容を保持します");
    await guest.keyboard.type("変更されない");
    await expect(input).toHaveText("編集中の内容を保持します");
    await toggle.click();
    await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
    await expect(input).toBeFocused();
    expect(await editor!.evaluate((n) => n.isConnected)).toBe(true);
    await expect
      .poll(() => input.evaluate(() => window.getSelection()?.toString()))
      .toBe(before);
    const timing = await guest.evaluate(() => (window as any).__followTiming);
    expect(timing.notice).toBeGreaterThan(0);
    expect(timing.page).toBeGreaterThan(timing.notice);
    await expect(guest.locator(".canvas-page-position")).toContainText("1.1");
  } finally {
    await context.close();
  }
});

test("step 4 Chromium IME composition begun before following can commit without losing text", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-ime-host`),
    name = `${info.project.name}-ime-guest`;
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
  const context = await browser.newContext({ baseURL: scopeOrigin }),
    guest = await context.newPage();
  try {
    await scopeLogin(guest, name);
    await guest.goto(`/?room=${id}`);
    await expect(guest.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await guest.locator(".thumbnail").first().click();
    await expect(guest.locator(".workspace-flight")).toHaveCount(0);
    await guest.locator(".editor-workspace .element").first().click();
    const input = guest.locator(".editor-workspace .ql-editor");
    await input.fill("最初の文");
    await input.press("End");
    const cdp = await context.newCDPSession(guest);
    await cdp.send("Input.imeSetComposition", {
      text: "にほん",
      selectionStart: 3,
      selectionEnd: 3,
    });
    await expect(input).toContainText("にほん");
    await page.locator(".thumbnail").nth(4).click();
    const toggle = page.getByRole("button", {
      name: "全員の画面を同期",
      exact: true,
    });
    await toggle.click();
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p11",
    );
    await cdp.send("Input.insertText", { text: "日本" });
    await expect(input).toHaveText("最初の文日本");
    await toggle.click();
    await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(input).toHaveText("最初の文日本");
    await cdp.detach();
  } finally {
    await context.close();
  }
});

test("step 5 temporarily shows unassigned pages and maps without changing saved restrictions or the editing session", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-restricted-host`),
    name = `${info.project.name}-restricted-guest`;
  expect(
    (
      await page.request.post(`/api/decks/${id}/recipients`, {
        headers: { Origin: scopeOrigin },
        data: {
          recipients: [
            {
              email: `${name}@example.test`,
              access: {
                mode: "scoped",
                comment: true,
                rows: [{ sheetId: "main", index: 0 }],
                columns: [],
                slides: [],
              },
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  if (
    !(await page.getByRole("dialog", { name: "ゲストの表示設定" }).isVisible())
  )
    await page
      .getByRole("button", { name: "ゲストの設定", exact: true })
      .click();
  await page.getByLabel("ゲストの表示範囲").selectOption("assigned");
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  const context = await browser.newContext({ baseURL: scopeOrigin }),
    guest = await context.newPage();
  try {
    await scopeLogin(guest, name);
    await guest.goto(`/?room=${id}`);
    await expect(guest.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    await expect(guest.locator(".slide-card")).toHaveCount(3);
    await guest.locator(".thumbnail").first().click();
    await expect(guest.locator(".workspace-flight")).toHaveCount(0);
    const before = await guest
      .locator(".editor-workspace .slide-canvas")
      .elementHandle();
    const cache = () =>
      guest.evaluate(
        (key) => localStorage.getItem(`vhslide-cloud-deck:${key}`),
        id,
      );
    const saved = await cache();
    await page.locator(".thumbnail").nth(4).click();
    const toggle = page.getByRole("button", {
      name: "全員の画面を同期",
      exact: true,
    });
    await toggle.click();
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p11",
    );
    await expect(
      guest.locator(".host-follow-page [contenteditable=true]"),
    ).toHaveCount(0);
    await expect(guest.locator(".host-follow-page .resize-handle")).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "全体マップへ", exact: true })
      .click();
    await expect(
      guest.getByLabel("ホストの全体マップ", { exact: true }),
    ).toBeVisible();
    await expect(guest.locator(".follow-map-card")).toHaveCount(9);
    expect(await cache()).toBe(saved);
    await toggle.click();
    await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
    expect(await before!.evaluate((n) => n.isConnected)).toBe(true);
    await expect(guest.locator(".canvas-page-position")).toContainText("1.1");
    await guest
      .getByRole("button", { name: "全体マップへ", exact: true })
      .click();
    await expect(guest.locator(".slide-card")).toHaveCount(3);
    await expect(
      guest.getByRole("button", { name: "マップをフィルタ", exact: true }),
    ).toBeDisabled();
  } finally {
    await context.close();
  }
});

test("step 6 reload and network reconnection restore follow, controller close releases guest", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-reconnect-host`),
    name = `${info.project.name}-reconnect-guest`;
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
  const context = await browser.newContext({ baseURL: scopeOrigin }),
    guest = await context.newPage();
  const host = await controller(page, id);
  try {
    await scopeLogin(guest, name);
    await guest.goto(`/?room=${id}`);
    await expect(guest.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    const target = { mode: "page", sheetId: "main", pageId: "p11" };
    await host.send("start", target);
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p11",
    );
    await guest.reload();
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p11",
    );
    await context.setOffline(true);
    await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
    await context.setOffline(false);
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p11",
    );
    host.close();
    await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
    await expect(
      guest.getByRole("button", { name: "マップをフィルタ", exact: true }),
    ).toBeEnabled();
  } finally {
    host.close();
    await context.close();
  }
});

test("40 connections include rendered guest page latency under one second", async ({
  page,
  browser,
}, info) => {
  const id = await scopeFixture(page, `${info.project.name}-latency-host`),
    name = `${info.project.name}-latency-guest`;
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
  const context = await browser.newContext({ baseURL: scopeOrigin }),
    guest = await context.newPage(),
    sockets: Awaited<ReturnType<typeof controller>>[] = [];
  try {
    await scopeLogin(guest, name);
    await guest.goto(`/?room=${id}`);
    await expect(guest.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    // Two app sockets + initiating controller + 37 passive guest sockets = 40.
    const host = await controller(page, id);
    sockets.push(host);
    for (let i = 0; i < 37; i++) sockets.push(await controller(guest, id));
    const target = { mode: "page", sheetId: "main", pageId: "p00" },
      started = await host.send("start", target);
    await expect(guest.locator(".host-follow-page")).toHaveAttribute(
      "data-follow-page",
      "p00",
    );
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const pageId = i % 2 ? "p00" : "p11",
        before = performance.now();
      await host.send("move", { ...target, pageId }, started.sessionId);
      await expect(guest.locator(".host-follow-page")).toHaveAttribute(
        "data-follow-page",
        pageId,
      );
      // Wait a paint opportunity, not merely receipt of the server packet.
      await guest.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      samples.push(performance.now() - before);
    }
    const sorted = [...samples].sort((a, b) => a - b),
      p95 = sorted[18];
    const metrics = {
      backend: process.env.VHSLIDE_TEST_BACKEND ?? "node",
      project: info.project.name,
      connections: 40,
      renderedGuests: 1,
      samples: 20,
      p95Ms: p95,
      maxMs: Math.max(...samples),
      allMs: samples,
    };
    console.log("FOLLOW_RENDER_40_METRICS " + JSON.stringify(metrics));
    await info.attach("follow-render-40.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    expect(p95).toBeLessThanOrEqual(1000);
    await host.send("stop", undefined, started.sessionId);
  } finally {
    for (const socket of sockets) socket.close();
    await context.close();
  }
});
