// Simple original mascots drawn from basic shapes. Each returns a 260x260 SVG.
// kinds: onigiri | drop | book | sprout | blob     poses: think (?) | idea (!) | happy (♪) | plain
const face = (cx, cy, c, scale = 1) => `
<circle cx="${cx - 30 * scale}" cy="${cy}" r="${9 * scale}" fill="${c.outline}"/>
<circle cx="${cx + 30 * scale}" cy="${cy}" r="${9 * scale}" fill="${c.outline}"/>
<circle cx="${cx - 46 * scale}" cy="${cy + 22 * scale}" r="${10 * scale}" fill="${c.cheek}" opacity=".85"/>
<circle cx="${cx + 46 * scale}" cy="${cy + 22 * scale}" r="${10 * scale}" fill="${c.cheek}" opacity=".85"/>
<path d="M${cx - 18 * scale} ${cy + 22 * scale} Q${cx} ${cy + 38 * scale} ${cx + 18 * scale} ${cy + 22 * scale}" fill="none" stroke="${c.outline}" stroke-width="${5 * scale}" stroke-linecap="round"/>`;

const bodies = {
  onigiri: c => `<path d="M130 22 C175 22 240 150 240 190 C240 232 200 244 130 244 C60 244 20 232 20 190 C20 150 85 22 130 22 Z" fill="${c.body}" stroke="${c.outline}" stroke-width="5"/>
<rect x="62" y="168" width="136" height="76" rx="8" fill="${c.wrap}"/>${face(130, 128, c)}`,
  drop: c => `<path d="M130 18 C160 70 226 120 226 168 C226 222 182 248 130 248 C78 248 34 222 34 168 C34 120 100 70 130 18 Z" fill="${c.body}" stroke="${c.outline}" stroke-width="5"/>
<path d="M70 150 Q66 120 92 96" fill="none" stroke="${c.wrap}" stroke-width="8" stroke-linecap="round" opacity=".5"/>${face(130, 160, c)}`,
  book: c => `<rect x="28" y="46" width="204" height="190" rx="14" fill="${c.wrap}" stroke="${c.outline}" stroke-width="5"/>
<rect x="44" y="40" width="172" height="182" rx="10" fill="${c.body}" stroke="${c.outline}" stroke-width="5"/>
<path d="M70 196 H190 M70 178 H190" stroke="${c.outline}" stroke-width="3" opacity=".2"/>${face(130, 120, c, 0.95)}`,
  sprout: c => `<path d="M130 92 C130 60 130 50 130 40" stroke="${c.wrap}" stroke-width="8" fill="none" stroke-linecap="round"/>
<path d="M130 52 C100 20 64 28 60 46 C80 66 112 66 130 52 Z" fill="${c.wrap}"/><path d="M130 52 C160 20 196 28 200 46 C180 66 148 66 130 52 Z" fill="${c.wrap}"/>
<ellipse cx="130" cy="168" rx="104" ry="80" fill="${c.body}" stroke="${c.outline}" stroke-width="5"/>${face(130, 160, c)}`,
  blob: c => `<path d="M64 76 C92 30 176 26 206 70 C246 96 248 196 206 226 C168 252 92 252 56 224 C14 192 22 104 64 76 Z" fill="${c.body}" stroke="${c.outline}" stroke-width="5"/>${face(130, 140, c)}`,
};
const badge = (fill, mark, size = 40) =>
  `<circle cx="222" cy="44" r="32" fill="${fill}"/><text x="222" y="${44 + size * 0.36}" font-size="${size}" font-weight="700" fill="#fff" text-anchor="middle" font-family="sans-serif">${mark}</text>`;

export const mascotKinds = Object.keys(bodies);
export function mascotSvg(kind = "onigiri", pose = "think", colors) {
  if (!bodies[kind]) throw Error(`キャラクターの種類: ${mascotKinds.join(", ")}`);
  const mark = pose === "think" ? badge(colors.think, "?") : pose === "idea" ? badge(colors.idea, "!") : pose === "happy" ? badge(colors.think, "♪", 34) : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260">${bodies[kind](colors)}${mark}</svg>`;
}
