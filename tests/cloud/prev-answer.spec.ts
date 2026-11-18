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

test("prev-answer part: each student sees only their own earlier answer", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(300_000);
  const id = await scopeFixture(page, `${info.project.name}-prev-host`);
  const guestName = `${info.project.name}-prev-one`;
  const guest2Name = `${info.project.name}-prev-two`;
  await addGuest(page, id, guestName);
  await addGuest(page, id, guest2Name);

  const template = worksheetTemplate("blank");
  template.title = "予想シート";
  template.fields[0].label = "予想";
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

  const students: Page[] = [];
  for (const [name, text] of [
    [guestName, "ひとりめの予想"],
    [guest2Name, "ふたりめの予想"],
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
    students.push(student);
  }
  const [student1, student2] = students;

  // API: the answer is keyed by the signed-in account alone.
  const query = `source=worksheet&ref=${sheet.id}&field=${fieldId}`;
  const mine = await (
    await student1.request.get(`/api/decks/${id}/prev-answer?${query}`, {
      headers,
    })
  ).json();
  expect(mine.answer?.value).toBe("ひとりめの予想");
  const theirs = await (
    await student2.request.get(`/api/decks/${id}/prev-answer?${query}`, {
      headers,
    })
  ).json();
  expect(theirs.answer?.value).toBe("ふたりめの予想");
  // The host has no answer of their own.
  const hostAnswer = await (
    await page.request.get(`/api/decks/${id}/prev-answer?${query}`, {
      headers,
    })
  ).json();
  expect(hostAnswer.answer).toBeNull();

  // Host places the part from the forms panel.
  await page.goto(`/?room=${id}`);
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  const panel = page.locator(".activity-panel");
  await panel.getByRole("tab", { name: "前の回答" }).click();
  await panel
    .getByRole("button", { name: "スライドに配置" })
    .click();
  const hostPart = page.locator(".editor-page-current .prev-answer").first();
  await expect(hostPart).toBeVisible({ timeout: 15_000 });
  await expect(hostPart).toContainText("生徒の画面には、本人の前の回答が表示されます");
  await expect(hostPart).not.toContainText("ひとりめの予想");
  await expect(hostPart).not.toContainText("ふたりめの予想");

  // Each student opens the slide and sees only their own answer.
  for (const [student, own, other] of [
    [student1, "ひとりめの予想", "ふたりめの予想"],
    [student2, "ふたりめの予想", "ひとりめの予想"],
  ] as const) {
    await student.goto(`/?room=${id}`);
    await student.locator(".slide-card").first().click();
    const part = student.locator(".editor-page-current .prev-answer").first();
    await expect(part).toBeVisible({ timeout: 15_000 });
    await expect(part).toContainText(own);
    await expect(part).not.toContainText(other);
  }
});
