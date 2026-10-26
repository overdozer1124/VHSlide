import { test, expect, type Page } from "@playwright/test";
import { blank } from "../../src/model";
import { createTable } from "../../src/tableData";
import { readFile } from "node:fs/promises";
import { readBackupArchive } from "../../src/backupArchive";
test("rich styles and cell formats sync, own undo preserves peers; cropped private photos survive ZIP", async ({
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
  await login(page, `content-host-${info.project.name}`);
  const s = {
    ...blank(0, 0),
    title: "文章と表",
    elements: [
      {
        id: "words",
        type: "text",
        x: 80,
        y: 60,
        w: 700,
        h: 100,
        text: "Hello World",
        fontSize: 32,
        color: "#173d38",
      },
      {
        id: "table",
        type: "table",
        x: 80,
        y: 230,
        w: 500,
        h: 240,
        fontSize: 24,
        color: "#173d38",
        fill: "#ffffff",
        stroke: "#79958b",
        textAlign: "left",
        table: createTable(2, 2, () => crypto.randomUUID()),
      },
    ],
  };
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "文章と表の共同制作", slides: [s] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const ctx = await browser.newContext(info.project.use),
    other = await ctx.newPage();
  const words = (p: Page) =>
    p.locator('.editor-page-current .element[data-element-id="words"]');
  const cell = (p: Page, r: number, c: number) =>
    p.getByRole("textbox", { name: `表 ${r}行 ${c}列`, exact: true });
  async function serverBook() {
    const r = await page.request.get(`/api/decks/${id}/backup`);
    expect(r.status()).toBe(200);
    return (await r.json()).deck;
  }
  try {
    await login(other, `content-student-${info.project.name}`);
    expect(
      (
        await page.request.post(`/api/decks/${id}/recipients`, {
          headers,
          data: {
            recipients: [
              {
                email: `content-student-${info.project.name}@example.test`,
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
        .getByRole("button", { name: "文章と表を編集", exact: true })
        .click();
      await expect(p.locator(".workspace-flight")).toHaveCount(0);
    }
    // Two editors may activate the same legacy box at once without adding a blank line.
    await Promise.all([words(page).dblclick(), words(other).dblclick()]);
    await expect
      .poll(async () => (await serverBook()).slides[0].elements[0].text)
      .toBe("Hello World");
    const input = words(page).getByRole("textbox");
    await input.evaluate((n) => {
      const t = n.querySelector("p")!.firstChild!;
      const r = document.createRange();
      r.setStart(t, 0);
      r.setEnd(t, 5);
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page
      .getByRole("button", { name: "選択文字を下線", exact: true })
      .click();
    const guestInput = words(other).getByRole("textbox");
    await guestInput.press("ControlOrMeta+End");
    await guestInput.pressSequentially("!");
    await guestInput.press("Escape");
    await expect
      .poll(async () =>
        JSON.stringify((await serverBook()).slides[0].elements[0].richText),
      )
      .toContain('"underline":true');
    await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
    await expect
      .poll(async () => (await serverBook()).slides[0].elements[0].text)
      .toBe("Hello World!");
    await expect
      .poll(async () =>
        JSON.stringify((await serverBook()).slides[0].elements[0].richText),
      )
      .not.toContain('"underline":true');
    await Promise.all([cell(page, 1, 1).click(), cell(other, 1, 1).click()]);
    await Promise.all([
      page.getByLabel("セルの背景色", { exact: true }).fill("#aaddff"),
      other.getByRole("button", { name: "セルを太字", exact: true }).click(),
    ]);
    await cell(other, 2, 2).fill("生徒の入力");
    await expect(cell(page, 2, 2)).toHaveValue("生徒の入力");
    await expect
      .poll(async () =>
        JSON.stringify((await serverBook()).slides[0].elements[1].table.styles),
      )
      .toContain("#aaddff");
    await expect
      .poll(async () =>
        JSON.stringify((await serverBook()).slides[0].elements[1].table.styles),
      )
      .toContain('"bold":true');
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=";
    await page
      .locator("input[type=file]")
      .nth(1)
      .setInputFiles({
        name: "private.png",
        mimeType: "image/png",
        buffer: Buffer.from(png, "base64"),
      });
    await expect(page.locator(".editor-page-current .slide-image")).toHaveCount(
      1,
    );
    await page
      .getByRole("textbox", { name: "画像の説明", exact: true })
      .fill("共同制作の写真");
    await page
      .getByRole("button", { name: "切り抜き・位置調整", exact: true })
      .click();
    await page
      .getByRole("slider", { name: "画像の拡大率", exact: true })
      .fill("2");
    await page
      .getByRole("button", { name: "切り抜きを適用", exact: true })
      .click();
    await expect(
      other.locator(".editor-page-current img.slide-image"),
    ).toHaveAttribute("alt", "共同制作の写真");
    await page.getByRole("button", { name: "クラウド", exact: true }).click();
    await page.getByRole("tab", { name: /作品一覧/ }).click();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "完全バックアップを保存", exact: true })
      .click();
    const file = await download,
      path = await file.path();
    const loaded = await readBackupArchive(
      new Uint8Array(await readFile(path!)),
    );
    expect(loaded.images.size).toBe(1);
    const es = loaded.snapshot.deck.slides[0].elements;
    expect(es[0].text).toBe("Hello World!");
    expect(es[0].richText).toBeDefined();
    expect(es[2].crop!.w).toBe(0.5);
    expect(es[2].altText).toBe("共同制作の写真");
    await page
      .getByLabel("復元するバックアップ", { exact: true })
      .setInputFiles(path!);
    await page
      .getByRole("button", { name: "新しい作品に復元する", exact: true })
      .click();
    await expect
      .poll(() => {
        const restored = new URL(page.url()).searchParams.get("room");
        return restored && restored !== id ? restored : "";
      })
      .toMatch(/^[a-f0-9-]{36}$/);
    const target = new URL(page.url()).searchParams.get("room")!;
    const restored = await (
      await page.request.get(`/api/decks/${target}/backup`)
    ).json();
    expect(restored.deck.slides[0].elements[0].richText).toEqual(
      es[0].richText,
    );
    expect(restored.deck.slides[0].elements[1].table.styles).toEqual(
      es[1].table!.styles,
    );
    expect(restored.deck.slides[0].elements[2].crop).toEqual(es[2].crop);
    expect(restored.deck.slides[0].elements[2].src).not.toBe(es[2].src);
    expect(restored.sharing).toHaveLength(0);
    expect((await other.request.get(`/api/decks/${target}`)).status()).toBe(
      404,
    );
  } finally {
    await ctx.close();
  }
});
