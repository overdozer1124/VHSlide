/** Stage 1 Phase 2 procedure 3: school-admin application and appointment. */

export type SchoolAdminSql = {
  exec(query: string, ...args: (string | number | null)[]): { changes?: number };
  one<T extends Record<string, unknown>>(
    query: string,
    ...args: (string | number | null)[]
  ): T | undefined;
};

export class SchoolAdminError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "SchoolAdminError";
  }
}

export type SchoolAdminApplicationRow = {
  id: string;
  organization_id: string;
  applicant_user_id: string;
  status: string;
  decided_by: string | null;
  created_at: number;
  decided_at: number | null;
};

export function isSuperAdmin(sql: SchoolAdminSql, userId: string): boolean {
  const row = sql.one<{ is_super_admin: number }>(
    "SELECT is_super_admin FROM users WHERE id=?",
    userId,
  );
  return !!row?.is_super_admin;
}

/** Applicant creates 申請中. One open application per (user, org). */
export function applyForSchoolAdmin(
  sql: SchoolAdminSql,
  input: {
    id: string;
    organizationId: string;
    applicantUserId: string;
    createdAt?: number;
  },
): SchoolAdminApplicationRow {
  const open = sql.one(
    "SELECT id FROM school_admin_applications WHERE organization_id=? AND applicant_user_id=? AND status='申請中'",
    input.organizationId,
    input.applicantUserId,
  );
  if (open)
    throw new SchoolAdminError(409, "すでに申請中の学校管理者申請があります。");
  const createdAt = input.createdAt ?? Date.now();
  sql.exec(
    `INSERT INTO school_admin_applications(
      id, organization_id, applicant_user_id, status, decided_by, created_at, decided_at
    ) VALUES(?,?,?,'申請中',NULL,?,NULL)`,
    input.id,
    input.organizationId,
    input.applicantUserId,
    createdAt,
  );
  const row = sql.one<SchoolAdminApplicationRow>(
    "SELECT * FROM school_admin_applications WHERE id=?",
    input.id,
  );
  if (!row) throw new SchoolAdminError(500, "申請を保存できませんでした。");
  return row;
}

/**
 * Super-admin only. 登録 → membership.is_school_admin=1 (create member if needed, role stays NULL when new).
 * 却下 → status only. Never copies planned_is_school_admin from preregistrations.
 */
export function decideSchoolAdminApplication(
  sql: SchoolAdminSql,
  input: {
    applicationId: string;
    decision: "登録" | "却下";
    decidedBy: string;
    decidedAt?: number;
  },
): SchoolAdminApplicationRow {
  if (!isSuperAdmin(sql, input.decidedBy))
    throw new SchoolAdminError(
      403,
      "学校管理者の任命を確定できるのはスーパー管理者だけです。",
    );
  const app = sql.one<SchoolAdminApplicationRow>(
    "SELECT * FROM school_admin_applications WHERE id=?",
    input.applicationId,
  );
  if (!app) throw new SchoolAdminError(404, "申請が見つかりません。");
  if (app.status !== "申請中")
    throw new SchoolAdminError(409, "この申請はすでに処理済みです。");
  const decidedAt = input.decidedAt ?? Date.now();
  // 登録: 無効所属は復活させない（設計 §5 — 再有効化は別経路）。状態更新より先に判定する。
  let existingMember: { status: string } | undefined;
  if (input.decision === "登録") {
    existingMember = sql.one<{ status: string }>(
      "SELECT status FROM organization_members WHERE user_id=? AND organization_id=?",
      app.applicant_user_id,
      app.organization_id,
    );
    if (existingMember && existingMember.status !== "有効")
      throw new SchoolAdminError(
        409,
        "所属が無効です。任命の前に所属の再有効化を行ってください。",
      );
  }
  const updated = sql.exec(
    "UPDATE school_admin_applications SET status=?, decided_by=?, decided_at=? WHERE id=? AND status='申請中'",
    input.decision,
    input.decidedBy,
    decidedAt,
    input.applicationId,
  );
  if (!updated.changes)
    throw new SchoolAdminError(409, "この申請はすでに処理済みです。");
  if (input.decision === "登録") {
    if (!existingMember) {
      sql.exec(
        `INSERT INTO organization_members(
          user_id, organization_id, role, is_school_admin, can_create_space,
          status, generation, created_at
        ) VALUES(?,?,NULL,1,0,'有効',1,?)`,
        app.applicant_user_id,
        app.organization_id,
        decidedAt,
      );
    } else {
      sql.exec(
        "UPDATE organization_members SET is_school_admin=1 WHERE user_id=? AND organization_id=? AND status='有効'",
        app.applicant_user_id,
        app.organization_id,
      );
    }
  }
  const row = sql.one<SchoolAdminApplicationRow>(
    "SELECT * FROM school_admin_applications WHERE id=?",
    input.applicationId,
  );
  if (!row) throw new SchoolAdminError(500, "申請の更新結果を読めませんでした。");
  return row;
}

/** Super-admin only. Clear is_school_admin without changing generation. */
export function revokeSchoolAdmin(
  sql: SchoolAdminSql,
  input: {
    organizationId: string;
    userId: string;
    actorUserId: string;
  },
): boolean {
  if (!isSuperAdmin(sql, input.actorUserId))
    throw new SchoolAdminError(
      403,
      "学校管理者の解除ができるのはスーパー管理者だけです。",
    );
  const result = sql.exec(
    "UPDATE organization_members SET is_school_admin=0 WHERE user_id=? AND organization_id=? AND is_school_admin=1",
    input.userId,
    input.organizationId,
  );
  return !!result.changes;
}

export function nodeSchoolAdminSql(db: {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): { changes?: number | bigint };
  };
}): SchoolAdminSql {
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
  };
}

export function durableSchoolAdminSql(sql: {
  exec(
    query: string,
    ...args: (string | number | null)[]
  ): Iterable<Record<string, unknown>> & { rowsWritten?: number };
}): SchoolAdminSql {
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
  };
}
