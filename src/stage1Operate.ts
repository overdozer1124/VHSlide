/** Stage 1 operations console: school creation and read models.

 * Responses never include is_super_admin or operator subjects.
 * User rows use the same public columns as the session: id, name, email.
 */

import { writeAuditLog } from "./stage1Audit.ts";

export class OperateError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OperateError";
    this.status = status;
  }
}

export type OperateSql = {
  exec(
    query: string,
    ...args: (string | number | null)[]
  ): { changes?: number };
  one<T extends Record<string, unknown>>(
    query: string,
    ...args: (string | number | null)[]
  ): T | undefined;
  all<T extends Record<string, unknown>>(
    query: string,
    ...args: (string | number | null)[]
  ): T[];
};

export type ManagedSchool = {
  id: string;
  name: string;
  preregistration: boolean;
  membership: boolean;
};

export type ConsoleView = {
  createSchool: boolean;
  decideApplications: boolean;
  revokeSchoolAdmin: boolean;
  operator: boolean;
  operatorGeneration: number | null;
  schools: ManagedSchool[];
  applyTo: { id: string; name: string }[];
};

const schoolName = (value: string) => {
  const name = value.trim();
  if (!name || name.length > 40)
    throw new OperateError(400, "学校の名前を確認してください。");
  return name;
};

function superAdmin(sql: OperateSql, userId: string) {
  return !!sql.one<{ is_super_admin: number }>(
    "SELECT is_super_admin FROM users WHERE id=?",
    userId,
  )?.is_super_admin;
}

export function createSchool(
  sql: OperateSql,
  input: {
    id: string;
    name: string;
    actorId: string;
    now: number;
    auditId: string;
  },
) {
  if (!superAdmin(sql, input.actorId))
    throw new OperateError(403, "学校を作成できるのはスーパー管理者だけです。");
  const name = schoolName(input.name);
  if (
    sql.one("SELECT id FROM organizations WHERE name=? AND status='有効'", name)
  )
    throw new OperateError(409, "同じ名前の学校が既にあります。");
  sql.exec(
    "INSERT INTO organizations(id, name, status, created_at) VALUES(?,?, '有効', ?)",
    input.id,
    name,
    input.now,
  );
  writeAuditLog(sql, {
    id: input.auditId,
    actorUserId: input.actorId,
    action: "organization.create",
    target: `organization:${input.id}`,
    createdAt: input.now,
  });
  return { id: input.id, name };
}

export function consoleView(sql: OperateSql, userId: string): ConsoleView {
  const admin = superAdmin(sql, userId);
  const operator = !!sql.one(
    "SELECT subject FROM stage1_operators WHERE subject=?",
    userId,
  );
  const generation = operator
    ? Number(
        sql.one<{ value: string }>(
          "SELECT value FROM stage1_operator_meta WHERE key='generation'",
        )?.value ?? "0",
      )
    : null;
  const managed = admin
    ? sql
        .all<{ id: string; name: string }>(
          "SELECT id, name FROM organizations WHERE status='有効' ORDER BY created_at, id",
        )
        .map((school) => ({
          id: school.id,
          name: school.name,
          preregistration: true,
          membership: true,
        }))
    : sql
        .all<{ id: string; name: string }>(
          `SELECT organizations.id AS id, organizations.name AS name
           FROM organizations
           JOIN organization_members
             ON organization_members.organization_id=organizations.id
           WHERE organization_members.user_id=?
             AND organization_members.status='有効'
             AND organization_members.is_school_admin=1
             AND organizations.status='有効'
           ORDER BY organizations.created_at, organizations.id`,
          userId,
        )
        .map((school) => ({
          id: school.id,
          name: school.name,
          preregistration: true,
          membership: true,
        }));
  return {
    createSchool: admin,
    decideApplications: admin,
    revokeSchoolAdmin: admin,
    operator,
    operatorGeneration: generation,
    schools: managed,
    applyTo: sql.all<{ id: string; name: string }>(
      "SELECT id, name FROM organizations WHERE status='有効' ORDER BY created_at, id",
    ),
  };
}

export function listPreregistrations(sql: OperateSql, organizationId: string) {
  return sql
    .all<{
      id: string;
      email: string;
      planned_role: string | null;
      status: string;
      created_at: number;
    }>(
      `SELECT id, email, planned_role, status, created_at
       FROM preregistrations WHERE organization_id=? ORDER BY created_at, id`,
      organizationId,
    )
    .map((row) => ({
      id: row.id,
      email: row.email,
      plannedRole: row.planned_role,
      status: row.status,
      createdAt: row.created_at,
    }));
}

export function listApplications(sql: OperateSql, organizationId: string) {
  return sql
    .all<{
      id: string;
      status: string;
      created_at: number;
      user_id: string;
      name: string;
      email: string;
    }>(
      `SELECT school_admin_applications.id AS id,
              school_admin_applications.status AS status,
              school_admin_applications.created_at AS created_at,
              users.id AS user_id, users.name AS name, users.email AS email
       FROM school_admin_applications
       JOIN users ON users.id=school_admin_applications.applicant_user_id
       WHERE school_admin_applications.organization_id=?
       ORDER BY school_admin_applications.created_at, school_admin_applications.id`,
      organizationId,
    )
    .map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      applicant: { id: row.user_id, name: row.name, email: row.email },
    }));
}

export function listMembers(sql: OperateSql, organizationId: string) {
  return sql
    .all<{
      id: string;
      name: string;
      email: string;
      role: string | null;
      status: string;
      school_admin: number;
    }>(
      `SELECT users.id AS id, users.name AS name, users.email AS email,
              organization_members.role AS role,
              organization_members.status AS status,
              organization_members.is_school_admin AS school_admin
       FROM organization_members
       JOIN users ON users.id=organization_members.user_id
       WHERE organization_members.organization_id=?
       ORDER BY users.email, users.id`,
      organizationId,
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      status: row.status,
      schoolAdmin: !!row.school_admin,
    }));
}

export function nodeOperateSql(db: {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown;
    run(...args: unknown[]): { changes?: number | bigint };
  };
}): OperateSql {
  return {
    exec(query, ...args) {
      const result = db.prepare(query).run(...args);
      return { changes: Number(result.changes ?? 0) };
    },
    one<T extends Record<string, unknown>>(
      query: string,
      ...args: (string | number | null)[]
    ) {
      return db.prepare(query).get(...args) as T | undefined;
    },
    all<T extends Record<string, unknown>>(
      query: string,
      ...args: (string | number | null)[]
    ) {
      return db.prepare(query).all(...args) as T[];
    },
  };
}

export function durableOperateSql(sql: {
  exec(
    query: string,
    ...args: (string | number | null)[]
  ): Iterable<Record<string, unknown>> & { rowsWritten?: number };
}): OperateSql {
  return {
    exec(query, ...args) {
      const cursor = sql.exec(query, ...args);
      [...cursor];
      return { changes: cursor.rowsWritten ?? 0 };
    },
    one<T extends Record<string, unknown>>(
      query: string,
      ...args: (string | number | null)[]
    ) {
      return [...sql.exec(query, ...args)][0] as T | undefined;
    },
    all<T extends Record<string, unknown>>(
      query: string,
      ...args: (string | number | null)[]
    ) {
      return [...sql.exec(query, ...args)] as T[];
    },
  };
}
