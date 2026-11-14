// スライドに埋め込むWebアプリの参照。URLだけを持つので、作品のコピーや
// JSONの読み込みでもそのまま持ち運べる（サーバー側の状態は持たない）。
export type EmbedBinding = {
  url: string;
};

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
  return { url: normalizeEmbedUrl(v.url) };
}

/** 表示用の短い名前（ホスト名）。解釈できない場合は空文字。 */
export function embedHostName(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
