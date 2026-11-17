/** Stage 1 Phase 2 procedure 2: required audit_log writes (owner decision). */

export type AuditEntry = {
  id: string;
  actorUserId: string | null;
  action: string;
  target: string;
  createdAt: number;
};

export class AuditRequiredError extends Error {
  constructor(message = "監査ログを記録できないため、操作を完了できません。") {
    super(message);
    this.name = "AuditRequiredError";
  }
}

export type AuditSql = {
  exec(query: string, ...args: (string | number | null)[]): unknown;
};

/**
 * Append one audit_log row. Fail-closed: any write error rejects the operation.
 * Call inside the same transaction as the privilege change.
 */
export function writeAuditLog(sql: AuditSql, entry: AuditEntry): void {
  try {
    sql.exec(
      "INSERT INTO audit_log(id, actor_user_id, action, target, created_at) VALUES(?,?,?,?,?)",
      entry.id,
      entry.actorUserId,
      entry.action,
      entry.target,
      entry.createdAt,
    );
  } catch (error) {
    throw new AuditRequiredError(
      error instanceof Error
        ? `監査ログを記録できません: ${error.message}`
        : undefined,
    );
  }
}
