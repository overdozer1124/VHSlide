import fs from "node:fs";
import crypto from "node:crypto";
const img = f => "data:image/png;base64," + fs.readFileSync(f).toString("base64");
const FIG1 = img("fig1.png"), MQ = img("mascot_q.png"), MA = img("mascot_a.png");
const DECK = "8f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const WS = "5b6c7d8e-9f0a-4b1c-9d2e-3f4a5b6c7d8e";
let n = 0; const id = p => `${p}-${++n}`;
const C = { dark: "#173d38", acc: "#e8742a", soft: "#fff4e3", bg: "#fffdf8", green: "#2e7d5b", pale: "#eef6f1", gray: "#5b6670", blue: "#2f6fd6", red: "#e0573e" };
const text = (t, x, y, w, h, fs = 22, o = {}) => ({ id: id("t"), type: "text", x, y, w, h, text: t, fontSize: fs, color: C.dark, ...o });
const shape = (shape, x, y, w, h, o = {}) => ({ id: id("s"), type: "shape", shape, x, y, w, h, fill: "#ffffff", stroke: C.dark, ...o });
const image = (src, x, y, w, h, alt) => ({ id: id("i"), type: "image", x, y, w, h, src, altText: alt, aspectLocked: true });

// --- worksheet ---
const sections = [
  { id: "start", title: "レッツスタート" },
  { id: "fig1", title: "図1 体の成長" },
  { id: "table1", title: "表1 食事摂取基準" },
  { id: "sports", title: "資料 スポーツと栄養" },
  { id: "summary", title: "まとめ・振り返り" },
];
const sec = s => ({ sectionId: s, section: sections.find(x => x.id === s).title });
const F = {
  q1: { id: "q1", label: "小学生の頃と比べて、今の食事の量や内容はどう変わった？", kind: "text", options: [], placeholder: "例：ごはんのおかわりが増えた、部活のあとにおなかがすく など", wide: true, ...sec("start") },
  q2: { id: "q2", label: "図1から読み取れることを書こう", kind: "text", options: [], placeholder: "身長・体重が大きく増えるのは何歳ごろ？ 男女でちがいはある？", wide: true, ...sec("fig1") },
  q3: { id: "q3", label: "表1から読み取れることを書こう（男女差・年齢による特徴）", kind: "text", options: [], placeholder: "例：12〜14歳の男子はカルシウムが1000mgで…", wide: true, ...sec("table1") },
  q4: { id: "q4", label: "12〜14歳の数値が、30〜49歳（大人）より多い栄養素はどれ？（男子・女子どちらかで考えよう）", kind: "multiple", options: ["エネルギー", "たんぱく質", "カルシウム", "鉄", "ビタミンA"], placeholder: "", wide: true, reason: true, aggregatePublic: true, ...sec("table1") },
  q5: { id: "q5", label: "スポーツをする人が、食事で特に気をつけたいことは？", kind: "text", options: [], placeholder: "エネルギー・栄養素・水分の3つの面から考えよう", wide: true, ...sec("sports") },
  q6: { id: "q6", label: "中学生の時期に十分とる必要のある栄養素を挙げ、その理由を説明しよう", kind: "text", options: [], placeholder: "○○は、△△のために必要だから。中学生は□□なので…", wide: true, inputHeight: 140, ...sec("summary") },
  q7: { id: "q7", label: "自分の食事をふり返ると、必要な栄養素はとれていそう？", kind: "single", options: ["十分とれていると思う", "だいたいとれている", "足りない栄養素がありそう", "とりすぎているものがありそう"], placeholder: "", wide: true, reason: true, aggregatePublic: true, ...sec("summary") },
  q8: { id: "q8", label: "これからの食事で気をつけたいこと", kind: "text", options: [], placeholder: "自分の活動（部活動など）や食事の仕方をふまえて書こう", wide: true, ...sec("summary") },
};
const field = (f, x, y, w, h, fontSize = 18) => ({
  id: id("f"), type: "shape", shape: "rounded", x, y, w, h, fill: "#ffffff", stroke: C.acc, strokeWidth: 2, color: C.dark, fontSize, text: f.label,
  responseField: { source: "worksheet", deckId: DECK, worksheetId: WS, field: f, showLabel: true, showSection: false },
});

// --- common parts ---
const header = (no, label, title) => [
  shape("rect", 0, 0, 960, 64, { fill: C.dark, stroke: C.dark, strokeWidth: 0 }),
  shape("rounded", 18, 12, 160, 40, { fill: C.acc, stroke: C.acc, text: label, color: "#ffffff", fontSize: 16, bold: true, textAlign: "center", verticalAlign: "middle" }),
  text(title, 196, 10, 670, 46, 28, { color: "#ffffff", bold: true, verticalAlign: "middle" }),
  text(no, 870, 18, 76, 32, 14, { color: "#cfe3dc", textAlign: "right", verticalAlign: "middle" }),
];
const ask = (t, y = 78, h = 74) => [
  shape("rect", 30, y, 800, h, { fill: C.soft, stroke: C.acc, strokeWidth: 2, text: t, color: C.dark, fontSize: 20, bold: true, verticalAlign: "middle", textAlign: "center" }),
  image(MQ, 842, y - 6, 86, 86, "考えようのキャラクター（おにぎり）"),
];
const slides = [];
const add = (x, y, title, elements, speakerNotes) => slides.push({ id: `p-${y}-${x}`, x, y, title, background: C.bg, elements, speakerNotes });

// ===== Row 0 導入 =====
add(0, 0, "4 中学生に必要な栄養", [
  shape("rect", 0, 0, 960, 540, { fill: C.dark, stroke: C.dark, strokeWidth: 0 }),
  text("家庭分野　2編1章　食事の役割と中学生の栄養の特徴", 60, 60, 760, 36, 20, { color: "#cfe3dc" }),
  text("4　中学生に必要な栄養", 60, 110, 700, 80, 52, { color: "#ffffff", bold: true }),
  shape("rect", 60, 230, 620, 120, { fill: "#ffffff", stroke: C.acc, strokeWidth: 3, text: "学習の目標\n中学生に必要な栄養の特徴について理解できる。", fontSize: 24, color: C.dark, verticalAlign: "middle" }),
  text("第4時（全4時間）　ワークシートに入力しながら進めます", 60, 380, 640, 36, 18, { color: "#ffd9b8" }),
  image(MA, 720, 210, 200, 200, "おにぎりのキャラクター"),
], "【第4時 全4時間】目標：中学生に必要な栄養の特徴について理解できる。\nこの授業はスライド内の入力欄（ワークシート）に生徒が回答します。クラウド保存後に配布してください。\n留意点：身長や体重について悩んでいる生徒もいるので、取り扱いに注意する。");

add(1, 0, "レッツスタート", [
  ...header("導入 10分", "レッツスタート", "小学生のころと比べてみよう"),
  ...ask("中学生の時期に必要なエネルギーや栄養素の量は、\n小学生や大人とどのように違うでしょうか？", 76, 80),
  shape("rect", 30, 170, 300, 340, { fill: C.pale, stroke: C.green, strokeWidth: 1, text: "ふり返りのヒント\n\n・給食やごはんの量\n・おかわりの回数\n・部活動のあとの空腹\n・家族（大人）の食事\n　と比べると？", fontSize: 19, color: C.dark }),
  field(F.q1, 350, 170, 580, 340, 20),
], "自分の食事の内容や量を小学生の頃と比べたり、家庭での家族（大人）の食事を振り返ったりして、自分なりに考えて発表できるよう促す。\n入力後、数名に発表させ、「量が増えた」「大人と同じくらい食べる」などの気付きを板書する。");

add(2, 0, "学習課題", [
  ...header("導入", "学習課題", "今日の課題"),
  shape("rect", 80, 150, 800, 160, { fill: "#ffffff", stroke: C.acc, strokeWidth: 4, text: "中学生は1日に\nどのくらいの栄養素をとる必要があるのだろうか。", fontSize: 32, bold: true, color: C.dark, textAlign: "center", verticalAlign: "middle" }),
  text("手がかり：①図1 体の成長の様子　②表1 食事摂取基準　③資料 スポーツと栄養", 80, 340, 800, 40, 20, { color: C.gray, textAlign: "center" }),
  image(MQ, 410, 390, 130, 130, "考えるキャラクター"),
], "学習課題を板書する。この後、図1→表1→資料の順に読み取り、まとめで課題に答える流れを示す。");

// ===== Row 1 図1 =====
add(0, 1, "図1 体の成長の様子", [
  ...header("展開 30分", "図1", "体の成長の様子を読み取ろう"),
  image(FIG1, 30, 76, 900, 237, "図1 身長・体重の平均値と1年間に伸びた身長（6〜17歳、男女別）。12〜14歳ごろ男子の伸びが大きい"),
  text("参考：文部科学省「学校保健統計調査」（令和4年度）の平均値をもとに作成（数値は概数）", 30, 312, 900, 22, 12, { color: C.gray }),
  field(F.q2, 30, 340, 900, 186, 20),
], "図1から読み取れることを考えて発表する。\n指導のポイント：中学生の体の成長には男女差があること、身長や体重の増加が著しい時期であることに気付くようにする。\n・男子は12〜13歳ごろ、女子は10〜11歳ごろに1年間の伸びが最も大きい。\n※身長・体重は個人差が大きいことにふれ、比べ合いにならないよう配慮する。");

add(1, 1, "解説 成長と栄養素", [
  ...header("展開", "解説", "体をつくる材料がたくさん必要"),
  text("中学生の時期は、身長や体重が大きく増える「成長期」。\n骨・筋肉・血液など、体の組織がどんどんつくられています。", 40, 80, 820, 76, 22),
  image(MA, 850, 76, 84, 84, "ひらめいたキャラクター"),
  ...[["骨・歯", "カルシウム", "🥛 🐟 🧀"], ["筋肉・内臓", "たんぱく質", "🐟 🥚 🫘"], ["血液（赤血球）", "鉄", "🥬 🦪 🍖"]].flatMap(([part, nut, food], i) => {
    const x = 40 + i * 300;
    return [
      shape("rect", x, 180, 270, 70, { fill: C.pale, stroke: C.green, text: part, fontSize: 24, bold: true, textAlign: "center", verticalAlign: "middle" }),
      shape("downArrow", x + 110, 256, 50, 46, { fill: C.acc, stroke: C.acc }),
      shape("rect", x, 308, 270, 70, { fill: C.soft, stroke: C.acc, strokeWidth: 2, text: nut, fontSize: 26, bold: true, textAlign: "center", verticalAlign: "middle" }),
      text(food, x, 386, 270, 40, 26, { textAlign: "center" }),
    ];
  }),
  shape("rect", 40, 440, 870, 76, { fill: "#ffffff", stroke: C.dark, strokeWidth: 1, text: "生命の維持・運動・学習のためのエネルギーも必要！\n→ 健康の土台となるしっかりとした体を、中学生の時期につくる", fontSize: 20, verticalAlign: "middle" }),
], "私たちが生命を維持し、運動したり学習したりするためには、エネルギーや栄養素が必要。骨や筋肉、内臓など体の組織をつくるためにも多くの栄養素が必要である。\n関連：p.34〜35「栄養素の種類と働き」を振り返るとよい。");

// ===== Row 2 表1 =====
const tbl = (rows, o = {}) => { const cols = rows[0];
  const r = rows.map((_, i) => `r${i}`), c = cols.map((_, i) => `c${i}`);
  const cellMap = {}; rows.forEach((row, i) => row.forEach((v, j) => (cellMap[`${r[i]}:${c[j]}`] = String(v))));
  return { rows: r, columns: c, header: true, cells: cellMap, ...(o.styles ? { styles: Object.fromEntries(Object.entries(o.styles).map(([k, v]) => { const [i, j] = k.split(","); return [`r${i}:c${j}`, v]; })) } : {}), ...(o.heights ? { heights: o.heights } : {}), ...(o.widths ? { widths: Object.fromEntries(o.widths.map((v, j) => [`c${j}`, v])) } : {}) };
};
const hl = { fill: "#ffe2c4", bold: true };
const T1 = [
  ["年齢・性別", "エネルギー\n(kcal)", "たんぱく質\n(g)", "カルシウム\n(mg)", "鉄\n(mg)", "ビタミンB1\n(mg)", "ビタミンB2\n(mg)"],
  ["10〜11歳 男", "2,250", "45", "700", "9.5", "0.9", "1.4"],
  ["10〜11歳 女", "2,100", "50", "750", "12.5", "0.9", "1.3"],
  ["12〜14歳 男", "2,600", "60", "1,000", "9.0", "1.1", "1.6"],
  ["12〜14歳 女", "2,400", "55", "800", "12.5", "1.0", "1.4"],
  ["15〜17歳 男", "2,850", "65", "800", "9.0", "1.2", "1.7"],
  ["15〜17歳 女", "2,300", "55", "650", "11.0", "1.0", "1.4"],
  ["30〜49歳 男", "2,750", "65", "750", "7.5", "1.2", "1.7"],
  ["30〜49歳 女", "2,050", "50", "650", "10.5", "0.9", "1.2"],
];
const t1styles = {}; [3, 4].forEach(i => T1[0].forEach((_, j) => (t1styles[`${i},${j}`] = hl)));
const table1 = (x, y, w, h, fontSize = 16, widths = [1.4, 1, 1, 1, 0.8, 1, 1]) => ({ id: id("tb"), type: "table", x, y, w, h, fontSize, color: C.dark, fill: "#ffffff", stroke: "#9fb3ad", textAlign: "center", table: tbl(T1, { styles: t1styles, widths, heights: { r0: 2 } }) });

add(0, 2, "表1 食事摂取基準", [
  ...header("展開", "表1", "食事摂取基準（1人1日あたり）"),
  shape("rect", 30, 72, 900, 62, { fill: C.pale, stroke: C.green, strokeWidth: 1, text: "食事摂取基準：健康の保持・増進のために、1日にとることが望ましいエネルギーや栄養素の量の基準。年齢・性別・身体活動レベルによって異なる。", fontSize: 17, verticalAlign: "middle" }),
  table1(30, 142, 900, 348, 16),
  text("出典：厚生労働省「日本人の食事摂取基準（2025年版）」より抜粋（エネルギーは身体活動レベルⅡ〔ふつう〕、鉄の女性は月経ありの値）。オレンジは中学生。", 30, 494, 900, 36, 12, { color: C.gray }),
], "表1 食事摂取基準の解説。\n図1とリンクさせ、男女差や各年齢の特徴を捉えて、中学生と成人の数値を比較し、中学生の時期にその栄養素が多く必要な理由を考えるよう促す。\n※掲載値は指導書・教科書の表1で必ず確認してください。");

add(1, 2, "問い 表1を読み取ろう", [
  ...header("展開", "考えよう", "表1から読み取れることは？"),
  ...ask("男女のちがい、年齢によるちがいに注目しよう。\n中学生（12〜14歳）の数値はほかの年代と比べてどう？", 76, 70),
  table1(30, 160, 520, 360, 12, [1.9, 1.2, 1.1, 1.2, 0.9, 1.2, 1.2]),
  field(F.q3, 565, 160, 365, 360, 18),
], "表1から読み取れることを考えて発表する。\n指導のポイント：男女差およびそれぞれの年齢別の特徴を考えるよう促す（中学生の数値と成人の数値を比較する、など）。\n予想される気付き：カルシウムは12〜14歳男子が1,000mgで最も多い／鉄は女子が多い（月経による損失）／エネルギーは男子のほうが多い。");

add(2, 2, "問い 大人と比べると？", [
  ...header("展開", "考えよう", "中学生と大人を比べよう"),
  { id: id("tb"), type: "table", x: 30, y: 80, w: 440, h: 300, fontSize: 16, color: C.dark, fill: "#ffffff", stroke: "#9fb3ad", textAlign: "center",
    table: tbl([["", "12〜14歳\n男", "30〜49歳\n男", "12〜14歳\n女", "30〜49歳\n女"], ["エネルギー", "2,600", "2,750", "2,400", "2,050"], ["たんぱく質", "60", "65", "55", "50"], ["カルシウム", "1,000", "750", "800", "650"], ["鉄", "9.0", "7.5", "12.5", "10.5"], ["ビタミンA", "800", "900", "700", "700"]], { widths: [1.3, 1, 1, 1, 1], heights: { r0: 1.8 } }) },
  text("単位：エネルギーkcal、たんぱく質g、カルシウム・鉄mg、ビタミンAµg", 30, 384, 440, 24, 12, { color: C.gray }),
  image(MQ, 180, 412, 110, 110, "考えるキャラクター"),
  field(F.q4, 490, 80, 440, 440, 18),
], "体が大人より小さくても、大人と同じかそれ以上に必要な栄養素があることに気付かせる。\n正答の例：男子…カルシウム・鉄　女子…エネルギー・たんぱく質・カルシウム・鉄。\n選択の集計を公開設定にしているので、ワークシートの集計を見せながら理由を発表させる。");

add(3, 2, "グラフ カルシウム", [
  ...header("展開", "資料", "カルシウムが一番必要なのはいつ？"),
  { id: id("c"), type: "chart", x: 30, y: 80, w: 560, h: 440, chart: { kind: "bar", title: "カルシウムの推奨量（男性・mg/日）", showValues: true, showLegend: false, series: [
    { id: "a", label: "10〜11歳", value: 700, color: "#9fb3ad" }, { id: "b", label: "12〜14歳", value: 1000, color: C.acc }, { id: "c", label: "15〜17歳", value: 800, color: "#9fb3ad" }, { id: "d", label: "18〜29歳", value: 800, color: "#9fb3ad" }, { id: "e", label: "30〜49歳", value: 750, color: "#9fb3ad" } ] } },
  shape("rect", 610, 90, 320, 250, { fill: C.soft, stroke: C.acc, strokeWidth: 2, text: "12〜14歳が一生でいちばん多い！\n\n骨がぐんぐん伸び、骨の量が増える時期。\nこの時期にためた骨の量が、将来の丈夫な骨のもとになる。", fontSize: 19, verticalAlign: "middle" }),
  image(MA, 700, 360, 140, 140, "ひらめいたキャラクター"),
], "表1の読み取りを補足するグラフ（日本人の食事摂取基準2025年版、男性の推奨量）。\n骨の成長が著しい時期であるため、カルシウムの基準が最も高いことを確認する。");

add(4, 2, "解説 中学生に多く必要な栄養素", [
  ...header("展開", "解説", "中学生に十分とりたい栄養素"),
  ...[["エネルギー", "成長と活発な活動のため", "ごはん・パン・めん", "#fff4e3"], ["たんぱく質", "筋肉・血液・内臓をつくる", "魚・肉・卵・大豆製品", "#eef6f1"], ["カルシウム", "骨や歯をつくる", "牛乳・乳製品・小魚・海藻", "#eef6f1"], ["鉄", "血液（赤血球）をつくる\n貧血を防ぐ", "レバー・赤身の肉・あさり・青菜", "#eef6f1"]].flatMap(([nut, role, food, fill], i) => {
    const x = 30 + (i % 2) * 455, y = 80 + Math.floor(i / 2) * 170;
    return [shape("rect", x, y, 445, 160, { fill, stroke: C.green, strokeWidth: 1 }),
      text(nut, x + 14, y + 8, 300, 40, 26, { bold: true, color: C.green }),
      text(`働き：${role}`, x + 14, y + 52, 420, 56, 19),
      text(`多く含む食品：${food}`, x + 14, y + 112, 420, 36, 17, { color: C.gray })];
  }),
  shape("rect", 30, 426, 900, 92, { fill: "#ffffff", stroke: C.acc, strokeWidth: 2, text: "成長が著しく活動が活発な中学生は、エネルギー・たんぱく質・カルシウム・鉄などを十分にとる必要がある。\nエネルギーの代謝を助けるビタミンB1・B2も大切。", fontSize: 19, verticalAlign: "middle" }),
], "中学生の時期は、成長が著しく、活動が活発な時期なので、エネルギー、たんぱく質、カルシウム、鉄などの栄養素を十分にとる必要があることを伝える。\n板書：身長や体重の増加が著しい→たんぱく質・カルシウム・鉄を十分にとる／活動が活発→エネルギー、ビタミンB1・B2を十分にとる。");

// ===== Row 3 スポーツ =====
add(0, 3, "資料 スポーツと栄養", [
  ...header("展開", "資料", "スポーツと栄養"),
  { id: id("c"), type: "chart", x: 30, y: 72, w: 900, h: 220, chart: { kind: "bar", title: "図2 1時間の運動で使うエネルギー（kcal）", showValues: true, showLegend: false, series: [
    { id: "a", label: "水泳", value: 500, color: C.acc }, { id: "b", label: "ランニング", value: 415, color: C.acc }, { id: "c", label: "サッカー", value: 350, color: C.acc }, { id: "d", label: "バスケ", value: 300, color: C.acc }, { id: "e", label: "バドミントン", value: 275, color: C.acc }, { id: "f", label: "野球", value: 250, color: C.acc }, { id: "g", label: "卓球", value: 200, color: C.acc } ] } },
  text("体重50kgの人が1時間行った場合の目安（水泳はクロール、ランニングは約8km/時）。出典：厚生労働省「健康づくりのための身体活動基準2013」より作成", 30, 292, 900, 22, 12, { color: C.gray }),
  shape("rect", 30, 320, 300, 200, { fill: C.pale, stroke: C.green, strokeWidth: 1, text: "毎日のようにスポーツをする人は、しない人より身体活動量が多く、必要なエネルギーの量も多くなる。", fontSize: 18, verticalAlign: "middle" }),
  field(F.q5, 345, 320, 585, 200, 18),
], "資料 スポーツと栄養の解説。\n運動の内容により、必要なエネルギー量が異なることを知らせる。\nスポーツをする人は、たんぱく質やカルシウム、鉄などの栄養素をたくさんとる必要があることを食事摂取基準と関連させながら説明する。運動時には水分補給が大切であることも説明する。");

add(1, 3, "解説 スポーツと栄養", [
  ...header("展開", "解説", "スポーツをする人の食事のポイント"),
  ...[["エネルギー", "運動で使う分を食事でしっかり補う"], ["たんぱく質・カルシウム・鉄", "筋肉や骨、血液を丈夫にし、運動の効果を高める"], ["ビタミンB1・B2", "エネルギーを効率よく使うために必要"], ["水分", "汗で失われる水分をこまめに補給する"]].flatMap(([k, v], i) => [
    shape("rect", 30, 80 + i * 66, 300, 56, { fill: C.soft, stroke: C.acc, strokeWidth: 2, text: k, fontSize: 19, bold: true, textAlign: "center", verticalAlign: "middle" }),
    text(v, 345, 80 + i * 66, 585, 56, 19, { verticalAlign: "middle" })]),
  shape("rect", 30, 352, 900, 166, { fill: "#ffffff", stroke: C.green, strokeWidth: 2, text: "プロに聞く！（管理栄養士の仕事から）\nスポーツ選手向けの食事でも、「これを食べれば強くなる」という特別なメニューはない。大切なのは、みなさんと同じく「バランスよく」食べること。1食で全部をそろえるのが難しければ、1日の食事全体で整えればよい。何をどれだけ食べればよいかを、自分で判断できるようになろう。", fontSize: 17 }),
], "解説3 プロに聞く！：スポーツをする人は、栄養バランスの良い食事を心がけていることを食事摂取基準と関連させて伝える。\n（教科書の「プロに聞く！」の記事を要約したもの。原文は教科書で確認する）");

// ===== Row 4 まとめ =====
add(0, 4, "まとめよう", [
  ...header("まとめ 10分", "まとめよう", "今日の課題に答えよう"),
  ...ask("中学生は1日にどのくらいの栄養素をとる必要があるのだろうか。", 76, 56),
  text("キーワード：成長・活動・エネルギー・たんぱく質・カルシウム・鉄・ビタミンB1・B2・食事摂取基準", 30, 140, 900, 30, 16, { color: C.gray }),
  field(F.q6, 30, 176, 900, 344, 20),
], "中学生の時期に十分とる必要のある栄養素を挙げ、その理由を説明する。\n評価の観点（知識・技能）：中学生に必要な栄養の特徴について理解している。\n入力内容から、栄養素と理由（成長・活動）を結び付けて説明できているかを見取る。");

add(1, 4, "ふり返り", [
  ...header("まとめ", "ふり返り", "自分の食事をふり返ろう"),
  field(F.q7, 30, 80, 440, 440, 18),
  field(F.q8, 490, 80, 440, 440, 18),
], "指導のポイント：自分の活動や食事の仕方を振り返り、エネルギーや栄養素の過不足などについても考えられるよう促す。\nカリキュラム・マネジメント：保健体育の「健康な生活と疾病の予防」と関連付け、スポーツの上達には栄養が重要であることを理解できるようにする。");

add(2, 4, "板書 まとめ", [
  ...header("まとめ", "板書", "中学生に必要な栄養"),
  shape("rect", 30, 78, 900, 46, { fill: "#ffffff", stroke: C.dark, strokeWidth: 1, text: "中学生は1日にどのくらいの栄養素をとる必要があるのだろうか。", fontSize: 20, verticalAlign: "middle" }),
  ...[["○ 身長や体重の増加が著しい", "→ たんぱく質、カルシウム、鉄を十分にとる"], ["○ 活動が活発", "→ エネルギー、ビタミンB1、ビタミンB2を十分にとる"], ["○ 食事摂取基準", "→ 1日にとることが望ましいエネルギーや栄養素の量の基準を示したもの\n　（年齢、性別、身体活動レベルによって異なる）"]].flatMap(([a, b], i) => [
    text(a, 50, 142 + i * 118, 860, 36, 24, { bold: true }),
    text(b, 80, 180 + i * 118, 840, 70, 21, { color: C.green })]),
  image(MA, 820, 430, 100, 100, "ひらめいたキャラクター"),
], "指導書の板書例に対応。最後に全員で確認する。");

add(3, 4, "ワークシート全体", [
  ...header("ふり返り", "ワークシート", "自分の回答を見直そう"),
  { id: id("ws"), type: "shape", shape: "rounded", x: 30, y: 76, w: 900, h: 450, fill: "#ffffff", stroke: C.acc, strokeWidth: 2, formFontSize: 16,
    worksheet: { deckId: DECK, worksheetId: WS, title: "中学生に必要な栄養 ワークシート", description: "各ページの入力欄と同じ回答です。ここからまとめて見直し・修正できます。", sections, fields: Object.values(F) } },
], "各スライドの入力欄と同じワークシートの全体表示。家庭学習や提出前の見直しに使う。");

for (const sl of slides) sl.elements = sl.elements.flatMap(e => {
  if (e.type !== "shape" || e.shape !== "rect" || !e.text || e.responseField) return [e];
  const { text: t, fontSize, color, bold, textAlign, verticalAlign, ...rest } = e;
  return [rest, { id: id("bt"), type: "text", x: e.x + 20, y: e.y + 4, w: e.w - 40, h: e.h - 8, text: t, fontSize: fontSize ?? 20, color: color ?? C.dark, ...(bold ? { bold } : {}), ...(textAlign ? { textAlign } : {}), verticalAlign: verticalAlign ?? "top" }];
});
const deck = {
  version: 1, title: "4 中学生に必要な栄養（家庭分野）",
  sheets: [{ id: "main", name: "中学生に必要な栄養", rowLabels: { 0: "導入", 1: "図1 体の成長", 2: "表1 食事摂取基準", 3: "資料 スポーツと栄養", 4: "まとめ" } }],
  slides,
  routes: [{ id: "lesson", name: "授業の流れ（50分）", slides: slides.filter(s => s.title !== "ワークシート全体").sort((a, b) => a.y - b.y || a.x - b.x).map(s => s.id) }],
};
fs.writeFileSync(process.argv[2], JSON.stringify(deck, null, 2));
console.log(slides.length, "slides", fs.statSync(process.argv[2]).size, "bytes");
