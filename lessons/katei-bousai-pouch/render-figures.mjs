// Render src/redesign/*.svg to PNG with the skill's renderer.
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const { svgToPng, closeRenderer } = await import(path.join(here, "../../.claude/skills/vhslide-lesson/scripts/render.mjs"));
const dir = path.join(here, "src", "redesign");
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".svg")))
  fs.writeFileSync(path.join(dir, f.replace(".svg", ".png")), await svgToPng(fs.readFileSync(path.join(dir, f), "utf8"), { scale: 1 }));
await closeRenderer();
