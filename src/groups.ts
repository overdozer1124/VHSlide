import type { HistorySQL } from "./historyStore.ts";

/** Deck-wide groups （班）: one shared group set per deck, with membership.
 *
 * Group-aware activities (webbing maps today, more later) key their
 * per-group content by these group ids, so a class defines its groups
 * once per deck and every grouped activity sees the same membership.
 */
export type DeckGroup = {
  id: string;
  name: string;
  memberCount: number;
};
export type GroupListView = {
  groups: DeckGroup[];
  myGroupId?: string;
};
export class GroupError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
function insist(
  ok: unknown,
  status: number,
  message: string,
): asserts ok {
  if (!ok) throw new GroupError(status, message);
}
export const MAX_DECK_GROUPS = 12;
export const groupSchema = `
CREATE TABLE IF NOT EXISTS deck_groups(id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, name TEXT NOT NULL, sort INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS deck_groups_deck ON deck_groups(deck);
CREATE TABLE IF NOT EXISTS deck_group_members(deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, user TEXT NOT NULL, grp TEXT NOT NULL, PRIMARY KEY(deck,user));`;
export function deckGroups(sql: HistorySQL, deck: string): DeckGroup[] {
  return [
    ...sql(
      "SELECT g.id,g.name,(SELECT COUNT(*) FROM deck_group_members m WHERE m.deck=g.deck AND m.grp=g.id) AS members FROM deck_groups g WHERE g.deck=? ORDER BY g.sort,g.id",
      deck,
    ),
  ].map((g) => ({ id: g.id, name: g.name, memberCount: g.members }));
}
/** The group this user may act as a member of: their joined group, or —
 * when the deck has exactly one group — that group for everyone, so a
 * single-group class never needs a join step. */
export function effectiveGroupId(
  sql: HistorySQL,
  deck: string,
  actor: string,
): string | undefined {
  const groups = deckGroups(sql, deck);
  if (groups.length === 1) return groups[0].id;
  const membership = [
    ...sql(
      "SELECT grp FROM deck_group_members WHERE deck=? AND user=?",
      deck,
      actor,
    ),
  ][0];
  return membership?.grp as string | undefined;
}
export function groupList(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
): GroupListView {
  const groups = deckGroups(sql, deck);
  const mine = host ? undefined : effectiveGroupId(sql, deck, actor);
  return { groups, ...(mine ? { myGroupId: mine } : {}) };
}
function cleanName(value: unknown): string {
  insist(
    typeof value === "string" && value.trim().length > 0 && value.length <= 20,
    400,
    "グループ名は1〜20文字で入力してください。",
  );
  return (value as string).trim().replace(/\s+/g, " ");
}
/** Must run within the caller's transaction after membership validation. */
export function groupCommand(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  action: string,
  id: string | undefined,
  input: unknown,
): void {
  const value = input as Record<string, unknown>;
  insist(
    value && typeof value === "object" && !Array.isArray(value),
    400,
    "入力を確認してください。",
  );
  if (action === "create") {
    insist(host, 403, "グループを作成できるのはホストだけです。");
    insist(
      deckGroups(sql, deck).length === 0,
      409,
      "この作品には既にグループがあります。追加は「グループを追加」から行ってください。",
    );
    insist(
      Array.isArray(value.names) &&
        value.names.length >= 1 &&
        value.names.length <= MAX_DECK_GROUPS,
      400,
      `グループは1〜${MAX_DECK_GROUPS}件で指定してください。`,
    );
    const names = (value.names as unknown[]).map(cleanName);
    insist(
      new Set(names).size === names.length,
      400,
      "グループ名が重複しています。",
    );
    names.forEach((name, index) =>
      sql(
        "INSERT INTO deck_groups VALUES(?,?,?,?)",
        crypto.randomUUID(),
        deck,
        name,
        index,
      ),
    );
  } else if (action === "add") {
    insist(host, 403, "グループを追加できるのはホストだけです。");
    const groups = deckGroups(sql, deck);
    insist(
      groups.length >= 1 && groups.length < MAX_DECK_GROUPS,
      409,
      groups.length === 0
        ? "まずグループを作成してください。"
        : `グループは${MAX_DECK_GROUPS}件までです。`,
    );
    const name = cleanName(value.name);
    insist(
      !groups.some((g) => g.name === name),
      400,
      "グループ名が重複しています。",
    );
    sql(
      "INSERT INTO deck_groups VALUES(?,?,?,?)",
      crypto.randomUUID(),
      deck,
      name,
      groups.length,
    );
  } else if (action === "rename") {
    insist(host, 403, "グループ名を変更できるのはホストだけです。");
    const groups = deckGroups(sql, deck);
    const target = groups.find((g) => g.id === id);
    insist(target, 404, "グループが見つかりません。");
    const name = cleanName(value.name);
    insist(
      !groups.some((g) => g.id !== id && g.name === name),
      400,
      "グループ名が重複しています。",
    );
    sql(
      "UPDATE deck_groups SET name=? WHERE id=? AND deck=?",
      name,
      target.id,
      deck,
    );
  } else if (action === "join") {
    insist(!host, 400, "ホストはグループに参加する必要はありません。");
    const groups = deckGroups(sql, deck);
    insist(
      typeof value.groupId === "string" &&
        groups.some((g) => g.id === value.groupId),
      400,
      "参加するグループを選んでください。",
    );
    sql(
      "INSERT INTO deck_group_members VALUES(?,?,?) ON CONFLICT(deck,user) DO UPDATE SET grp=excluded.grp",
      deck,
      actor,
      value.groupId as string,
    );
  } else if (action === "leave") {
    sql("DELETE FROM deck_group_members WHERE deck=? AND user=?", deck, actor);
  } else throw new GroupError(404, "グループの操作が見つかりません。");
}
