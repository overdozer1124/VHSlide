/** Stage 1 Phase 2: organization_members.generation helpers (design §5). */

export type GenerationSql = {
  exec(query: string, ...args: (string | number | null)[]): { changes?: number };
  one<T extends Record<string, unknown>>(
    query: string,
    ...args: (string | number | null)[]
  ): T | undefined;
};

export type OrganizationMemberRow = {
  user_id: string;
  organization_id: string;
  status: string;
  generation: number;
  role: string | null;
};

/** Read current membership generation, or undefined if no row. */
export function readMemberGeneration(
  sql: GenerationSql,
  userId: string,
  organizationId: string,
): number | undefined {
  const row = sql.one<{ generation: number }>(
    "SELECT generation FROM organization_members WHERE user_id=? AND organization_id=?",
    userId,
    organizationId,
  );
  return row?.generation;
}

/**
 * True when a grant/space record's stored generation matches the current
 * membership generation. Missing membership → fail-closed (false).
 */
export function generationMatches(
  current: number | undefined,
  recorded: number | null | undefined,
): boolean {
  return (
    current !== undefined &&
    recorded != null &&
    Number(recorded) === Number(current)
  );
}

/**
 * Invalidate membership: status → 無効 and generation += 1 in one statement.
 * Does not rewind generation on later re-activation (callers must not SET generation back).
 * Returns the new generation, or undefined if no row was updated.
 */
export function invalidateOrganizationMember(
  sql: GenerationSql,
  userId: string,
  organizationId: string,
): number | undefined {
  const result = sql.exec(
    "UPDATE organization_members SET status='無効', generation=generation+1 WHERE user_id=? AND organization_id=? AND status='有効'",
    userId,
    organizationId,
  );
  if (!result.changes) return undefined;
  const row = sql.one<OrganizationMemberRow>(
    "SELECT user_id, organization_id, status, generation, role FROM organization_members WHERE user_id=? AND organization_id=?",
    userId,
    organizationId,
  );
  if (!row || row.status !== "無効") return undefined;
  return row.generation;
}

/**
 * Re-activate membership (status + role only). Generation is never decreased.
 */
export function reactivateOrganizationMember(
  sql: GenerationSql,
  userId: string,
  organizationId: string,
  role: "teacher" | "student" | null,
): OrganizationMemberRow | undefined {
  sql.exec(
    "UPDATE organization_members SET status='有効', role=? WHERE user_id=? AND organization_id=? AND status='無効'",
    role,
    userId,
    organizationId,
  );
  return sql.one<OrganizationMemberRow>(
    "SELECT user_id, organization_id, status, generation, role FROM organization_members WHERE user_id=? AND organization_id=?",
    userId,
    organizationId,
  );
}

/** Adapter helpers for node:sqlite / DO SqlStorage call sites. */
export function nodeGenerationSql(db: {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): { changes: number };
  };
}): GenerationSql {
  return {
    exec(query, ...args) {
      return db.prepare(query).run(...args);
    },
    one(query, ...args) {
      return db.prepare(query).get(...args) as
        | Record<string, unknown>
        | undefined;
    },
  };
}
