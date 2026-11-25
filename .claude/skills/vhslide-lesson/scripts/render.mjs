// SVG → PNG rendering with the pre-installed Playwright/Chromium, plus image size helpers.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let browser;
async function getBrowser() {
  if (browser) return browser;
  const require = createRequire(import.meta.url);
  let pw;
  try { pw = require("playwright"); } catch {
    try { pw = require(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() + "/playwright"); } catch { return undefined; }
  }
  try { browser = await pw.chromium.launch(); } catch { return undefined; }
  return browser;
}
const has = cmd => { try { execSync(`command -v ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; } };
/* Local adaptation for the Muse VM (2026-11-16, re-applied to the 2026-11-19 base): system python3 has no
   cairosvg, so prefer the skill-local venv at ../.venv-svg (VHSLIDE_SVG_PYTHON overrides). */
function svgPython() {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [process.env.VHSLIDE_SVG_PYTHON, path.join(here, "..", ".venv-svg", "bin", "python"), "python3"];
  for (const py of candidates) {
    if (!py) continue;
    try { execSync(`"${py}" -c "import cairosvg"`, { stdio: "ignore" }); return py; } catch {}
  }
  return "python3";
}
/* Local adaptation: convert a rendered PNG to WebP/JPEG with Pillow when Chromium is unavailable. */
function pngConvert(pngBuf, type, quality, transparent) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "img-"));
  const src = path.join(tmp, "in.png"), out = path.join(tmp, "out.bin");
  fs.writeFileSync(src, pngBuf);
  try {
    execSync(`"${svgPython()}" -c "import sys; from PIL import Image; im=Image.open(sys.argv[1]); t=sys.argv[4]; q=int(sys.argv[3]); im = im.convert('RGBA') if (t=='webp' and sys.argv[5]=='1') else im.convert('RGB'); im.save(sys.argv[2], 'WEBP' if t=='webp' else 'JPEG', quality=q)" "${src}" "${out}" "${quality}" "${type}" "${transparent ? 1 : 0}"`, { stdio: "ignore" });
    return fs.readFileSync(out);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
/** Fallbacks when Chromium is unavailable (e.g. claude.ai): rsvg-convert, then Python cairosvg. */
function svgToPngWithoutBrowser(svg, scale) {
  /* Local adaptation: cairosvg does not support feTurbulence — a full-page grain
     rect using it renders opaque black. Drop elements filtered by the turbulence
     filters (grain/parch/cracks); the subtle noise texture is lost, nothing else. */
  svg = svg.replace(/<(rect|circle|path|g|image|text)[^>]*filter="url\(#(grain|parch|cracks)\)"[^>]*\/>/g, "");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "svg-"));
  const src = path.join(tmp, "in.svg"), out = path.join(tmp, "out.png");
  fs.writeFileSync(src, svg);
  try {
    if (has("rsvg-convert")) execSync(`rsvg-convert -z ${scale} -o "${out}" "${src}"`, { stdio: "ignore" });
    else execSync(`"${svgPython()}" -c "import cairosvg,sys; cairosvg.svg2png(url=sys.argv[1], write_to=sys.argv[2], scale=${scale})" "${src}" "${out}"`, { stdio: "ignore" });
    return fs.readFileSync(out);
  } catch {
    throw Error("SVGをPNGにできません。Chromium（Playwright）、rsvg-convert、Python の cairosvg（pip install cairosvg）のいずれかが必要です。");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
export async function closeRenderer() { if (browser) await browser.close(); browser = undefined; }

/** Render an SVG string (with width/height attributes) to PNG bytes. */
export async function svgToPng(svg, { scale = 2, transparent = false, type = "png", quality = 82 } = {}) {
  const head = svg.slice(0, svg.indexOf(">") + 1);
  const w = Number(/\bwidth=["'](\d+(?:\.\d+)?)/.exec(head)?.[1]);
  const h = Number(/\bheight=["'](\d+(?:\.\d+)?)/.exec(head)?.[1]);
  if (!w || !h) throw Error("SVGに width / height 属性が必要です。");
  const b = await getBrowser();
  if (!b) { const png = svgToPngWithoutBrowser(svg, scale); return type === "png" ? png : pngConvert(png, type, quality, transparent); }
  const page = await b.newPage({ viewport: { width: Math.ceil(w), height: Math.ceil(h) }, deviceScaleFactor: scale });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const shot = type === "webp" ? "png" : type;
  const png = await page.screenshot({ type: shot, ...(shot === "jpeg" ? { quality } : { omitBackground: transparent }), clip: { x: 0, y: 0, width: w, height: h } });
  if (type === "webp") {
    // WebP is far smaller for the soft decorated backdrops that repeat on every page (VHSlide auto-saves to ~5MB of browser storage).
    const url = await page.evaluate(async ([b64, q, alpha]) => {
      const im = new Image(); im.src = `data:image/png;base64,${b64}`; await im.decode();
      const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext("2d"); if (!alpha) { g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(im, 0, 0); return c.toDataURL("image/webp", q / 100);
    }, [png.toString("base64"), quality, transparent]);
    await page.close();
    return Buffer.from(url.split(",")[1], "base64");
  }
  await page.close();
  return png;
}

/** Natural size of PNG / JPEG / GIF / WebP bytes, or undefined. */
export function imageSize(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.toString("ascii", 0, 3) === "GIF") return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
}

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
/** Load a figure file (png/jpg/webp/gif, or svg which is rendered) as a data URL with its size. */
export async function loadImage(path) {
  const ext = path.split(".").pop().toLowerCase();
  if (ext === "svg") {
    const svg = fs.readFileSync(path, "utf8");
    const png = await svgToPng(svg);
    const size = imageSize(png);
    return { src: `data:image/png;base64,${png.toString("base64")}`, w: size.w, h: size.h };
  }
  if (!MIME[ext]) throw Error(`使えない画像形式です: ${path}`);
  const buf = fs.readFileSync(path);
  const size = imageSize(buf) ?? { w: 16, h: 9 };
  return { src: `data:${MIME[ext]};base64,${buf.toString("base64")}`, w: size.w, h: size.h };
}
