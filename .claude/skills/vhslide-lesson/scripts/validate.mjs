#!/usr/bin/env node
// Offline validation with VHSlide's own parser, bundled in scripts/vendor (no repository or browser needed).
// usage: node validate.mjs <deck.json>
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const deckPath = process.argv[2];
if (!deckPath) { console.error("usage: node validate.mjs <deck.json>"); process.exit(2); }
const { parseDeck, collectForeignForms } = await import(path.join(here, "vendor", "vhslide-parse.mjs"));
const ver = JSON.parse(fs.readFileSync(path.join(here, "vendor", "version.json"), "utf8"));
try {
  const deck = parseDeck(fs.readFileSync(deckPath, "utf8"));
  const plan = collectForeignForms(deck, "00000000-0000-4000-8000-000000000000");
  const bound = new Set(deck.slides.flatMap(s => s.elements).filter(e => e.responseField?.source === "worksheet" || e.worksheet).map(e => e.responseField?.worksheetId ?? e.worksheet.worksheetId));
  if (bound.size !== plan.worksheets.length) throw Error("引き継げないワークシートがあります（入力欄の設定を確認）");
  console.log(`読み込み検査（VHSlide ${ver.version} の検査処理）: OK ${deck.slides.length}ページ・ワークシート ${plan.worksheets.map(w => `${w.definition.title}（${w.definition.fields.length}項目）`).join("、") || "なし"}`);
} catch (e) {
  console.log(`読み込み検査（VHSlide ${ver.version} の検査処理）: 失敗 — ${e.message}`);
  process.exit(1);
}
