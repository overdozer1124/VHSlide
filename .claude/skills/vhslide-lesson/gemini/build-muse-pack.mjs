#!/usr/bin/env node
// Build the Muse hand-over pack: a prompt that has Muse build a Space ("VHSlide 授業スライド工房"),
// a standalone chat prompt (when Spaces are not available), and the converter page that makes the .vhslide.json.
// Muse designs the lesson (lesson spec JSON); the deterministic converter page lays out the slides.
// usage: node gemini/build-muse-pack.mjs   (runs build-gem-pack.mjs and build-canvas-prompt.mjs first)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { themes } from "../scripts/themes.mjs";
import { mascotKinds } from "../scripts/mascot.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
for (const s of ["build-gem-pack.mjs", "build-canvas-prompt.mjs"]) execFileSync("node", [path.join(here, s)], { stdio: "ignore", env: process.env });
const shared = f => fs.readFileSync(path.join(here, "dist", "shared", f), "utf8");
const out = path.join(here, "dist", "vhslide-lesson-muse");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const write = (f, s) => fs.writeFileSync(path.join(out, f), s);

// Muse reads the material itself (no app code to check boxes), so the number check becomes "say where it is printed".
const reader = shared("reader.txt")
  .replace(/- 書いた数値には、すべて box_2d[^\n]*\n/, "- 書いた数値には、すべて where（その数字が印刷されている場所。例：「p.226 資料『幼児期の身長と体重の平均』の表、1歳の行の体重の欄」）を付ける。場所を言えない数値は書かない。\n")
  .replace(/"box_2d": \[0, 0, 0, 0\]/, '"where": "印刷されている場所"');
const ai = shared("ai.txt");
const themeList = Object.entries(themes).map(([k, t]) => `${k}（${t.label.replace(/（.*$/, "")}）`).join("、");
const mascotNames = { onigiri: "おにぎり", drop: "しずく", book: "本", sprout: "芽", kokeshi: "こけし", hiyoko: "ひよこ", ninjin: "にんじん", blob: "まる" };
const mascotList = [...mascotKinds.map(k => `${k}（${mascotNames[k] ?? k}）`), "none（なし）"].join("、");

const workflow = `# 進め方（いつもこの順番。手順を飛ばさない）
1. 確認：先生の指定がなければ、次を1つのメッセージにまとめて番号付きの選択肢で聞く。
   - 配置：lesson-rows（1行＝1時間、既定）／phase-grid（導入・展開・まとめを縦に）
   - トーン：${themeList} から教材に合う2〜3個をすすめる
   - キャラクター：${mascotList} から教科に合うものをすすめる
   - 複数時間の単元なら、何時間目まで作るか
2. 読み取り：教材の画像を1枚ずつ、下の「読み取りの決まり」に従って書き写す。最後に「数値の一覧」（値・単位・何の値か・印刷されている場所）を表にして先生に見せ、「この内容で設計してよいか、違う数値はないか」を聞く。**先生が確認するまで設計に進まない。**
3. 設計：先生が確認した読み取り結果だけを使い、下の「設計の決まり」に従ってレッスン仕様JSONを書く。1時間ずつ書く（長い単元を一度に書かない）。
4. 自己点検：出す前に、次を数えて確かめ、足りなければ直してから出す。
   - 1時間ごとの入力欄（ルーブリックの自己評価を除く）が5個以上
   - lesson.rubric.criteria が2〜4個で、どれも levels が3つ。rubric スライドが導入とまとめに1枚ずつ
   - question・fields・quiz のページに入力欄がある
   - notes の付いたページが、表紙・区切りを除いた半分以上
   - 同じ kind が3枚続かない
   - "reason"・"public"・"options" は single・multiple の欄だけ
   - 表は12行・12列まで、どの行も同じ列数、"highlight" は見出し行を0とした実在する行番号
   - JSON の中の数値が、すべて確認済みの数値の一覧にある（換算・四捨五入・計算もしていない）
5. 出力：レッスン仕様JSONを \`\`\`json のコードブロック1つで出す（コメント・末尾のカンマなし）。続けて、数えた結果（入力欄の数、notes の割合など）と「照合してほしい数値」を短く書く。
6. 案内：「『VHSlide 授業スライド変換』ページを開き、この返答を貼る（JSON の部分だけでも、返答全体でもよい）→『作成する』→『ファイルを保存』。VHSlide の『ファイル → 開く』で読み込み、クラウドに保存すると入力欄が使える」と伝える。変換ページのエラー文を貼られたら、原因のページを直した JSON 全体をもう一度出す。`;

const knowledge = `# 読み取りの決まり

${reader.replace(/^あなたは[^\n]*\n\n/, "").replace(/# 出力（JSON オブジェクト1つだけ）[\s\S]*$/, "").trim()}

# 設計の決まり

${ai.replace(/^あなたは[^\n]*\n\n/, "").replace(/# 出力\n[\s\S]*?(?=# 授業の設計)/, "")}`;

// 1. the Space
write("1_Museにスペースを作らせる指示.txt", `Muse の「スペース」で、次のミニアプリを作ってください。名前は「VHSlide 授業スライド工房」。画面の文言はすべて日本語にしてください。

# 目的
先生が指導書・教科書・ワークシートの画像（またはPDF）を渡すと、Muse が教材を正確に読み取り、授業スライドアプリ「VHSlide」用の「レッスン仕様JSON」を作る。できた JSON は、先生が「VHSlide 授業スライド変換」ページ（先生のパソコンにある HTML ファイル）で、スライドのファイル（.vhslide.json）に変える。このスペースはスライドのファイルそのものは作らない。

# スペースの中身
1. 「教材」：画像・PDF を追加する場所。追加した順（ページ順）に並べる。
2. 「設定」：配置（lesson-rows／phase-grid）、トーン、キャラクター、作る範囲（例：第1時のみ）、先生のメモ。どれも「おまかせ」を選べる。
3. 「読み取り結果」：教材ごとの書き写しと「数値の一覧」（値・単位・何の値か・印刷されている場所・確認欄）。先生がその場で直せる。先生が確認欄にチェックするまで、次の「設計」をしない。
4. 「レッスン仕様JSON」：できた JSON を表示し、コピーできる。時間ごとのページ一覧（kind と見出し）、入力欄の一覧、照合してほしい数値も並べる。
5. 「点検」：下の「進め方」の手順4の項目を、チェックリストとして表示する（満たしていない項目は赤）。
6. 「作った授業」：作った授業（単元名・日付・JSON）を一覧で残す。
7. 「使い方」：「①JSON をコピー → ②『VHSlide 授業スライド変換』ページに貼る →『作成する』→『ファイルを保存』 ③VHSlide の『ファイル → 開く』で読み込み、クラウドに保存すると入力欄が使える」を常に表示する。

# 作り方の注意
- 下の「進め方」と「決まり」は、このスペースで Muse が守るルールとして、**一字一句そのまま** 保存する（要約・省略しない）。
- 点検の数え上げをプログラムで行えるなら、プログラムで行う（Muse の「できました」という自己申告で済ませない）。
- 教材の画像や結果は、このスペースの外に送らない。

${workflow}

${knowledge}`);

// 2. plain chat (no Space)
write("2_Museのチャットで使う指示.txt", `あなたは「VHSlide 授業スライド作成アシスタント」です。先生が渡す指導書・教科書・ワークシート（画像やPDF）から授業を設計し、VHSlide の授業スライドの元になる「レッスン仕様JSON」を書きます。先生はそのJSONを「VHSlide 授業スライド変換」ページに貼り付けて、VHSlide の作品ファイル（.vhslide.json）を作ります。
先生への返答・質問・説明は、すべて日本語で書く。スライドを別の形式（スライド作成機能、プレゼンテーションのファイル、画像）で作らない。

${workflow}

${knowledge}`);

// 3. converter page + guide
fs.copyFileSync(path.join(here, "dist", "vhslide-lesson-gemini", "1_VHSlide授業スライド変換.html"), path.join(out, "3_VHSlide授業スライド変換.html"));
write("はじめに.txt", `VHSlide 授業スライド（Muse 版）

Muse が授業を設計して「レッスン仕様JSON」を書き、先生のパソコンの変換ページがスライドのファイル（.vhslide.json）を作ります。
スライドの配置・背景の装飾・キャラクター・入力欄は変換ページが組み立てるので、Muse がページの見た目を崩すことはありません。

■ 準備（最初の1回）
- 「3_VHSlide授業スライド変換.html」をパソコンに保存する（ダブルクリックでブラウザーが開く。インターネットに送らず、ページの中だけで変換する）。
- Muse の「スペース」を使う場合：Muse に「1_Museにスペースを作らせる指示.txt」の中身をすべて貼って送る。できたスペースに教材を入れて使う。
- スペースを使わない場合：新しいチャットの最初に「2_Museのチャットで使う指示.txt」の中身をすべて貼り、続けて教材の画像を送って「授業スライドを作って」と頼む。

■ 使い方
1. Muse が配置・トーン・キャラクターを聞くので答える。
2. Muse が教材を書き写し、「数値の一覧」を見せる。教科書と見比べて、違う数値があれば直すよう伝えてから「この内容で設計して」と答える（ここが、数値の誤りを防ぐいちばん大事な確認）。
3. Muse の返答（\`\`\`json の部分）をコピーし、変換ページに貼る →「作成する」→「ファイルを保存」。
4. VHSlide の「ファイル → 開く」で読み込み、クラウドに保存すると入力欄が使える。
5. 変換ページでエラーが出たら「修正依頼をコピー」を押して Muse に貼る（原因のページ名も入っている）。

■ 変換ページが自動で直すもの
記述式の欄に付いた集計の公開・理由欄・選択肢、表の強調行の番号違い、列の数のずれなど。直したときは画面に「注意」として出る。
`);

const zip = path.join(here, "dist", "vhslide-lesson-muse.zip");
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-qr", "-X", zip, "vhslide-lesson-muse"], { cwd: path.join(here, "dist") });
for (const f of fs.readdirSync(out)) console.log(`${f} (${Math.round(fs.statSync(path.join(out, f)).size / 1024)}KB)`);
console.log(`${zip} (${Math.round(fs.statSync(zip).size / 1024)}KB)`);
