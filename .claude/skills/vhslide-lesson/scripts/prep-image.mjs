#!/usr/bin/env node
// 画像をスライド埋め込み用に整える：リサイズ＋JPEG化（Pillow 使用）。
// 生成したイラスト（PNG）はそのまま埋め込むと数百KBになるが、フラットなイラストは
// 幅 800〜1200px・quality 85 の JPEG で 20〜60KB 程度になる。
// 使い方: node scripts/prep-image.mjs 入力.png 出力.jpg [--width 1000] [--quality 85]
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/* Pillow のある Python を探す（スキル内の .venv-svg → python3 の順）。 */
function findPython() {
  const venvPy = path.join(path.dirname(new URL(import.meta.url).pathname), "..", ".venv-svg", "bin", "python");
  for (const py of [venvPy, "python3"]) {
    const r = spawnSync(py, ["-c", "import PIL"], { stdio: "ignore" });
    if (r.status === 0) return py;
  }
  return "python3";
}

const [input, output, ...rest] = process.argv.slice(2);
if (!input || !output) {
  console.error("使い方: node scripts/prep-image.mjs 入力画像 出力.jpg [--width 1000] [--quality 85]");
  process.exit(1);
}
const opt = { width: 1000, quality: 85 };
for (let i = 0; i < rest.length; i += 2) {
  if (rest[i] === "--width") opt.width = Number(rest[i + 1]);
  else if (rest[i] === "--quality") opt.quality = Number(rest[i + 1]);
  else { console.error(`不明な引数: ${rest[i]}`); process.exit(1); }
}
const before = fs.statSync(input).size;
const py = `
import sys
from PIL import Image
src, dst, w, q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(src).convert("RGB")
ow, oh = im.size
im.thumbnail((w, w))
im.save(dst, quality=q)
print(f"{ow}x{oh} -> {im.size[0]}x{im.size[1]}")
`;
const dims = execFileSync(findPython(), ["-c", py, input, output, String(opt.width), String(opt.quality)], { encoding: "utf8" }).trim();
const after = fs.statSync(output).size;
console.log(`${input} (${Math.round(before / 1024)}KB) → ${output} (${Math.round(after / 1024)}KB) ${dims}`);
if (after > 300 * 1024) console.warn("※ 300KB を超えています。--width を下げるか、枚数を絞ってください（全体上限 25MB・1枚 1.5MB 目安）。");
