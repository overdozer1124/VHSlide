// Simple stroke icons (64×64) for question bands, hints, tasks and points. White on a coloured circle.
const P = {
  question: `<circle cx="32" cy="32" r="22"/><path d="M25 26 q0 -8 7 -8 q8 0 8 7 q0 5 -6 7 q-2 1 -2 5"/><circle cx="32" cy="45" r="1.5" fill="#fff"/>`,
  bulb: `<path d="M24 38 q-6 -5 -6 -12 a14 14 0 0 1 28 0 q0 7 -6 12 v5 h-16 z"/><path d="M26 49 h12 M28 54 h8"/>`,
  flag: `<path d="M20 54 V12"/><path d="M20 14 h24 l-5 8 l5 8 h-24"/>`,
  pencil: `<path d="M16 48 l3 -11 l22 -22 l8 8 l-22 22 z"/><path d="M37 19 l8 8"/>`,
  check: `<circle cx="32" cy="32" r="22"/><path d="M22 33 l7 7 l14 -15"/>`,
  chat: `<path d="M12 16 h40 v26 h-24 l-10 9 v-9 h-6 z"/><path d="M21 27 h22 M21 34 h14"/>`,
  star: `<path d="M32 12 l6 13 l14 2 l-10 10 l2 14 l-12 -7 l-12 7 l2 -14 l-10 -10 l14 -2 z"/>`,
  book: `<path d="M12 16 q10 -4 20 2 q10 -6 20 -2 v32 q-10 -4 -20 2 q-10 -6 -20 -2 z"/><path d="M32 18 v32"/>`,
};
export const iconNames = Object.keys(P);
export function iconSvg(name, color = "#ffffff") {
  if (!P[name]) throw Error(`未知のアイコン: ${name}（${iconNames.join(", ")}）`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${P[name]}</g></svg>`;
}
