import { MAX_FILE_BYTES, type Deck } from "./model";

/**
 * 作品全体（全シート）のデータ量の内訳。サイズは、保存・書き出しされる
 * 作品データ（JSON）の UTF-8 バイト数で測る（serializeDeck と同じ形）。
 */
export interface DeckSizeBreakdown {
  totalBytes: number;
  limitBytes: number;
  slideCount: number;
  imageBytes: number;
  imageCount: number;
  posterBytes: number;
  posterCount: number;
  otherBytes: number;
}

const encoder = new TextEncoder();
export const byteLength = (text: string): number =>
  encoder.encode(text).length;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function measureDeckSize(deck: Deck): DeckSizeBreakdown {
  const totalBytes = byteLength(JSON.stringify(deck));
  let imageBytes = 0;
  let imageCount = 0;
  let posterBytes = 0;
  let posterCount = 0;
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.startsWith("data:image/")) {
        imageBytes += byteLength(value);
        imageCount += 1;
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object")
      Object.values(value).forEach(visit);
  };
  for (const slide of deck.slides)
    for (const element of slide.elements) {
      if (element.embed?.poster) {
        posterBytes += byteLength(element.embed.poster);
        posterCount += 1;
      }
      visit(element);
    }
  // The walk counted posters as images too; they are reported separately.
  imageBytes -= posterBytes;
  imageCount -= posterCount;
  return {
    totalBytes,
    limitBytes: MAX_FILE_BYTES,
    slideCount: deck.slides.length,
    imageBytes,
    imageCount,
    posterBytes,
    posterCount,
    otherBytes: Math.max(0, totalBytes - imageBytes - posterBytes),
  };
}
