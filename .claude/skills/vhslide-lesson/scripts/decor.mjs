// Decorative backdrops (960×540 SVG) drawn under the slide's text and fields.
// They give depth and texture that VHSlide shapes alone cannot: gradients, soft blur, grain, patterns.
// kinds: "title" | "section" | "content". Each theme picks a style with T.decor.style.
// The content backdrop keeps the body area (y > 96) calm and light so text stays readable.

const W = 960, H = 540;
const FONT = 'font-family="IPAPGothic, sans-serif"';

/** Mix two #rrggbb colours (t = 0 → a, 1 → b). */
export function mix(a, b, t) {
  const p = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

const defs = (T, extra = "") => `<defs>
  <filter id="blur40" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
  <filter id="blur18" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.07 0"/>
  </filter>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2" fill="#ffffff" opacity=".22"/></pattern>
  <pattern id="dotsInk" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.6" fill="${T.ink}" opacity=".10"/></pattern>
  <linearGradient id="gHead" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${T.primary}"/><stop offset="1" stop-color="${mix(T.primary, T.accent, 0.55)}"/></linearGradient>
  <linearGradient id="gHero" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${T.decor.heroFrom ?? T.primary}"/><stop offset="1" stop-color="${T.decor.heroTo ?? mix(T.primary, T.accent, 0.6)}"/></linearGradient>
  <linearGradient id="gGround" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.bg}"/><stop offset="1" stop-color="${mix(T.bg, T.primarySoft, 0.7)}"/></linearGradient>
  ${extra}
</defs>`;
const grain = `<rect width="${W}" height="${H}" filter="url(#grain)"/>`;
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ${FONT}>${body}</svg>`;

/** Gentle wave path across the width at height y with amplitude a. */
const wave = (y, a, phase = 0, bottom = H) => {
  let d = `M0 ${bottom} L0 ${y}`;
  for (let x = 0; x <= W; x += 40) d += ` L${x} ${(y + Math.sin((x / W) * Math.PI * 2 + phase) * a).toFixed(1)}`;
  return d + ` L${W} ${bottom} Z`;
};
const seigaiha = (x0, y0, w, h, color, opacity) => {
  let s = `<g opacity="${opacity}">`;
  for (let j = 0; j * 12 < h + 24; j++) for (let i = 0; i * 40 < w + 40; i++) {
    const cx = x0 + i * 40 + (j % 2 ? 20 : 0), cy = y0 + j * 12;
    s += `<circle cx="${cx}" cy="${cy}" r="20" fill="none" stroke="${color}" stroke-width="1.6"/><circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="${color}" stroke-width="1.6"/><circle cx="${cx}" cy="${cy}" r="6" fill="none" stroke="${color}" stroke-width="1.6"/>`;
  }
  return s + "</g>";
};
const gingham = (y, h, c) => {
  let s = "";
  for (let x = 0; x < W; x += 24) s += `<rect x="${x}" y="${y}" width="12" height="${h}" fill="${c}" opacity=".35"/>`;
  for (let yy = y; yy < y + h; yy += 24) s += `<rect x="0" y="${yy}" width="${W}" height="12" fill="${c}" opacity=".35"/>`;
  return s;
};
const confetti = (T, n, seed, area) => {
  let s = "", r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const cols = [T.accent, T.primary, ...(T.tiles ?? [T.accentSoft])];
  for (let i = 0; i < n; i++) {
    const x = area.x + rnd() * area.w, y = area.y + rnd() * area.h, c = cols[i % cols.length], k = i % 3;
    s += k === 0 ? `<circle cx="${x}" cy="${y}" r="${4 + rnd() * 5}" fill="${c}" opacity=".55"/>`
      : k === 1 ? `<rect x="${x}" y="${y}" width="${8 + rnd() * 8}" height="${8 + rnd() * 8}" rx="2" fill="${c}" opacity=".45" transform="rotate(${rnd() * 90} ${x} ${y})"/>`
      : `<path d="M${x} ${y} q8 -10 16 0 t16 0" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity=".5"/>`;
  }
  return s;
};

// ---------- styles ----------
const styles = {
  /** Gradient header with a wavy edge, soft blobs, dots; hero pages with layered waves. */
  waves(T, kind) {
    if (kind === "content") return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="url(#gGround)"/>
      <circle cx="${W - 40}" cy="${H + 10}" r="190" fill="${T.accentSoft}" opacity=".9" filter="url(#blur40)"/>
      <circle cx="40" cy="${H - 30}" r="120" fill="${T.primarySoft}" opacity=".9" filter="url(#blur40)"/>
      <path d="${wave(78, 7, 0.6, 0).replace(`M0 0`, "M0 0")}" fill="url(#gHead)"/>
      <path d="${wave(78, 7, 0.6, 0)}" fill="url(#dots)"/>
      <path d="${wave(86, 6, 1.4, 0)}" fill="${T.primary}" opacity=".18"/>
      ${grain}`);
    if (kind === "section") return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="url(#gHero)"/>
      <rect width="${W}" height="${H}" fill="url(#dots)"/>
      <circle cx="170" cy="270" r="150" fill="none" stroke="#ffffff" stroke-width="2" opacity=".35"/>
      <circle cx="170" cy="270" r="190" fill="none" stroke="#ffffff" stroke-width="1.5" opacity=".2"/>
      <path d="${wave(430, 20, 0)}" fill="#ffffff" opacity=".12"/><path d="${wave(470, 16, 2)}" fill="#ffffff" opacity=".16"/>
      ${grain}`);
    return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="url(#gHero)"/>
      <circle cx="${W - 120}" cy="80" r="200" fill="${T.accent}" opacity=".35" filter="url(#blur40)"/>
      <circle cx="120" cy="${H}" r="220" fill="#ffffff" opacity=".18" filter="url(#blur40)"/>
      <rect width="${W}" height="${H}" fill="url(#dots)" opacity=".7"/>
      <path d="${wave(410, 22, 0.3)}" fill="#ffffff" opacity=".14"/><path d="${wave(450, 18, 2.2)}" fill="#ffffff" opacity=".18"/><path d="${wave(492, 12, 4)}" fill="#ffffff" opacity=".9"/>
      ${confetti(T, 14, 11, { x: 560, y: 24, w: 360, h: 110 })}
      ${grain}`);
  },
  /** Light ground with blurred colour blobs (glassy, modern). */
  blobs(T, kind) {
    const t = T.tiles ?? [T.accentSoft, T.primarySoft];
    if (kind === "content") return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="${T.bg}"/>
      <circle cx="${W - 60}" cy="60" r="150" fill="${mix(t[0], T.accent, 0.35)}" opacity=".55" filter="url(#blur40)"/>
      <circle cx="60" cy="${H - 20}" r="160" fill="${mix(t[2 % t.length], T.primary, 0.3)}" opacity=".45" filter="url(#blur40)"/>
      <circle cx="${W / 2}" cy="${H + 60}" r="160" fill="${mix(t[1 % t.length], T.accent, 0.2)}" opacity=".35" filter="url(#blur40)"/>
      <rect width="${W}" height="${H}" fill="url(#dotsInk)" opacity=".5"/>
      ${grain}`);
    const dark = kind === "section";
    return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="${dark ? T.decor.sectionGround ?? T.primary : T.bg}"/>
      <circle cx="${W - 150}" cy="120" r="230" fill="${mix(t[0], T.accent, 0.5)}" opacity="${dark ? 0.55 : 0.75}" filter="url(#blur40)"/>
      <circle cx="${W - 330}" cy="${H - 40}" r="200" fill="${mix(t[1 % t.length], T.primary, 0.3)}" opacity="${dark ? 0.5 : 0.7}" filter="url(#blur40)"/>
      <circle cx="80" cy="60" r="150" fill="${mix(t[3 % t.length], T.accent, 0.25)}" opacity="${dark ? 0.4 : 0.6}" filter="url(#blur40)"/>
      <rect x="${W - 420}" y="70" width="340" height="400" rx="40" fill="#ffffff" opacity="${dark ? 0.08 : 0.35}"/>
      <rect width="${W}" height="${H}" fill="url(#${dark ? "dots" : "dotsInk"})" opacity=".6"/>
      ${grain}`);
  },
  /** Washi paper, seigaiha pattern, indigo gradient header with a gold rule. */
  wa(T, kind) {
    const gold = T.decor.gold ?? "#c9a227";
    if (kind === "content") return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="${T.bg}"/>
      ${seigaiha(W - 300, H - 150, 320, 170, T.primary, 0.07)}
      <rect width="${W}" height="78" fill="url(#gHead)"/>
      ${seigaiha(W - 360, -10, 380, 92, "#ffffff", 0.16)}
      <rect y="78" width="${W}" height="4" fill="${gold}"/>
      ${grain}`);
    return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="url(#gHero)"/>
      ${seigaiha(-20, kind === "title" ? 330 : 0, W + 40, kind === "title" ? 230 : H, "#ffffff", 0.13)}
      <circle cx="${W - 150}" cy="140" r="${kind === "title" ? 120 : 160}" fill="${T.accent}" opacity=".85"/>
      <rect x="40" y="${H - 44}" width="${W - 80}" height="2" fill="${gold}" opacity=".8"/>
      ${grain}`);
  },
  /** Tablecloth: tomato gradient header with gingham, warm paper ground. */
  cloth(T, kind) {
    if (kind === "content") return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="url(#gGround)"/>
      <rect width="${W}" height="70" fill="url(#gHead)"/>
      ${gingham(70, 24, T.primary)}
      <circle cx="${W - 30}" cy="${H - 20}" r="150" fill="${T.accentSoft}" opacity=".9" filter="url(#blur40)"/>
      ${grain}`);
    return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="${T.bg}"/>
      ${gingham(0, H, T.primary)}
      <rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="28" fill="${kind === "section" ? T.primary : "#ffffff"}" opacity="${kind === "section" ? 0.94 : 0.96}"/>
      <circle cx="${W - 120}" cy="${H - 90}" r="140" fill="${T.accentSoft}" opacity=".8" filter="url(#blur18)"/>
      ${grain}`);
  },
  /** Chalkboard texture inside a wooden frame. */
  chalk(T, kind) {
    const board = T.bg;
    return svg(defs(T, `<filter id="smudge" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="3"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.10 0"/></filter>`) + `
      <rect width="${W}" height="${H}" fill="#8a5a33"/>
      <rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="${board}"/>
      <rect x="10" y="10" width="${W - 20}" height="${H - 20}" filter="url(#smudge)"/>
      <rect x="10" y="10" width="${W - 20}" height="${H - 20}" filter="url(#grain)" opacity=".8"/>
      ${kind === "content" ? "" : `<rect x="${W - 260}" y="${H - 34}" width="60" height="14" rx="4" fill="#fffdf4" opacity=".9"/><rect x="${W - 180}" y="${H - 34}" width="44" height="14" rx="4" fill="#ffd84d" opacity=".9"/>`}
      <rect x="0" y="${H - 18}" width="${W}" height="18" fill="#6e4524"/>`);
  },
  /** Cork board with pins and a paper texture. */
  cork(T, kind) {
    return svg(defs(T, `<filter id="cork" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="9"/><feColorMatrix type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.22  0 0 0 0 0.08  0 0 0 0.35 0"/></filter>`) + `
      <rect width="${W}" height="${H}" fill="${T.bg}"/>
      <rect width="${W}" height="${H}" filter="url(#cork)"/>
      <rect width="${W}" height="${H}" fill="none" stroke="#7a4f27" stroke-width="18"/>
      ${kind === "content" ? "" : `<rect x="70" y="80" width="${W - 140}" height="${H - 160}" fill="${kind === "section" ? T.primary : "#fffdf5"}" transform="rotate(-1.2 480 270)"/>
      <circle cx="120" cy="96" r="10" fill="${T.accent}"/><circle cx="${W - 120}" cy="96" r="10" fill="#2f6f9f"/>`}`);
  },
  /** Ruled notebook paper with grain (header lines are drawn by the notebook header). */
  paper(T, kind) {
    return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="${T.bg}"/>
      ${kind === "content" ? "" : `<rect width="${W}" height="${H}" fill="${kind === "section" ? T.primary : T.bg}"/>${kind === "title" ? Array.from({ length: 12 }, (_, i) => `<line x1="0" x2="${W}" y1="${80 + i * 40}" y2="${80 + i * 40}" stroke="${T.line}"/>`).join("") + `<line x1="86" x2="86" y1="0" y2="${H}" stroke="${T.margin ?? "#f0a3a3"}" stroke-width="2"/>` : ""}`}
      <rect x="${W - 210}" y="-14" width="150" height="40" fill="#f3e6b8" opacity=".85" transform="rotate(4 ${W - 135} 6)"/>
      ${grain}${grain}`);
  },
  /** Bold stickers: halftone dots, stars and squiggles around the edges. */
  pop(T, kind) {
    const star = (x, y, r, c) => { let d = ""; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; d += `${i ? "L" : "M"}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)} `; } return `<path d="${d}Z" fill="${c}" stroke="${T.ink}" stroke-width="3" stroke-linejoin="round"/>`; };
    const half = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#dotsInk)" opacity="1.6"/>`;
    if (kind === "content") return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="${T.bg}"/>
      ${half(W - 180, H - 140, 180, 140)}${half(0, 90, 110, 120)}
      ${star(W - 44, H - 44, 18, T.chip ?? T.accent)}
      ${grain}`);
    return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="${kind === "section" ? T.sectionBg ?? T.accent : T.bg}"/>
      ${half(0, 0, W, H)}
      ${star(W - 110, 110, 46, T.chip ?? "#ffd23f")}${star(150, H - 80, 30, (T.tiles ?? [T.accentSoft])[0])}
      <path d="M${W - 260} ${H - 70} q20 -26 40 0 t40 0 t40 0 t40 0" fill="none" stroke="${T.ink}" stroke-width="5" stroke-linecap="round"/>
      ${grain}`);
  },
  /** Editorial: big faint letterform, colour block, fine grain. */
  editorial(T, kind) {
    if (kind === "content") return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="${T.bg}"/>
      <rect x="${W - 14}" y="0" width="14" height="${H}" fill="${T.accent}"/>
      ${grain}`);
    return svg(defs(T) + `
      <rect width="${W}" height="${H}" fill="${kind === "section" ? T.sectionBg ?? T.ink : T.bg}"/>
      <rect x="${W - 330}" y="0" width="330" height="${H}" fill="${kind === "section" ? mix(T.sectionBg ?? T.ink, T.accent, 0.25) : T.primarySoft}"/>
      <text x="${W - 40}" y="${H - 40}" font-size="360" font-weight="700" text-anchor="end" fill="${kind === "section" ? "#ffffff" : T.ink}" opacity=".06" font-family="serif">学</text>
      <rect x="64" y="${H - 64}" width="120" height="6" fill="${T.accent}"/>
      ${grain}`);
  },
};

export const decorStyles = Object.keys(styles);
export function decorSvg(T, kind) {
  const f = styles[T.decor?.style];
  if (!f) throw Error(`未知の装飾スタイル: ${T.decor?.style}（${decorStyles.join(", ")}）`);
  if (kind === "plain") // full-page layouts that draw their own heading: calm ground only
    return svg(defs(T) + `<rect width="${W}" height="${H}" fill="url(#gGround)"/>
      <circle cx="${W - 40}" cy="${H}" r="170" fill="${T.accentSoft}" opacity=".8" filter="url(#blur40)"/>
      <circle cx="30" cy="30" r="120" fill="${T.primarySoft}" opacity=".8" filter="url(#blur40)"/>${grain}`);
  return f(T, kind);
}
