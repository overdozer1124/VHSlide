#!/usr/bin/env python3
"""Redrawn figures for the 防災ポーチ＆サコッシュ deck (one consistent style).
Colors: body fabric = light blue (表) / grey-blue (裏), 平ひも = grey, pocket = pale yellow,
stitches = magenta dashed, chalk marks = blue, dimensions = dark grey with guide lines.
usage: python3 figures.py  → src/redesign/*.svg (render with render-figures.mjs)"""
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "src", "redesign")
C = dict(body="#e4ecff", bodyHatch="#cbd7f5", ura="#c9d2e3", uraDot="#b3bed4", strap="#c7ccd6", pocket="#fff4cc", pocketHatch="#f3dc8f",
         pocketLine="#c99a06", stitch="#c2185b", ink="#1f2430", sub="#5b6170", mark="#2b5fd9", dim="#3d4350", green="#1f8a5b",
         accent="#e0782f", rope="#7a4cc2")

DEFS = f"""<defs>
<pattern id="b" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="{C['body']}"/><path d="M0 12 L12 0" stroke="{C['bodyHatch']}" stroke-width="1.5"/></pattern>
<pattern id="u" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="{C['ura']}"/><circle cx="6" cy="6" r="1.3" fill="{C['uraDot']}"/></pattern>
<pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="{C['pocket']}"/><path d="M0 10 L10 0" stroke="{C['pocketHatch']}" stroke-width="1.4"/></pattern>
<pattern id="pu" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#efe2b0"/><circle cx="5" cy="5" r="1.2" fill="#d9c27a"/></pattern>
<marker id="d" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 1 L10 5 L0 9z" fill="{C['dim']}"/></marker>
<marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="{C['accent']}"/></marker>
<marker id="m" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="{C['stitch']}"/></marker>
<marker id="g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="{C['green']}"/></marker>
<marker id="k" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="{C['mark']}"/></marker>
</defs>"""


def svg(w, h, body, legend=True):
    leg = legend_bar(h - 34, w) if legend else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="IPAPGothic, sans-serif">'
            f'{DEFS}<rect width="{w}" height="{h}" fill="#ffffff"/>{body}{leg}</svg>')


def t(x, y, s, size=20, color=None, anchor="start", weight="400"):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color or C["ink"]}" text-anchor="{anchor}" font-weight="{weight}">{s}</text>'


def badge(x, y, n, title):
    return (f'<circle cx="{x + 22}" cy="{y}" r="22" fill="{C["mark"]}"/>' + t(x + 22, y + 9, n, 24, "#fff", "middle", "700")
            + t(x + 56, y + 10, title, 26, C["ink"], "start", "700"))


def fabric(x, y, w, h, side="表", label=True):
    fill = "url(#b)" if side == "表" else "url(#u)"
    s = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{fill}" stroke="{C["ink"]}" stroke-width="3"/>'
    if label:
        s += t(x + 10, y + h - 12, f"（{side}）", 18, C["sub"])
    return s


def strap(x, y, w, h, label="平ひも", size=18):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{C["strap"]}" stroke="{C["ink"]}" stroke-width="2"/>'
            + (t(x + w / 2, y + h / 2 + size * 0.36, label, size, C["ink"], "middle") if label else ""))


def pocket(x, y, w, h, side="表", label="ポケット"):
    fill = "url(#p)" if side == "表" else "url(#pu)"
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="{fill}" stroke="{C["pocketLine"]}" stroke-width="3"/>'
            + (t(x + w / 2, y + h / 2 + 8, label, 22, "#8a6a00", "middle", "700") if label else ""))


def stitch(d, w=4):
    return f'<path d="{d}" fill="none" stroke="{C["stitch"]}" stroke-width="{w}" stroke-dasharray="11 7" stroke-linecap="round"/>'


def mark(x1, y1, x2, y2):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{C["mark"]}" stroke-width="3" stroke-dasharray="3 5"/>'


def pin(x, y):
    return f'<circle cx="{x}" cy="{y}" r="6" fill="{C["green"]}" stroke="#fff" stroke-width="2"/>'


def vdim(x, y1, y2, label, ext_from=None, side="right", size=20):
    """Vertical dimension between y1 and y2 at x. Guide lines run from ext_from to x. Small gaps get outside arrows."""
    s = ""
    if ext_from is not None:
        for y in (y1, y2):
            s += f'<line x1="{ext_from}" y1="{y}" x2="{x + 8}" y2="{y}" stroke="{C["dim"]}" stroke-width="1.5" stroke-dasharray="4 3"/>'
    if y2 - y1 < 46:
        s += (f'<line x1="{x}" y1="{y1 - 26}" x2="{x}" y2="{y1}" stroke="{C["dim"]}" stroke-width="2" marker-end="url(#d)"/>'
              f'<line x1="{x}" y1="{y2 + 26}" x2="{x}" y2="{y2}" stroke="{C["dim"]}" stroke-width="2" marker-end="url(#d)"/>'
              f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2}" stroke="{C["dim"]}" stroke-width="2"/>')
    else:
        s += f'<line x1="{x}" y1="{y1}" x2="{x}" y2="{y2}" stroke="{C["dim"]}" stroke-width="2" marker-start="url(#d)" marker-end="url(#d)"/>'
    tx = x + 12 if side == "right" else x - 12
    return s + t(tx, (y1 + y2) / 2 + size * 0.36, label, size, C["dim"], "start" if side == "right" else "end", "700")


def hdim(y, x1, x2, label, ext_from=None, above=True, size=20):
    s = ""
    if ext_from is not None:
        for x in (x1, x2):
            s += f'<line x1="{x}" y1="{ext_from}" x2="{x}" y2="{y + (-8 if above else 8)}" stroke="{C["dim"]}" stroke-width="1.5" stroke-dasharray="4 3"/>'
    if x2 - x1 < 46:
        s += (f'<line x1="{x1 - 26}" y1="{y}" x2="{x1}" y2="{y}" stroke="{C["dim"]}" stroke-width="2" marker-end="url(#d)"/>'
              f'<line x1="{x2 + 26}" y1="{y}" x2="{x2}" y2="{y}" stroke="{C["dim"]}" stroke-width="2" marker-end="url(#d)"/>'
              f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{C["dim"]}" stroke-width="2"/>')
    else:
        s += f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{C["dim"]}" stroke-width="2" marker-start="url(#d)" marker-end="url(#d)"/>'
    ty = y - 10 if above else y + size + 6
    return s + t((x1 + x2) / 2, ty, label, size, C["dim"], "middle", "700")


def callout(x, y, tx, ty, lines, color=None, size=20, anchor="start"):
    """Leader line from (x, y) on the drawing to a label at (tx, ty)."""
    color = color or C["stitch"]
    s = f'<line x1="{tx}" y1="{ty - 6}" x2="{x}" y2="{y}" stroke="{color}" stroke-width="2"/><circle cx="{x}" cy="{y}" r="4" fill="{color}"/>'
    for i, line in enumerate(lines):
        s += t(tx + (6 if anchor == "start" else -6), ty + i * (size + 6), line, size, color, anchor, "700")
    return s


def arrow(x1, y1, x2, y2, color="a", w=4):
    col = {"a": C["accent"], "g": C["green"], "k": C["mark"], "m": C["stitch"]}[color]
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" stroke-width="{w}" marker-end="url(#{color})"/>'


def big_next(x, y):
    return f'<path d="M{x} {y - 18} L{x + 40} {y - 18} L{x + 40} {y - 34} L{x + 74} {y} L{x + 40} {y + 34} L{x + 40} {y + 18} L{x} {y + 18} Z" fill="#c7ccd6"/>'


def legend_bar(y, w):
    return (f'<line x1="20" y1="{y - 12}" x2="{w - 20}" y2="{y - 12}" stroke="#e3e6ec" stroke-width="2"/>'
            + stitch(f"M30 {y + 8} L90 {y + 8}") + t(100, y + 15, "縫う線（ミシン）", 17, C["sub"])
            + mark(270, y + 8, 320, y + 8) + t(330, y + 15, "印（チャコペンシル）", 17, C["sub"])
            + pin(520, y + 8) + t(534, y + 15, "仮止め（まち針・しつけ）", 17, C["sub"])
            + f'<rect x="760" y="{y - 2}" width="34" height="20" fill="url(#b)" stroke="{C["ink"]}" stroke-width="1.5"/>' + t(802, y + 15, "布の表", 17, C["sub"])
            + f'<rect x="880" y="{y - 2}" width="34" height="20" fill="url(#u)" stroke="{C["ink"]}" stroke-width="1.5"/>' + t(922, y + 15, "布の裏", 17, C["sub"]))


def iron(x, y, s=1.0):
    return (f'<g transform="translate({x},{y}) scale({s})"><path d="M0 40 L70 40 Q74 20 54 10 L20 10 Q4 14 0 40 Z" fill="#9aa6bd" stroke="{C["ink"]}" stroke-width="3"/>'
            f'<path d="M22 10 Q24 -6 40 -6 L56 -6" fill="none" stroke="{C["ink"]}" stroke-width="5" stroke-linecap="round"/></g>')


FIG = {}

# ---------------------------------------------------------------- 完成のイメージ
FIG["design"] = svg(1200, 600, (
    # pouch (front)
    f'<path d="M170 170 C150 60 430 60 410 170" fill="none" stroke="{C["rope"]}" stroke-width="7"/>'
    + fabric(160, 170, 260, 300, "表", False) + strap(160, 270, 260, 26, "")
    + f'<line x1="160" y1="200" x2="420" y2="200" stroke="{C["sub"]}" stroke-width="2" stroke-dasharray="8 6"/>'
    + pocket(185, 320, 210, 130, "表", "ポケット")
    + f'<rect x="146" y="176" width="20" height="16" fill="{C["strap"]}" stroke="{C["ink"]}" stroke-width="2"/><rect x="414" y="176" width="20" height="16" fill="{C["strap"]}" stroke="{C["ink"]}" stroke-width="2"/>'
    + hdim(500, 160, 420, "約22cm", 470, above=False)
    + vdim(450, 170, 470, "約24cm", 420)
    + vdim(120, 170, 270, "約10cm", 160, side="left")
    + t(290, 40, "ポーチ・サコッシュ（前）", 22, C["ink"], "middle", "700")
    # opened
    + fabric(700, 90, 240, 400, "表", False) + strap(700, 190, 240, 26, "")
    + pocket(722, 240, 196, 130, "表", "ポケット")
    + f'<line x1="700" y1="290" x2="940" y2="290" stroke="{C["sub"]}" stroke-width="2" stroke-dasharray="8 6" opacity=".0"/>'
    + vdim(980, 90, 490, "約34cm", 940)
    + t(820, 40, "広げた状態", 22, C["ink"], "middle", "700")
    + t(600, 580, "丸ひもの長さ 約110〜120cm（結び目を除く）　肩から下げるときは、結んで長さを調節", 20, C["sub"], "middle")), legend=False)

# ---------------------------------------------------------------- 地直し
cx, cy = 230, 230
pull = "".join(arrow(cx + dx * 60, cy + dy * 60, cx + dx * 150, cy + dy * 150, "a", 5)
               for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1), (0.72, 0.72), (-0.72, -0.72), (0.72, -0.72), (-0.72, 0.72)])
FIG["jinaoshi"] = svg(1200, 470, (
    badge(30, 40, "1", "布をたて・よこ・ななめに引いて、布目を正す")
    + fabric(110, 110, 240, 240, "裏", False) + t(120, 136, "（裏）", 18, C["sub"]) + pull
    + big_next(520, 230)
    + badge(640, 40, "2", "裏からアイロン。たて・よこの布目にそって")
    + fabric(700, 110, 300, 240, "裏")
    + arrow(760, 300, 960, 300, "k", 4) + arrow(760, 300, 760, 140, "k", 4)
    + iron(830, 170, 1.3)
    + t(1012, 150, "折ってあった", 18, C["sub"]) + t(1012, 174, "内側が裏", 18, C["sub"])
    + t(1012, 300, "裏の端に", 18, C["mark"], "start", "700") + t(1012, 324, "チャコで印", 18, C["mark"], "start", "700")
    + mark(1000, 340, 1000, 230)
    + t(600, 402, "表からアイロンをかけるときは、当て布をするときれいに仕上がる", 18, C["sub"], "middle")))

# ---------------------------------------------------------------- 1 印をつける
FIG["s1"] = svg(1200, 700, (
    badge(30, 40, "1", "布地をたて長に置き、裏側に印を付ける")
    + t(40, 130, "上", 24, C["ink"], "start", "700") + t(40, 600, "下", 24, C["ink"], "start", "700")
    + fabric(120, 120, 190, 470, "裏")
    + mark(134, 120, 134, 590) + mark(296, 120, 296, 590) + mark(120, 136, 310, 136) + mark(120, 574, 310, 574)
    + vdim(345, 120, 136, "2cm", 310) + vdim(345, 574, 590, "2cm", 310)
    + hdim(100, 120, 134, "1.5cm", 120) + hdim(100, 296, 310, "1.5cm", 120)
    + f'<rect x="120" y="226" width="190" height="34" fill="none" stroke="{C["accent"]}" stroke-width="3" stroke-dasharray="6 4"/>'
    + arrow(318, 243, 470, 200, "a", 3)
    + t(480, 110, "上の部分（拡大）", 22, C["accent"], "start", "700")
    + fabric(500, 130, 330, 470, "裏", False)
    + mark(500, 160, 830, 160)
    + f'<rect x="500" y="340" width="330" height="40" fill="none" stroke="{C["mark"]}" stroke-width="3" stroke-dasharray="3 5"/>'
    + f'<rect x="500" y="400" width="330" height="40" fill="none" stroke="{C["mark"]}" stroke-width="3" stroke-dasharray="3 5"/>'
    + t(665, 366, "（A）丸ひも通し用平ひも位置", 18, C["mark"], "middle", "700")
    + t(665, 426, "（B）平ひも縫い付け位置", 18, C["mark"], "middle", "700")
    + vdim(870, 130, 160, "2cm", 830) + vdim(870, 160, 340, "10cm", 830) + vdim(870, 340, 380, "2cm", 830)
    + vdim(960, 380, 400, "1cm", 830) + vdim(870, 400, 440, "2cm", 830)
    + t(500, 640, "（A）より下にある印が（B）。平ひもは（B）に付ける", 20, C["accent"], "start", "700")))

# ---------------------------------------------------------------- 2 平ひもをカット
FIG["s2"] = svg(1200, 430, (
    t(40, 50, "平ひも（約45cm）", 24, C["ink"], "start", "700")
    + strap(60, 80, 600, 40, "①　本体用布地の幅（約25cm）", 18) + strap(660, 80, 120, 40, "余り", 16)
    + strap(780, 80, 160, 40, "②　8cm", 18) + strap(940, 80, 160, 40, "②　8cm", 18)
    + f'<rect x="1100" y="80" width="14" height="40" fill="#8a93a6"/>' + t(1120, 72, "ほつれ止め", 16, C["sub"])
    + "".join(f'<line x1="{x}" y1="64" x2="{x}" y2="136" stroke="{C["accent"]}" stroke-width="3"/>' for x in (660, 780, 940))
    + t(720, 160, "✂ ここで切る", 18, C["accent"], "middle", "700")
    + hdim(190, 60, 660, "本体の幅と同じ（約25cm）", 120, above=False)
    + hdim(190, 780, 940, "8cm", 120, above=False) + hdim(190, 940, 1100, "8cm", 120, above=False)
    + badge(30, 290, "1", "①は本体用布地の幅に合わせて切る")
    + badge(30, 350, "2", "②はほつれ止めの側から8cmを2本（丸ひも通し用）")))

# ---------------------------------------------------------------- 3 上部を縫う
FIG["s3"] = svg(1200, 520, (
    badge(30, 40, "1", "印に合わせて2cm折り、端から端までミシンで縫う")
    + fabric(80, 120, 380, 260, "裏")
    + f'<rect x="80" y="120" width="380" height="50" fill="url(#b)" stroke="{C["ink"]}" stroke-width="3"/>'
    + t(270, 152, "2cm 折る", 18, C["ink"], "middle", "700")
    + stitch("M84 158 L456 158")
    + vdim(495, 120, 170, "2cm", 460)
    + big_next(560, 240)
    # cross-section
    + t(690, 110, "横から見ると", 20, C["sub"])
    + f'<path d="M700 330 L1000 330" stroke="{C["ink"]}" stroke-width="6"/>'
    + f'<path d="M1000 330 Q1030 330 1030 300 Q1030 270 1000 270 L860 270" fill="none" stroke="{C["ink"]}" stroke-width="6"/>'
    + t(690, 360, "本体", 18, C["sub"]) + t(780, 250, "折り返した部分", 18, C["sub"], "end")
    + f'<line x1="890" y1="250" x2="890" y2="350" stroke="{C["stitch"]}" stroke-width="4" stroke-dasharray="8 5"/>'
    + hdim(390, 860, 890, "0.5〜0.6cm", 350, above=False)
    + callout(890, 300, 960, 210, ["端から0.5〜0.6cmを縫う"])
    + t(600, 470, "縫い始めと縫い終わりは返し縫い。もう一方（下側）も同じように縫う", 20, C["sub"], "middle")))

# ---------------------------------------------------------------- 4 平ひもを縫い付ける
def body_top(x, y, w=300, h=330):
    return (fabric(x, y, w, h, "表", False) + f'<line x1="{x}" y1="{y + 30}" x2="{x + w}" y2="{y + 30}" stroke="{C["sub"]}" stroke-width="2" stroke-dasharray="8 6"/>')


FIG["s4"] = svg(1200, 590, (
    badge(20, 36, "1", "（B）に合わせて置き、仮止め")
    + body_top(40, 80) + strap(40, 240, 300, 30)
    + pin(90, 255) + pin(290, 255)
    + t(190, 380, "布地の表側", 18, C["sub"], "middle")
    + t(190, 300, "（B）の印に合わせる", 18, C["mark"], "middle", "700")
    + badge(410, 36, "2", "布端から1cmを縫う")
    + body_top(430, 80) + strap(430, 240, 300, 30, "")
    + stitch("M450 236 L450 274") + stitch("M710 236 L710 274")
    + hdim(220, 430, 450, "1cm", 240) + hdim(220, 710, 730, "1cm", 240)
    + badge(800, 36, "3", "中心と左右5.5cmの3か所")
    + body_top(820, 80) + strap(820, 240, 300, 30, "")
    + stitch("M970 236 L970 274") + stitch("M860 236 L860 274") + stitch("M1080 236 L1080 274")
    + hdim(310, 860, 970, "5.5cm", 270, above=False) + hdim(310, 970, 1080, "5.5cm", 270, above=False)
    + t(970, 228, "中心", 18, C["ink"], "middle", "700")
    + t(600, 460, "縫い始めと縫い終わりは返し縫い（0.5〜0.7cm位）で丈夫に", 20, C["stitch"], "middle", "700")
    + t(600, 492, "（A）に合わせないように注意。平ひもがずれないように", 20, C["accent"], "middle", "700")
    + t(970, 380, "3か所で区切ると", 17, C["sub"], "middle") + t(970, 402, "ペンを差せる", 17, C["sub"], "middle")))

# ---------------------------------------------------------------- 5 ポケットを準備する
FIG["s5"] = svg(1200, 560, (
    badge(20, 36, "1", "裏に印を付ける")
    + pocket(60, 90, 260, 280, "裏", "")
    + mark(60, 170, 320, 170) + mark(80, 90, 80, 370) + mark(300, 90, 300, 370) + mark(60, 350, 320, 350)
    + vdim(350, 90, 170, "4cm", 320) + vdim(350, 350, 370, "1cm", 320)
    + hdim(410, 60, 80, "1cm", 370, above=False) + hdim(410, 300, 320, "1cm", 370, above=False)
    + t(190, 72, "ポケット口（上）", 18, C["accent"], "middle", "700")
    + t(190, 262, "21×22cm", 18, "#8a6a00", "middle")
    + badge(430, 36, "2", "ポケット口を三つ折りにして縫う")
    + t(470, 110, "横から見ると", 18, C["sub"])
    + f'<path d="M480 330 L720 330" stroke="#8a6a00" stroke-width="6"/>'
    + f'<path d="M720 330 Q745 330 745 305 Q745 280 720 280 L640 280 Q615 280 615 255 Q615 230 640 230 L720 230" fill="none" stroke="#8a6a00" stroke-width="6"/>'
    + vdim(780, 230, 280, "2cm", 745) + vdim(780, 280, 330, "2cm", 745)
    + f'<line x1="652" y1="210" x2="652" y2="350" stroke="{C["stitch"]}" stroke-width="4" stroke-dasharray="8 5"/>'
    + callout(652, 220, 560, 160, ["折り山から", "0.2〜0.3cmを縫う"], C["stitch"], 18, "end")
    + iron(560, 360, 0.9)
    + badge(860, 36, "3", "残りの3辺を1cm折る")
    + pocket(890, 90, 260, 260, "表", "")
    + f'<path d="M890 120 L900 120 L900 340 L1140 340 L1140 120 L1150 120" fill="none" stroke="#8a6a00" stroke-width="3"/>'
    + t(1020, 230, "アイロンで", 18, "#8a6a00", "middle") + t(1020, 254, "折り目を付ける", 18, "#8a6a00", "middle")
    + t(600, 470, "ポケット用布地は、斜めの織り目が見える方が表", 19, C["sub"], "middle")
    + t(600, 500, "応用でまちをつけるときは、ポケット用布地の長さを16cmに切ってから作る", 19, C["sub"], "middle")))

# ---------------------------------------------------------------- 6 ポケットを付ける
FIG["s6"] = svg(1200, 600, (
    badge(20, 40, "1", "平ひもから1.5cm下に置き、仮止め")
    + fabric(90, 90, 300, 440, "表", False)
    + f'<line x1="90" y1="128" x2="390" y2="128" stroke="{C["sub"]}" stroke-width="2.5" stroke-dasharray="10 7"/>'
    + strap(90, 186, 300, 30)
    + pocket(115, 246, 250, 215)
    + vdim(440, 216, 246, "1.5cm", 390)
    + t(470, 190, "平ひもの下の端から", 16, C["dim"]) + t(470, 270, "ポケットの上の端まで", 16, C["dim"])
    + f'<line x1="240" y1="90" x2="240" y2="530" stroke="{C["green"]}" stroke-width="2.5" stroke-dasharray="4 5"/>'
    + t(250, 520, "中心を合わせる", 18, C["green"], "start", "700")
    + pin(140, 270) + pin(340, 270) + pin(140, 440) + pin(340, 440)
    + big_next(560, 310)
    + badge(660, 40, "2", "ポケット口以外の3辺を縫う")
    + fabric(720, 90, 300, 440, "表", False)
    + f'<line x1="720" y1="128" x2="1020" y2="128" stroke="{C["sub"]}" stroke-width="2.5" stroke-dasharray="10 7"/>'
    + strap(720, 186, 300, 30, "")
    + pocket(745, 246, 250, 215, "表", "")
    + stitch("M752 250 L752 454 L988 454 L988 250")
    + arrow(870, 300, 870, 252, "a", 3) + t(870, 330, "上の辺＝ポケット口", 20, C["accent"], "middle", "700") + t(870, 356, "（縫わない）", 18, C["accent"], "middle")
    + callout(988, 400, 1040, 400, ["端から", "0.2〜0.3cm"], C["stitch"], 20)
    + t(870, 515, "縫い始めと縫い終わりは返し縫い", 17, C["sub"], "middle")))

# ---------------------------------------------------------------- 7 丸ひも通し用平ひも
FIG["s7"] = svg(1200, 520, (
    badge(20, 40, "1", "8cmの平ひもを半分に折り、（A）に置いて仮止め")
    + fabric(60, 90, 460, 340, "表", False)
    + f'<line x1="60" y1="128" x2="520" y2="128" stroke="{C["sub"]}" stroke-width="2.5" stroke-dasharray="10 7"/>'
    + strap(60, 260, 460, 30, "")
    + mark(60, 200, 520, 200)
    + f'<path d="M520 190 L470 190 Q450 190 450 205 Q450 220 470 220 L520 220 Z" fill="{C["strap"]}" stroke="{C["ink"]}" stroke-width="2"/>'
    + pin(495, 205)
    + callout(465, 210, 330, 245, ["輪が内側（布の中心側）"], C["accent"], 18, "end")
    + t(330, 330, "切った側を布端に合わせる", 18, C["ink"], "middle")
    + arrow(430, 340, 512, 222, "a", 3)
    + t(70, 194, "（A）", 20, C["mark"], "start", "700")
    + big_next(560, 230)
    + badge(660, 40, "2", "布端から1cmを縫う（左右とも）")
    + fabric(700, 90, 420, 340, "表", False)
    + f'<line x1="700" y1="128" x2="1120" y2="128" stroke="{C["sub"]}" stroke-width="2.5" stroke-dasharray="10 7"/>'
    + strap(700, 260, 420, 30, "")
    + f'<path d="M1120 190 L1070 190 Q1050 190 1050 205 Q1050 220 1070 220 L1120 220 Z" fill="{C["strap"]}" stroke="{C["ink"]}" stroke-width="2"/>'
    + f'<path d="M700 190 L750 190 Q770 190 770 205 Q770 220 750 220 L700 220 Z" fill="{C["strap"]}" stroke="{C["ink"]}" stroke-width="2"/>'
    + stitch("M1100 180 L1100 230") + stitch("M720 180 L720 230")
    + hdim(160, 1100, 1120, "1cm", 180)
    + t(910, 470, "縫い始めと縫い終わりは返し縫い（0.5〜0.7cm位）", 18, C["sub"], "middle")))

# ---------------------------------------------------------------- 8 両脇を縫う
star = lambda x, y: t(x, y, "★", 22, C["accent"], "middle", "700")
FIG["s8"] = svg(1200, 610, (
    badge(20, 40, "1", "中表に折り、両脇を縫う")
    + fabric(110, 90, 300, 360, "裏", False)
    + f'<line x1="110" y1="120" x2="410" y2="120" stroke="{C["sub"]}" stroke-width="2.5" stroke-dasharray="10 7"/>'
    + stitch("M140 96 L140 444") + stitch("M380 96 L380 444")
    + f'<line x1="110" y1="450" x2="410" y2="450" stroke="{C["ink"]}" stroke-width="5"/>'
    + t(260, 478, "▲ 折り山（底）", 18, C["sub"], "middle")
    + star(96, 228) + star(96, 268) + star(424, 228) + star(424, 268)
    + hdim(510, 110, 140, "1.5cm", 450, above=False) + hdim(510, 380, 410, "1.5cm", 450, above=False)
    + t(260, 300, "中表（表どうしを合わせる）", 18, C["sub"], "middle")
    + t(470, 210, "★平ひもが縫い付けてある所と", 18, C["accent"], "start", "700")
    + t(470, 236, "縫い始め・縫い終わりは返し縫い", 18, C["accent"], "start", "700")
    + f'<line x1="780" y1="70" x2="780" y2="540" stroke="#e3e6ec" stroke-width="2"/>'
    + t(800, 52, "応用：まちをつける場合", 22, C["green"], "start", "700")
    + fabric(860, 90, 280, 360, "裏", False)
    + f'<rect x="860" y="400" width="280" height="50" fill="url(#b)" stroke="{C["ink"]}" stroke-width="3"/>'
    + stitch("M890 96 L890 444") + stitch("M1110 96 L1110 444")
    + vdim(830, 400, 450, "5cm", 860, side="left")
    + t(1000, 486, "下から5cmで折り、折ったまま縫う", 17, C["green"], "middle", "700")
    + t(1000, 510, "ポケットを一緒に折らないように", 17, C["sub"], "middle")))

# ---------------------------------------------------------------- 9 表に返す
FIG["s9"] = svg(1200, 560, (
    badge(20, 40, "1", "縫い目にそってアイロンで折る")
    + fabric(60, 90, 300, 340, "裏", False)
    + stitch("M90 96 L90 424") + stitch("M330 96 L330 424")
    + iron(150, 250, 1.1)
    + big_next(410, 260)
    + badge(520, 40, "2", "表に返し、アイロンで形をととのえる")
    + fabric(560, 90, 300, 340, "表", False)
    + strap(560, 160, 300, 26, "") + pocket(582, 210, 256, 190, "表", "")
    + f'<rect x="545" y="125" width="18" height="16" fill="{C["strap"]}" stroke="{C["ink"]}" stroke-width="2"/><rect x="857" y="125" width="18" height="16" fill="{C["strap"]}" stroke="{C["ink"]}" stroke-width="2"/>'
    + f'<circle cx="860" cy="430" r="22" fill="none" stroke="{C["accent"]}" stroke-width="3"/>'
    + t(940, 160, "角の部分は", 20, C["ink"], "start", "700") + t(940, 188, "針などで", 20, C["ink"], "start", "700") + t(940, 216, "直角にととのえる", 20, C["ink"], "start", "700")
    + f'<path d="M960 330 Q960 280 1010 280" fill="none" stroke="{C["ink"]}" stroke-width="5"/>' + arrow(985, 305, 960, 280, "a", 3)
    + big_next(1030, 305)
    + f'<path d="M1120 340 L1120 280 L1180 280" fill="none" stroke="{C["ink"]}" stroke-width="5"/>'
    + t(600, 500, "当て布をすると、表面がきれいに仕上がる", 18, C["sub"], "middle")))


# ---------------------------------------------------------------- 10 丸ひもを結ぶ
def tab(x, y):
    return (f'<rect x="{x}" y="{y}" width="70" height="200" fill="url(#b)" stroke="{C["ink"]}" stroke-width="3"/>'
            + f'<rect x="{x - 26}" y="{y + 20}" width="30" height="28" rx="4" fill="{C["strap"]}" stroke="{C["ink"]}" stroke-width="2"/>')


rope = lambda d: f'<path d="{d}" fill="none" stroke="{C["rope"]}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
FIG["s10a"] = svg(1200, 430, (
    t(30, 40, "例1：端から約20cmを丸ひも通し部に通し、ほどけないようにしっかり結ぶ（左右とも）", 21, C["ink"], "start", "700")
    + tab(220, 90) + rope("M140 60 L140 180 Q140 200 160 200 L210 200 Q230 200 230 180 L230 120") + t(100, 330, "① 通す", 22, C["mark"], "start", "700")
    + t(70, 216, "端から約20cm", 16, C["sub"])
    + tab(600, 90) + rope("M520 60 L520 170 Q520 200 560 200 L600 200 Q620 200 620 180 L620 120 Q620 100 590 100 L560 100 Q540 100 540 130 L540 230") + t(480, 330, "② もう1回通す", 22, C["mark"], "start", "700")
    + tab(980, 90) + rope("M900 60 L900 170 Q900 200 940 200 L980 200 Q1000 200 1000 180 L1000 120 Q1000 100 970 100 L940 100 Q920 100 920 130 L920 240")
    + f'<circle cx="935" cy="120" r="22" fill="{C["rope"]}"/>' + t(860, 330, "③ 上部に結び目がくるように結ぶ", 22, C["mark"], "start", "700")
    + big_next(370, 200) + big_next(750, 200)), legend=False)
FIG["s10b"] = svg(1200, 380, (
    t(30, 40, "例2：端から約25cmを丸ひも通し部に通し、ほどけないようにしっかり結ぶ（左右とも）", 21, C["ink"], "start", "700")
    + "".join(f'<rect x="{80 + i * 230}" y="80" width="150" height="190" rx="10" fill="#f6f7fa" stroke="#dfe3ea" stroke-width="2"/>'
              + t(155 + i * 230, 300, n, 18, C["mark"], "middle", "700") + t(155 + i * 230, 326, s, 16, C["sub"], "middle")
              for i, (n, s) in enumerate([("① 通す", "端から約25cm"), ("② もう1回通す", ""), ("③ 2回巻きつける", ""), ("④ 下から通す", "巻きつけた部分に"), ("⑤ 引きしめる", "形をととのえる")]))
    + "".join(f'<rect x="{196 + i * 230}" y="90" width="26" height="170" fill="url(#b)" stroke="{C["ink"]}" stroke-width="2"/><rect x="{182 + i * 230}" y="110" width="18" height="22" rx="3" fill="{C["strap"]}" stroke="{C["ink"]}" stroke-width="2"/>' for i in range(5))
    + rope("M120 100 L120 200 Q120 230 150 230 L190 230") + rope("M350 100 L350 210 Q350 240 380 230 Q410 210 380 190 L360 190")
    + rope("M580 100 L580 200") + "".join(f'<ellipse cx="580" cy="{150 + k * 22}" rx="26" ry="10" fill="none" stroke="{C["rope"]}" stroke-width="8"/>' for k in range(2))
    + rope("M810 100 L810 210 Q810 240 840 230 L860 150") + "".join(f'<ellipse cx="810" cy="{160 + k * 22}" rx="24" ry="9" fill="none" stroke="{C["rope"]}" stroke-width="7"/>' for k in range(2))
    + rope("M1040 100 L1040 150") + f'<rect x="1018" y="150" width="44" height="60" rx="16" fill="{C["rope"]}"/>' + rope("M1040 210 L1040 250")), legend=False)

# ---------------------------------------------------------------- 11 完成
FIG["s11"] = svg(1200, 470, (
    f'<path d="M110 140 C80 20 330 20 300 140" fill="none" stroke="{C["rope"]}" stroke-width="7"/>'
    + fabric(90, 140, 230, 260, "表", False) + strap(90, 220, 230, 24, "") + pocket(110, 270, 190, 110, "表", "")
    + f'<path d="M175 244 L175 300" stroke="{C["ink"]}" stroke-width="4"/><circle cx="175" cy="232" r="10" fill="none" stroke="{C["ink"]}" stroke-width="4"/>'
    + f'<rect x="225" y="200" width="10" height="60" fill="{C["accent"]}"/>'
    + t(205, 430, "サコッシュ", 22, C["ink"], "middle", "700")
    + callout(175, 232, 20, 110, ["カラビナに", "ホイッスルなど"], C["mark"], 16)
    + callout(230, 205, 330, 190, ["ペンを差せる"], C["accent"], 16)
    + fabric(520, 140, 230, 260, "表", False) + strap(520, 220, 230, 24, "") + pocket(540, 270, 190, 110, "表", "")
    + t(635, 430, "ひもを外すとポーチ", 22, C["ink"], "middle", "700")
    + f'<path d="M920 160 C880 -40 1150 -40 1110 160" fill="none" stroke="{C["rope"]}" stroke-width="7"/><circle cx="1015" cy="38" r="12" fill="{C["rope"]}"/>'
    + fabric(900, 160, 230, 240, "表", False) + strap(900, 230, 230, 24, "") + pocket(920, 280, 190, 100, "表", "")
    + t(1015, 430, "ひもを結んで長さを調節", 22, C["ink"], "middle", "700")), legend=False)

# ---------------------------------------------------------------- 12 防災のまめ知識2
zig = "".join(f'<path d="M{150 + i * 90} {100 + (i % 2) * 20} L{240 + i * 90} {100 + ((i + 1) % 2) * 20} L{240 + i * 90} {300 + ((i + 1) % 2) * 20} L{150 + i * 90} {300 + (i % 2) * 20} Z" fill="{["#ffffff", "#f1f4fb"][i % 2]}" stroke="{C["ink"]}" stroke-width="2.5"/>' for i in range(5))
FIG["s12"] = svg(1200, 420, (
    badge(20, 40, "1", "家族と話し合ったり、自分で考えたりして書き込む")
    + zig + t(375, 350, "山折り・谷折りの線にそってジャバラに折る", 18, C["sub"], "middle")
    + big_next(640, 210)
    + f'<rect x="760" y="110" width="150" height="200" rx="6" fill="#ffffff" stroke="{C["ink"]}" stroke-width="3"/><rect x="772" y="122" width="150" height="200" rx="6" fill="#f1f4fb" stroke="{C["ink"]}" stroke-width="2" opacity=".6"/>'
    + t(835, 190, "防災の", 22, C["ink"], "middle", "700") + t(835, 220, "まめ知識2", 22, C["ink"], "middle", "700")
    + t(940, 200, "ミニブックにして", 19, C["ink"]) + t(940, 228, "ポーチに入れる", 19, C["ink"])), legend=False)

# ---------------------------------------------------------------- ミシン縫いのきほん
FIG["machine"] = svg(1200, 470, (
    "".join(f'<rect x="{20 + i * 295}" y="20" width="275" height="380" rx="14" fill="#f6f7fa" stroke="#dfe3ea" stroke-width="2"/>' + t(157 + i * 295, 58, n, 22, C["mark"], "middle", "700")
            for i, n in enumerate(["直線縫い", "三つ折りミシン", "返し縫い", "角を縫う"]))
    # straight
    + fabric(60, 90, 195, 180, "表", False) + stitch("M157 100 L157 260") + arrow(157, 300, 157, 250, "a", 4)
    + t(157, 330, "手前の手で軽く押さえ", 17, C["ink"], "middle") + t(157, 354, "まっすぐ布をすすめる", 17, C["ink"], "middle")
    # three-fold
    + f'<path d="M340 230 L560 230 M560 230 Q585 230 585 205 Q585 180 560 180 L470 180 Q445 180 445 160 Q445 140 470 140 L560 140" fill="none" stroke="{C["ink"]}" stroke-width="6"/>'
    + f'<line x1="480" y1="120" x2="480" y2="250" stroke="{C["stitch"]}" stroke-width="4" stroke-dasharray="8 5"/>'
    + t(452, 330, "折り山から縫い目が", 17, C["ink"], "middle") + t(452, 354, "おちないように（約0.2cm）", 17, C["ink"], "middle")
    # back stitch
    + stitch("M650 170 L830 170") + stitch("M650 182 L700 182", 3) + stitch("M780 182 L830 182", 3)
    + arrow(675, 230, 675, 195, "m", 3) + arrow(805, 230, 805, 195, "m", 3)
    + t(675, 255, "重ねて縫う", 15, C["stitch"], "middle") + t(805, 255, "重ねて縫う", 15, C["stitch"], "middle")
    + t(747, 330, "縫い始めと終わりは", 17, C["ink"], "middle") + t(747, 354, "1〜1.5cm位重ねて縫う", 17, C["ink"], "middle")
    # corner
    + fabric(950, 90, 190, 180, "表", False) + stitch("M975 260 L975 115 L1120 115")
    + f'<circle cx="975" cy="115" r="9" fill="{C["accent"]}"/>' + arrow(1010, 160, 990, 130, "a", 3)
    + t(1042, 330, "針を刺したまま押さえを上げ", 17, C["ink"], "middle") + t(1042, 354, "布の向きを変えて下ろす", 17, C["ink"], "middle")))

os.makedirs(OUT, exist_ok=True)
for name, s in FIG.items():
    with open(os.path.join(OUT, f"{name}.svg"), "w", encoding="utf-8") as f:
        f.write(s)
print(len(FIG), "figures →", OUT)
