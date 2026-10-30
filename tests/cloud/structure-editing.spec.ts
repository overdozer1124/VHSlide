import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { blank } from "../../src/model";
import { createDiagram, createChartElement } from "../../src/diagramTemplates";
import { readBackupArchive } from "../../src/backupArchive";
test("structured objects sync, own undo preserves remote data, scoped rights and ZIP restore survive", async ({
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
  const host = `structure-host-${info.project.name}`,
    guest = `structure-guest-${info.project.name}`;
  await login(page, host);
  let i = 0;
  const uid = () => `structure-${++i}`,
    diagram = createDiagram("process", uid),
    chart = createChartElement("bar", uid),
    node = diagram.find((e) => e.type === "shape")!;
  node.link = { slideId: "destination" };
  const s = {
      ...blank(0, 0),
      id: "source",
      title: "構造の共同制作",
      elements: [...diagram, chart],
    },
    target = { ...blank(1, 0), id: "destination", title: "移動先" };
  const created = await page.request.post("/api/decks", {
    headers,
    data: { version: 1, title: "構造の共同制作", slides: [s, target] },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const ctx = await browser.newContext(info.project.use),
    other = await ctx.newPage();
  const read = async () =>
    (await (await page.request.get(`/api/decks/${id}/backup`)).json()).deck;
  try {
    await login(other, guest);
    expect(
      (
        await page.request.post(`/api/decks/${id}/recipients`, {
          headers,
          data: {
            recipients: [
              {
                email: `${guest}@example.test`,
                access: {
                  mode: "scoped",
                  comment: true,
                  rows: [],
                  columns: [],
                  slides: ["source"],
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
        .getByRole("button", { name: "構造の共同制作を編集", exact: true })
        .click();
      await expect(p.locator(".workspace-flight")).toHaveCount(0);
    }
    const chartEl = (p: Page) =>
      p.locator(`.editor-page-current .element[data-element-id="${chart.id}"]`);
    await chartEl(page).click();
    await chartEl(other).click();
    await page
      .getByLabel("グラフのタイトル", { exact: true })
      .fill("ホストの見出し");
    await expect(
      other.getByLabel("グラフのタイトル", { exact: true }),
    ).toHaveValue("ホストの見出し");
    const number = other.getByRole("spinbutton", {
      name: "グラフ項目2の値",
      exact: true,
    });
    await number.fill("83");
    await number.press("Tab");
    await expect(
      page.getByRole("spinbutton", { name: "グラフ項目2の値", exact: true }),
    ).toHaveValue("83");
    await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
    await expect(
      other.getByLabel("グラフのタイトル", { exact: true }),
    ).not.toHaveValue("ホストの見出し");
    await expect(
      page.getByRole("spinbutton", { name: "グラフ項目2の値", exact: true }),
    ).toHaveValue("83");
    await expect
      .poll(
        async () =>
          (await read()).slides
            .find((s: any) => s.id === "source")
            .elements.at(-1).chart.series[1].value,
      )
      .toBe(83);
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
      other.getByRole("button", {
        name: "もっと見る（図解・グラフ）",
        exact: true,
      }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "クラウド", exact: true }).click();
    await page.getByRole("tab", { name: /作品一覧/ }).click();
    const download = page.waitForEvent("download");
    if (
      !(await page
        .getByRole("button", { name: "完全バックアップを保存", exact: true })
        .isVisible())
    ) {
      await page
        .getByRole("button", { name: "作品一覧のその他", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "バックアップと復元", exact: true })
        .click();
    }
    await page
      .getByRole("button", { name: "完全バックアップを保存", exact: true })
      .click();
    const file = await download,
      path = await file.path(),
      archive = await readBackupArchive(new Uint8Array(await readFile(path!)));
    expect(
      archive.snapshot.deck.slides.find((s) => s.id === "source")!.elements[0]
        .groupId,
    ).toBe(diagram[0].groupId);
    await page
      .getByLabel("復元するバックアップ", { exact: true })
      .setInputFiles(path!);
    await page
      .getByRole("button", { name: "新しい作品に復元する", exact: true })
      .click();
    await expect
      .poll(() => {
        const room = new URL(page.url()).searchParams.get("room");
        return room && room !== id ? room : "";
      })
      .toMatch(/^[a-f0-9-]{36}$/);
    const restoredId = new URL(page.url()).searchParams.get("room")!,
      restored = await (
        await page.request.get(`/api/decks/${restoredId}/backup`)
      ).json();
    expect(restored.deck).toEqual(archive.snapshot.deck);
    expect(restored.sharing).toEqual([]);
    expect((await other.request.get(`/api/decks/${restoredId}`)).status()).toBe(
      404,
    );
  } finally {
    await ctx.close();
  }
});
