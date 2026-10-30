import type { Deck, Slide } from "./model.ts";
import { neighbor } from "./model.ts";
export type PresentationSession = {
  mode: "spatial" | "route";
  ids: string[];
  label: string;
  returnTo: {
    view: "map" | "editor";
    sheetId: string;
    activeId: string;
    scroll?: { left: number; top: number };
  };
};
export function presentationState(
  book: Deck,
  session: PresentationSession,
  currentId: string,
  excursion = false,
) {
  const byId = new Map(book.slides.map((s) => [s.id, s])),
    pages = session.ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const index = session.ids.indexOf(currentId);
  const nextIds = [
    ...session.ids.slice(index + 1),
    ...session.ids.slice(0, Math.max(0, index)).reverse(),
  ];
  const current = byId.get(currentId);
  const slide =
    (current && (session.ids.includes(currentId) || excursion)
      ? current
      : undefined) ??
    nextIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))[0] ??
    pages[0];
  const external = !!slide && !session.ids.includes(slide.id);
  const deck = {
    ...book,
    slides: pages.filter(
      (s) => (s.sheetId ?? "main") === (slide?.sheetId ?? "main"),
    ),
  };
  return { pages, slide, external, deck };
}
export function presentationNeighbor(
  state: { pages: Slide[]; slide?: Slide; external: boolean; deck: Deck },
  mode: PresentationSession["mode"],
  dx: number,
  dy: number,
) {
  if (!state.slide || state.external) return;
  return mode === "route"
    ? state.pages[
        state.pages.findIndex((s) => s.id === state.slide!.id) + (dx || dy)
      ]
    : neighbor(state.deck, state.slide, dx, dy);
}
