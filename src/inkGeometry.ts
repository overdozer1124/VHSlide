export type InkShape = "line" | "rectangle" | "ellipse";
type Point = { x: number; y: number };
export function inkGeometry(
  tool: InkShape,
  start: Point,
  end: Point,
  constrain = false,
): Point[] {
  let dx = end.x - start.x,
    dy = end.y - start.y;
  if (constrain) {
    if (tool === "line") {
      const length = Math.hypot(dx, dy),
        angle = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
      dx = length * Math.cos(angle);
      dy = length * Math.sin(angle);
    } else {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx < 0 ? -1 : 1) * side;
      dy = (dy < 0 ? -1 : 1) * side;
    }
    // Limit the entire constrained shape rather than clipping individual points.
    const scale = Math.min(
      1,
      dx > 0 ? (960 - start.x) / dx : dx < 0 ? -start.x / dx : 1,
      dy > 0 ? (540 - start.y) / dy : dy < 0 ? -start.y / dy : 1,
    );
    dx *= scale;
    dy *= scale;
  }
  const b = { x: start.x + dx, y: start.y + dy };
  if (tool === "line") return [{ ...start }, b];
  if (tool === "rectangle")
    return [
      { ...start },
      { x: b.x, y: start.y },
      b,
      { x: start.x, y: b.y },
      { ...start },
    ];
  const cx = start.x + dx / 2,
    cy = start.y + dy / 2;
  const points = Array.from({ length: 64 }, (_, i) => ({
    x: cx + (dx / 2) * Math.cos((i * Math.PI) / 32),
    y: cy + (dy / 2) * Math.sin((i * Math.PI) / 32),
  }));
  return [...points, { ...points[0] }];
}
