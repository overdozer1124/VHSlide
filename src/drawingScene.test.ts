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

  it("round-trips text objects and validates them", () => {
    const withText = scene({
      objects: [
        { id: "a", src: JPEG, x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
        {
          id: "t",
          src: "",
          text: "せつめいの文字",
          size: 0.12,
          x: 0.2,
          y: 0.3,
          w: 0.4,
          h: 0.2,
        },
      ],
    });
    const value = serializeDrawingScene(withText, JPEG);
    expect(parseDrawingScene(value)).toEqual(withText);
    expect(validateDrawingValue(value)).toBe(true);
    // A text object carrying an image payload is not storable.
    const withSrc = serializeDrawingScene(
      scene({
        objects: [
          {
            id: "t",
            src: JPEG,
            text: "x",
            x: 0,
            y: 0,
            w: 0.4,
            h: 0.2,
          },
        ],
      }),
      JPEG,
    );
    expect(validateDrawingValue(withSrc)).toBe(false);
    // Overlong text and out-of-range sizes are rejected.
    const longText = serializeDrawingScene(
      scene({
        objects: [
          {
            id: "t",
            src: "",
            text: "あ".repeat(1001),
            x: 0,
            y: 0,
            w: 0.4,
            h: 0.2,
          },
        ],
      }),
      JPEG,
    );
    expect(validateDrawingValue(longText)).toBe(false);
    const badSize = serializeDrawingScene(
      scene({
        objects: [
          {
            id: "t",
            src: "",
            text: "x",
            size: 0.9,
            x: 0,
            y: 0,
            w: 0.4,
            h: 0.2,
          },
        ],
      }),
      JPEG,
    );
    expect(validateDrawingValue(badSize)).toBe(false);
    // Parsing clamps the size and text length instead of failing.
    const parsed = parseDrawingScene(
      JSON.stringify({
        v: 2,
        flat: JPEG,
        objects: [
          {
            id: "t",
            text: "あ".repeat(1500),
            size: 5,
            x: 0,
            y: 0,
            w: 0.4,
            h: 0.2,
          },
        ],
        strokes: "",
      }),
    );
    expect(parsed?.objects[0].text).toHaveLength(1000);
    expect(parsed?.objects[0].size).toBe(0.4);
    expect(parsed?.objects[0].src).toBe("");
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
    // Too many objects (images and text boxes share one total cap).
    const many = {
      objects: Array.from({ length: 13 }, (_, i) => ({
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
