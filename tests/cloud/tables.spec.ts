import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { blank } from "../../src/model";

test("tables sync independent cells, honor access, undo only local edits and restore through ZIP into a private work", async ({
  page,
  browser,
}, info) => {
  const headers = { Origin: "http://127.0.0.1:3187" };
  async function login(p: Page, name: string) {
    await p.goto("/");
    const credential =
      process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
        ? await (await p.request.get(`/__test/token?name=${name}`)).text()
        : name;
    expect(
      (
        await p.request.post("/api/auth/google", {
          headers,
          data: { credential },
        })
      ).status(),
    ).toBe(200);
  }
  await login(page, `table-host-${info.project.name}`);
  const slide = blank(0, 0);
  slide.title = "表のページ";
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "表の共同編集", slides: [slide] },
  });
  expect(created.status()).toBe(201);
  const { id: source } = await created.json();
  await page.goto(`/?room=${source}`);
  await page
    .getByRole("button", { name: "表のページを編集", exact: true })
    .click();
  await page.getByRole("button", { name: "表を追加", exact: true }).click();
  await page
    .getByRole("button", { name: "この大きさで表を追加", exact: true })
    .click();
  const cell = (p: Page, r: number, c: number) =>
    p.getByRole("textbox", { name: `表 ${r}行 ${c}列`, exact: true });
  await cell(page, 1, 1).fill("見出し");
  await expect
    .poll(async () => {
      const r = await page.request.get(`/api/decks/${source}/backup`);
      if (r.status() === 409) return false;
      expect(r.status()).toBe(200);
      return JSON.stringify((await r.json()).deck).includes("見出し");
    })
    .toBe(true);
  const ctx = await browser.newContext(info.project.use),
    other = await ctx.newPage();
  try {
    await login(other, `table-student-${info.project.name}`);
    expect(
      (
        await page.request.post(`/api/decks/${source}/recipients`, {
          headers,
          data: {
            recipients: [
              {
                email: `table-student-${info.project.name}@example.test`,
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
    await other.goto(`/?room=${source}`);
    await other
      .getByRole("button", { name: "表のページを編集", exact: true })
      .click();
    await expect(cell(other, 1, 1)).toHaveValue("見出し");
    await Promise.all([
      cell(page, 2, 1).fill("ホストの入力"),
      cell(other, 2, 2).fill("生徒の入力"),
    ]);
    await expect(cell(page, 2, 2)).toHaveValue("生徒の入力");
    await expect(cell(other, 2, 1)).toHaveValue("ホストの入力");
    // Only the guest's own cell edit is undone; the host's edit remains.
    await other
      .getByRole("button", { name: "もとに戻す", exact: true })
      .click();
    await expect(cell(page, 2, 2)).toHaveValue("");
    await expect(cell(other, 2, 1)).toHaveValue("ホストの入力");
    await other.getByRole("button", { name: "やり直す", exact: true }).click();
    await expect(cell(page, 2, 2)).toHaveValue("生徒の入力");
    const guest = (await (await other.request.get("/api/session")).json()).user;
    expect(
      (
        await page.request.patch(`/api/decks/${source}/members/${guest.id}`, {
          headers,
          data: {
            mode: "none",
            comment: true,
            rows: [],
            columns: [],
            slides: [],
          },
        })
      ).status(),
    ).toBe(200);
    await expect(other.locator(".editor-workspace textarea")).toHaveCount(0);
    await expect(other.locator(".editor-workspace .slide-table")).toContainText(
      "生徒の入力",
    );
    await page.reload();
    await page
      .getByRole("button", { name: "表のページを編集", exact: true })
      .click();
    await expect(cell(page, 2, 2)).toHaveValue("生徒の入力");
    await page.getByRole("button", { name: "クラウド", exact: true }).click();
    await page.getByRole("tab", { name: /作品一覧/ }).click();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "完全バックアップを保存", exact: true })
      .click();
    const file = await download;
    const path = await file.path();
    expect(path).toBeTruthy();
    await page
      .getByLabel("復元するバックアップ", { exact: true })
      .setInputFiles(path!);
    await expect(page.getByText(/表の共同編集/).last()).toBeVisible();
    await page
      .getByRole("button", { name: "新しい作品に復元する", exact: true })
      .click();
    await expect
      .poll(() => {
        const id = new URL(page.url()).searchParams.get("room");
        return id && id !== source ? id : "";
      })
      .toMatch(/^[a-f0-9-]{36}$/);
    const target = new URL(page.url()).searchParams.get("room")!;
    const restored = await (
      await page.request.get(`/api/decks/${target}/backup`)
    ).json();
    expect(JSON.stringify(restored.deck)).toContain("ホストの入力");
    expect(JSON.stringify(restored.deck)).toContain("生徒の入力");
    expect(restored.sharing).toHaveLength(0);
    expect((await other.request.get(`/api/decks/${target}`)).status()).toBe(
      404,
    );
  } finally {
    await ctx.close();
  }
});
