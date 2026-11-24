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
  // こけし: kimono collar drawn 右前 (the wearer's left panel on top: a "y" seen from the front).
  kokeshi: c => `<rect x="70" y="138" width="120" height="112" rx="38" fill="${c.wrap}" stroke="${c.outline}" stroke-width="5"/>
<circle cx="96" cy="226" r="7" fill="#ffffff" opacity=".35"/><circle cx="168" cy="172" r="7" fill="#ffffff" opacity=".35"/><circle cx="160" cy="236" r="6" fill="#ffffff" opacity=".35"/>
<path d="M104 140 L132 178" stroke="#ffffff" stroke-width="9" stroke-linecap="round"/><path d="M156 140 L116 196" stroke="#ffffff" stroke-width="9" stroke-linecap="round"/>
<rect x="72" y="196" width="116" height="22" fill="${c.think}"/>
<circle cx="130" cy="92" r="64" fill="${c.body}" stroke="${c.outline}" stroke-width="5"/>
<path d="M66 104 C62 10 198 10 194 104 L194 124 C188 112 184 98 178 86 C150 98 110 98 82 86 C76 98 72 112 66 124 Z" fill="#2b2b2b" stroke="${c.outline}" stroke-width="5" stroke-linejoin="round"/>
<circle cx="184" cy="54" r="11" fill="${c.think}"/><circle cx="184" cy="54" r="4" fill="#ffd56b"/>${face(130, 112, c, 0.8)}`,
  // ひよこ: a chick peeking out of an egg shell (growth).
  hiyoko: c => `<path d="M126 34 Q118 14 132 10 Q128 24 142 22 Q134 30 136 40" fill="${c.body}" stroke="${c.outline}" stroke-width="4" stroke-linejoin="round"/>
<ellipse cx="130" cy="128" rx="86" ry="84" fill="${c.body}" stroke="${c.outline}" stroke-width="5"/>
<path d="M50 140 Q30 150 40 176 Q56 168 64 152" fill="${c.body}" stroke="${c.outline}" stroke-width="4"/><path d="M210 140 Q230 150 220 176 Q204 168 196 152" fill="${c.body}" stroke="${c.outline}" stroke-width="4"/>
<circle cx="102" cy="112" r="9" fill="${c.outline}"/><circle cx="158" cy="112" r="9" fill="${c.outline}"/>
<circle cx="86" cy="138" r="11" fill="${c.cheek}" opacity=".85"/><circle cx="174" cy="138" r="11" fill="${c.cheek}" opacity=".85"/>
<path d="M118 128 L142 128 L130 146 Z" fill="#f29b38" stroke="${c.outline}" stroke-width="3" stroke-linejoin="round"/>
<path d="M44 176 L66 162 L88 180 L110 160 L130 180 L150 160 L172 180 L194 162 L216 176 Q220 246 130 248 Q40 246 44 176 Z" fill="${c.wrap}" stroke="${c.outline}" stroke-width="5" stroke-linejoin="round"/>`,
  // にんじん: a carrot with leafy top (food and nutrients).
  // 平安の姫：長い黒髪と重ね着（十二単風）の、本を読む女の子（古文・平安時代）。表着の色はテーマの think 色（時間ごとの色）。
  heian: c => `<path d="M64 128 C52 40 208 40 196 128 L214 256 L46 256 Z" fill="#1d1d22" stroke="${c.outline}" stroke-width="4" stroke-linejoin="round"/>
<path d="M34 260 C40 206 82 184 130 184 C178 184 220 206 226 260 Z" fill="${c.think}" stroke="${c.outline}" stroke-width="4" stroke-linejoin="round"/>
<path d="M94 184 L130 236 L166 184 Z" fill="#f2a23a" stroke="${c.outline}" stroke-width="3" stroke-linejoin="round"/>
<path d="M104 184 L130 222 L156 184 Z" fill="#4f9a5c" stroke="${c.outline}" stroke-width="3" stroke-linejoin="round"/>
<path d="M113 184 L130 208 L147 184 Z" fill="#fff4dc" stroke="${c.outline}" stroke-width="2.5" stroke-linejoin="round"/>
<ellipse cx="130" cy="122" rx="52" ry="58" fill="#fde9d6" stroke="${c.outline}" stroke-width="4"/>
<path d="M74 124 C68 48 192 48 186 124 L176 124 L174 104 L86 104 L84 124 Z" fill="#1d1d22" stroke="${c.outline}" stroke-width="3.5" stroke-linejoin="round"/>
<rect x="66" y="104" width="20" height="132" rx="10" fill="#1d1d22"/><rect x="174" y="104" width="20" height="132" rx="10" fill="#1d1d22"/>
<circle cx="104" cy="70" r="6" fill="#6e6e78"/><circle cx="120" cy="64" r="4" fill="#6e6e78"/>
${face(130, 128, c, 0.78)}
<rect x="98" y="216" width="64" height="40" rx="4" fill="#3f8f5a" stroke="${c.outline}" stroke-width="3.5"/>
<path d="M130 216 L130 256" stroke="${c.outline}" stroke-width="3"/>
<path d="M106 228 L124 228 M106 238 L124 238 M136 228 L154 228 M136 238 L154 238" stroke="#ffffff" stroke-width="3" opacity=".55"/>
<ellipse cx="100" cy="240" rx="10" ry="12" fill="#fde9d6" stroke="${c.outline}" stroke-width="3"/><ellipse cx="160" cy="240" rx="10" ry="12" fill="#fde9d6" stroke="${c.outline}" stroke-width="3"/>`,
  // 文人：冠（黒い小さな冠と簪）をかぶり、交領（えりを打ち合わせた）の袍を着て、竹簡を広げて読む子ども（漢文・中国の古典）。袍の色はテーマの think 色（時間ごとの色）。
  bunjin: c => `<path d="M30 260 C36 204 80 180 130 180 C180 180 224 204 230 260 Z" fill="${c.think}" stroke="${c.outline}" stroke-width="4" stroke-linejoin="round"/>
<path d="M104 182 L150 238 M156 182 L120 220" stroke="#fff4dc" stroke-width="10" stroke-linecap="round"/>
<path d="M104 182 L150 238 M156 182 L120 220" stroke="${c.outline}" stroke-width="2.5" stroke-linecap="round" opacity=".5"/>
<ellipse cx="130" cy="118" rx="54" ry="58" fill="#fde9d6" stroke="${c.outline}" stroke-width="4"/>
<path d="M76 120 C70 52 190 52 184 120 L178 104 C160 92 100 92 82 104 Z" fill="#1d1d22" stroke="${c.outline}" stroke-width="3.5" stroke-linejoin="round"/>
<rect x="110" y="34" width="40" height="30" rx="6" fill="#1d1d22" stroke="${c.outline}" stroke-width="3.5"/>
<path d="M92 50 H168" stroke="#c8a04a" stroke-width="5" stroke-linecap="round"/><circle cx="168" cy="50" r="5" fill="#c8a04a"/>
${face(130, 128, c, 0.78)}
<rect x="64" y="206" width="132" height="50" rx="3" fill="#e3c27e" stroke="${c.outline}" stroke-width="3"/>
<path d="M80 206 V256 M96 206 V256 M112 206 V256 M130 206 V256 M148 206 V256 M164 206 V256 M180 206 V256" stroke="#8a6a3a" stroke-width="2"/>
<path d="M64 218 H196 M64 244 H196" stroke="${c.wrap}" stroke-width="3"/>
<ellipse cx="62" cy="232" rx="11" ry="13" fill="#fde9d6" stroke="${c.outline}" stroke-width="3"/><ellipse cx="198" cy="232" rx="11" ry="13" fill="#fde9d6" stroke="${c.outline}" stroke-width="3"/>`,
  ninjin: c => `<path d="M118 62 C104 30 84 22 74 30 C92 40 104 54 112 66 Z" fill="${c.wrap}" stroke="${c.outline}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M126 60 C124 26 132 12 144 14 C144 32 138 48 134 62 Z" fill="${c.wrap}" stroke="${c.outline}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M140 64 C156 36 178 30 188 38 C172 46 160 58 150 70 Z" fill="${c.wrap}" stroke="${c.outline}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M66 92 Q130 50 194 92 Q204 140 156 226 Q130 262 104 226 Q56 140 66 92 Z" fill="${c.body}" stroke="${c.outline}" stroke-width="5" stroke-linejoin="round"/>
<path d="M88 168 h16 M160 184 h-14 M118 206 h14" stroke="${c.outline}" stroke-width="3" stroke-linecap="round" opacity=".45"/>
${face(130, 116, c, 0.82)}`,
  blob: c => `<path d="M64 76 C92 30 176 26 206 70 C246 96 248 196 206 226 C168 252 92 252 56 224 C14 192 22 104 64 76 Z" fill="${c.body}" stroke="${c.outline}" stroke-width="5"/>${face(130, 140, c)}`,
};
const badge = (fill, mark, size = 40) =>
  `<circle cx="222" cy="44" r="32" fill="${fill}"/><text x="222" y="${44 + size * 0.36}" font-size="${size}" font-weight="700" fill="#fff" text-anchor="middle" font-family="sans-serif">${mark}</text>`;

export const mascotKinds = Object.keys(bodies);
// Characters whose look depends on their real colour keep it whatever the theme.
const natural = { ninjin: { body: "#f28c28", wrap: "#4f9a3d" }, hiyoko: { body: "#ffe27a", wrap: "#ffffff" } };
export function mascotSvg(kind = "onigiri", pose = "think", themeColors) {
  const colors = { ...themeColors, ...(natural[kind] ?? {}) };
  if (!bodies[kind]) throw Error(`キャラクターの種類: ${mascotKinds.join(", ")}`);
  const mark = pose === "think" ? badge(colors.think, "?") : pose === "idea" ? badge(colors.idea, "!") : pose === "happy" ? badge(colors.think, "♪", 34) : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260">${bodies[kind](colors)}${mark}</svg>`;
}
