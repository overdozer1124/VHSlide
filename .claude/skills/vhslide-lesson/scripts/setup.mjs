#!/usr/bin/env node
// 初回セットアップ：環境をチェックし、（--fix 指定時だけ）不足分をスキル内に用意して、試運転まで行う。
// 使い方:
//   node scripts/setup.mjs          … チェックのみ（何も変更しない）
//   node scripts/setup.mjs --fix    … 不足分を導入する（実行前に利用者の承認を得ること。SKILL.md「初回セットアップ」参照）
// Node.js 自体が無い環境ではこのスクリプトも動かない。その場合は SKILL.md の手順で
// ポータブル版 Node を .runtime/node に入れ、その node でこのスクリプトを実行する。
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SKILL = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FIX = process.argv.includes("--fix");
const VENV = path.join(SKILL, ".venv-svg");
const VENV_PY = os.platform() === "win32" ? path.join(VENV, "Scripts", "python.exe") : path.join(VENV, "bin", "python");
const MARKER = path.join(SKILL, ".setup-done.json");

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 600000 });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
};
const hasPyModule = (py, mod) => run(py, ["-c", `import ${mod}`]).ok;

const report = { node: process.version, python3: false, pillow: false, renderer: null, smoke: null };
const notes = [];

// --- チェック ---
report.python3 = run("python3", ["--version"]).ok;
report.pillow = report.python3 && hasPyModule("python3", "PIL");
if (run("rsvg-convert", ["--version"]).ok) report.renderer = "rsvg-convert";
else if (report.python3 && hasPyModule("python3", "cairosvg")) report.renderer = "cairosvg (system python)";
else if (fs.existsSync(VENV_PY) && hasPyModule(VENV_PY, "cairosvg")) report.renderer = "cairosvg (.venv-svg)";
if (fs.existsSync(VENV_PY) && hasPyModule(VENV_PY, "PIL")) report.pillow = true;

// --- 導入（--fix のときだけ） ---
if (FIX && !report.renderer) {
  if (!report.python3) {
    notes.push("python3 が無いため、描画手段を用意できませんでした。Python 3 のある環境で使ってください。");
  } else {
    console.log("描画手段（cairosvg）と画像圧縮（Pillow）をスキル内の .venv-svg に入れます…");
    if (!fs.existsSync(VENV_PY)) run("python3", ["-m", "venv", VENV]);
    const pip = run(VENV_PY, ["-m", "pip", "install", "--quiet", "cairosvg", "pillow"]);
    if (pip.ok && hasPyModule(VENV_PY, "cairosvg")) { report.renderer = "cairosvg (.venv-svg)"; report.pillow = true; }
    else notes.push("cairosvg の導入に失敗しました（ネット接続を確認してください）。背景なしでも作れます。");
  }
}

// --- 試運転：サンプルを組み立てて、背景が入るかと検証を確認 ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vhslide-setup-"));
const outFile = path.join(tmp, "smoke.vhslide.json");
const build = run(process.execPath, [path.join(SKILL, "scripts", "build-deck.mjs"),
  path.join(SKILL, "examples", "nutrition.spec.json"), outFile,
  "--layout", "lesson-rows", "--theme", "natural"]);
if (build.ok && fs.existsSync(outFile)) {
  const deck = fs.readFileSync(outFile, "utf8");
  const backgrounds = (deck.match(/data:image\/(jpeg|webp|png)/g) || []).length;
  const val = run(process.execPath, [path.join(SKILL, "scripts", "validate.mjs"), outFile]);
  report.smoke = { build: true, validate: val.ok, backgroundPages: backgrounds };
  if (!backgrounds) notes.push("試運転のデッキに背景が入りませんでした（描画手段の問題）。");
  if (!val.ok) notes.push("試運転のデッキが読み込み検査に合格しませんでした。");
} else {
  report.smoke = { build: false };
  notes.push("試運転のビルドに失敗しました: " + build.out.slice(0, 300));
}
fs.rmSync(tmp, { recursive: true, force: true });

// --- まとめ ---
const ready = report.smoke?.build && report.smoke?.validate;
if (FIX && ready) {
  fs.writeFileSync(MARKER, JSON.stringify({ date: new Date().toISOString(), ...report }, null, 1));
}
console.log("=== vhslide-lesson セットアップ確認 ===");
console.log(`Node.js: ${report.node}（このスクリプトを実行中）`);
console.log(`Python 3: ${report.python3 ? "あり" : "なし"}`);
console.log(`画像の描画（背景・図）: ${report.renderer ?? "なし（背景は出ません）"}`);
console.log(`画像圧縮 Pillow（挿絵用）: ${report.pillow ? "あり" : "なし（挿絵の圧縮はできません）"}`);
console.log(`試運転: ビルド ${report.smoke?.build ? "OK" : "失敗"} / 検証 ${report.smoke?.validate ? "OK" : "失敗"} / 背景の入ったページ ${report.smoke?.backgroundPages ?? 0}`);
for (const n of notes) console.log("※ " + n);
console.log(ready
  ? (report.renderer ? "SETUP: OK（背景まで使えます）" : "SETUP: OK（ただし背景なし）")
  : "SETUP: 未完了（上の注意を確認してください）");
process.exit(ready ? 0 : 1);
