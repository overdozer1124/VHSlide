#!/usr/bin/env python3
"""Build a VHSlide deck JSON from a lesson spec — Python port of scripts/deck-core.mjs for Gemini skills.

usage: python build_deck.py <spec.json> <out.vhslide.json> [--layout lesson-rows|phase-grid]
                            [--theme name|theme.json] [--mascot kind|none] [--flat] [--no-fonts]

Backdrops, icons and characters are pre-rendered into ../assets/images.txt (one plain-text file: '@ group/name mime' lines followed by base64) (only Python's standard library is needed).
Images in the spec: a file path (relative to the spec), a data: URL, or inline SVG markup. SVG is drawn with
cairosvg when it is installed; otherwise a PNG with the same name next to an .svg file is used.
"""
import base64, json, math, os, re, struct, sys, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets")
W, H, X0, X1, BOTTOM = 960, 540, 36, 924, 516
FONTS = ["sans", "serif", "mono", "rounded", "klee", "yomogi", "ud", "brush", "shippori"]
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class BuildError(Exception):
    pass


def nn(*vals):
    """JS `a ?? b ?? c`: the first value that is not None."""
    for v in vals:
        if v is not None:
            return v
    return None


def jround(v):
    """Math.round(v * 10) / 10 with JavaScript's half-up rounding."""
    return math.floor(v * 10 + 0.5) / 10


def jstr(v):
    """String(v) as JavaScript prints it."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def b36(n):
    s = ""
    while True:
        n, r = divmod(n, 36)
        s = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + s
        if n == 0:
            return s


def tidy(o):
    """Integral floats → ints so the JSON matches JavaScript's output."""
    if isinstance(o, float) and o.is_integer():
        return int(o)
    if isinstance(o, dict):
        return {k: tidy(v) for k, v in o.items()}
    if isinstance(o, list):
        return [tidy(v) for v in o]
    return o


def image_size(buf):
    if buf[:4] == b"\x89PNG":
        return struct.unpack(">II", buf[16:24])
    if buf[:3] == b"GIF":
        return struct.unpack("<HH", buf[6:10])
    if buf[:4] == b"RIFF" and buf[8:12] == b"WEBP":
        kind = buf[12:16]
        if kind == b"VP8X":
            return 1 + int.from_bytes(buf[24:27], "little"), 1 + int.from_bytes(buf[27:30], "little")
        if kind == b"VP8 ":
            return struct.unpack("<H", buf[26:28])[0] & 0x3FFF, struct.unpack("<H", buf[28:30])[0] & 0x3FFF
        if kind == b"VP8L":
            b = int.from_bytes(buf[21:25], "little")
            return (b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1
    if buf[:2] == b"\xff\xd8":
        i = 2
        while i < len(buf):
            if buf[i] != 0xFF:
                i += 1
                continue
            m = buf[i + 1]
            ln = struct.unpack(">H", buf[i + 2:i + 4])[0]
            if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", buf[i + 5:i + 9])
                return w, h
            i += 2 + ln
    return None


MIME = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}


def data_url(path):
    ext = path.rsplit(".", 1)[-1].lower()
    with open(path, "rb") as f:
        buf = f.read()
    return f"data:{MIME[ext]};base64,{base64.b64encode(buf).decode()}", buf


def svg_to_png(svg):
    try:
        import cairosvg  # optional
    except ImportError:
        raise BuildError("SVGを絵にできません（cairosvg がありません）。図は PNG で作り、image にそのファイル名を書いてください。"
                         "日本語の文字は図に描かず、スライドの文字（form の text）として重ねると確実です。")
    return cairosvg.svg2png(bytestring=svg.encode("utf-8"), scale=2)


def read_images(path):
    pack, key, mime, buf = {}, None, None, []

    def flush():
        if key:
            g, name = key.split("/", 1)
            pack.setdefault(g, {})[name] = f"data:{mime};base64,{''.join(buf)}"
    with open(path, encoding="ascii") as f:
        for line in f:
            line = line.strip()
            if line.startswith("@ "):
                flush()
                _, key, mime = line.split(" ")
                buf = []
            elif line:
                buf.append(line)
    flush()
    return pack


THEMES = None  # build-skill.mjs writes the theme data here, so the skill needs no separate data file


def load_themes():
    if THEMES is not None:
        return THEMES
    with open(os.path.join(ASSETS, "themes.json"), encoding="utf-8") as f:
        return json.load(f)


def resolve_theme(spec, themes):
    if isinstance(spec, str):
        if spec not in themes:
            raise BuildError(f"未知のテーマです: {spec}（{', '.join(themes)}）")
        return {**json.loads(json.dumps(themes[spec])), "name": spec}
    base_name = spec.get("base") or "natural"
    if base_name not in themes:
        raise BuildError(f"未知のテーマです: {base_name}（{', '.join(themes)}）")
    base = json.loads(json.dumps(themes[base_name]))
    t = {**base, "name": base_name, "custom": True, **spec, "mascot": {**base.get("mascot", {}), **(spec.get("mascot") or {})}}
    for k, v in t.items():
        if isinstance(v, str) and v.startswith("#") and not HEX.match(v):
            raise BuildError(f"テーマの色 {k} は #rrggbb で指定してください: {v}")
    return t


def build_deck(spec, layout=None, theme=None, mascot=None, flat=False, no_fonts=False, base_dir=".", warn=None):
    warn = warn or (lambda *a: print(*a, file=sys.stderr))
    if not isinstance(spec, dict):
        raise BuildError("レッスン仕様がJSONのオブジェクトではありません。")
    layout = nn(layout, spec.get("layout"), "lesson-rows")
    if layout not in ("lesson-rows", "phase-grid"):
        raise BuildError(f"layout は lesson-rows か phase-grid です: {layout}")
    THEMES = load_themes()
    T = resolve_theme(nn(theme, spec.get("theme"), "natural"), THEMES)
    sm = spec.get("mascot")
    mascot_arg = nn(mascot, sm if isinstance(sm, str) else (sm or {}).get("kind") if isinstance(sm, dict) else None, "onigiri")
    use_mascot = mascot_arg != "none"
    has_images = os.path.exists(os.path.join(ASSETS, "images.txt"))
    if not has_images and (use_mascot or (not flat and spec.get("decor") is not False)):
        warn("※ 画像のデータ（assets/images.txt）が無いため、背景の装飾・アイコン・キャラクターなしで作ります。")
        use_mascot = False
    if not spec.get("title"):
        raise BuildError("title（作品名）がありません。")

    def load_img(ref):
        r_ = str(ref if ref is not None else "").strip()
        if r_.startswith("<svg"):
            head = r_[: r_.index(">") + 1]
            mw = re.search(r"\bwidth=[\"'](\d+(?:\.\d+)?)", head)
            mh = re.search(r"\bheight=[\"'](\d+(?:\.\d+)?)", head)
            if not mw or not mh:
                raise BuildError('SVGの図には width と height を数値で書いてください（例：width="800" height="450"）。')
            svg = r_ if "xmlns=" in head else r_.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
            png = svg_to_png(svg)
            return {"src": "data:image/png;base64," + base64.b64encode(png).decode(), "w": float(mw.group(1)), "h": float(mh.group(1))}
        m = re.match(r"^data:(image/[a-z+]+);base64,(.*)$", r_, re.S)
        if m:
            size = image_size(base64.b64decode(m.group(2))) or (16, 9)
            return {"src": r_, "w": size[0], "h": size[1]}
        p = os.path.join(base_dir, r_)
        if p.lower().endswith(".svg"):
            png_twin = p[:-4] + ".png"
            try:
                with open(p, encoding="utf-8") as f:
                    png = svg_to_png(f.read())
                size = image_size(png)
                return {"src": "data:image/png;base64," + base64.b64encode(png).decode(), "w": size[0], "h": size[1]}
            except BuildError:
                if not os.path.exists(png_twin):
                    raise
                p = png_twin
        if not os.path.exists(p):
            raise BuildError(f"画像「{r_}」が見つかりません。")
        ext = p.rsplit(".", 1)[-1].lower()
        if ext not in MIME:
            raise BuildError(f"使えない画像形式です: {r_}")
        src, buf = data_url(p)
        size = image_size(buf) or (16, 9)
        return {"src": src, "w": size[0], "h": size[1]}

    # ---------- primitives ----------
    state = {"seq": 0, "tile": 0}

    def nid(p):
        state["seq"] += 1
        return f"{p}-{b36(state['seq'])}"

    LINE_H = 1.5

    def lines(t, w, fs):
        n = 0
        for para in str(t).split("\n"):
            width = 0
            for ch in para:
                width += 0.56 if " " <= ch <= "~" else 1
            n += max(1, math.ceil((width * fs) / max(10, w - 4)))
        return n

    def fit(t, w, h, fs, mn=14):
        s = fs
        while s > mn and lines(t, w, s) * s * LINE_H > h:
            s -= 1
        return s

    use_fonts = not no_fonts

    def rich_ops(t, size, o, color):
        attrs = {"font": o["font"], "size": f"{jstr(size)}px", "color": color}
        if o.get("bold"):
            attrs["bold"] = True
        ops = []
        for line in str(t).split("\n"):
            if line:
                ops.append({"insert": line, "attributes": attrs})
            ops.append({"insert": "\n", "attributes": {"align": o["align"]}} if o.get("align") and o.get("align") != "left" else {"insert": "\n"})
        return ops

    def r(v):
        return jround(v)

    def text(t, x, y, w, h, fs=20, **o):
        font_size = min(120, max(12, fs if o.get("noFit") else fit(t, w, h, fs, nn(o.get("min"), 14))))
        color = nn(o.get("color"), T["ink"])
        font = nn(o.get("font"), T.get("headingFont") if o.get("heading") else T.get("font")) if use_fonts else None
        if font and font not in FONTS:
            raise BuildError(f"使えない書体です: {font}（{', '.join(FONTS)}）")
        el = {"id": nid("t"), "type": "text", "x": r(x), "y": r(y), "w": r(w), "h": r(h), "text": t, "fontSize": font_size, "color": color}
        if o.get("bold"):
            el["bold"] = True
        if o.get("align"):
            el["textAlign"] = o["align"]
        if o.get("valign"):
            el["verticalAlign"] = o["valign"]
        if font and font != "sans":
            el["richText"] = rich_ops(t, font_size, {**o, "font": font}, color)
        if o.get("vertical"):
            el["writingMode"] = "vertical-rl"
        return el

    def rect(x, y, w, h, fill, shape=None, stroke=None, strokeWidth=None):
        return {"id": nid("r"), "type": "shape", "shape": shape or "rect", "x": r(x), "y": r(y), "w": r(max(20, w)), "h": r(max(20, h)),
                "fill": fill, "stroke": nn(stroke, fill), "strokeWidth": nn(strokeWidth, 0)}

    def hline(x, y, w, color, width=1):
        return {"id": nid("l"), "type": "line", "x": r(x), "y": r(y - 10), "w": r(max(20, w)), "h": 20, "stroke": color, "strokeWidth": width,
                "lineStart": {"x": 0, "y": 50}, "lineEnd": {"x": 100, "y": 50}}

    def vline(x, y, h, color, width=1):
        return {"id": nid("l"), "type": "line", "x": r(x - 10), "y": r(y), "w": 20, "h": r(max(20, h)), "stroke": color, "strokeWidth": width,
                "lineStart": {"x": 50, "y": 0}, "lineEnd": {"x": 50, "y": 100}}

    def card(x, y, w, h, tone="plain"):
        soft = T["accentSoft"] if tone == "accent" else T["primarySoft"] if tone == "primary" else T["surface"]
        edge = T["accent"] if tone == "accent" else T["primary"] if tone == "primary" else T["line"]
        if T.get("tiles"):
            tile = T["tiles"][state["tile"] % len(T["tiles"])]
            state["tile"] += 1
        else:
            tile = soft
        els = []
        pad = 16
        kind = T.get("card")
        if T.get("shadow") is not False and nn(kind, "strip") in ("fill", "bento", "sticky", "strip", "outline"):
            els.append({**rect(x + 2, y + 6, w, h, nn(T.get("shadowColor"), "#1d2533"), shape="rounded" if kind == "bento" else "rect"), "opacity": nn(T.get("shadowOpacity"), 0.1)})
        if kind == "fill":
            els.append(rect(x, y, w, h, T["surface"] if tone == "plain" else soft))
        elif kind == "outline":
            els += [rect(x, y, w, h, edge), rect(x + 2, y + 2, w - 4, h - 4, T["surface"] if tone == "plain" else soft)]
        elif kind == "brutal":
            els += [rect(x + 6, y + 6, w - 6, h - 6, T["ink"]), rect(x, y, w - 6, h - 6, T["ink"]),
                    rect(x + 3, y + 3, w - 12, h - 12, T["surface"] if tone == "plain" else T["accentSoft"] if tone == "accent" else tile)]
            pad = 18
        elif kind == "bento":
            els.append(rect(x, y, w, h, T["surface"] if tone == "plain" else T["accentSoft"] if tone == "accent" else tile, shape="rounded"))
        elif kind == "sticky":
            els += [rect(x, y, w, h, T["surface"] if tone == "plain" else T["accentSoft"] if tone == "accent" else tile),
                    rect(x + w / 2 - 36, y - 10, 72, 22, nn(T.get("tape"), "#f4ecd6"))]
            pad = 18
        else:
            els.append(rect(x, y, min(w, 28), h, T["line"] if tone == "plain" else edge))
            els.append(rect(x + 8, y, w - 8, h, T["surface"] if tone == "plain" else soft))
            pad = 22
        b = 6 if kind == "brutal" else 0
        return els, {"x": x + pad, "y": y + 10, "w": w - pad - 14 - b, "h": h - 20 - b}

    def card_text(x, y, w, h, body, tone="plain", fs=20, title=None, align=None, valign="middle", bold=None, heading=None):
        els, i = card(x, y, w, h, tone)
        if not title:
            return els + [text(body, i["x"], i["y"], i["w"], i["h"], fs, align=align, valign=valign, bold=bold, heading=heading)]
        th = min(40, i["h"] * 0.35)
        return els + [text(title, i["x"], i["y"], i["w"], th, min(26, fs + 4), bold=True, color=T["accent"] if tone == "plain" else T["ink"], heading=True),
                      text(body, i["x"], i["y"] + th + 4, i["w"], i["h"] - th - 4, fs, align=align, valign="top")]

    # ---------- pre-rendered images ----------
    def asset(group, name):
        if not has_images:
            return None
        if "pack" not in state:
            state["pack"] = read_images(os.path.join(ASSETS, "images.txt"))
        return state["pack"][group].get(name)

    custom_note = {"done": False}

    def custom_warning(what):
        if T.get("custom") and not custom_note["done"]:
            custom_note["done"] = True
            warn(f"※ 色を上書きしたテーマでは、{what}は「{T['name']}」の色で入れます。")

    images = {}

    def mascot_src(pose):
        if not use_mascot:
            return None
        if pose not in images:
            src = asset("mascots", f"{T['name']}-{mascot_arg}-{pose}.png")
            if not src:
                raise BuildError(f"未知のキャラクターです: {mascot_arg}")
            custom_warning("キャラクター")
            images[pose] = src
        return images[pose]

    decor_on = bool(T.get("decor")) and not flat and nn(spec.get("decor"), True) and has_images
    backdrops = {}

    def backdrop(kind):
        if not decor_on:
            return None
        if kind not in backdrops:
            src = asset("backdrops", f"{T['name']}-{kind}.jpg")
            if src:
                custom_warning("背景の装飾")
            backdrops[kind] = src
        return backdrops[kind]

    def decor_ready():
        return decor_on and backdrops.get("content") is not None

    icons = {}

    def icon_el(name, x, y, s, bg):
        role = "accent" if bg == T["accent"] else "primary" if bg == T["primary"] else "white"
        key = f"{name}:{role}"
        if key not in icons:
            icons[key] = asset("icons", f"{T['name']}-{name}-{role}.png")
            custom_warning("アイコン")
        els = [rect(x, y, s, s, bg, shape="circle")]
        if icons[key]:
            els.append({"id": nid("ic"), "type": "image", "x": r(x + s * 0.18), "y": r(y + s * 0.18), "w": r(s * 0.64), "h": r(s * 0.64), "src": icons[key], "altText": "", "aspectLocked": True})
        return els

    def mascot_el(pose, x, y, s):
        src = mascot_src(pose)
        return [{"id": nid("m"), "type": "image", "x": x, "y": y, "w": s, "h": s, "src": src, "altText": "考えるキャラクター" if pose == "think" else "キャラクター", "aspectLocked": True}] if src else []

    def figure(file, x, y, w, h, alt):
        img = load_img(file)
        k = min(w / img["w"], h / img["h"])
        iw, ih = img["w"] * k, img["h"] * k
        return {"id": nid("i"), "type": "image", "x": r(x + (w - iw) / 2), "y": r(y), "w": r(iw), "h": r(ih), "src": img["src"], "altText": nn(alt, ""), "aspectLocked": True}, ih

    # ---------- worksheet ----------
    ws = {}

    def field(f, x, y, w, h, fs=18, stroke=None, strokeWidth=None):
        kind = nn(f.get("type"), f.get("kind"), "text")
        fid = nn(f.get("id"), f"q{len(ws['fields']) + 1}")
        if any(g["id"] == fid for g in ws["fields"]):
            raise BuildError(f"入力欄のIDが重複しています: {fid}")
        sec = ws["section"]
        if sec in ws["sectionIds"]:
            sid = f"s{ws['sectionIds'].index(sec) + 1}"
        else:
            ws["sectionIds"].append(sec)
            sid = f"s{len(ws['sectionIds'])}"
        wf = {"id": fid, "label": f.get("label"), "kind": kind, "options": nn(f.get("options"), []), "placeholder": nn(f.get("placeholder"), ""),
              "section": sec, "sectionId": sid, "wide": True}
        if f.get("reason"):
            wf["reason"] = True
        if f.get("public"):
            wf["aggregatePublic"] = True
        if f.get("height"):
            wf["inputHeight"] = f["height"]
        if f.get("hideLabel") and kind != "checkbox":
            wf["hideLabel"] = True
        ws["fields"].append(wf)
        if kind == "drawing" and (h < 120 or w < 160):
            warn(f"※ 画像・手描きの入力欄「{f.get('label')}」が小さく、描いたり貼ったりしにくくなります（幅160・高さ120以上を推奨）。")
        return {"id": nid("f"), "type": "shape", "shape": "rounded", "x": r(x), "y": r(y), "w": r(w), "h": r(h), "fill": "#ffffff",
                "stroke": nn(stroke, T["accent"]), "strokeWidth": nn(strokeWidth, 2), "color": "#1d1f23", "fontSize": fs, "text": f.get("label"),
                "responseField": {"source": "worksheet", "deckId": ws["deckId"], "worksheetId": ws["worksheetId"], "field": wf, "showLabel": True, "showSection": False}}

    # ---------- header ----------
    def header(tag, title, meta):
        els = []
        hd = T.get("header")
        dec = T.get("decor") or {}
        if decor_ready() and dec.get("headerBand"):
            els.append(rect(22, 14, 152, 42, "#ffffff", shape="rounded"))
            els.append(text(tag, 22, 16, 152, 38, 16, color=T["primary"], bold=True, align="center", valign="middle", min=12))
            els.append(text(title, 192, 8, 640, 54, 29, color=nn(dec.get("headInk"), "#ffffff"), bold=True, valign="middle", min=18, heading=True))
            if meta:
                els.append(text(meta, 800, 18, 140, 28, 13, color=nn(dec.get("headInk"), "#ffffff"), align="right", valign="middle", min=12))
            return els, nn(dec.get("top"), 100)
        if hd in ("band", "chalk"):
            fill = T["primary"] if hd == "band" else T["bg"]
            if not (decor_ready() and hd == "chalk"):
                els.append(rect(0, 0, W, 64, fill))
            els.append(rect(18, 12, 150, 40, T["accent"], shape="rounded"))
            els.append(text(tag, 18, 14, 150, 36, 16, color=T["onAccent"], bold=True, align="center", valign="middle", min=12))
            els.append(text(title, 186, 8, 650, 50, 28, color=T["onPrimary"] if hd == "band" else T["accent"], bold=True, valign="middle", min=18, heading=True))
            if hd == "chalk" and not decor_ready():
                els += [rect(18, 62, 924, 20, T["line"]), rect(18, 64, 924, 20, T["bg"])]
            elif hd == "chalk":
                els.append(hline(24, 70, 912, T["line"], 2))
            top = 78
        elif hd == "gingham":
            els.append(rect(0, 0, W, 64, T["primary"]))
            els.append(rect(18, 12, 150, 40, T["surface"], shape="rounded"))
            els.append(text(tag, 18, 14, 150, 36, 16, color=T["primary"], bold=True, align="center", valign="middle", min=12))
            els.append(text(title, 186, 8, 650, 50, 28, color=T["onPrimary"], bold=True, valign="middle", min=18, heading=True))
            for i in range(math.ceil(W / 40)):
                els.append(rect(i * 40, 64, 40, 20, T["surface"] if i % 2 else T["primarySoft"]))
            top = 96
        elif hd == "tab":
            els.append(rect(0, 0, W, 72, T["surface"]))
            els += [rect(0, 18, 190, 40, T["accent"], shape="rounded"), rect(0, 18, 40, 40, T["accent"])]
            els.append(text(tag, 20, 20, 160, 36, 17, color=T["onAccent"], bold=True, align="center", valign="middle", min=12))
            els.append(text(title, 206, 12, 640, 52, 28, bold=True, valign="middle", min=18, heading=True))
            els += [rect(0, 70, W, 20, T["line"]), rect(0, 74, W, 20, T["bg"])]
            top = 92
        elif hd == "brutal":
            els += [rect(24, 22, 150, 44, T["ink"]), rect(18, 16, 150, 44, T["ink"]), rect(21, 19, 144, 38, nn(T.get("chip"), T["accentSoft"]))]
            els.append(text(tag, 21, 19, 144, 38, 16, color=T["ink"], bold=True, align="center", valign="middle", min=12))
            els.append(text(title, 190, 10, 640, 56, 30, bold=True, valign="middle", min=18, heading=True))
            top = 86
        elif hd == "bento":
            els.append(rect(X0, 22, 130, 36, T["accent"], shape="rounded"))
            els.append(text(tag, X0, 22, 130, 36, 15, color=T["onAccent"], bold=True, align="center", valign="middle", min=12))
            els.append(text(title, X0 + 146, 12, 660, 56, 30, bold=True, valign="middle", min=18, heading=True))
            top = 80
        elif hd == "notebook":
            for y in range(120, H, 40):
                els.append(hline(0, y, W, T["line"]))
            els.append(vline(86, 0, H, nn(T.get("margin"), "#f0a3a3"), 2))
            for y in (60, 270, 480):
                els.append(rect(22, y - 10, 20, 20, nn(T.get("hole"), "#e7e2d6"), shape="circle"))
            els.append(text(tag, 104, 26, 180, 30, 17, color=T["accent"], bold=True, valign="middle", min=12, heading=True))
            els.append(text(title, 290, 16, 560, 50, 30, bold=True, valign="middle", min=18, heading=True))
            top = 88
        elif hd == "board":
            els += [rect(X0, 16, 640, 56, T["surface"]), rect(X0, 66, 640, 20, T["accent"]), rect(X0, 72, 640, 20, T["bg"])]
            els.append(text(f"{tag}｜{title}", X0 + 16, 18, 610, 50, 26, bold=True, valign="middle", min=16, heading=True))
            top = 96
        elif hd == "magazine":
            els.append(text(tag, X0 + 4, 16, 400, 24, 14, color=T["accent"], bold=True, min=12))
            els.append(text(title, X0, 36, 780, 52, 34, bold=True, valign="middle", min=20, heading=True))
            els.append(hline(X0, 96, X1 - X0, T["ink"], 1))
            top = 108
        else:
            els.append(text(tag, X0, 14, 300, 24, 14, color=T["accent"], bold=True, min=12))
            els.append(text(title, X0, 34, 760, 44, 28, bold=True, valign="middle", min=18, heading=True))
            if hd == "underline":
                els += [rect(X0, 80, 84, 20, T["accent"]), rect(X0, 84, 84, 20, T["bg"])]
            else:
                els += [rect(X0, 82, X1 - X0, 20, T["line"]), rect(X0, 83, X1 - X0, 20, T["bg"])]
            top = 98
        if meta:
            els.append(text(meta, 800, 18, 140, 28, 13, color=T["onPrimary"] if hd in ("band", "gingham") else T["sub"], align="right", valign="middle", min=12))
        return els, top

    def ask(prompt, y, h=72):
        mw = h + 18 if use_mascot else 0
        if T.get("icons") is False:
            return card_text(X0, y, X1 - X0 - mw, h, prompt, tone="accent", fs=21, bold=True, align="center") + mascot_el("think", X1 - h - 4, y - 4, h + 8)
        s = min(58, h - 6)
        bx = X0 + s / 2
        c_els, _ = card(bx, y, X1 - X0 - mw - s / 2, h, "accent")
        return c_els + icon_el("question", X0, y + (h - s) / 2, s, T["accent"]) + \
            [text(prompt, bx + s / 2 + 14, y + 6, X1 - X0 - mw - s - 30, h - 12, 21, bold=True, align="center", valign="middle")] + \
            mascot_el("think", X1 - h - 4, y - 4, h + 8)

    def side(s, x, y, w, h):
        if s.get("hints") is not None and s.get("hints") is not False:
            hints = "\n".join(f"・{v}" for v in s["hints"])
            if T.get("icons") is False:
                return card_text(x, y, w, h, hints, tone="primary", fs=19, title=nn(s.get("hintsTitle"), "ヒント"), valign="top")
            c_els, i = card(x, y, w, h, "primary")
            return c_els + icon_el("bulb", i["x"], i["y"], 36, T["primary"]) + [
                text(nn(s.get("hintsTitle"), "ヒント"), i["x"] + 44, i["y"], i["w"] - 44, 36, 22, bold=True, color=T["ink"], valign="middle", heading=True),
                text(hints, i["x"], i["y"] + 46, i["w"], i["h"] - 46, 19)]
        if s.get("table"):
            return table_el(s["table"], x, y, w, h)
        if s.get("chart"):
            return [chart_el(s["chart"], x, y, w, h)]
        if s.get("image"):
            return [figure(s["image"], x, y, w, h, s.get("alt"))[0]]
        if s.get("body"):
            return card_text(x, y, w, h, s["body"], tone="primary", fs=19, valign="top")
        return []

    def table_el(t, x, y, w, h):
        rows = t["rows"]
        cols = len(rows[0])
        rid = [f"r{i}" for i in range(len(rows))]
        cid = [f"c{j}" for j in range(cols)]
        cells, styles = {}, {}
        for i, row in enumerate(rows):
            for j, v in enumerate(row):
                cells[f"{rid[i]}:{cid[j]}"] = jstr(v)
        for i in t.get("highlight") or []:
            for j in range(cols):
                styles[f"{rid[i]}:{cid[j]}"] = {"fill": T["accentSoft"], "bold": True, "color": "#1d1f23" if T.get("header") == "chalk" else T["ink"]}
        header_lines = max(len(jstr(v).split("\n")) for v in rows[0])
        fs = nn(t.get("fontSize"), max(12, min(18, math.floor((h / (len(rows) + header_lines - 1)) * 0.45), math.floor((w / cols) / 5.2))))
        table = {"rows": rid, "columns": cid, "header": t.get("header") is not False, "cells": cells}
        if styles:
            table["styles"] = styles
        if t.get("widths"):
            table["widths"] = {cid[j]: v for j, v in enumerate(t["widths"])}
        if t.get("heights"):
            table["heights"] = {rid[i]: v for i, v in enumerate(t["heights"])}
        elif header_lines > 1:
            table["heights"] = {"r0": min(3, 0.8 + 0.6 * header_lines)}
        return [{"id": nid("tb"), "type": "table", "x": r(x), "y": r(y), "w": r(w), "h": r(h), "fontSize": fs, "color": "#1d1f23", "fill": "#ffffff",
                 "stroke": T["muted"], "textAlign": nn(t.get("align"), "center"), "table": table}]

    def chart_el(c, x, y, w, h):
        data = c["data"]
        hi = set()
        for v in c.get("highlight") or []:
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                hi.add(int(v))
            else:
                hi.add(next((i for i, d in enumerate(data) if d[0] == v), -1))
        series = []
        for i, d in enumerate(data):
            label, value = d[0], d[1]
            fixed = d[2] if len(d) > 2 else None
            if fixed:
                color = fixed if fixed.startswith("#") else T.get(fixed)
            elif c.get("type") == "pie":
                color = T["chart"][i % len(T["chart"])]
            elif hi:
                color = T["accent"] if i in hi else T["muted"]
            else:
                color = T["chart"][0]
            series.append({"id": f"d{i}", "label": jstr(label)[:60], "value": value, "color": color})
        return {"id": nid("c"), "type": "chart", "x": r(x), "y": r(y), "w": r(w), "h": r(h),
                "chart": {"kind": nn(c.get("type"), "bar"), "title": nn(c.get("title"), ""), "showValues": nn(c.get("showValues"), True),
                          "showLegend": nn(c.get("showLegend"), c.get("type") == "pie"), "series": series}}

    def source(t, x, y, w):
        return text(t, x, y, w, 22, 12, color=T["sub"], min=12)

    # ---------- slide kinds ----------
    def k_title(s, L, top=0):
        deco = bool(backdrop("title"))
        dec = T.get("decor") or {}
        dark = dec.get("titleDark") if deco else T.get("header") in ("band", "chalk")
        els = [] if deco else [rect(0, 0, W, H, (T["bg"] if T.get("header") == "chalk" else T["primary"]) if dark else T["bg"])]
        fg = nn(dec.get("titleInk"), T["ink"]) if deco else ((T["ink"] if T.get("header") == "chalk" else T["onPrimary"]) if dark else T["ink"])
        if not dark and not deco:
            els += [rect(0, 0, 22, H, T["accent"]), rect(700, 0, 260, 260, T["accentSoft"], shape="circle"), rect(820, 400, 140, 140, T["primarySoft"], shape="circle")]
        els.append(text(nn(s.get("subtitle"), spec.get("course"), ""), 64, 60, 720, 34, 20, color=fg if deco else T["line"] if dark else T["sub"]))
        els.append(text(nn(s.get("title"), L.get("title")), 64, 104, 640, 120, 50, color=fg, bold=True, valign="middle", min=30, heading=True))
        goal = nn(s.get("goal"), L.get("goal"))
        if goal:
            els += card_text(64, 244, 600, 120, goal, tone="accent", fs=22, title="学習の目標", valign="top")
        note = nn(s.get("note"), L.get("hour"))
        if note:
            els.append(text(note, 64, 384, 640, 34, 18, color=fg if deco else T["line"] if dark else T["sub"]))
        els += mascot_el("happy", 712, 230, 200)
        return els

    def k_task(s, L, top):
        els = card_text(72, top + 60, 816, 170, s["text"], tone="accent", fs=30, bold=True, align="center", heading=True)
        if T.get("icons") is not False:
            els += icon_el("flag", 46, top + 34, 64, T["accent"])
        if s.get("clues"):
            els.append(text("手がかり：" + "　".join(s["clues"]), 96, top + 250, 768, 40, 19, color=T["sub"], align="center"))
        els += mascot_el("think", 415, top + 300, 130)
        return els

    def k_question(s, L, top):
        variant = nn(s.get("variant"), s.get("_auto"), "band")
        if variant == "bubble" and use_mascot:
            bh = nn(s.get("promptHeight"), 96)
            els = mascot_el("think", X0 - 6, top - 4, bh + 16) + [
                {**rect(X0 + bh + 18, top, X1 - X0 - bh - 18, bh, T["surface"], shape="bubble", stroke=T["accent"], strokeWidth=2), "flipX": True},
                text(s.get("prompt"), X0 + bh + 44, top + 6, X1 - X0 - bh - 70, bh - 26, 21, bold=True, valign="middle")]
            y = top + bh + 14
        else:
            band_h = nn(s.get("promptHeight"), 80)
            els = ask(s.get("prompt"), top, band_h)
            y = top + band_h + 14
        h = BOTTOM - y
        fields = s.get("fields") or ([s["field"]] if s.get("field") else [])
        has_side = s.get("hints") or s.get("table") or s.get("chart") or s.get("image") or s.get("body")
        split = nn(s.get("split"), 0.34 if (s.get("hints") or s.get("body")) else 0.55)
        fx, fw = X0, X1 - X0
        if has_side:
            sw = (X1 - X0 - 16) * split
            els += side(s, X0, y, sw, h)
            fx = X0 + sw + 16
            fw = X1 - fx
        gap = 14
        share = s.get("share") or [1 / len(fields)] * len(fields)
        if s.get("stack"):
            free = h - gap * (len(fields) - 1)
            fy = y
            for i, f in enumerate(fields):
                fh = free * share[i]
                els.append(field(f, fx, fy, fw, fh, nn(s.get("fieldFont"), 18)))
                fy += fh + gap
            return els
        free = fw - gap * (len(fields) - 1)
        fx2 = fx
        for i, f in enumerate(fields):
            w = free * share[i]
            els.append(field(f, fx2, y, w, h, nn(s.get("fieldFont"), 19)))
            fx2 += w + gap
        return els

    def k_figure(s, L, top):
        els = []
        y = top
        if s.get("lead"):
            els.append(text(s["lead"], X0, y, X1 - X0, 56, 20))
            y += 60
        max_h = (BOTTOM - y) * nn(s.get("imageShare"), 0.56) if s.get("field") else BOTTOM - y - 26
        el, ih = figure(s.get("image"), X0, y, X1 - X0, max_h, s.get("alt"))
        els.append(el)
        y += ih + 2
        if s.get("source"):
            els.append(source(s["source"], X0, y, X1 - X0))
            y += 24
        if s.get("field"):
            els.append(field(s["field"], X0, y + 4, X1 - X0, BOTTOM - y - 4, 20))
        return els

    def k_table(s, L, top):
        els = []
        y = top
        if s.get("lead"):
            els += card_text(X0, y, X1 - X0, 60, s["lead"], tone="primary", fs=17)
            y += 68
        tw = (X1 - X0) * nn(s.get("split"), 0.58) if s.get("field") else X1 - X0
        th = BOTTOM - y - (26 if s.get("source") else 0)
        els += table_el(nn(s.get("table"), s), X0, y, tw, th)
        if s.get("source"):
            els.append(source(s["source"], X0, y + th + 4, X1 - X0))
        if s.get("field"):
            els.append(field(s["field"], X0 + tw + 16, y, X1 - X0 - tw - 16, th, 18))
        return els

    def k_chart(s, L, top):
        els = []
        cw = (X1 - X0) * nn(s.get("split"), 0.6)
        ch = BOTTOM - top - (26 if s.get("source") else 0)
        els.append(chart_el(s["chart"], X0, top, cw, ch))
        if s.get("source"):
            els.append(source(s["source"], X0, top + ch + 4, cw))
        rx = X0 + cw + 18
        rw = X1 - rx
        if s.get("field"):
            els.append(field(s["field"], rx, top, rw, BOTTOM - top, 18))
        elif s.get("callout"):
            ch2 = (BOTTOM - top) * 0.62 if use_mascot else BOTTOM - top
            els += card_text(rx, top, rw, ch2, s["callout"], tone="accent", fs=20, title=s.get("calloutTitle"), valign="middle")
            els += mascot_el("idea", rx + rw / 2 - 70, top + ch2 + 10, min(140, BOTTOM - top - ch2 - 10))
        return els

    def k_cards(s, L, top):
        els = []
        y = top
        if s.get("lead"):
            lw = X1 - X0 - (100 if use_mascot else 0)
            els.append(text(s["lead"], X0, y, lw, 70, 21, valign="middle"))
            els += mascot_el("idea", X1 - 88, y - 4, 84)
            y += 80
        foot_h = 86 if s.get("footer") else 0
        variant = nn(s.get("variant"), s.get("_auto"), "grid")
        cards = s["cards"]
        if variant == "bento" and 3 <= len(cards) <= 5:
            gap = 14
            area = BOTTOM - y - foot_h - (gap if foot_h else 0)
            big_w = (X1 - X0 - gap) * 0.46
            rest_x = X0 + big_w + gap
            rest_w = X1 - rest_x
            rest = cards[1:]
            rows = math.ceil(len(rest) / 2)
            rh = (area - gap * (rows - 1)) / rows

            def place(c, x, yy, w, hh, big):
                k_els, inr = card(x, yy, w, hh, nn(c.get("tone"), "accent" if big else "primary"))
                els.extend(k_els)
                els.append(text(c.get("title"), inr["x"], inr["y"], inr["w"], 50 if big else 36, 32 if big else 22, bold=True, color=T["accent"], min=16, heading=True))
                top2 = 58 if big else 40
                sub_h = 30 if c.get("sub") else 0
                els.append(text(nn(c.get("body"), ""), inr["x"], inr["y"] + top2, inr["w"], inr["h"] - top2 - sub_h, 24 if big else nn(s.get("bodySize"), 18)))
                if c.get("sub"):
                    els.append(text(c["sub"], inr["x"], inr["y"] + inr["h"] - sub_h, inr["w"], sub_h, nn(s.get("subSize"), 15), color=T["sub"], min=12))

            place(cards[0], X0, y, big_w, area, True)
            for i, c in enumerate(rest):
                wide = len(rest) % 2 == 1 and i == len(rest) - 1
                cw = rest_w if wide else (rest_w - gap) / 2
                place(c, rest_x + (0 if wide else (i % 2) * (cw + gap)), y + (i // 2) * (rh + gap), cw, rh, False)
            if s.get("footer"):
                els += card_text(X0, BOTTOM - foot_h, X1 - X0, foot_h, s["footer"], tone="accent", fs=19)
            return els
        n = len(cards)
        cols = nn(s.get("columns"), n if n <= 3 else 2 if n == 4 else 3)
        rows = math.ceil(n / cols)
        gap = 14
        cw = (X1 - X0 - gap * (cols - 1)) / cols
        ch = (BOTTOM - y - foot_h - (gap if foot_h else 0) - gap * (rows - 1)) / rows
        for i, c in enumerate(cards):
            x = X0 + (i % cols) * (cw + gap)
            yy = y + (i // cols) * (ch + gap)
            k_els, inr = card(x, yy, cw, ch, nn(c.get("tone"), "primary"))
            els += k_els
            els.append(text(c.get("title"), inr["x"], inr["y"], inr["w"], 38, 24, bold=True, color=T["accent"], min=16, heading=True))
            sub_h = 30 if c.get("sub") else 0
            els.append(text(nn(c.get("body"), ""), inr["x"], inr["y"] + 42, inr["w"], inr["h"] - 42 - sub_h, nn(s.get("bodySize"), 25 if n <= 3 else 22 if n <= 4 else 19)))
            if c.get("sub"):
                els.append(text(c["sub"], inr["x"], inr["y"] + inr["h"] - sub_h, inr["w"], sub_h, nn(s.get("subSize"), 15), color=T["sub"], min=12))
        if s.get("footer"):
            els += card_text(X0, BOTTOM - foot_h, X1 - X0, foot_h, s["footer"], tone="accent", fs=19)
        return els

    def k_flow(s, L, top):
        els = []
        y = top
        if s.get("lead"):
            els.append(text(s["lead"], X0, y, X1 - X0 - (100 if use_mascot else 0), 72, 21, valign="middle"))
            els += mascot_el("idea", X1 - 88, y - 4, 84)
            y += 86
        n = len(s["items"])
        gap = 24
        cw = (X1 - X0 - gap * (n - 1)) / n
        for i, it in enumerate(s["items"]):
            x = X0 + i * (cw + gap)
            els += card_text(x, y, cw, 66, it.get("top"), tone="primary", fs=23, bold=True, align="center")
            els.append(rect(x + cw / 2 - 24, y + 72, 48, 42, T["accent"], shape="downArrow"))
            els += card_text(x, y + 120, cw, 66, it.get("bottom"), tone="accent", fs=24, bold=True, align="center")
            if it.get("note"):
                els.append(text(it["note"], x, y + 192, cw, 40, 22, align="center"))
        if s.get("footer"):
            els += card_text(X0, BOTTOM - 76, X1 - X0, 76, s["footer"], tone="plain", fs=19)
        return els

    def k_points(s, L, top):
        els = []
        note_h = 150 if s.get("note") else 0
        n = len(s["items"])
        gap = 10
        rh = min(64, (BOTTOM - top - note_h - (16 if note_h else 0) - gap * (n - 1)) / n)
        for i, (k, v) in enumerate(s["items"]):
            y = top + i * (rh + gap)
            els += card_text(X0, y, 300, rh, k, tone="accent", fs=19, bold=True, align="center")
            els.append(text(v, X0 + 318, y, X1 - X0 - 318, rh, 19, valign="middle"))
        if s.get("note"):
            els += card_text(X0, BOTTOM - note_h, X1 - X0, note_h, s["note"].get("body"), tone="primary", fs=17, title=s["note"].get("title"), valign="top")
        return els

    def k_board(s, L, top):
        els = card_text(X0, top, X1 - X0, 48, s.get("task"), tone="plain", fs=20, align="center")
        n = len(s["items"])
        step = (BOTTOM - top - 64) / n
        for i, (head, body) in enumerate(s["items"]):
            y = top + 64 + i * step
            els.append(text(f"○ {head}", X0 + 12, y, X1 - X0 - 140, 36, 24, bold=True, heading=True))
            els.append(text(body, X0 + 44, y + 38, X1 - X0 - 180, step - 44, 20, color=T["accent"]))
        els += mascot_el("idea", X1 - 104, BOTTOM - 104, 100)
        return els

    def k_fields(s, L, top):
        els = []
        y = top
        if s.get("prompt"):
            ph = nn(s.get("promptHeight"), 64)
            els += ask(s["prompt"], y, ph)
            y += ph + 10
        if s.get("keywords"):
            els.append(text("キーワード：" + "・".join(s["keywords"]), X0, y, X1 - X0, 28, 16, color=T["sub"]))
            y += 32
        fields = s.get("fields") or [s.get("field")]
        gap = 16
        each = (X1 - X0 - gap * (len(fields) - 1)) / len(fields)
        for i, f in enumerate(fields):
            els.append(field(f, X0 + i * (each + gap), y, each, BOTTOM - y, nn(s.get("fieldFont"), 19)))
        return els

    def k_rubric(s, L, top):
        R = {**(L.get("rubric") or {}), **(s.get("rubric") or {})}
        if not R.get("criteria"):
            raise BuildError(f"ルーブリックの観点（rubric.criteria）がありません: {L.get('title')}")
        levels = nn(R.get("levels"), ["A　十分満足できる", "B　おおむね満足できる", "C　努力を要する"])
        marks = [re.split(r"[\s　]", l.strip())[0] for l in levels]
        els = []
        y = top
        lead = nn(s.get("lead"), R.get("lead"))
        if lead:
            els += card_text(X0, y, X1 - X0, 52, lead, tone="primary", fs=18)
            y += 60
        self_check = s.get("selfCheck")
        tw = (X1 - X0) * nn(s.get("split"), 0.66) if self_check else X1 - X0
        rows = [["観点", *levels]] + [[c["name"], *c["levels"]] for c in R["criteria"]]
        els += table_el({"rows": rows, "align": "left", "widths": [1.15] + [2] * len(levels), "fontSize": nn(s.get("fontSize"), R.get("fontSize"), 12 if self_check else 16)}, X0, y, tw, BOTTOM - y)
        tb = els[-1]["table"]
        tb.setdefault("styles", {})
        longest = [max(len(jstr(v)) for v in c["levels"]) for c in R["criteria"]]
        avg = sum(longest) / len(longest)
        tb["heights"] = {"r0": 0.45, **{f"r{i + 1}": min(2.5, max(0.85, longest[i] / avg)) for i in range(len(R["criteria"]))}}
        for c in tb["columns"][1:]:
            tb["styles"][f"r0:{c}"] = {"fill": T["accentSoft"], "bold": True, "color": "#1d1f23", "textAlign": "center"}
        for rr in tb["rows"][1:]:
            tb["styles"][f"{rr}:c0"] = {"fill": T["primarySoft"], "bold": True, "color": "#1d1f23"}
        if self_check:
            fx = X0 + tw + 14
            fw = X1 - fx
            n = len(R["criteria"])
            gap = 10
            fh = (BOTTOM - y - gap * (n - 1)) / n
            for i, c in enumerate(R["criteria"]):
                f = {"id": nn(c.get("id"), f"self{i + 1}"), "type": "single", "label": f"自己評価：{c['name']}", "options": marks}
                if self_check == "public":
                    f["public"] = True
                els.append(field(f, fx, y + i * (fh + gap), fw, fh, 16))
        return els

    def k_form(s, L, top):
        def col(c):
            return T.get(c) if (c and not c.startswith("#")) else c
        els = []
        for it in s["items"]:
            t = nn(it.get("type"), "field" if it.get("field") else "text")
            before = len(els)
            if t == "field":
                els.append(field(it["field"], it["x"], it["y"], it["w"], it["h"], nn(it.get("fontSize"), s.get("fieldFont"), 14), stroke=col(nn(it.get("stroke"), s.get("stroke")))))
            elif t == "band":
                els += [rect(it["x"], it["y"], it["w"], it["h"], nn(col(it.get("fill")), T["primarySoft"])),
                        text(it.get("text"), it["x"] + 6, it["y"], it["w"] - 12, it["h"], nn(it.get("fontSize"), 15), bold=True, align=nn(it.get("align"), "center"),
                             valign="middle", color=nn(col(it.get("color")), T["ink"]), min=12, heading=True, font=it.get("font"))]
            elif t == "mascot":
                els += mascot_el(nn(it.get("pose"), "idea"), it["x"], it["y"], nn(it.get("s"), 48))
            elif t == "chart":
                els.append(chart_el(it["chart"], it["x"], it["y"], it["w"], it["h"]))
            elif t == "table":
                els += table_el(it["table"], it["x"], it["y"], it["w"], it["h"])
            elif t == "image":
                els.append(figure(it["image"], it["x"], it["y"], it["w"], it["h"], it.get("alt"))[0])
            elif t == "card":
                els += card_text(it["x"], it["y"], it["w"], it["h"], it.get("text"), tone=nn(it.get("tone"), "primary"), fs=nn(it.get("fontSize"), 18),
                                 title=it.get("title"), align=it.get("align"), valign=nn(it.get("valign"), "top"))
            elif t == "shape":
                el = rect(it["x"], it["y"], it["w"], it["h"], nn(col(it.get("fill")), T["surface"]), shape=nn(it.get("shape"), "rounded"),
                          stroke=nn(col(it.get("stroke")), T["ink"]), strokeWidth=nn(it.get("strokeWidth"), 2))
                if it.get("flipX"):
                    el["flipX"] = True
                if it.get("flipY"):
                    el["flipY"] = True
                if it.get("opacity") is not None:
                    el["opacity"] = it["opacity"]
                els.append(el)
                if it.get("text"):
                    p = nn(it.get("pad"), [0.12, 0.14, 0.12, 0.3])
                    els.append(text(it["text"], it["x"] + it["w"] * p[0], it["y"] + it["h"] * p[1], it["w"] * (1 - p[0] - p[2]), it["h"] * (1 - p[1] - p[3]),
                                    nn(it.get("fontSize"), 20), bold=nn(it.get("bold"), True), align=nn(it.get("align"), "center"), valign=nn(it.get("valign"), "middle"),
                                    color=nn(col(it.get("color")), T["ink"]), heading=it.get("heading"), font=it.get("font"), vertical=it.get("vertical"), noFit=it.get("vertical")))
            else:
                els.append(text(it.get("text"), it["x"], it["y"], it["w"], it["h"], nn(it.get("fontSize"), 18), bold=it.get("bold"), align=it.get("align"),
                                valign=nn(it.get("valign"), "middle"), color=nn(col(it.get("color")), T["ink"]), heading=it.get("heading"), font=it.get("font"),
                                vertical=it.get("vertical"), noFit=it.get("vertical")))
            if it.get("link"):
                for e in els[before:]:
                    if e["type"] != "line":
                        e["link"] = {"slideId": it["link"]}
        return els

    def k_section(s, L, top=0):
        deco = bool(backdrop("section"))
        dec = T.get("decor") or {}
        els = [] if deco else [rect(0, 0, W, H, nn(T.get("sectionBg"), T["primary"]))]
        fg = nn(dec.get("sectionInk"), T.get("sectionInk"), T["onPrimary"]) if deco else nn(T.get("sectionInk"), T["onPrimary"])
        if T.get("card") == "brutal" and not deco:
            els += [rect(40, 40, W - 80, H - 80, T["ink"]), rect(46, 46, W - 92, H - 92, nn(T.get("sectionBg"), T["primary"]))]
        els.append(text(jstr(nn(s.get("number"), "")), 80, 120, 220, 220, 120, bold=True, color=nn(dec.get("sectionNum"), fg) if deco else nn(T.get("sectionNum"), fg),
                        valign="middle", noFit=True, heading=True))
        els.append(text(nn(s.get("name"), ""), 300, 150, 560, 80, 52, bold=True, color=fg, valign="middle", min=28, heading=True))
        if s.get("minutes"):
            els.append(text(f"{jstr(s['minutes'])}分", 304, 232, 300, 40, 24, color=fg))
        if s.get("lead"):
            els.append(text(s["lead"], 304, 290, 560, 90, 22, color=fg))
        els += mascot_el("happy", 760, 340, 150)
        return els

    def k_statement(s, L, top):
        k_els, i = card(X0 + 60, top + 20, X1 - X0 - 120, BOTTOM - top - (120 if s.get("note") else 40), nn(s.get("tone"), "plain"))
        els = list(k_els)
        els.append(text(s.get("big"), i["x"], i["y"] + 10, i["w"], i["h"] * 0.6, nn(s.get("bigSize"), 96), bold=True, color=T["accent"], align="center", valign="middle", min=40, heading=True))
        els.append(text(nn(s.get("caption"), ""), i["x"], i["y"] + i["h"] * 0.62, i["w"], i["h"] * 0.36, 26, bold=True, align="center", valign="top"))
        if s.get("note"):
            els += card_text(X0, BOTTOM - 90, X1 - X0, 90, s["note"], tone="primary", fs=19)
        els += mascot_el("idea", X1 - 96, top + 4, 90)
        return els

    def k_compare(s, L, top):
        els = []
        y = top
        if s.get("prompt"):
            ph = nn(s.get("promptHeight"), 64)
            els += ask(s["prompt"], y, ph)
            y += ph + 12
        fh = nn(s.get("fieldHeight"), 120) if s.get("field") else 0
        area = BOTTOM - y - (fh + 12 if fh else 0)
        gap = 70
        cw = (X1 - X0 - gap) / 2
        for i, side2 in enumerate([s["left"], s["right"]]):
            x = X0 + i * (cw + gap)
            k_els, inr = card(x, y, cw, area, "primary" if i else "accent")
            els += k_els
            els.append(text(side2.get("title"), inr["x"], inr["y"], inr["w"], 44, 28, bold=True, color=T["ink"], align="center", heading=True))
            body = "\n".join(f"・{v}" for v in side2["items"]) if side2.get("items") else nn(side2.get("body"), "")
            els.append(text(body, inr["x"], inr["y"] + 52, inr["w"], inr["h"] - 52, 20))
        els += [rect(X0 + cw + 9, y + area / 2 - 26, 52, 52, T["accent"], shape="circle"),
                text("VS", X0 + cw + 9, y + area / 2 - 26, 52, 52, 18, bold=True, color=T["onAccent"], align="center", valign="middle", noFit=True)]
        if s.get("field"):
            els.append(field(s["field"], X0, BOTTOM - fh, X1 - X0, fh, 17))
        return els

    def k_steps(s, L, top):
        els = []
        y = top
        if s.get("lead"):
            els.append(text(s["lead"], X0, y, X1 - X0 - (100 if use_mascot else 0), 56, 20, valign="middle"))
            els += mascot_el("idea", X1 - 80, y - 6, 72)
            y += 64
        fh = nn(s.get("fieldHeight"), 110) if s.get("field") else 0
        area = BOTTOM - y - (fh + 12 if fh else 0)
        n = len(s["items"])
        gap = 30
        cw = (X1 - X0 - gap * (n - 1)) / n
        for i, it in enumerate(s["items"]):
            x = X0 + i * (cw + gap)
            ch = min(area - 26, 250)
            k_els, _ = card(x, y + 26, cw, ch, "primary")
            els += k_els
            els += [rect(x + cw / 2 - 26, y, 52, 52, T["accent"], shape="circle"),
                    text(str(i + 1), x + cw / 2 - 26, y, 52, 52, 24, bold=True, color=T["onAccent"], align="center", valign="middle", noFit=True)]
            els.append(text(it.get("title"), x + 12, y + 64, cw - 24, 40, 21, bold=True, align="center", heading=True))
            if it.get("body"):
                els.append(text(it["body"], x + 12, y + 108, cw - 24, ch - 94, 19, align="center"))
            if i < n - 1:
                els.append(rect(x + cw + 4, y + 26 + ch / 2 - 12, gap - 8, 24, T["accent"], shape="arrow"))
        if s.get("field"):
            els.append(field(s["field"], X0, BOTTOM - fh, X1 - X0, fh, 17))
        return els

    def k_quiz(s, L, top):
        ph = nn(s.get("promptHeight"), 70)
        els = ask(s.get("prompt"), top, ph)
        y = top + ph + 14
        labels = "ABCD"
        choices = s["choices"]
        n = len(choices)
        cols = n if n <= 2 else 2
        rows = math.ceil(n / cols)
        gap = 14
        tw = (X1 - X0) * 0.56
        th = (BOTTOM - y - gap * (rows - 1)) / rows
        cw = (tw - gap * (cols - 1)) / cols
        fills = T.get("tiles") or [T["accentSoft"], T["primarySoft"], T["accentSoft"], T["primarySoft"]]
        for i, c in enumerate(choices):
            x = X0 + (i % cols) * (cw + gap)
            yy = y + (i // cols) * (th + gap)
            if T.get("card") == "brutal":
                els += [rect(x + 6, yy + 6, cw - 6, th - 6, T["ink"]), rect(x, yy, cw - 6, th - 6, T["ink"]), rect(x + 3, yy + 3, cw - 12, th - 12, fills[i % len(fills)])]
            else:
                els.append(rect(x, yy, cw, th, fills[i % len(fills)], shape="rounded" if T.get("card") == "bento" else "rect"))
            els.append(text(f"{labels[i]}　{c}", x + 18, yy, cw - 36, th - 6, 26, bold=True, valign="middle", min=16))
        fx = X0 + tw + 16
        els.append(field({"id": s.get("id"), "label": nn(s.get("label"), "答え"), "type": "single", "options": [f"{labels[i]}　{c}"[:100] for i, c in enumerate(choices)],
                          "reason": nn(s.get("reason"), True), "public": nn(s.get("public"), True)}, fx, y, X1 - fx, BOTTOM - y, 16))
        return els

    def k_custom(s, L, top):
        return [{**e, "id": nn(e.get("id"), nid("x"))} for e in s["elements"]]

    kinds = {"title": k_title, "task": k_task, "question": k_question, "figure": k_figure, "table": k_table, "chart": k_chart, "cards": k_cards,
             "flow": k_flow, "points": k_points, "board": k_board, "fields": k_fields, "rubric": k_rubric, "form": k_form, "section": k_section,
             "statement": k_statement, "compare": k_compare, "steps": k_steps, "quiz": k_quiz, "custom": k_custom}

    # ---------- assemble ----------
    slides, sheets, routes = [], [], []
    lessons = spec.get("lessons")
    if not isinstance(lessons, list) or not lessons:
        raise BuildError("lessons が必要です。")
    multi = layout == "phase-grid" and len(lessons) > 1
    if not multi:
        sheets.append({"id": "main", "name": nn(spec.get("sheetName"), spec["title"]), "rowLabels": {}})
    variety = {}
    backdrop("content")
    for li, L in enumerate(lessons):
        ws.clear()
        ws.update({"deckId": str(uuid.uuid4()), "worksheetId": str(uuid.uuid4()), "fields": [], "sectionIds": [], "section": ""})
        sheet_id = f"lesson-{li + 1}" if multi else "main"
        if multi:
            sheets.append({"id": sheet_id, "name": nn(L.get("short"), L.get("title"))[:80], "rowLabels": {}})
        sheet = next(s for s in sheets if s["id"] == sheet_id)
        lesson_slides = []
        col = 0
        phases = L.get("phases") or []
        for pi, P in enumerate(phases):
            row = li if layout == "lesson-rows" else pi
            if layout == "phase-grid":
                sheet["rowLabels"][str(row)] = P.get("name")
                col = 0
            else:
                sheet["rowLabels"][str(row)] = nn(L.get("short"), L.get("title"))[:80]
            ws["section"] = P.get("name")
            section_on = nn(L.get("sectionSlides"), spec.get("sectionSlides"), True) and pi > 0
            phase_slides = ([{"kind": "section", "number": pi + 1, "name": P.get("name"), "minutes": P.get("minutes"), "lead": P.get("lead"),
                              "title": f"{P.get('name')}（区切り）", "notes": P.get("notes")}] if section_on else []) + list(P.get("slides") or [])
            for si, S in enumerate(phase_slides):
                if S.get("kind") not in kinds:
                    raise BuildError(f"未知のスライド種類: {S.get('kind')}（使えるのは {'・'.join(k for k in kinds if k != 'custom')}）")
                if not S.get("variant") and nn(spec.get("variety"), True):
                    cycle = {"question": ["band", "bubble"], "cards": ["grid", "bento"]}.get(S["kind"])
                    if cycle:
                        variety[S["kind"]] = variety.get(S["kind"], -1) + 1
                        S["_auto"] = cycle[variety[S["kind"]] % len(cycle)]
                meta = f"{P.get('name')} {jstr(P.get('minutes'))}分" if (si == 0 or (section_on and si == 1)) and P.get("minutes") else P.get("name")
                if S["kind"] == "title":
                    els = k_title(S, L)
                elif S["kind"] == "section" or S.get("header") is False:
                    els = kinds[S["kind"]](S, L, 0)
                else:
                    h_els, top = header(nn(S.get("tag"), P.get("name")), nn(S.get("heading"), S.get("title"), ""), meta)
                    els = h_els + kinds[S["kind"]](S, L, top)
                bd_kind = nn(S.get("backdropKind"), "title" if S["kind"] == "title" else "section" if S["kind"] == "section" else "plain" if S.get("header") is False else "content")
                if S.get("backdrop"):
                    bd = load_img(S["backdrop"])["src"]
                elif S.get("backdrop") is False:
                    bd = None
                else:
                    bd = backdrop(bd_kind)
                if bd:
                    els.insert(0, {"id": nid("bg"), "type": "image", "x": 0, "y": 0, "w": W, "h": H, "src": bd, "altText": ""})
                slide = {"id": nn(S.get("id"), f"L{li + 1}-{row}-{col}"), "x": col, "y": row,
                         "title": nn(S.get("title"), S.get("heading"), f"{nn(S.get('name'), '')}（区切り）" if S["kind"] == "section" else S["kind"])[:200],
                         "background": T["bg"], "elements": [e for e in els if e]}
                if len(sheets) > 1 or multi:
                    slide["sheetId"] = sheet_id
                if S.get("notes"):
                    slide["speakerNotes"] = S["notes"]
                slides.append(slide)
                lesson_slides.append(slide)
                col += 1
        wsd = L.get("worksheet") or {}
        if ws["fields"] and nn(wsd.get("summarySlide"), True):
            row = li if layout == "lesson-rows" else len(phases) - 1
            sections = [{"id": f"s{i + 1}", "title": t} for i, t in enumerate(ws["sectionIds"])]
            h_els, top = header("ワークシート", "自分の回答を見直そう", "ふり返り")
            slide = {"id": f"L{li + 1}-ws", "x": col, "y": row, "title": "ワークシート全体", "background": T["bg"]}
            if multi:
                slide["sheetId"] = sheet_id
            slide["speakerNotes"] = "各ページの入力欄と同じワークシートの全体表示。提出前の見直しや家庭学習に使う。"
            slide["elements"] = ([{"id": nid("bg"), "type": "image", "x": 0, "y": 0, "w": W, "h": H, "src": backdrops["content"], "altText": ""}] if backdrops.get("content") else []) + h_els + [{
                "id": nid("ws"), "type": "shape", "shape": "rounded", "x": X0, "y": top, "w": X1 - X0, "h": BOTTOM - top, "fill": "#ffffff", "stroke": T["accent"], "strokeWidth": 2, "formFontSize": 16,
                "worksheet": {"deckId": ws["deckId"], "worksheetId": ws["worksheetId"], "title": nn(wsd.get("title"), f"{L.get('title')} ワークシート")[:200],
                              "description": nn(wsd.get("description"), "各ページの入力欄と同じ回答です。ここからまとめて見直し・修正できます。"), "sections": sections, "fields": ws["fields"]}}]
            slides.append(slide)
        if len(ws["fields"]) > 40:
            raise BuildError(f"1つのワークシートの入力欄は40個までです（{L.get('title')}: {len(ws['fields'])}）")
        routes.append({"id": f"route-{li + 1}", "name": nn(L.get("routeName"), f"{nn(L.get('short'), L.get('title'))}（授業の流れ）")[:80], "slides": [s["id"] for s in lesson_slides]})

    deck = {"version": 1, "title": spec["title"][:200], "sheets": sheets, "slides": slides}
    if multi:
        deck["activeSheetId"] = sheets[0]["id"]
    deck["routes"] = routes[:30]
    for p in slides:
        for e in p["elements"]:
            if not (0 <= e["x"] <= W and 0 <= e["y"] <= H and e["w"] >= 20 and e["h"] >= 20 and e["x"] + e["w"] <= W + 0.1 and e["y"] + e["h"] <= H + 0.1):
                raise BuildError(f"範囲外の要素: {p['id']} {e['type']} ({e['x']},{e['y']},{e['w']},{e['h']})")
    for s in sheets:
        if not any(nn(p.get("sheetId"), "main") == s["id"] and p["x"] == 0 and p["y"] == 0 for p in slides):
            raise BuildError(f"シート「{s['name']}」の左上(0,0)にページがありません。")
    return tidy(deck)


def main(argv):
    args = argv[1:]

    def opt(name):
        return args[args.index(f"--{name}") + 1] if f"--{name}" in args else None

    pos = [a for i, a in enumerate(args) if not a.startswith("--") and not (i > 0 and args[i - 1].startswith("--") and args[i - 1] not in ("--flat", "--no-fonts"))]
    if len(pos) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    spec_path, out_path = pos[0], pos[1]
    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)
    theme = opt("theme")
    if theme and theme.endswith(".json"):
        with open(theme, encoding="utf-8") as f:
            theme = json.load(f)
    try:
        deck = build_deck(spec, layout=opt("layout"), theme=theme, mascot=opt("mascot"), flat="--flat" in args, no_fonts="--no-fonts" in args,
                          base_dir=os.path.dirname(os.path.abspath(spec_path)))
    except BuildError as e:
        print(f"作れませんでした：{e}", file=sys.stderr)
        return 1
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(deck, f, ensure_ascii=False, indent=1)
    ws_count = sum(1 for s in deck["slides"] for e in s["elements"] if e.get("worksheet"))
    print(f"{len(deck['slides'])}ページ・{len(deck['sheets'])}シート・ワークシート{ws_count}個 → {out_path} ({round(os.path.getsize(out_path) / 1024)}KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
