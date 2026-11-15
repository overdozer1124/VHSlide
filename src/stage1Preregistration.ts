/** Stage 1 Phase 2 procedure 3: preregistration create / cancel / login bind. */

import { normalizeEmail } from "./preSharing.ts";

export type PreregSql = {
  exec(query: string, ...args: (string | number | null)[]): { changes?: number };
  one<T extends Record<string, unknown>>(
    query: string,
    ...args: (string | number | null)[]
  ): T | undefined;
  all<T extends Record<string, unknown>>(
    query: string,
    ...args: (string | number | null)[]
  ): T[];
};

export class PreregistrationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "PreregistrationError";
  }
}

export type PlannedRole = "teacher" | "student" | null;

export type PreregistrationRow = {
  id: string;
  email: string;
  organization_id: string;
  planned_role: PlannedRole;
  planned_is_school_admin: number;
  planned_can_create_space: number;
  status: string;
  bound_user_id: string | null;
  bound_at: number | null;
  created_by: string;
  created_at: number;
};

export function createPreregistration(
  sql: PreregSql,
  input: {
    id: string;
    email: string;
    organizationId: string;
    plannedRole: PlannedRole;
    plannedIsSchoolAdmin?: boolean;
    plannedCanCreateSpace?: boolean;
    createdBy: string;
    createdAt?: number;
  },
): PreregistrationRow {
  const email = normalizeEmail(input.email);
  if (!email) throw new PreregistrationError(400, "メールアドレスを確認してください。");
  const createdAt = input.createdAt ?? Date.now();
  try {
    sql.exec(
      `INSERT INTO preregistrations(
        id, email, organization_id, planned_role, planned_is_school_admin,
        planned_can_create_space, status, bound_user_id, bound_at, created_by, created_at
      ) VALUES(?,?,?,?,?,?, '有効', NULL, NULL, ?,?)`,
      input.id,
      email,
      input.organizationId,
      input.plannedRole,
      input.plannedIsSchoolAdmin ? 1 : 0,
      input.plannedCanCreateSpace ? 1 : 0,
      input.createdBy,
      createdAt,
    );
  } catch {
    throw new PreregistrationError(
      409,
      "同じ学校に有効な事前登録が既にあります。",
    );
  }
  const row = sql.one<PreregistrationRow>(
    "SELECT * FROM preregistrations WHERE id=?",
    input.id,
  );
  if (!row) throw new PreregistrationError(500, "事前登録を保存できませんでした。");
  return row;
}

/** Active → cancelled. Returns false if already consumed/cancelled. */
export function cancelPreregistration(
  sql: PreregSql,
  id: string,
): boolean {
  const result = sql.exec(
    "UPDATE preregistrations SET status='取消' WHERE id=? AND status='有効'",
    id,
  );
  return !!result.changes;
}

export type BindResult = {
  bound: { preregistrationId: string; organizationId: string }[];
  cancelledInactive: { preregistrationId: string; organizationId: string }[];
};

/**
 * On login: consume each active preregistration for the verified email.
 * Same TX as caller. planned_is_school_admin is never copied onto membership.
 * If membership for (user, org) is already 無効, cancel the prereg instead of binding.
 */
export function bindPreregistrationsOnLogin(
  sql: PreregSql,
  input: {
    userId: string;
    email: string;
    emailVerified: boolean;
    now?: number;
  },
): BindResult {
  if (!input.emailVerified) return { bound: [], cancelledInactive: [] };
  const email = normalizeEmail(input.email);
  const now = input.now ?? Date.now();
  const active = sql.all<PreregistrationRow>(
    "SELECT * FROM preregistrations WHERE email=? AND status='有効'",
    email,
  );
  const bound: BindResult["bound"] = [];
  const cancelledInactive: BindResult["cancelledInactive"] = [];
  for (const row of active) {
    const member = sql.one<{ status: string }>(
      "SELECT status FROM organization_members WHERE user_id=? AND organization_id=?",
      input.userId,
      row.organization_id,
    );
    if (member?.status === "無効") {
      sql.exec(
        "UPDATE preregistrations SET status='取消' WHERE id=? AND status='有効'",
        row.id,
      );
      cancelledInactive.push({
        preregistrationId: row.id,
        organizationId: row.organization_id,
      });
      continue;
    }
    const consume = sql.exec(
      "UPDATE preregistrations SET status='結びつけ済み', bound_user_id=?, bound_at=? WHERE id=? AND status='有効'",
      input.userId,
      now,
      row.id,
    );
    if (!consume.changes) continue;
    if (!member) {
      sql.exec(
        `INSERT INTO organization_members(
          user_id, organization_id, role, is_school_admin, can_create_space,
          status, generation, created_at
        ) VALUES(?,?,?,0,?,?,1,?)`,
        input.userId,
        row.organization_id,
        row.planned_role,
        row.planned_can_create_space ? 1 : 0,
        "有効",
        now,
      );
    }
    bound.push({
      preregistrationId: row.id,
      organizationId: row.organization_id,
    });
  }
  return { bound, cancelledInactive };
}

export function nodePreregSql(db: {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    run(...args: unknown[]): { changes: number };
  };
}): PreregSql {
  return {
    exec(query, ...args) {
      return db.prepare(query).run(...args);
    },
    one(query, ...args) {
      return db.prepare(query).get(...args) as
        | Record<string, unknown>
        | undefined;
    },
    all(query, ...args) {
      return db.prepare(query).all(...args) as Record<string, unknown>[];
    },
  };
}
