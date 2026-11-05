import { describe, expect, it } from "vitest";
import { dataUrlToFile } from "./pptx";

describe("dataUrlToFile", () => {
  it("decodes an embedded PNG into a named typed file", async () => {
    // 1x1 transparent PNG
    const src =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const file = dataUrlToFile(src, "pptx-image-1");
    expect(file?.name).toBe("pptx-image-1.png");
    expect(file?.type).toBe("image/png");
    expect(file?.size).toBe(70);
    const bytes = new Uint8Array(await file!.arrayBuffer());
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it("maps jpeg to a .jpg file and keeps other formats", () => {
    const jpeg = dataUrlToFile("data:image/jpeg;base64,/9j/4AAQ", "a");
    expect(jpeg?.name).toBe("a.jpg");
    expect(jpeg?.type).toBe("image/jpeg");
    const webp = dataUrlToFile("data:image/webp;base64,UklGRg==", "b");
    expect(webp?.name).toBe("b.webp");
    expect(webp?.type).toBe("image/webp");
  });

  it("rejects asset URLs, remote URLs and unsupported payloads", () => {
    expect(
      dataUrlToFile(
        "/api/decks/x/assets/00000000-0000-0000-0000-000000000000",
        "a",
      ),
    ).toBeUndefined();
    expect(dataUrlToFile("https://example.com/a.png", "a")).toBeUndefined();
    expect(
      dataUrlToFile("data:image/svg+xml;base64,PHN2Zz4=", "a"),
    ).toBeUndefined();
    expect(dataUrlToFile("data:text/plain;base64,aGk=", "a")).toBeUndefined();
  });
});
