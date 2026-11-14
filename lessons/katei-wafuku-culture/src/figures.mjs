// Figures for 「日本の衣服の文化」. Writes SVG files next to this script (rendered to PNG by build-deck.mjs).
import fs from "node:fs";
import path from "node:path";
process.chdir(path.dirname(new URL(import.meta.url).pathname)); // write the SVGs next to this script
const AI = "#243b63", SHU = "#c4473a", KIN = "#c9a227", MIDORI = "#3a7d5c", KINARI = "#fbf7ee", INK = "#1f2a3a";
const F = 'font-family="IPAPGothic, sans-serif"';
const W = 270, H = 150;

// ---- six traditional patterns ----
function seigaiha() {
  let s = `<rect width="${W}" height="${H}" fill="${KINARI}"/>`;
  for (let j = -1; j * 12 < H + 30; j++)
    for (let i = -1; i * 40 < W + 40; i++) {
      const cx = i * 40 + (j % 2 ? 20 : 0), cy = j * 12;
      s += `<circle cx="${cx}" cy="${cy}" r="21" fill="${AI}"/>` + [16, 11, 6].map((r, k) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${k % 2 ? AI : "none"}" stroke="#fff" stroke-width="2.2"/>`).join("");
    }
  return s;
}
function ichimatsu() {
  let s = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (let j = 0; j * 25 < H; j++) for (let i = 0; i * 25 < W; i++) if ((i + j) % 2 === 0) s += `<rect x="${i * 25}" y="${j * 25}" width="25" height="25" fill="${MIDORI}"/>`;
  return s;
}
function kikko() {
  let s = `<rect width="${W}" height="${H}" fill="${KIN}"/>`;
  const r = 18, w = r * Math.sqrt(3);
  for (let j = -1; j * r * 1.5 < H + r; j++)
    for (let i = -1; i * w < W + w; i++) {
      const cx = i * w + (j % 2 ? w / 2 : 0), cy = j * r * 1.5;
      const pts = [0, 1, 2, 3, 4, 5].map(k => { const a = Math.PI / 3 * k + Math.PI / 6; return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`; }).join(" ");
      s += `<polygon points="${pts}" fill="none" stroke="#fff" stroke-width="3"/>`;
      const pts2 = [0, 1, 2, 3, 4, 5].map(k => { const a = Math.PI / 3 * k + Math.PI / 6; return `${cx + r * 0.62 * Math.cos(a)},${cy + r * 0.62 * Math.sin(a)}`; }).join(" ");
      s += `<polygon points="${pts2}" fill="none" stroke="#fff" stroke-width="1.5"/>`;
    }
  return s;
}
function asanoha() {
  let s = `<rect width="${W}" height="${H}" fill="${SHU}"/>`;
  const a = 44, h = a * Math.sqrt(3) / 2, P = (i, j) => [i * a + (j % 2 ? a / 2 : 0), j * h];
  const line = (p, q) => `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="#fff" stroke-width="1.6"/>`;
  for (let j = -1; j * h < H + h; j++)
    for (let i = -1; i * a < W + a; i++) {
      const p = P(i, j), q = P(i + 1, j), lower = j % 2 ? [P(i, j + 1), P(i + 1, j + 1)] : [P(i - 1, j + 1), P(i, j + 1)];
      for (const tri of [[p, q, lower[1]], [p, lower[0], lower[1]]]) {
        const c = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3];
        s += tri.map(v => line(v, c)).join("") + line(tri[0], tri[1]) + line(tri[1], tri[2]) + line(tri[2], tri[0]);
      }
    }
  return s;
}
function shippo() {
  let s = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  const d = 30;
  for (let j = -1; j * d < H + d; j++) for (let i = -1; i * d < W + d; i++)
    s += `<circle cx="${i * d}" cy="${j * d}" r="${d / Math.SQRT2}" fill="none" stroke="${AI}" stroke-width="2.4"/>`;
  return s;
}
function uroko() {
  let s = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  const b = 34, h = 30;
  for (let j = 0; j * h < H; j++) for (let i = -1; i * b < W + b; i++) {
    const x = i * b + (j % 2 ? b / 2 : 0), y = j * h;
    s += `<polygon points="${x},${y + h} ${x + b / 2},${y} ${x + b},${y + h}" fill="${KIN}"/>`;
  }
  return s;
}
const patterns = [
  ["青海波", seigaiha, "どこまでも絶えずに広がる波。\n長く続く幸せへの願い"],
  ["市松", ichimatsu, "石畳とも。歌舞伎役者の\n佐野川市松が衣装に使った"],
  ["亀甲", kikko, "亀の甲羅に見立てた文様。\n長寿や縁起のよいしるし"],
  ["麻の葉", asanoha, "成長が早く丈夫な麻にちなむ。\n子どもの健やかな成長の願い"],
  ["七宝つなぎ", shippo, "円が少しずつ重なって続く。\n円満を表す縁起のよい柄"],
  ["うろこ", uroko, "魚のうろこに似た柄。\n災いを避ける厄除けの柄"],
];
{
  const cw = 300, ch = 272;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw * 3}" height="${ch * 2}" ${F}><rect width="100%" height="100%" fill="${KINARI}"/>`;
  patterns.forEach(([name, fn, meaning], k) => {
    const x = (k % 3) * cw + 15, y = Math.floor(k / 3) * ch + 8;
    s += `<clipPath id="c${k}"><rect x="0" y="0" width="${W}" height="${H}" rx="10"/></clipPath><g transform="translate(${x},${y})"><g clip-path="url(#c${k})">${fn()}</g><rect width="${W}" height="${H}" rx="10" fill="none" stroke="#d8ccb4" stroke-width="2"/>`;
    s += `<text x="0" y="${H + 30}" font-size="26" font-weight="700" fill="${INK}">${name}</text>`;
    const lines = meaning.split("\n");
    lines.forEach((l, i) => (s += `<text x="0" y="${H + 60 + i * 25}" font-size="19" fill="#3a3a3a">${l}</text>`));
    s += `</g>`;
  });
  fs.writeFileSync("patterns.svg", s + "</svg>");
  // single 麻の葉 tile for the quiz
  fs.writeFileSync("asanoha.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><clipPath id="q"><rect width="${W}" height="${H}" rx="10"/></clipPath><g clip-path="url(#q)">${asanoha()}</g></svg>`);
}

// ---- 和服と洋服の構成 ----
{
  const label = (x, y, t, size = 15, fill = INK) => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" fill="${fill}">${t}</text>`;
  const piece = (x, y, w, h, t, fill = "#f9e8e3") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${SHU}" stroke-width="2"/>` +
    (w < 40 ? [...t].map((ch, i) => label(x + w / 2, y + h / 2 - (t.length - 1) * 8 + i * 17 + 5, ch, 14)).join("") : label(x + w / 2, y + h / 2 + 5, t, 14));
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360" ${F}><rect width="100%" height="100%" fill="#fff"/>`;
  s += label(225, 30, "和服（平面構成）", 22, AI) + label(675, 30, "洋服（立体構成）", 22, AI);
  s += `<line x1="450" y1="20" x2="450" y2="340" stroke="#d8ccb4" stroke-width="2" stroke-dasharray="6 6"/>`;
  // kimono pieces: all rectangles
  s += piece(20, 60, 52, 80, "袖") + piece(20, 150, 52, 80, "袖") + piece(80, 60, 44, 230, "身頃") + piece(130, 60, 44, 230, "身頃") + piece(180, 120, 24, 170, "おくみ") + piece(208, 120, 24, 170, "おくみ") + piece(238, 60, 14, 230, "", "#e8edf5") + label(245, 310, "えり", 14);
  s += `<path d="M262 180 h28" stroke="${AI}" stroke-width="4"/><polygon points="290,172 304,180 290,188" fill="${AI}"/>`;
  s += `<path d="M330 70 L380 70 L380 60 L404 60 L404 70 L436 70 L436 130 L410 130 L410 300 L354 300 L354 130 L330 130 Z" fill="#f9e8e3" stroke="${SHU}" stroke-width="2.5"/><path d="M380 70 L392 140 L404 70" fill="none" stroke="${AI}" stroke-width="4"/>`;
  s += label(225, 340, "長方形の布を直線で縫い合わせる", 16);
  // western pieces: curved
  const C = "#e8edf5";
  s += `<path d="M480 80 Q505 70 520 62 Q528 90 545 95 L555 95 L555 280 L480 280 Z" fill="${C}" stroke="${AI}" stroke-width="2"/>${label(515, 190, "前身頃", 14)}`;
  s += `<path d="M565 70 Q590 76 615 70 Q622 92 640 98 L640 280 L565 280 Z" fill="${C}" stroke="${AI}" stroke-width="2"/>${label(602, 190, "後ろ身頃", 14)}`;
  s += `<path d="M650 120 Q682 72 714 120 L706 260 L658 260 Z" fill="${C}" stroke="${AI}" stroke-width="2"/>${label(682, 200, "袖", 14)}`;
  s += `<path d="M650 60 Q690 40 730 60 L726 82 Q690 66 654 82 Z" fill="${C}" stroke="${AI}" stroke-width="2"/>${label(752, 66, "えり", 14)}`;
  s += `<path d="M740 180 h28" stroke="${AI}" stroke-width="4"/><polygon points="768,172 782,180 768,188" fill="${AI}"/>`;
  s += `<path d="M818 66 Q840 58 852 60 Q864 58 886 66 L896 120 L880 128 L878 300 L826 300 L824 128 L808 120 Z" fill="${C}" stroke="${AI}" stroke-width="2.5"/><path d="M838 62 L852 110 L866 62" fill="none" stroke="${AI}" stroke-width="3"/>`;
  s += label(675, 340, "曲線のあるパーツを体の形に合わせて縫い合わせる", 16);
  fs.writeFileSync("kosei.svg", s + "</svg>");
}

// ---- 右前 ----
{
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="380" ${F}><rect width="100%" height="100%" fill="#fff"/>`;
  s += `<path d="M110 70 L310 70 L330 360 L90 360 Z" fill="#e8edf5" stroke="${AI}" stroke-width="3"/>`;
  s += `<path d="M180 70 L232 190 L232 360" fill="none" stroke="${AI}" stroke-width="2" stroke-dasharray="6 5"/>`; // 下前の線（隠れている）
  s += `<path d="M240 70 L210 120 L170 360 L330 360 L310 70 Z" fill="#c9d4e6" stroke="${AI}" stroke-width="3"/>`; // 上前（着る人の左側）
  s += `<path d="M180 70 L214 118" stroke="#fff" stroke-width="10" stroke-linecap="round"/><path d="M240 70 L196 150" stroke="#fff" stroke-width="10" stroke-linecap="round"/>`;
  s += `<rect x="92" y="230" width="236" height="34" fill="${SHU}"/>`;
  s += `<text x="275" y="320" font-size="18" text-anchor="middle" fill="${INK}" font-weight="700">上前</text><text x="275" y="342" font-size="13" text-anchor="middle" fill="${INK}">（着る人の左側）</text>`;
  s += `<text x="135" y="320" font-size="18" text-anchor="middle" fill="${INK}" font-weight="700">下前</text><text x="135" y="342" font-size="13" text-anchor="middle" fill="${INK}">（右側・先に合わせる）</text>`;
  s += `<text x="210" y="36" font-size="22" text-anchor="middle" fill="${SHU}" font-weight="700">相手から見て「y」の形</text>`;
  fs.writeFileSync("migimae.svg", s + "</svg>");
}
console.log("ok");
