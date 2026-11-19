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

const ai = shared("ai.txt");
const themeList = Object.entries(themes).map(([k, t]) => `${k}（${t.label.replace(/（.*$/, "")}）`).join("、");
const mascotNames = { onigiri: "おにぎり", drop: "しずく", book: "本", sprout: "芽", kokeshi: "こけし", hiyoko: "ひよこ", ninjin: "にんじん", blob: "まる" };
const mascotList = [...mascotKinds.map(k => `${k}（${mascotNames[k] ?? k}）`), "none（なし）"].join("、");

// The same light flow as the Claude skill: confirm once → read and design → JSON → short report.
const workflow = `# 進め方
先生が指導書・教科書の画像を送って「授業スライドを作って」と言ったら、次のとおり進める。
1. 最初に1回だけ確認する（先生がすでに指定していれば聞かずに従う）。1つのメッセージにまとめ、番号付きの選択肢で聞く。
   - 配置：lesson-rows（1行＝1時間、既定）／phase-grid（導入・展開・まとめを縦に）
   - トーン：${themeList} から教材に合う2〜3個をすすめる（同じ単元の前の時間と同じものがあれば、それを第一にすすめる）
   - キャラクター：${mascotList} から教科に合うものをすすめる
   - 複数時間の単元なら、何時間目まで作るか
2. 答えを受けたら、教材を読み、まず下の「授業スライドを設計する考え方」で、誰がどう使う授業か・授業の型・構造（シート・行・リンク）を決め、子供になったつもりで動線をたどる。それから「設計の決まり」に従ってレッスン仕様JSONを書き、最後に子供と先生の立場で1周たどって直す。途中で先生への確認は挟まず、最後まで仕上げる。
3. レッスン仕様JSONを \`\`\`json のコードブロック1つで出す（コメント・末尾のカンマのない正しいJSON）。
4. 続けて短く報告する：設計の考え方（どう使われる授業と見て、どんな構造と工夫にしたか。2〜3行）、構成（場面と主なページ）、入力欄の一覧、教科書と照合してほしい数値（読み取りに自信のない数値があれば）、使い方（「『VHSlide 授業スライド変換』ページにこの返答を貼る →『作成する』→『ファイルを保存』→ VHSlide の『ファイル → 開く』で読み込み、クラウドに保存すると入力欄が使える」）。
5. 先生が直したい点を言ったり、変換ページのエラー文を貼ったりしたら、直したレッスン仕様JSONの全体をもう一度出す。`;

const design = ai
  .replace(/^あなたは[^\n]*\n\n/, "")
  .replace(/# 出力\n[\s\S]*?(?=# 授業の設計)/, "")
  .replace(/\n# 読み取り結果について[\s\S]*$/, "\n")
  .replaceAll("_report.verify に挙げる", "報告の「照合してほしい数値」に挙げる");
const pedagogy = fs.readFileSync(path.join(here, "..", "reference", "pedagogy.md"), "utf8").replace(/^# 授業スライドを設計する考え方/, "# 授業スライドを設計する考え方（いちばん大事）");
const knowledge = `${pedagogy}

# 設計の決まり

${design}`;

// 1. the Space
write("1_Museにスペースを作らせる指示.txt", `Muse の「スペース」で、次のミニアプリを作ってください。名前は「VHSlide 授業スライド工房」。画面の文言はすべて日本語にしてください。

# 目的
先生が指導書・教科書・ワークシートの画像（またはPDF）を送って「授業スライドを作って」と言うだけで、Muse が授業スライドアプリ「VHSlide」用の「レッスン仕様JSON」を作る。できた JSON は、先生が「VHSlide 授業スライド変換」ページ（先生のパソコンにある HTML ファイル）で、スライドのファイル（.vhslide.json）に変える。このスペースはスライドのファイルそのものは作らない。

# スペースの使い方（先生の操作はこれだけ）
先生は、指導書・教科書の画像を送って「授業スライドを作って」と言うだけ。Muse は下の「進め方」で、配置・トーン・キャラクターを1回だけ聞いてから、授業を設計してレッスン仕様JSONを仕上げる。

# スペースの中身
1. 「レッスン仕様JSON」：できた JSON を表示し、ワンタップでコピーできる。報告（構成・入力欄の一覧・照合してほしい数値）も並べる。
2. 「作った授業」：作った授業（単元名・日付・トーン・JSON）を一覧で残す。同じ単元の次の時間を作るときは、前の時間のトーンとキャラクターをすすめる。
3. 「使い方」：「①JSON をコピー → ②『VHSlide 授業スライド変換』ページに貼る →『作成する』→『ファイルを保存』 ③VHSlide の『ファイル → 開く』で読み込み、クラウドに保存すると入力欄が使える」を常に表示する。

# 作り方の注意
- 下の「進め方」と「設計の決まり」は、このスペースで Muse が守るルールとして、**一字一句そのまま** 保存する（要約・省略しない）。
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
- すでに Muse に前の指示を入れてある場合：「4_Museへの更新のお知らせ.txt」をそのスペース（またはチャット）に貼る。まとめて入れ直すなら、1 または 2 を貼り直す。
- スペースを使わない場合：新しいチャットの最初に「2_Museのチャットで使う指示.txt」の中身をすべて貼り、続けて教材の画像を送って「授業スライドを作って」と頼む。

■ 使い方
1. 指導書の画像を送って「授業スライドを作って」と頼む。
2. Muse が配置・トーン・キャラクターを聞くので答える。あとは Muse がレッスン仕様JSONまで仕上げる。
3. Muse の返答をコピーし、変換ページに貼る →「作成する」→「ファイルを保存」。
4. VHSlide の「ファイル → 開く」で読み込み、クラウドに保存すると入力欄が使える。
5. 直したいところがあれば Muse にそのまま伝える。変換ページでエラーが出たら「AIへの修正依頼をコピー」を押して Muse に貼る。

■ 変換ページが自動で直すもの
記述式の欄に付いた集計の公開・理由欄・選択肢、表の強調行の番号違い、列の数のずれなど。直したときは画面に「注意」として出る。
`);

// 4. a short notice for a Muse that already has the earlier instructions (paste it into the Space or the chat)
write("4_Museへの更新のお知らせ.txt", `VHSlide 授業スライドの決まりを更新します。これまでの「進め方」「授業スライドを設計する考え方」「設計の決まり」に、次の内容を加えて、これからの授業スライドに使ってください（これまでの決まりは、そのまま守る）。

# 1. 新しく使える入力欄（type）
- "order"（並べ替え）：options に正しい順番で2〜10項目。語順・手順・時代の順の確認に。"asListed": true で入力した順のまま表示。
- "free"（自由入力）：手描き・画像の貼り付け・文字を1つの欄で組み合わせる。図を描いて文字で補足する説明や、作品の写真＋工夫の記録に。幅160・高さ120以上。
- "radar"（レーダーチャート）："radar": {"axes": [3〜10個], "series": [1〜4個], "min": 0, "max": 5}。
- 見出しの置き方："labelLeft": true（見出しを入力欄の左に。名前・日付・1行の記入欄に）、"labelVertical": true（labelLeft と一緒に縦書き）、"labelCompact": true（見出しを小さく詰める）。チェック欄には使わない。
- "reason"・"public" は single・multiple の欄だけ。"options" は single・multiple・order の欄だけ。

# 2. 新しく使えるページの部品
- form の {"type": "app", "url": "https://…", "x", "y", "w", "h"}：Webアプリをスライドに埋め込む（生徒が自分の端末で操作）。
- どのページにも "buttons": [{"text": "学習マップへ", "to": "ページのid"}] で移動ボタンを置ける。lesson に "mapButton": {"text": "手順マップへ", "to": "map"} を付けると全ページに同じボタンが付く。
- 思考ツール（ベン図・Yチャート・座標軸・心情円など）とウェビングは、先生がクラウドで作って配置するもので、JSON では作れない。使う授業では、スライドに場所と説明を用意し、notes に「授業前に フォーム →『思考ツール』で○○を作り、この枠に配置する」と書く。

# 3. 授業の型：製作・実習（調理、裁縫、工作、実験。説明書・レシピ・手順書がもとになる）
- 生徒ごとに進み具合が変わるので、自由進度学習と同じ考え方で組む。layout は "phase-grid"、工程ごとに1行。
- 2行目に「手順マップ」（form。各工程の四角に link、横に "type": "checkbox" の「完了」欄）と、回ごとの「今日の目標」「できたこと・次に気をつけること」の欄。
- lesson に mapButton を付け、どのページからも手順マップへ戻れるようにする。
- 工程のページは、図を大きく、下に「注意！」を1行（最も間違えやすい点）。手順の全文は notes へ。困ったとき用の基本操作（ミシン・包丁・火の扱いなど）も1行にする。完成作品は "free" の欄で写真＋文字で残す。

# 4. 図の描き方（SVG）
- 寸法は「どこからどこまで」が分かるように、測る2つの端から補助線（点線）を引き出し、矢印の先をその補助線に当てる。「○○の下の端から／○○の上の端まで」と言葉も添える。
- 縫う線・切る線などの「作業の線」と、布や材料の「面」の色を同系色にしない（例：縫う線＝マゼンタの破線、本体の布＝青、ポケット＝淡い黄）。指示の文字は引き出し線でその線につなぐ。
- 同じ単元の図は、色の決まりと小さな凡例をそろえる。手順の番号（①②③）と短い見出しを図に入れる。
- 教材の図や写真をそのまま写さず、内容をもとに描き直す（キャラクターは描かない）。

# 5. 国語の縦書きと、時間ごとの見分け
- 国語で本文・古文・詩・短歌などを読ませるページは、縦書きの {"kind": "passage", "text": "本文（改行で段落）", "note": "読み方の注意など"} にする。説明・問い・表は横書きのままでよい。
- 複数時間の作品では、時間ごとに色・キャラクターの色・「第N時」の印が自動で付く（変換ページが行う）。lesson の "color": "#rrggbb" で色、"mark": "第3時" で文字を変えられる。今日がどの時間かが、子どもに直感で分かるようにするため。

# 6. 作品の大きさ
- VHSlide は開いている作品をブラウザーの保存領域（約5MB、他の作品と共有）に自動保存する。入りきらないと「端末の保存容量が不足」と出る。
- SVG の図は本当に必要なページだけに描き、単純な形と少ない色で。長い単元は時間ごとに作品を分ける。変換ページは大きすぎると警告する（クラウドへの保存は25MBまでできる）。

この更新を受け取ったら、「更新を反映しました」とだけ答えてください。
`);

const zip = path.join(here, "dist", "vhslide-lesson-muse.zip");
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-qr", "-X", zip, "vhslide-lesson-muse"], { cwd: path.join(here, "dist") });
for (const f of fs.readdirSync(out)) console.log(`${f} (${Math.round(fs.statSync(path.join(out, f)).size / 1024)}KB)`);
console.log(`${zip} (${Math.round(fs.statSync(zip).size / 1024)}KB)`);
