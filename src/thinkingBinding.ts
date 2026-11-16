export type ThinkingBinding = {
  deckId: string;
  toolId: string;
  title: string;
};
/** Only a title snapshot and scoped reference are portable; the points
 * and their authorship stay server-side and are never imported. */
export function parseThinkingBinding(value: unknown): ThinkingBinding {
  const v = value as ThinkingBinding;
  if (
    !v ||
    typeof v.deckId !== "string" ||
    typeof v.toolId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(v.deckId) ||
    !/^[a-f0-9-]{36}$/.test(v.toolId) ||
    typeof v.title !== "string" ||
    !v.title.trim() ||
    v.title.length > 100
  ) {
    throw new Error("スライド内思考ツールの形式が正しくありません。");
  }
  return { deckId: v.deckId, toolId: v.toolId, title: v.title };
}
