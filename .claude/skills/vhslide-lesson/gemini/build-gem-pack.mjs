#!/usr/bin/env node
// Build the Gemini (Gem) pack: the offline converter page, the Gem instructions and the knowledge files,
// generated from the skill's own docs so they stay in step. Output: gemini/dist/vhslide-lesson-gemini/ and a zip.
// usage: node gemini/build-gem-pack.mjs        (ESBUILD=path to use a local esbuild)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { themes } from "../scripts/themes.mjs";
import { mascotKinds } from "../scripts/mascot.mjs";

const here = path.dirname(new URL(import.meta.url).pathname), skill = path.join(here, "..");
const out = path.join(here, "dist", "vhslide-lesson-gemini");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "知識ファイル"), { recursive: true });
const read = f => fs.readFileSync(path.join(skill, f), "utf8");
const write = (f, s) => fs.writeFileSync(path.join(out, f), s);

// 1. converter page
execFileSync("node", [path.join(here, "build-converter.mjs"), path.join(out, "1_VHSlide授業スライド変換.html")], { stdio: "inherit", env: process.env });

// 2. Gem instructions
write("2_Gemの指示（Gemの「カスタム指示」に貼る）.txt", read("gemini/gem-instructions.md"));

// 3. knowledge files
const vhs = JSON.parse(read("scripts/vendor/version.json"));
let spec = read("reference/spec-format.md")
  .replace("`build-deck.mjs` に渡すJSON。", "「VHSlide 授業スライド変換」ページに貼るJSON。")
  .replace(/（既定 true。false または --flat で図形だけの見た目）/, "（既定 true。false で図形だけの見た目）")
  .replace("`image`（png/jpg/webp/gif/svg のパス）", "`image`（SVGの文字列、または先生が変換ページで選ぶ画像のファイル名）")
  .replace(/0\.109以降は枠いっぱいに表示され、[^。]*。0\.109より前の版では[^。]*。/, "枠いっぱいに表示され、クリックするとペンや画像追加の道具が開く。")
  .replace("| `custom` | `elements[]`（VHSlide の要素をそのまま） | 上で表せないもの・新機能の利用 |\n", "");
spec += `
## 図をSVGで書く（Gem専用）

\`image\` には、画像のファイル名の代わりに SVG の文字列をそのまま書ける。変換ページが絵（PNG）にする。

\`\`\`json
{ "kind": "figure", "tag": "図1", "heading": "主食と主菜", "alt": "主食と主菜の例",
  "image": "<svg width='800' height='400' viewBox='0 0 800 400'><rect width='800' height='400' fill='#fff7e8'/><circle cx='200' cy='200' r='120' fill='#ff5c8a'/><text x='200' y='212' font-size='40' text-anchor='middle' fill='#fff' font-family='sans-serif'>主食</text></svg>",
  "field": { "id": "q2", "label": "図から気づいたこと" } }
\`\`\`

- 先頭の \`<svg\` に width と height を数値で書く。属性はシングルクォート（'）で囲む。改行を入れない。
- 外部の画像・フォント・URL・<script> は使わない。文字は font-family='sans-serif'。

## 長い単元を分けて出す（Gem専用）

1つ目のブロックは全体（title・theme など＋lessons に1時間目）。2つ目以降は \`{"lessons": [ … ]}\` だけ。変換ページに全部のブロックを続けて貼ると、lessons がつながって1つの作品になる。

## 変換ページが止めるもの（よくある誤り）
- JSON の文法（コメント、末尾のカンマ、閉じていない括弧、SVG の中のダブルクォート）。
- 入力欄の id の重複（1時間の中）、1時間に40個を超える入力欄、2〜10個でない選択肢、100字を超える選択肢。
- 文字の大きさ（fontSize）は12〜120。要素は 960×540 の中に収める（form の座標）。
- 知らない kind・テーマ名・キャラクター名、見つからない画像ファイル。
`;
write("知識ファイル/01_レッスン仕様の書き方.txt", spec);

const design = read("reference/design.md");
const principles = design.slice(design.indexOf("## 見た目の原則"), design.indexOf("## VHSlide の制約"));
const fonts = "sans（読みやすい文字）／serif（明朝体）／rounded（丸ゴシック）／klee（教科書風）／yomogi（手書き風）／ud（UDゴシック）／brush（筆文字）／shippori（見出し明朝）";
const mascotNames = { onigiri: "おにぎり（食・家庭）", drop: "しずく（理科・水）", book: "本（国語・汎用）", sprout: "芽（生活・生き物）", kokeshi: "こけし（和服・伝統文化）", hiyoko: "ひよこ（成長・幼児）", ninjin: "にんじん（食品・栄養）", blob: "まる（汎用）" };
write("知識ファイル/02_デザインとトーン.txt", `# トーン（"theme"）

${Object.entries(themes).map(([k, t]) => `- ${k}：${t.label}`).join("\n")}

言葉で希望されたとき（例：「学校カラーの紺で」）は、近いプリセットを base にして色だけ上書きする：
{"base": "minimal", "accent": "#c0392b", "accentSoft": "#fbe9e7", "primary": "#1b2a49"}
色は必ず #rrggbb。上書きできる主なキー：primary（見出しの帯など）・accent（強調・問い）・primarySoft／accentSoft（淡い面）・bg（背景）・ink（文字）・font（本文の書体）・headingFont（見出しの書体）。
書体：${fonts}

# キャラクター（"mascot"）

${mascotKinds.map(k => `- ${k}：${mascotNames[k] ?? k}`).join("\n")}
- none：キャラクターなし
問いのページには「?」、解説には「!」、表紙には「♪」の表情で自動で入る。form では {"type":"mascot","pose":"think|idea|happy","x":…,"y":…,"s":大きさ} で置ける。

# 背景の装飾
各トーンには背景の装飾（グラデーション・紙や布の質感・模様）が付く。変換ページの「背景の装飾」で外せる。form のページだけに先生の画像を背景にしたいときは "backdrop": "assets/ファイル名.jpg"。

${principles}`);

write("知識ファイル/03_VHSlideの機能.txt", read("reference/vhslide-features.md").replace(/^最終確認：.*$/m, `最終確認：VHSlide ${vhs.version}`));
write("知識ファイル/04_見本_中学生に必要な栄養.txt", "完成例（1時間・lesson-rows）。assets/fig1-growth.png は先生が変換ページで選ぶ画像の例。\n\n" + read("examples/nutrition.spec.json"));
write("知識ファイル/05_見本_ページの型.txt", "新しいページの型（section・statement・compare・steps・quiz・cards の bento）を使った例。\n\n" + read("examples/patterns.spec.json"));

// 4. guide
write("はじめに.txt", `VHSlide 授業スライド（Gemini 版）

■ 準備（最初の1回だけ）
1. Gemini（gemini.google.com）の「Gem マネージャー」→「新しい Gem」。
2. 名前：VHSlide 授業スライド作成（自由）。
3. 「カスタム指示」に「2_Gemの指示（Gemの「カスタム指示」に貼る）.txt」の中身をすべて貼る。
4. 「知識」に「知識ファイル」フォルダの5つのファイルを追加して保存。
5. 「1_VHSlide授業スライド変換.html」をパソコンに保存しておく（ダブルクリックでブラウザーが開く。インターネットに送らず、ページの中だけで変換する）。

■ 使い方
1. Gem に指導書の画像やPDFを渡し、「授業スライドを作って」と頼む（配置・トーン・キャラクターを聞かれたら答える）。
2. Gem の返答（\`\`\`json の部分）をコピーし、変換ページの「1」に貼る。何回かに分かれたら全部続けて貼る。
3. 画像ファイルを使う指示があれば「2」で選ぶ。→「作成する」→「ファイルを保存」。
4. VHSlide の「ファイル → 開く」で読み込み、クラウドに保存すると入力欄が使える。
5. エラーが出たら「Gemへの修正依頼をコピー」を押して Gem に貼ると、直した仕様を出し直す。

■ Claude 版との違い
- Gem はプログラムを実行できないため、VHSlide での表示チェック（文字の見切れ）と画面の撮影は自動ではできない。VHSlide で「発表する」を押したときの表示チェックで確かめる。
- 新しいトーンやキャラクターを作ることはできない（色の上書きはできる）。
- 変換ページは VHSlide ${vhs.version} の読み込み検査を内蔵している。
`);

// 5. zip
const zip = path.join(here, "dist", "vhslide-lesson-gemini.zip");
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-qr", "-X", zip, "vhslide-lesson-gemini"], { cwd: path.join(here, "dist") });
console.log(`${zip} (${Math.round(fs.statSync(zip).size / 1024)}KB)`);
