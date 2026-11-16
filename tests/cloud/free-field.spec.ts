import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { sample } from "../../src/model";
import { worksheetTemplate } from "../../src/worksheetTemplates";
const headers = { Origin: "http://127.0.0.1:3187" };
async function signIn(page: Page, name: string) {
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers,
        data: { credential },
      })
    ).status(),
  ).toBe(200);
}

test("free field: text box and hand drawing are saved together in one answer", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, "free-field-host");
  const { id } = await (
    await page.request.post("/api/decks", { headers, data: sample() })
  ).json();
  const definition = worksheetTemplate("blank");
  definition.title = "自由入力の確認";
  definition.fields[0].kind = "free";
  definition.fields[0].label = "図と文字で説明しよう";
  definition.fields[0].wide = true;
  const created = await page.request.post(`/api/decks/${id}/worksheets`, {
    headers,
    data: definition,
  });
  expect(created.status()).toBe(200);
  const sheet = (await created.json()).worksheets[0];
  const fieldId = sheet.fields[0].id;
  await page.request.post(`/api/decks/${id}/worksheets/${sheet.id}/status`, {
    headers,
    data: { status: "open" },
  });

  await page.goto(`/?room=${id}`);
  await expect(page.locator(".slide-card").first()).toBeVisible();
  const dialog = page.locator(".activity-panel");
  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await dialog.getByRole("tab", { name: "ワークシート" }).click();
  await dialog
    .getByRole("button", { name: "自分で入力", exact: true })
    .click();

  const field = dialog.locator(".worksheet-field").first();
  await field
    .getByRole("button", { name: "図と文字で説明しようの画像・手描きを編集" })
    .click();
  // Add a text box and type into it.
  await field.getByRole("button", { name: /ツール：/ }).click();
  await field.getByRole("button", { name: "文字を追加", exact: true }).click();
  const editor = field.locator(".worksheet-drawing-text-editor");
  await expect(editor).toBeVisible();
  await editor.fill("せつめいの文字");
  // Draw a stroke with the pen.
  await field.getByRole("button", { name: /ツール：/ }).click();
  await field.getByRole("button", { name: "ペン", exact: true }).click();
  const canvas = field.locator(".worksheet-drawing-stroke");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("stroke canvas has no box");
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.6, {
    steps: 8,
  });
  await page.mouse.up();
  await field
    .getByRole("button", { name: "完了", exact: true })
    .click();

  // The saved answer is one scene holding both the text and the strokes.
  await expect
    .poll(
      async () => {
        const sheets = (
          await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
        ).worksheets;
        const raw = sheets[0]?.own?.values?.[fieldId];
        if (typeof raw !== "string" || !raw.startsWith("{")) return null;
        const scene = JSON.parse(raw);
        const text = scene.objects?.find(
          (o: { text?: string }) => o.text !== undefined,
        );
        return {
          text: text?.text ?? null,
          strokes: typeof scene.strokes === "string" && scene.strokes !== "",
          flat:
            typeof scene.flat === "string" &&
            scene.flat.startsWith("data:image/jpeg"),
        };
      },
      { timeout: 20000 },
    )
    .toEqual({ text: "せつめいの文字", strokes: true, flat: true });

  // The host results view shows the composed picture.
  await dialog
    .getByRole("button", { name: /回答結果（1人）/ })
    .click();
  await expect(
    dialog.locator(".worksheet-drawing-image").first(),
  ).toBeVisible();
});
