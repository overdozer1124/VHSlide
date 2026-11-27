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

test("class webbing: the whole class grows one shared map", async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name.includes("touch"),
    "touch viewport taps differ on the fixture deck",
  );
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-webclass-host`);
  const guestName = `${info.project.name}-webclass-one`;
  const guestTwo = `${info.project.name}-webclass-two`;
  await addGuest(page, id, guestName);
  await addGuest(page, id, guestTwo);
  // A class-unit webbing tool is creatable now (the integration).
  const created = await page.request.post(`/api/decks/${id}/thinking`, {
    headers,
    data: {
      template: "webbing",
      unit: "class",
      definition: { title: "将来の夢" },
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
  const card = panel.locator(".thinking-tool-card", { hasText: "将来の夢" });
  await card.getByRole("button", { name: "スライドに配置" }).click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });

  // Student one starts the shared map.
  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  await student.goto(`/?room=${id}`);
  const slide = await enterSlide(student);
  const web = slide.locator(".thinking-webbing");
  await expect(web).toBeVisible({ timeout: 15_000 });
  await expect(web.locator(".thinking-webbing-centre-chip")).toHaveText(
    "将来の夢",
  );
  await web.getByLabel("新しい言葉").fill("宇宙飛行士");
  await web.getByRole("button", { name: "中心に足す" }).click();
  const rootChip = web.locator(".thinking-webbing-node", {
    hasText: "宇宙飛行士",
  });
  await expect(rootChip).toBeVisible({ timeout: 15_000 });
  // The author's name rides on the node (like the old shared map).
  await expect(rootChip.locator(".thinking-webbing-author")).not.toHaveText("");

  // Student two sees the same shared map (with student one's word
  // and name on it) and adds their own word, then grows a child off
  // it. (Branching off ANOTHER student's node is covered by the
  // unit tests: in this fixture's edit-capable canvas a click on a
  // node starts an element drag, as with every surface, so the E2E
  // drives selection through the auto-selected fresh node instead.)
  const context2 = await browser.newContext({ baseURL: scopeOrigin });
  const student2 = await context2.newPage();
  await scopeLogin(student2, guestTwo);
  await student2.goto(`/?room=${id}`);
  const slide2 = await enterSlide(student2);
  const web2 = slide2.locator(".thinking-webbing");
  const root2 = web2.locator(".thinking-webbing-node", {
    hasText: "宇宙飛行士",
  });
  await expect(root2).toBeVisible({ timeout: 15_000 });
  await expect(root2.locator(".thinking-webbing-author")).not.toHaveText("");
  await web2.getByLabel("新しい言葉").fill("先生");
  await web2.getByRole("button", { name: "中心に足す" }).click();
  await expect(
    web2.locator(".thinking-webbing-node", { hasText: "先生" }),
  ).toBeVisible({ timeout: 15_000 });
  // The fresh node is auto-selected, so the child goes straight on.
  await web2.getByLabel("新しい言葉").fill("訓練");
  await web2.getByRole("button", { name: "子を足す" }).click();
  await expect(
    web2.locator(".thinking-webbing-node", { hasText: "訓練" }),
  ).toBeVisible({ timeout: 15_000 });
  // And student one's screen picks up student two's words live.
  await expect(
    web.locator(".thinking-webbing-node", { hasText: "訓練" }),
  ).toBeVisible({ timeout: 15_000 });

  // The stored tree is one shared tree (owner "") with two nodes.
  const list = await page.request.get(
    `/api/decks/${id}/thinking?caps=board,steps,flow`,
    { headers },
  );
  const tools = (await list.json()).thinking as {
    id: string;
    unit: string;
    nodes: { text: string; owner: string }[];
  }[];
  const tool = tools.find((t) => t.id === toolId)!;
  expect(tool.unit).toBe("class");
  expect(tool.nodes.map((n) => n.text).sort()).toEqual([
    "先生",
    "宇宙飛行士",
    "訓練",
  ]);
  expect(tool.nodes.every((n) => n.owner === "")).toBe(true);

  // The old webbing tab no longer offers map creation; it points at
  // the thinking tools instead (existing maps would still live here).
  // (Placing the tool closed the panel; reopen it.)
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await panel.getByRole("tab", { name: "ウェブマップ" }).click();
  await expect(panel.locator(".webbing-create")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "思考ツールを開く" }),
  ).toBeVisible();
  await context.close();
  await context2.close();
});
