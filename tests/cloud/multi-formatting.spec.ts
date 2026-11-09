import { test, expect } from "@playwright/test";
import { sample } from "../../src/model";

test("multiple text boxes retain formatting and undo in a shared work", async ({
  page,
}) => {
  const name = "multi-format-host";
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
  const deck = sample();
  deck.slides[0].elements = [
    {
      id: "text-a",
      type: "text",
      x: 100,
      y: 100,
      w: 200,
      h: 80,
      text: "文章A",
      fontSize: 24,
      color: "#173d38",
    },
    {
      id: "text-b",
      type: "text",
      x: 400,
      y: 100,
      w: 200,
      h: 80,
      text: "文章B",
      fontSize: 28,
      color: "#173d38",
      richText: [
        { insert: "文章B", attributes: { italic: true } },
        { insert: "\n" },
      ],
    },
    {
      id: "shape-c",
      type: "shape",
      x: 700,
      y: 100,
      w: 100,
      h: 80,
      shape: "rect",
      fill: "#aabbcc",
      stroke: "#173d38",
    },
  ];
  const { id } = await (
    await page.request.post("/api/decks", { headers, data: deck })
  ).json();
  await page.goto(`/?room=${id}`);
  await expect(
    page.getByRole("button", { name: "ゲストの設定" }),
  ).toBeVisible();
  await page.locator(".thumbnail").first().click();
  const canvas = page.locator(".editor-workspace .slide-canvas");
  await canvas.locator('.element[data-element-id="text-a"]').click();
  await canvas
    .locator('.element[data-element-id="text-b"]')
    .click({ modifiers: ["Shift"] });
  await canvas
    .locator('.element[data-element-id="shape-c"]')
    .click({ modifiers: ["Shift"] });
  const controls = page.getByRole("region", { name: "選択した文字の一括設定" });
  await controls
    .getByRole("group", { name: "選択した文字の左右の位置" })
    .getByRole("button", { name: "右揃え" })
    .click();
  await controls
    .getByRole("group", { name: "選択した文字の上下の位置" })
    .getByRole("button", { name: "中央揃え" })
    .click();
  await controls
    .getByRole("spinbutton", { name: "選択した文字の大きさ" })
    .fill("36");
  await controls
    .getByRole("spinbutton", { name: "選択した文字の大きさ" })
    .press("Enter");
  await controls
    .getByRole("combobox", { name: "選択した文字の書体" })
    .selectOption("serif");
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  await page.reload();
  await page.locator(".thumbnail").first().click();
  for (const id of ["text-a", "text-b"]) {
    const object = canvas.locator(`.element[data-element-id="${id}"]`);
    await expect(object.locator(".text-layout")).toHaveAttribute(
      "data-vertical-align",
      "middle",
    );
    await expect(object.locator(".rich-paragraph")).toHaveCSS(
      "text-align",
      "right",
    );
    await expect(object.locator(".rich-paragraph span").first()).toHaveCSS(
      "font-size",
      "36px",
    );
  }
  await expect(
    canvas
      .locator('.element[data-element-id="text-b"] .rich-paragraph span')
      .first(),
  ).toHaveCSS("font-style", "italic");
});
