# Generates meros.spec.json (run: python3 make-spec.py)
import json
A = "src/assets/"
KING_LINE = "信実とは、決して空虚な妄想ではなかった。"

def scene(field=None, meros_text=None, link_back=None):
    """The closing scene: sunset, the king (right) and Meros seen from behind (left)."""
    items = [
        {"type": "image", "image": A + "king.png", "alt": "メロスに手を差し出す王様", "x": 478, "y": 0, "w": 482, "h": 364},
        {"type": "image", "image": A + "meros-back.png", "alt": "王様と向き合うメロスの後ろ姿", "x": 0, "y": 168, "w": 312, "h": 372},
        {"type": "shape", "shape": "rounded", "x": 50, "y": 14, "w": 580, "h": 104, "fill": "#fffaf0", "stroke": "#3a2a1c", "strokeWidth": 3,
         "text": KING_LINE, "fontSize": 26, "pad": [0.05, 0.12, 0.05, 0.12], "align": "left", "font": "shippori"},
        {"type": "shape", "shape": "rightTriangle", "x": 610, "y": 60, "w": 46, "h": 40, "fill": "#fffaf0", "stroke": "#fffaf0", "strokeWidth": 0, "flipY": True},
    ]
    if field:
        items.append({"type": "field", "field": field, "x": 300, "y": 236, "w": 636, "h": 244, "fontSize": 18, "stroke": "#3a2a1c"})
    if meros_text:
        items.append({"type": "shape", "shape": "rounded", "x": 300, "y": 236, "w": 636, "h": 290, "fill": "#fffaf0", "stroke": "#3a2a1c", "strokeWidth": 3,
                      "text": meros_text, "fontSize": 24, "align": "left", "valign": "top", "pad": [0.05, 0.08, 0.05, 0.06]})
    if link_back:
        items.append({"type": "shape", "shape": "rounded", "x": 776, "y": 490, "w": 160, "h": 40, "fill": "#b5482b", "stroke": "#b5482b", "text": "ヒント一覧へ", "fontSize": 16, "color": "#ffffff", "pad": [0.05, 0.1, 0.05, 0.1], "link": link_back})
    return items

def rubric(*rows):
    return {"lead": "この時間の学習を、この観点でふり返ります。Aをめざそう！", "criteria": [
        {"id": f"self{i+1}", "name": n, "levels": list(l)} for i, (n, *l) in enumerate(rows)]}

def reflection(i):
    return {"kind": "fields", "tag": "振り返り", "heading": "単元マップに振り返りを書こう",
            "fields": [{"id": f"furikaeri{i}", "label": f"第{i}時の振り返り（わかったこと・考えが変わったこと・次に考えたいこと）", "placeholder": "今日の学習で…。友達の考えを聞いて…。次は…", "height": 120}],
            "notes": "原本の単元マップ「振り返り」欄にあたる。毎時間の最後に書き、第7時に読み返して単元全体をふり返る。"}

def self_check(): return {"kind": "rubric", "tag": "自己評価", "heading": "ルーブリックで自己評価しよう", "lead": "今日の学習をもとに、それぞれの観点でA・B・Cを選ぼう。", "selfCheck": "public", "notes": "自己評価の集計を公開設定にしている。"}
def mokuhyo(): return {"kind": "rubric", "tag": "ルーブリック", "heading": "この時間のめあて（ルーブリック）"}

def arasuji(first, rows):
    """Plot table rows (時・場所・人物・できごと) with a 重要ワード answer field beside each scene."""
    tbl = [["場面", "時", "場所", "人物", "できごと"]] + rows
    items = [{"type": "table", "table": {"rows": tbl, "widths": [0.45, 0.95, 0.75, 1.05, 3.3], "heights": [0.55] + [1.4] * len(rows), "fontSize": 13, "align": "left"}, "x": 30, "y": 100, "w": 700, "h": 414},
             {"type": "band", "text": "重要ワード", "x": 742, "y": 100, "w": 190, "h": 38, "fill": "primarySoft"}]
    rh = (414 - 38 * 1.0) / len(rows)
    for k, r in enumerate(rows):
        n = first + k
        items.append({"type": "field", "field": {"id": f"word{n}", "label": f"場面{n}", "placeholder": "人質" if n == 3 else "", "hideLabel": False}, "x": 742, "y": 142 + k * rh, "w": 190, "h": rh - 6, "fontSize": 13})
    return items

ARASUJI = [
    ["1", "今朝未明", "シラクス", "メロス", "今朝未明に村を出発し、シラクスの街に妹の結婚式の準備のためにきたが、町で王様が人を殺すと聞いて激怒した。"],
    ["2", "日も沈んであたりは暗い", "王城", "メロス・王", "日が落ちたころ、メロスは王城に入っていき捕縛されたが、妹の結婚式のため3日間の日限を与えられる。"],
    ["3", "深夜", "王城", "メロス・セリヌンティウス", "深夜、セリヌンティウスが王城に召され、人質を引き受けメロスは城を出発した。"],
    ["4", "明くる日の午前", "村", "メロス・妹", "明くる日の午前、村についたメロスは妹に明日結婚式をあげると伝え、深い眠りに落ちた。"],
    ["5", "夜〜次の日", "村", "メロス", "夜目覚めたメロスは夜明けまで花婿と議論し、次の日に結婚式をあげ、一生このままここで暮らしたいと思ったが、ついに出発を決意した。"],
    ["6", "明くる日の薄明", "道中", "メロス", "明くる日の薄明に村を出発したメロスに、濁流、山賊、疲労が襲いかかり諦めの気持ちが出たメロスは四肢を投げ出しまどろんだ。"],
    ["7", "午前2時ごろ〜日没", "道中", "メロス・フィロストラトス", "午後2時ごろ清水を飲んだメロスは再び走り出し、途中でフィロストラトスにとめられたがそれでもわけのわからぬ大きな力に引きずられ走った。"],
    ["8", "日没", "刑場", "メロス・王・セリヌンティウス", "日没後メロスは刑場に辿り着き、セリヌンティウスに正直に気持ちを打ち明けた。それを見た王様は二人の仲間にしてほしいと言った。"],
]

def analysis(prefix, who, notes):
    """3 viewpoints × (叙述から読み取れること / 言い換えると・別の視点で見ると)."""
    cols = ["価値観・信念", "性格・気質", "他者への態度"]
    items = [{"type": "band", "text": "", "x": 30, "y": 100, "w": 150, "h": 36, "fill": "primarySoft"}]
    cw = (930 - 190) / 3
    for j, c in enumerate(cols):
        items.append({"type": "band", "text": c, "x": 190 + j * (cw + 5), "y": 100, "w": cw, "h": 36, "fill": "primarySoft"})
    rows = [("yomi", "叙述から\n読み取れること", 176), ("iikae", "言い換えると・\n別の視点で見ると", 176)]
    y = 142
    for key, label, h in rows:
        items.append({"type": "band", "text": label, "x": 30, "y": y, "w": 150, "h": h, "fill": "accentSoft", "fontSize": 15})
        for j, c in enumerate(cols):
            items.append({"type": "field", "field": {"id": f"{prefix}_{key}{j+1}", "label": f"{who}：{c}（{label.replace(chr(10), '')}）", "hideLabel": True,
                          "placeholder": "本文の言葉を「」で引用して書こう" if key == "yomi" else "つまり…／見方を変えると…"}, "x": 190 + j * (cw + 5), "y": y, "w": cw, "h": h, "fontSize": 15})
        y += h + 8
    items.append({"type": "text", "text": "入力欄は左上が「価値観・信念」。本文の叙述を根拠にしよう。", "x": 30, "y": 512, "w": 900, "h": 22, "fontSize": 13, "color": "sub"})
    return items

spec = {
 "title": "走れメロス（太宰治）〜作品からのメッセージを受け取ろう〜",
 "course": "国語　2年　走れメロス　太宰治",
 "layout": "lesson-rows", "theme": "greek", "mascot": "book", "sectionSlides": False, "variety": True,
 "lessons": [
  # ---------------- 第1時 ----------------
  {"title": "走れメロス", "short": "第1時 物語と出会う", "worksheet": {"title": "走れメロス 第1時 ワークシート"},
   "rubric": rubric(("初読の感想（主体的に取り組む態度）", "心に残った場面や人物を挙げ、そう感じた理由や疑問まで書いている", "心に残った場面や人物について感想を書いている", "感想を書くことが難しい（ヒントを使ってみよう）"),
                    ("学習の見通し", "単元マップを見て、これからの学習で考えたいことを具体的に書いている", "単元の目標と学習の流れを確かめている", "学習の流れをつかむことが難しい")),
   "phases": [
    {"name": "物語と出会う", "minutes": 50, "slides": [
      {"kind": "form", "header": False, "title": "表紙", "backdrop": A + "title-bg.jpg", "items": [
        {"type": "shape", "shape": "rounded", "x": 288, "y": 120, "w": 384, "h": 250, "fill": "#fffaf0", "stroke": "#5a3e26", "strokeWidth": 3, "opacity": 0.92},
        {"type": "text", "text": "走れメロス", "x": 288, "y": 140, "w": 384, "h": 110, "fontSize": 72, "bold": True, "align": "center", "color": "#b5482b", "font": "brush"},
        {"type": "text", "text": "太宰　治", "x": 288, "y": 250, "w": 384, "h": 50, "fontSize": 32, "bold": True, "align": "center", "font": "shippori"},
        {"type": "text", "text": "〜作品からのメッセージを受け取ろう〜", "x": 288, "y": 306, "w": 384, "h": 44, "fontSize": 19, "bold": True, "align": "center"},
        {"type": "shape", "shape": "rounded", "x": 150, "y": 448, "w": 660, "h": 50, "fill": "#fffaf0", "stroke": "#5a3e26", "strokeWidth": 2, "opacity": 0.92,
         "text": "2年　　組　　番　氏名", "fontSize": 22, "align": "left", "pad": [0.03, 0.1, 0.03, 0.1]}],
       "notes": "単元の扉。原本の表紙の背景画像を使用。氏名は各自の端末ではアカウント名で回答が記録されるため、記入は不要（掲示・印刷用）。"},
      {"kind": "cards", "tag": "単元の目標", "heading": "この単元で身につけたい力", "variant": "grid", "columns": 3, "bodySize": 17,
       "cards": [{"title": "知識及び技能", "body": "情報と情報との関係の様々な表し方を理解し使うことができる。"},
                 {"title": "思考力、判断力、表現力等", "body": "①登場人物の言動の意味などについて考え、内容を解釈することができる。\n②文章を読んで理解したことや考えたことを知識や経験と結び付け、自分の考えを広げたり深めたりすることができる。", "tone": "accent"},
                 {"title": "主体的に学習に取り組む態度", "body": "積極的に登場人物の言動の意味などについて考え、学習課題に沿って考えたことを伝え合おうとしている。"}],
       "notes": "原本の「目標」スライド。"},
      {"kind": "table", "tag": "単元マップ", "heading": "7時間の学習の流れ",
       "rows": [["時", "まとまり", "学習内容と学習活動", "評価"], ["1", "物語と出会う", "通読し初読の感想をもつ。", "初読の感想"], ["2", "話の流れと人物をつかむ", "場面を整理し物語の大きな流れをとらえる。", "知識・技能"], ["3", "話の流れと人物をつかむ", "登場人物と出来事を整理し物語の構造を把握する。", "知識・技能"], ["4〜6", "人物の姿を問い直す", "メロスが王様にかける言葉を書くために、登場人物の変容について考える（王様・メロス）。", "思考・判断・表現①\n主体的に取り組む態度"], ["7", "メッセージを受け取る", "作品から受け取ったメッセージを自分の言葉で表現する。", "思考・判断・表現②"]],
       "widths": [0.45, 1.3, 3.2, 1.4], "heights": [0.6, 1, 1, 1, 1.5, 1], "fontSize": 16, "align": "left",
       "notes": "原本の単元マップ。振り返りは毎時間の最後のページで入力し、ワークシートに残る。"},
      {"kind": "task", "tag": "単元の課題", "heading": "単元を通して考えること", "text": "作品からのメッセージを\n受け取ろう。", "clues": ["①話の流れ", "②人物の姿と変容", "③王様にかける言葉"]},
      mokuhyo(),
      {"kind": "question", "tag": "初読", "heading": "初めて読んで、心に残ったことは？", "prompt": "全文を読んで、初読の感想を書こう。",
       "hintsTitle": "書き方のヒント", "hints": ["心に残った場面・言葉", "気になった人物とその理由", "疑問に思ったこと", "作品から伝わってきたこと"], "split": 0.3,
       "field": {"id": "kanso", "label": "初読の感想", "placeholder": "私が一番心に残ったのは…。なぜなら…。疑問に思ったのは…", "height": 200},
       "notes": "原本スライド「初読の感想」。通読には参考BOXの音声データ・全文シートを使う（リンクは授業前に貼る）。"},
      {"kind": "quiz", "tag": "みんなは？", "heading": "一番心に残った人物は？", "prompt": "一番心に残った人物を選ぼう。理由も書いて、クラスの集計を見てみよう。",
       "id": "jinbutsu", "label": "一番心に残った人物", "choices": ["メロス", "王（ディオニス）", "セリヌンティウス", "フィロストラトス"]},
      {"kind": "cards", "tag": "参考BOX", "heading": "読むときに使う資料", "variant": "grid", "columns": 2, "bodySize": 20,
       "cards": [{"title": "音声データ", "body": "朗読を聞きながら全文を読む。\n（リンクは先生が貼ります）"}, {"title": "全文シート", "body": "根拠となる叙述に線を引き、場面番号を書きこむ。\n（リンクは先生が貼ります）", "tone": "accent"}],
       "notes": "原本の「参考BOX」。原本の音声データ・全文シート・学び合いリンクのURLは、学校の共有ドライブのリンクのため、このファイルには入れていない。授業前に文字ボックスを選び、リンク（URL）を設定する。"},
      self_check(), reflection(1)]}]},
  # ---------------- 第2時 ----------------
  {"title": "話の流れをつかむ", "short": "第2時 話の流れをつかむ", "worksheet": {"title": "走れメロス 第2時 ワークシート"},
   "rubric": rubric(("場面の整理（知識・技能）", "時・場所・人物の変化を手がかりに8つの場面を区切り、重要ワードで各場面の出来事を表している", "表を使って、場面ごとの出来事を整理している", "表に整理することが難しい"),
                    ("物語の大きな流れ", "場面どうしのつながりから物語の山場を見つけ、根拠を挙げて説明している", "物語の大きな流れ（発端・展開・山場・結末）をとらえている", "流れをとらえることが難しい")),
   "phases": [{"name": "話の流れをつかむ", "minutes": 50, "slides": [
      {"kind": "section", "number": 2, "name": "話の流れをつかむ", "minutes": 50, "lead": "場面を整理し、物語の大きな流れをとらえる。"},
      mokuhyo(),
      {"kind": "steps", "tag": "見方", "heading": "場面はどこで変わる？", "lead": "時・場所・人物が変わるところで、場面が変わる。",
       "items": [{"title": "時", "body": "「今朝未明」「深夜」など"}, {"title": "場所", "body": "シラクス・王城・村・道中・刑場"}, {"title": "人物", "body": "だれとだれが出てくるか"}, {"title": "出来事", "body": "何が起きたかを一文で"}]},
      {"kind": "form", "tag": "あらすじ①", "heading": "あらすじを捉える（場面1〜4）", "items": arasuji(1, ARASUJI[:4]),
       "notes": "原本スライド「あらすじを捉える」。重要ワードは場面を表す言葉を本文から一つ選ぶ（例：場面3「人質」）。"},
      {"kind": "form", "tag": "あらすじ②", "heading": "あらすじを捉える（場面5〜8）", "items": arasuji(5, ARASUJI[4:])},
      {"kind": "question", "tag": "考えよう", "heading": "物語の山場はどこ？", "prompt": "物語が最も大きく動くのはどの場面だろう？",
       "fields": [{"id": "yamaba", "type": "single", "label": "山場だと思う場面", "options": ["場面2（王城）", "場面5（村）", "場面6（道中・諦め）", "場面7（再び走る）", "場面8（刑場）"], "reason": True, "public": True}],
       "hints": ["メロスの気持ちが大きく変わるところ", "人物の関係が変わるところ"], "split": 0.32},
      self_check(), reflection(2)]}]},
  # ---------------- 第3時 ----------------
  {"title": "人物をつかむ", "short": "第3時 人物をつかむ", "worksheet": {"title": "走れメロス 第3時 ワークシート"},
   "rubric": rubric(("人物と出来事の整理（知識・技能）", "人物相関図と叙述をもとに、人物どうしの関係と物語の構造を説明している", "登場人物と出来事を表に整理している", "整理することが難しい"),
                    ("叙述にもとづく分析", "本文の言葉を引用し、別の視点からの言い換えまで書いている", "本文から人物の価値観・性格・態度を読み取っている", "叙述を見つけることが難しい")),
   "phases": [{"name": "人物をつかむ", "minutes": 50, "slides": [
      {"kind": "section", "number": 3, "name": "人物をつかむ", "minutes": 50, "lead": "登場人物と出来事を整理し、物語の構造を把握する。"},
      mokuhyo(),
      {"kind": "question", "tag": "人物相関図", "heading": "「走れメロス」の人物相関図", "prompt": "相関図を見て、物語の中心にある関係はどれだろう？", "promptHeight": 62,
       "image": A + "soukanzu.jpg", "alt": "走れメロスの人物相関図。ディオニス王、メロス、妹と婿、セリヌンティウス、シラクスの市民の関係", "split": 0.66,
       "field": {"id": "soukan", "label": "相関図から気づいたこと", "placeholder": "メロスと王は…。セリヌンティウスとは…"},
       "notes": "原本の人物相関図（画像）。"},
      {"kind": "form", "tag": "主人公", "heading": "登場人物の分析（メロス）", "items": analysis("meros", "メロス", ""),
       "notes": "原本スライド「登場人物の分析（主人公）」。記入例：価値観・信念＝信実や名誉が大事「人を疑うことは最も恥ずべき悪徳だ」→信実や名誉は命より大事／性格・気質＝のんき、素朴、正義感強い→危機感に欠ける、0か100かみたいな性格／他者への態度＝王に対して激しい怒りを燃やし真っ向から反抗、セリヌンティウスに自分の命を預けるほど深く信頼→独善的、無鉄砲。"},
      {"kind": "form", "tag": "対役", "heading": "登場人物の分析（王）", "items": analysis("ou", "王", ""),
       "notes": "原本スライド「登場人物の分析（対役）」。記入例：価値観・信念＝信実などというものは存在しない「口では、どんな清らかな事でも言える」→裏切るのが人間→かつては信実があると思っていたが裏切られたかもしれない／性格・気質＝「おまえには、わしの孤独がわからぬ」→孤独、心を閉ざしている、顔面蒼白・眉間の深い皺→精神的に疲労→誰にも理解されない苦しみ／他者への態度＝メロスに冷酷・冷静、民に残虐→相手が裏切る前に殺してしまうことでしか安心を得られなかった。"},
      {"kind": "compare", "tag": "くらべる", "heading": "メロスと王、何が正反対？", "prompt": "二人の「信実」についての考え方を比べよう。",
       "left": {"title": "メロス", "items": ["人を疑うことは最も恥ずべき悪徳", "友を信じて命を預ける", "単純・正義感が強い"]},
       "right": {"title": "王（ディオニス）", "items": ["人間は私欲のかたまり", "疑って次々に殺す", "孤独で心を閉ざしている"]},
       "field": {"id": "hantai", "label": "二人の正反対なところをまとめよう"}},
      self_check(), reflection(3)]}]},
  # ---------------- 第4時 ----------------
  {"title": "人物の姿を問い直す①　王様", "short": "第4時 王様の変容", "worksheet": {"title": "走れメロス 第4時 ワークシート"},
   "rubric": rubric(("言動の意味の解釈（思考・判断・表現①）", "最初と最後の言動を対比し、変わった理由と変容の中身を叙述を根拠に説明している", "王様がどのように変わったかを叙述をもとに書いている", "変化を見つけることが難しい"),
                    ("伝え合い（主体的に取り組む態度）", "根拠となる叙述を示しながら話し合い、友達の考えを交流メモに生かしている", "自分の考えを伝え、友達の考えを聞いている", "考えを伝えることが難しい")),
   "phases": [{"name": "王様の変容", "minutes": 50, "slides": [
      {"kind": "section", "number": 4, "name": "人物の姿を問い直す①", "minutes": 50, "lead": "メロスが王様にかける言葉を書くために、王様の変容について考える。"},
      {"kind": "form", "header": False, "title": "ゴールの場面", "backdrop": A + "scene-bg.jpg",
       "items": scene(meros_text="第6時、メロスになって王様に言葉をかけよう。\nそのために、王様とメロスがどう変わったのかを読み深める。"),
       "notes": "単元のゴール（第4〜6時）を示す。原本の夕焼けの場面の画像を使用。"},
      mokuhyo(),
      {"kind": "points", "tag": "読みの視点", "heading": "変容を読む三つの視点",
       "items": [["変化の質・中身", "何が最も大きく変わったか"], ["最初と最後の対比", "初めと終わりの言動・表情を比べる"], ["どうして変わったか", "変わるきっかけになった出来事"]],
       "note": {"title": "表情にも注目", "body": "1場面の「顔面蒼白」と、8場面の「顔を赤らめて」。表情の描写からも心の変化が読み取れる。"}},
      {"kind": "form", "tag": "王様", "heading": "登場人物の変容（王様）", "items": [
        {"type": "band", "text": "", "x": 30, "y": 100, "w": 130, "h": 46, "fill": "primarySoft"},
        {"type": "band", "text": "どうして変わったか", "x": 170, "y": 100, "w": 245, "h": 46, "fill": "primarySoft"},
        {"type": "band", "text": "どのように変わったか\n（最初と最後の対比）", "x": 422, "y": 100, "w": 245, "h": 46, "fill": "primarySoft", "fontSize": 14},
        {"type": "band", "text": "最も大きく変わったこと\n（変容の質・中身）", "x": 674, "y": 100, "w": 256, "h": 46, "fill": "accentSoft", "fontSize": 14},
        {"type": "band", "text": "叙述から\n読み取れること", "x": 30, "y": 152, "w": 130, "h": 222, "fill": "accentSoft", "fontSize": 15},
        {"type": "field", "field": {"id": "ou_why", "label": "王様：どうして変わったか", "hideLabel": True, "placeholder": "メロスが約束を守って帰ってきた。二人が…"}, "x": 170, "y": 152, "w": 245, "h": 222, "fontSize": 15},
        {"type": "field", "field": {"id": "ou_how", "label": "王様：どのように変わったか", "hideLabel": True, "placeholder": "最初は「人間は私欲のかたまりだ」…最後は…"}, "x": 422, "y": 152, "w": 245, "h": 222, "fontSize": 15},
        {"type": "field", "field": {"id": "ou_most", "label": "王様：最も大きく変わったこと", "hideLabel": True, "placeholder": "○○な王 → ○○な王"}, "x": 674, "y": 152, "w": 256, "h": 222, "fontSize": 15},
        {"type": "band", "text": "交流メモ", "x": 30, "y": 380, "w": 130, "h": 136, "fill": "accentSoft", "fontSize": 15},
        {"type": "field", "field": {"id": "ou_memo", "label": "王様：交流メモ（友達の考え）", "hideLabel": True, "placeholder": "○○さんの考え：…　なるほどと思ったこと：…"}, "x": 170, "y": 380, "w": 760, "h": 136, "fontSize": 15}],
       "notes": "原本スライド「登場人物の変容（王様）」。記入例：最も大きく変わったこと＝人は信じられない孤独な暴君→信実を認め、仲間を求める人（信実に対する考え方が大きく変わっている）／どのように変わったか＝「人間は私欲のかたまりだ」と決めつけ家族や家来を次々に殺害するほど疑心暗鬼に陥っていた。その心は孤独に固まり顔面は蒼白だった→「信実とは空虚な妄想ではなかった」「わしをも仲間に入れてくれ」と対等な関係を願った。顔を赤らめていて人間らしい感情を取り戻している／どうして変わったか＝メロスが約束を守って帰ってきた。二人が単に約束を守っただけでなく、お互いに相手を疑ったという「悪い夢」を正直に告白し、殴り合って許し合うほどの深い絆を目の当たりにしたから。それまで否定し続けてきた「信実」が「空虚な妄想ではなかった」と確信したから。交流メモ例：王様も本当は人を信じたいという気持ちがあったからこそ変われた。"},
      {"kind": "statement", "tag": "学び方", "heading": "友達の振り返りから", "big": "根拠を示して話し合う", "bigSize": 48,
       "caption": "全文シートの「ここのこういうところから」と\n叙述を示して話し合うと、考えが深まる。",
       "note": "例：1場面の「顔面蒼白」と6場面の「顔を赤らめて」を比べると、表情からも変化した中身や心情が読み取れる。",
       "notes": "原本p.14の生徒の振り返り（2例）を要約したもの。氏名は載せていない。"},
      self_check(), reflection(4)]}]},
  # ---------------- 第5時 ----------------
  {"title": "人物の姿を問い直す②　メロス", "short": "第5時 メロスの変容", "worksheet": {"title": "走れメロス 第5時 ワークシート"},
   "rubric": rubric(("言動の意味の解釈（思考・判断・表現①）", "最初・中盤・最後の言動を比べ、変わったところと変わっていないところを根拠を挙げて説明している", "メロスが変わったか、変わっていないかを叙述をもとに書いている", "根拠を見つけることが難しい"),
                    ("伝え合い（主体的に取り組む態度）", "自分と違う立場の考えを聞き、交流メモに書いて考えを見直している", "自分の立場と理由を伝えている", "考えを伝えることが難しい")),
   "phases": [{"name": "メロスの変容", "minutes": 50, "slides": [
      {"kind": "section", "number": 5, "name": "人物の姿を問い直す②", "minutes": 50, "lead": "メロスは変わったのか、変わっていないのか。"},
      mokuhyo(),
      {"kind": "form", "tag": "前半", "heading": "前半のメロス", "items": [
        {"type": "shape", "shape": "bubble", "x": 34, "y": 104, "w": 300, "h": 130, "fill": "#fffaf0", "stroke": "#3a2a1c", "strokeWidth": 3, "text": "罪のない人を殺して、何が平和だ。", "fontSize": 22},
        {"type": "shape", "shape": "rounded", "x": 616, "y": 104, "w": 310, "h": 100, "fill": "#fffaf0", "stroke": "#3a2a1c", "strokeWidth": 3, "text": "必ず、かの邪知暴虐の王を除かなければならぬと決意した。", "fontSize": 18, "pad": [0.05, 0.1, 0.05, 0.1]},
        {"type": "shape", "shape": "star", "x": 250, "y": 168, "w": 470, "h": 330, "fill": "#fffaf0", "stroke": "#3a2a1c", "strokeWidth": 4},
        {"type": "text", "text": "人の心を疑うのは、\n最も恥ずべき悪徳だ。", "x": 380, "y": 300, "w": 210, "h": 80, "fontSize": 19, "bold": True, "align": "center", "color": "accent"},
        {"type": "shape", "shape": "thoughtBubble", "x": 40, "y": 370, "w": 280, "h": 140, "fill": "#fffaf0", "stroke": "#3a2a1c", "strokeWidth": 3, "text": "あきれた王だ。\n生かしておけぬ。", "fontSize": 21},
        {"type": "shape", "shape": "rounded", "x": 700, "y": 226, "w": 226, "h": 70, "fill": "#fffaf0", "stroke": "#3a2a1c", "strokeWidth": 3, "text": "今度はメロスが嘲笑した。", "fontSize": 18, "pad": [0.05, 0.12, 0.05, 0.12]},
        {"type": "mascot", "pose": "think", "x": 800, "y": 410, "s": 100}],
       "notes": "原本スライド「前半のメロス」の言葉。中心の言葉が、メロスの信念（価値観）を表している。"},
      {"kind": "question", "tag": "立場を決める", "heading": "メロスは変わった？変わっていない？", "prompt": "最初と最後のメロスを比べて、自分の立場を決めよう。",
       "image": A + "running.jpg", "alt": "道を走るメロスの絵", "split": 0.36,
       "fields": [{"id": "kawatta", "type": "single", "label": "メロスは…", "options": ["変わった", "変わっていない"], "reason": True, "public": True}],
       "notes": "原本スライド「登場人物の変容（メロス）」の「変わった／変わっていない」を丸で囲む部分。集計を見せて、立場の違う友達と交流させる。"},
      {"kind": "form", "tag": "メロス", "heading": "登場人物の変容（メロス）", "items": [
        {"type": "card", "title": "読みの視点", "text": "・変化の質・中身\n・最初と最後の対比\n・どうして変わったか？\n　変わっていないか？", "tone": "primary", "x": 30, "y": 100, "w": 200, "h": 416, "fontSize": 16},
        {"type": "band", "text": "叙述から読み取れること（始め → 中盤 → 終盤）", "x": 242, "y": 100, "w": 688, "h": 34, "fill": "primarySoft"},
        {"type": "field", "field": {"id": "meros_yomi", "label": "メロス：叙述から読み取れること", "hideLabel": True, "placeholder": "始め「…」→ ○○。中盤辺り「…」→ ○○。終盤「…」→ ○○。", "height": 160}, "x": 242, "y": 138, "w": 688, "h": 230, "fontSize": 15},
        {"type": "band", "text": "交流メモ", "x": 242, "y": 376, "w": 688, "h": 30, "fill": "accentSoft"},
        {"type": "field", "field": {"id": "meros_memo", "label": "メロス：交流メモ", "hideLabel": True, "placeholder": "○○さん（変わった／変わっていない）の考え：…"}, "x": 242, "y": 410, "w": 688, "h": 106, "fontSize": 15}],
       "notes": "原本スライド「登場人物の変容（メロス）」。"},
      {"kind": "figure", "tag": "根拠", "heading": "根拠は本文の言葉", "image": A + "konkyo.jpg", "alt": "変わっていないの立場の記入例。本文の言葉を枠で囲んで根拠にしている",
       "lead": "□の部分が本文に書いてあること＝根拠。引用して、そこから読み取れることを書く。",
       "notes": "原本p.15の記入例（変わっていない立場）：始め「王に人は口先だけではないと知らしめてやる！」→絶対に約束を守る。嘘をつかないと。／中盤辺り「もう、どうでもいい。許してくれ…全部無駄だったんだ。」→諦めている。／終盤「…間に合う間に合わないの問題ではない！」→たとえもう無理だとしても約束を果たさないといけない。セリヌンティウスのためにも。「私を殴れ…。」→誠実であるために。嘘偽りないと証明するために。"},
      {"kind": "form", "tag": "最初と最後", "heading": "メロスの「最初」と「最後」", "items": [
        {"type": "text", "text": "最初", "x": 700, "y": 96, "w": 220, "h": 40, "fontSize": 28, "bold": True, "align": "center", "heading": True},
        {"type": "text", "text": "「人を疑うことは最も恥ずべき悪徳だ」\n人は信じるもの", "x": 640, "y": 134, "w": 290, "h": 64, "fontSize": 16, "align": "center", "color": "accent"},
        {"type": "shape", "shape": "rounded", "x": 726, "y": 204, "w": 170, "h": 250, "fill": "#f8e4da", "stroke": "#f8e4da", "strokeWidth": 0},
        {"type": "image", "image": A + "meros-stand.png", "alt": "胸を張って立つメロス（最初）", "x": 740, "y": 210, "w": 142, "h": 240},
        {"type": "text", "text": "最後", "x": 40, "y": 96, "w": 220, "h": 40, "fontSize": 28, "bold": True, "align": "center", "heading": True},
        {"type": "field", "field": {"id": "saigo", "label": "最後のメロスは、人をどう考えている？", "placeholder": "人は○○もの"}, "x": 40, "y": 134, "w": 220, "h": 70, "fontSize": 14},
        {"type": "shape", "shape": "rounded", "x": 64, "y": 214, "w": 170, "h": 240, "fill": "#f8e4da", "stroke": "#f8e4da", "strokeWidth": 0},
        {"type": "image", "image": A + "meros-stand.png", "alt": "立ち上がったメロス（最後）", "x": 78, "y": 218, "w": 142, "h": 232},
        {"type": "shape", "shape": "leftArrow", "x": 270, "y": 280, "w": 440, "h": 50, "fill": "accent", "stroke": "accent", "strokeWidth": 0},
        {"type": "text", "text": "同じ「人は信じるもの」でも、中身は同じ？", "x": 290, "y": 236, "w": 400, "h": 40, "fontSize": 17, "bold": True, "align": "center"},
        {"type": "shape", "shape": "rounded", "x": 360, "y": 380, "w": 260, "h": 130, "fill": "#dfe7f2", "stroke": "#dfe7f2", "strokeWidth": 0},
        {"type": "image", "image": A + "meros-fallen.png", "alt": "疲れ果てて倒れたメロス（途中）", "x": 370, "y": 392, "w": 240, "h": 112},
        {"type": "shape", "shape": "downArrow", "x": 650, "y": 380, "w": 46, "h": 110, "fill": "primary", "stroke": "primary", "strokeWidth": 0},
        {"type": "shape", "shape": "upArrow", "x": 284, "y": 380, "w": 46, "h": 110, "fill": "primary", "stroke": "primary", "strokeWidth": 0}],
       "notes": "原本p.17の図。最初は「人は信じるもの」と自信をもっていたメロスが、途中で倒れ諦めかけ、それでも走り抜いて「最後」に至る。最初と最後の「人は信じるもの」の中身の違い（自信→弱さを知ったうえでの信実）に気づかせる。"},
      self_check(), reflection(5)]}]},
  # ---------------- 第6時 ----------------
  {"title": "人物の姿を問い直す③　王様にかける言葉", "short": "第6時 王様にかける言葉", "worksheet": {"title": "走れメロス 第6時 ワークシート"},
   "rubric": rubric(("言動の意味の解釈（思考・判断・表現①）", "王様とメロスの変容を踏まえ、二人の共通点や信実への考えを結び付けて言葉にしている", "王様とメロスの変容を踏まえて、王様にかける言葉を書いている", "言葉を書くことが難しい（ヒントを使ってみよう）"),
                    ("表現（2〜5文）", "叙述を生かした表現で、2〜5文で筋道立てて書いている", "2〜5文で書いている", "文の数や順序を整えることが難しい")),
   "phases": [{"name": "王様にかける言葉", "minutes": 50, "slides": [
      {"kind": "section", "number": 6, "name": "人物の姿を問い直す③", "minutes": 50, "lead": "メロスになって、王様にかける言葉を書こう。"},
      mokuhyo(),
      {"kind": "form", "header": False, "id": "meros-write", "title": "王様にかける言葉", "backdrop": A + "scene-bg.jpg",
       "items": scene(field={"id": "kotoba", "label": "メロスとして、王様にかける言葉（2〜5文で書く）", "placeholder": "王様、…", "height": 220}, link_back="meros-hints"),
       "notes": "原本スライドの「ここに入力（2〜5文で書く。）」。困ったら右下の「ヒント一覧へ」からヒントを選ばせる。"},
      {"kind": "form", "header": False, "id": "meros-hints", "title": "ヒント一覧", "backdrop": A + "scene-bg.jpg", "items": [
        {"type": "shape", "shape": "rect", "x": 140, "y": 24, "w": 680, "h": 110, "fill": "#9a5650", "stroke": "#9a5650", "strokeWidth": 0, "opacity": 0.95,
         "text": "ヒントはいくつかあります。\nまずは上から見て、これは使えそうと思ったものを選ぼう。", "fontSize": 22, "color": "#ffffff", "pad": [0.04, 0.1, 0.04, 0.1]},
        {"type": "shape", "shape": "rounded", "x": 300, "y": 160, "w": 360, "h": 62, "fill": "#fffaf0", "stroke": "#5a3e26", "text": "視点ヒント", "fontSize": 26, "pad": [0.05, 0.1, 0.05, 0.1], "link": "hint-shiten"},
        {"type": "shape", "shape": "rounded", "x": 300, "y": 238, "w": 360, "h": 62, "fill": "#fffaf0", "stroke": "#5a3e26", "text": "書き出しヒント", "fontSize": 26, "pad": [0.05, 0.1, 0.05, 0.1], "link": "hint-kakidashi"},
        {"type": "shape", "shape": "rounded", "x": 300, "y": 316, "w": 360, "h": 62, "fill": "#fffaf0", "stroke": "#5a3e26", "text": "視点ヒント（具体）", "fontSize": 26, "pad": [0.05, 0.1, 0.05, 0.1], "link": "hint-gutai"},
        {"type": "text", "text": "どうしても思いつかない人は", "x": 300, "y": 396, "w": 360, "h": 28, "fontSize": 16, "align": "center", "color": "#ffffff"},
        {"type": "shape", "shape": "rounded", "x": 300, "y": 426, "w": 360, "h": 62, "fill": "#b5482b", "stroke": "#b5482b", "text": "まずはここから", "fontSize": 26, "color": "#ffffff", "pad": [0.05, 0.1, 0.05, 0.1], "link": "hint-koko"}],
       "notes": "原本のヒント一覧。各ボタンを押すと、そのヒントのページへ移動する（発表中・編集中ともにリンクとして使える）。"},
      {"kind": "form", "header": False, "id": "hint-shiten", "title": "視点ヒント", "backdrop": A + "scene-bg.jpg",
       "items": scene(meros_text="基本フレーム\n① 今の自分（メロス）について\n② 王様について\n③ 信実について\n　 これからについて", link_back="meros-hints")},
      {"kind": "form", "header": False, "id": "hint-kakidashi", "title": "書き出しヒント", "backdrop": A + "scene-bg.jpg",
       "items": scene(meros_text="王様、\n＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿。\n私も（は）\n＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿。\nだから、\n＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿。", link_back="meros-hints")},
      {"kind": "form", "header": False, "id": "hint-gutai", "title": "視点ヒント（具体）", "backdrop": A + "scene-bg.jpg",
       "items": scene(meros_text="王様、\n（今の王様を見てどう思うか）。\n私も（は）\n（走る中で気づいたこと）。\nだから、\n（信じること・信実について思うこと）。", link_back="meros-hints")},
      {"kind": "form", "header": False, "id": "hint-koko", "title": "まずはここから", "backdrop": A + "scene-bg.jpg",
       "items": scene(link_back="meros-hints") + [
        {"type": "shape", "shape": "rounded", "x": 300, "y": 236, "w": 636, "h": 290, "fill": "#fffaf0", "stroke": "#3a2a1c", "strokeWidth": 3},
        {"type": "text", "text": "王様、実は私も、道の途中で一度（　①　）を見た、あなたと同じ弱い男なのです。\n信じることが怖かったあなたの（　②　）は、今の私なら少しわかる気がします。", "x": 332, "y": 250, "w": 584, "h": 126, "fontSize": 18, "valign": "top"},
        {"type": "field", "field": {"id": "koko1", "label": "①　何を見た？", "placeholder": "例：悪い夢"}, "x": 318, "y": 384, "w": 290, "h": 92, "fontSize": 14},
        {"type": "field", "field": {"id": "koko2", "label": "②　あなたの何？", "placeholder": "例：孤独"}, "x": 620, "y": 384, "w": 296, "h": 92, "fontSize": 14}],
       "notes": "原本の「まずはここから」の穴埋め。埋めたら、その先を自分の言葉で続けて、王様にかける言葉のページに書く。"},
      self_check(), reflection(6)]}]},
  # ---------------- 第7時 ----------------
  {"title": "メッセージを受け取る", "short": "第7時 メッセージを受け取る", "worksheet": {"title": "走れメロス 第7時 ワークシート"},
   "rubric": rubric(("考えの広がり・深まり（思考・判断・表現②）", "読んで考えたことを自分の知識や経験と結び付け、作品のメッセージを自分の言葉で表現している", "作品から受け取ったメッセージを自分の言葉で書いている", "メッセージを言葉にすることが難しい"),
                    ("単元のふり返り", "第1時の感想と比べて、考えがどう変わったかを具体的に書いている", "単元の学習をふり返って書いている", "ふり返ることが難しい")),
   "phases": [{"name": "メッセージを受け取る", "minutes": 50, "slides": [
      {"kind": "section", "number": 7, "name": "メッセージを受け取る", "minutes": 50, "lead": "作品から受け取ったメッセージを、自分の言葉で表現する。"},
      mokuhyo(),
      {"kind": "question", "tag": "まとめ", "heading": "作者から受け取ったメッセージ", "prompt": "「走れメロス」から、あなたはどんなメッセージを受け取った？",
       "hintsTitle": "考えるヒント", "hints": ["王様にかけた言葉", "王様とメロスの変容", "自分の経験（信じる・信じられる）", "第1時の感想と比べて"], "split": 0.3,
       "field": {"id": "message", "label": "作者から受け取ったメッセージ", "placeholder": "私はこの作品から、…というメッセージを受け取った。それは…", "height": 200},
       "notes": "原本スライド「作者から受け取ったメッセージ」。"},
      {"kind": "fields", "tag": "単元のふり返り", "heading": "第1時の自分とくらべよう", "prompt": "第1時の初読の感想と比べて、考えはどう変わった？",
       "fields": [{"id": "henka", "label": "考えの変化", "placeholder": "最初は…と思っていたが、今は…"}, {"id": "ikasu", "label": "これからの自分に生かしたいこと", "placeholder": "信じること・約束を守ることについて…"}]},
      self_check(), reflection(7),
      {"kind": "form", "header": False, "title": "完", "items": [
        {"type": "text", "text": "完", "x": 330, "y": 150, "w": 300, "h": 240, "fontSize": 120, "bold": True, "align": "center", "color": "accent", "font": "brush"}],
       "backdrop": None}]}]}]}

# "完" uses the theme's divider backdrop
spec["lessons"][-1]["phases"][0]["slides"][-1].pop("backdrop")
spec["lessons"][-1]["phases"][0]["slides"][-1]["backdropKind"] = "section"; spec["lessons"][-1]["phases"][0]["slides"][-1]["items"][0]["color"] = "#f0cd78"
json.dump(spec, open("meros.spec.json", "w"), ensure_ascii=False, indent=1)
print("ok", sum(len(p["slides"]) for L in spec["lessons"] for p in L["phases"]))
