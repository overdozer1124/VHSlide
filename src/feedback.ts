import type { HistorySQL } from "./historyStore.ts";
import { effectiveGroupId } from "./groups.ts";

/** Teacher feedback and send-backs (student-input plan §4.3). One
 * generic table serves every answer kind; stage 2a wires it to
 * free-edit slides (target_kind "editslide", target_id = the
 * definition id, owner = the student's user id), and the worksheet /
 * survey / thinking kinds can join later without a schema change.
 *
 * Rules settled in the stage-2 design review (PR #11, 2026-11-24):
 * - only the host sends; a row is visible to its owner and the host;
 * - text is at most 200 characters, the stamp is one of a fixed set,
 *   and caps are 50 rows per answer and 5,000 per deck (413 past);
 * - a send-back (reopen) stays in force until the host cancels it or
 *   the student presses "出し直す" (resubmit) — it is NOT consumed
 *   by the first save, because saves are automatic every few
 *   seconds. reopen values: 0 none, 1 active, 2 closed by resubmit,
 *   3 closed by host cancel;
 * - delivery rides its own small poll counter ("editfeedback"), and
 *   a student only ever receives their own rows. */
export class FeedbackError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const insist = (ok: unknown, status: number, message: string): void => {
  if (!ok) throw new FeedbackError(status, message);
};

const feedbackBump = (alias: "NEW" | "OLD", feature: string) =>
  `INSERT INTO feature_versions(deck,feature,version) VALUES(${alias}.deck,'${feature}',1) ON CONFLICT(deck,feature) DO UPDATE SET version=version+1;`;
/** Feedback moves two poll counters: "editfeedback" (the rows
 * themselves) and "editanswers" (the host console's answer overview,
 * whose cards carry the send-back / resubmitted flags — they must
 * refresh while the console stays open). A read_at-only update
 * moves neither: the reader gets the fresh rows in the command's
 * response, and read receipts are not urgent for the host. */
export const feedbackSchema =
  `
CREATE TABLE IF NOT EXISTS form_feedback(id TEXT PRIMARY KEY, deck TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, owner TEXT NOT NULL, text TEXT NOT NULL, stamp TEXT NOT NULL, reopen INTEGER NOT NULL, created INTEGER NOT NULL, read_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS fv_form_feedback_ins AFTER INSERT ON form_feedback BEGIN ${feedbackBump("NEW", "editfeedback")} ${feedbackBump("NEW", "editanswers")} END;
CREATE TRIGGER IF NOT EXISTS fv_form_feedback_upd AFTER UPDATE OF reopen ON form_feedback BEGIN ${feedbackBump("NEW", "editfeedback")} ${feedbackBump("NEW", "editanswers")} END;
CREATE TRIGGER IF NOT EXISTS fv_form_feedback_del AFTER DELETE ON form_feedback BEGIN ${feedbackBump("OLD", "editfeedback")} ${feedbackBump("OLD", "editanswers")} END;`;

export const FEEDBACK_STAMPS = [
  "よくできました",
  "なるほど",
  "もう一歩",
  "すてきな考え",
] as const;
export const MAX_FEEDBACK_TEXT = 200;
export const MAX_FEEDBACK_PER_ANSWER = 50;
export const MAX_FEEDBACK_PER_DECK = 5000;

export type FeedbackRow = {
  id: string;
  targetKind: string;
  targetId: string;
  owner: string;
  text: string;
  stamp: string;
  /** 0 none, 1 send-back in force, 2 closed by resubmit, 3 closed
   * by the host cancelling the send-back. */
  reopen: number;
  created: number;
  readAt: number | null;
};

type RawRow = Record<string, unknown>;
function toRow(r: RawRow): FeedbackRow {
  return {
    id: String(r.id),
    targetKind: String(r.target_kind),
    targetId: String(r.target_id),
    owner: String(r.owner),
    text: String(r.text),
    stamp: String(r.stamp),
    reopen: Number(r.reopen),
    created: Number(r.created),
    // read_at is stored as 0 while unread (the SQL helper has no
    // null parameter), and reported as null.
    readAt: Number(r.read_at) === 0 ? null : Number(r.read_at),
  };
}

/** Feedback for one deck as one viewer may see it: the host sees
 * every row; a student sees their own rows — and, for a group
 * free-edit definition (stage 3b), the rows addressed to their
 * CURRENT group, so feedback follows the group a student is in
 * now, not a group they left. Newest first. */
export function feedbackList(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
): FeedbackRow[] {
  if (host)
    return [
      ...sql(
        "SELECT * FROM form_feedback WHERE deck=? ORDER BY created DESC, id",
        deck,
      ),
    ].map((r) => toRow(r as RawRow));
  const group = effectiveGroupId(sql, deck, actor);
  const rows = group
    ? sql(
        "SELECT * FROM form_feedback WHERE deck=? AND (owner=? OR (owner=? AND target_kind='editslide' AND target_id IN (SELECT id FROM edit_slide_defs WHERE deck=? AND mode='group'))) ORDER BY created DESC, id",
        deck,
        actor,
        group,
        deck,
      )
    : sql(
        "SELECT * FROM form_feedback WHERE deck=? AND owner=? ORDER BY created DESC, id",
        deck,
        actor,
      );
  return [...rows].map((r) => toRow(r as RawRow));
}

/** The owner key a student's feedback action acts on for one
 * target: themself, or their current group when the target is a
 * group free-edit definition and the rows are the group's. */
function studentOwner(
  sql: HistorySQL,
  deck: string,
  actor: string,
  targetId: string,
): string {
  const def = [
    ...sql(
      "SELECT mode FROM edit_slide_defs WHERE deck=? AND id=?",
      deck,
      targetId,
    ),
  ][0];
  if (def && String(def.mode) === "group") {
    const group = effectiveGroupId(sql, deck, actor);
    if (
      group &&
      feedbackReopenActive(sql, deck, "editslide", targetId, group)
    )
      return group;
  }
  return actor;
}

/** Whether a send-back is currently in force for one answer. */
export function feedbackReopenActive(
  sql: HistorySQL,
  deck: string,
  targetKind: string,
  targetId: string,
  owner: string,
): boolean {
  const row = [
    ...sql(
      "SELECT COUNT(*) AS n FROM form_feedback WHERE deck=? AND target_kind=? AND target_id=? AND owner=? AND reopen=1",
      deck,
      targetKind,
      targetId,
      owner,
    ),
  ][0];
  return Number(row?.n) > 0;
}

/** Per-answer flags for the teacher console: a send-back in force,
 * and "resubmitted" — the newest send-back row for the answer was
 * closed by a resubmit and the answer was saved after that
 * send-back was sent. */
export function feedbackAnswerFlags(
  sql: HistorySQL,
  deck: string,
  targetKind: string,
  targetId: string,
  owner: string,
  answerUpdated: number,
): { reopen: boolean; resubmitted: boolean } {
  const rows = [
    ...sql(
      "SELECT reopen,created FROM form_feedback WHERE deck=? AND target_kind=? AND target_id=? AND owner=? AND reopen>0 ORDER BY created DESC, id DESC",
      deck,
      targetKind,
      targetId,
      owner,
    ),
  ];
  const reopen = rows.some((r) => Number(r.reopen) === 1);
  const newest = rows[0];
  const resubmitted =
    !reopen &&
    newest !== undefined &&
    Number(newest.reopen) === 2 &&
    answerUpdated > Number(newest.created);
  return { reopen, resubmitted };
}

export function feedbackCommand(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  action: string,
  value: Record<string, unknown>,
): { createdId?: string } {
  if (action === "send") {
    insist(host, 403, "フィードバックを送れるのはホストだけです。");
    insist(
      value.targetKind === "editslide",
      400,
      "フィードバックの対象が正しくありません。",
    );
    const targetId = value.targetId;
    const owner = value.owner;
    insist(
      typeof targetId === "string" && typeof owner === "string",
      400,
      "フィードバックの対象が正しくありません。",
    );
    const def = [
      ...sql(
        "SELECT id FROM edit_slide_defs WHERE deck=? AND id=?",
        deck,
        targetId as string,
      ),
    ][0];
    insist(def, 404, "生徒の編集用が見つかりません。");
    const answer = [
      ...sql(
        "SELECT author FROM edit_slide_answers WHERE def=? AND author=?",
        targetId as string,
        owner as string,
      ),
    ][0];
    insist(answer, 404, "回答が見つかりません。");
    const text = typeof value.text === "string" ? value.text : "";
    insist(
      [...text].length <= MAX_FEEDBACK_TEXT,
      400,
      "コメントは200文字までです。",
    );
    const stamp = typeof value.stamp === "string" ? value.stamp : "";
    insist(
      stamp === "" ||
        (FEEDBACK_STAMPS as readonly string[]).includes(stamp),
      400,
      "スタンプが正しくありません。",
    );
    insist(
      text !== "" || stamp !== "" || value.reopen === true,
      400,
      "コメントかスタンプを入れてください。",
    );
    const perAnswer = [
      ...sql(
        "SELECT COUNT(*) AS n FROM form_feedback WHERE deck=? AND target_kind='editslide' AND target_id=? AND owner=?",
        deck,
        targetId as string,
        owner as string,
      ),
    ][0];
    insist(
      Number(perAnswer?.n) < MAX_FEEDBACK_PER_ANSWER,
      413,
      "この回答へのフィードバックが上限（50件）に達しました。",
    );
    const perDeck = [
      ...sql("SELECT COUNT(*) AS n FROM form_feedback WHERE deck=?", deck),
    ][0];
    insist(
      Number(perDeck?.n) < MAX_FEEDBACK_PER_DECK,
      413,
      "作品全体のフィードバックが上限（5,000件）に達しました。",
    );
    const id = crypto.randomUUID();
    sql(
      "INSERT INTO form_feedback VALUES(?,?,?,?,?,?,?,?,?,?)",
      id,
      deck,
      "editslide",
      targetId as string,
      owner as string,
      text,
      stamp,
      value.reopen === true ? 1 : 0,
      Date.now(),
      0,
    );
    return { createdId: id };
  }
  if (action === "read") {
    const ids = Array.isArray(value.ids) ? value.ids.slice(0, 100) : [];
    const now = Date.now();
    const group = effectiveGroupId(sql, deck, actor);
    for (const id of ids)
      if (typeof id === "string") {
        sql(
          "UPDATE form_feedback SET read_at=? WHERE deck=? AND owner=? AND id=? AND read_at=0",
          now,
          deck,
          actor,
          id,
        );
        // Rows addressed to the student's group (group free-edit
        // definitions) are read by whichever member sees them.
        if (group)
          sql(
            "UPDATE form_feedback SET read_at=? WHERE deck=? AND owner=? AND id=? AND read_at=0 AND target_kind='editslide' AND target_id IN (SELECT id FROM edit_slide_defs WHERE deck=? AND mode='group')",
            now,
            deck,
            group,
            id,
            deck,
          );
      }
    return {};
  }
  if (action === "resubmit") {
    const targetId = value.targetId;
    insist(
      typeof targetId === "string",
      400,
      "フィードバックの対象が正しくありません。",
    );
    const owner = studentOwner(sql, deck, actor, targetId as string);
    insist(
      feedbackReopenActive(sql, deck, "editslide", targetId as string, owner),
      400,
      "差し戻しは受けていません。",
    );
    sql(
      "UPDATE form_feedback SET reopen=2 WHERE deck=? AND target_kind='editslide' AND target_id=? AND owner=? AND reopen=1",
      deck,
      targetId as string,
      owner,
    );
    return {};
  }
  if (action === "cancel-reopen") {
    insist(host, 403, "差し戻しを取り消せるのはホストだけです。");
    const targetId = value.targetId;
    const owner = value.owner;
    insist(
      typeof targetId === "string" && typeof owner === "string",
      400,
      "フィードバックの対象が正しくありません。",
    );
    sql(
      "UPDATE form_feedback SET reopen=3 WHERE deck=? AND target_kind='editslide' AND target_id=? AND owner=? AND reopen=1",
      deck,
      targetId as string,
      owner as string,
    );
    return {};
  }
  throw new FeedbackError(404, "操作が見つかりません。");
}

/** Remove every feedback row for one target (definition deletion)
 * or for a whole deck (deck deletion). */
export function feedbackDeleteTarget(
  sql: HistorySQL,
  deck: string,
  targetKind: string,
  targetId: string,
): void {
  sql(
    "DELETE FROM form_feedback WHERE deck=? AND target_kind=? AND target_id=?",
    deck,
    targetKind,
    targetId,
  );
}
export function feedbackDeleteDeck(sql: HistorySQL, deck: string): void {
  sql("DELETE FROM form_feedback WHERE deck=?", deck);
}
