#!/usr/bin/env node
// Build the Gemini skill (SKILL.md format): gemini/dist/vhslide-lesson/ and gemini/dist/vhslide-lesson-gemini-skill.zip.
// The skill runs scripts/build_deck.py (Python port of deck-core.mjs, standard library only) with pre-rendered images,
// because Gemini's code sandbox has Python but no browser to draw SVG.
// usage: node gemini/build-skill.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { themes } from "../scripts/themes.mjs";
import { mascotKinds, mascotSvg } from "../scripts/mascot.mjs";
import { decorSvg } from "../scripts/decor.mjs";
import { iconSvg } from "../scripts/icons.mjs";
import { svgToPng, closeRenderer } from "../scripts/render.mjs";

const here = path.dirname(new URL(import.meta.url).pathname), skill = path.join(here, "..");
const out = path.join(here, "dist", "vhslide-lesson");
fs.rmSync(out, { recursive: true, force: true });
for (const d of ["scripts", "references"]) fs.mkdirSync(path.join(out, d), { recursive: true });
const read = f => fs.readFileSync(path.join(skill, f), "utf8");
const write = (f, s) => fs.writeFileSync(path.join(out, f), s);

// 1. builder + theme data
// the theme data goes inside the script (fewer, text-only files: Gemini is strict about what a skill may hold)
const py = fs.readFileSync(path.join(here, "skill", "scripts", "build_deck.py"), "utf8");
if (!py.includes("\nTHEMES = None")) throw Error("build_deck.py: THEMES placeholder not found");
write("scripts/build_deck.py", py.replace(/\nTHEMES = None[^\n]*/, `\nTHEMES = json.loads(r"""\n${JSON.stringify(themes, null, 1)}\n""")`));

// 2. images, kept small (Gemini will not save a skill with a large file):
// backdrops pre-rendered (JPEG, slide size), icons pre-rendered once per ink colour, characters as SVG templates
// (colours as placeholders) that build_deck.py draws with Pillow, plus the badge marks (?, !, ♪) drawn here.
const images = { backdrops: {}, icons: {}, mascots: {}, marks: {} };
const url = (buf, type = "png") => `data:image/${type};base64,${buf.toString("base64")}`;
const BD_QUALITY = Number(process.env.BD_QUALITY ?? 60), BD_SCALE = Number(process.env.BD_SCALE ?? 0.7);
for (const [name, t] of Object.entries(themes)) {
  const T = { ...structuredClone(t), name };
  if (T.decor)
    for (const kind of ["title", "section", "content", "plain"])
      images.backdrops[`${name}-${kind}.jpg`] = url(await svgToPng(decorSvg(T, kind), { scale: BD_SCALE, type: "jpeg", quality: BD_QUALITY }), "jpeg");
  for (const ink of [T.onAccent, T.onPrimary, "#ffffff"])
    for (const icon of ["question", "bulb", "flag"])
      images.icons[`${icon}-${ink.toLowerCase()}.png`] ??= url(await svgToPng(iconSvg(icon, ink), { scale: 1, transparent: true }));
}
const KEYS = ["body", "outline", "wrap", "cheek", "think", "idea"]; // must match MASCOT_PLACEHOLDER in build_deck.py
const placeholder = Object.fromEntries(KEYS.map((k, i) => [k, `#a0000${i + 1}`]));
for (const kind of mascotKinds) {
  const svg = mascotSvg(kind, "plain", placeholder).replace(/\n/g, " ");
  if (/<text|<g|transform=/.test(svg)) throw Error(`${kind}: the Python renderer does not draw text/groups/transforms`);
  images.mascots[`${kind}.svg`] = url(Buffer.from(svg), "svg+xml");
}
// badge marks: the same text as mascot.mjs draws, alone on a transparent 260×260 layer
const marks = { q: mascotSvg("blob", "think", placeholder), x: mascotSvg("blob", "idea", placeholder), n: mascotSvg("blob", "happy", placeholder) };
for (const [k, svg] of Object.entries(marks)) {
  const text = svg.match(/<text[\s\S]*?<\/text>/)[0];
  images.marks[`${k}.png`] = url(await svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260">${text}</svg>`, { scale: 1.2, transparent: true }));
}
await closeRenderer();
// plain text with short lines: "@ group/name mime" then base64 wrapped at 76 characters.
// Characters, marks and icons go inside build_deck.py; the backdrops into scripts/backdrops.py (full skill only).
const pack = groups => Object.entries(images).filter(([g]) => groups.includes(g)).flatMap(([g, m]) => Object.entries(m).map(([k, u]) => {
  const [, mime, b64] = /^data:([^;]+);base64,(.*)$/s.exec(u);
  return [`@ ${g}/${k} ${mime}`, ...b64.match(/.{1,76}/g)].join("\n");
})).join("\n");
const script = fs.readFileSync(path.join(out, "scripts/build_deck.py"), "utf8");
if (!script.includes("\nIMAGES = None")) throw Error("build_deck.py: IMAGES placeholder not found");
write("scripts/build_deck.py", script.replace(/\nIMAGES = None[^\n]*/, () => `\nIMAGES = """\n${pack(["mascots", "marks", "icons"])}\n"""`));
write("scripts/backdrops.py", `"""Decorated backdrops for build_deck.py (JPEG, base64). Read as text by build_deck.load_images()."""\nDATA = """\n${pack(["backdrops"])}\n"""\n`);
console.log(`images: build_deck.py ${Math.round(fs.statSync(path.join(out, "scripts/build_deck.py")).size / 1024)}KB, backdrops.py ${Math.round(fs.statSync(path.join(out, "scripts/backdrops.py")).size / 1024)}KB`);

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
write("references/examples.md", `# レッスン仕様の完成例

## 例1：中学生に必要な栄養（1時間・lesson-rows）

assets/fig1-growth.png は例の図のファイル名。実際には自分で作った図のファイル名に置き換える。

\`\`\`json
${read("examples/nutrition.spec.json").trim()}
\`\`\`

## 例2：ページの型（section・statement・compare・steps・quiz・cards の bento）

\`\`\`json
${read("examples/patterns.spec.json").trim()}
\`\`\`
`);

// 4. zips (SKILL.md inside one folder named like the skill): full (with backdrops.py) and standard (without)
const dist = path.join(here, "dist");
const zipSkill = (zipName, exclude = []) => {
  const zip = path.join(dist, zipName);
  fs.rmSync(zip, { force: true });
  execFileSync("zip", ["-qr", "-X", zip, "vhslide-lesson", ...exclude.flatMap(e => ["-x", e])], { cwd: dist });
  const list = execFileSync("unzip", ["-Z1", zip]).toString().trim().split("\n").filter(f => !f.endsWith("/"));
  console.log(`${zip} (${Math.round(fs.statSync(zip).size / 1024)}KB, ${list.length} files)\n  ${list.join("\n  ")}`);
};
zipSkill("vhslide-lesson-gemini-skill-full.zip");
zipSkill("vhslide-lesson-gemini-skill.zip", ["vhslide-lesson/scripts/backdrops.py"]);

// 5. what Gemini accepted in practice (it only says "スキルを保存できませんでした" otherwise)
const md = fs.readFileSync(path.join(out, "SKILL.md"), "utf8");
const desc = /^description: (.*)$/m.exec(md)[1];
const problems = [];
if (desc.length > 120) problems.push(`description is ${desc.length} characters (a 218-character one was refused; keep it short)`);
if (/Gemini|Google|Canvas|PowerPoint/.test(md)) problems.push("SKILL.md names a product (a version that did was refused)");
for (const f of execFileSync("find", [".", "-type", "f"], { cwd: out }).toString().trim().split("\n")) {
  const text = fs.readFileSync(path.join(out, f), "utf8");
  const longest = Math.max(...text.split("\n").map(l => l.length));
  if (longest > 2000) problems.push(`${f}: a line of ${longest} characters (very long lines were refused)`);
  if (!/\.(md|py)$/.test(f)) problems.push(`${f}: only .md and .py files have been accepted so far`);
}
const total = execFileSync("du", ["-sb", out]).toString().split("\t")[0];
if (total > 800_000) problems.push(`the skill is ${Math.round(total / 1024)}KB (about 690KB was accepted, 11MB was not)`);
if (problems.length) { console.error("Gemini may refuse this skill:\n- " + problems.join("\n- ")); process.exit(1); }
