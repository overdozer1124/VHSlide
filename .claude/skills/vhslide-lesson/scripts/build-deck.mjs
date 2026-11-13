#!/usr/bin/env node
// Build a VHSlide deck JSON from a lesson spec (see reference/spec-format.md).
// usage: node build-deck.mjs <spec.json> <out.json> [--layout lesson-rows|phase-grid] [--theme <name>|<theme.json>] [--mascot <kind>|none]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveTheme } from "./themes.mjs";
import { mascotSvg } from "./mascot.mjs";
import { svgToPng, loadImage, closeRenderer } from "./render.mjs";

const W = 960, H = 540, X0 = 36, X1 = 924, BOTTOM = 516;
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const [specPath, outPath] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!specPath || !outPath) {
  console.error("usage: node build-deck.mjs <spec.json> <out.json> [--layout lesson-rows|phase-grid] [--theme name|theme.json] [--mascot kind|none]");
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const baseDir = path.dirname(path.resolve(specPath));
const layout = opt("layout") ?? spec.layout ?? "lesson-rows";
if (!["lesson-rows", "phase-grid"].includes(layout)) throw Error(`layout は lesson-rows か phase-grid です: ${layout}`);
const themeArg = opt("theme");
const T = resolveTheme(themeArg ? (themeArg.endsWith(".json") ? JSON.parse(fs.readFileSync(themeArg, "utf8")) : themeArg) : spec.theme ?? "natural");
const mascotArg = opt("mascot") ?? (typeof spec.mascot === "string" ? spec.mascot : spec.mascot?.kind) ?? "onigiri";
const useMascot = mascotArg !== "none";

// ---------- primitives ----------
let seq = 0;
const nid = p => `${p}-${(++seq).toString(36)}`;
const lineH = 1.5;
/** Rough line count for mostly-Japanese text (full-width ≈ 1em, ASCII ≈ 0.55em). */
function lines(text, w, fs) {
  return String(text).split("\n").reduce((n, para) => {
    let width = 0;
    for (const ch of para) width += /[\x20-\x7e]/.test(ch) ? 0.56 : 1;
    return n + Math.max(1, Math.ceil((width * fs) / Math.max(10, w - 4)));
  }, 0);
}
/** Largest font size ≤ fs (≥ min) whose wrapped text fits the box. */
function fit(text, w, h, fs, min = 14) {
  let s = fs;
  while (s > min && lines(text, w, s) * s * lineH > h) s -= 1;
  return s;
}
const text = (t, x, y, w, h, fs = 20, o = {}) => ({
  id: nid("t"), type: "text", x: r(x), y: r(y), w: r(w), h: r(h), text: t,
  fontSize: o.noFit ? fs : fit(t, w, h, fs, o.min), color: o.color ?? T.ink,
  ...(o.bold ? { bold: true } : {}), ...(o.align ? { textAlign: o.align } : {}), ...(o.valign ? { verticalAlign: o.valign } : {}),
});
const rect = (x, y, w, h, fill, o = {}) => ({
  id: nid("r"), type: "shape", shape: o.shape ?? "rect", x: r(x), y: r(y), w: r(Math.max(20, w)), h: r(Math.max(20, h)),
  fill, stroke: o.stroke ?? fill, strokeWidth: o.strokeWidth ?? 0,
});
const r = v => Math.round(v * 10) / 10;
/** Thin bars must be ≥20px in VHSlide, so draw them as part of a wider shape stack instead. */
const bar = (x, y, w, h, fill) => (w >= 20 && h >= 20 ? rect(x, y, w, h, fill) : null);

/** Card background in the theme's style. Returns elements and the inner text box. */
function card(x, y, w, h, tone = "plain") {
  const soft = tone === "accent" ? T.accentSoft : tone === "primary" ? T.primarySoft : T.surface;
  const edge = tone === "accent" ? T.accent : tone === "primary" ? T.primary : T.line;
  const els = [];
  if (T.card === "fill") els.push(rect(x, y, w, h, tone === "plain" ? T.surface : soft));
  else if (T.card === "outline") els.push(rect(x, y, w, h, edge), rect(x + 2, y + 2, w - 4, h - 4, tone === "plain" ? T.surface : soft)); // even border on every side
  else { // strip: accent bar is the left 8px of a wider shape hidden under the panel
    els.push(rect(x, y, Math.min(w, 28), h, tone === "plain" ? T.line : edge));
    els.push(rect(x + 8, y, w - 8, h, tone === "plain" ? T.surface : soft));
  }
  const pad = T.card === "strip" ? 22 : 16;
  return { els, inner: { x: x + pad, y: y + 10, w: w - pad - 14, h: h - 20 } };
}
function cardText(x, y, w, h, body, { tone = "plain", fs = 20, title, align, valign = "middle", bold } = {}) {
  const c = card(x, y, w, h, tone);
  const i = c.inner;
  if (!title) return [...c.els, text(body, i.x, i.y, i.w, i.h, fs, { align, valign, bold })];
  const th = Math.min(40, i.h * 0.35);
  return [...c.els,
    text(title, i.x, i.y, i.w, th, Math.min(26, fs + 4), { bold: true, color: tone === "plain" ? T.accent : T.ink }),
    text(body, i.x, i.y + th + 4, i.w, i.h - th - 4, fs, { align, valign: "top" })];
}

// ---------- images ----------
const images = {};
async function mascot(pose) {
  if (!useMascot) return undefined;
  if (!images[pose]) {
    let png;
    try { png = await svgToPng(mascotSvg(mascotArg, pose, T.mascot), { scale: 1.2, transparent: true }); }
    catch (e) { // no SVG renderer: use the pre-rendered character of the base theme
      const file = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "assets", "mascots", `${T.name}-${mascotArg}-${pose}.png`);
      if (!fs.existsSync(file)) throw e;
      if (T.custom) console.warn(`※ SVGを描画できないため、キャラクターは「${T.name}」の色で入れます。`);
      png = fs.readFileSync(file);
    }
    images[pose] = `data:image/png;base64,${png.toString("base64")}`;
  }
  return images[pose];
}
const mascotEl = async (pose, x, y, s) => {
  const src = await mascot(pose);
  return src ? [{ id: nid("m"), type: "image", x, y, w: s, h: s, src, altText: pose === "think" ? "考えるキャラクター" : "キャラクター", aspectLocked: true }] : [];
};
async function figure(file, x, y, w, h, alt) {
  const img = await loadImage(path.resolve(baseDir, file));
  const k = Math.min(w / img.w, h / img.h);
  const iw = img.w * k, ih = img.h * k;
  return { el: { id: nid("i"), type: "image", x: r(x + (w - iw) / 2), y: r(y), w: r(iw), h: r(ih), src: img.src, altText: alt ?? "", aspectLocked: true }, h: ih };
}

// ---------- worksheet ----------
let ws; // current lesson worksheet
function field(f, x, y, w, h, fs = 18, opts = {}) {
  const kind = f.type ?? f.kind ?? "text";
  const id = f.id ?? `q${ws.fields.length + 1}`;
  if (ws.fields.some(g => g.id === id)) throw Error(`入力欄のIDが重複しています: ${id}`);
  const sectionTitle = ws.section;
  const sectionId = `s${ws.sectionIds.indexOf(sectionTitle) + 1 || ws.sectionIds.push(sectionTitle)}`;
  const wf = {
    id, label: f.label, kind, options: f.options ?? [], placeholder: f.placeholder ?? "",
    section: sectionTitle, sectionId, wide: true,
    ...(f.reason ? { reason: true } : {}), ...(f.public ? { aggregatePublic: true } : {}),
    ...(f.height ? { inputHeight: f.height } : {}),
  };
  ws.fields.push(wf);
  // Before VHSlide 0.109 a drawing field showed a label, a toolbar and a 16:9 canvas as wide as the frame;
  // 0.109+ fills the frame and opens the tools on click. Keep the older layout working too.
  if (kind === "drawing" && h < w * 0.5625 + 90)
    console.warn(`※ 画像・手描きの入力欄「${f.label}」の枠が低く、VHSlide 0.109より前の版ではキャンバスが隠れます（幅${Math.round(w)}なら高さ${Math.ceil(w * 0.5625 + 90)}以上）。`);
  return {
    id: nid("f"), type: "shape", shape: "rounded", x: r(x), y: r(y), w: r(w), h: r(h),
    fill: "#ffffff",
    stroke: opts.stroke ?? T.accent, strokeWidth: opts.strokeWidth ?? 2, color: "#1d1f23", fontSize: fs, text: f.label,
    responseField: { source: "worksheet", deckId: ws.deckId, worksheetId: ws.worksheetId, field: wf, showLabel: true, showSection: false },
  };
}

// ---------- header ----------
function header(tag, title, meta) {
  const els = [];
  let top;
  if (T.header === "band" || T.header === "chalk") {
    const fill = T.header === "band" ? T.primary : T.bg;
    els.push(rect(0, 0, W, 64, fill));
    els.push({ ...rect(18, 12, 150, 40, T.accent, { shape: "rounded" }) });
    els.push(text(tag, 18, 14, 150, 36, 16, { color: T.onAccent, bold: true, align: "center", valign: "middle", min: 12 }));
    els.push(text(title, 186, 8, 650, 50, 28, { color: T.header === "band" ? T.onPrimary : T.accent, bold: true, valign: "middle", min: 18 }));
    if (T.header === "chalk") els.push(rect(18, 62, 924, 20, T.line), rect(18, 64, 924, 20, T.bg));
    top = 78;
  } else if (T.header === "gingham") { // tablecloth: coloured band with a checked edge
    els.push(rect(0, 0, W, 64, T.primary));
    els.push({ ...rect(18, 12, 150, 40, T.surface, { shape: "rounded" }) });
    els.push(text(tag, 18, 14, 150, 36, 16, { color: T.primary, bold: true, align: "center", valign: "middle", min: 12 }));
    els.push(text(title, 186, 8, 650, 50, 28, { color: T.onPrimary, bold: true, valign: "middle", min: 18 }));
    for (let i = 0; i < W / 40; i++) els.push(rect(i * 40, 64, 40, 20, i % 2 ? T.surface : T.primarySoft));
    top = 96;
  } else if (T.header === "tab") {
    els.push(rect(0, 0, W, 72, T.surface));
    els.push(rect(0, 18, 190, 40, T.accent, { shape: "rounded" }), rect(0, 18, 40, 40, T.accent));
    els.push(text(tag, 20, 20, 160, 36, 17, { color: T.onAccent, bold: true, align: "center", valign: "middle", min: 12 }));
    els.push(text(title, 206, 12, 640, 52, 28, { bold: true, valign: "middle", min: 18 }));
    els.push(rect(0, 70, W, 20, T.line), rect(0, 74, W, 20, T.bg));
    top = 92;
  } else { // underline / minimal
    els.push(text(tag, X0, 14, 300, 24, 14, { color: T.accent, bold: true, min: 12 }));
    els.push(text(title, X0, 34, 760, 44, 28, { bold: true, valign: "middle", min: 18 }));
    if (T.header === "underline") els.push(rect(X0, 80, 84, 20, T.accent), rect(X0, 84, 84, 20, T.bg));
    else els.push(rect(X0, 82, X1 - X0, 20, T.line), rect(X0, 83, X1 - X0, 20, T.bg));
    top = 98;
  }
  if (meta) els.push(text(meta, 800, 18, 140, 28, 13, { color: T.header === "band" || T.header === "gingham" ? T.onPrimary : T.sub, align: "right", valign: "middle", min: 12 }));
  return { els, top };
}

/** Question band: prompt on the left, thinking mascot on the right. */
async function ask(prompt, y, h = 72) {
  const mw = useMascot ? h + 18 : 0;
  return [...cardText(X0, y, X1 - X0 - mw, h, prompt, { tone: "accent", fs: 21, bold: true, align: "center" }),
    ...(await mascotEl("think", X1 - h - 4, y - 4, h + 8))];
}

/** Side content for question/table/chart slides; returns elements. */
async function side(s, x, y, w, h) {
  if (s.hints) return cardText(x, y, w, h, s.hints.map(v => `・${v}`).join("\n"), { tone: "primary", fs: 19, title: s.hintsTitle ?? "ヒント", valign: "top" });
  if (s.table) return tableEl(s.table, x, y, w, h);
  if (s.chart) return [chartEl(s.chart, x, y, w, h)];
  if (s.image) { const f = await figure(s.image, x, y, w, h, s.alt); return [f.el]; }
  if (s.body) return cardText(x, y, w, h, s.body, { tone: "primary", fs: 19, valign: "top" });
  return [];
}
function tableEl(t, x, y, w, h) {
  const rows = t.rows, cols = rows[0].length;
  const rid = rows.map((_, i) => `r${i}`), cid = rows[0].map((_, j) => `c${j}`);
  const cells = {}, styles = {};
  rows.forEach((row, i) => row.forEach((v, j) => (cells[`${rid[i]}:${cid[j]}`] = String(v ?? ""))));
  for (const i of t.highlight ?? []) for (let j = 0; j < cols; j++) styles[`${rid[i]}:${cid[j]}`] = { fill: T.accentSoft, bold: true, color: T.header === "chalk" ? "#1d1f23" : T.ink };
  const headerLines = Math.max(...rows[0].map(v => String(v).split("\n").length));
  const fs = t.fontSize ?? Math.max(12, Math.min(18, Math.floor((h / (rows.length + headerLines - 1)) * 0.45), Math.floor((w / cols) / 5.2)));
  return [{
    id: nid("tb"), type: "table", x: r(x), y: r(y), w: r(w), h: r(h), fontSize: fs, color: "#1d1f23", fill: "#ffffff", stroke: T.muted, textAlign: t.align ?? "center",
    table: { rows: rid, columns: cid, header: t.header !== false, cells, ...(Object.keys(styles).length ? { styles } : {}),
      ...(t.widths ? { widths: Object.fromEntries(t.widths.map((v, j) => [cid[j], v])) } : {}),
      ...(t.heights ? { heights: Object.fromEntries(t.heights.map((v, i) => [rid[i], v])) } : headerLines > 1 ? { heights: { r0: Math.min(3, 0.8 + 0.6 * headerLines) } } : {}) },
  }];
}
function chartEl(c, x, y, w, h) {
  const hi = new Set((c.highlight ?? []).map(v => (typeof v === "number" ? v : c.data.findIndex(d => d[0] === v))));
  return {
    id: nid("c"), type: "chart", x: r(x), y: r(y), w: r(w), h: r(h),
    chart: { kind: c.type ?? "bar", title: c.title ?? "", showValues: c.showValues ?? true, showLegend: c.showLegend ?? (c.type === "pie"),
      series: c.data.map(([label, value, fixed], i) => ({ id: `d${i}`, label: String(label).slice(0, 60), value,
        color: fixed ? (fixed.startsWith("#") ? fixed : T[fixed]) : c.type === "pie" ? T.chart[i % T.chart.length] : hi.size ? (hi.has(i) ? T.accent : T.muted) : T.chart[0] })) },
  };
}
const source = (t, x, y, w) => text(t, x, y, w, 22, 12, { color: T.sub, min: 12 });

// ---------- slide kinds ----------
const kinds = {
  async title(s, L) {
    const dark = T.header === "band" || T.header === "chalk";
    const els = [rect(0, 0, W, H, dark ? (T.header === "chalk" ? T.bg : T.primary) : T.bg)];
    const fg = dark ? (T.header === "chalk" ? T.ink : T.onPrimary) : T.ink;
    if (!dark) els.push(rect(0, 0, 22, H, T.accent), { ...rect(700, 0, 260, 260, T.accentSoft, { shape: "circle" }) }, { ...rect(820, 400, 140, 140, T.primarySoft, { shape: "circle" }) });
    els.push(text(s.subtitle ?? spec.course ?? "", 64, 60, 720, 34, 20, { color: dark ? T.line : T.sub }));
    els.push(text(s.title ?? L.title, 64, 104, 640, 120, 50, { color: fg, bold: true, valign: "middle", min: 30 }));
    if (s.goal ?? L.goal) els.push(...cardText(64, 244, 600, 120, s.goal ?? L.goal, { tone: "accent", fs: 22, title: "学習の目標", valign: "top" }));
    if (s.note ?? L.hour) els.push(text(s.note ?? L.hour, 64, 384, 640, 34, 18, { color: dark ? T.line : T.sub })); // accent can vanish on a dark primary
    els.push(...(await mascotEl("happy", 712, 230, 200)));
    return els;
  },
  async task(s, _L, top) {
    const els = [...cardText(72, top + 60, 816, 170, s.text, { tone: "accent", fs: 30, bold: true, align: "center" })];
    if (s.clues) els.push(text(`手がかり：${s.clues.join("　")}`, 96, top + 250, 768, 40, 19, { color: T.sub, align: "center" }));
    els.push(...(await mascotEl("think", 415, top + 300, 130)));
    return els;
  },
  async question(s, _L, top) {
    const bandH = s.promptHeight ?? 80;
    const els = await ask(s.prompt, top, bandH);
    const y = top + bandH + 14, h = BOTTOM - y;
    const fields = s.fields ?? (s.field ? [s.field] : []);
    const hasSide = s.hints || s.table || s.chart || s.image || s.body;
    const split = s.split ?? (s.hints || s.body ? 0.34 : 0.55);
    let fx = X0, fw = X1 - X0;
    if (hasSide) { const sw = (X1 - X0 - 16) * split; els.push(...(await side(s, X0, y, sw, h))); fx = X0 + sw + 16; fw = X1 - fx; }
    const gap = 14;
    if (s.stack) { // fields one above another; `share` gives each field's share of the height (e.g. [0.6, 0.4])
      const share = s.share ?? fields.map(() => 1 / fields.length);
      const free = h - gap * (fields.length - 1);
      let fy = y;
      fields.forEach((f, i) => { const fh = free * share[i]; els.push(field(f, fx, fy, fw, fh, s.fieldFont ?? 18)); fy += fh + gap; });
      return els;
    }
    // Side by side; `share` gives each field's share of the width (e.g. [0.62, 0.38]).
    const share = s.share ?? fields.map(() => 1 / fields.length);
    const free = fw - gap * (fields.length - 1);
    let fx2 = fx;
    fields.forEach((f, i) => { const w = free * share[i]; els.push(field(f, fx2, y, w, h, s.fieldFont ?? 19)); fx2 += w + gap; });
    return els;
  },
  async figure(s, _L, top) {
    const els = [];
    let y = top;
    if (s.lead) { els.push(text(s.lead, X0, y, X1 - X0, 56, 20)); y += 60; }
    const maxH = s.field ? (BOTTOM - y) * (s.imageShare ?? 0.56) : BOTTOM - y - 26;
    const f = await figure(s.image, X0, y, X1 - X0, maxH, s.alt);
    els.push(f.el); y += f.h + 2;
    if (s.source) { els.push(source(s.source, X0, y, X1 - X0)); y += 24; }
    if (s.field) els.push(field(s.field, X0, y + 4, X1 - X0, BOTTOM - y - 4, 20));
    return els;
  },
  async table(s, _L, top) {
    const els = [];
    let y = top;
    if (s.lead) { els.push(...cardText(X0, y, X1 - X0, 60, s.lead, { tone: "primary", fs: 17 })); y += 68; }
    const tw = s.field ? (X1 - X0) * (s.split ?? 0.58) : X1 - X0;
    const th = BOTTOM - y - (s.source ? 26 : 0);
    els.push(...tableEl(s.table ?? s, X0, y, tw, th));
    if (s.source) els.push(source(s.source, X0, y + th + 4, X1 - X0));
    if (s.field) els.push(field(s.field, X0 + tw + 16, y, X1 - X0 - tw - 16, th, 18));
    return els;
  },
  async chart(s, _L, top) {
    const els = [];
    const cw = (X1 - X0) * (s.split ?? 0.6);
    const ch = BOTTOM - top - (s.source ? 26 : 0);
    els.push(chartEl(s.chart, X0, top, cw, ch));
    if (s.source) els.push(source(s.source, X0, top + ch + 4, cw));
    const rx = X0 + cw + 18, rw = X1 - rx;
    if (s.field) els.push(field(s.field, rx, top, rw, BOTTOM - top, 18));
    else if (s.callout) {
      const ch2 = useMascot ? (BOTTOM - top) * 0.62 : BOTTOM - top;
      els.push(...cardText(rx, top, rw, ch2, s.callout, { tone: "accent", fs: 20, title: s.calloutTitle, valign: "middle" }));
      els.push(...(await mascotEl("idea", rx + rw / 2 - 70, top + ch2 + 10, Math.min(140, BOTTOM - top - ch2 - 10))));
    }
    return els;
  },
  async cards(s, _L, top) {
    const els = [];
    let y = top;
    if (s.lead) {
      const lw = X1 - X0 - (useMascot ? 100 : 0);
      els.push(text(s.lead, X0, y, lw, 70, 21, { valign: "middle" }), ...(await mascotEl("idea", X1 - 88, y - 4, 84)));
      y += 80;
    }
    const footH = s.footer ? 86 : 0;
    const n = s.cards.length, cols = s.columns ?? (n <= 3 ? n : n === 4 ? 2 : 3), rows = Math.ceil(n / cols), gap = 14;
    const cw = (X1 - X0 - gap * (cols - 1)) / cols, ch = (BOTTOM - y - footH - (footH ? gap : 0) - gap * (rows - 1)) / rows;
    s.cards.forEach((c, i) => {
      const x = X0 + (i % cols) * (cw + gap), yy = y + Math.floor(i / cols) * (ch + gap);
      const k = card(x, yy, cw, ch, c.tone ?? "primary"); const inr = k.inner;
      els.push(...k.els, text(c.title, inr.x, inr.y, inr.w, 38, 24, { bold: true, color: T.accent, min: 16 }));
      const subH = c.sub ? 30 : 0;
      els.push(text(c.body ?? "", inr.x, inr.y + 42, inr.w, inr.h - 42 - subH, s.bodySize ?? 19));
      if (c.sub) els.push(text(c.sub, inr.x, inr.y + inr.h - subH, inr.w, subH, s.subSize ?? 15, { color: T.sub, min: 12 }));
    });
    if (s.footer) els.push(...cardText(X0, BOTTOM - footH, X1 - X0, footH, s.footer, { tone: "accent", fs: 19 }));
    return els;
  },
  async flow(s, _L, top) {
    const els = [];
    let y = top;
    if (s.lead) {
      els.push(text(s.lead, X0, y, X1 - X0 - (useMascot ? 100 : 0), 72, 21, { valign: "middle" }), ...(await mascotEl("idea", X1 - 88, y - 4, 84)));
      y += 86;
    }
    const n = s.items.length, gap = 24, cw = (X1 - X0 - gap * (n - 1)) / n;
    s.items.forEach((it, i) => {
      const x = X0 + i * (cw + gap);
      els.push(...cardText(x, y, cw, 66, it.top, { tone: "primary", fs: 23, bold: true, align: "center" }));
      els.push({ ...rect(x + cw / 2 - 24, y + 72, 48, 42, T.accent, { shape: "downArrow" }) });
      els.push(...cardText(x, y + 120, cw, 66, it.bottom, { tone: "accent", fs: 24, bold: true, align: "center" }));
      if (it.note) els.push(text(it.note, x, y + 192, cw, 40, 22, { align: "center" }));
    });
    if (s.footer) els.push(...cardText(X0, BOTTOM - 76, X1 - X0, 76, s.footer, { tone: "plain", fs: 19 }));
    return els;
  },
  async points(s, _L, top) {
    const els = [];
    const noteH = s.note ? 150 : 0;
    const n = s.items.length, gap = 10, rh = Math.min(64, (BOTTOM - top - noteH - (noteH ? 16 : 0) - gap * (n - 1)) / n);
    s.items.forEach(([k, v], i) => {
      const y = top + i * (rh + gap);
      els.push(...cardText(X0, y, 300, rh, k, { tone: "accent", fs: 19, bold: true, align: "center" }));
      els.push(text(v, X0 + 318, y, X1 - X0 - 318, rh, 19, { valign: "middle" }));
    });
    if (s.note) els.push(...cardText(X0, BOTTOM - noteH, X1 - X0, noteH, s.note.body, { tone: "primary", fs: 17, title: s.note.title, valign: "top" }));
    return els;
  },
  async board(s, _L, top) {
    const els = [...cardText(X0, top, X1 - X0, 48, s.task, { tone: "plain", fs: 20, align: "center" })];
    const n = s.items.length, step = (BOTTOM - top - 64) / n;
    s.items.forEach(([head, body], i) => {
      const y = top + 64 + i * step;
      els.push(text(`○ ${head}`, X0 + 12, y, X1 - X0 - 140, 36, 24, { bold: true }));
      els.push(text(body, X0 + 44, y + 38, X1 - X0 - 180, step - 44, 20, { color: T.accent }));
    });
    els.push(...(await mascotEl("idea", X1 - 104, BOTTOM - 104, 100)));
    return els;
  },
  async fields(s, _L, top) {
    const els = [];
    let y = top;
    if (s.prompt) { els.push(...(await ask(s.prompt, y, s.promptHeight ?? 64))); y += (s.promptHeight ?? 64) + 10; }
    if (s.keywords) { els.push(text(`キーワード：${s.keywords.join("・")}`, X0, y, X1 - X0, 28, 16, { color: T.sub })); y += 32; }
    const fields = s.fields ?? [s.field];
    const gap = 16, each = (X1 - X0 - gap * (fields.length - 1)) / fields.length;
    fields.forEach((f, i) => els.push(field(f, X0 + i * (each + gap), y, each, BOTTOM - y, s.fieldFont ?? 19)));
    return els;
  },
  /** Rubric table (観点 × A/B/C). With selfCheck, one A/B/C self-assessment field per criterion on the right. */
  async rubric(s, L, top) {
    const R = { ...(L.rubric ?? {}), ...(s.rubric ?? {}) };
    if (!R.criteria?.length) throw Error(`ルーブリックの観点（rubric.criteria）がありません: ${L.title}`);
    const levels = R.levels ?? ["A　十分満足できる", "B　おおむね満足できる", "C　努力を要する"];
    const marks = levels.map(l => l.trim().split(/[\s　]/)[0]);
    const els = [];
    let y = top;
    if (s.lead ?? R.lead) {
      els.push(...cardText(X0, y, X1 - X0, 52, s.lead ?? R.lead, { tone: "primary", fs: 18 }));
      y += 60;
    }
    const self = s.selfCheck;
    const tw = self ? (X1 - X0) * (s.split ?? 0.66) : X1 - X0;
    const rows = [["観点", ...levels], ...R.criteria.map(c => [c.name, ...c.levels])];
    els.push(...tableEl({ rows, align: "left", widths: [1.15, ...levels.map(() => 2)], fontSize: s.fontSize ?? R.fontSize ?? (self ? 12 : 16) }, X0, y, tw, BOTTOM - y));
    // Level headers in the accent tone; criterion names bold.
    const tb = els[els.length - 1];
    tb.table.styles = tb.table.styles ?? {};
    // Header row short; criterion rows grow with their longest description.
    const longest = R.criteria.map(c => Math.max(...c.levels.map(v => String(v).length)));
    const avg = longest.reduce((a, b) => a + b, 0) / longest.length;
    tb.table.heights = { r0: 0.45, ...Object.fromEntries(R.criteria.map((_, i) => [`r${i + 1}`, Math.min(2.5, Math.max(0.85, longest[i] / avg))])) };
    tb.table.columns.slice(1).forEach(c => (tb.table.styles[`r0:${c}`] = { fill: T.accentSoft, bold: true, color: "#1d1f23", textAlign: "center" }));
    tb.table.rows.slice(1).forEach(r => (tb.table.styles[`${r}:c0`] = { fill: T.primarySoft, bold: true, color: "#1d1f23" }));
    if (self) {
      const fx = X0 + tw + 14, fw = X1 - fx, n = R.criteria.length, gap = 10, fh = (BOTTOM - y - gap * (n - 1)) / n;
      R.criteria.forEach((c, i) => els.push(field({
        id: c.id ?? `self${i + 1}`, type: "single", label: `自己評価：${c.name}`, options: marks,
        ...(self === "public" ? { public: true } : {}),
      }, fx, y + i * (fh + gap), fw, fh, 16)));
    }
    return els;
  },
  /** Free layout (e.g. a paper worksheet rebuilt on one slide). Items are placed at slide coordinates.
   *  item.type: "field" (worksheet answer field) | "band" (coloured heading strip) | "text" | "card" | "chart" | "table" | "image" | "mascot".
   *  With the normal heading (header not false), keep items below the heading (y ≥ about 100).
   *  Colours may be #rrggbb or a theme key such as "primarySoft". */
  async form(s) {
    const col = c => (c && !c.startsWith("#") ? T[c] : c);
    const els = [];
    for (const it of s.items) {
      const t = it.type ?? (it.field ? "field" : "text");
      if (t === "field") els.push(field(it.field, it.x, it.y, it.w, it.h, it.fontSize ?? s.fieldFont ?? 14, { stroke: col(it.stroke ?? s.stroke) }));
      else if (t === "band") els.push(rect(it.x, it.y, it.w, it.h, col(it.fill) ?? T.primarySoft), text(it.text, it.x + 6, it.y, it.w - 12, it.h, it.fontSize ?? 15, { bold: true, align: it.align ?? "center", valign: "middle", color: col(it.color) ?? T.ink, min: 12 }));
      else if (t === "mascot") els.push(...(await mascotEl(it.pose ?? "idea", it.x, it.y, it.s ?? 48)));
      else if (t === "chart") els.push(chartEl(it.chart, it.x, it.y, it.w, it.h));
      else if (t === "table") els.push(...tableEl(it.table, it.x, it.y, it.w, it.h));
      else if (t === "image") els.push((await figure(it.image, it.x, it.y, it.w, it.h, it.alt)).el);
      else if (t === "card") els.push(...cardText(it.x, it.y, it.w, it.h, it.text, { tone: it.tone ?? "primary", fs: it.fontSize ?? 18, title: it.title, align: it.align, valign: it.valign ?? "top" }));
      else els.push(text(it.text, it.x, it.y, it.w, it.h, it.fontSize ?? 18, { bold: it.bold, align: it.align, valign: it.valign ?? "middle", color: col(it.color) ?? T.ink }));
    }
    return els;
  },
  async custom(s) { return s.elements.map(e => ({ ...e, id: e.id ?? nid("x") })); },
};

// ---------- assemble ----------
const slides = [], sheets = [], routes = [];
const lessons = spec.lessons;
if (!Array.isArray(lessons) || !lessons.length) throw Error("lessons が必要です。");
const multiSheet = layout === "phase-grid" && lessons.length > 1;
if (!multiSheet) sheets.push({ id: "main", name: spec.sheetName ?? spec.title, rowLabels: {} });

for (const [li, L] of lessons.entries()) {
  ws = { deckId: crypto.randomUUID(), worksheetId: crypto.randomUUID(), fields: [], sectionIds: [], section: "" };
  const sheetId = multiSheet ? `lesson-${li + 1}` : "main";
  if (multiSheet) sheets.push({ id: sheetId, name: (L.short ?? L.title).slice(0, 80), rowLabels: {} });
  const sheet = sheets.find(s => s.id === sheetId);
  const lessonSlides = [];
  let col = 0;
  for (const [pi, P] of L.phases.entries()) {
    const row = layout === "lesson-rows" ? li : pi;
    if (layout === "phase-grid") { sheet.rowLabels[String(row)] = P.name; col = 0; }
    else sheet.rowLabels[String(row)] = (L.short ?? L.title).slice(0, 80);
    ws.section = P.name;
    for (const [si, S] of P.slides.entries()) {
      if (!kinds[S.kind]) throw Error(`未知のスライド種類: ${S.kind}`);
      const meta = si === 0 && P.minutes ? `${P.name} ${P.minutes}分` : P.name;
      let els, top = 0;
      if (S.kind === "title") els = await kinds.title(S, L);
      else if (S.header === false) els = await kinds[S.kind](S, L, 0); // the slide draws its own heading
      else {
        const h = header(S.tag ?? P.name, S.heading ?? S.title ?? "", meta);
        top = h.top;
        els = [...h.els, ...(await kinds[S.kind](S, L, top))];
      }
      const slide = {
        id: `L${li + 1}-${row}-${col}`, x: col, y: row, title: (S.title ?? S.heading ?? S.kind).slice(0, 200),
        background: T.bg, elements: els.filter(Boolean),
        ...(sheets.length > 1 || multiSheet ? { sheetId } : {}),
        ...(S.notes ? { speakerNotes: S.notes } : {}),
      };
      slides.push(slide); lessonSlides.push(slide); col++;
    }
  }
  // Worksheet overview at the end of the lesson.
  if (ws.fields.length && (L.worksheet?.summarySlide ?? true)) {
    const row = layout === "lesson-rows" ? li : L.phases.length - 1;
    const sections = ws.sectionIds.map((t, i) => ({ id: `s${i + 1}`, title: t }));
    const h = header("ワークシート", "自分の回答を見直そう", "ふり返り");
    const slide = {
      id: `L${li + 1}-ws`, x: col, y: row, title: "ワークシート全体", background: T.bg,
      ...(multiSheet ? { sheetId } : {}),
      speakerNotes: "各ページの入力欄と同じワークシートの全体表示。提出前の見直しや家庭学習に使う。",
      elements: [...h.els, {
        id: nid("ws"), type: "shape", shape: "rounded", x: X0, y: h.top, w: X1 - X0, h: BOTTOM - h.top, fill: "#ffffff", stroke: T.accent, strokeWidth: 2, formFontSize: 16,
        worksheet: { deckId: ws.deckId, worksheetId: ws.worksheetId, title: (L.worksheet?.title ?? `${L.title} ワークシート`).slice(0, 200), description: L.worksheet?.description ?? "各ページの入力欄と同じ回答です。ここからまとめて見直し・修正できます。", sections, fields: ws.fields },
      }],
    };
    slides.push(slide);
  }
  if (ws.fields.length > 40) throw Error(`1つのワークシートの入力欄は40個までです（${L.title}: ${ws.fields.length}）`);
  routes.push({ id: `route-${li + 1}`, name: (L.routeName ?? `${L.short ?? L.title}（授業の流れ）`).slice(0, 80), slides: lessonSlides.map(s => s.id) });
}

const deck = {
  version: 1, title: spec.title.slice(0, 200), sheets, slides,
  ...(multiSheet ? { activeSheetId: sheets[0].id } : {}),
  routes: routes.slice(0, 30),
};
// VHSlide rejects elements that leave the 960×540 page or are smaller than 20px.
for (const p of slides) for (const e of p.elements)
  if (!(e.x >= 0 && e.x <= W && e.y >= 0 && e.y <= H && e.w >= 20 && e.h >= 20 && e.x + e.w <= W + 0.1 && e.y + e.h <= H + 0.1))
    throw Error(`範囲外の要素: ${p.id} ${e.type} (${e.x},${e.y},${e.w},${e.h})`);
// Every sheet needs a (0,0) page; with slides on sheets, the top level also needs one at (0,0).
for (const s of sheets) if (!slides.some(p => (p.sheetId ?? "main") === s.id && p.x === 0 && p.y === 0)) throw Error(`シート「${s.name}」の左上(0,0)にページがありません。`);
fs.writeFileSync(outPath, JSON.stringify(deck, null, 1));
await closeRenderer();
console.log(`${slides.length}ページ・${sheets.length}シート・レイアウト ${layout}・テーマ ${themeArg ?? (typeof spec.theme === "string" ? spec.theme : "custom")} → ${outPath} (${Math.round(fs.statSync(outPath).size / 1024)}KB)`);
