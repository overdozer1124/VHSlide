// Figures for 「幼い頃の振り返り」 (written next to this script).
import fs from "node:fs";
import path from "node:path";
process.chdir(path.dirname(new URL(import.meta.url).pathname));
const ROSE = "#d97a8c", ROSE_SOFT = "#fde9ee", LEAF = "#5f9e52", LEAF_SOFT = "#ebf5e6", INK = "#3f3a44", SUN = "#ffe27a";
const F = 'font-family="IPAPGothic, sans-serif"';

// ---- webbing example ----
{
  const center = [250, 190];
  const nodes = [["小さい", 110, 70], ["遊ぶ", 250, 50], ["泣く", 395, 75], ["おもちゃ", 415, 200], ["かわいい", 380, 318], ["？", 250, 335], ["？", 105, 310], ["成長", 70, 190]];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="380" ${F}><rect width="100%" height="100%" fill="#ffffff"/>`;
  for (const [, x, y] of nodes) s += `<line x1="${center[0]}" y1="${center[1]}" x2="${x}" y2="${y}" stroke="#c9b8bf" stroke-width="3"/>`;
  s += `<ellipse cx="${center[0]}" cy="${center[1]}" rx="70" ry="42" fill="${ROSE}"/><text x="${center[0]}" y="${center[1] + 11}" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">幼児</text>`;
  for (const [t, x, y] of nodes) {
    const q = t === "？";
    s += `<ellipse cx="${x}" cy="${y}" rx="${q ? 40 : 30 + t.length * 11}" ry="28" fill="${q ? "#ffffff" : LEAF_SOFT}" stroke="${q ? "#c9b8bf" : LEAF}" stroke-width="2.5" ${q ? 'stroke-dasharray="6 5"' : ""}/>`;
    s += `<text x="${x}" y="${y + 8}" font-size="22" fill="${q ? "#a99aa1" : INK}" text-anchor="middle">${t}</text>`;
  }
  s += `<text x="16" y="370" font-size="16" fill="#7a7078">例：中心の言葉から、思いつくことをつなげていく</text>`;
  fs.writeFileSync("webbing.svg", s + "</svg>");
}

// ---- growth timeline ----
{
  const person = (x, base, k, shirt) => {
    const head = 22 * k, bodyH = 60 * k, bodyW = 44 * k;
    return `<rect x="${x - bodyW / 2}" y="${base - bodyH}" width="${bodyW}" height="${bodyH}" rx="${14 * k}" fill="${shirt}"/>` +
      `<circle cx="${x}" cy="${base - bodyH - head + 4}" r="${head}" fill="#fff3e4" stroke="${INK}" stroke-width="2.5"/>` +
      `<path d="M${x - head} ${base - bodyH - head} Q${x} ${base - bodyH - head * 2.3} ${x + head} ${base - bodyH - head}" fill="#5a4a50"/>` +
      `<circle cx="${x - head * 0.38}" cy="${base - bodyH - head * 0.78 + 4}" r="${2.6 * Math.max(1, k * 0.8)}" fill="${INK}"/><circle cx="${x + head * 0.38}" cy="${base - bodyH - head * 0.78 + 4}" r="${2.6 * Math.max(1, k * 0.8)}" fill="${INK}"/>` +
      `<path d="M${x - head * 0.3} ${base - bodyH - head * 0.45} Q${x} ${base - bodyH - head * 0.2} ${x + head * 0.3} ${base - bodyH - head * 0.45}" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`;
  };
  const stages = [
    ["乳児期", "生まれてから\n1歳になるまで", 0.95, ROSE_SOFT, "#f5b7c4"],
    ["幼児期", "1歳から\n小学校入学まで", 1.25, LEAF_SOFT, "#a9d39c"],
    ["児童期", "小学校入学から\n卒業まで", 1.5, "#fff4d6", "#f2cf72"],
    ["いま", "中学生", 1.75, "#e8f1fa", "#9cc3e3"],
  ];
  const W = 900, base = 230;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="360" ${F}><rect width="100%" height="100%" fill="#ffffff"/>`;
  s += `<rect x="30" y="${base + 10}" width="${W - 90}" height="16" rx="8" fill="#eadde2"/><polygon points="${W - 62},${base - 4} ${W - 30},${base + 18} ${W - 62},${base + 40}" fill="#eadde2"/>`;
  stages.forEach(([name, range, k, bg, shirt], i) => {
    const cx = 120 + i * 215;
    s += `<rect x="${cx - 95}" y="30" width="190" height="${base - 30}" rx="18" fill="${bg}"/>`;
    s += person(cx, base, k, shirt);
    s += `<text x="${cx}" y="${base + 66}" font-size="28" font-weight="700" fill="${i === 3 ? "#4a78a8" : INK}" text-anchor="middle">${name}</text>`;
    range.split("\n").forEach((l, j) => (s += `<text x="${cx}" y="${base + 96 + j * 24}" font-size="19" fill="#5d555b" text-anchor="middle">${l}</text>`));
  });
  fs.writeFileSync("growth.svg", s + "</svg>");
}
console.log("ok");
