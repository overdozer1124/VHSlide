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
              access: { mode: "all", comment: true, rows: [], columns: [], slides: [] },
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
}

async function createTool(
  page: Page,
  id: string,
  body: Record<string, unknown>,
): Promise<string> {
  const created = await page.request.post(`/api/decks/${id}/thinking`, {
    headers,
    data: body,
  });
  expect(created.status()).toBe(200);
  const toolId = (await created.json()).createdId as string;
  expect(toolId).toBeTruthy();
  expect(
    (
      await page.request.post(`/api/decks/${id}/thinking/${toolId}/status`, {
        headers,
        data: { status: "open" },
      })
    ).status(),
  ).toBe(200);
  return toolId;
}

async function placeTool(page: Page, title: string) {
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  const panel = page.locator(".activity-panel");
  await panel.getByRole("tab", { name: "思考ツール" }).click();
  const card = panel.locator(".thinking-tool-card", { hasText: title });
  await card.getByRole("button", { name: "スライドに配置" }).click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });
}

async function openSlide(page: Page) {
  await page.locator(".slide-card").first().click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });
}

async function clickSurface(page: Page, fx: number, fy: number) {
  const surface = page.locator(".slide-thinking.is-interactive .thinking-surface");
  const box = await surface.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width * fx, box!.y + box!.height * fy);
}

async function pointsOf(page: Page, id: string, toolId: string) {
  const data = await (
    await page.request.get(`/api/decks/${id}/thinking`, { headers })
  ).json();
  const tool = data.thinking.find((t: { id: string }) => t.id === toolId);
  return (tool?.points ?? []) as {
    owner: string;
    scene: string;
    value: { x?: number; y?: number; v?: number };
    reason: string;
  }[];
}

test("individual axis points stay per-scene with ghosts and reasons", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-think-host`);
  const guestName = `${info.project.name}-think-student`;
  await addGuest(page, id, guestName);
  const toolId = await createTool(page, id, {
    template: "axis2",
    unit: "individual",
    definition: {
      title: "賛成と自信",
      xMin: "反対",
      xMax: "賛成",
      yMin: "自信がない",
      yMax: "自信がある",
      scenes: [
        { id: "s1", label: "読む前" },
        { id: "s2", label: "話し合い後" },
      ],
      sceneMode: "teacher",
      reason: true,
    },
  });
  await page.goto(`/?room=${id}`);
  await placeTool(page, "賛成と自信");

  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  await student.goto(`/?room=${id}`);
  await openSlide(student);
  await clickSurface(student, 0.25, 0.75);
  await expect(student.locator(".slide-thinking.is-interactive .thinking-point.is-mine")).toBeVisible({
    timeout: 15_000,
  });
  await student
    .locator(".slide-thinking.is-interactive")
    .getByLabel("理由")
    .fill("たぶん賛成");
  // Blur the textarea (committing the reason) without placing a point.
  await student.locator(".slide-thinking.is-interactive .webbing-title").click();
  await expect
    .poll(async () => (await pointsOf(student, id, toolId)).length)
    .toBe(1);
  const first = (await pointsOf(student, id, toolId))[0];
  expect(first.scene).toBe("s1");
  expect(Math.abs((first.value.x ?? 0) - 0.25)).toBeLessThan(0.08);
  expect(Math.abs((first.value.y ?? 0) - 0.25)).toBeLessThan(0.08);
  // The reason autosaves shortly after typing stops.
  await expect
    .poll(async () => (await pointsOf(student, id, toolId))[0]?.reason, {
      timeout: 15_000,
    })
    .toBe("たぶん賛成");

  // The host moves the lesson to the second scene; the student follows,
  // sees the first point ghosted, and adds a new one.
  expect(
    (
      await page.request.post(`/api/decks/${id}/thinking/${toolId}/scene`, {
        headers,
        data: { scene: "s2" },
      })
    ).status(),
  ).toBe(200);
  await expect(student.locator(".slide-thinking.is-interactive .thinking-point.is-ghost")).toHaveCount(1, {
    timeout: 20_000,
  });
  await clickSurface(student, 0.8, 0.2);
  await expect
    .poll(async () => (await pointsOf(student, id, toolId)).length)
    .toBe(2);
  // The host sees both points (the class distribution data).
  expect((await pointsOf(page, id, toolId)).length).toBe(2);
  await context.close();
});

test("a class tool gives every student their own point", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-class-host`);
  const guestName = `${info.project.name}-class-student`;
  await addGuest(page, id, guestName);
  const toolId = await createTool(page, id, {
    template: "axis1",
    unit: "class",
    definition: {
      title: "クラスの気持ち",
      xMin: "いや",
      xMax: "よい",
      reason: false,
    },
  });
  await page.goto(`/?room=${id}`);
  await placeTool(page, "クラスの気持ち");
  // Placement leaves the host in the editor on that slide already.
  // The host's click places the host's own point.
  await clickSurface(page, 0.4, 0.5);
  await expect
    .poll(async () => (await pointsOf(page, id, toolId)).length)
    .toBe(1);

  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  await student.goto(`/?room=${id}`);
  await openSlide(student);
  // No shared point and no lock: the student receives no points yet
  // (the host's point is not handed out) and sees no lock note.
  await expect(
    student.locator(".slide-thinking.is-interactive .thinking-lock-note"),
  ).toHaveCount(0);
  expect((await pointsOf(student, id, toolId)).length).toBe(0);
  // The student places their own point; it is not blocked by the host's.
  await clickSurface(student, 0.7, 0.5);
  await expect(
    student.locator(".slide-thinking.is-interactive .thinking-point.is-mine"),
  ).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await pointsOf(student, id, toolId)).length)
    .toBe(1);
  const mine = (await pointsOf(student, id, toolId))[0];
  expect(Math.abs((mine.value.v ?? 0) - 0.7)).toBeLessThan(0.08);
  // The host receives both points — the class distribution.
  await expect
    .poll(async () => (await pointsOf(page, id, toolId)).length)
    .toBe(2);
  await context.close();
});

test("a group point is shared inside the group only", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-group-host`);
  const nameA = `${info.project.name}-group-a`;
  const nameB = `${info.project.name}-group-b`;
  const nameC = `${info.project.name}-group-c`;
  await addGuest(page, id, nameA);
  await addGuest(page, id, nameB);
  await addGuest(page, id, nameC);
  expect(
    (
      await page.request.post(`/api/decks/${id}/groups`, {
        headers,
        data: { names: ["1班", "2班"] },
      })
    ).status(),
  ).toBe(200);
  const groups = (
    await (
      await page.request.get(`/api/decks/${id}/groups`, { headers })
    ).json()
  ).groups as { id: string; name: string }[];
  const g1 = groups.find((g) => g.name === "1班")!;
  const toolId = await createTool(page, id, {
    template: "emotion",
    unit: "group",
    definition: { title: "班の気持ち", xMin: "いや", xMax: "よい", reason: false },
  });
  await page.goto(`/?room=${id}`);
  await placeTool(page, "班の気持ち");

  const ctxA = await browser.newContext({ baseURL: scopeOrigin });
  const a = await ctxA.newPage();
  await scopeLogin(a, nameA);
  expect(
    (
      await a.request.post(`/api/decks/${id}/groups/join`, {
        headers,
        data: { groupId: g1.id },
      })
    ).status(),
  ).toBe(200);
  await a.goto(`/?room=${id}`);
  await openSlide(a);
  await clickSurface(a, 0.3, 0.5);
  await expect
    .poll(async () => (await pointsOf(a, id, toolId)).length)
    .toBe(1);

  const ctxB = await browser.newContext({ baseURL: scopeOrigin });
  const b = await ctxB.newPage();
  await scopeLogin(b, nameB);
  expect(
    (
      await b.request.post(`/api/decks/${id}/groups/join`, {
        headers,
        data: { groupId: g1.id },
      })
    ).status(),
  ).toBe(200);
  await b.goto(`/?room=${id}`);
  await openSlide(b);
  // The same shared point is B's point too.
  await expect(b.locator(".slide-thinking.is-interactive .thinking-point.is-mine")).toBeVisible({
    timeout: 15_000,
  });
  const bPoints = await pointsOf(b, id, toolId);
  expect(bPoints.length).toBe(1);
  expect(bPoints[0].owner).toBe(g1.id);

  const ctxC = await browser.newContext({ baseURL: scopeOrigin });
  const c = await ctxC.newPage();
  await scopeLogin(c, nameC);
  await c.goto(`/?room=${id}`);
  await openSlide(c);
  await expect(c.locator(".slide-thinking.is-interactive .thinking-join")).toBeVisible({ timeout: 15_000 });
  expect((await pointsOf(c, id, toolId)).length).toBe(0);
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test("the console thinking tab shows the class distribution", async (
  { page, browser },
  info,
) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-console-host`);
  const guestName = `${info.project.name}-console-student`;
  await addGuest(page, id, guestName);
  const toolId = await createTool(page, id, {
    template: "axis2",
    unit: "individual",
    definition: {
      title: "賛成と自信",
      xMin: "反対",
      xMax: "賛成",
      yMin: "自信がない",
      yMax: "自信がある",
      scale: "none",
      scenes: [{ id: "s1", label: "場面1" }],
      sceneMode: "teacher",
      reason: false,
    },
  });

  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  expect(
    (
      await student.request.post(
        `/api/decks/${id}/thinking/${toolId}/point`,
        { headers, data: { scene: "s1", value: { x: 0.3, y: 0.6 } } },
      )
    ).status(),
  ).toBe(200);
  await context.close();

  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "授業コンソール" }).click();
  const console_ = page.getByRole("region", { name: "授業コンソール" });
  await console_.getByRole("tab", { name: "思考ツール" }).click();
  await expect(
    console_.locator(".thinking-results-surface .thinking-point.is-other"),
  ).toHaveCount(1, { timeout: 20_000 });
  await expect(console_.locator(".thinking-results-count")).toContainText(
    "1",
  );
});

test("the host slide narrows points to one student, names off by default", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-focus-host`);
  const nameA = `${info.project.name}-focus-ana`;
  const nameB = `${info.project.name}-focus-ben`;
  await addGuest(page, id, nameA);
  await addGuest(page, id, nameB);
  const toolId = await createTool(page, id, {
    template: "axis1",
    unit: "class",
    definition: {
      title: "絞り込みの気持ち",
      xMin: "いや",
      xMax: "よい",
      reason: false,
    },
  });
  await page.goto(`/?room=${id}`);
  await placeTool(page, "絞り込みの気持ち");

  const place = async (name: string, v: number) => {
    const context = await browser.newContext({ baseURL: scopeOrigin });
    const student = await context.newPage();
    await scopeLogin(student, name);
    await student.goto(`/?room=${id}`);
    await openSlide(student);
    await clickSurface(student, v, 0.5);
    await expect(
      student.locator(
        ".slide-thinking.is-interactive .thinking-point.is-mine",
      ),
    ).toBeVisible({ timeout: 15_000 });
    // Students never see the host's display controls.
    await expect(student.locator(".thinking-hostbar")).toHaveCount(0);
    await context.close();
  };
  await place(nameA, 0.3);
  await place(nameB, 0.75);
  await expect
    .poll(async () => (await pointsOf(page, id, toolId)).length)
    .toBe(2);

  const slide = page.locator(".slide-thinking.is-interactive");
  // Everyone's points, no names anywhere by default.
  await expect(slide.locator(".thinking-point.is-other")).toHaveCount(2, {
    timeout: 20_000,
  });
  await expect(slide.locator(".thinking-point-name")).toHaveCount(0);
  const bar = slide.locator(".thinking-hostbar");
  await expect(bar.getByRole("button", { name: "全員" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "生徒1" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "生徒2" })).toBeVisible();
  await expect(bar.getByRole("button", { name: nameA })).toHaveCount(0);

  // Narrow to one student: only their point remains.
  await bar.getByRole("button", { name: "生徒1" }).click();
  await expect(slide.locator(".thinking-point.is-other")).toHaveCount(1);

  // Names on: the chips and the focused point show the student's name,
  // and they agree with each other.
  await bar.getByRole("button", { name: "名前を出す" }).click();
  const activeChip = bar.locator("button.is-active");
  await expect(activeChip).toHaveCount(1);
  const shownName = (await activeChip.textContent())?.trim() ?? "";
  expect([nameA, nameB]).toContain(shownName);
  await expect(slide.locator(".thinking-point-name")).toHaveText(shownName);

  // Back to everyone: both points return, name labels go away again.
  await bar.getByRole("button", { name: "全員" }).click();
  await expect(slide.locator(".thinking-point.is-other")).toHaveCount(2);
  await expect(slide.locator(".thinking-point-name")).toHaveCount(0);
});
