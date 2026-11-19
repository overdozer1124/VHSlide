#!/usr/bin/env python3
"""VHSlide デッキJSONからプレビュー画像を描く（近似レンダリング）。

実機の表示とは細部（フォント・改行位置など）が異なる「レイアウト確認用」。
撮影（check.mjs）が使えない環境でも、チャットにプレビューを貼るために使う。

使い方:
  python3 scripts/preview.py deck.vhslide.json --out preview-dir
    → preview-dir/page-01.png ... と contact-sheet.png（一覧）を作る
"""
import argparse, base64, io, json, math, os, sys

from PIL import Image, ImageDraw, ImageFont

W, H = 960, 540
def _first(paths):
    return next((p for p in paths if os.path.exists(p)), paths[0])
FONT_REG = _first(["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                   "/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf",
                   "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf"])
FONT_BOLD = _first(["/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", FONT_REG])
_fonts = {}

def font(size, bold=False):
    key = (size, bold)
    if key not in _fonts:
        path = FONT_BOLD if bold and os.path.exists(FONT_BOLD) else FONT_REG
        try:
            _fonts[key] = ImageFont.truetype(path, size)
        except Exception:
            _fonts[key] = ImageFont.load_default()
    return _fonts[key]

def color(v, default=(29, 31, 35)):
    if not isinstance(v, str) or not v.startswith("#"):
        return default
    h = v[1:]
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        return default

def wrap(draw, text, fnt, max_w):
    lines = []
    for para in str(text).split("\n"):
        line = ""
        for ch in para:
            if draw.textlength(line + ch, font=fnt) <= max_w or not line:
                line += ch
            else:
                lines.append(line)
                line = ch
        lines.append(line)
    return lines

def draw_text_block(draw, x, y, w, h, text, size, col, bold=False,
                    align="left", valign="top", line_gap=1.25):
    fnt = font(max(8, int(size)), bold)
    lines = wrap(draw, text, fnt, max(10, w - 8))
    lh = int(size * line_gap)
    total = lh * len(lines)
    cy = y + 4
    if valign == "middle":
        cy = y + max(4, (h - total) // 2)
    for ln in lines:
        tw = draw.textlength(ln, font=fnt)
        if align == "center":
            cx = x + (w - tw) / 2
        elif align == "right":
            cx = x + w - tw - 4
        else:
            cx = x + 4
        draw.text((cx, cy), ln, font=fnt, fill=col)
        cy += lh
        if cy > y + h:
            break

def rich_text(e):
    rt = e.get("richText")
    if isinstance(rt, list):
        return "".join(seg.get("insert", "") for seg in rt if isinstance(seg, dict))
    return e.get("text", "")

def render_slide(slide):
    img = Image.new("RGB", (W, H), color(slide.get("background"), (255, 255, 255)))
    draw = ImageDraw.Draw(img, "RGBA")
    for e in slide.get("elements", []):
        x, y, w, h = (int(e.get(k, 0)) for k in ("x", "y", "w", "h"))
        t = e.get("type")
        if t == "image":
            src = e.get("src", "")
            if src.startswith("data:image"):
                try:
                    raw = base64.b64decode(src.split(",", 1)[1])
                    im = Image.open(io.BytesIO(raw)).convert("RGBA")
                    im = im.resize((max(1, w), max(1, h)))
                    img.paste(im, (x, y), im)
                    draw = ImageDraw.Draw(img, "RGBA")
                except Exception:
                    pass
        elif t == "shape":
            fill = color(e.get("fill"), (255, 255, 255))
            op = e.get("opacity", 1)
            fill_rgba = fill + (int(255 * op),)
            stroke = color(e.get("stroke"), fill)
            sw = int(e.get("strokeWidth", 1))
            shp = e.get("shape", "rect")
            box = [x, y, x + w, y + h]
            if shp in ("rounded", "roundRect"):
                draw.rounded_rectangle(box, radius=min(18, h // 4), fill=fill_rgba,
                                       outline=stroke + (255,), width=max(1, sw))
            elif shp in ("ellipse", "circle", "oval"):
                draw.ellipse(box, fill=fill_rgba, outline=stroke + (255,), width=max(1, sw))
            elif shp in ("line", "arrow"):
                draw.line([x, y + h // 2, x + w, y + h // 2], fill=stroke + (255,), width=max(2, sw))
            else:
                draw.rectangle(box, fill=fill_rgba, outline=stroke + (255,), width=max(1, sw))
            rf = e.get("responseField")
            if rf:
                f = rf.get("field", {})
                draw_text_block(draw, x + 10, y + 8, w - 20, 30,
                                f.get("label", e.get("text", "")), 15,
                                color(e.get("color")), bold=True)
                ph = f.get("placeholder", "")
                if ph:
                    draw_text_block(draw, x + 10, y + 40, w - 20, h - 48, ph, 13, (150, 150, 150))
                opts = f.get("options")
                if isinstance(opts, list) and opts:
                    oy = y + 40
                    for o in opts:
                        draw.ellipse([x + 12, oy + 3, x + 24, oy + 15], outline=(120, 120, 120), width=2)
                        draw_text_block(draw, x + 32, oy, w - 44, 24, str(o), 14, color(e.get("color")))
                        oy += 28
            elif e.get("text"):
                draw_text_block(draw, x + 6, y + 4, w - 12, h - 8, e["text"],
                                e.get("formFontSize", e.get("fontSize", 16)),
                                color(e.get("color")), align="center", valign="middle")
        elif t == "text":
            draw_text_block(draw, x, y, w, h, rich_text(e), e.get("fontSize", 16),
                            color(e.get("color")), bold=bool(e.get("bold")),
                            align=e.get("textAlign", "left"),
                            valign="middle" if e.get("verticalAlign") == "middle" else "top")
        elif t == "table":
            tb = e.get("table", {})
            rows, cols = tb.get("rows", []), tb.get("columns", [])
            if rows and cols:
                cw, chh = w / len(cols), h / len(rows)
                bord = color(e.get("stroke"), (160, 160, 160))
                for ri, r in enumerate(rows):
                    for ci, c in enumerate(cols):
                        cx, cy = x + ci * cw, y + ri * chh
                        bg = (240, 238, 233) if (tb.get("header") and ri == 0) else color(e.get("fill"), (255, 255, 255))
                        draw.rectangle([cx, cy, cx + cw, cy + chh], fill=bg, outline=bord, width=1)
                        cell = tb.get("cells", {}).get(f"{r}:{c}", "")
                        if cell:
                            draw_text_block(draw, int(cx) + 4, int(cy) + 3, int(cw) - 8, int(chh) - 6,
                                            cell, e.get("fontSize", 14), color(e.get("color")),
                                            bold=(tb.get("header") and ri == 0))
        elif t == "chart":
            ch = e.get("chart", {})
            series = ch.get("series", [])
            draw.rectangle([x, y, x + w, y + h], fill=(255, 255, 255), outline=(200, 200, 200), width=1)
            if ch.get("title"):
                draw_text_block(draw, x + 8, y + 6, w - 16, 28, ch["title"], 16, (29, 31, 35), bold=True, align="center")
            vals = [s.get("value", 0) for s in series] or [0]
            vmax = max(vals) or 1
            base_y, top_y = y + h - 34, y + 44
            kind = ch.get("kind", "bar")
            if kind == "bar" and series:
                bw = (w - 40) / len(series) * 0.55
                step = (w - 40) / len(series)
                for i, s in enumerate(series):
                    bh = (base_y - top_y) * s.get("value", 0) / vmax
                    bx = x + 20 + i * step + (step - bw) / 2
                    draw.rectangle([bx, base_y - bh, bx + bw, base_y], fill=color(s.get("color"), (120, 160, 120)))
                    draw_text_block(draw, int(bx) - 10, int(base_y) + 4, int(bw) + 20, 20, str(s.get("label", "")), 12, (90, 90, 90), align="center")
                    if ch.get("showValues"):
                        draw_text_block(draw, int(bx) - 10, int(base_y - bh) - 22, int(bw) + 20, 20, str(s.get("value", "")), 13, (60, 60, 60), align="center")
            elif kind == "pie" and series:
                total = sum(vals) or 1
                r = min(w, h - 90) / 2
                cx, cy = x + w / 2, y + 54 + r
                start = -90
                for s in series:
                    sweep = 360 * s.get("value", 0) / total
                    draw.pieslice([cx - r, cy - r, cx + r, cy + r], start, start + sweep, fill=color(s.get("color"), (150, 150, 150)))
                    start += sweep
            else:
                draw_text_block(draw, x + 10, y + 50, w - 20, 30, "（グラフ）", 14, (120, 120, 120), align="center")
        elif t == "line":
            draw.line([x, y, x + w, y + h], fill=color(e.get("stroke"), (150, 150, 150)), width=max(1, int(e.get("strokeWidth", 2))))
    return img

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("deck")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--cell-w", type=int, default=620)
    args = ap.parse_args()

    deck = json.load(open(args.deck, encoding="utf8"))
    slides = deck.get("slides", [])
    os.makedirs(args.out, exist_ok=True)
    pages = []
    for i, s in enumerate(slides, 1):
        im = render_slide(s)
        p = os.path.join(args.out, f"page-{i:02d}.png")
        im.save(p)
        pages.append(im)
    # 一覧シート
    cols = args.cols
    rows = math.ceil(len(pages) / cols)
    cw = args.cell_w
    chh = int(cw * H / W)
    label_h = 26
    sheet = Image.new("RGB", (cols * cw + (cols + 1) * 10, rows * (chh + label_h) + 10), (235, 235, 235))
    sd = ImageDraw.Draw(sheet)
    for i, im in enumerate(pages):
        r, c = divmod(i, cols)
        px, py = 10 + c * (cw + 10), 10 + r * (chh + label_h)
        sheet.paste(im.resize((cw, chh)), (px, py + label_h))
        sd.text((px + 4, py + 4), f"{i + 1}ページ", font=font(17, True), fill=(40, 40, 40))
    sheet_path = os.path.join(args.out, "contact-sheet.png")
    sheet.save(sheet_path)
    print(f"{len(pages)}ページのプレビューと一覧シートを作成: {args.out}")

if __name__ == "__main__":
    main()
