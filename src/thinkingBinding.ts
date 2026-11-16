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

/** Lenient variant for opening a deck (model.parseDeck): a binding
 * written by a newer version — an unknown template (stage 2's board
 * kinds) or a definition this version cannot validate — must not make
 * the whole deck fail to open. Identity fields stay strict; the
 * definition falls back to an empty snapshot and the element renders
 * as a quiet preview until a version that knows the tool opens it
 * (review 2026-11-17 🟡6). Form adoption keeps the strict parser. */
export function parseThinkingBindingLenient(value: unknown): ThinkingBinding {
  try {
    return parseThinkingBinding(value);
  } catch {
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
      (v.unit !== "individual" && v.unit !== "group" && v.unit !== "class") ||
      typeof v.template !== "string" ||
      !v.template
    ) {
      throw new Error("スライド内思考ツールの形式が正しくありません。");
    }
    return {
      deckId: v.deckId,
      toolId: v.toolId,
      title: v.title,
      template: v.template as ThinkingTemplate,
      unit: v.unit,
      definition: {
        title: v.title,
        xMin: "",
        xMax: "",
        yMin: "",
        yMax: "",
        scale: "none",
        vertical: false,
        nameA: "",
        nameB: "",
        scenes: [],
        sceneMode: "teacher",
        reason: false,
      },
    };
  }
}
