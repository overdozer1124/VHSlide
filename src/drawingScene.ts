/**
 * 画像・手描き回答の「シーン」形式。
 *
 * 従来の値は合成済みJPEGのdata URL文字列そのものだった。シーン形式では
 * 配置した画像をオブジェクト（位置・大きさ）として保持し、手描きは
 * 透明な1層に分けることで、再編集しても画像を動かしたり大きさを
 * 変えたりできる。表示側のために合成済み画像（flat）も一緒に持つ。
 *
 * 値の形:
 *   ""                       未回答
 *   "data:image/jpeg;..."    旧形式（合成済みJPEGそのもの）
 *   "{...}"                  シーン形式JSON { v:2, flat, objects, strokes }
 *
 * 座標はキャンバスに対する割合（0..1）。この モジュールは DOM に
 * 依存しない（サーバーの検証からも使う）。
 */

export interface DrawingObject {
  id: string;
  /** 画像オブジェクトの画像。テキストオブジェクトでは ""。 */
  src: string;
  /** テキストオブジェクトの文字。これがあるものがテキストオブジェクト。 */
  text?: string;
  /** テキストの大きさ（キャンバス高さに対する割合）。テキスト用。 */
  size?: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function isTextObject(o: DrawingObject): boolean {
  return o.text !== undefined;
}

export interface DrawingScene {
  objects: DrawingObject[];
  /** 手描き層（透明PNGのdata URL）。無ければ ""。 */
  strokes: string;
}

export const DRAWING_VALUE_MAX = 480_000;
export const DRAWING_FLAT_MAX = 120_000;
export const DRAWING_OBJECT_MAX_COUNT = 6;
export const DRAWING_OBJECT_TOTAL_MAX = 12;
export const DRAWING_OBJECT_SRC_MAX = 120_000;
export const DRAWING_STROKES_MAX = 80_000;
export const DRAWING_TEXT_MAX = 1000;
export const DRAWING_TEXT_SIZE_DEFAULT = 0.09;
export const DRAWING_TEXT_SIZE_MIN = 0.03;
export const DRAWING_TEXT_SIZE_MAX = 0.4;

export const LEGACY_JPEG_PATTERN =
  /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/;
const OBJECT_SRC_PATTERN = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]*={0,2}$/;
const STROKES_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/;

export function emptyDrawingScene(): DrawingScene {
  return { objects: [], strokes: "" };
}

export function isDrawingSceneValue(value: string): boolean {
  return value.startsWith("{");
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 構造を検証しながらシーンとして読み取る。不正なら null。 */
export function parseDrawingScene(value: string): DrawingScene | null {
  if (!isDrawingSceneValue(value)) return null;
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.v !== 2 || !Array.isArray(record.objects)) return null;
  const objects: DrawingObject[] = [];
  for (const item of record.objects) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string") return null;
    const geometry = {
      id: o.id.slice(0, 40),
      x: clamp(finite(o.x, 0), -0.5, 1),
      y: clamp(finite(o.y, 0), -0.5, 1),
      w: clamp(finite(o.w, 1), 0.02, 1.5),
      h: clamp(finite(o.h, 1), 0.02, 1.5),
    };
    if (typeof o.text === "string") {
      objects.push({
        ...geometry,
        src: "",
        text: o.text.slice(0, DRAWING_TEXT_MAX),
        size: clamp(
          finite(o.size, DRAWING_TEXT_SIZE_DEFAULT),
          DRAWING_TEXT_SIZE_MIN,
          DRAWING_TEXT_SIZE_MAX,
        ),
      });
      continue;
    }
    if (typeof o.src !== "string" || !OBJECT_SRC_PATTERN.test(o.src))
      return null;
    objects.push({ ...geometry, src: o.src });
  }
  const strokes =
    typeof record.strokes === "string" && STROKES_PATTERN.test(record.strokes)
      ? record.strokes
      : "";
  return { objects, strokes };
}

/** 保存値（旧形式を含む）を編集用シーンに変換する。 */
export function drawingValueToScene(value: string): DrawingScene {
  if (!value) return emptyDrawingScene();
  const scene = parseDrawingScene(value);
  if (scene) return scene;
  // 旧形式: 合成済み画像を全面の1オブジェクトとして扱う。
  return {
    objects: [{ id: "legacy", src: value, x: 0, y: 0, w: 1, h: 1 }],
    strokes: "",
  };
}

/** 表示用の合成済み画像URLを取り出す（旧形式はそのまま）。 */
export function drawingFlatSrc(value: string): string {
  if (!value) return "";
  if (!isDrawingSceneValue(value)) return value;
  try {
    const data = JSON.parse(value) as Record<string, unknown>;
    return typeof data.flat === "string" ? data.flat : "";
  } catch {
    return "";
  }
}

export function serializeDrawingScene(
  scene: DrawingScene,
  flat: string,
): string {
  if (scene.objects.length === 0 && !scene.strokes) return "";
  return JSON.stringify({
    v: 2,
    flat,
    objects: scene.objects,
    strokes: scene.strokes,
  });
}

export function isEmptyDrawingScene(scene: DrawingScene): boolean {
  return scene.objects.length === 0 && !scene.strokes;
}

/** 回答値としての妥当性（サーバー側の検証と共有）。 */
export function validateDrawingValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value === "") return true;
  if (!isDrawingSceneValue(value))
    return (
      value.length <= DRAWING_FLAT_MAX && LEGACY_JPEG_PATTERN.test(value)
    );
  if (value.length > DRAWING_VALUE_MAX) return false;
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    return false;
  }
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  if (record.v !== 2) return false;
  if (
    typeof record.flat !== "string" ||
    record.flat.length > DRAWING_FLAT_MAX ||
    !LEGACY_JPEG_PATTERN.test(record.flat)
  )
    return false;
  if (
    !Array.isArray(record.objects) ||
    record.objects.length > DRAWING_OBJECT_TOTAL_MAX
  )
    return false;
  for (const item of record.objects) {
    if (!item || typeof item !== "object") return false;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || o.id.length > 40) return false;
    if (o.text !== undefined) {
      if (
        typeof o.text !== "string" ||
        o.text.length > DRAWING_TEXT_MAX ||
        (o.src !== undefined && o.src !== "") ||
        (o.size !== undefined &&
          (typeof o.size !== "number" ||
            !Number.isFinite(o.size) ||
            o.size < DRAWING_TEXT_SIZE_MIN ||
            o.size > DRAWING_TEXT_SIZE_MAX))
      )
        return false;
    } else if (
      typeof o.src !== "string" ||
      o.src.length > DRAWING_OBJECT_SRC_MAX ||
      !OBJECT_SRC_PATTERN.test(o.src)
    )
      return false;
    for (const key of ["x", "y"] as const) {
      const n = o[key];
      if (typeof n !== "number" || !Number.isFinite(n) || n < -0.5 || n > 1)
        return false;
    }
    for (const key of ["w", "h"] as const) {
      const n = o[key];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0.02 || n > 1.5)
        return false;
    }
  }
  if (
    typeof record.strokes !== "string" ||
    record.strokes.length > DRAWING_STROKES_MAX ||
    (record.strokes !== "" && !STROKES_PATTERN.test(record.strokes))
  )
    return false;
  return true;
}
