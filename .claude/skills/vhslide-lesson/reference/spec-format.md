# レッスン仕様（lesson spec）の書き方

`build-deck.mjs` に渡すJSON。スライドは 960×540 の座標に自動配置されるので、座標は書かない。

```jsonc
{
  "title": "作品名",
  "course": "教科・単元（表紙の小見出し）",
  "layout": "lesson-rows",          // または "phase-grid"
  "theme": "natural",               // プリセット名、または { "base": "chic", "accent": "#c0392b", ... }
  "decor": true,                    // 装飾の背景（既定 true。false または --flat で図形だけの見た目）
  "mascot": "onigiri",              // onigiri | drop | book | sprout | kokeshi | hiyoko | ninjin | blob | none
  "lessons": [                      // 1要素＝1単位時間
    {
      "title": "4　中学生に必要な栄養",   // 表紙の題
      "short": "第4時 中学生に必要な栄養", // 行名・シート名・ルート名（80字まで）
      "hour": "第4時（全4時間）",
      "goal": "学習の目標",
      "worksheet": { "title": "ワークシート名", "summarySlide": true },
      "rubric": {                     // その時間のルーブリック（rubric スライドが参照）
        "lead": "今日の学習を、この観点でふり返ります。",
        "levels": ["A　十分満足できる", "B　おおむね満足できる", "C　努力を要する"],  // 省略時はこの3段階
        "criteria": [
          { "id": "self1", "name": "観点名（知識・技能）", "levels": ["Aの姿", "Bの姿", "Cの姿"] }
        ]
      },
      "phases": [
        { "name": "導入", "minutes": 10, "slides": [ /* スライド */ ] },
        { "name": "展開", "minutes": 30, "slides": [] },
        { "name": "まとめ", "minutes": 10, "slides": [] }
      ]
    }
  ]
}
```

## 配置

| layout | 行（上下） | 列（左右） | シート |
| --- | --- | --- | --- |
| `lesson-rows` | 単位時間（1時間目が1行目） | その時間の流れ | 1枚 |
| `phase-grid` | 導入・展開・まとめ | その場面の流れ | 1時間なら1枚、複数時間なら1時間ごとに1枚 |

どちらも各時間の授業順の **発表ルート** を作る。ワークシートは **1時間につき1つ**（セクション＝場面）。`summarySlide`（既定 true）で、時間の最後に「ワークシート全体」のページを追加する。

## スライド共通

| キー | 意味 |
| --- | --- |
| `kind` | 種類（下表） |
| `tag` | 見出しの左のラベル（省略時は場面名）。例：レッツスタート、図1、考えよう、解説 |
| `heading` | 見出し |
| `notes` | 発表者ノート（指導のポイント・留意点・予想される反応・評価） |

## 入力欄（field）

```jsonc
{ "id": "q1", "label": "問い（入力欄の見出し）", "type": "text", "placeholder": "書き出しの例",
  "options": ["選択肢"], "reason": true, "public": true, "height": 140, "hideLabel": false }
```

- `type`：`text`（既定）／`single`（1つ選ぶ）／`multiple`（複数選ぶ）／`checkbox`／`drawing`（画像・手描き：生徒が画像を貼り付けたり、ペンで書き込んだりできる）。0.109以降は枠いっぱいに表示され、クリックで道具が開く。0.109より前の版では見出し・道具ボタン・幅いっぱいの16:9キャンバスが並ぶため、古い版でも使えるよう枠の高さは「幅×0.56＋90」以上にしておく（足りないとビルドが警告する）。説明の欄とは横に並べると収まりやすい。選択肢は2〜10個。
- `hideLabel`：スライド上の回答欄で項目名を表示しない（VHSlide 0.106〜。チェック欄には使えない）。`placeholder` は画像・手描き欄では「貼り付け前の案内文」になる（0.107〜）。
- `reason`：選択式に理由欄を付ける。`public`：選択の集計を公開する。**`reason`・`public`・`options` は `single`・`multiple` の欄だけ**（VHSlide がほかの欄では読み込まない。付いていてもビルドが外して警告する。選択肢は重複不可）。`height`：ワークシート全体表示での入力欄の高さ（32〜400）。
- `id` は1時間の中で重複不可（英数字・`_`・`-`）。省略時は q1, q2…。1時間40個まで。

## スライドの種類

| kind | 主なキー | 用途 |
| --- | --- | --- |
| `title` | `title` `subtitle` `goal` `note` | 表紙（目標は lesson.goal を既定に使う） |
| `task` | `text` `clues[]` | 学習課題 |
| `question` | `variant`（`band` 帯／`bubble` キャラクターの吹き出し。省略時は自動で交互）、`prompt` `field` または `fields[]`（2〜3。`share: [0.62, 0.38]` で横幅の比、`stack: true` で縦に重ねて `share` は高さの比）、左側に `hints[]`(+`hintsTitle`)／`table`／`chart`／`image`／`body` のいずれか、`split`（左の幅の比率） | 問いと入力欄 |
| `fields` | `prompt` `keywords[]` `fields[]` | まとめ・ふり返り（入力欄を横に並べる） |
| `figure` | `image`（png/jpg/webp/gif/svg のパス）`alt` `lead` `source` `field` `imageShare` | 図の読み取り |
| `table` | `rows[][]`（1行目が見出し、`\n`で改行）`highlight[]`（強調する行番号。見出し行を0と数える）`widths[]`（列の幅の比）`heights[]`（行の高さの比、0.25〜8）`fontSize` `lead` `source` `field` | 表 |
| `chart` | `chart: { type: bar/line/pie, title, data: [[ラベル, 値, 色(省略可)]], highlight: [ラベルか番号] }` `callout` `calloutTitle` `source` `field` | ネイティブグラフ |
| `cards` | `variant`（`grid` 並べる／`bento` 大きなタイル1つ＋小さなタイル。3〜5枚のとき。省略時は自動で交互）、`lead` `cards[{title, body, sub, tone}]` `columns` `footer` `bodySize` `subSize`（カードの文字が少なく余白が大きいときは大きくする） | 解説・まとめのカード |
| `flow` | `lead` `items[{top, bottom, note}]` `footer` | 「A → B」の対応図 |
| `points` | `items[[項目, 説明]]` `note{title, body}` | ポイントの一覧 |
| `board` | `task` `items[[見出し, 内容]]` | 板書例 |
| （共通） | `id`（ページID。`link` の行き先にする）`backdrop`（このページだけ背景にする画像のパス。`false` で背景なし）`backdropKind`（`title`／`section`／`content`／`plain`）`header: false` | すべてのページ |
| `section` | `number` `name` `minutes` `lead`（ふつうは自動。各場面の始まりに入る。`sectionSlides: false` で無効） | 場面の区切り |
| `statement` | `big`（大きな数字・言葉）`caption` `note` `bigSize` | 1枚1メッセージ。印象に残す数値・結論 |
| `compare` | `prompt` `left{title, items[] か body}` `right{…}` `field` `fieldHeight` | 2つを比べる（VS） |
| `steps` | `lead` `items[{title, body}]`（2〜5）`field` | 番号つきの手順 |
| `quiz` | `prompt` `choices[]`（2〜4）`id` `label` `reason`（既定true）`public`（既定true） | 大きな選択肢タイルと回答欄 |
| `rubric` | `lead` `selfCheck`（`true`＝観点ごとの A/B/C 自己評価欄、`"public"`＝集計も公開）`split` `fontSize`。内容は lesson.rubric（`rubric` キーで上書き可） | ルーブリック（見通し・自己評価） |
| `form` | `items[]`（座標で自由配置。`{type:"field", field, x, y, w, h, fontSize, stroke}`／`{type:"band", text, x, y, w, h, fill, color}`／`{type:"text", ...}`／`{type:"card", title, text, tone}`／`{type:"chart", chart}`／`{type:"table", table}`／`{type:"image", image, alt}`／`{type:"shape", shape, fill, stroke, text, vertical, link}`（吹き出し・星・矢印など。`link` に別ページの `id` を書くとボタンになる。`vertical: true` で縦書き）／`{type:"mascot", pose, x, y, s}`）`fieldFont` `stroke`。`header: false` で見出し帯を省き、ページ全体を使う（見出しありなら要素は y≧100 程度に置く）。グラフを2つ並べるなど、既定の型にない構図にも使う。色は #rrggbb かテーマの色名（例：`primarySoft`） | 紙のワークシートを1枚に再配置する、入力欄の多いページ |
| `custom` | `elements[]`（VHSlide の要素をそのまま） | 上で表せないもの・新機能の利用 |

`tone` は `plain`／`primary`／`accent`。グラフのラベルは短く（6字以内が目安）。長いと折り返す。

## テーマのJSON

```json
{ "base": "minimal", "label": "学校カラー", "accent": "#c0392b", "accentSoft": "#fbe9e7", "primary": "#1b2a49" }
```

使えるキー：`decor`（{style, headerBand, top, titleInk, titleDark, sectionInk, sectionNum, heroFrom, heroTo}）`shadow`（false で影なし）`icons`（false でアイコンなし）`font`（本文の書体）`headingFont`（見出しの書体）— sans／serif／mono／rounded（丸ゴシック）／klee（教科書風）／yomogi（手書き風）／ud（UDゴシック）／brush（筆文字）／shippori（見出し明朝）、`bg` `surface` `ink` `sub` `primary` `onPrimary` `primarySoft` `accent` `onAccent` `accentSoft` `line` `muted` `chart[]` `header`（band/underline/tab/chalk/gingham/brutal/bento/notebook/board/magazine/minimal）`card`（fill/strip/outline/brutal/bento/sticky）`tiles`（タイルの色の並び）`card`（fill/strip/outline）`mascot{body, outline, wrap, cheek, think, idea}`。色は必ず `#rrggbb`。
