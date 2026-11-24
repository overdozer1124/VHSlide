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
