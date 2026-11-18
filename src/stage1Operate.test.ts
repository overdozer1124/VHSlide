import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { applyStage1OrgMigration, nodeStage1OrgDb } from "./stage1OrgSchema";
import {
  applyStage1OperatorInviteMigration,
  applyStage1OperatorMigration,
} from "./stage1InitialRegistration";
import {
  consoleView,
  createSchool,
  listApplications,
  listMembers,
  listPreregistrations,
  nodeOperateSql,
  OperateError,
} from "./stage1Operate";

function open() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
  );
  applyStage1OrgMigration(nodeStage1OrgDb(db));
  applyStage1OperatorMigration(nodeStage1OrgDb(db));
  applyStage1OperatorInviteMigration(nodeStage1OrgDb(db));
  db.prepare("INSERT INTO users(id,name,email) VALUES(?,?,?)").run(
    "super",
    "管理者",
    "super@example.test",
  );
  db.prepare("INSERT INTO users(id,name,email) VALUES(?,?,?)").run(
    "plain",
    "一般",
    "plain@example.test",
  );
  db.prepare("UPDATE users SET is_super_admin=1 WHERE id=?").run("super");
  return { db, sql: nodeOperateSql(db) };
}

describe("stage1Operate", () => {
  it("lets only a super admin create a school and hides the flag from the console", () => {
    const { db, sql } = open();
    expect(() =>
      createSchool(sql, {
        id: "org1",
        name: " 加賀小学校 ",
        actorId: "plain",
        now: 10,
        auditId: "a1",
      }),
    ).toThrow(OperateError);
    const created = createSchool(sql, {
      id: "org1",
      name: " 加賀小学校 ",
      actorId: "super",
      now: 10,
      auditId: "a1",
    });
    expect(created).toEqual({ id: "org1", name: "加賀小学校" });
    expect(
      db.prepare("SELECT action, target FROM audit_log WHERE id=?").get("a1"),
    ).toEqual({ action: "organization.create", target: "organization:org1" });
    const view = consoleView(sql, "super");
    expect(view.createSchool).toBe(true);
    expect(view.schools).toEqual([
      {
        id: "org1",
        name: "加賀小学校",
        preregistration: true,
        membership: true,
      },
    ]);
    expect(JSON.stringify(view)).not.toContain("is_super_admin");
    expect(consoleView(sql, "plain").createSchool).toBe(false);
    expect(consoleView(sql, "plain").applyTo).toEqual([
      { id: "org1", name: "加賀小学校" },
    ]);
    expect(consoleView(sql, "plain").myInvitation).toBeNull();
  });

  it("lists preregistrations, applications and members without operator subjects", () => {
    const { db, sql } = open();
    createSchool(sql, {
      id: "org1",
      name: "加賀小学校",
      actorId: "super",
      now: 10,
      auditId: "a1",
    });
    db.prepare(
      `INSERT INTO preregistrations(
        id, email, organization_id, planned_role, planned_is_school_admin,
        planned_can_create_space, status, created_by, created_at
      ) VALUES('p1','teacher@example.test','org1','teacher',0,0,'有効','super',11)`,
    ).run();
    db.prepare(
      `INSERT INTO school_admin_applications(
        id, organization_id, applicant_user_id, status, created_at
      ) VALUES('app1','org1','plain','申請中',12)`,
    ).run();
    db.prepare(
      `INSERT INTO organization_members(
        user_id, organization_id, role, is_school_admin, can_create_space, status, generation, created_at
      ) VALUES('plain','org1','teacher',1,0,'有効',1,13)`,
    ).run();
    db.prepare(
      "INSERT INTO stage1_operators(subject, added_at, added_by) VALUES(?,?,?)",
    ).run("super", 1, "super");
    expect(listPreregistrations(sql, "org1")).toEqual([
      {
        id: "p1",
        email: "teacher@example.test",
        plannedRole: "teacher",
        status: "有効",
        createdAt: 11,
      },
    ]);
    expect(listApplications(sql, "org1")[0]?.applicant.email).toBe(
      "plain@example.test",
    );
    expect(listMembers(sql, "org1")[0]?.schoolAdmin).toBe(true);
    const view = consoleView(sql, "super");
    expect(view.operator).toBe(true);
    expect(view.operatorGeneration).toBe(0);
    expect(JSON.stringify(listMembers(sql, "org1"))).not.toContain(
      "is_super_admin",
    );
    expect(JSON.stringify(view)).not.toContain("stage1_operators");
  });
});
