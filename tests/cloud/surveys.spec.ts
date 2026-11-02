import * as Y from "yjs";
import { readFile } from "node:fs/promises";
import { fromBase64, readSharedDeck } from "../../src/sharedDeck";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { sample } from "../../src/model";

async function signIn(page: Page, name: string) {
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  const r = await page.request.post("/api/auth/google", {
    headers: { Origin: "http://127.0.0.1:3187" },
    data: { credential },
  });
  expect(r.status()).toBe(200);
}
const launch = (page: Page) =>
  page.getByRole("button", { name: "フォーム", exact: true });
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "アンケート", exact: true });
test("host creates both question types, guests answer privately and results become editable slides", async ({
  page,
  browser,
}, info) => {
  const guestContext = await browser.newContext(info.project.use);
  const guest = await guestContext.newPage();
  try {
    await signIn(page, "survey-host");
    await signIn(guest, "survey-guest");
    const origin = { Origin: "http://127.0.0.1:3187" };
    const created = await page.request.post("/api/decks", {
      headers: origin,
      data: sample(),
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    const invite = await page.request.post(`/api/decks/${id}/invite`, {
      headers: origin,
    });
    const token = new URL((await invite.json()).url).searchParams.get("join");
    const pending = await guest.request.post(`/api/invites/${token}/accept`, {
      headers: origin,
    });
    const request = await pending.json();
    if (request.status === "pending") {
      expect(
        (
          await page.request.post(`/api/decks/${id}/join-requests/approve`, {
            headers: origin,
            data: { requestIds: [request.requestId] },
          })
        ).status(),
      ).toBe(200);
    }
    await page.goto(`/?room=${id}`);
    await guest.goto(`/?room=${id}`);
    await expect(page.locator(".slide-card")).toHaveCount(5);
    await expect(guest.locator(".slide-card")).toHaveCount(5);
    await launch(page).click();
    await dialog(page)
      .getByRole("button", { name: "新しいアンケート" })
      .click();
    await page
      .getByRole("textbox", { name: "アンケートの質問" })
      .fill("好きな季節は？");
    await page
      .getByRole("textbox", { name: "選択肢1", exact: true })
      .fill("春");
    await page
      .getByRole("textbox", { name: "選択肢2", exact: true })
      .fill("夏");
    await page.getByRole("button", { name: "下書きを作成" }).click();
    await expect(dialog(page)).toContainText("下書きを作成しました");
    await page.getByRole("button", { name: "受付を開始", exact: true }).click();
    await expect(dialog(page)).toContainText("受付状態を更新しました");
    await launch(guest).click();
    await dialog(guest)
      .getByRole("button", { name: /好きな季節は？/ })
      .click();
    await guest.getByRole("radio", { name: "春", exact: true }).check();
    await guest.locator("textarea,input").first().blur();
    await expect(dialog(guest)).toContainText("回答は保存済みです。");
    await expect(guest.getByRole("region", { name: "集計結果" })).toHaveCount(
      0,
    );
    await expect(
      guest.getByRole("button", { name: "集計結果をスライドに挿入" }),
    ).toHaveCount(0);
    await guest.getByRole("radio", { name: "夏", exact: true }).check();
    await guest.locator("textarea,input").first().blur();
    await expect(dialog(page)).toContainText("集計結果 · 1人が回答");
    await expect(
      page.locator(".survey-result").filter({ hasText: "夏" }),
    ).toContainText("1件 (100%)");
    await expect(page.locator(".survey-response-table tbody")).toContainText(
      "survey-guest",
    );
    await expect(page.locator(".survey-response-table tbody")).toContainText(
      "夏",
    );
    await expect(guest.locator(".survey-responses")).toHaveCount(0);
    await expect(
      guest.getByRole("button", { name: "回答結果をCSV保存" }),
    ).toHaveCount(0);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "回答結果をCSV保存" }).click();
    const download = await downloading;
    const csv = await readFile((await download.path())!, "utf8");
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain("survey-guest");
    expect(csv).toContain('"夏"');
    expect(csv.split("\r\n")).toHaveLength(3);
    await page
      .getByRole("button", { name: "集計結果をスライドに挿入" })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator(".slide-card")).toHaveCount(6);
    await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
    await expect(page.locator(".slide-card")).toHaveCount(5);
    await page.getByRole("button", { name: "やり直す", exact: true }).click();
    await expect(page.locator(".slide-card")).toHaveCount(6);
    await expect(
      page.locator('.chart-graphic[data-survey-result="live"]'),
    ).toHaveCount(1);
    await guest.getByRole("radio", { name: "春", exact: true }).check();
    await guest.locator("textarea,input").first().blur();
    await expect(
      page.locator('.chart-graphic[data-survey-result="live"] > title'),
    ).toContainText("春 1");
    await expect(
      page.locator('.chart-graphic[data-survey-result="live"] > title'),
    ).toContainText("夏 0");
    await launch(page).click();
    await page.getByRole("button", { name: "新しいアンケート" }).click();
    await page
      .getByRole("textbox", { name: "アンケートの質問" })
      .fill("今日の発見");
    await page
      .getByRole("combobox", { name: "アンケートの回答形式" })
      .selectOption("text");
    await page.getByRole("button", { name: "下書きを作成" }).click();
    await expect(dialog(page)).toContainText("下書きを作成しました");
    await page.getByRole("button", { name: "受付を開始", exact: true }).click();
    await dialog(guest)
      .getByRole("button", { name: /今日の発見/ })
      .click();
    const answer = "<script>も文字として表示🌸\n春の花を見つけた";
    await guest
      .getByRole("textbox", { name: "アンケートの回答", exact: true })
      .fill(answer);
    await guest.locator("textarea,input").first().blur();
    await expect(dialog(guest)).toContainText("回答は保存済みです。");
    await expect(page.locator(".survey-results li")).toHaveText(answer);
    await expect(page.locator(".survey-response-answer")).toHaveText(answer);
    const textDownloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "回答結果をCSV保存" }).click();
    const textDownload = await textDownloading;
    const textCsv = await readFile((await textDownload.path())!, "utf8");
    expect(textCsv).toContain('"' + answer + '"');
    expect(textCsv).toContain("survey-guest");

    await page.getByRole("button", { name: "受付を終了", exact: true }).click();
    await expect(
      guest.getByRole("textbox", { name: "アンケートの回答", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "アンケートを閉じる" }).click();
    await page.getByRole("button", { name: "発表する", exact: true }).click();
    await expect(page.locator(".present-mode")).toBeVisible();
    await launch(page).click();
    await page
      .getByRole("button", { name: "集計結果をスライドに挿入" })
      .click();
    await expect(page.locator(".slide-card")).toHaveCount(7);
    await expect(page.locator(".present-mode")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => !!document.fullscreenElement))
      .toBe(false);
    await expect(guest.locator(".slide-card")).toHaveCount(7);
    await page.reload();
    await expect(page.locator(".slide-card")).toHaveCount(7);
    await launch(page).click();
    await dialog(page)
      .getByRole("button", { name: /今日の発見/ })
      .click();
    await expect(page.locator(".survey-results li")).toHaveText(answer);
    await page.screenshot({
      path: info.outputPath("survey-results.png"),
      fullPage: true,
    });
    const guestData = await (
      await guest.request.get(`/api/decks/${id}/surveys`)
    ).json();
    expect(guestData.surveys.every((s: any) => !s.results)).toBe(true);
  } finally {
    await guestContext.close();
  }
});

test("embedded surveys accept private answers in viewer, presentation and host-follow pages", async ({
  page,
  browser,
}, info) => {
  const guestContext = await browser.newContext(info.project.use);
  const guest = await guestContext.newPage();
  const headers = { Origin: "http://127.0.0.1:3187" };
  try {
    await signIn(page, "embedded-host");
    await signIn(guest, "embedded-guest");
    const created = await page.request.post("/api/decks", {
      headers,
      data: sample(),
    });
    const { id } = await created.json();
    const invite = await page.request.post(`/api/decks/${id}/invite`, {
      headers,
    });
    const token = new URL((await invite.json()).url).searchParams.get("join");
    const pending = await (
      await guest.request.post(`/api/invites/${token}/accept`, { headers })
    ).json();
    if (pending.status === "pending")
      expect(
        (
          await page.request.post(`/api/decks/${id}/join-requests/approve`, {
            headers,
            data: { requestIds: [pending.requestId] },
          })
        ).status(),
      ).toBe(200);
    const ids: Record<string, string> = {};
    for (const [kind, question] of [
      ["single", "好きな季節"],
      ["text", "今日の気づき"],
    ]) {
      const r = await page.request.post(`/api/decks/${id}/surveys`, {
        headers,
        data: { kind, question, options: ["春", "夏"] },
      });
      expect(r.status()).toBe(200);
      const survey = (await r.json()).surveys.find(
        (s: any) => s.question === question,
      );
      ids[kind] = survey.id;
      expect(
        (
          await page.request.post(
            `/api/decks/${id}/surveys/${survey.id}/status`,
            { headers, data: { status: "open" } },
          )
        ).status(),
      ).toBe(200);
    }
    await page.goto(`/?room=${id}`);
    await guest.goto(`/?room=${id}`);
    await expect(page.locator(".slide-card")).toHaveCount(5);
    await launch(page).click();
    await dialog(page)
      .getByRole("button", { name: /好きな季節/ })
      .click();
    await page
      .getByRole("button", { name: "このアンケートをスライドに配置" })
      .click();
    await expect(
      page.locator(".editor-workspace [data-slide-survey]"),
    ).toHaveCount(1);
    const hostCard = page.locator(".editor-workspace [data-slide-survey]");
    await expect(hostCard).toContainText("好きな季節");
    await expect(page.locator(".workspace-flight")).toHaveCount(0);
    const object = page.locator(
      ".editor-workspace .element:has([data-slide-survey])",
    );
    const originalBox = (await hostCard.boundingBox({ timeout: 5000 }))!;
    async function drag(
      from: { x: number; y: number },
      dx: number,
      dy: number,
    ) {
      if (info.project.name.includes("touch")) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ id: 1, ...from }],
        });
        for (let i = 1; i <= 3; i++)
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
              { id: 1, x: from.x + (dx * i) / 3, y: from.y + (dy * i) / 3 },
            ],
          });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await cdp.detach();
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + dx, from.y + dy, { steps: 3 });
        await page.mouse.up();
      }
    }
    const move = (await hostCard
      .locator("header h3")
      .boundingBox({ timeout: 5000 }))!;
    await drag(
      { x: move.x + move.width / 2, y: move.y + move.height / 2 },
      10,
      8,
    );
    await expect
      .poll(async () => (await hostCard.boundingBox({ timeout: 5000 }))!.x)
      .toBeGreaterThan(originalBox.x);
    const movedBox = (await hostCard.boundingBox({ timeout: 5000 }))!;
    const handle = (await object
      .locator(".resize-se")
      .boundingBox({ timeout: 5000 }))!;
    await drag(
      { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      -20,
      -12,
    );
    await expect
      .poll(async () => (await hostCard.boundingBox({ timeout: 5000 }))!.width)
      .toBeLessThan(movedBox.width);

    await guest.locator(".thumbnail").first().click();
    const guestCard = guest.locator(".editor-workspace [data-slide-survey]");
    await expect(guestCard).toHaveCount(1);
    await expect(guest.locator(".workspace-flight")).toHaveCount(0);
    await expect(guestCard).toBeVisible();
    const before = await guestCard.boundingBox({ timeout: 5000 });
    if (info.project.name.includes("touch"))
      await guestCard.getByRole("radio", { name: "春", exact: true }).tap();
    else
      await guestCard.getByRole("radio", { name: "春", exact: true }).check();
    await guestCard.locator("textarea,input").first().blur();
    await expect(guestCard).toContainText("回答は保存済みです。");
    expect(await guestCard.boundingBox({ timeout: 5000 })).toEqual(before);
    const list = async () =>
      (await (await page.request.get(`/api/decks/${id}/surveys`)).json())
        .surveys;
    expect(
      (await list()).find((s: any) => s.id === ids.single).results.counts,
    ).toEqual([1, 0]);
    expect(await guestCard.locator("meter,.survey-results").count()).toBe(0);
    // Put the text question on the second topic; both references remain ordinary editable objects.
    await page
      .getByRole("button", { name: "全体マップへ", exact: true })
      .click();
    await page
      .getByRole("button", { name: "自然がいっぱいを編集", exact: true })
      .click();
    await launch(page).click();
    await dialog(page)
      .getByRole("button", { name: /今日の気づき/ })
      .click();
    await page
      .getByRole("button", { name: "このアンケートをスライドに配置" })
      .click();
    await expect(
      page.locator(".editor-workspace [data-slide-survey]"),
    ).toContainText("今日の気づき");
    await guest
      .getByRole("button", { name: "全体マップへ", exact: true })
      .click();
    await guest.getByRole("button", { name: "発表する", exact: true }).click();
    const presentCard = guest.locator(".present-mode [data-slide-survey]");
    await expect(presentCard).toContainText("好きな季節");
    await presentCard.getByRole("radio", { name: "夏", exact: true }).check();
    await presentCard.locator("textarea,input").first().blur();
    await expect(presentCard).toContainText("回答は保存済みです。");
    expect(
      (await list()).find((s: any) => s.id === ids.single).results,
    ).toMatchObject({ count: 1, counts: [0, 1] });
    await guest.mouse.move(10, 10);
    await guest.getByRole("button", { name: "次の話題", exact: true }).click();
    await expect(presentCard).toContainText("今日の気づき");
    const answer = presentCard.getByRole("textbox", {
      name: "スライド内アンケートの回答",
    });
    await answer.fill("スライドの中で回答できました🌸");
    await answer.press("ArrowLeft");
    await expect(presentCard).toContainText("今日の気づき");
    await presentCard.locator("textarea,input").first().blur();
    await expect(presentCard).toContainText("回答は保存済みです。");
    await guest.mouse.move(10, 10);
    await launch(guest).click();
    await expect(dialog(guest)).toBeVisible();
    await guest
      .getByRole("button", { name: "アンケートを閉じる", exact: true })
      .click();
    // Following the host still allows only the embedded questionnaire, not background editing.
    await page
      .getByRole("button", { name: "全員の画面を同期", exact: true })
      .click();
    const followCard = guest.locator(
      ".host-follow-overlay [data-slide-survey]",
    );
    await expect(followCard).toContainText("今日の気づき");
    await guest.keyboard.press("Tab");
    await expect(launch(guest)).toBeFocused();
    await guest.keyboard.press("Tab");
    await expect(
      followCard.getByRole("textbox", { name: "スライド内アンケートの回答" }),
    ).toBeFocused();
    await followCard
      .getByRole("textbox", { name: "スライド内アンケートの回答" })
      .fill("集合中も記述して回答🌸");
    await followCard.locator("textarea,input").first().blur();
    await expect(followCard).toContainText("回答は保存済みです。");
    expect(
      (await list()).find((s: any) => s.id === ids.text).results.texts,
    ).toEqual(["集合中も記述して回答🌸"]);
    await launch(guest).click();
    await expect(dialog(guest)).toBeVisible();
    await expect(guest.getByRole("dialog")).toHaveCount(1);
    await dialog(guest).focus();
    await page
      .getByRole("button", { name: "全員の画面を同期", exact: true })
      .click();
    await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
    await expect(dialog(guest)).toBeFocused();
    await guest
      .getByRole("button", { name: "アンケートを閉じる", exact: true })
      .click();
    await expect(launch(guest)).toBeFocused();
    await guest.reload();
    await expect(guest.locator(".slide-card")).toHaveCount(5);
    const remote = await (await page.request.get(`/api/decks/${id}`)).json();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(remote.state));
    const serialized = JSON.stringify(readSharedDeck(doc));
    doc.destroy();
    expect(serialized).toContain('"surveyId"');
    expect(serialized).not.toContain("集合中も記述して回答");
    await expect(
      guest.locator(
        ".slide-card .slide-survey input,.slide-card .slide-survey textarea",
      ),
    ).toHaveCount(0);
    await guest.locator(".thumbnail").nth(1).click();
    const reopened = guest.locator(".editor-workspace [data-slide-survey]");
    await expect(
      reopened.getByRole("textbox", { name: "スライド内アンケートの回答" }),
    ).toHaveValue("集合中も記述して回答🌸");
    await page.request.post(`/api/decks/${id}/surveys/${ids.text}/status`, {
      headers,
      data: { status: "closed" },
    });
    await expect(
      reopened.getByRole("textbox", { name: "スライド内アンケートの回答" }),
    ).toBeDisabled();
    await page.request.delete(`/api/decks/${id}/surveys/${ids.text}`, {
      headers,
    });
    await expect(reopened.locator("form")).toHaveCount(0);
    await expect(reopened).toContainText("未公開・削除済み");
    await page.screenshot({
      path: info.outputPath("embedded-survey.png"),
      fullPage: true,
    });
  } finally {
    await guestContext.close();
  }
});

test("existing result graphs link without new slides and refresh for guests while the host is offline", async ({
  page,
  browser,
}, info) => {
  const guestContext = await browser.newContext(info.project.use);
  const guest = await guestContext.newPage();
  try {
    await signIn(page, "live-host");
    await signIn(guest, "live-guest");
    const headers = { Origin: "http://127.0.0.1:3187" };
    const { insertSurveyResults } = await import("../../src/surveySlides");
    const initial = sample();
    const legacy = insertSurveyResults(initial, initial.slides[0], {
      id: crypto.randomUUID(),
      question: "好きな季節",
      kind: "single",
      options: ["春", "夏"],
      status: "open",
      created: 1,
      results: { count: 1, counts: [1, 0], texts: [] },
    });
    const created = await page.request.post("/api/decks", {
      headers,
      data: legacy.book,
    });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    await page.request.post(`/api/decks/${id}/surveys`, {
      headers,
      data: { question: "好きな季節", kind: "single", options: ["春", "夏"] },
    });
    const survey = (
      await (await page.request.get(`/api/decks/${id}/surveys`)).json()
    ).surveys[0];
    await page.request.post(`/api/decks/${id}/surveys/${survey.id}/status`, {
      headers,
      data: { status: "open" },
    });
    const invite = await page.request.post(`/api/decks/${id}/invite`, {
      headers,
    });
    const token = new URL((await invite.json()).url).searchParams.get("join");
    const pending = await (
      await guest.request.post(`/api/invites/${token}/accept`, { headers })
    ).json();
    if (pending.status === "pending")
      await page.request.post(`/api/decks/${id}/join-requests/approve`, {
        headers,
        data: { requestIds: [pending.requestId] },
      });
    expect(
      (
        await guest.request.post(
          `/api/decks/${id}/surveys/${survey.id}/answer`,
          { headers, data: { choices: [0], text: "" } },
        )
      ).status(),
    ).toBe(200);
    await page.goto(`/?room=${id}`);
    await guest.goto(`/?room=${id}`);
    await expect(page.locator(".slide-card")).toHaveCount(6);
    await expect(guest.locator(".slide-card")).toHaveCount(6);
    await page.locator(".slide-card:has(.chart-graphic) .thumbnail").click();
    await expect(page.locator(".editor-workspace .chart-graphic")).toHaveCount(
      1,
    );
    await launch(page).click();
    await page
      .getByRole("button", {
        name: "このページの既存グラフを連動",
        exact: true,
      })
      .click();
    await expect(dialog(page)).toHaveCount(0);
    const hostGraph = page.locator(
      '.editor-workspace .chart-graphic[data-survey-result="live"]',
    );
    const guestGraph = guest.locator(
      '.slide-card .chart-graphic[data-survey-result="live"]',
    );
    await expect(hostGraph).toHaveCount(1);
    await expect(guestGraph).toHaveCount(1);
    await expect(guestGraph.locator(":scope > title")).toContainText("春 1");
    await page.goto("about:blank");
    expect(
      (
        await guest.request.post(
          `/api/decks/${id}/surveys/${survey.id}/answer`,
          { headers, data: { choices: [1], text: "" } },
        )
      ).status(),
    ).toBe(200);
    await expect(guestGraph.locator(":scope > title")).toContainText("春 0");
    await expect(guestGraph.locator(":scope > title")).toContainText("夏 1");
    const published = (
      await (await guest.request.get(`/api/decks/${id}/surveys`)).json()
    ).surveys[0];
    expect(published.results).toBeUndefined();
    expect(published.chartSummary).toEqual({ count: 1, counts: [0, 1] });
    expect(
      (
        await guest.request.post(
          `/api/decks/${id}/surveys/${survey.id}/publish`,
          { headers, data: { enabled: false } },
        )
      ).status(),
    ).toBe(403);
    await guest.locator(".slide-card:has(.chart-graphic) .thumbnail").click();
    await guest.getByRole("button", { name: "発表する", exact: true }).click();
    const presentGraph = guest.locator(
      '.present-mode .chart-graphic[data-survey-result="live"]',
    );
    if ((await presentGraph.count()) === 0) {
      await guest.mouse.move(10, 10);
      await guest
        .getByRole("button", { name: "次の話題", exact: true })
        .click();
    }
    await expect(presentGraph.locator(":scope > title")).toContainText("夏 1");
    expect(
      (
        await guest.request.post(
          `/api/decks/${id}/surveys/${survey.id}/answer`,
          { headers, data: { choices: [0], text: "" } },
        )
      ).status(),
    ).toBe(200);
    await expect(presentGraph.locator(":scope > title")).toContainText("春 1");
    await expect(presentGraph.locator(":scope > title")).toContainText("夏 0");
    await guest.screenshot({
      path: info.outputPath("live-survey-graph.png"),
      fullPage: true,
    });
    await page.goto(`/?room=${id}`);
    await expect(page.locator(".slide-card")).toHaveCount(6);
    const remote = await (await page.request.get(`/api/decks/${id}`)).json();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromBase64(remote.state));
    const book = readSharedDeck(doc);
    doc.destroy();
    expect(book.slides).toHaveLength(6);
    expect(JSON.stringify(book)).not.toContain("live-guest@example.test");
    expect(
      book.slides
        .flatMap((s) => s.elements)
        .some((e) => e.surveyResult?.surveyId === survey.id),
    ).toBe(true);
    await launch(page).click();
    await page
      .getByRole("button", {
        name: "グラフの自動更新・集計共有を停止",
        exact: true,
      })
      .click();
    await expect(presentGraph).toHaveCount(0);
    expect(
      (await (await guest.request.get(`/api/decks/${id}/surveys`)).json())
        .surveys[0].chartSummary,
    ).toBeUndefined();
  } finally {
    await guestContext.close();
  }
});
