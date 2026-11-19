#!/usr/bin/env node
// Build the prompt that asks Gemini Canvas to make a "paste images → lesson spec JSON" app.
// The app calls Gemini from inside Canvas; the JSON then goes to the converter page (gemini/converter) to become .vhslide.json.
// Run after build-gem-pack.mjs (it reuses that pack's knowledge files). Output: gemini/dist/Canvasへの指示.txt
import fs from "node:fs";
import path from "node:path";
import { themes } from "../scripts/themes.mjs";
import { mascotKinds } from "../scripts/mascot.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const pack = path.join(here, "dist", "vhslide-lesson-gemini", "知識ファイル");
const read = f => fs.readFileSync(path.join(pack, f), "utf8");
const cut = (s, from) => (s.includes(from) ? s.slice(0, s.indexOf(from)) : s);

const kinds = ["title", "task", "question", "fields", "figure", "table", "chart", "cards", "flow", "points", "board", "section", "statement", "passage", "compare", "steps", "quiz", "rubric", "form"];
const themeList = Object.entries(themes).map(([k, t]) => `${k}（${t.label.replace(/（.*$/, "")}）`).join("、");
const mascotNames = { onigiri: "おにぎり", drop: "しずく", book: "本", sprout: "芽", kokeshi: "こけし", hiyoko: "ひよこ", ninjin: "にんじん", heian: "平安の姫", blob: "まる" };
const mascotList = [...mascotKinds.map(k => `${k}（${mascotNames[k] ?? k}）`), "none（なし）"].join("、");

// the AI's instructions inside the app: design rules + the spec format + design notes + a compact example
const spec = cut(read("01_レッスン仕様の書き方.txt"), "## 長い単元を分けて出す（Gem専用）").replaceAll("（Gem専用）", "");
const ai = `あなたは「VHSlide 授業スライド設計AI」です。先生が渡す指導書・教科書・ワークシートの画像やPDFから授業を設計し、VHSlide の「レッスン仕様JSON」を1つだけ出力します。

# 出力
- 出力は JSON オブジェクト1つだけ。前後に文章やコードブロックの記号を付けない。コメント・末尾のカンマは書かない。
- 一番上に "_report" を入れる：{"summary": "構成の説明（行と主なページ）", "fields": ["q1：入力欄の見出し", …], "verify": ["教材と照合してほしい数値や読み取りに自信のない箇所", …]}。
- 先生の指定（配置・トーン・キャラクター・時間の範囲・メモ）があれば必ず従う。

# 授業の設計
- 指導書から、学習目標・時数・学習の流れ（導入／展開／まとめと分数）・発問・指導のポイントと留意点・資料（図・表・グラフの数値）・板書例・評価の観点を抜き出す。
- 問いを中心に組む。活動ごとに「生徒への問い（question・fields・quiz）→ 解説（cards・flow・points・statement）」の対にする。問いのページには必ず入力欄を置く。
- ページの型を混ぜて単調にしない。同じ kind を3枚続けない。数値や結論を印象づけるなら statement、2つの違いは compare、順番のある内容は steps、全員参加の確認は quiz。
- 入力欄は1時間に5〜10個。選択式（single・multiple）には "reason": true（理由欄）や "public": true（集計の公開）を付ける。**"reason"・"public" は single・multiple の欄だけ、"options" は single・multiple・order（並べ替え）の欄だけに付ける**（ほかの欄に付けると VHSlide で読み込めない）。語順や手順を答えさせるなら "type": "order"（options に正しい順番）。画像があると伝わる問い（調べ学習・観察・作品紹介）には "type": "drawing" の欄を text の欄と横に並べる。
- ルーブリックを必ず付ける。各時間の rubric は観点×A/B/Cの3段階。1行目は指導書の評価規準（B＝評価規準の文言、Aは質的に高い姿、Cは努力を要する状況）。観点は2〜4個、1マス45字まで。導入の学習課題の直後に {"kind":"rubric"}、まとめではふり返りの後に {"kind":"rubric","selfCheck":"public"}（順序：課題への回答→ふり返り→自己評価）。
- 指導書の「指導のポイント」「留意点」「評価」「予想される反応」「記入例」は notes（発表者ノート）に入れ、生徒の画面には書かない。
- 資料の数値は教材から正確に写す。自信のない数値は _report.verify に挙げる。
- 実在の人物名・写真は載せない。教科書の図はそのまま写さず、数値から作り直す（グラフは chart、表は table）。
- 紙のワークシートの画像を渡されて「スライドにして」と言われたら、kind "form" で入力欄を座標配置して1ページに組み直す（A4縦→横長は列や上下の帯に組み替える。項目名・順序は原本どおり、入力欄の高さは44以上）。
- 文字があふれないように：1つの枠に3行まで。表のセルは1行に収め、セルの中で改行しない（見出し行だけ改行可）。表の横に入力欄を置くときは表を4列まで。グラフのラベルは6字以内。
- 表の "highlight" は見出し行を0と数えた行番号（見出しの次の行が1）。ない行の番号を書かない。表は12行・12列まで、どの行も同じ列数にする。
- 作品は VHSlide の「この端末に保存」（ブラウザーの保存領域・約5MB）に入る大きさにする。SVG の図は本当に必要なページだけに描き、単純な形と少ない色で。大きな単元は時間ごとに作品を分ける（変換ページは大きすぎると警告する）。
- 数値の比較（割合・量）は SVG の図ではなく chart（bar・pie）か table で表す。SVG は流れ図・模式図だけに使い、文字は font-family='sans-serif'、1つの <text> に1行（改行は <text> を分ける）、図形と文字を重ねない。
- 知らない kind・キー・テーマ名・キャラクター名を作らない。

${spec}

${read("02_デザインとトーン.txt")}

# 完成例（ページの型の見本）
${read("05_見本_ページの型.txt").replace(/^[^\n]*\n\n/, "")}
`;
const reader = `あなたは教材の「書き写し係」です。渡された1枚の画像（指導書・教科書・ワークシートのページ）に書かれていることを、要約せず、そのまま書き写します。授業の設計はしません。

# 守ること
- 見えている文字だけを書く。推測で補わない。読めない字は「■」、自信のない語には［?］を付け、unclear に場所と理由を書く。
- 表は行と列をそのまま写す。数値・単位・注記も省かない。
- **数値を作らない。** 数字は、画像の中に数字として印刷されているものだけを書く。グラフの棒の長さや目盛りから値を推定しない（値が印刷されていなければ value は null）。覚えている知識（食品成分表の値など）で補わない。
- 書いた数値には、すべて box_2d（その数字が印刷されている場所。画像を0〜1000とした [ymin, xmin, ymax, xmax]）を付ける。場所を示せない数値は書かない。
- グラフは、題・単位・各項目の名前と、印刷されている値を写す。
- 指導書の欄（本時の目標、学習活動と時間、発問、指導上の留意点・指導のポイント、評価規準・評価方法、板書例、予想される反応、記入例）は、どの欄の文かが分かるように分けて写す。
- 写真・挿絵は、何が写っているかを短く書く（人物名は書かない）。

# 出力（JSON オブジェクト1つだけ）
{"kind": "教科書|指導書|ワークシート|その他", "pageLabel": "ページ番号や見出し",
 "text": "本文を上から順に、改行もそのまま書き写したもの",
 "tables": [{"title": "", "rows": [["", ""]], "note": ""}],
 "charts": [{"title": "", "unit": "", "items": [{"label": "", "value": null}]}],
 "numbers": [{"value": "印刷されているとおりの数字（例：1,000）", "unit": "", "label": "何の値か（例：牛乳のカルシウム）", "box_2d": [0, 0, 0, 0]}],
 "figures": ["図・写真の短い説明"],
 "guide": {"goal": "", "flow": [{"phase": "導入", "minutes": 0, "activity": "", "questions": [""], "points": [""], "evaluation": [""]}], "boardPlan": "", "expectedAnswers": [""]},
 "unclear": ["読めなかった箇所と理由"]}
`;
const aiPlus = `
# 読み取り結果について
- 先生が確認した「読み取り結果」が渡される。数値は読み取り結果の numbers にあるものだけを、そのまま使う（単位の換算・四捨五入・合計などの計算もしない）。読み取り結果にない数値は、覚えている知識からでも書かない。グラフの値が null の項目は、値を書かずに項目名だけで扱う（chart にはしない）。
- 読み取り結果の guide.flow の学習活動は、省略せずすべて扱う（活動1つにつき1ページ以上）。指導のポイント・留意点・評価・予想される反応は、対応するページの notes に入れる。
- 出力を短くするために、ページ・入力欄・notes・ルーブリックの観点を減らさない。
`;
const aiAll = ai + aiPlus;
if ((aiAll + reader).includes("</script")) throw Error("the AI instructions must not contain </script");

const prompt = `Canvas で、次のウェブアプリを1つの HTML ファイルとして作ってください。画面の文言はすべて日本語にしてください。

# アプリの目的
先生が指導書・教科書・ワークシートの画像（またはPDF）を貼り付けるだけで、授業スライドアプリ「VHSlide」用の「レッスン仕様JSON」を作るアプリ。JSON は、アプリの中から Gemini（Canvas のアプリから使える Gemini API。APIキーは Canvas が用意する方法で、空のままでよい）を呼び出して作る。
できた JSON は、先生が別の「VHSlide 授業スライド変換」ページに読み込んで、スライドのファイル（.vhslide.json）に変える。このアプリ自身はスライドのファイルを作らない。

# 画面と機能
1. 教材の入力
   - 画面のどこでも Ctrl+V（Mac は ⌘+V）で画像を貼り付けられる。ドラッグ＆ドロップ、「ファイルを選ぶ」ボタン（画像は複数、PDF も可）にも対応する。
   - 追加した教材は小さなサムネイルで並べ、1つずつ削除できる。順番は追加した順（ページ順）。
2. 設定（すべて「おまかせ」を選べる）
   - 配置：lesson-rows（1行＝1時間、既定）／phase-grid（導入・展開・まとめを縦に）
   - トーン：${themeList}
   - キャラクター：${mascotList}
   - 作る範囲：例「第1時のみ」「第1〜3時」（自由入力）
   - 先生のメモ（自由入力。例：「グループ活動を入れたい」「45分授業」）
3. 手順1「教材を読み取る」ボタン（読み取りを設計と分け、数値は必ず「画像のどこにあるか」で裏付ける）
   - 読み取りの呼び出しは temperature 0。画像は縮小しない（generationConfig に mediaResolution を高解像度にする設定があれば使う）。PDF はページごとに画像にしてから扱う。
   - (a) 書き写し：教材を **1枚ずつ** 下の「読み取りAIへの指示」で書き写させる（応答は JSON）。数値には、画像のどこにあるかを box_2d（[ymin, xmin, ymax, xmax]、画像を0〜1000とした座標）で付けさせる。
   - (b) 小さい文字の読み直し：画像を縦横2×2に、重なりを付けて4つに切り分け、2倍に拡大した画像でも書き写させ、(a) と数値を照らし合わせる。
   - (c) 数値ごとの確認：書き写した数値1つずつについて、box_2d の場所を少し広めに切り抜き、3倍に拡大して「この画像に書かれている数字と単位を、そのまま書き写して。数字が無ければ "なし" と答えて」とだけ尋ねる（ほかの情報は渡さない）。
   - 判定（JavaScript で行う）：(a)・(b)・(c) がすべて同じ → 「確認済み」。どれかが違う → 「要確認」。box_2d が無い、範囲外、または (c) が「なし」 → 「根拠なし」（作られた数値の疑い）。
   - 結果の画面：左に元の画像（数値の場所に枠を重ねる）、右に読み取った内容。数値はすべて一覧にし、それぞれに「切り抜いた画像」「読み取った値」「判定」を並べる。「要確認」は黄、「根拠なし」は赤で示し、先生がその場で値を直すか削除できる。
   - 「根拠なし」と「要確認」が残っている間は「この内容で設計する」を押せない（先生が直すか、削除するか、「この値で正しい」と確認すると押せる）。
4. 手順2「授業を設計する」ボタン
   - 下の「AIへの指示」を system instruction とし、先生が確認した読み取り結果（文字）・元の画像・設定を送る。応答は JSON。
   - 複数の時間を作るときは、1時間ずつ別々に依頼して最後に1つにまとめる（長い出力で途中が省かれるのを防ぐ）。
   - temperature は低め（0.2 程度）。作成中は進み具合を表示する。混み合い（429 など）のときは少し待って自動でやり直す（最大3回）。
5. 検査と自動修正（アプリの JavaScript で行う。AI の自己申告ではなく、コードで数えて確かめる）
   - 形の検査
     - JSON として読めること。title（文字列）と lessons（1つ以上）があること。各 lesson に phases があること。
     - 各スライドの kind が次のどれかであること：${kinds.join("、")}。
     - 1つの lesson（時間）の中で入力欄の id が重複しないこと。入力欄は fields・field・quiz の id・rubric の selfCheck（観点の数だけ）を数え、1時間40個まで。
     - 選択肢（options・choices）は2〜10個、それぞれ100字以内で、同じ選択肢を重ねない。
     - "public"・"reason" は type が single か multiple の入力欄にだけ、"options" は single・multiple・order の入力欄にだけ付ける（ほかに付いていたら問題とする）。
     - 表（table の rows）は1〜12行・1〜12列で、どの行も同じ列数。"highlight" の番号は見出し行を0とした行番号で、ある行の番号だけ。"widths" の数は列数、"heights" の数は行数と同じ。
     - theme はトーンの名前か {"base": トーンの名前, …}、mascot はキャラクターの名前であること。
   - 中身の検査（手抜きを防ぐ）
     - 1時間ごとに、入力欄（ルーブリックの自己評価を除く）が5個以上あること。
     - lesson.rubric.criteria が2〜4個で、どの観点も levels が3つ（A・B・C）あること。rubric スライドが導入とまとめに1枚ずつあること。
     - question・fields・quiz のページに入力欄があること。
     - notes（発表者ノート）の付いたページが、表紙・区切りを除いたページの半分以上あること。
     - 同じ kind のページが3枚続かないこと。
     - 読み取った指導書に学習活動（flow）が書かれていれば、その活動の数より極端にページが少なくないこと（活動1つにつき1ページ以上）。
   - 数値の照合（読み取りの誤り・作り話を防ぐ）
     - スライドの文字（table・chart・statement・compare・cards・points・flow の値と文章）から数値を抜き出し（カンマは除く）、先生が確認した読み取り結果の numbers（と表・本文）に同じ数値があるかを調べる。
     - 見つからない数値は「教材に見当たらない数値」として一覧にし、画面で目立たせる。
   - 問題があれば、問題点の一覧（何がいくつ足りないか、どの数値が教材にないか）をそのまま Gemini に送り、「直した JSON 全体」を出してもらう（最大2回）。それでも残る問題は画面に表示する。
6. 結果の表示
   - _report の summary（構成）、fields（入力欄の一覧）、verify（照合してほしい数値）を見やすく表示する。「教材に見当たらない数値」も並べて表示する。
   - 時間ごと・場面ごとのページ一覧（kind と見出し）を表示する。
   - JSON 全体を編集できるテキスト欄に表示する（編集したら再検査）。
   - 「JSONをコピー」「JSONを保存」（ファイル名は title をもとに「○○.lesson.json」）ボタン。
   - 「修正を頼む」欄：先生が「3枚目の問いをもっと易しく」などと書くと、今の JSON・読み取り結果と一緒に Gemini に送り、直した JSON 全体に置き換える（検査もやり直す）。
7. 使い方の案内（画面の下に常に表示）
   「①保存した JSON を『VHSlide 授業スライド変換』ページで開く（または貼り付ける）→『作成する』→『ファイルを保存』 ②VHSlide の『ファイル → 開く』で読み込み、クラウドに保存すると入力欄が使える」

# 作り方の注意
- 下の「読み取りAIへの指示」と「AIへの指示」は **一字一句そのまま** アプリに入れる（要約・省略・書き換えをしない）。JavaScript の文字列にすると記号でこわれるので、それぞれ <script type="text/plain" id="read-instructions"> と <script type="text/plain" id="ai-instructions"> の中に置き、textContent で読み込む。
- 検査・数値の照合・やり直しの回数は、すべて JavaScript で行う。Gemini に「検査した」と答えさせて済ませない。
- 教材の画像・PDF・できた JSON は、Gemini への送信以外の外部には送らない。
- 見た目は落ち着いた教員向けのデザインにし、パソコンの画面で見やすくする。

# 読み取りAIへの指示（次の「AIへの指示」の見出しの前まで、そのままアプリに入れる）

${reader}

# AIへの指示（ここから下をすべて、そのままアプリに入れる）

${aiAll}`;

// a reading-only app, to check (and improve) how accurately the material is read before designing lessons
const step1 = prompt.slice(prompt.indexOf("3. 手順1"), prompt.indexOf("4. 手順2"));
const readerOnly = `Canvas で、次のウェブアプリを1つの HTML ファイルとして作ってください。画面の文言はすべて日本語にしてください。

# アプリの目的
先生が指導書・教科書の画像（またはPDF）を貼り付けると、書かれている文字と数値を **正確に** 書き写すアプリ。数値は必ず「画像のどこに印刷されているか」で裏付け、根拠のない数値（AI が作った数値）を見つけて知らせる。
AI は、アプリの中から Gemini（Canvas のアプリから使える Gemini API。APIキーは Canvas が用意する方法で、空のままでよい）を呼び出して使う。

# 画面と機能
1. 教材の入力：画面のどこでも Ctrl+V（Mac は ⌘+V）で画像を貼り付けられる。ドラッグ＆ドロップと「ファイルを選ぶ」（画像は複数、PDF も可）にも対応。サムネイルで並べ、1つずつ削除できる。
2. ${step1.replace(/^3\. /, "").replace("「この内容で設計する」を押せない（先生が直すか、削除するか、「この値で正しい」と確認すると押せる）", "「読み取り結果を保存」を押せない（先生が直すか、削除するか、「この値で正しい」と確認すると押せる）")}
3. 読み取り結果の保存：先生が確認した結果を JSON（ファイル名「○○.reading.json」）で保存・コピーできる。数値の一覧（値・単位・何の値か・判定）は表としても表示し、CSV でも保存できる。
4. 混み合い（429 など）のときは少し待って自動でやり直す（最大3回）。進み具合（何枚目の何番目の数値を確認中か）を表示する。

# 作り方の注意
- 下の「読み取りAIへの指示」は **一字一句そのまま** アプリに入れる。<script type="text/plain" id="read-instructions"> の中に置き、textContent で読み込む。
- 判定（確認済み・要確認・根拠なし）は JavaScript で行う。Gemini に「確認した」と答えさせて済ませない。
- 画像や結果は、Gemini への送信以外の外部には送らない。

# 読み取りAIへの指示（ここから下をすべて、そのままアプリに入れる）

${reader}`;
fs.writeFileSync(path.join(here, "dist", "Canvasへの指示_読み取りだけ.txt"), readerOnly);

// shared with build-muse-pack.mjs
fs.mkdirSync(path.join(here, "dist", "shared"), { recursive: true });
for (const [f, t] of Object.entries({ "ai.txt": aiAll, "reader.txt": reader })) fs.writeFileSync(path.join(here, "dist", "shared", f), t);

const out = path.join(here, "dist", "Canvasへの指示.txt");
fs.writeFileSync(out, prompt);
console.log(`${out} (${Math.round(Buffer.byteLength(prompt) / 1024)}KB, ${prompt.length} characters)`);
