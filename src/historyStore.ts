import { backupSnapshot, parseBackupSnapshot } from "./backupData.ts";
import type { BackupSnapshot } from "./backupData.ts";
import type { Deck } from "./model.ts";
import type { SlideComment } from "./permissions.ts";
export const HISTORY_COUNT = 10,
  HISTORY_BYTES = 20_000_000;
export type HistoryEntry = {
  id: string;
  deck: string;
  title: string;
  created: number;
  reason: string;
  bytes: number;
};
export type HistorySQL = (
  query: string,
  ...args: (string | number)[]
) => Iterable<Record<string, any>>;
export const historySchema = `CREATE TABLE IF NOT EXISTS work_history(id TEXT PRIMARY KEY, deck TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL, reason TEXT NOT NULL, bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS work_history_parts(id TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(id,part));`;
export function historyList(sql: HistorySQL, deck: string): HistoryEntry[] {
  return [
    ...sql(
      "SELECT * FROM work_history WHERE deck=? ORDER BY created DESC,id DESC",
      deck,
    ),
  ] as HistoryEntry[];
}
export function historyRemove(sql: HistorySQL, id: string) {
  sql("DELETE FROM work_history_parts WHERE id=?", id);
  sql("DELETE FROM work_history WHERE id=?", id);
}
export function historySave(
  sql: HistorySQL,
  deck: string,
  snapshot: BackupSnapshot,
  reason: string,
) {
  const value = JSON.stringify(parseBackupSnapshot(snapshot)),
    bytes = new TextEncoder().encode(value).length;
  if (bytes > 12_000_000)
    throw new Error(
      "保存する版が12MBを超えています。完全バックアップを利用してください。",
    );
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    deck,
    title: snapshot.deck.title,
    created: Math.max(
      Date.now(),
      (historyList(sql, deck)[0]?.created ?? 0) + 1,
    ),
    reason: reason.trim().slice(0, 80) || "保存した版",
    bytes,
  };
  sql(
    "INSERT INTO work_history VALUES(?,?,?,?,?,?)",
    entry.id,
    deck,
    entry.title,
    entry.created,
    entry.reason,
    bytes,
  );
  for (let start = 0, part = 0; start < value.length; part++) {
    let end = Math.min(start + 16000, value.length);
    const last = value.charCodeAt(end - 1),
      next = value.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
      end--;
    sql(
      "INSERT INTO work_history_parts VALUES(?,?,?)",
      entry.id,
      part,
      value.slice(start, end),
    );
    start = end;
  }
  let total = 0;
  historyList(sql, deck).forEach((r, i) => {
    total += r.bytes;
    if (i >= HISTORY_COUNT || total > HISTORY_BYTES) historyRemove(sql, r.id);
  });
  return entry;
}
export function historyRead(sql: HistorySQL, deck: string, id: string) {
  if (
    ![...sql("SELECT id FROM work_history WHERE id=? AND deck=?", id, deck)]
      .length
  )
    throw new Error("保存した版が見つかりません。");
  return parseBackupSnapshot(
    JSON.parse(
      [
        ...sql(
          "SELECT value FROM work_history_parts WHERE id=? ORDER BY part",
          id,
        ),
      ]
        .map((r) => r.value)
        .join(""),
    ),
  );
}
export function historyBeforeChange(
  sql: HistorySQL,
  id: string,
  before: Deck,
  after: Deck,
  notes: () => SlideComment[],
) {
  const deleted = before.slides.some(
    (s) => !after.slides.some((t) => t.id === s.id),
  );
  const last = historyList(sql, id)[0];
  if (deleted || !last || Date.now() - last.created >= 300_000)
    historySave(
      sql,
      id,
      backupSnapshot(before, notes(), [], []),
      deleted ? "削除する前" : "自動保存",
    );
}
