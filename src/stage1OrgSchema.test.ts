import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  STAGE1_ORG_MIGRATION_ID,
  applyStage1OrgMigration,
  nodeStage1OrgDb,
  usersPublicColumns,
} from "./stage1OrgSchema";

function open() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
  `);
  return db;
}

describe("stage1OrgSchema", () => {
  it("adds school tables and is_super_admin once, and is idempotent", () => {
    const db = open();
    const adapter = nodeStage1OrgDb(db);
    const first = applyStage1OrgMigration(adapter, 1_000);
    expect(first).toEqual({ applied: true, already: false });
    expect(adapter.tableColumns("users")).toContain("is_super_admin");
    for (const table of [
      "organizations",
      "preregistrations",
      "organization_members",
      "school_admin_applications",
      "audit_log",
      "schema_migrations",
    ])
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),
      ).toBeTruthy();
    expect(
      db
        .prepare("SELECT applied_at FROM schema_migrations WHERE id=?")
        .get(STAGE1_ORG_MIGRATION_ID),
    ).toEqual({ applied_at: 1_000 });

    const second = applyStage1OrgMigration(adapter, 2_000);
    expect(second).toEqual({ applied: false, already: true });
    expect(
      db
        .prepare("SELECT applied_at FROM schema_migrations WHERE id=?")
        .get(STAGE1_ORG_MIGRATION_ID),
    ).toEqual({ applied_at: 1_000 });
  });

  it("keeps named user insert working after the column is added", () => {
    const db = open();
    applyStage1OrgMigration(nodeStage1OrgDb(db));
    db.prepare(
      "INSERT INTO users(id,name,email) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",
    ).run("u1", "Alice", "a@example.test");
    const row = db
      .prepare(
        `SELECT ${usersPublicColumns}, users.is_super_admin AS is_super_admin FROM users WHERE id=?`,
      )
      .get("u1") as {
      id: string;
      name: string;
      email: string;
      is_super_admin: number;
    };
    expect(row).toEqual({
      id: "u1",
      name: "Alice",
      email: "a@example.test",
      is_super_admin: 0,
    });
    expect(usersPublicColumns).not.toContain("is_super_admin");
  });

  it("does not rewrite existing users when re-applied", () => {
    const db = open();
    db.prepare("INSERT INTO users(id,name,email) VALUES(?,?,?)").run(
      "u1",
      "Alice",
      "a@example.test",
    );
    applyStage1OrgMigration(nodeStage1OrgDb(db));
    db.prepare("UPDATE users SET is_super_admin=1 WHERE id=?").run("u1");
    applyStage1OrgMigration(nodeStage1OrgDb(db));
    expect(
      (db.prepare("SELECT is_super_admin FROM users WHERE id=?").get("u1") as {
        is_super_admin: number;
      }).is_super_admin,
    ).toBe(1);
  });
});
