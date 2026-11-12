export type WebbingBinding = {
  deckId: string;
  mapId: string;
  title: string;
};
/** Only a title snapshot and scoped reference are portable; the nodes and
 * their authorship stay server-side and are never imported. */
export function parseWebbingBinding(value: unknown): WebbingBinding {
  const v = value as WebbingBinding;
  if (
    !v ||
    typeof v.deckId !== "string" ||
    typeof v.mapId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(v.deckId) ||
    !/^[a-f0-9-]{36}$/.test(v.mapId) ||
    typeof v.title !== "string" ||
    !v.title.trim() ||
    v.title.length > 100
  ) {
    throw new Error("スライド内ウェビングマップの形式が正しくありません。");
  }
  return { deckId: v.deckId, mapId: v.mapId, title: v.title };
}
