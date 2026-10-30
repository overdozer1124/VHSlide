import type { InkStroke } from "./InkObject";
import type { InkShape } from "./inkGeometry";
export type InkDash = "solid" | "dash" | "dot";
export function inkDash(dash: InkDash | undefined, width: number): number[] {
  return dash === "dash"
    ? [width * 4, width * 3]
    : dash === "dot"
      ? [0.01, width * 2.5]
      : [];
}
// Recognize geometry created before shape metadata was introduced.
export function inkShapeKind(s: InkStroke): InkShape | undefined {
  if (s.erase || s.fillContours) return;
  if (s.shape) return s.shape;
  const p = s.points,
    near = (a: number, b: number) => Math.abs(a - b) < 1e-5;
  if (p.length === 2) return "line";
  if (!p.length || !near(p[0].x, p.at(-1)!.x) || !near(p[0].y, p.at(-1)!.y))
    return;
  if (
    p.length === 5 &&
    p.slice(0, 4).every((a, i) => {
      const b = p[i + 1];
      return near(a.x, b.x) || near(a.y, b.y);
    })
  )
    return "rectangle";
  if (p.length === 65) {
    const cx = (p[0].x + p[32].x) / 2,
      cy = (p[16].y + p[48].y) / 2,
      rx = (p[0].x - p[32].x) / 2,
      ry = (p[16].y - p[48].y) / 2;
    if (
      p
        .slice(0, 64)
        .every(
          (a, i) =>
            near(a.x, cx + rx * Math.cos((i * Math.PI) / 32)) &&
            near(a.y, cy + ry * Math.sin((i * Math.PI) / 32)),
        )
    )
      return "ellipse";
  }
}
