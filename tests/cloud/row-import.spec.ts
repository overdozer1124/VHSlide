import { test, expect, type Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { sample } from "../../src/model";
import { defaultAccess } from "../../src/permissions";

const origin = "http://127.0.0.1:3187";

async function login(page: Page, name: string) {
  await page.route("https://accounts.google.com/**", (r) => r.abort());
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  expect(
    (
      await page.request.post("/api/auth/google", {
        headers: { Origin: origin },
        data: { credential },
      })
    ).status(),
  ).toBe(200);
}

function makePptx(texts: string[]): Buffer {
  const slide = (text: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:sld>`;
  const files: Record<string, Uint8Array> = {
    "ppt/presentation.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<p:sldSz cx="12192000" cy="6858000" type="wide"/><p:sldIdLst>` +
        texts
          .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`)
          .join("") +
        `</p:sldIdLst></p:presentation>`,
    ),
    "ppt/_rels/presentation.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        texts
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
          )
          .join("") +
        `</Relationships>`,
    ),
  };
  texts.forEach((text, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(slide(text));
  });
  return Buffer.from(zipSync(files));
}

function makePdf(texts: string[]): Buffer {
  const objects: string[] = [];
  const pageIds = texts.map((_, i) => 3 + i * 2);
  objects[1] =
    `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${texts.length} >>`;
  texts.forEach((text, i) => {
    const pageId = pageIds[i],
      contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${3 + texts.length * 2} 0 R >> >> >>`;
    const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
    objects[contentId] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[3 + texts.length * 2] =
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++)
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

async function backupSlides(page: Page, id: string) {
  return (await (await page.request.get(`/api/decks/${id}/backup`)).json())
    .deck.slides as { x: number; y: number; elements: { type: string; text?: string; src?: string }[] }[];
}

test("assigned students import PPTX and PDF into their own row only", async ({
  page,
  browser,
}, info) => {
  await login(page, `${info.project.name}-rowimport-host`);
  const made = await page.request.post("/api/decks", {
    headers: { Origin: origin },
    data: sample(),
  });
  expect(made.status()).toBe(201);
  const id = (await made.json()).id as string;
  const studentA = `${info.project.name}-rowimport-a`,
    studentB = `${info.project.name}-rowimport-b`,
    studentC = `${info.project.name}-rowimport-c`;
  const scoped = (index: number) => ({
    ...defaultAccess(),
    mode: "scoped" as const,
    rows: [{ sheetId: "main", index }],
  });
  expect(
    (
      await page.request.post(`/api/decks/${id}/recipients`, {
        headers: { Origin: origin },
        data: {
          recipients: [
            { email: `${studentA}@example.test`, access: scoped(0) },
            { email: `${studentB}@example.test`, access: scoped(5) },
            { email: `${studentC}@example.test`, access: defaultAccess() },
          ],
        },
      })
    ).status(),
  ).toBe(200);

  const openStudent = async (name: string) => {
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1366, height: 768 },
    });
    const student = await context.newPage();
    await login(student, name);
    await student.goto(`/?room=${id}`);
    await expect(student.locator(".cloud-presence")).toContainText(
      "クラウドに保存済み",
    );
    return { context, student };
  };
  const importViaMenu = async (
    student: Page,
    label: string,
    file: { name: string; mimeType: string; buffer: Buffer },
  ) => {
    await student
      .getByRole("button", { name: "ファイル", exact: true })
      .click();
    const chooser = student.waitForEvent("filechooser");
    await student.getByRole("menuitem", { name: label }).click();
    await (await chooser).setFiles(file);
  };

  // Student A: row 0 already has 3 slides. Append first, then replace.
  const a = await openStudent(studentA);
  await importViaMenu(a.student, "PPTX／PDFを自分の行に読み込む", {
    name: "a.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: makePptx(["Imported One", "Imported Two"]),
  });
  const dialog = a.student.getByRole("dialog", {
    name: "読み込み方法の選択",
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "行の後ろに追加する", exact: true })
    .click();
  await expect(a.student.locator(".toast")).toContainText("あなたの行");
  await expect
    .poll(async () =>
      (await backupSlides(page, id)).filter((s) => s.y === 0).length,
    )
    .toBe(5);
  await importViaMenu(a.student, "PPTX／PDFを自分の行に読み込む", {
    name: "a2.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: makePptx(["Replacement"]),
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "置き換える", exact: true })
    .click();
  await expect
    .poll(async () => {
      const row = (await backupSlides(page, id)).filter((s) => s.y === 0);
      return row.length === 1 &&
        row[0].elements.some((e) => e.text?.includes("Replacement"))
        ? "replaced"
        : "waiting";
    })
    .toBe("replaced");
  await a.context.close();

  // Student B: row 5 is empty, so a PDF lands there directly as images.
  const b = await openStudent(studentB);
  await importViaMenu(b.student, "PPTX／PDFを自分の行に読み込む", {
    name: "b.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(["PDF One", "PDF Two"]),
  });
  await expect(b.student.locator(".toast")).toContainText("あなたの行");
  await expect
    .poll(async () => {
      const row = (await backupSlides(page, id)).filter((s) => s.y === 5);
      return row.length === 2 &&
        row.every((s) =>
          s.elements.some(
            (e) => e.type === "image" && e.src?.startsWith("/api/decks/"),
          ),
        )
        ? "imported"
        : "waiting";
    })
    .toBe("imported");
  await b.context.close();

  // Student C: no row assigned, so the import is refused with a notice.
  const c = await openStudent(studentC);
  await importViaMenu(c.student, "PPTX／PDFを読み込む", {
    name: "c.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(["Nope"]),
  });
  await expect(c.student.locator(".toast")).toContainText(
    "行を割り当てられた生徒だけが行えます",
  );
  await c.context.close();

  // Other rows were never touched.
  const slides = await backupSlides(page, id);
  expect(slides.filter((s) => s.y === 1)).toHaveLength(2);
});
