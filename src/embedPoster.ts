import { isEmbedPoster } from "./embedBinding";

/**
 * Turning a user-picked image into an embed thumbnail (poster).
 * Apps that cannot send their own snapshot (no bridge script) get
 * their map thumbnail this way: the teacher picks an image and it
 * is stored on the element, shrunk and re-encoded as a JPEG data
 * URL that fits the poster's size cap.
 */
export const POSTER_MAX_WIDTH = 960;
export const POSTER_MAX_HEIGHT = 540;

/** Fit a source image inside the poster box; never upscale. */
export function posterTargetSize(
  width: number,
  height: number,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const scale = Math.min(
    1,
    POSTER_MAX_WIDTH / width,
    POSTER_MAX_HEIGHT / height,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

type LoadedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Some formats (e.g. SVG) cannot go through createImageBitmap
      // in every browser; fall through to the <img> path.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("load"));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("画像を読み込めませんでした。");
  }
}

/**
 * Encode the picked image as a poster data URL. Quality steps down
 * first, then the dimensions shrink, until the result fits the
 * poster cap; throws when even a small, coarse copy cannot fit.
 */
export async function fileToEmbedPoster(file: File): Promise<string> {
  const loaded = await loadImage(file);
  try {
    let { width, height } = posterTargetSize(loaded.width, loaded.height);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像を変換できませんでした。");
    for (let round = 0; round < 5; round++) {
      canvas.width = width;
      canvas.height = height;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(loaded.source, 0, 0, width, height);
      for (const quality of [0.82, 0.7, 0.58, 0.46, 0.34]) {
        const url = canvas.toDataURL("image/jpeg", quality);
        if (isEmbedPoster(url)) return url;
      }
      width = Math.max(1, Math.round(width * 0.7));
      height = Math.max(1, Math.round(height * 0.7));
      if (width < 120) break;
    }
    throw new Error("画像が大きすぎて、サムネイルにできませんでした。");
  } finally {
    loaded.close();
  }
}
