import * as Y from "yjs";
import type { Deck, Element, Slide } from "./model.ts";

export const LOCAL_CHANGE = "vhslide-local";
type Fields = Y.Map<unknown>;
function fields(value: unknown): Fields {
  if (!(value instanceof Y.Map))
    throw new Error("作品の共有データが壊れています。");
  return value;
}
function text(value: unknown): string {
  if (!(value instanceof Y.Text))
    throw new Error("文字の共有データが壊れています。");
  return value.toString();
}
/** Replace only the changed span, so concurrent text insertions remain independent. */
function changeText(target: Y.Text, before: string, after: string) {
  if (before === after) return;
  let start = 0,
    suffix = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  target.delete(start, before.length - start - suffix);
  target.insert(start, after.slice(start, after.length - suffix));
}
function patchFields(
  target: Fields,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  skip: string[],
) {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (
      skip.includes(key) ||
      JSON.stringify(before[key]) === JSON.stringify(after[key])
    )
      continue;
    if (after[key] === undefined) target.delete(key);
    else target.set(key, after[key]);
  }
}
export function applyDeckChange(doc: Y.Doc, before: Deck, after: Deck) {
  doc.transact(() => {
    changeText(doc.getText("title"), before.title, after.title);
    const slides = doc.getMap<Fields>("slides");
    for (const old of before.slides)
      if (!after.slides.some((s) => s.id === old.id)) slides.delete(old.id);
    for (const slide of after.slides) {
      const old = before.slides.find((s) => s.id === slide.id);
      let target = slides.get(slide.id);
      if (!old && target) continue;
      if (!target) {
        if (old) continue; // A concurrent deletion wins over a stale edit.
        target = new Y.Map();
        slides.set(slide.id, target);
        target.set("title", new Y.Text());
        target.set("elements", new Y.Map());
      }
      changeText(target.get("title") as Y.Text, old?.title ?? "", slide.title);
      if (!old || old.x !== slide.x || old.y !== slide.y)
        target.set("position", { x: slide.x, y: slide.y });
      if (!old || old.background !== slide.background)
        target.set("background", slide.background);
      const elements = fields(target.get("elements"));
      for (const previous of old?.elements ?? [])
        if (!slide.elements.some((e) => e.id === previous.id))
          elements.delete(previous.id);
      slide.elements.forEach((element, rank) => {
        const previous = old?.elements.find((e) => e.id === element.id);
        let item = elements.get(element.id) as Fields | undefined;
        if (!previous && item) return;
        if (!item) {
          if (previous) return;
          item = new Y.Map();
          elements.set(element.id, item);
          if (element.type === "text") item.set("text", new Y.Text());
        }
        patchFields(
          item,
          (previous ?? {}) as Record<string, unknown>,
          element as unknown as Record<string, unknown>,
          ["id", "text"],
        );
        if (element.type === "text")
          changeText(
            item.get("text") as Y.Text,
            previous?.text ?? "",
            element.text ?? "",
          );
        if (!previous || old?.elements.indexOf(previous) !== rank)
          item.set("rank", rank);
      });
    }
  }, LOCAL_CHANGE);
}
export function createSharedDeck(deck: Deck): Y.Doc {
  const doc = new Y.Doc();
  applyDeckChange(doc, { version: 1, title: "", slides: [] }, deck);
  return doc;
}
/** Deterministically place simultaneous additions into distinct, fixed grid cells. */
export function readSharedDeck(doc: Y.Doc): Deck {
  const slides: Slide[] = [];
  for (const [id, value] of doc.getMap("slides")) {
    const s = fields(value);
    const position = s.get("position") as { x: number; y: number };
    if (
      !position ||
      ![position.x, position.y].every(
        (n) => Number.isInteger(n) && n >= 0 && n < 100,
      )
    )
      throw new Error("ページの位置が正しくありません。");
    const elements = [...fields(s.get("elements"))]
      .map(([elementId, value]) => {
        const e = fields(value),
          raw = e.toJSON();
        delete raw.rank;
        if (raw.type === "text") raw.text = text(e.get("text"));
        return {
          element: { ...raw, id: elementId } as Element,
          rank: Number(e.get("rank")),
        };
      })
      .sort(
        (a, b) => a.rank - b.rank || a.element.id.localeCompare(b.element.id),
      )
      .map((e) => e.element);
    slides.push({
      id,
      ...position,
      title: text(s.get("title")),
      background: s.get("background") as string,
      elements,
    });
  }
  const occupied = new Set<string>();
  slides.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  for (const s of slides) {
    while (occupied.has(`${s.x},${s.y}`)) {
      s.x++;
      if (s.x >= 100) {
        s.x = 0;
        s.y++;
      }
      if (s.y >= 100) throw new Error("縦・横は100マスまでです。");
    }
    occupied.add(`${s.x},${s.y}`);
  }
  if (!occupied.has("0,0"))
    slides.unshift({
      id: "cloud-start",
      x: 0,
      y: 0,
      title: "はじめのページ",
      background: "#ffffff",
      elements: [],
    });
  return { version: 1, title: doc.getText("title").toString(), slides };
}
export function sharedText(
  doc: Y.Doc,
  slideId: string,
  elementId: string,
): Y.Text | undefined {
  const slide = doc.getMap<Fields>("slides").get(slideId);
  const elements = slide?.get("elements");
  const element =
    elements instanceof Y.Map ? elements.get(elementId) : undefined;
  const value = element instanceof Y.Map ? element.get("text") : undefined;
  return value instanceof Y.Text ? value : undefined;
}
export function toBase64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
export const fromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
