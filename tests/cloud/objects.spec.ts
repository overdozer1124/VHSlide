import { test, expect, type Page } from "@playwright/test";
import { blank } from "../../src/model";
import { worksheetTemplate } from "../../src/worksheetTemplates";
test("copies selected objects between slides and preserves keyboard text editing", async ({
  page,
}, info) => {
  const headers = { Origin: "http://127.0.0.1:3187" };
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get("/__test/token?name=copy-host")).text()
      : "copy-host";
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential },
      })
    ).status(),
  ).toBe(200);
  const first = {
    ...blank(0, 0),
    title: "コピー元",
    elements: [
      {
        id: "original",
        type: "shape",
        shape: "rect",
        x: 40,
        y: 80,
        w: 200,
        h: 120,
        fill: "#ffffff",
        stroke: "#173d38",
        text: "コピーする文字",
        fontSize: 24,
        color: "#173d38",
      },
    ],
  };
  const second = { ...blank(0, 1), title: "貼り付け先", elements: [] };
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "コピー検証", slides: [first, second] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await page
    .getByRole("button", { name: "コピー元を編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  const original = page.locator(
    '.editor-page-current .element[data-element-id="original"]',
  );
  if (info.project.name.includes("touch")) {
    await original.tap();
    await page.getByRole("button", { name: "コピー", exact: true }).tap();
  } else {
    await original.click();
    await page.keyboard.press("Control+c");
  }
  await expect(
    page.getByRole("button", { name: "貼り付け", exact: true }),
  ).toBeVisible();
  if (info.project.name.includes("touch"))
    await page.getByRole("button", { name: "貼り付け", exact: true }).tap();
  else await page.keyboard.press("Control+v");
  await expect(page.locator(".editor-page-current .element")).toHaveCount(2);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect(page.locator(".editor-page-current .element")).toHaveCount(1);
  await page.getByRole("button", { name: "2段目の横のページをひらく" }).click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  if (info.project.name.includes("touch"))
    await page.getByRole("button", { name: "貼り付け", exact: true }).tap();
  else await page.keyboard.press("Control+v");
  const pasted = page.locator(".editor-page-current .element");
  await expect(pasted).toHaveCount(1);
  await expect(pasted).toContainText("コピーする文字");
  await expect(pasted).not.toHaveAttribute("data-element-id", "original");
  await page.keyboard.press("Delete");
  await expect(pasted).toHaveCount(0);
  await page.getByRole("button", { name: "貼り付け", exact: true }).click();
  await expect(pasted).toHaveCount(1);
  await pasted.dblclick();
  const text = pasted.getByRole("textbox");
  await expect(text).toBeVisible();
  await text.fill("編集する文字");
  await text.press("Backspace");
  await expect(pasted).toHaveCount(1);
  await expect(text).toContainText("編集する文");
  await text.press("Control+a");
  await text.press("Control+c");
  await text.press("End");
  await text.press("Control+v");
  await expect(text).toContainText("編集する文編集する文");
  await expect(pasted).toHaveCount(1);
});
test("matches sizes to a chosen reference and supports undo", async ({
  page,
}, info) => {
  const headers = { Origin: "http://127.0.0.1:3187" };
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get("/__test/token?name=size-host")).text()
      : "size-host";
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential },
      })
    ).status(),
  ).toBe(200);
  const shape = (id: string, x: number, w: number, h: number) => ({
    id,
    type: "shape",
    shape: "rect",
    x,
    y: 80,
    w,
    h,
    fill: "#ffffff",
    stroke: "#173d38",
    text: id,
    fontSize: 24,
    color: "#173d38",
  });
  const slide = {
    ...blank(0, 0),
    title: "サイズ確認",
    elements: [shape("reference", 40, 200, 120), shape("target", 300, 100, 60)],
  };
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "サイズ調整", slides: [slide] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await page
    .getByRole("button", { name: "サイズ確認を編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  const reference = page.locator(
    '.editor-page-current .element[data-element-id="reference"]',
  );
  const target = page.locator(
    '.editor-page-current .element[data-element-id="target"]',
  );
  if (info.project.name.includes("touch")) {
    await page.getByRole("button", { name: "まとめて選択" }).tap();
    await reference.tap();
    await target.tap();
  } else {
    await reference.click();
    await target.click({ modifiers: ["Shift"] });
  }
  await page
    .getByRole("combobox", { name: "大きさの基準" })
    .selectOption("reference");
  await page.getByRole("button", { name: "幅を揃える", exact: true }).click();
  await expect(target).toHaveCSS("width", "200px");
  await expect(target).toHaveCSS("height", "60px");
  await page.getByRole("button", { name: "幅と高さを揃える" }).click();
  await expect(target).toHaveCSS("height", "120px");
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect(target).toHaveCSS("height", "60px");
  await expect(reference).toHaveCSS("width", "200px");
});
test("multi-selects a response field with a shape and matches its size", async ({
  page,
}, info) => {
  const headers = { Origin: "http://127.0.0.1:3187" };
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get("/__test/token?name=field-size-host")).text()
      : "field-size-host";
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential },
      })
    ).status(),
  ).toBe(200);
  const slide = {
    ...blank(0, 0),
    title: "回答欄のサイズ確認",
    elements: [
      {
        id: "reference",
        type: "shape",
        shape: "rect",
        x: 40,
        y: 80,
        w: 200,
        h: 120,
        fill: "#ffffff",
        stroke: "#173d38",
        text: "基準",
        fontSize: 24,
        color: "#173d38",
      },
      {
        id: "field",
        type: "shape",
        shape: "rect",
        x: 300,
        y: 80,
        w: 100,
        h: 60,
        fill: "#ffffff",
        stroke: "#173d38",
        responseField: {
          source: "worksheet",
          deckId: crypto.randomUUID(),
          worksheetId: crypto.randomUUID(),
          field: worksheetTemplate("reason").fields[0],
          showLabel: true,
        },
      },
    ],
  };
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "回答欄のサイズ調整", slides: [slide] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/?room=${id}`);
  await page
    .getByRole("button", { name: "回答欄のサイズ確認を編集", exact: true })
    .click();
  await expect(page.locator(".workspace-flight")).toHaveCount(0);
  const reference = page.locator(
    '.editor-page-current .element[data-element-id="reference"]',
  );
  const field = page.locator(
    '.editor-page-current .element[data-element-id="field"]',
  );
  if (info.project.name.includes("touch")) {
    await page.getByRole("button", { name: "まとめて選択" }).tap();
    await reference.tap();
    await field.tap();
  } else {
    await reference.click();
    // The second click lands on the field's answer area; it must still add
    // the field to the selection instead of starting an answer.
    await field.click({ modifiers: ["Shift"] });
  }
  await expect(
    page.getByRole("combobox", { name: "大きさの基準" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "大きさの基準" })
    .selectOption("reference");
  await page.getByRole("button", { name: "幅を揃える", exact: true }).click();
  await expect(field).toHaveCSS("width", "200px");
  await expect(field).toHaveCSS("height", "60px");
  await page.getByRole("button", { name: "幅と高さを揃える" }).click();
  await expect(field).toHaveCSS("height", "120px");
});
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
