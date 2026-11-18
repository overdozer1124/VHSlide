import { test, expect, type Page } from "@playwright/test";
import { scopeFixture, scopeLogin, scopeOrigin } from "../support/scopeCloud";
import { worksheetTemplate } from "../../src/worksheetTemplates";

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

test("learning record: host sees each student, students see only their own", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-record-host`);
  const guestName = `${info.project.name}-record-one`;
  const guest2Name = `${info.project.name}-record-two`;
  await addGuest(page, id, guestName);
  await addGuest(page, id, guest2Name);

  const template = worksheetTemplate("blank");
  template.title = "ふりかえり";
  template.fields[0].label = "かんそう";
  const created = await page.request.post(`/api/decks/${id}/worksheets`, {
    headers,
    data: template,
  });
  expect(created.status()).toBe(200);
  const sheet = (await created.json()).worksheets[0];
  const fieldId = sheet.fields[0].id as string;
  expect(
    (
      await page.request.post(`/api/decks/${id}/worksheets/${sheet.id}/status`, {
        headers,
        data: { status: "open" },
      })
    ).status(),
  ).toBe(200);

  const contexts: Page[] = [];
  for (const [name, text] of [
    [guestName, "ひとりめの感想"],
    [guest2Name, "ふたりめの感想"],
  ] as const) {
    const context = await browser.newContext({ baseURL: scopeOrigin });
    const student = await context.newPage();
    await scopeLogin(student, name);
    expect(
      (
        await student.request.post(
          `/api/decks/${id}/worksheets/${sheet.id}/answer`,
          { headers, data: { patch: true, values: { [fieldId]: text } } },
        )
      ).status(),
    ).toBe(200);
    contexts.push(student);
  }
  const [student1, student2] = contexts;

  // API rules: the all-students record is host-only, and "me" is
  // keyed by the signed-in account alone.
  expect(
    (await student1.request.get(`/api/decks/${id}/record`, { headers })).status(),
  ).toBe(403);
  const mine = await (
    await student1.request.get(`/api/decks/${id}/record/me`, { headers })
  ).json();
  expect(JSON.stringify(mine)).toContain("ひとりめの感想");
  expect(JSON.stringify(mine)).not.toContain("ふたりめの感想");
  const all = await (
    await page.request.get(`/api/decks/${id}/record`, { headers })
  ).json();
  expect(all.students).toHaveLength(2);
  const other = all.students.find(
    (s: { name: string }) => s.name === guest2Name,
  );
  // Even with the other student's real id in the query, "me" stays
  // keyed by the signed-in account alone.
  const mineWithParam = await (
    await student1.request.get(
      `/api/decks/${id}/record/me?user=${other.userId}`,
      { headers },
    )
  ).json();
  expect(JSON.stringify(mineWithParam)).toContain("ひとりめの感想");
  expect(JSON.stringify(mineWithParam)).not.toContain("ふたりめの感想");
  const filtered = await (
    await page.request.get(`/api/decks/${id}/record?user=${other.userId}`, {
      headers,
    })
  ).json();
  expect(filtered.students).toHaveLength(1);
  expect(filtered.students[0].name).toBe(guest2Name);

  // Host screen: pick a student, see only that student's answers.
  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "学びの記録" }).click();
  const screen = page.locator(".learning-record");
  await expect(screen.locator(".record-students button")).toHaveCount(2, {
    timeout: 15_000,
  });
  await expect(screen.locator(".record-timeline")).toContainText(
    "ひとりめの感想",
  );
  await expect(screen.locator(".record-timeline")).not.toContainText(
    "ふたりめの感想",
  );
  await screen
    .locator(".record-students button", { hasText: guest2Name })
    .click();
  await expect(screen.locator(".record-timeline")).toContainText(
    "ふたりめの感想",
  );
  await expect(screen.locator(".record-timeline")).not.toContainText(
    "ひとりめの感想",
  );

  // Student screen: only their own record, no student picker.
  await student2.goto(`/?room=${id}`);
  await student2.getByRole("button", { name: "学びの記録" }).click();
  const mine2 = student2.locator(".learning-record");
  await expect(mine2.locator(".record-timeline")).toContainText(
    "ふたりめの感想",
    { timeout: 15_000 },
  );
  await expect(mine2.locator(".record-timeline")).not.toContainText(
    "ひとりめの感想",
  );
  await expect(mine2.locator(".record-students")).toHaveCount(0);
});

test("answer-status matrix: cells show coverage and open the slide", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-record-matrix`);
  const guestName = `${info.project.name}-matrix-one`;
  const guest2Name = `${info.project.name}-matrix-two`;
  await addGuest(page, id, guestName);
  await addGuest(page, id, guest2Name);

  const created = await page.request.post(`/api/decks/${id}/surveys`, {
    headers,
    data: { kind: "single", question: "好きな季節", options: ["春", "夏"] },
  });
  expect(created.status()).toBe(200);
  const survey = (await created.json()).surveys.find(
    (s: { question: string }) => s.question === "好きな季節",
  );
  expect(
    (
      await page.request.post(`/api/decks/${id}/surveys/${survey.id}/status`, {
        headers,
        data: { status: "open" },
      })
    ).status(),
  ).toBe(200);

  // Place the survey on a slide from the host's form panel.
  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await page
    .getByRole("dialog", { name: "アンケート", exact: true })
    .getByRole("button", { name: /好きな季節/ })
    .click();
  await page
    .getByRole("button", { name: "このアンケートをスライドに配置" })
    .click();
  await expect(
    page.locator(".editor-workspace [data-slide-survey]"),
  ).toHaveCount(1);

  // The second student joins (opens the deck) but answers nothing.
  const context2 = await browser.newContext({ baseURL: scopeOrigin });
  const student2 = await context2.newPage();
  await scopeLogin(student2, guest2Name);
  await student2.goto(`/?room=${id}`);
  await expect(student2.locator(".slide-card").first()).toBeVisible({
    timeout: 15_000,
  });

  // Only the first student answers.
  const context = await browser.newContext({ baseURL: scopeOrigin });
  const student = await context.newPage();
  await scopeLogin(student, guestName);
  expect(
    (
      await student.request.post(
        `/api/decks/${id}/surveys/${survey.id}/answer`,
        { headers, data: { choices: [0], text: "" } },
      )
    ).status(),
  ).toBe(200);

  // The API carries the matrix next to the per-student records.
  // The placement reaches the server asynchronously, so poll.
  let all: {
    matrix: {
      columns: { total: number }[];
      rows: {
        name: string;
        cells: { answered: number; slideId: string }[];
      }[];
    };
  } = { matrix: { columns: [], rows: [] } };
  await expect
    .poll(
      async () => {
        all = await (
          await page.request.get(`/api/decks/${id}/record`, { headers })
        ).json();
        return all.matrix.columns.length;
      },
      { timeout: 20_000 },
    )
    .toBe(1);
  expect(all.matrix.columns[0].total).toBe(1);
  const answeredRow = all.matrix.rows.find(
    (r: { name: string }) => r.name === guestName,
  );
  const silentRow = all.matrix.rows.find(
    (r: { name: string }) => r.name === guest2Name,
  );
  expect(answeredRow.cells[0].answered).toBe(1);
  expect(silentRow.cells[0].answered).toBe(0);
  expect(silentRow.cells[0].slideId).toBe(answeredRow.cells[0].slideId);

  // Host screen: the matrix view marks the two students apart, and
  // a cell click opens that slide in the editor.
  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "学びの記録" }).click();
  const screen = page.locator(".learning-record");
  await screen.getByRole("tab", { name: "回答状況" }).click();
  const matrix = screen.locator(".record-matrix");
  await expect(matrix.locator("tbody tr")).toHaveCount(2, {
    timeout: 15_000,
  });
  const rowOne = matrix.locator("tbody tr", { hasText: guestName });
  const rowTwo = matrix.locator("tbody tr", { hasText: guest2Name });
  await expect(rowOne.locator(".record-matrix-cell.is-full")).toHaveCount(1);
  await expect(rowTwo.locator(".record-matrix-cell.is-none")).toHaveCount(1);
  // Students never see the matrix view.
  await student2.goto(`/?room=${id}`);
  await student2.getByRole("button", { name: "学びの記録" }).click();
  await expect(
    student2
      .locator(".learning-record")
      .getByRole("tab", { name: "回答状況" }),
  ).toHaveCount(0);

  await rowTwo.locator(".record-matrix-cell").click();
  await expect(page.locator(".learning-record")).toHaveCount(0);
  await expect(
    page.locator(".editor-workspace [data-slide-survey]"),
  ).toHaveCount(1);
});

test("answer-status matrix: group work is marked, not counted as one's own", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-record-group`);
  const writerName = `${info.project.name}-group-writer`;
  const silentName = `${info.project.name}-group-silent`;
  await addGuest(page, id, writerName);
  await addGuest(page, id, silentName);

  // One group with both students in it.
  expect(
    (
      await page.request.post(`/api/decks/${id}/groups`, {
        headers,
        data: { names: ["1班", "2班"] },
      })
    ).status(),
  ).toBe(200);
  const groupView = await (
    await page.request.get(`/api/decks/${id}/groups`, { headers })
  ).json();
  const g1 = groupView.groups[0];

  // A group point tool, placed on a slide by the host.
  const created = await page.request.post(`/api/decks/${id}/thinking`, {
    headers,
    data: {
      template: "emotion",
      unit: "group",
      definition: { title: "班の気持ち", xMin: "いや", xMax: "よい" },
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
  await panel
    .locator(".thinking-tool-card", { hasText: "班の気持ち" })
    .getByRole("button", { name: "スライドに配置" })
    .click();
  await expect(page.locator(".slide-thinking.is-interactive")).toBeVisible({
    timeout: 15_000,
  });

  // Both students join the group; only the writer places a point.
  const pages: Record<string, Page> = {};
  for (const name of [writerName, silentName]) {
    const context = await browser.newContext({ baseURL: scopeOrigin });
    const student = await context.newPage();
    await scopeLogin(student, name);
    await student.goto(`/?room=${id}`);
    await expect(student.locator(".slide-card").first()).toBeVisible({
      timeout: 15_000,
    });
    expect(
      (
        await student.request.post(`/api/decks/${id}/groups/join`, {
          headers,
          data: { groupId: g1.id },
        })
      ).status(),
    ).toBe(200);
    pages[name] = student;
  }
  expect(
    (
      await pages[writerName].request.post(
        `/api/decks/${id}/thinking/${toolId}/point`,
        { headers, data: { scene: "", value: { v: 0.3 } } },
      )
    ).status(),
  ).toBe(200);

  // API: the writer owns the answer; the silent member is covered
  // by the group only. The placement syncs asynchronously, so poll.
  type MatrixRow = {
    name: string;
    cells: { answered: number; group: number }[];
  };
  let rows: MatrixRow[] = [];
  await expect
    .poll(
      async () => {
        const all = await (
          await page.request.get(`/api/decks/${id}/record`, { headers })
        ).json();
        rows = all.matrix.rows as MatrixRow[];
        return all.matrix.columns.length;
      },
      { timeout: 20_000 },
    )
    .toBe(1);
  const writer = rows.find((r) => r.name === writerName)!;
  const silent = rows.find((r) => r.name === silentName)!;
  expect(writer.cells[0]).toMatchObject({ answered: 1, group: 0 });
  expect(silent.cells[0]).toMatchObject({ answered: 0, group: 1 });

  // Screen: the silent student's cell carries the 班 mark.
  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "学びの記録" }).click();
  const screen = page.locator(".learning-record");
  await screen.getByRole("tab", { name: "回答状況" }).click();
  const matrix = screen.locator(".record-matrix");
  const silentRow = matrix.locator("tbody tr", { hasText: silentName });
  await expect(silentRow.locator(".record-matrix-cell.is-group")).toHaveText(
    "班",
    { timeout: 15_000 },
  );
  const writerRow = matrix.locator("tbody tr", { hasText: writerName });
  await expect(writerRow.locator(".record-matrix-cell.is-full")).toHaveCount(1);
});
