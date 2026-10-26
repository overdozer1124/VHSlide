/** Shared wire contract and SQLite migrations for both backends. ZIP v1 is unchanged. */
export type BackupCheckpoint = { directory: string; room: string };
export type RestoreState =
  "uploading" | "room_committed" | "ready" | "cancelling" | "cancelled";
export type RestoreTask = {
  id: string;
  title: string;
  status: RestoreState;
  contentHash: string;
  applySharing: boolean | null;
  images: number;
};
export const backupChanged =
  "取得中に作品・付箋・共有設定が変更されました。編集が落ち着いてから、もう一度バックアップしてください。";
export const validDigest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function validCheckpoint(v: unknown): v is BackupCheckpoint {
  const c = v as BackupCheckpoint;
  return (
    !!c &&
    [c.directory, c.room].every(
      (n) => typeof n === "string" && /^(0|[1-9][0-9]{0,18})$/.test(n),
    )
  );
}
export const restoreSchema = `
 CREATE TABLE IF NOT EXISTS restore_tasks (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_key TEXT NOT NULL,
 content_hash TEXT NOT NULL, apply_sharing INTEGER NOT NULL,
 title TEXT NOT NULL, status TEXT NOT NULL, commit_hash TEXT NOT NULL DEFAULT '',
 created INTEGER NOT NULL, UNIQUE(owner,request_key));
 CREATE INDEX IF NOT EXISTS restore_tasks_owner ON restore_tasks(owner,created);
`;
/** Trigger increments are atomic with every affected SQL statement/transaction, including cascades. */
export function revisionSchema(kind: "directory" | "room" | "node") {
  let sql = `CREATE TABLE IF NOT EXISTS backup_revisions (id TEXT PRIMARY KEY, rev INTEGER NOT NULL CHECK(typeof(rev)='integer' AND rev>=0));`;
  const tables =
    kind === "room"
      ? ["snapshot", "updates", "comments", "assets", "asset_chunks", "meta"]
      : [
          "decks",
          "members",
          "grants",
          "recipients",
          "assets",
          ...(kind === "node" ? ["updates", "comments"] : []),
        ];
  for (const table of tables)
    for (const op of ["INSERT", "UPDATE", "DELETE"]) {
      const row = op === "DELETE" ? "OLD" : "NEW";
      const id =
        kind === "room"
          ? "'room'"
          : `${row}.${table === "decks" ? "id" : "deck"}`;
      sql += `CREATE TRIGGER IF NOT EXISTS backup_rev_${table}_${op} AFTER ${op} ON ${table} BEGIN
      INSERT INTO backup_revisions VALUES(${id},1) ON CONFLICT(id) DO UPDATE SET rev=rev+1;
    END;`;
    }
  if (kind !== "room")
    sql += `CREATE TRIGGER IF NOT EXISTS backup_rev_user AFTER UPDATE OF name,email ON users
    WHEN OLD.name<>NEW.name OR OLD.email<>NEW.email BEGIN
    INSERT INTO backup_revisions SELECT deck,1 FROM members WHERE user_id=NEW.id
    ON CONFLICT(id) DO UPDATE SET rev=rev+1;
    END;`;
  return sql;
}
export const revisionQuery =
  "SELECT CAST(rev AS TEXT) AS revision FROM backup_revisions WHERE id=?";
export const taskQuery = `SELECT id,title,status,content_hash AS contentHash,
 CASE WHEN apply_sharing=-1 THEN NULL ELSE apply_sharing END AS applySharing,
 (SELECT COUNT(*) FROM assets WHERE assets.deck=restore_tasks.id) AS images FROM restore_tasks`;
export function taskView(row: Record<string, unknown>): RestoreTask {
  return {
    ...row,
    applySharing: row.applySharing === null ? null : !!row.applySharing,
  } as RestoreTask;
}
export async function digestBytes(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function digestText(text: string) {
  return digestBytes(new TextEncoder().encode(text));
}
export async function imageId(job: string, digest: string) {
  const h = await digestText(`${job}:${digest}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
