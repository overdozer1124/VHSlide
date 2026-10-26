export type ImageCrop = { x: number; y: number; w: number; h: number };
export function parseCrop(value: unknown): ImageCrop {
  const c = value as ImageCrop;
  if (
    !c ||
    typeof c !== "object" ||
    ![c.x, c.y, c.w, c.h].every(Number.isFinite) ||
    c.x < 0 ||
    c.y < 0 ||
    c.w < 0.00001 ||
    c.h < 0.00001 ||
    c.x + c.w > 1.000001 ||
    c.y + c.h > 1.000001
  )
    throw new Error("画像の切り抜き範囲が正しくありません。");
  return { x: c.x, y: c.y, w: c.w, h: c.h };
}
export function coverCrop(
  sourceRatio: number,
  frameRatio: number,
  zoom = 1,
  fx = 0.5,
  fy = 0.5,
): ImageCrop {
  const w = Math.min(1, frameRatio / sourceRatio) / zoom,
    h = Math.min(1, sourceRatio / frameRatio) / zoom;
  return parseCrop({
    x: Math.max(0, Math.min(1, fx)) * (1 - w),
    y: Math.max(0, Math.min(1, fy)) * (1 - h),
    w,
    h,
  });
}
