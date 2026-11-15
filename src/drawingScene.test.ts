import { describe, expect, it } from "vitest";
import {
  drawingFlatSrc,
  drawingValueToScene,
  isDrawingSceneValue,
  parseDrawingScene,
  serializeDrawingScene,
  validateDrawingValue,
  type DrawingScene,
} from "./drawingScene";

const JPEG = "data:image/jpeg;base64,/9j/AAAA";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

function scene(overrides: Partial<DrawingScene> = {}): DrawingScene {
  return {
    objects: [
      { id: "a", src: JPEG, x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
      { id: "b", src: PNG, x: 0.4, y: 0.5, w: 0.3, h: 0.3 },
    ],
    strokes: "",
    ...overrides,
  };
}

describe("drawing scenes", () => {
  it("treats legacy JPEG values as one full-frame object", () => {
    expect(isDrawingSceneValue(JPEG)).toBe(false);
    expect(drawingValueToScene(JPEG)).toEqual({
      objects: [{ id: "legacy", src: JPEG, x: 0, y: 0, w: 1, h: 1 }],
      strokes: "",
    });
    expect(drawingFlatSrc(JPEG)).toBe(JPEG);
    expect(drawingValueToScene("")).toEqual({ objects: [], strokes: "" });
    expect(drawingFlatSrc("")).toBe("");
  });

  it("round-trips a scene through serialize and parse", () => {
    const value = serializeDrawingScene(scene({ strokes: PNG }), JPEG);
    expect(isDrawingSceneValue(value)).toBe(true);
    expect(parseDrawingScene(value)).toEqual(scene({ strokes: PNG }));
    expect(drawingFlatSrc(value)).toBe(JPEG);
    expect(serializeDrawingScene({ objects: [], strokes: "" }, JPEG)).toBe("");
  });

  it("rejects malformed scenes when parsing", () => {
    expect(parseDrawingScene("{}")).toBeNull();
    expect(parseDrawingScene('{"v":1,"objects":[]}')).toBeNull();
    expect(
      parseDrawingScene(
        '{"v":2,"objects":[{"id":"a","src":"https://x","x":0,"y":0,"w":1,"h":1}]}',
      ),
    ).toBeNull();
    expect(parseDrawingScene("not json")).toBeNull();
  });

  it("validates stored values", () => {
    expect(validateDrawingValue("")).toBe(true);
    expect(validateDrawingValue(JPEG)).toBe(true);
    expect(validateDrawingValue("data:image/png;base64,iVBORw0KGgo=")).toBe(
      false,
    );
    expect(validateDrawingValue(serializeDrawingScene(scene(), JPEG))).toBe(
      true,
    );
    expect(
      validateDrawingValue(
        serializeDrawingScene(scene({ strokes: PNG }), JPEG),
      ),
    ).toBe(true);
    // A scene without a valid flat preview is not storable.
    expect(validateDrawingValue('{"v":2,"flat":"","objects":[]}')).toBe(
      false,
    );
    // Too many objects.
    const many = {
      objects: Array.from({ length: 7 }, (_, i) => ({
        id: `o${i}`,
        src: JPEG,
        x: 0,
        y: 0,
        w: 0.5,
        h: 0.5,
      })),
      strokes: "",
    };
    expect(validateDrawingValue(serializeDrawingScene(many, JPEG))).toBe(
      false,
    );
    // Out-of-range geometry.
    const bad = scene();
    bad.objects[0].w = 3;
    expect(validateDrawingValue(serializeDrawingScene(bad, JPEG))).toBe(
      false,
    );
    // Oversize flat preview.
    const bigFlat = `data:image/jpeg;base64,/9j/${"A".repeat(120_001)}`;
    expect(
      validateDrawingValue(serializeDrawingScene(scene(), bigFlat)),
    ).toBe(false);
    expect(validateDrawingValue(42)).toBe(false);
    expect(validateDrawingValue(undefined)).toBe(false);
  });
});
