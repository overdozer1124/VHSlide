/**
 * Stage 3b: the "previous answer" slide part （前の自分の回答）.
 *
 * A host places this part on a slide and binds it to one earlier
 * answer: a worksheet field, a whole survey, or one scene of a
 * point-type thinking tool. Every viewer sees only their OWN answer
 * — the server keys the lookup by the signed-in account and never
 * returns anyone else's. The host sees a placeholder (the part's
 * place and the source name), never a student's answer.
 *
 * The binding keeps a snapshot of the source title and the field /
 * scene label so the placeholder and the editor can name the source
 * even before (or without) a server round trip; the answer payload
 * itself always comes fresh from the server.
 */
import type { HistorySQL } from "./historyStore.ts";
import { worksheetReasonKey } from "./worksheets.ts";
import { parseThinkingDefinition } from "./thinkingTools.ts";
import type { ThinkingPointValue } from "./thinkingTools.ts";

export type PrevAnswerSource = "worksheet" | "survey" | "thinking";

export type PrevAnswerBinding = {
  deckId: string;
  source: PrevAnswerSource;
  /** worksheetId / surveyId / toolId, in the same deck. */
  refId: string;
  /** Worksheet only: which field. */
  fieldId?: string;
  /** Thinking only: which scene. */
  sceneId?: string;
  /** Snapshot of the source's title (worksheet title / survey
   * question / tool title). */
  title: string;
  /** Snapshot of the field or scene label ("" for surveys). */
  label: string;
};

const UUID = /^[a-f0-9-]{36}$/;

export function parsePrevAnswerBinding(value: unknown): PrevAnswerBinding {
  const v = value as PrevAnswerBinding;
  if (
    !v ||
    typeof v.deckId !== "string" ||
    typeof v.refId !== "string" ||
    !UUID.test(v.deckId) ||
    !UUID.test(v.refId) ||
    (v.source !== "worksheet" && v.source !== "survey" && v.source !== "thinking") ||
    typeof v.title !== "string" ||
    !v.title.trim() ||
    v.title.length > 100 ||
    typeof v.label !== "string" ||
    v.label.length > 100
  )
    throw new Error("前の回答の部品の形式が正しくありません。");
  if (v.source === "worksheet") {
    if (typeof v.fieldId !== "string" || !v.fieldId || v.fieldId.length > 64)
      throw new Error("前の回答の部品の形式が正しくありません。");
    return {
      deckId: v.deckId,
      source: v.source,
      refId: v.refId,
      fieldId: v.fieldId,
      title: v.title,
      label: v.label,
    };
  }
  if (v.source === "thinking") {
    if (typeof v.sceneId !== "string" || !v.sceneId || v.sceneId.length > 64)
      throw new Error("前の回答の部品の形式が正しくありません。");
    return {
      deckId: v.deckId,
      source: v.source,
      refId: v.refId,
      sceneId: v.sceneId,
      title: v.title,
      label: v.label,
    };
  }
  return {
    deckId: v.deckId,
    source: v.source,
    refId: v.refId,
    title: v.title,
    label: v.label,
  };
}

/** Lenient variant for opening a deck (model.parseDeck): a binding
 * this build cannot read is dropped instead of failing the open,
 * mirroring parseThinkingBindingLenient. */
export function parsePrevAnswerBindingLenient(
  value: unknown,
): PrevAnswerBinding | undefined {
  try {
    return parsePrevAnswerBinding(value);
  } catch {
    return undefined;
  }
}

export type PrevAnswerData =
  | {
      source: "worksheet";
      title: string;
      label: string;
      fieldKind: string;
      options: string[];
      value: unknown;
      reason: string;
    }
  | {
      source: "survey";
      title: string;
      surveyKind: string;
      options: string[];
      choices: number[];
      text: string;
    }
  | {
      source: "thinking";
      title: string;
      label: string;
      template: string;
      nameA: string;
      nameB: string;
      value: ThinkingPointValue;
      reason: string;
      /** The tool's unit. Group answers carry the group's name so
       * the part can show the point as the group's, not "mine". */
      unit: string;
      groupName?: string;
      /** Set when the group point shown is the actor's current
       * group's, on a board they have not written on themselves. */
      groupCurrent?: boolean;
    };

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * The signed-in actor's own previous answer for one binding, or null
 * when there is nothing to show (no answer yet, the source is still
 * a draft, or the source/field/scene is gone). Drafts never leak:
 * their definitions are not final and no answers can exist. The
 * lookup is keyed by `actorId` alone — there is no parameter by
 * which another person's answer could be requested.
 */
export function prevAnswerFor(
  sql: HistorySQL,
  deckId: string,
  actorId: string,
  q: { source: string; refId: string; fieldId?: string; sceneId?: string },
): PrevAnswerData | null {
  if (q.source === "worksheet") {
    if (!q.fieldId) return null;
    const row = [
      ...sql(
        "SELECT definition, status FROM worksheets WHERE id = ? AND deck = ?",
        q.refId,
        deckId,
      ),
    ][0];
    if (!row || row.status === "draft") return null;
    const definition = parseJson<{
      title?: string;
      fields?: {
        id: string;
        label: string;
        kind: string;
        options?: string[];
      }[];
    }>(row.definition as string, {});
    const field = (definition.fields ?? []).find((f) => f.id === q.fieldId);
    if (!field) return null;
    const answer = [
      ...sql(
        "SELECT value FROM worksheet_answers WHERE worksheet = ? AND author = ?",
        q.refId,
        actorId,
      ),
    ][0];
    if (!answer) return null;
    const values = parseJson<Record<string, unknown>>(
      answer.value as string,
      {},
    );
    if (!(field.id in values)) return null;
    return {
      source: "worksheet",
      title: String(definition.title ?? ""),
      label: field.label,
      fieldKind: field.kind,
      options: field.options ?? [],
      value: values[field.id],
      reason: String(values[worksheetReasonKey(field.id)] ?? ""),
    };
  }
  if (q.source === "survey") {
    const row = [
      ...sql(
        "SELECT question, kind, options, status FROM surveys WHERE id = ? AND deck = ?",
        q.refId,
        deckId,
      ),
    ][0];
    if (!row || row.status === "draft") return null;
    const answer = [
      ...sql(
        "SELECT value FROM survey_answers WHERE survey = ? AND author = ?",
        q.refId,
        actorId,
      ),
    ][0];
    if (!answer) return null;
    const value = parseJson<{ choices?: number[]; text?: string }>(
      answer.value as string,
      {},
    );
    return {
      source: "survey",
      title: String(row.question ?? ""),
      surveyKind: String(row.kind ?? ""),
      options: parseJson<string[]>(row.options as string, []),
      choices: Array.isArray(value.choices) ? value.choices : [],
      text: String(value.text ?? ""),
    };
  }
  if (q.source === "thinking") {
    if (!q.sceneId) return null;
    const row = [
      ...sql(
        "SELECT kind, template, unit, definition, status FROM thinking_tools WHERE id = ? AND deck = ?",
        q.refId,
        deckId,
      ),
    ][0];
    if (!row || row.status === "draft" || row.kind !== "point") return null;
    let definition;
    try {
      definition = parseThinkingDefinition(
        row.template as string,
        parseJson(row.definition as string, {}),
      ).definition;
    } catch {
      return null;
    }
    if (!definition) return null;
    const scene = (definition.scenes ?? []).find((s) => s.id === q.sceneId);
    if (!scene) return null;
    // A point's owner is its holder; `author` is only the last
    // writer (the host may move a student's point, which changes
    // author, not owner). Individual and class points are the
    // student's own, keyed by owner. Group points belong to the
    // group (owner = group id) and follow the 学びの記録 rule: the
    // board the actor actually wrote on (newest first); if they
    // never wrote on one, their current group's board, marked.
    const unit = String(row.unit ?? "");
    if (unit === "group") {
      let point = [
        ...sql(
          "SELECT owner, value, reason FROM thinking_points WHERE tool = ? AND scene = ? AND author = ? ORDER BY updated DESC LIMIT 1",
          q.refId,
          q.sceneId,
          actorId,
        ),
      ][0];
      let groupCurrent = false;
      if (!point) {
        const grp = [
          ...sql(
            "SELECT grp AS id FROM deck_group_members WHERE deck = ? AND user = ?",
            deckId,
            actorId,
          ),
        ][0];
        if (grp) {
          point = [
            ...sql(
              "SELECT owner, value, reason FROM thinking_points WHERE tool = ? AND scene = ? AND owner = ? LIMIT 1",
              q.refId,
              q.sceneId,
              String(grp.id),
            ),
          ][0];
          groupCurrent = !!point;
        }
      }
      if (!point) return null;
      const group = [
        ...sql(
          "SELECT name FROM deck_groups WHERE id = ? AND deck = ?",
          String(point.owner),
          deckId,
        ),
      ][0];
      return {
        source: "thinking",
        title: String(definition.title ?? ""),
        label: scene.label,
        template: String(row.template ?? ""),
        nameA: String(definition.nameA ?? ""),
        nameB: String(definition.nameB ?? ""),
        value: parseJson<ThinkingPointValue>(point.value as string, {}),
        reason: String(point.reason ?? ""),
        unit,
        groupName: group ? String(group.name) : "班",
        ...(groupCurrent ? { groupCurrent: true } : {}),
      };
    }
    const point = [
      ...sql(
        "SELECT value, reason FROM thinking_points WHERE tool = ? AND scene = ? AND owner = ? LIMIT 1",
        q.refId,
        q.sceneId,
        actorId,
      ),
    ][0];
    if (!point) return null;
    return {
      source: "thinking",
      title: String(definition.title ?? ""),
      label: scene.label,
      template: String(row.template ?? ""),
      nameA: String(definition.nameA ?? ""),
      nameB: String(definition.nameB ?? ""),
      value: parseJson<ThinkingPointValue>(point.value as string, {}),
      reason: String(point.reason ?? ""),
      unit,
    };
  }
  return null;
}
