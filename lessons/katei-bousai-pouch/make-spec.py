#!/usr/bin/env python3
"""防災ポーチ＆サコッシュ：each student follows the steps at their own pace.
Row 0 = start, row 1 = 手順マップ (links + 完了 checks) and 製作計画表, then one row per step; every page has 「手順マップへ」."""
import json
from PIL import Image

SRC = "src"


FIGDIR = "src/redesign"  # redrawn figures (figures.py → render-figures.mjs)


def light(name):
    """64-colour PNG of a redrawn figure: a third of the size, same look (the deck must fit VHSlide's ~5MB auto-save)."""
    src, dst = f"{FIGDIR}/{name}.png", f"{FIGDIR}/{name}.min.png"
    with Image.open(src) as im:
        im.convert("RGB").quantize(64, method=Image.Quantize.MEDIANCUT).save(dst, optimize=True)
    return dst


def ratio(name):
    with Image.open(f"{FIGDIR}/{name}.png") as im:
        return im.width / im.height


CAUTION = {
    "st0": "表からアイロンをかけるときは、当て布をする", "st1": "（A）より下にある印が（B）。印は布の裏側に付ける",
    "st2": "②は、ほつれ止め加工されている側から切る", "st3": "縫い始めと縫い終わりは返し縫い。上下の両方を縫う",
    "st4": "（A）に合わせないように注意。平ひもがずれないように", "st5": "ポケット用布地は、斜めの織り目が見える方が表",
    "st6": "本体とポケットの中心を合わせる。ポケット口は縫わない", "st7": "輪が内側（布の中心側）になるように置く",
    "st8": "★の所と、縫い始め・縫い終わりは返し縫い", "st9": "返す前に、縫い目にそってアイロンで折っておく",
    "st10": "しっかり結べば、結び方は自由", "st10b": "例1・例2以外の結び方で、好みのサコッシュにしてもよい",
    "st11": "サコッシュにするときは、ひもを結んで長さを調節", "st12": "家族と話し合いながら書き込もう",
    "machine": "縫い始めと縫い終わりは、必ず返し縫い",
}


def step_page(sid, tag, heading, img, points, notes, alt):
    """The redrawn figure fills the slide; one key caution below; the full points go to the speaker notes."""
    r = ratio(img)
    ih = min(888 / r, 340)
    iw = ih * r
    caution = CAUTION.get(sid, points[0])
    items = [{"type": "image", "image": light(img), "alt": alt.replace("説明書の図：", "図："), "x": 36 + (888 - iw) / 2, "y": 98, "w": iw, "h": ih},
             {"type": "card", "text": "注意！　" + caution, "tone": "accent", "x": 36, "y": 98 + ih + 10, "w": 888, "h": 516 - (98 + ih + 10),
              "fontSize": 21, "valign": "middle", "align": "center"}]
    full = "【手順】\n" + "\n".join(f"・{p}" for p in points) + (f"\n{notes}" if notes else "")
    return {"kind": "form", "id": sid, "tag": tag, "heading": heading, "items": items, "notes": full}


STEPS = [  # (id, map label, heading, figure, points, notes)
    ("st0", "地直し", "製作の前に：地直しをする", "jinaoshi",
     ["布地の裏側からアイロンをかけ、しわをとり、布目をととのえる",
      "布をたて・よこ・ななめに引いて布目を正し、アイロンはたて・よこの布目にそってかける",
      "本体用布地は、折ってあった内側が裏側。裏側の端にチャコペンシルで印を付けておくと分かりやすい"],
     "表側からアイロンをかける場合は当て布をすると表面がきれいに仕上がる。"),
    ("st1", "1 印をつける", "1. 本体用布地に印をつける", "s1",
     ["布地をたて長に置き、裏側に印を付ける",
      "両側から1.5cm、上下から2cmの位置に印",
      "上側に、丸ひも通し用平ひも位置（A）と平ひも縫い付け位置（B）の印"],
     "※ロックミシンの縫い目は省略して図示されている。"),
    ("st2", "2 平ひもをカット", "2. 平ひもをカットする", "s2",
     ["① 平ひもを本体用布地の幅（約25cm）に合わせてカット",
      "② 残りの平ひもを、ほつれ止め加工されている側から8cmに2本カット（丸ひも通し用になる）"],
     "平ひもは約45cm。本体の幅＋8cm×2本＋余り。"),
    ("st3", "3 上部を縫う", "3. バッグの上部になる部分を縫う", "s3",
     ["1.で付けた印に合わせて折り、端から端までミシンで縫う（0.5〜0.6cm）",
      "縫い始めと縫い終わりは返し縫い",
      "もう一方も同じように縫う"], ""),
    ("st4", "4 平ひもを縫い付け", "4. 平ひもを縫い付ける", "s4",
     ["① 平ひも縫い付け位置（B）に合わせ、布地の表側に①の平ひもをのせて仮止め（丸ひも通し用平ひも位置（A）に合わせないよう注意）",
      "② 布端から1cmの位置をミシンで縫う",
      "③ 中心と、中心から左右約5.5cmの3か所を縫う",
      "丈夫にするため、縫い始めと縫い終わりは返し縫い（0.5〜0.7cm位）"],
     "（A）と（B）の取り違えが起きやすい。（A）より下にある印が（B）。平ひもがずれないように注意。"),
    ("st5", "5 ポケット準備", "5. ポケットを準備する", "s5",
     ["① 裏側に、ポケット口は4cm、他の3辺は1cmの位置に印",
      "② ポケット口をアイロンで三つ折りにし、縫う（0.2〜0.3cm）",
      "③ ポケット口以外の3辺をアイロンで折る",
      "ポケット用布地は斜めの織り目が見える方が表"],
     "ポケットの大きさは、ポケット用布地の範囲内で好みの寸法にしてもよい。応用でまちをつける場合は、ポケット用布地の長さを16cmにカットしてから製作する。"),
    ("st6", "6 ポケットを付ける", "6. ポケットを付ける", "s6",
     ["① 4.で縫い付けた平ひもから1.5cm下にポケットを置き、仮止め（本体とポケットの中心を合わせる）",
      "② ポケット口以外の3辺をミシンで縫う（0.2〜0.3cm）",
      "後ろ側の面に付けるときは、平ひもを縫い付けていない方の表側（約16.5cm）"], ""),
    ("st7", "7 丸ひも通し", "7. 丸ひも通し用平ひもを付ける", "s7",
     ["① 2.でカットした約8cmの平ひもを半分に折り、カットした側を布端に合わせて（Aの位置に、表側から）置き、仮止め",
      "② 布端から1cmの位置をミシンで縫う",
      "縫い始めと縫い終わりは返し縫い（0.5〜0.7cm位）"], ""),
    ("st8", "8 両脇を縫う", "8. 両脇を縫う", "s8",
     ["中表に折り、両脇をミシンで縫う",
      "縫い始めと縫い終わり、平ひもが縫い付けてある部分（★）は返し縫い",
      "応用：まちをつけるときは、下部から5cmの位置で折り、まちを折ったまま両脇を縫う（ポケットを一緒に折らない）"], ""),
    ("st9", "9 表に返す", "9. 表に返して形をととのえる", "s9",
     ["表に返し、アイロンで形をととのえる",
      "角は針などでなるべく直角になるように",
      "返す前に、両脇の縫い目にそってアイロンで折っておくと、返しやすくきれい"],
     "当て布をすると表面がきれいに仕上がる。"),
    ("st10", "10 丸ひもを結ぶ", "10. 丸ひもを結ぶ（例1）", "s10a",
     ["丸ひもの結び方は、しっかり結んであれば自由",
      "例1：端から約20cmを目安に丸ひも通し部に通し、もう1回通して、上部に結び目がくるように結ぶ（左右とも）"], ""),
    ("st11", "11 完成", "11. 完成", "s11",
     ["カラビナでホイッスルやマスコットを付けられる。ペンも差せる",
      "ひもを外すとポーチとして使える",
      "サコッシュとして使うときは、ひもを結んで長さを調節する"], ""),
    ("st12", "12 防災のまめ知識2", "12. 防災のまめ知識2を作成する", "s12",
     ["家族と話し合ったり、自分で考えたりしながら書き込み、完成させる",
      "山折り・谷折りの線にそってジャバラに折り、ミニブックにする",
      "できあがったポーチやサコッシュに入れて活用する"], ""),
]

# ---------------------------------------------------------------- 手順マップ（2列）
map_items = [{"type": "text", "x": 36, "y": 96, "w": 888, "h": 26, "fontSize": 15, "color": "sub",
              "text": "いまの工程を押して開こう。終わったら「完了」にチェック。どのページも右上の「手順マップへ」で戻れる。"}]
col_x = [36, 486]
rows = 7
for i, (sid, label, *_rest) in enumerate(STEPS):
    c, r = divmod(i, rows)
    x, y = col_x[c], 128 + r * 54
    map_items += [
        {"type": "shape", "shape": "rounded", "x": x, "y": y, "w": 330, "h": 46, "fill": "accent" if i == 0 else "primary",
         "stroke": "#ffffff", "text": label, "color": "#ffffff", "fontSize": 18, "pad": [0.04, 0.1, 0.04, 0.1], "link": sid},
        {"type": "field", "x": x + 336, "y": y, "w": 102, "h": 46, "fontSize": 12,
         "field": {"id": f"done-{sid}", "type": "checkbox", "label": "完了"}}]
map_items += [
    {"type": "shape", "shape": "rounded", "x": 486, "y": 128 + 6 * 54, "w": 438, "h": 46, "fill": "accentSoft", "stroke": "accent",
     "text": "困ったら：ミシン縫いのきほん", "fontSize": 17, "pad": [0.04, 0.1, 0.04, 0.1], "link": "machine"}]

plan_items = [{"type": "band", "x": 36, "y": 100, "w": 100, "h": 32, "text": "回"},
              {"type": "band", "x": 142, "y": 100, "w": 330, "h": 32, "text": "今日の目標（どの工程まで）"},
              {"type": "band", "x": 478, "y": 100, "w": 446, "h": 32, "text": "できたこと・次の回に気をつけること"}]
for i in range(6):
    y = 138 + i * 63
    plan_items += [{"type": "band", "x": 36, "y": y, "w": 100, "h": 58, "text": f"{i + 1}回目", "fill": "accentSoft"},
                   {"type": "field", "x": 142, "y": y, "w": 330, "h": 58, "fontSize": 13,
                    "field": {"id": f"goal{i + 1}", "label": f"{i + 1}回目の目標", "labelLeft": True, "labelCompact": True, "placeholder": "例：4. まで"}},
                   {"type": "field", "x": 478, "y": y, "w": 446, "h": 58, "fontSize": 13,
                    "field": {"id": f"rev{i + 1}", "label": f"{i + 1}回目のふり返り", "labelLeft": True, "labelCompact": True, "placeholder": "できたこと／気をつけること"}}]

phases = [
    {"name": "はじめに", "slides": [
        {"kind": "title", "id": "start", "title": "防災ポーチ＆サコッシュをつくろう", "subtitle": "家庭分野　布を用いた製作",
         "notes": "製作の流れ：はじめに（目的・完成形・材料）→ 手順マップで各自のペースで製作 → 完成・ふり返り。\n学習目標・ルーブリックは説明書をもとにした案。学校の評価規準に合わせて直す。"},
        {"kind": "question", "tag": "考えよう", "heading": "災害のとき、身につけておきたいものは？",
         "prompt": "もしものとき、ポーチやサコッシュに入れて持ち歩きたいものは何だろう？",
         "hintsTitle": "考えるヒント", "hints": ["連絡や合図に使うもの", "けがや体調に備えるもの", "家族と決めておくこと（連絡先・集合場所）", "毎日持ち歩けるか"],
         "fields": [{"id": "q1", "label": "入れて持ち歩きたいもの（理由も）", "placeholder": "例：ホイッスル（助けを呼ぶため）"}],
         "notes": "完成したポーチにはカラビナでホイッスルなどを付けられ、「防災のまめ知識2」のミニブックも入れて活用できる。持ち物の話題から製作の目的を意識させる。"},
        {"kind": "form", "tag": "完成のイメージ", "heading": "防災ポーチ＆サコッシュ", "items": [
            {"type": "image", "image": light("design"), "alt": "完成の図（約22cm×約24cm、上部約10cm、広げた状態約34cm）", "x": 36, "y": 100, "w": 540, "h": 300},
            {"type": "card", "title": "大きさ", "text": "・約22cm×約24cm（上部約10cm）\n・広げた状態 約34cm\n・丸ひもの長さ 約110〜120cm（結び目を除く）\n・肩から下げるときは、結んで長さを調節", "tone": "primary", "x": 592, "y": 100, "w": 332, "h": 300, "fontSize": 17},
            {"type": "card", "text": "ひもを外すとポーチ、ひもを付けるとサコッシュ。カラビナでホイッスルなどを付けられる。", "tone": "accent", "x": 36, "y": 414, "w": 888, "h": 96, "fontSize": 18, "valign": "middle"}]},
        {"kind": "table", "tag": "材料", "heading": "材料をそろえよう",
         "rows": [["品名", "規格", "数量"], ["本体用布地", "約幅25×72cm", "1"], ["ポケット用布地", "約幅21×22cm", "1"],
                  ["平ひも", "約厚さ1mm 幅20mm×45cm", "1"], ["丸ひも", "約直径6mm 長さ160cm", "1"], ["カラビナ", "", "1"],
                  ["説明書", "", "1"], ["防災のまめ知識2", "", "1"]],
         "widths": [1.3, 2.2, 0.6], "split": 0.6,
         "field": {"id": "q2", "type": "checkbox", "label": "材料がそろった"},
         "notes": "製作の前に材料表で確認させる。"},
        {"kind": "rubric", "tag": "めあて", "heading": "製作のめあて（ルーブリック）",
         "notes": "説明書をもとにした案。評価規準に合わせて文言を直す。"}]},
    {"name": "手順マップ", "slides": [
        {"kind": "form", "id": "map", "tag": "手順マップ", "heading": "自分のペースで進めよう", "mapButton": False,
         "buttons": [{"text": "製作計画表へ", "to": "plan"}], "items": map_items,
         "notes": "生徒は自分の端末で、いまの工程のページを開いて作業する。終わったら完了にチェック。進み具合はワークシート（授業コンソール）で確認できる。"},
        {"kind": "form", "id": "plan", "tag": "製作計画表", "heading": "目標を決めて、ふり返る", "items": plan_items, "fieldFont": 13,
         "notes": "毎時間の始めに今日の目標（どの工程まで）を書き、終わりにできたことと次の回に気をつけることを書く。回数は学校の時数に合わせる。"}]},
] + [{"name": label, "slides": [step_page(sid, "手順" if sid != "st0" else "準備", heading, img, pts, notes,
                                          f"説明書の図：{heading}")]} for sid, label, heading, img, pts, notes in STEPS]

# extra pages in some rows
for P in phases:
    if P["name"] == "10 丸ひもを結ぶ":
        P["slides"].append(step_page("st10b", "手順", "10. 丸ひもを結ぶ（例2）", "s10b",
                                     ["例2：端から約25cmを目安に丸ひも通し部に通し、もう1回通して、2回巻きつけ、巻きつけた部分に下から通して、引きしめながら形をととのえる（左右とも）",
                                      "例1・例2以外の結び方で、好みのサコッシュにしてもよい"], "", "説明書の図：丸ひもの結び方 例2"))
    if P["name"] == "11 完成":
        P["slides"].append({"kind": "question", "tag": "完成", "heading": "完成した作品を記録しよう",
                            "prompt": "完成したポーチ（サコッシュ）の写真と、工夫したところを残そう。",
                            "fields": [{"id": "q3", "type": "free", "label": "完成した作品（写真＋工夫したところ）", "placeholder": "写真を貼って、工夫したところを文字で書き込もう"}],
                            "notes": "自由入力の欄（VHSlide 0.135〜）：写真の貼り付け・手描き・文字を1つの欄で組み合わせて答えられる。"})

phases += [
    {"name": "ミシン縫いのきほん", "slides": [
        step_page("machine", "困ったら", "ミシン縫いのきほん", "machine",
                  ["直線縫い：手前側の手で軽く布を押さえ、向こう側へまっすぐ布をすすめる",
                   "三つ折りミシン：折り山から縫い目がおちないように（約0.2cm）",
                   "返し縫い：縫い始めと縫い終わりは、縫い目にそって1〜1.5cm位重ねて縫う",
                   "角：針を刺した状態で押さえを上げ、布の方向を変えて押さえを下ろす"], "", "説明書の図：ミシン縫いの方法")]},
    {"name": "ふり返り", "slides": [
        {"kind": "fields", "tag": "活用", "heading": "防災ポーチを生活に生かそう",
         "prompt": "完成したポーチに何を入れて、いつ・どこで使う？ 家族と話したことも書こう。",
         "fields": [{"id": "q5", "label": "入れるもの・使う場面", "placeholder": "例：ホイッスルと連絡先カードを入れて、通学のときに持つ"},
                    {"id": "q6", "label": "家族と話し合ったこと（防災のまめ知識2）", "placeholder": "連絡方法、集合場所など"}],
         "notes": "防災のまめ知識2は、家族と話し合ったり自分で考えたりしながら書き込む。家庭の事情に配慮する。"},
        {"kind": "rubric", "tag": "自己評価", "heading": "ルーブリックで自己評価しよう", "selfCheck": "public",
         "lead": "製作をふり返り、観点ごとにA・B・Cを選ぼう。"},
        {"kind": "fields", "tag": "ふり返り", "heading": "製作をふり返ろう",
         "fields": [{"id": "q7", "label": "製作を通してできるようになったこと", "placeholder": "ミシン、アイロン、手順を読むこと…"},
                    {"id": "q8", "label": "次の製作に生かしたいこと", "placeholder": "計画の立て方、ていねいさ…"}]}]},
]

spec = {
    "title": "防災ポーチ＆サコッシュをつくろう", "course": "家庭分野　布を用いた製作",
    "layout": "phase-grid", "theme": "bento", "mascot": "blob",
    "lessons": [{
        "title": "防災ポーチ＆サコッシュをつくろう", "short": "防災ポーチ＆サコッシュ",
        "hour": "手順マップで、自分のペースで製作します",
        "goal": "製作の手順とミシンの使い方を理解し、安全に製作して、防災に生かす。",
        "worksheet": {"title": "防災ポーチ＆サコッシュ 製作記録"},
        "mapButton": {"text": "手順マップへ", "to": "map"}, "sectionSlides": False,
        "rubric": {"lead": "製作のめあて。Aをめざそう。", "criteria": [
            {"id": "self1", "name": "製作の技能（知識・技能）", "levels": [
                "手順と縫い方の意味を理解し、印に合わせて正確に、丈夫に縫えている",
                "説明書の手順どおりに、ミシンやアイロンを使って製作できている",
                "手順どおりに製作することが難しい"]},
            {"id": "self2", "name": "工夫（思考・判断・表現）", "levels": [
                "使う目的に合わせ、ポケット・まち・ひもの結び方などを考えて工夫している",
                "使い方を考えて、作り方の一部を工夫している",
                "使い方を考えて工夫することが難しい"]},
            {"id": "self3", "name": "計画と生活への活用（主体的に学習に取り組む態度）", "levels": [
                "目標を決めてふり返りながら製作し、防災に生かす使い方を具体的に考えている",
                "目標を決めて製作し、防災での使い方を考えている",
                "目標を決めたり、使い方を考えたりすることが難しい"]}]},
        "phases": phases}]}
json.dump(spec, open("bousai.spec.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("ok", sum(len(P["slides"]) for P in phases), "pages")
