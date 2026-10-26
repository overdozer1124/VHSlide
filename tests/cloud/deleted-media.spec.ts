import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { blank } from "../../src/model";

test("deleting a page hides its media from members while host version recovery creates a private new work", async ({
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
  await login(page, `media-host-${info.project.name}`);
  const first = blank(0, 0),
    secret = blank(0, 1);
  secret.title = "削除するページ";
  secret.elements = [
    {
      id: "private-photo",
      type: "image",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    },
  ];
  const created = await page.request.post("/api/decks", {
    headers,
    data: {
      version: 1,
      title: "削除したメディアの検証",
      slides: [first, secret],
    },
  });
  expect(created.status()).toBe(201);
  const { id: source } = await created.json();
  expect(
    (
      await page.request.post(`/api/decks/${source}/comments`, {
        headers,
        data: { slide: secret.id, text: "削除する付箋", x: 0.2, y: 0.2 },
      })
    ).status(),
  ).toBe(200);
  const snapshot = await (
    await page.request.get(`/api/decks/${source}/backup`)
  ).json();
  const image = snapshot.deck.slides.find((s: any) => s.id === secret.id)
    .elements[0].src;
  const invite = await (
    await page.request.post(`/api/decks/${source}/invite`, { headers })
  ).json();
  const context = await browser.newContext(info.project.use),
    other = await context.newPage();
  try {
    await login(other, `media-member-${info.project.name}`);
    const pending = await other.request.post(
      `/api/invites/${new URL(invite.url).searchParams.get("join")}/accept`,
      { headers },
    );
    expect(pending.status()).toBe(202);
    const { requestId } = await pending.json();
    expect(
      (
        await page.request.post(`/api/decks/${source}/join-requests/approve`, {
          headers,
          data: { requestIds: [requestId] },
        })
      ).status(),
    ).toBe(200);
    await page.goto(`/?room=${source}`);
    await other.goto(`/?room=${source}`);
    await expect(other.locator(".cloud-presence")).toContainText("閲覧のみ");
    await expect(
      other.locator(`.map-scroll [data-page-id="${secret.id}"]`),
    ).toBeVisible();
    expect((await other.request.get(image)).status()).toBe(200);
    expect(
      (await (await other.request.get(`/api/decks/${source}/comments`)).json())
        .comments,
    ).toHaveLength(1);
    const refreshed = other.waitForResponse(
      async (r) =>
        r.url().endsWith(`/api/decks/${source}/comments`) &&
        r.status() === 200 &&
        (await r.json()).comments.length === 0,
    );
    await page
      .getByRole("button", { name: "削除するページを編集", exact: true })
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "このページを削除", exact: true })
      .click();
    await refreshed;
    await expect(
      other.locator(`.map-scroll [data-page-id="${secret.id}"]`),
    ).toHaveCount(0);
    expect((await other.request.get(image)).status()).toBe(404);
    expect((await page.request.get(image)).status()).toBe(200);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/decks/${source}/backup`)).json())
            .deck.slides.length,
      )
      .toBe(1);
    await page
      .getByRole("button", { name: "保存方法を選ぶ", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /^保存した版/ }).click();
    await page
      .getByRole("button", { name: "この版を確認", exact: true })
      .first()
      .click();
    await expect(page.getByLabel("過去の版の確認")).toContainText("付箋1枚");
    await page
      .getByRole("button", { name: "この版を別作品に復元", exact: true })
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
    expect(restored.deck.slides).toHaveLength(2);
    expect(restored.comments).toHaveLength(1);
    expect(restored.sharing).toHaveLength(0);
    const newImage = restored.deck.slides.find((s: any) => s.id === secret.id)
      .elements[0].src;
    expect((await page.request.get(newImage)).status()).toBe(200);
    expect((await other.request.get(`/api/decks/${target}`)).status()).toBe(
      404,
    );
    expect((await other.request.get(newImage)).status()).toBe(404);
    expect((await other.request.get(image)).status()).toBe(404);
  } finally {
    await context.close();
  }
});
