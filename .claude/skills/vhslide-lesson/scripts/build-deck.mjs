#!/usr/bin/env node
// Build a VHSlide deck JSON from a lesson spec (see reference/spec-format.md).
// usage: node build-deck.mjs <spec.json> <out.json> [--layout lesson-rows|phase-grid] [--theme <name>|<theme.json>] [--mascot <kind>|none] [--flat] [--no-fonts]
import fs from "node:fs";
import path from "node:path";
import { buildDeck } from "./deck-core.mjs";
import { svgToPng, loadImage, imageSize, closeRenderer } from "./render.mjs";

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const [specPath, outPath] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!specPath || !outPath) {
  console.error("usage: node build-deck.mjs <spec.json> <out.json> [--layout lesson-rows|phase-grid] [--theme name|theme.json] [--mascot kind|none] [--flat] [--no-fonts]");
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const baseDir = path.dirname(path.resolve(specPath));
const themeArg = opt("theme");
const here = path.dirname(new URL(import.meta.url).pathname);
const io = {
  async svgToDataUrl(svg, o = {}) {
    const buf = await svgToPng(svg, o);
    return `data:image/${o.type === "jpeg" ? "jpeg" : o.type === "webp" ? "webp" : "png"};base64,${buf.toString("base64")}`;
  },
  async loadImage(ref) {
    const m = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(ref);
    if (m) { const size = imageSize(Buffer.from(m[2], "base64")) ?? { w: 16, h: 9 }; return { src: ref, ...size }; }
    return loadImage(path.resolve(baseDir, ref));
  },
  async mascotFallback(theme, kind, pose) {
    const file = path.join(here, "..", "assets", "mascots", `${theme}-${kind}-${pose}.png`);
    return fs.existsSync(file) ? `data:image/png;base64,${fs.readFileSync(file).toString("base64")}` : undefined;
  },
};
try {
  const deck = await buildDeck(spec, {
    io, layout: opt("layout"), mascot: opt("mascot"), flat: args.includes("--flat"), noFonts: args.includes("--no-fonts"),
    theme: themeArg ? (themeArg.endsWith(".json") ? JSON.parse(fs.readFileSync(themeArg, "utf8")) : themeArg) : undefined,
  });
  fs.writeFileSync(outPath, JSON.stringify(deck, null, 1));
  const layout = opt("layout") ?? spec.layout ?? "lesson-rows";
  // VHSlide auto-saves the open deck to the browser's local storage (about 5MB per site, 2 bytes per character).
  const chars = fs.readFileSync(outPath, "utf8").length;
  if (chars > 2_000_000) console.warn(`※ ファイルが大きく（約${(chars / 1e6).toFixed(1)}M文字）、VHSlide の「この端末に保存」（ブラウザーの保存領域・約5MB）に入りきらない場合があります。図をPNGの減色・WebP・小さい画像にするか、作品を分けてください（クラウドへの保存は25MBまで可能）。`);
  console.log(`${deck.slides.length}ページ・${deck.sheets.length}シート・レイアウト ${layout}・テーマ ${themeArg ?? (typeof spec.theme === "string" ? spec.theme : "custom")} → ${outPath} (${Math.round(fs.statSync(outPath).size / 1024)}KB)`);
} finally { await closeRenderer(); }
