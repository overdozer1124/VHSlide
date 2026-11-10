#!/usr/bin/env node
// Validate a deck JSON against the newest VHSlide source and capture every page as the app renders it.
// usage: node check.mjs <deck.json> [--out <dir>] [--app <vhslide checkout>] [--no-shots]
//   1. finds the newest VHSlide version among the remote branches (by package.json version) unless --app is given;
//      without any VHSlide source it falls back to validate.mjs (bundled parser, no screenshots)
//   2. parses the JSON with that version's parseDeck and runs the worksheet adoption that cloud saving uses
//   3. opens the JSON in the app, reads the 表示チェック (fit check) dialog, and screenshots each page
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const deckPath = path.resolve(args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--") ) ?? "");
if (!fs.existsSync(deckPath)) { console.error("usage: node check.mjs <deck.json> [--out dir] [--app dir] [--no-shots]"); process.exit(2); }
const outDir = path.resolve(opt("out") ?? path.join(path.dirname(deckPath), path.basename(deckPath, ".json") + "-check"));
fs.mkdirSync(outDir, { recursive: true });
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const semver = v => v.split(".").map(Number);
const newer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

// ---------- 1. locate the newest app source ----------
// Where to look, in order: --app, the git repository of the current folder or of this skill (if it is VHSlide),
// $VHSLIDE_REPO, then a cached clone of $VHSLIDE_GIT_URL (default: the VHSlide GitHub repository).
const cacheRoot = process.env.VHSLIDE_LESSON_CACHE ?? path.join(os.homedir(), ".cache", "vhslide-lesson");
const isVhslide = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).name?.toLowerCase().includes("vhslide") || fs.existsSync(path.join(dir, "src", "model.ts")); } catch { return false; } };
function findRepo() {
  const skillDir = path.dirname(new URL(import.meta.url).pathname);
  for (const dir of [process.cwd(), skillDir]) {
    try { const top = sh("git rev-parse --show-toplevel", dir); if (isVhslide(top)) return top; } catch {}
  }
  if (process.env.VHSLIDE_REPO && fs.existsSync(process.env.VHSLIDE_REPO)) return path.resolve(process.env.VHSLIDE_REPO);
  const clone = path.join(cacheRoot, "repo");
  if (fs.existsSync(path.join(clone, ".git"))) return clone;
  const url = process.env.VHSLIDE_GIT_URL ?? "https://github.com/overdozer1124/VHSlide.git";
  try {
    fs.mkdirSync(cacheRoot, { recursive: true });
    console.log(`VHSlide のソースを取得しています（初回のみ）: ${url}`);
    execSync(`git clone --quiet --no-checkout --filter=blob:none "${url}" "${clone}"`, { stdio: "ignore" });
    return clone;
  } catch { return undefined; }
}
function findApp() {
  if (opt("app")) return path.resolve(opt("app"));
  const repo = findRepo();
  if (!repo) return undefined;
  try { sh("git fetch --quiet origin", repo); } catch { console.warn("※ git fetch に失敗。手元の情報で最新版を判断します。"); }
  let best;
  for (const ref of sh("git for-each-ref '--format=%(refname)' refs/remotes/origin refs/heads", repo).split("\n")) {
    if (!ref || ref.endsWith("/HEAD")) continue;
    let pkg;
    try { pkg = JSON.parse(sh(`git show ${ref}:package.json`, repo)); } catch { continue; }
    try { sh(`git cat-file -e ${ref}:src/model.ts`, repo); } catch { continue; }
    if (!best || newer(pkg.version, best.version)) best = { ref, version: pkg.version, sha: sh(`git rev-parse ${ref}`, repo) };
  }
  if (!best) return undefined;
  const dir = path.join(cacheRoot, "app", best.sha.slice(0, 12));
  if (!fs.existsSync(path.join(dir, "package.json"))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    sh(`git worktree add --force --detach "${dir}" ${best.sha}`, repo);
  }
  console.log(`VHSlide ${best.version}（${best.ref.replace("refs/remotes/", "").replace("refs/heads/", "")}）で確認します。`);
  return dir;
}
const app = findApp();
if (!app) {
  // No source reachable (e.g. claude.ai): fall back to the parser bundled with this skill.
  console.log("VHSlide のソースに接続できないため、同梱の検査処理で確認します（画面の撮影は省略）。");
  try { execSync(`node "${path.join(path.dirname(new URL(import.meta.url).pathname), "validate.mjs")}" "${deckPath}"`, { stdio: "inherit" }); }
  catch { process.exit(1); }
  process.exit(0);
}
try {
  if (!fs.existsSync(path.join(app, "node_modules", "vitest"))) {
    console.log("依存パッケージを準備しています（初回のみ）…");
    execSync("npm ci --ignore-scripts --no-audit --no-fund", { cwd: app, stdio: "inherit" });
  }
  // Keep the bundled offline parser in step with the newest app.
  execSync(`node "${path.join(path.dirname(new URL(import.meta.url).pathname), "update-vendor.mjs")}" "${app}"`, { stdio: "ignore" });
} catch (e) { console.warn("※ 依存パッケージの準備に失敗しました:", e.message); }

// ---------- 2. parse + worksheet adoption ----------
const testFile = path.join(app, "src", "__lesson_check.test.ts");
fs.writeFileSync(testFile, `
import { it } from "vitest";
import fs from "node:fs";
import { parseDeck } from "./model";
${fs.existsSync(path.join(app, "src", "formAdoption.ts")) ? 'import { collectForeignForms } from "./formAdoption";' : "const collectForeignForms = undefined;"}
it("lesson deck", () => {
  const deck = parseDeck(fs.readFileSync(process.env.LESSON_DECK!, "utf8"));
  const report: Record<string, unknown> = { slides: deck.slides.length, sheets: deck.sheets?.length ?? 1 };
  if (collectForeignForms) {
    const plan = collectForeignForms(deck, "00000000-0000-4000-8000-000000000000");
    report.worksheets = plan.worksheets.map(w => ({ title: w.definition.title, fields: w.definition.fields.length }));
    const bound = new Set(deck.slides.flatMap(s => s.elements).filter(e => e.responseField?.source === "worksheet" || e.worksheet).map(e => (e.responseField as any)?.worksheetId ?? e.worksheet!.worksheetId));
    if (bound.size !== plan.worksheets.length) throw Error("引き継げないワークシートがあります（入力欄の設定を確認）");
  } else report.worksheets = "この版にはワークシートの引き継ぎ機能がありません";
  fs.writeFileSync(process.env.LESSON_REPORT!, JSON.stringify(report));
});
`);
const reportFile = path.join(outDir, "parse.json");
let parseOk = true;
try {
  execSync(`npx vitest run src/__lesson_check.test.ts`, { cwd: app, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LESSON_DECK: deckPath, LESSON_REPORT: reportFile } });
  console.log("読み込み検査: OK", fs.readFileSync(reportFile, "utf8"));
} catch (e) {
  parseOk = false;
  const out = (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "");
  console.log("読み込み検査: 失敗\n" + out.split("\n").filter(l => /Error|❯ |expected|at .*model\.ts/.test(l)).slice(0, 20).join("\n"));
} finally { fs.rmSync(testFile, { force: true }); }
if (!parseOk || args.includes("--no-shots")) process.exit(parseOk ? 0 : 1);

// ---------- 3. render in the app ----------
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(sh("npm root -g") + "/playwright"); }
const port = 5300 + Math.floor(Math.random() * 400);
const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: app, stdio: "ignore", detached: true });
const stop = () => { try { process.kill(-vite.pid); } catch {} };
process.on("exit", stop);
const deck = JSON.parse(fs.readFileSync(deckPath, "utf8"));
const browser = await pw.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  for (let i = 0; ; i++) {
    try { await page.goto(`http://localhost:${port}/`); break; } catch { if (i > 60) throw Error("アプリを起動できません"); await new Promise(r => setTimeout(r, 500)); }
  }
  await page.waitForTimeout(1500);
  // The "open file" input accepts JSON and PowerPoint; other inputs (append rows, images…) come and go between versions.
  const opener = page.locator('input[type="file"][accept*=".json"][accept*=".pptx"]').or(page.locator('input[type="file"][accept*=".json"]')).first();
  // Non-ASCII file names do not reach the page reliably through Playwright, so open an ASCII-named copy.
  const asciiCopy = path.join(outDir, "deck-under-check.json");
  fs.copyFileSync(deckPath, asciiCopy);
  await opener.setInputFiles(asciiCopy);
  await page.waitForTimeout(2000);
  const loadedTitle = await page.title().catch(() => "");
  const headerText = await page.locator("body").innerText();
  if (!headerText.includes(deck.title.slice(0, 12)) && !loadedTitle.includes(deck.title.slice(0, 12)))
    throw Error("アプリでJSONを開けませんでした（ファイルの読み込み口が変わった可能性があります）。check.mjs の opener を確認してください。");
  await page.addStyleTag({ content: ".toast{display:none!important}" });
  const sheets = deck.sheets ?? [{ id: "main", name: "" }];
  const shots = [];
  let fitText = "";
  for (const sheet of sheets) {
    if (sheets.length > 1) { await page.getByRole("tab", { name: sheet.name }).first().click(); await page.waitForTimeout(800); }
    const mine = deck.slides.filter(s => (s.sheetId ?? "main") === sheet.id);
    const rows = [...new Set(mine.map(s => s.y))].sort((a, b) => a - b);
    for (const y of rows) {
      await page.getByRole("button", { name: "発表する" }).first().click();
      await page.waitForTimeout(1200);
      const dialog = page.getByRole("dialog").filter({ hasText: "表示チェック" });
      if (await dialog.count()) {
        if (!fitText) fitText = await dialog.first().innerText();
        await dialog.getByRole("button", { name: "このまま進む" }).click();
        await page.waitForTimeout(1000);
      }
      for (let i = 0; i < y; i++) { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(450); }
      const cols = mine.filter(s => s.y === y).map(s => s.x).sort((a, b) => a - b);
      for (const [k, x] of cols.entries()) {
        if (k > 0) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(650); }
        const file = path.join(outDir, `${sheets.length > 1 ? sheet.id + "_" : ""}r${y}_c${x}.png`);
        await page.mouse.move(1279, 360);
        await page.screenshot({ path: file });
        shots.push(file);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
    }
  }
  // Contact sheets (6 pages each) for a quick visual review.
  const sheetsOut = [];
  for (let i = 0; i < shots.length; i += 6) {
    const imgs = shots.slice(i, i + 6).map(f => `<figure><img src="data:image/png;base64,${fs.readFileSync(f).toString("base64")}"><figcaption>${path.basename(f, ".png")}</figcaption></figure>`).join("");
    await page.setViewportSize({ width: 1300, height: 1140 });
    await page.setContent(`<style>body{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px;background:#ddd;font:14px sans-serif}figure{margin:0}img{width:100%;display:block}figcaption{padding:2px 4px}</style>${imgs}`);
    const f = path.join(outDir, `contact-${i / 6 + 1}.png`);
    await page.screenshot({ path: f, fullPage: true });
    sheetsOut.push(f);
  }
  const fitIssues = fitText ? fitText.split("\n").filter(l => /：全文|見切れ|省略/.test(l)) : [];
  fs.rmSync(asciiCopy, { force: true });
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ fitIssues, errors, shots: shots.length, contact: sheetsOut }, null, 1));
  console.log(fitIssues.length ? `表示チェック: 要修正\n${fitIssues.join("\n")}` : "表示チェック: 見切れなし");
  if (errors.length) console.log("画面のエラー:", errors.slice(0, 5).join(" / "));
  console.log(`撮影 ${shots.length}ページ → ${outDir}\n一覧: ${sheetsOut.join(", ")}`);
  process.exitCode = fitIssues.length ? 1 : 0;
} finally {
  await browser.close();
  stop();
}
