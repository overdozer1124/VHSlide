---
name: vhslide-lesson
description: Turn a teacher's guide (指導書) or textbook pages (images or PDF) into a VHSlide lesson deck JSON with in-slide worksheet answer fields, questions for students, generated figures and a simple mascot character. Use when the user asks to make 授業スライド / 授業用のVHSlide / スライドを指導書・教科書から作る, or wants a lesson deck in VHSlide JSON. Lets the user choose the layout (1行=1単位時間 or 導入・展開・まとめを縦に) and the tone (theme), and checks the result in the newest VHSlide version.
---

# 指導書・教科書から VHSlide の授業スライドを作る

**利用者への回答・報告・質問は、すべて日本語で書く。**

入力（指導書・教科書の画像やPDF）から授業の流れを読み取り、生徒への問いとワークシートの入力欄を含む VHSlide の作品JSONを作る。
組み立ては `scripts/build-deck.mjs` が行う。Claude は **授業の設計（レッスン仕様JSON）と図・イラスト** に集中する。

## 動作環境とスキルの場所

このスキルはどこに置いても動く。以下の `$SKILL` は **このSKILL.mdがあるフォルダ** を指す（例：リポジトリ内なら `.claude/skills/vhslide-lesson`、個人用なら `~/.claude/skills/vhslide-lesson`、claude.ai ならアップロードされたスキルのフォルダ）。最初に実際のパスを確かめて置き換える。

| 環境 | ビルド | 検証 |
| --- | --- | --- |
| VHSlide リポジトリのセッション | ○ | 最新版のアプリで読み込み検査＋全ページ撮影 |
| 個人用スキル（Claude Code） | ○ | VHSlide を GitHub から取得できれば同上。できなければ同梱の検査処理 |
| claude.ai のチャット | ○（Node.js が必要） | 同梱の検査処理（VHSlide の読み込み処理を同梱したもの）。撮影は省略 |

- 図の PNG 化は Chromium（Playwright）→ `rsvg-convert` → Python `cairosvg` の順に使えるものを使う。どれもなければキャラクターは同梱の画像（プリセットテーマの色）を使い、SVG の図は使えないので VHSlide のグラフ・表で表す。
- 撮影できない環境では、ビルドの見切れ推定（文字量から文字サイズを自動調整）に頼ることになるので、文章は短めにし、利用者に「VHSlide で開いて表示チェックを確認してください」と伝える。

## 0. 最初に確認すること（AskUserQuestion で1回にまとめる）

利用者の指定があれば聞かずに従う。聞くときも次の3点だけ。

| 項目 | 選択肢 | 既定 |
| --- | --- | --- |
| 配置（layout） | `lesson-rows`：1行＝1単位時間。左から右へ授業が進み、次の時間は下の行<br>`phase-grid`：導入・展開・まとめを縦に並べる2次元配置（複数時間ならシートを時間ごとに分ける） | `lesson-rows` |
| トーン（theme） | `natural` ナチュラル／`pop` ポップ／`chic` シック／`chalk` 黒板／`wa` 和／`minimal` ミニマル／Claude Design のデザインシステムから作る（[design.md](reference/design.md)） | `natural` |
| キャラクター | `onigiri`（食・家庭）／`drop`（理科・水）／`book`（国語・汎用）／`sprout`（生活・生き物）／`kokeshi`（和服・伝統文化）／`blob`（汎用）／`none` | 教科に合わせて選ぶ |

単元が複数時間にわたる場合は「何時間目まで作るか」も確認する。

## 1. 最新の VHSlide を把握する（機能改善を取り込む）

VHSlide は頻繁に機能が増える。作る前に、その時点の最新版の仕様を確認する。

- `check.mjs` は VHSlide のソース（いまのリポジトリ、`$VHSLIDE_REPO`、または GitHub から取得してキャッシュ）を探し、全ブランチのうち `package.json` の version が最も新しい版を自動で選んで検証する。同時に同梱の検査処理（`scripts/vendor`）もその版に更新する。
- ソースに届く場合は、新しい版の `docs/deck.schema.json`、`src/model.ts`（`Element` 型と `parseDeck`）、`src/releaseHistory.ts` の先頭数件を読み、`build-deck.mjs` が使っていない便利な要素（新しい図形・フォーム・集計表示など）があれば、`custom` スライドで使うか `build-deck.mjs` に種類を追加する。追加した場合は例で動作確認する。
- ワークシートの入力欄は `responseField`（source: worksheet）で置く。クラウド保存時に作品へ自動登録される（フォームの引き継ぎ、0.85.0以降）。古い版しかない場合は利用者にその旨を伝える。

## 2. 教材を読み、授業を設計する

指導書から次を抜き出す：学習目標、時数（第◯時／全◯時間）、学習の流れ（導入・展開・まとめと分数）、各活動の発問、指導のポイント・留意点、資料（図・表・グラフの数値）、板書例、評価の観点。

設計の原則：

- **問いを中心に組む。** 活動ごとに「生徒への問い（question/fields）→ 解説（cards/flow/points）」の対を作る。問いのページには必ず入力欄を置く。
- 調べ学習・観察・作品紹介など、画像があると伝わりやすい問いには `type: "drawing"`（画像・手描き）の入力欄を置き、説明用の `text` 欄と横に並べる（`share` で幅の比を指定。古い版でも隠れないよう、画像欄の高さは「幅×0.56＋90」以上にする）。ウェビングや図・絵をかく活動にも使える。
- 入力欄は1時間あたり5〜10個程度。選択式（single/multiple）には `reason: true` で理由欄を、全体で共有したいものには `public: true`（集計公開）を付ける。
- 資料の数値（表・グラフ）は教材から正確に写す。読み取りに自信がない数値は報告に明記し、教科書との照合を頼む。
- 実在の人物名・写真は載せない（記事は要約）。教科書の図をそのまま複製せず、数値から作り直す。
- 指導書の「指導のポイント」「留意点」「評価」は各ページの `notes`（発表者ノート）へ入れる。
- **ルーブリックを必ず付ける。** 各時間の `rubric`（観点 × A/B/C の3段階）を、指導書の「評価の観点」「評価規準」から作る。
  - 1行目は指導書の評価規準そのもの（記録に残す評価）。Bを「おおむね満足」＝評価規準の文言、Aは「より具体的・関連付けて・自分の言葉で」など質的に高い姿、Cは「努力を要する」状況とする。
  - 必要に応じて、授業内の活動（資料の読み取り・ふり返りなど）の観点を2〜3行目に加える（形成的評価・自己評価用であることをノートに書く）。
  - 生徒が読んで分かる言葉で、1マス50字程度まで。観点は2〜4個。
  - 導入（学習課題の直後）に `{"kind":"rubric"}` で見通しとして示し、まとめ（最後のふり返りの前）に `{"kind":"rubric","selfCheck":"public"}` で観点ごとのA/B/C自己評価欄を置く。自己評価はワークシートに入り、集計も見られる。
- 1ページの情報量を絞る。文章は1ボックス3行以内を目安にし、長い説明はページを分ける。

## 3. 図とイラストを作る

- **グラフ**：棒・折れ線・円の1系列は VHSlide のネイティブグラフ（`chart`）を使う（編集できる）。男女比較など複数系列や注釈が要る図は SVG を書いて PNG にする。
- **SVG の図**：`width`/`height` 属性付きの SVG ファイルを書き、スライドの `image` に `.svg` のパスを指定すれば自動で PNG 化される。フォントは `font-family="IPAPGothic, sans-serif"`。配色はテーマの色に合わせる（[design.md](reference/design.md)）。
- **キャラクター**：`scripts/mascot.mjs` の図形キャラクターを自動で配置する（問い＝?、解説＝!、表紙＝♪）。新しい種類が必要なら同じ 260×260 の流儀で `bodies` に追加する。既存作品のキャラクターの模倣はしない。

## 4. レッスン仕様を書いてビルド

仕様の書き方は [spec-format.md](reference/spec-format.md)、完成例は [examples/nutrition.spec.json](examples/nutrition.spec.json)。作業ファイルはスクラッチパッドに置く。

```bash
node "$SKILL/scripts/build-deck.mjs" lesson.spec.json out/lesson.vhslide.json --layout lesson-rows --theme natural
```

`--layout` `--theme` `--mascot` は仕様内の指定より優先される。テーマは JSON ファイルも渡せる。

## 5. 最新版のアプリで検証する（必須）

```bash
node "$SKILL/scripts/check.mjs" out/lesson.vhslide.json --out out/check
```

- 読み込み検査（その版の `parseDeck`）と、ワークシートが1時間ごとに正しく引き継げるかを確認する。
- アプリで実際にJSONを開き、「表示チェック」（見切れ）の結果を読み、全ページを撮影して `contact-*.png` に一覧化する。
- **一覧画像を必ず目で見て**、文字の見切れ・重なり・余白の偏り・図の読みにくさを直し、再ビルド・再検証する。表示チェックが「見切れなし」になるまで繰り返す。
- 初回は依存パッケージの準備に数分かかる。
- ソースに届かない環境では自動で `validate.mjs`（同梱の検査処理）だけを行う。直接 `node "$SKILL/scripts/validate.mjs" out/lesson.vhslide.json` でもよい。

## 6. 渡し方

- 完成JSONと一覧画像を利用者に渡す（Claude Code では `SendUserFile`、claude.ai ではダウンロードできるファイルとして出力）。ファイル名は `<単元名>.vhslide.json`。
- 伝えること：構成（行・列と各ページ）、入力欄の一覧、使い方（「ファイル → 開く」→ **クラウドに保存** で入力欄が有効になる）、照合してほしい数値・出典、検証の結果。
- VHSlide のリポジトリで作業している場合に限り、残すときは `lessons/<単元>/` に JSON・仕様・図を置く。アプリのコードを変えていなければ、更新履歴・バージョンは変更しない。
