#!/usr/bin/env node
// Re-bundle VHSlide's parser into scripts/vendor from a VHSlide checkout (newest version recommended).
// usage: node update-vendor.mjs <vhslide checkout>
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const app = path.resolve(process.argv[2] ?? "");
if (!fs.existsSync(path.join(app, "src", "model.ts"))) { console.error("usage: node update-vendor.mjs <vhslide checkout>"); process.exit(2); }
const here = path.dirname(new URL(import.meta.url).pathname);
const entry = path.join(app, "__vhslide_lesson_entry.ts");
const forms = fs.existsSync(path.join(app, "src", "formAdoption.ts"));
fs.writeFileSync(entry, `export { parseDeck } from "./src/model";\n${forms ? 'export { collectForeignForms } from "./src/formAdoption";\n' : "export const collectForeignForms = () => ({ worksheets: [], surveys: [] });\n"}`);
const out = path.join(here, "vendor", "vhslide-parse.mjs");
const version = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8")).version;
let commit = "";
try { commit = execSync("git rev-parse --short HEAD", { cwd: app }).toString().trim(); } catch {}
try {
  execSync(`npx esbuild "${entry}" --bundle --platform=neutral --format=esm --target=es2022 --log-level=error --outfile="${out}.tmp"`, { cwd: app, stdio: "inherit" });
  fs.writeFileSync(out, `// Bundled from VHSlide ${version} (${commit}): parseDeck and worksheet adoption.\n// Regenerate with: node scripts/update-vendor.mjs <vhslide checkout>\n` + fs.readFileSync(`${out}.tmp`, "utf8"));
  fs.writeFileSync(path.join(here, "vendor", "version.json"), JSON.stringify({ version, commit }) + "\n");
  console.log(`検査処理を VHSlide ${version} に更新しました。`);
} finally { fs.rmSync(entry, { force: true }); fs.rmSync(`${out}.tmp`, { force: true }); }
