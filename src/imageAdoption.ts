import type { Deck } from "./model";

/**
 * Image adoption: a deck loaded from a file (or copied from another deck)
 * can carry image elements whose src is an embedded data: URL. A cloud
 * room only accepts images that are registered assets of that same deck,
 * so when such a deck is saved to the cloud as a new work, the embedded
 * images are uploaded as assets of the new deck and every src is
 * rewritten to the asset URL. The deck first goes up without those
 * elements, because the room validates image sources already at
 * creation time.
 */

const isEmbedded = (src: string | undefined): src is string =>
  typeof src === "string" && src.startsWith("data:");

export function embeddedImageSources(deck: Deck): string[] {
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const slide of deck.slides)
    for (const element of slide.elements)
      if (element.type === "image" && isEmbedded(element.src)) {
        if (!seen.has(element.src)) {
          seen.add(element.src);
          sources.push(element.src);
        }
      }
  return sources;
}

export function withoutEmbeddedImages(deck: Deck): Deck {
  const copy = structuredClone(deck);
  for (const slide of copy.slides)
    slide.elements = slide.elements.filter(
      (element) =>
        !(element.type === "image" && isEmbedded(element.src)),
    );
  return copy;
}

export function rewriteImageSources(
  deck: Deck,
  sources: Map<string, string>,
): { deck: Deck; dropped: number } {
  const copy = structuredClone(deck);
  let dropped = 0;
  for (const slide of copy.slides) {
    const kept: typeof slide.elements = [];
    for (const element of slide.elements) {
      if (element.type === "image" && isEmbedded(element.src)) {
        const src = sources.get(element.src);
        if (!src) {
          dropped++;
          continue;
        }
        element.src = src;
      }
      kept.push(element);
    }
    slide.elements = kept;
  }
  return { deck: copy, dropped };
}

const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function dataUrlToFile(dataUrl: string, name: string): File | null {
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  try {
    const bytes = match[2]
      ? Uint8Array.from(atob(match[3]), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(match[3]));
    const extension = extensions[mime] ?? "bin";
    return new File([bytes.buffer as ArrayBuffer], `${name}.${extension}`, {
      type: mime,
    });
  } catch {
    return null;
  }
}
