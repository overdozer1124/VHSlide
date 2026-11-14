#!/usr/bin/env node
// Build the Gemini skill (SKILL.md format): gemini/dist/vhslide-lesson/ and gemini/dist/vhslide-lesson-gemini-skill.zip.
// The skill runs scripts/build_deck.py (Python port of deck-core.mjs, standard library only) with pre-rendered images,
// because Gemini's code sandbox has Python but no browser to draw SVG.
// usage: node gemini/build-skill.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { themes } from "../scripts/themes.mjs";
import { mascotKinds } from "../scripts/mascot.mjs";
import { decorSvg } from "../scripts/decor.mjs";
import { iconSvg } from "../scripts/icons.mjs";
import { svgToPng, closeRenderer } from "../scripts/render.mjs";

const here = path.dirname(new URL(import.meta.url).pathname), skill = path.join(here, "..");
const out = path.join(here, "dist", "vhslide-lesson");
fs.rmSync(out, { recursive: true, force: true });
for (const d of ["scripts", "references", "examples", "assets/backdrops", "assets/icons", "assets/mascots"]) fs.mkdirSync(path.join(out, d), { recursive: true });
const read = f => fs.readFileSync(path.join(skill, f), "utf8");
const write = (f, s) => fs.writeFileSync(path.join(out, f), s);

// 1. builder + theme data
fs.copyFileSync(path.join(here, "skill", "scripts", "build_deck.py"), path.join(out, "scripts", "build_deck.py"));
write("assets/themes.json", JSON.stringify(themes, null, 1));

// 2. pre-rendered images (the same renderer and settings as the Node builder)
let n = 0;
for (const [name, t] of Object.entries(themes)) {
  const T = { ...structuredClone(t), name };
  if (T.decor)
    for (const kind of ["title", "section", "content", "plain"]) {
      fs.writeFileSync(path.join(out, "assets/backdrops", `${name}-${kind}.jpg`), await svgToPng(decorSvg(T, kind), { scale: 1.25, type: "jpeg", quality: 84 })); n++;
    }
  for (const [role, ink] of [["accent", T.onAccent], ["primary", T.onPrimary], ["white", "#ffffff"]])
    for (const icon of ["question", "bulb", "flag"]) {
      fs.writeFileSync(path.join(out, "assets/icons", `${name}-${icon}-${role}.png`), await svgToPng(iconSvg(icon, ink), { scale: 1, transparent: true })); n++;
    }
  for (const kind of mascotKinds)
    for (const pose of ["think", "idea", "happy"])
      fs.copyFileSync(path.join(skill, "assets/mascots", `${name}-${kind}-${pose}.png`), path.join(out, "assets/mascots", `${name}-${kind}-${pose}.png`));
}
await closeRenderer();
console.log(`images: ${n} rendered + ${Object.keys(themes).length * mascotKinds.length * 3} characters`);

// 3. SKILL.md and references
const vhs = JSON.parse(read("scripts/vendor/version.json"));
write("SKILL.md", read("gemini/skill/SKILL.md").replaceAll("{{VHSLIDE_VERSION}}", vhs.version));
let spec = read("reference/spec-format.md")
  .replaceAll("build-deck.mjs", "build_deck.py")
  .replace(/node (\S*)build_deck\.py/g, "python3 $1build_deck.py");
spec += `
## 図の作り方（Gemini）

- 棒・折れ線・円グラフは \`chart\`（VHSlide で編集できる）。
- それ以外の図は Python（matplotlib または Pillow）で PNG を作り、\`image\` にそのファイル名を書く（仕様ファイルからの相対パス）。日本語の文字は図に描かず、form の text として図の上に重ねると文字化けしない。
- SVG の文字列も書けるが、絵にするには cairosvg が必要。無ければ PNG にする。
`;
write("references/spec-format.md", spec);
const fonts = "sans（読みやすい文字）／serif（明朝体）／rounded（丸ゴシック）／klee（教科書風）／yomogi（手書き風）／ud（UDゴシック）／brush（筆文字）／shippori（見出し明朝）";
const mascotNames = { onigiri: "おにぎり（食・家庭）", drop: "しずく（理科・水）", book: "本（国語・汎用）", sprout: "芽（生活・生き物）", kokeshi: "こけし（和服・伝統文化）", hiyoko: "ひよこ（成長・幼児）", ninjin: "にんじん（食品・栄養）", blob: "まる（汎用）" };
const design = read("reference/design.md");
write("references/design.md", `# トーン（"theme"）

${Object.entries(themes).map(([k, t]) => `- ${k}：${t.label}`).join("\n")}

言葉で希望されたとき（例：「学校カラーの紺で」）は、近いプリセットを base にして色だけ上書きする：
{"base": "minimal", "accent": "#c0392b", "accentSoft": "#fbe9e7", "primary": "#1b2a49"}
色は必ず #rrggbb。主なキー：primary・accent・primarySoft・accentSoft・bg・ink・font・headingFont。上書きしたときも背景の装飾とキャラクターは base の色で入る。
書体：${fonts}

# キャラクター（"mascot"）

${mascotKinds.map(k => `- ${k}：${mascotNames[k] ?? k}`).join("\n")}
- none：キャラクターなし

${design.slice(design.indexOf("## 見た目の原則"), design.indexOf("## VHSlide の制約"))}`);
write("references/vhslide-features.md", read("reference/vhslide-features.md").replace(/^最終確認：.*$/m, `最終確認：VHSlide ${vhs.version}`));
write("examples/nutrition.spec.json", read("examples/nutrition.spec.json"));
write("examples/patterns.spec.json", read("examples/patterns.spec.json"));
// the example's figure, so the example builds as is
for (const f of fs.readdirSync(path.join(skill, "examples", "assets"), { withFileTypes: true }).filter(e => e.isFile() && /\.png$/.test(e.name))) {
  fs.mkdirSync(path.join(out, "examples", "assets"), { recursive: true });
  fs.copyFileSync(path.join(skill, "examples", "assets", f.name), path.join(out, "examples", "assets", f.name));
}

// 4. zip (SKILL.md inside one folder named like the skill)
const zip = path.join(here, "dist", "vhslide-lesson-gemini-skill.zip");
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-qr", "-X", zip, "vhslide-lesson"], { cwd: path.join(here, "dist") });
console.log(`${zip} (${Math.round(fs.statSync(zip).size / 1024)}KB)`);
