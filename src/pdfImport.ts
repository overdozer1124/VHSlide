import { H, W, MAX_FILE_BYTES, uid } from "./model";
import type { Slide } from "./model";

export type PdfPageImage = { src: string; width: number; height: number };

/** One slide per page: the page image fitted inside the slide, centred. */
export function pdfPageSlides(pages: PdfPageImage[]): Slide[] {
  return pages.map((page) => {
    const scale = Math.min(W / page.width, H / page.height);
    const w = Math.round(page.width * scale),
      h = Math.round(page.height * scale);
    return {
      id: uid(),
      x: 0,
      y: 0,
      title: "",
      background: "#ffffff",
      elements: [
        {
          id: uid(),
          type: "image" as const,
          x: Math.round((W - w) / 2),
          y: Math.round((H - h) / 2),
          w,
          h,
          src: page.src,
        },
      ],
    };
  });
}

const MAX_PDF_PAGES = 100;

/**
 * Render a PDF's pages to images, one slide per page. The PDF
 * library is loaded only when a PDF is actually imported, and each
 * page becomes a single picture (the file's internals are not
 * converted), as agreed for this import path.
 */
export async function importPdf(file: File): Promise<Slide[]> {
  if (file.size > MAX_FILE_BYTES) throw new Error("ファイルは25MBまでです。");
  const pdfjs = await import("pdfjs-dist");
  // The worker is bundled as a script chunk (?worker) rather than
  // referenced by URL: some asset servers answer .mjs files with a
  // non-script MIME type, which module workers refuse to run.
  const { default: PdfWorker } = await import(
    "pdfjs-dist/build/pdf.worker.min.mjs?worker"
  );
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  let pdf: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    }).promise;
  } catch {
    throw new Error(
      "PDFを読み込めませんでした。破損していない、パスワードなしの.pdfファイルを選んでください。",
    );
  }
  if (pdf.numPages > MAX_PDF_PAGES)
    throw new Error(`PDFは${MAX_PDF_PAGES}ページまでです。`);
  const pages: PdfPageImage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1440 / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PDFのページを画像にできませんでした。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    pages.push({
      src: canvas.toDataURL("image/jpeg", 0.85),
      width: canvas.width,
      height: canvas.height,
    });
  }
  return pdfPageSlides(pages);
}
