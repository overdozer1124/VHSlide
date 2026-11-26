import { describe, expect, it } from "vitest";
import {
  POSTER_MAX_HEIGHT,
  POSTER_MAX_WIDTH,
  posterTargetSize,
} from "./embedPoster";

describe("posterTargetSize", () => {
  it("keeps small images at their natural size", () => {
    expect(posterTargetSize(320, 180)).toEqual({ width: 320, height: 180 });
  });

  it("fits wide images by width", () => {
    expect(posterTargetSize(1920, 1080)).toEqual({
      width: POSTER_MAX_WIDTH,
      height: POSTER_MAX_HEIGHT,
    });
  });

  it("fits tall images by height and keeps the aspect ratio", () => {
    const size = posterTargetSize(600, 1200);
    expect(size.height).toBe(POSTER_MAX_HEIGHT);
    expect(size.width).toBe(270);
  });

  it("never returns a zero dimension", () => {
    expect(posterTargetSize(0, 0)).toEqual({ width: 1, height: 1 });
    expect(posterTargetSize(10000, 1).height).toBeGreaterThanOrEqual(1);
  });
});
