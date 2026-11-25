#!/usr/bin/env node
// Pre-render the mascots for every preset theme, so the skill works where no SVG renderer exists.
import fs from "node:fs";
import path from "node:path";
import { themes } from "./themes.mjs";
import { mascotSvg, mascotKinds } from "./mascot.mjs";
import { svgToPng, closeRenderer } from "./render.mjs";
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "assets", "mascots");
fs.mkdirSync(dir, { recursive: true });
for (const [name, t] of Object.entries(themes))
  for (const kind of mascotKinds)
    for (const pose of ["think", "idea", "happy"])
      fs.writeFileSync(path.join(dir, `${name}-${kind}-${pose}.png`), await svgToPng(mascotSvg(kind, pose, t.mascot), { scale: 1.2, transparent: true }));
await closeRenderer();
