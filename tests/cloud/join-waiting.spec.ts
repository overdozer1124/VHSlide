import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { sample } from "../../src/model";
test("a delayed pending response cannot reopen a dismissed cloud screen or switch work in the background", async ({
  page,
  browser,
}, info) => {
  const base = "http://127.0.0.1:3187",
    headers = { Origin: base };
  async function login(p: Page, id: string) {
    const credential =
      process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
        ? await (await p.request.get(`/__test/token?name=${id}`)).text()
        : id;
    expect(
      (
        await p.request.post("/api/auth/google", {
          headers,
          data: { credential },
        })
      ).status(),
    ).toBe(200);
  }
  await page.goto("/");
  await login(page, "waiting-host-" + info.project.name);
  const book = sample();
  book.title = "承認後にだけ開く作品";
  const { id } = await (
    await page.request.post("/api/decks", { headers, data: book })
  ).json();
  const { url } = await (
    await page.request.post(`/api/decks/${id}/invite`, { headers })
  ).json();
  const context = await browser.newContext(info.project.use),
    other = await context.newPage();
  try {
    await other.goto("/");
    await login(other, "waiting-student-" + info.project.name);
    await other.goto(url);
    await expect(
      other.getByRole("region", { name: "参加申請の状況", exact: true }),
    ).toContainText("ホストの承認を待っています");
    await expect(other.getByRole("dialog").getByRole("tab")).toHaveCount(0);
    await expect(
      other.getByRole("button", {
        name: "この作品をクラウドに保存",
        exact: true,
      }),
    ).toHaveCount(0);
    const requestId = new URL(other.url()).searchParams.get("request")!;
    let entered!: () => void, release!: () => void;
    const blocked = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    await other.route(`**/api/join-requests/${requestId}`, async (route) => {
      const response = await route.fetch();
      entered();
      await gate;
      await route.fulfill({ response });
    });
    await other
      .getByRole("button", { name: "承認状況を確認", exact: true })
      .click();
    await blocked;
    await other
      .getByRole("button", { name: "クラウドの作品を閉じる", exact: true })
      .click();
    const returned = other.waitForResponse((r) =>
      r.url().endsWith(`/api/join-requests/${requestId}`),
    );
    release();
    await returned;
    await other.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    await expect(other.getByRole("dialog")).toHaveCount(0);
    await other.unroute(`**/api/join-requests/${requestId}`);
    expect(
      (
        await page.request.post(`/api/decks/${id}/join-requests/approve`, {
          headers,
          data: { requestIds: [requestId] },
        })
      ).status(),
    ).toBe(200);
    await expect(other.locator(".deck-title")).not.toHaveValue(book.title);
    await other.getByRole("button", { name: "クラウド", exact: true }).click();
    await other
      .getByRole("button", { name: "承認状況を確認", exact: true })
      .click();
    await expect(other.locator(".deck-title")).toHaveValue(book.title);
    await expect(other.locator(".cloud-presence")).toContainText("閲覧のみ");
  } finally {
    await context.close();
  }
});
