import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  applyStage1OrgMigration,
  nodeStage1OrgDb,
} from "./stage1OrgSchema";
import {
  generationMatches,
  invalidateOrganizationMember,
  nodeGenerationSql,
  reactivateOrganizationMember,
  readMemberGeneration,
} from "./stage1Generation";

function open() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
  );
  applyStage1OrgMigration(nodeStage1OrgDb(db));
  db.prepare("INSERT INTO users(id,name,email) VALUES(?,?,?)").run(
    "u1",
    "A",
    "a@test",
  );
  db.prepare(
    "INSERT INTO organizations(id,name,status,created_at) VALUES(?,?,?,?)",
  ).run("org1", "School", "有効", 1);
  db.prepare(
    `INSERT INTO organization_members(user_id,organization_id,role,is_school_admin,can_create_space,status,generation,created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  ).run("u1", "org1", "teacher", 0, 0, "有効", 1, 1);
  return db;
}

describe("stage1Generation", () => {
  it("bumps generation on invalidate and does not rewind on reactivate", () => {
    const db = open();
    const sql = nodeGenerationSql(db);
    expect(readMemberGeneration(sql, "u1", "org1")).toBe(1);
    expect(generationMatches(1, 1)).toBe(true);
    expect(generationMatches(2, 1)).toBe(false);
    expect(generationMatches(undefined, 1)).toBe(false);

    const next = invalidateOrganizationMember(sql, "u1", "org1");
    expect(next).toBe(2);
    const row = db
      .prepare(
        "SELECT status, generation FROM organization_members WHERE user_id=? AND organization_id=?",
      )
      .get("u1", "org1") as { status: string; generation: number };
    expect(row).toEqual({ status: "無効", generation: 2 });

    const again = reactivateOrganizationMember(sql, "u1", "org1", "student");
    expect(again).toMatchObject({
      status: "有効",
      generation: 2,
      role: "student",
    });
    expect(generationMatches(2, 1)).toBe(false);
    expect(generationMatches(2, 2)).toBe(true);
  });

  it("does not bump when already inactive", () => {
    const db = open();
    const sql = nodeGenerationSql(db);
    expect(invalidateOrganizationMember(sql, "u1", "org1")).toBe(2);
    expect(invalidateOrganizationMember(sql, "u1", "org1")).toBeUndefined();
    expect(readMemberGeneration(sql, "u1", "org1")).toBe(2);
  });

  it("does not reactivate when already active", () => {
    const db = open();
    const sql = nodeGenerationSql(db);
    expect(
      reactivateOrganizationMember(sql, "u1", "org1", "teacher"),
    ).toBeUndefined();
  });

  it("clears school-admin and create-space flags on reactivate", () => {
    const db = open();
    db.prepare(
      "UPDATE organization_members SET is_school_admin=1, can_create_space=1 WHERE user_id=? AND organization_id=?",
    ).run("u1", "org1");
    const sql = nodeGenerationSql(db);
    expect(invalidateOrganizationMember(sql, "u1", "org1")).toBe(2);
    expect(
      Number(
        (
          db
            .prepare(
              "SELECT is_school_admin FROM organization_members WHERE user_id=? AND organization_id=?",
            )
            .get("u1", "org1") as { is_school_admin: number }
        ).is_school_admin,
      ),
    ).toBe(1);
    reactivateOrganizationMember(sql, "u1", "org1", "teacher");
    const row = db
      .prepare(
        "SELECT status, generation, role, is_school_admin, can_create_space FROM organization_members WHERE user_id=? AND organization_id=?",
      )
      .get("u1", "org1") as Record<string, unknown>;
    expect(row.status).toBe("有効");
    expect(Number(row.generation)).toBe(2);
    expect(row.role).toBe("teacher");
    expect(Number(row.is_school_admin)).toBe(0);
    expect(Number(row.can_create_space)).toBe(0);
  });
});
