// Tone presets for lesson decks. Every color is #rrggbb (VHSlide accepts no other form).
// header: band | underline | tab | chalk | minimal
// card:   fill  (tinted panel) | strip (panel + accent bar on the left) | outline (thin frame)
export const themes = {
  natural: {
    label: "ナチュラル（やさしい・落ち着いた緑とオレンジ）",
    bg: "#fffdf8", surface: "#ffffff", ink: "#173d38", sub: "#5b6670",
    primary: "#173d38", onPrimary: "#ffffff", primarySoft: "#eef6f1",
    accent: "#e8742a", onAccent: "#ffffff", accentSoft: "#fff4e3",
    line: "#c9d8d2", header: "band", card: "strip",
    chart: ["#e8742a", "#2e7d5b", "#2f6fd6", "#c9a227", "#9b59b6", "#16a2a2"],
    muted: "#9fb3ad", mascot: { body: "#ffffff", outline: "#3a3a3a", wrap: "#2f4f3a", cheek: "#f6b3a6", think: "#f39c3d", idea: "#2e9b6a" },
  },
  pop: {
    label: "ポップ（明るい・元気）",
    bg: "#ffffff", surface: "#fff9db", ink: "#24324a", sub: "#5d6b82",
    primary: "#2b7de9", onPrimary: "#ffffff", primarySoft: "#e7f1ff",
    accent: "#ff5c8a", onAccent: "#ffffff", accentSoft: "#ffe8ef",
    line: "#ffd43b", header: "tab", card: "fill",
    chart: ["#2b7de9", "#ff5c8a", "#ffb000", "#20c997", "#845ef7", "#ff922b"],
    muted: "#c5cfdc", mascot: { body: "#ffffff", outline: "#24324a", wrap: "#2b7de9", cheek: "#ffb3c7", think: "#ffb000", idea: "#20c997" },
  },
  chic: {
    label: "シック（大人っぽい・紺と金）",
    bg: "#f7f5f0", surface: "#ffffff", ink: "#1f2a44", sub: "#69707f",
    primary: "#1f2a44", onPrimary: "#ffffff", primarySoft: "#e9ecf3",
    accent: "#b8892e", onAccent: "#ffffff", accentSoft: "#f6eedc",
    line: "#d8d2c4", header: "underline", card: "outline",
    chart: ["#1f2a44", "#b8892e", "#6b8fb3", "#a35d4a", "#7a8f6b", "#8c7aa8"],
    muted: "#b9bfcb", mascot: { body: "#ffffff", outline: "#1f2a44", wrap: "#1f2a44", cheek: "#e8c3b0", think: "#b8892e", idea: "#6b8fb3" },
  },
  chalk: {
    label: "黒板（板書の雰囲気）",
    bg: "#1f4a3d", surface: "#285a4b", ink: "#f5f3e8", sub: "#c9dccf",
    primary: "#f5f3e8", onPrimary: "#1f4a3d", primarySoft: "#285a4b",
    accent: "#ffd84d", onAccent: "#1f4a3d", accentSoft: "#2f6555",
    line: "#9cc5b5", header: "chalk", card: "outline",
    chart: ["#ffd84d", "#ff9e9e", "#9ed0ff", "#b6f09c", "#f5f3e8", "#ffb86b"],
    muted: "#9cc5b5", mascot: { body: "#fffdf4", outline: "#1f2a26", wrap: "#2a3a33", cheek: "#ffb7a8", think: "#ffd84d", idea: "#7fd1ae" },
  },
  wa: {
    label: "和（生成り・藍・朱）",
    bg: "#fbf7ee", surface: "#ffffff", ink: "#1f2a3a", sub: "#6a6458",
    primary: "#243b63", onPrimary: "#ffffff", primarySoft: "#e8edf5",
    accent: "#c4473a", onAccent: "#ffffff", accentSoft: "#f9e8e3",
    line: "#d8ccb4", header: "band", card: "strip",
    chart: ["#243b63", "#c4473a", "#c9a227", "#3a7d5c", "#7a5c99", "#5b8fb0"],
    muted: "#bdb5a6", mascot: { body: "#fff8ef", outline: "#2b2b2b", wrap: "#243b63", cheek: "#f2a7a0", think: "#c4473a", idea: "#3a7d5c" },
  },
  pastel: {
    label: "パステル（やわらかい桃色・若草色）",
    bg: "#fffaf6", surface: "#ffffff", ink: "#3f3a44", sub: "#7a7078",
    primary: "#d97a8c", onPrimary: "#ffffff", primarySoft: "#fde9ee",
    accent: "#5f9e52", onAccent: "#ffffff", accentSoft: "#ebf5e6",
    line: "#f3c9d2", header: "tab", card: "fill",
    chart: ["#d97a8c", "#5f9e52", "#e6a23c", "#6aa3c8", "#a07cc5", "#e5866a"],
    muted: "#dccfd5", mascot: { body: "#ffe27a", outline: "#4a3f45", wrap: "#ffffff", cheek: "#f7a8b8", think: "#e58a9c", idea: "#7cb46b" },
  },
  shokutaku: {
    label: "食卓（トマト・にんじん・菜っ葉の、食事が楽しくなる配色）",
    bg: "#fffaf0", surface: "#ffffff", ink: "#3b2a20", sub: "#7a6555",
    primary: "#d94a32", onPrimary: "#ffffff", primarySoft: "#fde8e1",
    accent: "#3f8f3a", onAccent: "#ffffff", accentSoft: "#e9f5e1",
    line: "#f4c9bd", header: "gingham", card: "fill",
    chart: ["#d94a32", "#f28c28", "#3f8f3a", "#f2c14e", "#8b5a3c", "#6aa3c8"],
    muted: "#e3d6c8", mascot: { body: "#f28c28", outline: "#5a3a22", wrap: "#4f9a3d", cheek: "#ff9e9e", think: "#d94a32", idea: "#3f8f3a" },
  },
  minimal: {
    label: "ミニマル（白基調・アクセント1色）",
    bg: "#ffffff", surface: "#f4f5f7", ink: "#1d1f23", sub: "#6b7079",
    primary: "#1d1f23", onPrimary: "#ffffff", primarySoft: "#f4f5f7",
    accent: "#0f8b8d", onAccent: "#ffffff", accentSoft: "#e3f3f3",
    line: "#dfe2e6", header: "minimal", card: "fill",
    chart: ["#0f8b8d", "#1d1f23", "#8a9099", "#e07a5f", "#3d5a80", "#c9a227"],
    muted: "#c4c8ce", mascot: { body: "#ffffff", outline: "#1d1f23", wrap: "#0f8b8d", cheek: "#f2b8a8", think: "#e07a5f", idea: "#0f8b8d" },
  },
};

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Resolve a preset name or a custom object (optionally `base` + overrides). */
export function resolveTheme(spec = "natural") {
  if (typeof spec === "string") {
    if (!themes[spec]) throw Error(`未知のテーマです: ${spec}（${Object.keys(themes).join(", ")}）`);
    return { ...structuredClone(themes[spec]), name: spec };
  }
  const base = structuredClone(themes[spec.base ?? "natural"]);
  const t = { ...base, name: spec.base ?? "natural", custom: true, ...spec, mascot: { ...base.mascot, ...(spec.mascot ?? {}) } };
  for (const [k, v] of Object.entries(t))
    if (typeof v === "string" && v.startsWith("#") && !HEX.test(v)) throw Error(`テーマの色 ${k} は #rrggbb で指定してください: ${v}`);
  return t;
}
