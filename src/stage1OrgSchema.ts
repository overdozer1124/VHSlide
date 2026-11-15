/** Stage 1 Phase 2 procedure 1: additive school-org tables and users.is_super_admin. */

export const STAGE1_ORG_MIGRATION_ID = "stage1_org_v1";

/** Explicit user columns for participant-facing queries (excludes is_super_admin). */
export const usersPublicColumns = "users.id, users.name, users.email";

/**
 * CREATE IF NOT EXISTS for procedure-1 tables.
 * Status / role values follow docs/space-permissions-impl-design.md §2.
 * audit_log is included because the owner chose required logging before procedure 2.
 */
export const stage1OrgTablesSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('有効','無効')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS preregistrations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  planned_role TEXT CHECK(planned_role IS NULL OR planned_role IN ('teacher','student')),
  planned_is_school_admin INTEGER NOT NULL DEFAULT 0 CHECK(planned_is_school_admin IN (0,1)),
  planned_can_create_space INTEGER NOT NULL DEFAULT 0 CHECK(planned_can_create_space IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('有効','結びつけ済み','取消')),
  bound_user_id TEXT REFERENCES users(id),
  bound_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS preregistrations_email_org_active
  ON preregistrations(email, organization_id) WHERE status = '有効';
CREATE TABLE IF NOT EXISTS organization_members (
  user_id TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  role TEXT CHECK(role IS NULL OR role IN ('teacher','student')),
  is_school_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_school_admin IN (0,1)),
  can_create_space INTEGER NOT NULL DEFAULT 0 CHECK(can_create_space IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('有効','無効')),
  generation INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, organization_id)
);
CREATE TABLE IF NOT EXISTS school_admin_applications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  applicant_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('申請中','登録','却下')),
  decided_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export type Stage1OrgDb = {
  exec(sql: string): void;
  tableColumns(table: string): string[];
  migrationApplied(id: string): boolean;
  recordMigration(id: string, at: number): void;
};

/**
 * Idempotent additive migration. Safe to re-run: CREATE IF NOT EXISTS,
 * ALTER only when the column is missing, migration row inserted once.
 *
 * Rollback (procedure 1):
 * - DROP TABLE audit_log / school_admin_applications / organization_members /
 *   preregistrations / organizations (order respects FKs);
 * - DROP INDEX preregistrations_email_org_active if needed;
 * - ALTER TABLE users DROP COLUMN is_super_admin (SQLite 3.35+);
 * - DELETE FROM schema_migrations WHERE id='stage1_org_v1'.
 * Existing user/deck/session rows are never rewritten by this migration.
 *
 * organization_members.generation follows design §5 (permanent invalidation).
 * Fresh CREATE includes it; older procedure-1 drafts without the column get
 * ALTER DEFAULT 1 on re-run (before realenv apply).
 */
export function applyStage1OrgMigration(
  db: Stage1OrgDb,
  now = Date.now(),
): { applied: boolean; already: boolean } {
  db.exec(stage1OrgTablesSql);
  if (!db.tableColumns("users").includes("is_super_admin")) {
    db.exec(
      "ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!db.tableColumns("organization_members").includes("generation")) {
    db.exec(
      "ALTER TABLE organization_members ADD COLUMN generation INTEGER NOT NULL DEFAULT 1",
    );
  }
  if (db.migrationApplied(STAGE1_ORG_MIGRATION_ID)) {
    return { applied: false, already: true };
  }
  db.recordMigration(STAGE1_ORG_MIGRATION_ID, now);
  return { applied: true, already: false };
}

/** Adapter for Node's node:sqlite DatabaseSync. */
export function nodeStage1OrgDb(db: {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
}): Stage1OrgDb {
  return {
    exec: (sql) => db.exec(sql),
    tableColumns: (table) =>
      (
        db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).map((c) => c.name),
    migrationApplied: (id) =>
      !!db.prepare("SELECT 1 AS ok FROM schema_migrations WHERE id=?").get(id),
    recordMigration: (id, at) => {
      db.prepare(
        "INSERT OR IGNORE INTO schema_migrations(id, applied_at) VALUES(?,?)",
      ).run(id, at);
    },
  };
}

/** Adapter for Cloudflare Durable Object SqlStorage. */
export function durableStage1OrgDb(sql: {
  exec(
    query: string,
    ...args: (string | number | null)[]
  ): Iterable<Record<string, unknown>>;
}): Stage1OrgDb {
  return {
    exec: (statement) => {
      sql.exec(statement);
    },
    tableColumns: (table) =>
      [...sql.exec(`PRAGMA table_info(${table})`)].map(
        (c) => c.name as string,
      ),
    migrationApplied: (id) =>
      [...sql.exec("SELECT 1 AS ok FROM schema_migrations WHERE id=?", id)]
        .length > 0,
    recordMigration: (id, at) => {
      sql.exec(
        "INSERT OR IGNORE INTO schema_migrations(id, applied_at) VALUES(?,?)",
        id,
        at,
      );
    },
  };
}
