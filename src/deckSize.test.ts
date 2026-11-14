import { describe, expect, it } from "vitest";
import { blank, type Deck, type Element } from "./model";
import { byteLength, formatBytes, measureDeckSize } from "./deckSize";

describe("formatBytes", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
  });
});

describe("measureDeckSize", () => {
  it("splits images and embed posters out of the total", () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const poster = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const slide = blank(0, 0);
    slide.elements = [
      { id: "i1", type: "image", src: image },
      {
        id: "e1",
        type: "shape",
        embed: { url: "https://example.com/app", poster },
      },
    ] as unknown as Element[];
    const deck = {
      version: 1,
      title: "サイズ",
      slides: [slide, blank(1, 0)],
    } as unknown as Deck;
    const size = measureDeckSize(deck);
    expect(size.totalBytes).toBe(byteLength(JSON.stringify(deck)));
    expect(size.slideCount).toBe(2);
    expect(size.imageBytes).toBe(byteLength(image));
    expect(size.imageCount).toBe(1);
    expect(size.posterBytes).toBe(byteLength(poster));
    expect(size.posterCount).toBe(1);
    expect(size.otherBytes).toBe(
      size.totalBytes - size.imageBytes - size.posterBytes,
    );
    expect(size.limitBytes).toBe(25_000_000);
  });
});
