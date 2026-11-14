// スライドに埋め込むWebアプリの参照。URLだけを持つので、作品のコピーや
// JSONの読み込みでもそのまま持ち運べる（サーバー側の状態は持たない）。
// poster は、橋渡しスクリプトを入れた自作アプリが「自分の画面」を撮って
// 渡してきたサムネイル画像（JPEG の data URL）。サムネイル表示では
// アプリ本体を読み込まず、この画像だけを出す。
export type EmbedBinding = {
  url: string;
  poster?: string;
};

/** サムネイル画像を受け入れる最大の長さ（data URL の文字数）。 */
export const EMBED_POSTER_MAX_CHARS = 540_000;
const POSTER_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

const EMBED_ERROR = "埋め込むアプリのURLが正しくありません。";

/** http/https のURLだけを許可し、正規化して返す。 */
export function normalizeEmbedUrl(raw: string): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || text.length > 2048) throw new Error(EMBED_ERROR);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(EMBED_ERROR);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(EMBED_ERROR);
  return url.toString();
}

export function parseEmbedBinding(value: unknown): EmbedBinding {
  const v = value as EmbedBinding;
  if (!v || typeof v.url !== "string") throw new Error(EMBED_ERROR);
  const binding: EmbedBinding = { url: normalizeEmbedUrl(v.url) };
  if (v.poster !== undefined) {
    if (
      typeof v.poster !== "string" ||
      v.poster.length > EMBED_POSTER_MAX_CHARS ||
      !POSTER_PATTERN.test(v.poster)
    )
      throw new Error(EMBED_ERROR);
    binding.poster = v.poster;
  }
  return binding;
}

/** 橋渡しスクリプトから届いた画像が、保存できる形式かどうか。 */
export function isEmbedPoster(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= EMBED_POSTER_MAX_CHARS &&
    POSTER_PATTERN.test(value)
  );
}

/** 表示用の短い名前（ホスト名）。解釈できない場合は空文字。 */
export function embedHostName(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
