import { inkDash } from "./inkStyle";
import type { InkStroke } from "./InkObject";
type Point = { x: number; y: number };
// Fixed logical resolution bounds work independently of display zoom.
export function fillInk(strokes: InkStroke[], seed: Point): Point[][] {
  const w = 480,
    h = 270;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.scale(0.5, 0.5);
  ctx.lineCap = ctx.lineJoin = "round";
  for (const s of strokes) {
    if (s.fillContours) continue;
    ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
    ctx.beginPath();
    ctx.lineWidth = s.width;
    ctx.setLineDash(inkDash(s.dash, s.width));
    s.points.forEach((p, i) =>
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
    );
    if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.01, s.points[0].y);
    ctx.stroke();
  }
  const pixels = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h),
    queue = new Int32Array(w * h);
  const sx = Math.min(w - 1, Math.floor(seed.x / 2)),
    sy = Math.min(h - 1, Math.floor(seed.y / 2));
  const start = sy * w + sx;
  if (pixels[start * 4 + 3] > 32) return [];
  let head = 0,
    tail = 1;
  queue[0] = start;
  mask[start] = 1;
  while (head < tail) {
    const p = queue[head++],
      x = p % w,
      y = Math.floor(p / w);
    for (const n of [
      x > 0 ? p - 1 : -1,
      x < w - 1 ? p + 1 : -1,
      y > 0 ? p - w : -1,
      y < h - 1 ? p + w : -1,
    ]) {
      if (n >= 0 && !mask[n] && pixels[n * 4 + 3] <= 32) {
        mask[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  const edges = new Map<number, number[]>(),
    stride = w + 1;
  const edge = (a: number, b: number) =>
    edges.set(a, [...(edges.get(a) ?? []), b]);
  for (let i = 0; i < tail; i++) {
    const p = queue[i],
      x = p % w,
      y = Math.floor(p / w),
      a = y * stride + x;
    if (!y || !mask[p - w]) edge(a, a + 1);
    if (x === w - 1 || !mask[p + 1]) edge(a + 1, a + stride + 1);
    if (y === h - 1 || !mask[p + w]) edge(a + stride + 1, a + stride);
    if (!x || !mask[p - 1]) edge(a + stride, a);
  }
  const contours: Point[][] = [];
  let count = 0;
  while (edges.size) {
    const first = edges.keys().next().value!;
    let p = first;
    const polygon: Point[] = [];
    do {
      const next = edges.get(p);
      if (!next?.length) break;
      polygon.push({ x: (p % stride) * 2, y: Math.floor(p / stride) * 2 });
      const q = next.pop()!;
      if (!next.length) edges.delete(p);
      p = q;
    } while (p !== first);
    const simple = polygon.filter((b, i) => {
      const a = polygon[(i + polygon.length - 1) % polygon.length],
        c = polygon[(i + 1) % polygon.length];
      return (b.x - a.x) * (c.y - b.y) !== (b.y - a.y) * (c.x - b.x);
    });
    count += simple.length;
    if (count > 40000) return [];
    if (simple.length >= 3) contours.push(simple);
  }
  return contours;
}
