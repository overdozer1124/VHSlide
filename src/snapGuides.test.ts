import { describe, expect, it } from "vitest";
import type { Element } from "./model";
import {
  collectSnapTargets,
  snapMoveDelta,
  snapResizeDelta,
} from "./snapGuides";

const el = (id: string, x: number, y: number, w: number, h: number): Element =>
  ({
    id,
    type: "shape",
    shape: "rect",
    x,
    y,
    w,
    h,
    fill: "#ffffff",
    stroke: "#173d38",
  }) as Element;

describe("collectSnapTargets", () => {
  it("includes slide lines and other elements' edges and centres", () => {
    const targets = collectSnapTargets(
      [el("a", 100, 100, 200, 120), el("b", 500, 300, 100, 60)],
      new Set(["b"]),
    );
    expect(targets.xs).toEqual(expect.arrayContaining([0, 480, 960]));
    expect(targets.xs).toEqual(expect.arrayContaining([100, 200, 300]));
    expect(targets.xs).not.toContain(500);
    expect(targets.ys).toEqual(expect.arrayContaining([100, 160, 220]));
  });
});

describe("snapMoveDelta", () => {
  const targets = collectSnapTargets([el("ref", 100, 100, 200, 120)], new Set());
  it("snaps the moving left edge onto the reference right edge", () => {
    // Moving box at x=500 dragged to x=304: 4 units past the target 300.
    const r = snapMoveDelta({ x: 500, y: 300, w: 100, h: 60 }, -196, 0, targets);
    expect(r.dx).toBe(-200);
    expect(r.guideX).toBe(300);
    expect(r.guideY).toBeUndefined();
  });
  it("snaps centres together", () => {
    // Centre of the moving box (350) dragged to 204: 4 from ref centre 200.
    const r = snapMoveDelta({ x: 300, y: 300, w: 100, h: 60 }, -146, 0, targets);
    expect(r.dx).toBe(-150);
    expect(r.guideX).toBe(200);
  });
  it("keeps the slide-centre snap", () => {
    const r = snapMoveDelta({ x: 300, y: 300, w: 100, h: 60 }, 126, 0, targets);
    expect(r.guideX).toBe(480);
    expect(r.dx).toBe(130);
  });
  it("does not snap beyond the threshold", () => {
    const r = snapMoveDelta({ x: 500, y: 300, w: 100, h: 60 }, -180, 0, targets);
    expect(r.dx).toBe(-180);
    expect(r.guideX).toBeUndefined();
  });
});

describe("snapResizeDelta", () => {
  const targets = collectSnapTargets([el("ref", 400, 100, 200, 120)], new Set());
  it("snaps the east edge onto the reference left edge", () => {
    // Box at x=60 w=100: east edge dragged from 160 to 396, target 400.
    const r = snapResizeDelta({ x: 60, y: 300, w: 100, h: 60 }, "e", 236, 0, targets);
    expect(r.dx).toBe(240);
    expect(r.guideX).toBe(400);
  });
  it("snaps the west edge", () => {
    const r = snapResizeDelta({ x: 500, y: 300, w: 100, h: 60 }, "w", 96, 0, targets);
    // West edge 596 -> no target within 7 (600 is ref right edge: adjust 4).
    expect(r.dx).toBe(100);
    expect(r.guideX).toBe(600);
  });
  it("snaps both axes on a corner when unlocked", () => {
    const r = snapResizeDelta({ x: 60, y: 300, w: 100, h: 60 }, "se", 236, -76, targets);
    expect(r.guideX).toBe(400);
    // South edge 360-76=284: nearest y target is 270 (slide centre), adjust -14 — out of range; 220 is 64 away.
    expect(r.guideY).toBeUndefined();
  });
  it("with the aspect locked, only the driving axis snaps", () => {
    const both = collectSnapTargets(
      [el("ref", 400, 100, 200, 120), el("low", 60, 416, 10, 10)],
      new Set(),
    );
    // East edge 160+236=396 -> 400; south edge 360+50=410 -> no target near.
    const r = snapResizeDelta({ x: 60, y: 300, w: 100, h: 60 }, "se", 236, 50, both, true);
    expect(r.guideX).toBe(400);
    expect(r.dx).toBe(240);
  });
});
