#!/usr/bin/env node
// Bundle the browser converter into one offline HTML file.
// usage: node gemini/build-converter.mjs [out.html]   (needs esbuild: npx downloads it, or set ESBUILD=path)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.resolve(process.argv[2] ?? path.join(here, "dist", "vhslide-converter.html"));
fs.mkdirSync(path.dirname(out), { recursive: true });
const tmp = out + ".js";
const esbuild = process.env.ESBUILD;
const argv = [path.join(here, "converter", "main.mjs"), "--bundle", "--format=iife", "--minify", "--target=es2020", "--log-level=warning", `--outfile=${tmp}`];
if (esbuild) execFileSync(esbuild, argv, { stdio: "inherit" });
else execFileSync("npx", ["--yes", "esbuild@0.25.0", ...argv], { stdio: "inherit" });
const js = fs.readFileSync(tmp, "utf8").replace(/<\/script/gi, "<\\/script");
fs.rmSync(tmp);
const html = fs.readFileSync(path.join(here, "converter", "page.html"), "utf8").replace("<script>/*APP*/</script>", () => `<script>${js}</script>`);
fs.writeFileSync(out, html);
console.log(`${out} (${Math.round(fs.statSync(out).size / 1024)}KB)`);
