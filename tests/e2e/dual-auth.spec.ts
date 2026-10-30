import { test, expect } from "@playwright/test";
test("Google button is shown immediately and switches client without email entry", async ({
  page,
}) => {
  await page.route("**/api/config", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        clientId: "general-client",
        schoolClientId: "school-client",
        schoolDomain: "kaga.ed.jp",
      },
    }),
  );
  await page.route("**/api/session", (r) =>
    r.fulfill({ json: { user: null } }),
  );
  await page.addInitScript(() => {
    (window as any).google = {
      accounts: {
        id: {
          initialize: (o: any) => {
            (window as any).__login = o;
          },
          renderButton: (el: HTMLElement) => {
            el.textContent = "Googleでログイン";
          },
        },
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await expect(page.getByText("Googleでログイン")).toBeVisible();
  await expect(page.locator("input[type=email]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__login.client_id)).toBe(
    "general-client",
  );
  await page.getByLabel("加賀市の学校アカウント").check();
  await expect
    .poll(() => page.evaluate(() => (window as any).__login.client_id))
    .toBe("school-client");
  await expect(page.getByText("Googleでログイン")).toBeVisible();
  await page.getByLabel("一般のGoogleアカウント").check();
  await expect
    .poll(() => page.evaluate(() => (window as any).__login.client_id))
    .toBe("general-client");
});
test("single-client installations retain the direct Google button", async ({
  page,
}) => {
  await page.route("**/api/config", (r) =>
    r.fulfill({ json: { enabled: true, clientId: "general-client" } }),
  );
  await page.route("**/api/session", (r) =>
    r.fulfill({ json: { user: null } }),
  );
  await page.addInitScript(() => {
    (window as any).google = {
      accounts: {
        id: {
          initialize: (o: any) => {
            (window as any).__login = o;
          },
          renderButton: (el: HTMLElement) => {
            el.textContent = "Googleでログイン";
          },
        },
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await expect(page.getByText("Googleでログイン")).toBeVisible();
  await expect(page.getByText("使用するアカウント")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__login.client_id)).toBe(
    "general-client",
  );
});
