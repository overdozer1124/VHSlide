import { test, expect } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { saveJSON } from "../support/file-save";

function pptx() {
  const ns =
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const slide = (text: string) =>
    `<p:sld ${ns}><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="3200" b="1"><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="img"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`;
  const rel = (target: string, id: string) =>
    `<Relationship Id="${id}" Target="${target}"/>`;
  return Buffer.from(
    zipSync({
      "ppt/presentation.xml": strToU8(
        `<p:presentation ${ns}><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
      ),
      "ppt/_rels/presentation.xml.rels": strToU8(
        `<Relationships>${rel("slides/slide2.xml", "second")}${rel("slides/slide1.xml", "first")}</Relationships>`,
      ),
      "ppt/slides/slide1.xml": strToU8(
        slide("あと").replace(
          '<p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="914400"/></a:xfrm></p:spPr>',
          '<p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>',
        ),
      ),
      "ppt/slides/_rels/slide1.xml.rels": strToU8(
        `<Relationships>${rel("../slideLayouts/slideLayout1.xml", "layout")}</Relationships>`,
      ),
      "ppt/slideLayouts/slideLayout1.xml": strToU8(
        `<p:sldLayout ${ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="914400"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>`,
      ),
      "ppt/slides/slide2.xml": strToU8(slide("こんにちは")),
      "ppt/slides/_rels/slide2.xml.rels": strToU8(
        `<Relationships>${rel("../media/image.png", "img")}</Relationships>`,
      ),
      "ppt/media/image.png": Uint8Array.from(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      ),
    }),
  );
}

test("PPTX imports in presentation order, persists, exports and can be undone", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({
    name: "授業.PPTX",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: pptx(),
  });
  await expect(
    page.getByRole("textbox", { name: "作品のタイトル" }),
  ).toHaveValue("授業");
  await expect(page.locator(".slide-card")).toHaveCount(2);
  const data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  );
  expect(data.slides.map((s: any) => [s.title, s.x, s.y])).toEqual([
    ["こんにちは", 0, 0],
    ["あと", 1, 0],
  ]);
  expect(data.slides[0].elements[0]).toMatchObject({
    type: "text",
    text: "こんにちは",
    bold: true,
    color: "#123456",
    x: 72,
    y: 72,
    w: 576,
    h: 72,
  });
  expect(data.slides[1].elements[0]).toMatchObject({
    text: "あと",
    x: 72,
    y: 72,
  });
  expect(data.slides[0].elements[1].src).toMatch(/^data:image\/png;base64,/);
  await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  await expect(page.locator(".slide-card")).toHaveCount(5);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await page.reload();
  await expect(page.locator(".slide-card")).toHaveCount(2);
  const download = page.waitForEvent("download");
  await saveJSON(page);
  const saved = await download;
  await input.setInputFiles((await saved.path())!);
  await expect(page.locator(".toast")).toContainText("ファイルを開きました");
  await input.setInputFiles({
    name: "broken.pptx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("broken"),
  });
  await expect(page.locator(".toast")).toContainText(
    "PPTXを読み込めませんでした",
  );
  await expect(page.locator(".slide-card")).toHaveCount(2);
});
