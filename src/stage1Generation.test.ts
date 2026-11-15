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
});
