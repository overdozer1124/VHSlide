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

async function enterSlide(student: Page) {
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
  return slide;
}

test("personal webbing: grow a tree, edit, host gallery and class share", async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name.includes("touch"),
    "touch viewport taps differ on the fixture deck",
  );
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-web-host`);
  const guestName = `${info.project.name}-web-one`;
  const guestTwo = `${info.project.name}-web-two`;
  await addGuest(page, id, guestName);
  await addGuest(page, id, guestTwo);
  const created = await page.request.post(`/api/decks/${id}/thinking`, {
    headers,
    data: {
      template: "webbing",
      unit: "individual",
      definition: { title: "海の生き物" },
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
    hasText: "海の生き物",
  });
  await card.getByRole("button", { name: "スライドに配置" }).click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });

  // The student grows a small webbing: a root word, a child, then
  // renames the child.
  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  await student.goto(`/?room=${id}`);
  const slide = await enterSlide(student);
  const web = slide.locator(".thinking-webbing");
  await expect(web).toBeVisible({ timeout: 15_000 });
  await expect(web.locator(".thinking-webbing-centre-chip")).toHaveText(
    "海の生き物",
  );
  await web.getByLabel("新しい言葉").fill("魚");
  await web.getByRole("button", { name: "中心に足す" }).click();
  const rootChip = web.locator(".thinking-webbing-node", { hasText: "魚" });
  await expect(rootChip).toBeVisible({ timeout: 15_000 });
  await rootChip.click();
  await web.getByLabel("新しい言葉").fill("さけ");
  await web.getByRole("button", { name: "子を足す" }).click();
  const childChip = web.locator(".thinking-webbing-node", {
    hasText: "さけ",
  });
  await expect(childChip).toBeVisible({ timeout: 15_000 });
  await childChip.click();
  await web.getByRole("button", { name: "言葉を直す" }).click();
  await web.getByLabel("言葉の内容").fill("サケ");
  await web.getByRole("button", { name: "保存" }).click();
  await expect(
    web.locator(".thinking-webbing-node", { hasText: "サケ" }),
  ).toBeVisible({ timeout: 15_000 });

  // The stored tree matches: サケ hangs off 魚, and the centre is
  // not a stored node.
  const list = await page.request.get(
    `/api/decks/${id}/thinking?caps=board,steps,flow`,
    { headers },
  );
  const view = (await list.json()).thinking.find(
    (t: { id: string }) => t.id === toolId,
  );
  expect(view.kind).toBe("flow");
  expect(view.nodes.map((n: { text: string }) => n.text)).toEqual([
    "魚",
    "サケ",
  ]);
  const root = view.nodes.find((n: { text: string }) => n.text === "魚");
  const child = view.nodes.find((n: { text: string }) => n.text === "サケ");
  expect(root.parent).toBeNull();
  expect(child.parent).toBe(root.id);
  // Without the flow capability the tool is hidden from old tabs.
  const oldList = await page.request.get(
    `/api/decks/${id}/thinking?caps=board,steps`,
    { headers },
  );
  expect(
    (await oldList.json()).thinking.some(
      (t: { id: string }) => t.id === toolId,
    ),
  ).toBe(false);

  // Host console: the gallery enlarges the student's webbing and
  // the share shows it to a second student with no ids inside.
  const context2 = await browser.newContext({ baseURL: scopeOrigin });
  const student2 = await context2.newPage();
  await scopeLogin(student2, guestTwo);
  await student2.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "授業コンソール" }).click();
  const console_ = page.getByRole("region", { name: "授業コンソール" });
  await console_.getByRole("tab", { name: "思考ツール" }).click();
  const results = console_.locator(".thinking-results");
  const thumb = results.locator(".thinking-thumb", { hasText: "生徒1" });
  await expect(thumb).toBeVisible({ timeout: 20_000 });
  await thumb.click();
  const expanded = results.locator(".thinking-webbing-mini.is-large");
  await expect(expanded).toBeVisible({ timeout: 15_000 });
  await expect(
    expanded.locator(".thinking-webbing-dot", { hasText: "サケ" }),
  ).toBeVisible();
  const shareResponse = student2.waitForResponse(
    (r) => r.url().includes("/thinking-share") && r.status() === 200,
    { timeout: 30_000 },
  );
  await results
    .getByRole("button", { name: "名前を出さずに全員に見せる" })
    .click();
  const overlay = student2.locator(
    '.host-follow-overlay[data-mode="thinking"]',
  );
  await expect(overlay).toBeVisible({ timeout: 20_000 });
  await expect(
    overlay.locator(".thinking-gallery-expanded h4"),
  ).toHaveText("生徒1のウェビング");
  await expect(
    overlay.locator(".thinking-webbing-dot", { hasText: "魚" }),
  ).toBeVisible();
  const payload = await (await shareResponse).text();
  expect(payload).not.toContain("author");
  expect(payload).not.toContain(root.id);
  expect(payload).not.toContain(guestName);
  await results.getByRole("button", { name: "見せるのをやめる" }).click();
  await expect(overlay).toHaveCount(0, { timeout: 20_000 });
  await context.close();
  await context2.close();
});
