// 図3に相当する図：1回に食べやすい量の「かさ」の変化（written next to this script）
import fs from "node:fs";
import path from "node:path";
process.chdir(path.dirname(new URL(import.meta.url).pathname));
const F = 'font-family="IPAPGothic, sans-serif"', INK = "#24324a";
const bowl = (cx, cy, r) => `<path d="M${cx - r} ${cy} Q${cx} ${cy + r * 1.1} ${cx + r} ${cy} Z" fill="#ffffff" stroke="#9aa6b8" stroke-width="3"/>`;
const leaves = (cx, cy, n, s, fill) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, d = (i % 3) * s * 0.35; return `<ellipse cx="${cx + Math.cos(a) * d}" cy="${cy + Math.sin(a) * d * 0.5}" rx="${s * 0.55}" ry="${s * 0.28}" transform="rotate(${(i * 47) % 180} ${cx + Math.cos(a) * d} ${cy + Math.sin(a) * d * 0.5})" fill="${fill}" stroke="#1f5a2c" stroke-width="1.5"/>`; }).join("");
const arrow = (x, y, t) => `<path d="M${x} ${y} v40" stroke="#ff5c8a" stroke-width="6"/><polygon points="${x - 12},${y + 36} ${x + 12},${y + 36} ${x},${y + 56}" fill="#ff5c8a"/><text x="${x + 22}" y="${y + 34}" font-size="20" fill="${INK}">${t}</text>`;
let s = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="400" ${F}><rect width="100%" height="100%" fill="#ffffff"/>`;
// わかめ
s += `<text x="140" y="34" font-size="22" font-weight="700" fill="${INK}" text-anchor="middle">カットわかめ 1.7g</text>`;
s += bowl(140, 110, 46) + leaves(140, 104, 5, 14, "#2b3b2f");
s += arrow(140, 160, "水で戻すと");
s += bowl(140, 300, 78) + leaves(140, 282, 22, 30, "#3f6b3a");
s += `<text x="140" y="378" font-size="19" fill="${INK}" text-anchor="middle">かさがずいぶん増える</text>`;
// こまつな
s += `<text x="420" y="34" font-size="22" font-weight="700" fill="${INK}" text-anchor="middle">こまつな 50g</text>`;
s += `<g>${leaves(420, 96, 18, 34, "#5aa74d")}</g>`;
s += arrow(420, 160, "ゆでると");
s += bowl(420, 300, 60) + leaves(420, 290, 10, 22, "#3d8a36");
s += `<text x="420" y="378" font-size="19" fill="${INK}" text-anchor="middle">かさが減って食べやすい</text>`;
s += `<line x1="280" y1="20" x2="280" y2="390" stroke="#e3e7ee" stroke-width="2" stroke-dasharray="6 6"/>`;
fs.writeFileSync("kasa.svg", s + "</svg>");
console.log("ok");

// 図1に相当：精白米ととり肉（もも）の成分（可食部100gあたり、g）
{
  const W = "#9cc3e3", C = "#ffb000", P = "#ff5c8a", L = "#20c997", O = "#c5cfdc";
  const donut = (cx, cy, title, parts) => {
    const R = 100, r = 52, total = parts.reduce((a, p) => a + p[1], 0);
    let a0 = -Math.PI / 2, out = `<text x="${cx}" y="${cy - R - 22}" font-size="24" font-weight="700" fill="${INK}" text-anchor="middle">${title}</text>`;
    parts.forEach(([name, v, col], i) => {
      const a1 = a0 + (v / total) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad, a) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
      out += `<path d="M${p(R, a0)} A${R} ${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r} ${r} 0 ${large} 0 ${p(r, a0)} Z" fill="${col}" stroke="#fff" stroke-width="2"/>`;
      const am = (a0 + a1) / 2, big = v / total > 0.08;
      if (big) out += `<text x="${cx + (R + r) / 2 * Math.cos(am)}" y="${cy + (R + r) / 2 * Math.sin(am) + 6}" font-size="17" font-weight="700" fill="#24324a" text-anchor="middle">${v}</text>`;
      a0 = a1;
    });
    // legend at right
    parts.forEach(([name, v, col], i) => {
      const y = cy - 66 + i * 34;
      out += `<rect x="${cx + R + 26}" y="${y - 15}" width="18" height="18" rx="3" fill="${col}"/><text x="${cx + R + 52}" y="${y}" font-size="19" fill="${INK}">${name}　${v}</text>`;
    });
    return out;
  };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="290" ${F}><rect width="100%" height="100%" fill="#ffffff"/>`;
  s += donut(140, 160, "精白米", [["炭水化物", 77.6, C], ["水分", 14.9, W], ["たんぱく質", 6.1, P], ["脂質", 0.9, L], ["その他", 0.5, O]]);
  s += donut(590, 160, "とり肉（もも）", [["水分", 62.9, W], ["脂質", 19.1, L], ["たんぱく質", 17.3, P], ["その他", 0.7, O]]);
  s += `<text x="890" y="282" font-size="15" fill="#5d6b82" text-anchor="end">単位：g（可食部100gあたり）</text>`;
  fs.writeFileSync("seibun.svg", s + "</svg>");
}
