import { test, expect, type Page } from "@playwright/test";
import * as Y from "yjs";
import { fromBase64, readSharedDeck } from "../../src/sharedDeck";
import type { Deck } from "../../src/model";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";

async function readBook(page: Page, id: string): Promise<Deck> {
  const result = await (await page.request.get(`/api/decks/${id}`)).json();
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(result.state));
  return readSharedDeck(doc);
}

const headers = { Origin: scopeOrigin };

/** Add a view-only student (access mode "none"): the point of the
 * feature is that even they can build their own slide. */
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
                mode: "none",
                comment: false,
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

/** Open the first slide of the deck from the map, retrying while
 * the room loads (same pattern as the thinking specs). */
async function openFirstSlide(
  page: Page,
  visible: () => Promise<boolean>,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await visible()) return;
    const cards = page.locator(".slide-card");
    if ((await cards.count()) > 0)
      await cards.first().click({ timeout: 8_000 }).catch(() => {});
    if (await visible()) return;
    const back = page.getByRole("button", { name: "全体マップへ" });
    if ((await back.count()) > 0)
      await back.first().click({ timeout: 5_000 }).catch(() => {});
  }
  expect(await visible()).toBe(true);
}

const shown = (locator: ReturnType<Page["locator"]>) => async () =>
  await locator
    .first()
    .isVisible()
    .catch(() => false);

test("free-edit slide: student builds a copy, host sees it in the console", async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name.includes("touch"),
    "touch viewport taps differ on the fixture deck",
  );
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-editslide-host`);
  const guestName = `${info.project.name}-editslide-one`;
  const guest2Name = `${info.project.name}-editslide-two`;
  await addGuest(page, id, guestName);
  await addGuest(page, id, guest2Name);

  // The fixture deck's first slide, for the source-unchanged check.
  const sourceElements = (await readBook(page, id)).slides[0].elements.length;

  // Host: designate the first slide and open the intake, from the
  // form panel's 生徒の編集用 tab.
  await page.goto(`/?room=${id}`);
  await openFirstSlide(
    page,
    shown(page.getByRole("button", { name: "フォーム", exact: true })),
  );
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  const panel = page.locator(".activity-panel");
  await panel.getByRole("tab", { name: "生徒の編集用" }).click();
  await panel
    .getByRole("button", { name: "このスライドを生徒の編集用にする" })
    .click();
  await panel.getByRole("button", { name: "受付を開始" }).click();
  await expect(panel.getByText("受付中")).toBeVisible({ timeout: 15_000 });
  await panel
    .getByRole("button", { name: "生徒の編集用を閉じる" })
    .click({ timeout: 5_000 })
    .catch(() => {});

  // Student: the launch button appears on the base slide; build a
  // slide in the studio and let it autosave.
  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  await student.goto(`/?room=${id}`);
  await openFirstSlide(student, shown(student.locator(".edit-slide-launch")));
  await student.locator(".edit-slide-launch").click();
  const studio = student.locator(".edit-studio");
  await expect(studio).toBeVisible({ timeout: 15_000 });
  await studio.getByRole("button", { name: "文字" }).click();
  await expect(studio.getByText("保存しました")).toBeVisible({
    timeout: 20_000,
  });
  // Add a photo through the answer-only upload, and save again.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  await studio.locator('input[type="file"]').setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(studio.locator(".canvas-scale img")).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(studio.getByText("保存しました")).toBeVisible({
    timeout: 20_000,
  });
  await studio.getByRole("button", { name: "閉じる" }).click();
  await expect(
    student.getByRole("button", { name: "自分のスライドを編集する" }),
  ).toBeVisible({ timeout: 15_000 });

  // The second student has no answer and cannot see the first one's.
  const list = await (
    await student.request.get(`/api/decks/${id}/edit-slides`, { headers })
  ).json();
  expect(list.editSlides[0].mine.slide.elements.length).toBeGreaterThan(
    sourceElements,
  );
  const context2 = await browser.newContext({ baseURL: scopeOrigin });
  const student2 = await context2.newPage();
  await scopeLogin(student2, guest2Name);
  const list2 = await (
    await student2.request.get(`/api/decks/${id}/edit-slides`, { headers })
  ).json();
  expect(list2.editSlides[0].mine).toBeUndefined();
  expect(list2.editSlides[0].answers).toBeUndefined();

  // The answer photo lives on its own path: the author and the
  // host can read it, the other student cannot, and it is not a
  // deck asset.
  const photoSrc = (
    list.editSlides[0].mine.slide.elements as { src?: string }[]
  ).find((e) => e.src?.includes("answer-assets"))?.src;
  expect(photoSrc).toBeTruthy();
  expect(
    (await student.request.get(photoSrc!, { headers })).status(),
  ).toBe(200);
  expect(
    (await student2.request.get(photoSrc!, { headers })).status(),
  ).toBe(404);
  expect((await page.request.get(photoSrc!, { headers })).status()).toBe(200);
  const assetId = photoSrc!.split("/").pop();
  expect(
    (
      await page.request.get(`/api/decks/${id}/assets/${assetId}`, {
        headers,
      })
    ).status(),
  ).toBe(404);

  // The teacher's original slide did not change.
  expect((await readBook(page, id)).slides[0].elements.length).toBe(
    sourceElements,
  );

  // Host console: the answer is listed, the other student is 未作成.
  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "授業コンソール" }).click();
  const consoleView = page.getByRole("region", { name: "授業コンソール" });
  await consoleView.getByRole("tab", { name: "生徒のスライド" }).click();
  await expect(
    consoleView.getByText(/生徒が作ったスライド（1人）/),
  ).toBeVisible({ timeout: 15_000 });
  await expect(consoleView.getByText(/未作成（1人）/)).toBeVisible({
    timeout: 15_000,
  });
  await context.close();
  await context2.close();
});

test("free-edit feedback: host sends back, student resubmits", async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name.includes("touch"),
    "touch viewport taps differ on the fixture deck",
  );
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-editfb-host`);
  const guestName = `${info.project.name}-editfb-one`;
  await addGuest(page, id, guestName);
  const book = await readBook(page, id);
  const source = book.slides[0];

  // Setup over the API: definition open, the student answers, the
  // host closes the intake.
  const created = await (
    await page.request.post(`/api/decks/${id}/edit-slides`, {
      headers,
      data: { source: source.id, slide: source },
    })
  ).json();
  const defId = created.editSlides[0].id as string;
  await page.request.post(`/api/decks/${id}/edit-slides/${defId}/status`, {
    headers,
    data: { status: "open" },
  });
  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  const mine = await (
    await student.request.get(`/api/decks/${id}/edit-slides`, { headers })
  ).json();
  expect(
    (
      await student.request.post(
        `/api/decks/${id}/edit-slides/${defId}/answer`,
        {
          headers,
          data: { slide: mine.editSlides[0].base, baseUpdated: 0 },
        },
      )
    ).status(),
  ).toBe(200);
  await page.request.post(`/api/decks/${id}/edit-slides/${defId}/status`, {
    headers,
    data: { status: "closed" },
  });

  // Host console: open the student's slide and send it back with a
  // comment and a stamp.
  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "授業コンソール" }).click();
  const consoleView = page.getByRole("region", { name: "授業コンソール" });
  await consoleView.getByRole("tab", { name: "生徒のスライド" }).click();
  await expect(
    consoleView.getByText(/生徒が作ったスライド（1人）/),
  ).toBeVisible({ timeout: 15_000 });
  await consoleView.locator(".console-edit-card").first().click();
  const dialog = page.locator(".console-edit-large");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog
    .getByLabel("フィードバックのコメント")
    .fill("ここを直してください");
  await dialog.getByLabel("スタンプ").selectOption("もう一歩");
  await dialog.getByLabel(/書き直してほしい/).check();
  await dialog.getByRole("button", { name: "送る" }).click();
  await expect(dialog.getByText("差し戻し中")).toBeVisible({
    timeout: 15_000,
  });
  await dialog.getByRole("button", { name: "閉じる" }).click();
  // The card flags the send-back without any reload.
  await expect(consoleView.getByText("差し戻し中")).toBeVisible({
    timeout: 20_000,
  });

  // Student: the feedback shows on the base slide, the studio
  // re-opens despite the closed intake, and 出し直す closes the
  // send-back.
  await student.goto(`/?room=${id}`);
  await openFirstSlide(student, shown(student.locator(".edit-slide-feedback")));
  await expect(student.locator(".edit-slide-feedback")).toContainText(
    "ここを直してください",
    { timeout: 15_000 },
  );
  await student.locator(".edit-slide-launch").click();
  const studio = student.locator(".edit-studio");
  await expect(studio).toBeVisible({ timeout: 15_000 });
  // Rewrite something and let it save (the resubmission flag needs
  // a save after the send-back), then resubmit.
  await studio.getByRole("button", { name: "文字" }).click();
  await expect(studio.getByText("保存しました")).toBeVisible({
    timeout: 20_000,
  });
  await studio.getByRole("button", { name: "出し直す" }).click();
  await expect(studio).toBeHidden({ timeout: 15_000 });

  // Host console, still open from before: the card switches from
  // 差し戻し中 to 再提出 on its own (no reload).
  await expect(consoleView.getByText("再提出")).toBeVisible({
    timeout: 20_000,
  });
  await expect(consoleView.getByText("差し戻し中")).toBeHidden({
    timeout: 20_000,
  });
  await context.close();
});

test("free-edit shares: gallery publishing and follow showing", async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name.includes("touch"),
    "touch viewport taps differ on the fixture deck",
  );
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-editshare-host`);
  const guestName = `${info.project.name}-editshare-one`;
  const guest2Name = `${info.project.name}-editshare-two`;
  await addGuest(page, id, guestName);
  await addGuest(page, id, guest2Name);
  const book = await readBook(page, id);
  const source = book.slides[0];

  // Setup over the API: definition open, the student answers with
  // a distinctive text element.
  const created = await (
    await page.request.post(`/api/decks/${id}/edit-slides`, {
      headers,
      data: { source: source.id, slide: source },
    })
  ).json();
  const defId = created.editSlides[0].id as string;
  await page.request.post(`/api/decks/${id}/edit-slides/${defId}/status`, {
    headers,
    data: { status: "open" },
  });
  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  const mine = await (
    await student.request.get(`/api/decks/${id}/edit-slides`, { headers })
  ).json();
  // The answer carries a photo too, so the follow test can watch
  // who may read it.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
  );
  const uploaded = await (
    await student.request.post(
      `/api/decks/${id}/edit-slides/${defId}/answer-assets`,
      { headers: { ...headers, "Content-Type": "image/png" }, data: png },
    )
  ).json();
  const photoSrc = uploaded.src as string;
  const answerSlide = {
    ...mine.editSlides[0].base,
    elements: [
      ...mine.editSlides[0].base.elements,
      {
        id: "share-text",
        type: "text",
        x: 60,
        y: 60,
        w: 400,
        h: 80,
        text: "みんなへの作品",
        fontSize: 32,
        color: "#173d38",
      },
      {
        id: "share-photo",
        type: "image",
        x: 500,
        y: 60,
        w: 200,
        h: 150,
        src: photoSrc,
      },
    ],
  };
  expect(
    (
      await student.request.post(
        `/api/decks/${id}/edit-slides/${defId}/answer`,
        { headers, data: { slide: answerSlide, baseUpdated: 0 } },
      )
    ).status(),
  ).toBe(200);

  // Host console, large view of the student's slide.
  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "授業コンソール" }).click();
  const consoleView = page.getByRole("region", { name: "授業コンソール" });
  await consoleView.getByRole("tab", { name: "生徒のスライド" }).click();
  await expect(
    consoleView.getByText(/生徒が作ったスライド（1人）/),
  ).toBeVisible({ timeout: 15_000 });
  await consoleView.locator(".console-edit-card").first().click();
  const dialog = page.locator(".console-edit-large");
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  const context2 = await browser.newContext({ baseURL: scopeOrigin });
  const student2 = await context2.newPage();
  await scopeLogin(student2, guest2Name);

  // Follow first (before any gallery share exists): the host
  // shows the snapshot to the whole class; the student's screen
  // switches to it. While it shows, the other student may read
  // the answer's photo through the snapshot.
  await student.goto(`/?room=${id}`);
  await openFirstSlide(student, shown(student.locator(".edit-slide-launch")));
  await dialog.getByRole("button", { name: "集合で見せる" }).click();
  const overlay = student.locator(".host-follow-overlay");
  await expect(overlay).toBeVisible({ timeout: 20_000 });
  await expect(overlay.getByText("みんなへの作品")).toBeVisible({
    timeout: 20_000,
  });
  expect(
    (await student2.request.get(photoSrc, { headers })).status(),
  ).toBe(200);
  // Stopping the follow from somewhere else — a second host tab's
  // follow toggle, not the console button — must end the photo
  // access too (the snapshot row alone must not keep it alive).
  const host2 = await page.context().newPage();
  await host2.goto(`/?room=${id}`);
  const followToggle = host2.getByRole("button", {
    name: "全員の画面を同期",
  });
  await expect(followToggle).toHaveAttribute("aria-pressed", "true", {
    timeout: 20_000,
  });
  await followToggle.click();
  await expect(overlay).toBeHidden({ timeout: 20_000 });
  expect(
    (await student2.request.get(photoSrc, { headers })).status(),
  ).toBe(404);
  await host2.close();

  // Then publish the answer into the response gallery; the other
  // student finds it in the shared response workspace.
  await dialog
    .getByRole("button", { name: "回答スライド共有に出す" })
    .click();
  await expect(
    dialog.getByRole("button", { name: "共有を取り消す" }),
  ).toBeVisible({ timeout: 15_000 });
  await student2.goto(`/?room=${id}`);
  await openFirstSlide(
    student2,
    shown(student2.getByRole("button", { name: "フォーム", exact: true })),
  );
  await student2
    .getByRole("button", { name: "フォーム", exact: true })
    .click();
  const panel2 = student2.locator(".activity-panel");
  await panel2.getByRole("tab", { name: "回答スライド" }).click();
  await panel2
    .getByRole("button", { name: "共有された回答を開く" })
    .click();
  const workspace = student2.locator(".response-workspace");
  await expect(workspace.getByText("生徒が作ったスライド")).toBeVisible({
    timeout: 15_000,
  });
  await workspace
    .getByRole("button", { name: "生徒のスライドを閲覧" })
    .click();
  await expect(workspace.getByText("みんなへの作品")).toBeVisible({
    timeout: 15_000,
  });
  await context.close();
  await context2.close();
});
