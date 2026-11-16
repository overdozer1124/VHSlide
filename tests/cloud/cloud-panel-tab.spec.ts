import { test, expect } from "@playwright/test";
import { sample } from "../../src/model";
const headers = { Origin: "http://127.0.0.1:3187" };

test("the cloud panel opens on the works list, not sharing", async ({
  page,
}) => {
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential: "cloudtab-host" },
      })
    ).status(),
  ).toBe(200);
  const created = await page.request.post("/api/decks", {
    headers,
    data: sample(),
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await page
    .getByRole("button", { name: "クラウド", exact: true })
    .click();
  const libraryTab = page.getByRole("tab", { name: /作品一覧/ });
  const sharingTab = page.getByRole("tab", { name: /共有管理/ });
  await expect(libraryTab).toHaveAttribute("aria-selected", "true");
  await expect(sharingTab).toHaveAttribute("aria-selected", "false");
  await expect(
    page.getByRole("textbox", { name: "クラウドの作品を検索", exact: true }),
  ).toBeVisible();
});
