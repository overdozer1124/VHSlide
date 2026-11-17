import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  applyStage1OrgMigration,
  nodeStage1OrgDb,
} from "./stage1OrgSchema";
import {
  bindPreregistrationsOnLogin,
  cancelPreregistration,
  createPreregistration,
  nodePreregSql,
  PreregistrationError,
} from "./stage1Preregistration";

function open() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
  );
  applyStage1OrgMigration(nodeStage1OrgDb(db));
  db.prepare("INSERT INTO users(id,name,email) VALUES(?,?,?)").run(
    "u1",
    "A",
    "a@example.test",
  );
  db.prepare(
    "INSERT INTO organizations(id,name,status,created_at) VALUES(?,?,?,?)",
  ).run("org1", "School", "有効", 1);
  return { db, sql: nodePreregSql(db) };
}

describe("stage1Preregistration", () => {
  it("creates, rejects duplicate active, cancels, and binds on login", () => {
    const { db, sql } = open();
    const row = createPreregistration(sql, {
      id: "p1",
      email: "A@Example.TEST",
      organizationId: "org1",
      plannedRole: "student",
      plannedCanCreateSpace: true,
      plannedIsSchoolAdmin: true,
      createdBy: "admin",
      createdAt: 10,
    });
    expect(row.email).toBe("a@example.test");
    expect(row.planned_is_school_admin).toBe(1);

    expect(() =>
      createPreregistration(sql, {
        id: "p2",
        email: "a@example.test",
        organizationId: "org1",
        plannedRole: "teacher",
        createdBy: "admin",
      }),
    ).toThrow(PreregistrationError);

    const bound = bindPreregistrationsOnLogin(sql, {
      userId: "u1",
      email: "a@example.test",
      emailVerified: true,
      now: 20,
    });
    expect(bound.bound).toEqual([
      { preregistrationId: "p1", organizationId: "org1" },
    ]);
    const member = db
      .prepare(
        "SELECT role, is_school_admin, can_create_space, status, generation FROM organization_members WHERE user_id=? AND organization_id=?",
      )
      .get("u1", "org1") as Record<string, unknown>;
    expect(member).toEqual({
      role: "student",
      is_school_admin: 0,
      can_create_space: 1,
      status: "有効",
      generation: 1,
    });
    expect(
      (
        db
          .prepare("SELECT status, bound_user_id FROM preregistrations WHERE id=?")
          .get("p1") as { status: string; bound_user_id: string }
      ),
    ).toEqual({ status: "結びつけ済み", bound_user_id: "u1" });

    expect(
      bindPreregistrationsOnLogin(sql, {
        userId: "u1",
        email: "a@example.test",
        emailVerified: true,
      }).bound,
    ).toEqual([]);
  });

  it("cancels instead of binding when membership is inactive", () => {
    const { db, sql } = open();
    createPreregistration(sql, {
      id: "p1",
      email: "a@example.test",
      organizationId: "org1",
      plannedRole: "teacher",
      createdBy: "admin",
    });
    db.prepare(
      `INSERT INTO organization_members(user_id,organization_id,role,is_school_admin,can_create_space,status,generation,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    ).run("u1", "org1", "teacher", 0, 0, "無効", 3, 1);

    const result = bindPreregistrationsOnLogin(sql, {
      userId: "u1",
      email: "a@example.test",
      emailVerified: true,
    });
    expect(result.bound).toEqual([]);
    expect(result.cancelledInactive).toEqual([
      { preregistrationId: "p1", organizationId: "org1" },
    ]);
    expect(
      (
        db.prepare("SELECT status FROM preregistrations WHERE id=?").get("p1") as {
          status: string;
        }
      ).status,
    ).toBe("取消");
    expect(
      (
        db
          .prepare(
            "SELECT status, generation FROM organization_members WHERE user_id=? AND organization_id=?",
          )
          .get("u1", "org1") as { status: string; generation: number }
      ),
    ).toEqual({ status: "無効", generation: 3 });
  });

  it("cancel is first-wins against bind", () => {
    const { sql } = open();
    createPreregistration(sql, {
      id: "p1",
      email: "a@example.test",
      organizationId: "org1",
      plannedRole: null,
      createdBy: "admin",
    });
    expect(cancelPreregistration(sql, "p1")).toBe(true);
    expect(cancelPreregistration(sql, "p1")).toBe(false);
    expect(
      bindPreregistrationsOnLogin(sql, {
        userId: "u1",
        email: "a@example.test",
        emailVerified: true,
      }).bound,
    ).toEqual([]);
  });
});
