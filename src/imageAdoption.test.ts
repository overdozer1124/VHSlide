import { describe, expect, it } from "vitest";
import type { Deck } from "./model";
import {
  dataUrlToFile,
  embeddedImageSources,
  rewriteImageSources,
  withoutEmbeddedImages,
} from "./imageAdoption";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const jpg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

function deck(): Deck {
  return {
    version: 1,
    title: "画像テスト",
    sheets: [{ id: "s1", name: "シート1" }],
    activeSheetId: "s1",
    slides: [
      {
        id: "p1",
        sheetId: "s1",
        x: 0,
        y: 0,
        background: "#ffffff",
        elements: [
          { id: "t1", type: "text", x: 0, y: 0, w: 100, h: 40, text: "題" },
          { id: "i1", type: "image", x: 0, y: 50, w: 200, h: 100, src: png },
          { id: "i2", type: "image", x: 0, y: 160, w: 200, h: 100, src: png },
          { id: "i3", type: "image", x: 0, y: 270, w: 200, h: 100, src: jpg },
          {
            id: "i4",
            type: "image",
            x: 0,
            y: 380,
            w: 200,
            h: 100,
            src: "/api/decks/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/assets/11111111-2222-3333-4444-555555555555",
          },
        ],
      },
    ],
  } as unknown as Deck;
}

describe("embeddedImageSources", () => {
  it("collects unique data: URLs in first-seen order", () => {
    expect(embeddedImageSources(deck())).toEqual([png, jpg]);
  });
  it("returns nothing when no image is embedded", () => {
    const d = deck();
    d.slides[0].elements = d.slides[0].elements.filter(
      (e) => e.type !== "image",
    );
    expect(embeddedImageSources(d)).toEqual([]);
  });
});

describe("withoutEmbeddedImages", () => {
  it("removes only embedded image elements and keeps the original intact", () => {
    const d = deck();
    const stripped = withoutEmbeddedImages(d);
    expect(stripped.slides[0].elements.map((e) => e.id)).toEqual(["t1", "i4"]);
    expect(d.slides[0].elements).toHaveLength(5);
  });
});

describe("rewriteImageSources", () => {
  it("rewrites mapped sources and drops unmapped embedded images", () => {
    const url = "/api/decks/x/assets/11111111-2222-3333-4444-555555555555";
    const { deck: out, dropped } = rewriteImageSources(
      deck(),
      new Map([[png, url]]),
    );
    const images = out.slides[0].elements.filter((e) => e.type === "image");
    expect(images.map((e) => e.id)).toEqual(["i1", "i2", "i4"]);
    expect(images[0]).toMatchObject({ src: url });
    expect(images[1]).toMatchObject({ src: url });
    expect(dropped).toBe(1);
  });
  it("keeps asset URLs and text untouched", () => {
    const { deck: out, dropped } = rewriteImageSources(
      deck(),
      new Map([
        [png, "/api/decks/x/assets/a"],
        [jpg, "/api/decks/x/assets/b"],
      ]),
    );
    expect(out.slides[0].elements).toHaveLength(5);
    expect(dropped).toBe(0);
  });
});

describe("dataUrlToFile", () => {
  it("decodes a base64 png data URL into a File", async () => {
    const file = dataUrlToFile(png, "embedded-1");
    expect(file).not.toBeNull();
    expect(file!.name).toBe("embedded-1.png");
    expect(file!.type).toBe("image/png");
    expect(file!.size).toBeGreaterThan(10);
  });
  it("rejects values that are not data URLs", () => {
    expect(dataUrlToFile("https://example.com/a.png", "x")).toBeNull();
    expect(dataUrlToFile("data:image/png;base64,!!!", "x")).toBeNull();
  });
});
