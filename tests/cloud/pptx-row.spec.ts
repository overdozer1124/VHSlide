import { test, expect } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { sample } from "../../src/model";
import { readFile } from "node:fs/promises";

function sectionedPresentation() {
  const ns =
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const slide = (label: string) =>
    `<p:sld ${ns}><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>${label}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  return Buffer.from(
    zipSync({
      "ppt/presentation.xml": strToU8(
        `<p:presentation ${ns}><p:sldIdLst><p:sldId r:id="s2"/><p:sldId r:id="s1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:extLst><p:ext><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p14:section><p14:sldIdLst><p14:sldId id="256"/><p14:sldId id="257"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext></p:extLst></p:presentation>`,
      ),
      "ppt/_rels/presentation.xml.rels": strToU8(
        '<Relationships><Relationship Id="s1" Target="slides/slide1.xml"/><Relationship Id="s2" Target="slides/slide2.xml"/></Relationships>',
      ),
      "ppt/slides/slide1.xml": strToU8(slide("2枚目")),
      "ppt/slides/slide2.xml": strToU8(slide("1枚目")),
    }),
  );
}

test("imports a sectioned PPTX as a row without adding section metadata as slides", async ({
  page,
}) => {
  const name = "pptx-sectioned-host";
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  const headers = { Origin: "http://127.0.0.1:3187" };
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential },
      })
    ).status(),
  ).toBe(200);
  const { id } = await (
    await page.request.post("/api/decks", { headers, data: sample() })
  ).json();
  await page.goto(`/?room=${id}`);
  await expect(page.locator(".slide-card")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "ゲストの設定" }),
  ).toBeVisible();
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "sectioned.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: sectionedPresentation(),
  });
  await expect(page.locator(".toast")).toContainText("PPTXの2ページを");
  await expect(page.locator(".slide-card")).toHaveCount(7);
  await expect(
    page.locator(".slide-card").filter({ hasText: "1枚目" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".slide-card").filter({ hasText: "2枚目" }),
  ).toHaveCount(1);
});

test("imports the supplied classroom PPTX as a complete row", async ({
  page,
}) => {
  test.skip(
    !process.env.PPTX_REGRESSION_PATH,
    "検証用の添付ファイルが指定された場合に実行",
  );
  const name = "pptx-classroom-host";
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  const headers = { Origin: "http://127.0.0.1:3187" };
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential },
      })
    ).status(),
  ).toBe(200);
  const { id } = await (
    await page.request.post("/api/decks", { headers, data: sample() })
  ).json();
  await page.goto(`/?room=${id}`);
  await expect(page.locator(".slide-card")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "ゲストの設定" }),
  ).toBeVisible();
  await page
    .locator('input[type="file"]')
    .nth(1)
    .setInputFiles({
      name: "classroom.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: await readFile(process.env.PPTX_REGRESSION_PATH!),
    });
  await expect(page.locator(".toast")).toContainText("PPTXの21ページを", {
    timeout: 30000,
  });
  await expect(page.locator(".slide-card")).toHaveCount(26);
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  await page.reload();
  await expect(page.locator(".slide-card")).toHaveCount(26);
});
