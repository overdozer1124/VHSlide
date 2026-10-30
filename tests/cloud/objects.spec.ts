import { test, expect, type Page } from "@playwright/test";
import { blank } from "../../src/model";
test("shape labels and transforms sync, own undo preserves remote text, read-only clients cannot insert", async ({
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
  await login(page, `object-host-${info.project.name}`);
  const s = {
    ...blank(0, 0),
    title: "図形のページ",
    elements: [
      {
        id: "shape-a",
        type: "shape",
        shape: "triangle",
        x: 100,
        y: 100,
        w: 200,
        h: 100,
        fill: "#b8d394",
        stroke: "#173d38",
        text: "共同の図形",
        fontSize: 24,
        color: "#173d38",
        textAlign: "center",
        verticalAlign: "middle",
      },
    ],
  };
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "図形の共同制作", slides: [s] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const ctx = await browser.newContext(info.project.use),
    other = await ctx.newPage();
  try {
    await login(other, `object-guest-${info.project.name}`);
    expect(
      (
        await page.request.post(`/api/decks/${id}/recipients`, {
          headers,
          data: {
            recipients: [
              {
                email: `object-guest-${info.project.name}@example.test`,
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
    for (const p of [page, other]) {
      await p.goto(`/?room=${id}`);
      await p
        .getByRole("button", { name: "図形のページを編集", exact: true })
        .click();
      await expect(p.locator(".workspace-flight")).toHaveCount(0);
    }
    const object = (p: Page) =>
      p.locator('.editor-page-current .element[data-element-id="shape-a"]');
    await object(page).click();
    await page.getByRole("tab", { name: "配置", exact: true }).click();
    await page.getByText("サイズ・向き", { exact: true }).click();
    await page.getByRole("button", { name: "右へ90度", exact: true }).click();
    await expect(object(other).locator(".element-visual")).toHaveCSS(
      "transform",
      /matrix\(0, 1, -1, 0/,
    );
    await object(other).dblclick();
    const text = object(other).getByRole("textbox");
    await expect(text).toBeVisible();
    await text.fill("相手が書いた図形の文字");
    await text.press("Escape");
    await expect(object(page)).toContainText("相手が書いた図形の文字");
    await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
    await expect(object(other).locator(".element-visual")).toHaveCSS(
      "transform",
      /matrix\(1, 0, 0, 1/,
    );
    await expect(object(page)).toContainText("相手が書いた図形の文字");
    await page.getByRole("button", { name: "線を追加", exact: true }).click();
    await page.getByRole("button", { name: "曲線を追加", exact: true }).click();
    await expect(other.locator(".editor-page-current .element")).toHaveCount(2);
    const user = (await (await other.request.get("/api/session")).json()).user;
    expect(
      (
        await page.request.patch(`/api/decks/${id}/members/${user.id}`, {
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
    await expect(
      other.getByRole("button", { name: "図形を追加", exact: true }),
    ).toBeDisabled();
    await expect(
      other.getByRole("button", { name: "線を追加", exact: true }),
    ).toBeDisabled();
    const r = await page.request.get(`/api/decks/${id}/backup`);
    expect(r.status()).toBe(200);
    const d = (await r.json()).deck;
    expect(d.slides[0].elements[0].text).toBe("相手が書いた図形の文字");
    expect(d.slides[0].elements[1].type).toBe("line");
  } finally {
    await ctx.close();
  }
});
