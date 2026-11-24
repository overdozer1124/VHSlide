import { describe, expect, it } from "vitest";
import { pdfPageSlides } from "./pdfImport";
import { H, W } from "./model";

describe("pdfPageSlides", () => {
  it("fits a landscape page into the slide, centred", () => {
    const [slide] = pdfPageSlides([
      { src: "data:image/jpeg;base64,x", width: 1440, height: 810 },
    ]);
    const image = slide.elements[0];
    expect(image.type).toBe("image");
    if (image.type !== "image") throw new Error("not an image");
    expect(image.w).toBeLessThanOrEqual(W);
    expect(image.h).toBeLessThanOrEqual(H);
    expect(image.x).toBe(Math.round((W - image.w) / 2));
    expect(slide.background).toBe("#ffffff");
  });

  it("fits a portrait page by height", () => {
    const [slide] = pdfPageSlides([
      { src: "data:image/jpeg;base64,x", width: 620, height: 877 },
    ]);
    const image = slide.elements[0];
    if (image.type !== "image") throw new Error("not an image");
    expect(image.h).toBe(H);
    expect(image.w).toBeLessThan(W);
  });
});
