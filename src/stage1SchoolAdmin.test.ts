import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  applyStage1OrgMigration,
  nodeStage1OrgDb,
} from "./stage1OrgSchema";
import {
  applyForSchoolAdmin,
  decideSchoolAdminApplication,
  nodeSchoolAdminSql,
  revokeSchoolAdmin,
  SchoolAdminError,
} from "./stage1SchoolAdmin";

function open() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
  );
  applyStage1OrgMigration(nodeStage1OrgDb(db));
  db.prepare("INSERT INTO users(id,name,email) VALUES(?,?,?)").run(
    "super",
    "S",
    "s@test",
  );
  db.prepare("INSERT INTO users(id,name,email) VALUES(?,?,?)").run(
    "u1",
    "A",
    "a@test",
  );
  db.prepare("UPDATE users SET is_super_admin=1 WHERE id=?").run("super");
  db.prepare(
    "INSERT INTO organizations(id,name,status,created_at) VALUES(?,?,?,?)",
  ).run("org1", "School", "有効", 1);
  return { db, sql: nodeSchoolAdminSql(db) };
}

describe("stage1SchoolAdmin", () => {
  it("appoints only via super-admin decision and never from prereg flags", () => {
    const { db, sql } = open();
    const app = applyForSchoolAdmin(sql, {
      id: "app1",
      organizationId: "org1",
      applicantUserId: "u1",
      createdAt: 10,
    });
    expect(app.status).toBe("申請中");

    expect(() =>
      decideSchoolAdminApplication(sql, {
        applicationId: "app1",
        decision: "登録",
        decidedBy: "u1",
      }),
    ).toThrow(SchoolAdminError);

    const decided = decideSchoolAdminApplication(sql, {
      applicationId: "app1",
      decision: "登録",
      decidedBy: "super",
      decidedAt: 20,
    });
    expect(decided.status).toBe("登録");
    const member = db
      .prepare(
        "SELECT role, is_school_admin, status FROM organization_members WHERE user_id=? AND organization_id=?",
      )
      .get("u1", "org1") as {
      role: string | null;
      is_school_admin: number;
      status: string;
    };
    expect(Number(member.is_school_admin)).toBe(1);
    expect(member.role).toBeNull();
    expect(member.status).toBe("有効");

    expect(
      revokeSchoolAdmin(sql, {
        organizationId: "org1",
        userId: "u1",
        actorUserId: "super",
      }),
    ).toBe(true);
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
    ).toBe(0);
  });

  it("rejects duplicate open applications and double decisions", () => {
    const { sql } = open();
    applyForSchoolAdmin(sql, {
      id: "app1",
      organizationId: "org1",
      applicantUserId: "u1",
    });
    expect(() =>
      applyForSchoolAdmin(sql, {
        id: "app2",
        organizationId: "org1",
        applicantUserId: "u1",
      }),
    ).toThrow(SchoolAdminError);
    decideSchoolAdminApplication(sql, {
      applicationId: "app1",
      decision: "却下",
      decidedBy: "super",
    });
    expect(() =>
      decideSchoolAdminApplication(sql, {
        applicationId: "app1",
        decision: "登録",
        decidedBy: "super",
      }),
    ).toThrow(SchoolAdminError);
  });
});
