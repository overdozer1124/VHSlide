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
  const mineWithParam = await (
    await student1.request.get(`/api/decks/${id}/record/me?user=someone-else`, {
      headers,
    })
  ).json();
  expect(JSON.stringify(mineWithParam)).toContain("ひとりめの感想");
  expect(JSON.stringify(mineWithParam)).not.toContain("ふたりめの感想");

  const all = await (
    await page.request.get(`/api/decks/${id}/record`, { headers })
  ).json();
  expect(all.students).toHaveLength(2);
  const other = all.students.find(
    (s: { name: string }) => s.name === guest2Name,
  );
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
