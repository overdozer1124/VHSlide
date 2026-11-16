import { parseThinkingDefinition } from "./thinkingTools.ts";
import type {
  ThinkingDefinition,
  ThinkingTemplate,
  ThinkingUnit,
} from "./thinkingTools.ts";

export type ThinkingBinding = {
  deckId: string;
  toolId: string;
  title: string;
  template: ThinkingTemplate;
  unit: ThinkingUnit;
  /** A snapshot of the tool definition at placement time. The live tool
   * (looked up in the thinking context) wins whenever it is available;
   * the snapshot exists so a copied deck can re-register the tool under
   * its own deck (form adoption), exactly like worksheet bindings. */
  definition: ThinkingDefinition;
};
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
    v.title.length > 100 ||
    (v.unit !== "individual" && v.unit !== "group" && v.unit !== "class")
  ) {
    throw new Error("スライド内思考ツールの形式が正しくありません。");
  }
  const { template, definition } = parseThinkingDefinition(
    v.template,
    v.definition,
  );
  return {
    deckId: v.deckId,
    toolId: v.toolId,
    title: v.title,
    template,
    unit: v.unit,
    definition,
  };
}
