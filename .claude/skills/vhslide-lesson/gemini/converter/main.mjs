// Browser converter: lesson spec JSON (written by the Gemini Gem) → VHSlide deck JSON.
// Bundled into one offline HTML file by gemini/build-converter.mjs.
import { buildDeck } from "../../scripts/deck-core.mjs";
import { themes } from "../../scripts/themes.mjs";
import { mascotKinds } from "../../scripts/mascot.mjs";
import { parseDeck, collectForeignForms } from "../../scripts/vendor/vhslide-parse.mjs";

const $ = id => document.getElementById(id);
const uploads = new Map(); // file name (lower case) → data URL

// ---------- browser I/O for the shared builder ----------
const loadEl = src => new Promise((ok, ng) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ng(Error("画像を読み込めませんでした")); im.src = src; });
const io = {
  async svgToDataUrl(svg, o = {}) {
    const head = svg.slice(0, svg.indexOf(">") + 1);
    const w = Number(/\bwidth=["'](\d+(?:\.\d+)?)/.exec(head)?.[1]), h = Number(/\bheight=["'](\d+(?:\.\d+)?)/.exec(head)?.[1]);
    if (!w || !h) throw Error("SVGに width / height 属性が必要です。");
    const scale = o.scale ?? 2;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const im = await loadEl(url);
      const c = document.createElement("canvas");
      c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
      const g = c.getContext("2d");
      if (o.type === "jpeg" || !o.transparent) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(im, 0, 0, c.width, c.height);
      return o.type === "jpeg" ? c.toDataURL("image/jpeg", (o.quality ?? 82) / 100) : c.toDataURL("image/png");
    } finally { URL.revokeObjectURL(url); }
  },
  async loadImage(ref) {
    let src = ref;
    if (!ref.startsWith("data:")) {
      const name = ref.split(/[\\/]/).pop().toLowerCase();
      src = uploads.get(name) ?? uploads.get(ref.toLowerCase());
      if (!src) throw Error(`画像「${ref}」が見つかりません。「画像ファイル」に ${name} を追加してください。`);
    }
    const im = await loadEl(src);
    return { src, w: im.naturalWidth || 16, h: im.naturalHeight || 9 };
  },
};

// ---------- reading what the Gem wrote ----------
/** Accepts a whole Gem reply: one or more ```json blocks, or bare JSON objects one after another. */
function extractSpecs(text) {
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]);
  const sources = blocks.length ? blocks : [text];
  const out = [];
  for (const src of sources) {
    const t = src.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); continue; } catch {}
    // several objects pasted one after another
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") { if (depth++ === 0) start = i; }
      else if (ch === "}" && --depth === 0) {
        const piece = t.slice(start, i + 1);
        try { out.push(JSON.parse(piece)); } catch (e) { throw Error(`JSONの書き方に誤りがあります（${e.message}）。Gemに「JSONの文法を直して」と伝えてください。`); }
      }
    }
  }
  if (!out.length) throw Error("レッスン仕様のJSONが見つかりません。Gemの返答（```json で始まる部分）を貼り付けてください。");
  return out;
}
/** Merge a spec split over several replies: later parts add lessons (or phases to the last lesson). */
function mergeSpecs(parts) {
  const base = structuredClone(parts.find(p => p.title) ?? parts[0]);
  base.lessons = base.lessons ?? [];
  for (const p of parts) {
    if (p === parts.find(q => q.title)) continue;
    if (p.lessons) base.lessons.push(...p.lessons);
    else if (p.phases && base.lessons.length) base.lessons.at(-1).phases.push(...p.phases);
    for (const k of ["theme", "layout", "mascot", "decor"]) if (p[k] !== undefined && base[k] === undefined) base[k] = p[k];
  }
  return base;
}

/** VHSlide's check names the problem but not the page: try each page alone to find which one it is. */
function findBadSlide(deck) {
  for (const slide of deck.slides) {
    const one = { ...deck, sheets: [{ ...deck.sheets[0], id: "main" }], activeSheetId: undefined, routes: [],
      slides: [{ ...slide, x: 0, y: 0, sheetId: undefined }] };
    try { parseDeck(JSON.stringify(one)); }
    catch { return `原因のページ：「${slide.title}」`; }
  }
  return "原因のページは特定できませんでした";
}

// ---------- UI ----------
function fillSelect(sel, items, def) {
  sel.innerHTML = "";
  for (const [v, label] of items) { const o = document.createElement("option"); o.value = v; o.textContent = label; sel.append(o); }
  sel.value = def;
}
fillSelect($("theme"), [["", "Gemの指定どおり"], ...Object.entries(themes).map(([k, t]) => [k, `${k}：${t.label}`])], "");
fillSelect($("mascot"), [["", "Gemの指定どおり"], ...mascotKinds.map(k => [k, k]), ["none", "なし"]], "");

$("specFile").addEventListener("change", async e => {
  const f = e.target.files[0]; if (f) $("spec").value = await f.text();
});
$("images").addEventListener("change", async e => {
  for (const f of e.target.files) {
    const url = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
    uploads.set(f.name.toLowerCase(), url);
  }
  $("imageList").textContent = uploads.size ? `追加済み：${[...uploads.keys()].join("、")}` : "";
});

let lastBlob, lastName;
function status(kind, text) { const s = $("status"); s.className = `status ${kind}`; s.textContent = text; }
$("build").addEventListener("click", async () => {
  $("download").disabled = true; $("copyFix").hidden = true;
  status("busy", "作成しています…（背景やキャラクターを描くため、数秒〜数十秒かかります）");
  await new Promise(r => setTimeout(r, 30));
  try {
    const spec = mergeSpecs(extractSpecs($("spec").value));
    const warnings = [];
    const deck = await buildDeck(spec, {
      io, warn: (...a) => warnings.push(a.join(" ")),
      theme: $("theme").value || undefined, layout: $("layout").value || undefined,
      mascot: $("mascot").value || undefined, flat: !$("decor").checked,
    });
    const json = JSON.stringify(deck);
    let parsed;
    try { parsed = parseDeck(json); } // the same check VHSlide runs when it opens a file
    catch (e) { throw Error(`${e.message}（${findBadSlide(deck)}）`); }
    const forms = collectForeignForms(parsed, "00000000-0000-4000-8000-000000000000");
    lastBlob = new Blob([json], { type: "application/json" });
    lastName = `${String(spec.title).replace(/[\\/:*?"<>|（）()　\s]+/g, "_").slice(0, 40)}.vhslide.json`;
    $("download").disabled = false;
    status("ok", `できました：${deck.slides.length}ページ・ワークシート${forms.worksheets.length}個（入力欄 ${forms.worksheets.reduce((n, w) => n + w.definition.fields.length, 0)}個）・${Math.round(lastBlob.size / 1024)}KB。VHSlideの読み込み検査にも通りました。` + (warnings.length ? `\n注意：${warnings.join(" ／ ")}` : ""));
  } catch (e) {
    status("error", `作れませんでした：${e.message}`);
    $("copyFix").hidden = false;
    $("copyFix").onclick = () => navigator.clipboard.writeText(`変換ページで次のエラーが出ました。レッスン仕様JSONを直して、全体をもう一度出力してください。\n${e.message}`).then(() => { $("copyFix").textContent = "コピーしました"; setTimeout(() => ($("copyFix").textContent = "Gemへの修正依頼をコピー"), 2000); });
  }
});
$("download").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(lastBlob); a.download = lastName; a.style.display = "none";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
