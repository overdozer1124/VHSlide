import { test, expect } from "@playwright/test";
import * as Y from "yjs";
import { sample, serializeDeck } from "../../src/model";
import { worksheetTemplate } from "../../src/worksheetTemplates";
import { fromBase64, readSharedDeck } from "../../src/sharedDeck";

test("append JSON pages with photos and worksheet to the current cloud sheet", async ({
  page,
}) => {
  const name = "json-append-host";
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
  const source = sample();
  source.slides[0].title = "追加するページ";
  const worksheet = worksheetTemplate("reason");
  source.slides[0].elements.push({
    id: crypto.randomUUID(),
    type: "image",
    x: 20,
    y: 20,
    w: 100,
    h: 100,
    src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  });
  const surveyDeck = crypto.randomUUID(),
    surveyId = crypto.randomUUID();
  source.slides[0].elements.push({
    id: crypto.randomUUID(),
    type: "shape",
    x: 350,
    y: 20,
    w: 200,
    h: 100,
    shape: "rect",
    fill: "#ffffff",
    stroke: "#173d38",
    responseField: {
      source: "survey",
      deckId: surveyDeck,
      surveyId,
      question: "好きな色",
      kind: "single",
      options: ["赤", "青"],
      showLabel: true,
    },
  });
  source.slides[0].elements.push({
    id: crypto.randomUUID(),
    type: "text",
    x: 350,
    y: 140,
    w: 200,
    h: 40,
    text: "集計結果",
    color: "#173d38",
    fontSize: 24,
    surveyResult: { deckId: surveyDeck, surveyId, part: "caption" },
  });
  source.slides[0].elements.push({
    id: crypto.randomUUID(),
    type: "shape",
    x: 130,
    y: 20,
    w: 200,
    h: 100,
    shape: "rect",
    fill: "#ffffff",
    stroke: "#173d38",
    responseField: {
      source: "worksheet",
      deckId: crypto.randomUUID(),
      worksheetId: crypto.randomUUID(),
      field: worksheet.fields[0],
      showLabel: true,
    },
  });
  await page.goto(`/?room=${id}`);
  await expect(
    page.getByRole("button", { name: "ゲストの設定" }),
  ).toBeVisible();
  await page
    .locator('input[type="file"]')
    .nth(2)
    .setInputFiles({
      name: "source.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeDeck(source)),
    });
  await expect(page.locator(".toast")).toContainText(
    "JSONの5ページを現在のシートの下に追加しました",
    { timeout: 30000 },
  );
  await expect(page.locator(".slide-card")).toHaveCount(10);
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  await page.reload();
  await expect(page.locator(".slide-card")).toHaveCount(10);
  const response = await (await page.request.get(`/api/decks/${id}`)).json();
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(response.state));
  const book = readSharedDeck(doc);
  doc.destroy();
  const imported = book.slides.find((s) => s.title === "追加するページ")!;
  expect(imported.y).toBe(2);
  const image = imported.elements.find((e) => e.type === "image")!;
  expect(image.src).toContain(`/api/decks/${id}/assets/`);
  const field = imported.elements.find(
    (e) => e.responseField?.source === "worksheet",
  )!.responseField!;
  expect(field.source).toBe("worksheet");
  expect(field.deckId).toBe(id);
  const sheets = (
    await (await page.request.get(`/api/decks/${id}/worksheets`)).json()
  ).worksheets;
  expect(
    sheets.some(
      (s: { id: string; status: string }) =>
        s.id === (field.source === "worksheet" && field.worksheetId) &&
        s.status === "open",
    ),
  ).toBe(true);
  const surveyField = imported.elements.find(
    (e) => e.responseField?.source === "survey",
  )!.responseField!;
  expect(surveyField.source).toBe("survey");
  expect(surveyField.deckId).toBe(id);
  const surveys = (
    await (await page.request.get(`/api/decks/${id}/surveys`)).json()
  ).surveys;
  const importedSurveyId =
    surveyField.source === "survey" ? surveyField.surveyId : "";
  expect(
    surveys.some(
      (s: { id: string; status: string }) =>
        s.id === importedSurveyId && s.status === "open",
    ),
  ).toBe(true);
  expect(
    imported.elements.find((e) => e.surveyResult)?.surveyResult,
  ).toMatchObject({ deckId: id, surveyId: importedSurveyId });
});
