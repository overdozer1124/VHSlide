import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("vhslide-deck-v1")) return;
    localStorage.setItem(
      "vhslide-deck-v1",
      JSON.stringify({
        version: 1,
        title: "発表の検証",
        slides: [
          {
            id: "p0",
            x: 0,
            y: 0,
            title: "はじめ",
            background: "#ffffff",
            elements: [],
          },
          {
            id: "p1",
            x: 1,
            y: 0,
            title: "つづき",
            background: "#ffffff",
            speakerNotes: "2枚目だけのメモ",
            elements: [],
          },
          {
            id: "p2",
            x: 0,
            y: 1,
            title: "下のページ",
            background: "#ffffff",
            speakerNotes: "下方向のメモ",
            elements: [],
          },
        ],
      }),
    );
  });
  await page.goto("/");
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
});
test("notes persist, stay off slides and follow presentation in a separate window", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "スピーカーノート", exact: true })
    .click();
  const notes = page.getByLabel("このスライドのスピーカーノート", {
    exact: true,
  });
  await notes.fill("最初に話す内容\n投影しないメモ");
  await expect(
    page.locator(".editor-workspace .slide-canvas"),
  ).not.toContainText("投影しないメモ");
  await page.reload();
  await page.getByRole("button", { name: "ページを編集", exact: true }).click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page
    .getByRole("button", { name: "スピーカーノート", exact: true })
    .click();
  await expect(notes).toHaveValue("最初に話す内容\n投影しないメモ");
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  await expect(page.locator(".present-mode")).toBeVisible();
  await expect(page.locator(".present-mode")).not.toContainText(
    "投影しないメモ",
  );
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "発表者用ノートを開く", exact: true })
    .click();
  const speaker = await opened;
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toContainText("投影しないメモ");
  await speaker.keyboard.press("ArrowRight");
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toHaveText("2枚目だけのメモ");
  await expect(
    speaker.getByRole("button", { name: "右へ", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".present-mode")).not.toContainText(
    "2枚目だけのメモ",
  );
  await speaker.getByRole("button", { name: "左へ", exact: true }).click();
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toContainText("投影しないメモ");
  await speaker
    .getByRole("button", { name: "ノートの文字を大きく", exact: true })
    .click();
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toHaveCSS("font-size", "26px");
  await page.mouse.move(10, 10);
  await page.getByRole("button", { name: "発表をおわる", exact: true }).click();
  await expect.poll(() => speaker.isClosed()).toBe(true);
});
test("a blocked presenter popup shows a recoverable error", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.open = () => null;
  });
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  await page
    .getByRole("button", { name: "発表者用ノートを開く", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("ポップアップを許可");
  await expect(page.locator(".present-mode")).toBeVisible();
});

async function startWithNotes(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "発表方法を選ぶ", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: /^ノートを見ながら発表する/ })
    .click();
}
test("one menu action opens notes with presentation, avoids automatic fullscreen and can return to normal presentation", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "スピーカーノート", exact: true })
    .click();
  await page
    .getByLabel("このスライドのスピーカーノート", { exact: true })
    .fill("発表者だけに見せるメモ");
  await page.evaluate(() => {
    const state = window as unknown as { fullscreenCalls: number };
    state.fullscreenCalls = 0;
    document.documentElement.requestFullscreen = () => {
      state.fullscreenCalls++;
      return Promise.resolve();
    };
  });
  const opened = page.waitForEvent("popup");
  await startWithNotes(page);
  const speaker = await opened;
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toHaveText("発表者だけに見せるメモ");
  await expect(page.locator(".present-mode")).not.toContainText(
    "発表者だけに見せるメモ",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { fullscreenCalls: number }).fullscreenCalls,
    ),
  ).toBe(0);
  await speaker.keyboard.press("ArrowRight");
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toHaveText("2枚目だけのメモ");
  await speaker.keyboard.press("ArrowLeft");
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toHaveText("発表者だけに見せるメモ");
  await speaker.keyboard.press("ArrowDown");
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toHaveText("下方向のメモ");
  await speaker.keyboard.press("ArrowUp");
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toHaveText("発表者だけに見せるメモ");
  await page.keyboard.press("Escape");
  await expect.poll(() => speaker.isClosed()).toBe(true);
  await page.getByRole("button", { name: "発表する", exact: true }).click();
  await expect(page.locator(".present-mode")).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { fullscreenCalls: number }).fullscreenCalls,
    ),
  ).toBe(1);
});
test("notes menu keeps the selected filter and never navigates to excluded pages", async ({
  page,
}) => {
  await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await page
    .getByRole("button", { name: "マップをフィルタ", exact: true })
    .click();
  await page.getByRole("button", { name: /フィルタ選択: 1.2/ }).click();
  await page
    .getByRole("button", { name: "フィルタを適用", exact: true })
    .click();
  const opened = page.waitForEvent("popup");
  await startWithNotes(page);
  const speaker = await opened;
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toHaveText("2枚目だけのメモ");
  for (const direction of ["左へ", "右へ", "上へ", "下へ"])
    await expect(
      speaker.getByRole("button", { name: direction, exact: true }),
    ).toBeDisabled();
  await speaker.keyboard.press("ArrowLeft");
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toHaveText("2枚目だけのメモ");
  await page.keyboard.press("Escape");
  await expect.poll(() => speaker.isClosed()).toBe(true);
  await expect(page.locator(".slide-card")).toHaveCount(1);
});
test("blocked automatic popup shows an error and the existing notes button retries safely", async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = window.open;
    window.open = () => {
      window.open = original;
      return null;
    };
  });
  await startWithNotes(page);
  await expect(page.getByRole("alert")).toContainText("ポップアップを許可");
  await expect(page.locator(".present-mode")).toBeVisible();
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "発表者用ノートを開く", exact: true })
    .click();
  const speaker = await opened;
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".speaker-popup-error")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect.poll(() => speaker.isClosed()).toBe(true);
});
test("display-check cancellation opens no orphan popup and continuing preserves the notes choice", async ({
  page,
}) => {
  await page.evaluate(() => {
    const deck = JSON.parse(localStorage.getItem("vhslide-deck-v1")!);
    deck.slides[0].speakerNotes = "表示チェック後のノート";
    deck.slides[0].elements = [
      {
        id: "overflow",
        type: "table",
        x: 100,
        y: 100,
        w: 300,
        h: 80,
        fontSize: 32,
        color: "#173d38",
        fill: "#ffffff",
        stroke: "#173d38",
        table: {
          rows: ["r0"],
          columns: ["c0"],
          header: true,
          cells: { "r0:c0": "長い文章".repeat(100) },
        },
      },
    ];
    localStorage.setItem("vhslide-deck-v1", JSON.stringify(deck));
  });
  await page.reload();
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  await startWithNotes(page);
  const dialog = page.getByRole("dialog", {
    name: "表示チェック",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  expect(page.context().pages()).toHaveLength(1);
  await dialog.getByRole("button", { name: "取り消す", exact: true }).click();
  await expect(page.locator(".present-mode")).toHaveCount(0);
  await startWithNotes(page);
  await expect(dialog).toBeVisible();
  const opened = page.waitForEvent("popup");
  await dialog
    .getByRole("button", { name: "このまま進む", exact: true })
    .click();
  const speaker = await opened;
  await expect(
    speaker.getByLabel("現在のスピーカーノート", { exact: true }),
  ).toHaveText("表示チェック後のノート");
  await page.keyboard.press("Escape");
  await expect.poll(() => speaker.isClosed()).toBe(true);
});

test("presenter preview renders slide contents, follows both windows and fits wide and narrow layouts", async ({
  page,
}, info) => {
  await page.evaluate(() => {
    const deck = JSON.parse(localStorage.getItem("vhslide-deck-v1")!);
    deck.slides[0].speakerNotes = "発表者だけのメモ";
    deck.slides[0].elements = [
      {
        id: "preview-text",
        type: "text",
        x: 40,
        y: 40,
        w: 500,
        h: 70,
        text: "プレビューのスライド本文",
        fontSize: 32,
        color: "#173d38",
      },
      {
        id: "preview-shape",
        type: "shape",
        shape: "rect",
        x: 700,
        y: 40,
        w: 160,
        h: 100,
        fill: "#c9dcc0",
        stroke: "#173d38",
      },
      {
        id: "preview-image",
        type: "image",
        x: 40,
        y: 150,
        w: 120,
        h: 120,
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=",
      },
      {
        id: "preview-table",
        type: "table",
        x: 220,
        y: 150,
        w: 320,
        h: 190,
        fontSize: 24,
        color: "#173d38",
        fill: "#ffffff",
        stroke: "#79958b",
        table: {
          rows: ["r0"],
          columns: ["c0"],
          header: true,
          cells: { "r0:c0": "表のプレビュー" },
        },
      },
      {
        id: "preview-chart",
        type: "chart",
        x: 600,
        y: 230,
        w: 300,
        h: 240,
        chart: {
          kind: "bar",
          title: "グラフのプレビュー",
          showLegend: false,
          showValues: true,
          series: [{ id: "a", label: "A", value: 10, color: "#587d59" }],
        },
      },
    ];
    deck.slides[1].elements = [
      {
        id: "next-text",
        type: "text",
        x: 40,
        y: 40,
        w: 600,
        h: 100,
        text: "次のスライドの本文",
        fontSize: 32,
        color: "#173d38",
      },
    ];
    localStorage.setItem("vhslide-deck-v1", JSON.stringify(deck));
  });
  await page.reload();
  await page.locator(".thumbnail").first().click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  const opened = page.waitForEvent("popup");
  await startWithNotes(page);
  const speaker = await opened;
  const preview = speaker.getByLabel("発表中のスライド", { exact: true });
  await expect(preview.locator("[data-preview-slide]")).toHaveAttribute(
    "data-preview-slide",
    "p0",
  );
  await expect(preview.locator(".element")).toHaveCount(5);
  await expect(preview).toContainText("プレビューのスライド本文");
  await expect(preview).toContainText("表のプレビュー");
  await expect(preview.locator(".chart-graphic")).toBeVisible();
  await expect
    .poll(() =>
      preview
        .locator("img")
        .first()
        .evaluate((n: HTMLImageElement) => n.complete && n.naturalWidth > 0),
    )
    .toBe(true);
  await expect(preview).not.toContainText("発表者だけのメモ");
  await expect(
    preview.locator("[contenteditable=true],textarea,.resize-handle"),
  ).toHaveCount(0);
  const notes = speaker.getByLabel("現在のスピーカーノート", { exact: true });
  await expect(notes).toHaveText("発表者だけのメモ");
  for (const size of [
    { width: 1366, height: 768 },
    { width: 700, height: 900 },
  ]) {
    await speaker.setViewportSize(size);
    await expect
      .poll(async () => {
        const frame = (await preview
            .locator(".speaker-slide-frame")
            .boundingBox())!,
          canvas = (await preview.locator(".slide-canvas").boundingBox())!;
        const expected = Math.min(frame.width, (frame.height * 16) / 9);
        return (
          Math.abs(canvas.width - expected) < 2 &&
          canvas.x >= 0 &&
          canvas.x + canvas.width <= size.width + 1
        );
      })
      .toBe(true);
    const p = (await preview.boundingBox())!,
      n = (await speaker.locator(".speaker-notes-pane").boundingBox())!;
    if (size.width > 800) expect(n.x).toBeGreaterThan(p.x + p.width);
    else expect(n.y).toBeGreaterThanOrEqual(p.y + p.height);
    await speaker.screenshot({
      path: info.outputPath(`speaker-preview-${size.width}.png`),
    });
  }
  await speaker.keyboard.press("ArrowRight");
  await expect(preview.locator("[data-preview-slide]")).toHaveAttribute(
    "data-preview-slide",
    "p1",
  );
  await expect(preview).toContainText("次のスライドの本文");
  await expect(notes).toHaveText("2枚目だけのメモ");
  await page.keyboard.press("ArrowLeft");
  await expect(preview.locator("[data-preview-slide]")).toHaveAttribute(
    "data-preview-slide",
    "p0",
  );
  await speaker.reload();
  await expect(speaker.locator("[data-preview-slide]")).toHaveAttribute(
    "data-preview-slide",
    "p0",
  );
  await expect(page.locator(".present-mode")).not.toContainText(
    "発表者だけのメモ",
  );
  await page.keyboard.press("Escape");
  await expect.poll(() => speaker.isClosed()).toBe(true);
});
test("idle keepalives do not repeatedly copy preview payloads, and reopening requests the current slide", async ({
  page,
}) => {
  await page.evaluate(() => {
    const Original = window.BroadcastChannel,
      state = window as unknown as {
        speakerCounts: { states: number; alive: number };
      };
    state.speakerCounts = { states: 0, alive: 0 };
    window.BroadcastChannel = class extends Original {
      postMessage(message: any) {
        if (this.name.startsWith("vhslide-speaker-")) {
          if (message.type === "state") state.speakerCounts.states++;
          if (message.type === "alive") state.speakerCounts.alive++;
        }
        super.postMessage(message);
      }
    };
  });
  const opened = page.waitForEvent("popup");
  await startWithNotes(page);
  let speaker = await opened;
  await expect(speaker.locator("[data-preview-slide]")).toHaveAttribute(
    "data-preview-slide",
    "p0",
  );
  const counts = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            speakerCounts: { states: number; alive: number };
          }
        ).speakerCounts,
    );
  await expect
    .poll(async () => (await counts()).alive)
    .toBeGreaterThanOrEqual(1);
  const before = await counts();
  await expect
    .poll(async () => (await counts()).alive, { timeout: 10000 })
    .toBeGreaterThanOrEqual(before.alive + 2);
  expect((await counts()).states).toBe(before.states);
  await speaker
    .getByRole("button", { name: "閉じる", exact: true })
    .click()
    .catch((error: unknown) => {
      // The window may close before Playwright acknowledges the click. Accept
      // only that expected outcome; the reopen assertions below still run.
      if (!speaker.isClosed()) throw error;
    });
  await expect.poll(() => speaker.isClosed()).toBe(true);
  await page.mouse.move(10, 10);
  const reopened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "発表者用ノートを開く", exact: true })
    .click();
  speaker = await reopened;
  await expect(speaker.locator("[data-preview-slide]")).toHaveAttribute(
    "data-preview-slide",
    "p0",
  );
  await page.keyboard.press("Escape");
  await expect.poll(() => speaker.isClosed()).toBe(true);
});
