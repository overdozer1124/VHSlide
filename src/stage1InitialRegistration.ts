/** Stage 1 Phase 2 procedure 4: operator registry and first super-admin. */

import { writeAuditLog } from "./stage1Audit.ts";
import type { Stage1OrgDb } from "./stage1OrgSchema.ts";

export const STAGE1_OPERATOR_MIGRATION_ID = "stage1_operator_v1";

/**
 * Operator registry is separate from users.is_super_admin.
 * subject columns store the raw Google sub (owner decision), not a hash.
 * The one-time approval value is compared and never stored.
 */
export const stage1OperatorTablesSql = `
CREATE TABLE IF NOT EXISTS stage1_operators (
  subject TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL,
  added_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stage1_operator_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stage1_operator_consumed (
  operation_id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  env_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  consumed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stage1_operator_completion (
  operation_id TEXT PRIMARY KEY,
  env_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  purpose TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stage1_admin_nonce (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  ctx_hash TEXT
);
CREATE TABLE IF NOT EXISTS stage1_super_admin_registration (
  env_id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  operation_id TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS stage1_super_admin_recovery (
  id TEXT PRIMARY KEY,
  env_id TEXT NOT NULL,
  old_subject TEXT NOT NULL,
  new_subject TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO stage1_operator_meta(key, value) VALUES('generation', '0');
INSERT OR IGNORE INTO stage1_operator_meta(key, value) VALUES('initialized', '0');
`;

export class InitialRegistrationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "InitialRegistrationError";
    this.status = status;
  }
}

export type OperatorSql = {
  exec(
    query: string,
    ...args: (string | number | null)[]
  ): { changes?: number };
  one<T extends Record<string, unknown>>(
    query: string,
    ...args: (string | number | null)[]
  ): T | undefined;
};

export type PlatformPurpose = "bootstrap" | "full-replace";

export function applyStage1OperatorMigration(
  db: Stage1OrgDb,
  now = Date.now(),
): { applied: boolean; already: boolean } {
  db.exec(stage1OperatorTablesSql);
  if (db.migrationApplied(STAGE1_OPERATOR_MIGRATION_ID)) {
    return { applied: false, already: true };
  }
  db.recordMigration(STAGE1_OPERATOR_MIGRATION_ID, now);
  return { applied: true, already: false };
}

export function issueAdminNonce(
  sql: OperatorSql,
  input: { nonce: string; ctxHash: string; expiresAt: number },
): void {
  requireNonce(input.nonce);
  if (!input.ctxHash) {
    throw new InitialRegistrationError(400, "確認用の文脈を用意できません。");
  }
  sql.exec(
    "INSERT INTO stage1_admin_nonce(nonce, expires_at, used, ctx_hash) VALUES(?,?,0,?)",
    input.nonce,
    input.expiresAt,
    input.ctxHash,
  );
}

export function applyPlatformApproval(
  sql: OperatorSql,
  input: {
    now: number;
    expiresAt: number;
    operationId: string;
    subject: string;
    nonce: string;
    ctxHash: string | null;
    presented: { purpose: string; envId: string; oneTime: string };
    expected: {
      purpose: PlatformPurpose;
      envId: string;
      oneTime: string;
      subject: string;
    };
    auditId: string;
  },
): { generation: number } {
  if (input.expiresAt <= input.now) {
    throw new InitialRegistrationError(403, "承認の期限が切れています。");
  }
  if (
    !input.expected.oneTime ||
    !sameSecret(input.presented.oneTime, input.expected.oneTime)
  ) {
    throw new InitialRegistrationError(403, "確認用の値が一致しません。");
  }
  if (input.presented.purpose !== input.expected.purpose) {
    throw new InitialRegistrationError(403, "用途が一致しません。");
  }
  if (!input.expected.envId || input.presented.envId !== input.expected.envId) {
    throw new InitialRegistrationError(403, "対象環境が一致しません。");
  }
  const subject = requireSubject(input.subject, "対象アカウント");
  if (!sameSecret(subject, input.expected.subject)) {
    throw new InitialRegistrationError(403, "対象のアカウントが一致しません。");
  }
  consumeNonce(sql, input.nonce, input.ctxHash, input.now);
  const operationId = requireOperationId(input.operationId);
  if (
    sql.one(
      "SELECT operation_id FROM stage1_operator_consumed WHERE operation_id=?",
      operationId,
    )
  ) {
    throw new InitialRegistrationError(409, "この操作は既に実施済みです。");
  }
  const initialized = meta(sql, "initialized") === "1";
  if (input.expected.purpose === "bootstrap" && initialized) {
    throw new InitialRegistrationError(409, "初期登録は完了しています。");
  }
  if (input.expected.purpose === "full-replace" && !initialized) {
    throw new InitialRegistrationError(
      409,
      "運営者登録がまだ初期化されていません。",
    );
  }
  const generation = Number(meta(sql, "generation") ?? "0") + 1;
  sql.exec("DELETE FROM stage1_operators");
  sql.exec(
    "INSERT INTO stage1_operators(subject, added_at, added_by) VALUES(?,?,?)",
    subject,
    input.now,
    `platform:${operationId}`,
  );
  setMeta(sql, "generation", String(generation));
  setMeta(sql, "initialized", "1");
  sql.exec(
    "INSERT INTO stage1_operator_consumed(operation_id, purpose, env_id, subject, consumed_at) VALUES(?,?,?,?,?)",
    operationId,
    input.expected.purpose,
    input.expected.envId,
    subject,
    input.now,
  );
  sql.exec(
    "INSERT INTO stage1_operator_completion(operation_id, env_id, subject, purpose, applied_at) VALUES(?,?,?,?,?)",
    operationId,
    input.expected.envId,
    subject,
    input.expected.purpose,
    input.now,
  );
  writeAuditLog(sql, {
    id: input.auditId,
    actorUserId: subject,
    action: `operator.${input.expected.purpose}`,
    target: `operation:${operationId}`,
    createdAt: input.now,
  });
  return { generation };
}

export type OperatorAction =
  | { type: "verify" }
  | { type: "add"; subject: string; expectedGeneration: number }
  | { type: "revoke"; subject: string; expectedGeneration: number }
  | {
      type: "rotate";
      oldSubject: string;
      newSubject: string;
      expectedGeneration: number;
    }
  | { type: "bind"; subject: string; operationId: string }
  | { type: "recover"; oldSubject: string; newSubject: string };

export function operatorActionFromBody(
  kind: string,
  body: Record<string, unknown>,
): OperatorAction {
  if (kind === "verify") return { type: "verify" };
  if (kind === "add" || kind === "revoke") {
    return {
      type: kind,
      subject: String(body.subject ?? ""),
      expectedGeneration: requireGeneration(body.expectedGeneration),
    };
  }
  if (kind === "rotate") {
    return {
      type: "rotate",
      oldSubject: String(body.oldSubject ?? ""),
      newSubject: String(body.newSubject ?? ""),
      expectedGeneration: requireGeneration(body.expectedGeneration),
    };
  }
  if (kind === "bind") {
    return {
      type: "bind",
      subject: String(body.subject ?? ""),
      operationId: String(body.operationId ?? ""),
    };
  }
  if (kind === "recover") {
    return {
      type: "recover",
      oldSubject: String(body.oldSubject ?? ""),
      newSubject: String(body.newSubject ?? ""),
    };
  }
  throw new InitialRegistrationError(404, "見つかりません。");
}

function requireGeneration(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new InitialRegistrationError(400, "登録簿の世代を確認してください。");
  }
  return value;
}

export function performOperatorAction(
  sql: OperatorSql,
  input: {
    action: OperatorAction;
    actor: string;
    nonce: string;
    ctxHash: string | null;
    now: number;
    envId: string;
    auditId: string;
  },
): { ok: true; generation: number } {
  const actor = requireSubject(input.actor, "運営者");
  if (!input.envId) {
    throw new InitialRegistrationError(503, "対象環境が設定されていません。");
  }
  consumeNonce(sql, input.nonce, input.ctxHash, input.now);
  if (!sql.one("SELECT subject FROM stage1_operators WHERE subject=?", actor)) {
    throw new InitialRegistrationError(403, "運営者として登録されていません。");
  }
  const generation = Number(meta(sql, "generation") ?? "0");
  const action = input.action;
  if (action.type === "verify") return { ok: true, generation };
  if (action.type !== "bind" && action.type !== "recover") {
    if (action.expectedGeneration !== generation) {
      throw new InitialRegistrationError(409, "登録簿の世代が一致しません。");
    }
  }
  if (action.type === "add") {
    const subject = requireSubject(action.subject, "追加する運営者");
    if (
      sql.one("SELECT subject FROM stage1_operators WHERE subject=?", subject)
    ) {
      throw new InitialRegistrationError(
        409,
        "その運営者は既に登録されています。",
      );
    }
    sql.exec(
      "INSERT INTO stage1_operators(subject, added_at, added_by) VALUES(?,?,?)",
      subject,
      input.now,
      actor,
    );
    const next = generation + 1;
    setMeta(sql, "generation", String(next));
    audit(sql, input, actor, "operator.add", `sub:${subject}`);
    return { ok: true, generation: next };
  }
  if (action.type === "revoke") {
    const subject = requireSubject(action.subject, "失効する運営者");
    const count = sql.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM stage1_operators",
    );
    if (!count || Number(count.n) <= 1) {
      throw new InitialRegistrationError(409, "最後の運営者は失効できません。");
    }
    const removed = sql.exec(
      "DELETE FROM stage1_operators WHERE subject=?",
      subject,
    );
    if (!removed.changes) {
      throw new InitialRegistrationError(
        404,
        "失効する運営者が見つかりません。",
      );
    }
    const next = generation + 1;
    setMeta(sql, "generation", String(next));
    audit(sql, input, actor, "operator.revoke", `sub:${subject}`);
    return { ok: true, generation: next };
  }
  if (action.type === "rotate") {
    const oldSubject = requireSubject(action.oldSubject, "現在の運営者");
    const newSubject = requireSubject(action.newSubject, "新しい運営者");
    if (sameSecret(oldSubject, newSubject)) {
      throw new InitialRegistrationError(
        400,
        "新しい運営者が現在の運営者と同じです。",
      );
    }
    if (
      sql.one(
        "SELECT subject FROM stage1_operators WHERE subject=?",
        newSubject,
      )
    ) {
      throw new InitialRegistrationError(
        409,
        "その運営者は既に登録されています。",
      );
    }
    const removed = sql.exec(
      "DELETE FROM stage1_operators WHERE subject=?",
      oldSubject,
    );
    if (!removed.changes) {
      throw new InitialRegistrationError(
        404,
        "入れ替える運営者が見つかりません。",
      );
    }
    sql.exec(
      "INSERT INTO stage1_operators(subject, added_at, added_by) VALUES(?,?,?)",
      newSubject,
      input.now,
      actor,
    );
    const next = generation + 1;
    setMeta(sql, "generation", String(next));
    audit(
      sql,
      input,
      actor,
      "operator.rotate",
      `from:${oldSubject}:to:${newSubject}`,
    );
    return { ok: true, generation: next };
  }
  if (action.type === "bind") {
    const subject = requireSubject(action.subject, "スーパー管理者");
    const operationId = requireOperationId(action.operationId);
    if (
      sql.one(
        "SELECT env_id FROM stage1_super_admin_registration WHERE env_id=?",
        input.envId,
      )
    ) {
      throw new InitialRegistrationError(
        409,
        "初代のスーパー管理者は登録済みです。",
      );
    }
    if (sql.one("SELECT id FROM users WHERE is_super_admin=1")) {
      throw new InitialRegistrationError(
        409,
        "スーパー管理者は既に存在します。",
      );
    }
    const user = sql.exec(
      "UPDATE users SET is_super_admin=1 WHERE id=? AND is_super_admin=0",
      subject,
    );
    if (!user.changes) {
      throw new InitialRegistrationError(
        404,
        "対象の利用者はログインしていません。",
      );
    }
    sql.exec(
      "INSERT INTO stage1_super_admin_registration(env_id, subject, registered_at, operation_id) VALUES(?,?,?,?)",
      input.envId,
      subject,
      input.now,
      operationId,
    );
    audit(
      sql,
      input,
      actor,
      "super_admin.bind",
      `env:${input.envId}:sub:${subject}`,
    );
    return { ok: true, generation };
  }
  const oldSubject = requireSubject(action.oldSubject, "現在のスーパー管理者");
  const newSubject = requireSubject(action.newSubject, "新しいスーパー管理者");
  if (sameSecret(oldSubject, newSubject)) {
    throw new InitialRegistrationError(
      400,
      "新しいスーパー管理者が現在と同じです。",
    );
  }
  if (
    !sql.one(
      "SELECT env_id FROM stage1_super_admin_registration WHERE env_id=?",
      input.envId,
    )
  ) {
    throw new InitialRegistrationError(
      409,
      "初代のスーパー管理者は未登録です。",
    );
  }
  const current = sql.one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM users WHERE is_super_admin=1",
  );
  if (!current || Number(current.n) !== 1) {
    throw new InitialRegistrationError(
      409,
      "スーパー管理者の状態を確認できません。",
    );
  }
  const cleared = sql.exec(
    "UPDATE users SET is_super_admin=0 WHERE id=? AND is_super_admin=1",
    oldSubject,
  );
  if (!cleared.changes) {
    throw new InitialRegistrationError(
      409,
      "現在のスーパー管理者が一致しません。",
    );
  }
  const granted = sql.exec(
    "UPDATE users SET is_super_admin=1 WHERE id=? AND is_super_admin=0",
    newSubject,
  );
  if (!granted.changes) {
    throw new InitialRegistrationError(
      404,
      "新しいスーパー管理者はログインしていません。",
    );
  }
  sql.exec(
    "INSERT INTO stage1_super_admin_recovery(id, env_id, old_subject, new_subject, actor_subject, created_at) VALUES(?,?,?,?,?,?)",
    input.auditId,
    input.envId,
    oldSubject,
    newSubject,
    actor,
    input.now,
  );
  audit(
    sql,
    input,
    actor,
    "super_admin.recover",
    `env:${input.envId}:from:${oldSubject}:to:${newSubject}`,
  );
  return { ok: true, generation };
}

function audit(
  sql: OperatorSql,
  input: { auditId: string; now: number },
  actor: string,
  action: string,
  target: string,
) {
  writeAuditLog(sql, {
    id: input.auditId,
    actorUserId: actor,
    action,
    target,
    createdAt: input.now,
  });
}

function consumeNonce(
  sql: OperatorSql,
  nonce: string,
  ctxHash: string | null,
  now: number,
) {
  requireNonce(nonce);
  const row = sql.one<{ used: number; expires_at: number; ctx_hash: string }>(
    "SELECT used, expires_at, ctx_hash FROM stage1_admin_nonce WHERE nonce=?",
    nonce,
  );
  if (!row) throw new InitialRegistrationError(401, "確認用の番号が無効です。");
  if (Number(row.used)) {
    throw new InitialRegistrationError(403, "確認用の番号は使用済みです。");
  }
  if (Number(row.expires_at) <= now) {
    throw new InitialRegistrationError(
      401,
      "確認用の番号の期限が切れています。",
    );
  }
  if (!ctxHash || !sameSecret(String(row.ctx_hash), ctxHash)) {
    throw new InitialRegistrationError(403, "確認用の文脈が一致しません。");
  }
  const burned = sql.exec(
    "UPDATE stage1_admin_nonce SET used=1 WHERE nonce=? AND used=0",
    nonce,
  );
  if (!burned.changes) {
    throw new InitialRegistrationError(403, "確認用の番号は使用済みです。");
  }
}

function meta(sql: OperatorSql, key: string) {
  return sql.one<{ value: string }>(
    "SELECT value FROM stage1_operator_meta WHERE key=?",
    key,
  )?.value;
}

function setMeta(sql: OperatorSql, key: string, value: string) {
  sql.exec(
    "INSERT INTO stage1_operator_meta(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    key,
    value,
  );
}

function requireSubject(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 255 ||
    /[\u0000-\u001f]/.test(value)
  ) {
    throw new InitialRegistrationError(400, `${label}を確認してください。`);
  }
  return value;
}

function requireNonce(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new InitialRegistrationError(401, "確認用の番号が無効です。");
  }
  return value;
}

function requireOperationId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(value)) {
    throw new InitialRegistrationError(400, "操作IDを確認してください。");
  }
  return value;
}

function sameSecret(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function nodeOperatorSql(db: {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): { changes?: number | bigint };
  };
}): OperatorSql {
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

export function durableOperatorSql(sql: {
  exec(
    query: string,
    ...args: (string | number | null)[]
  ): Iterable<Record<string, unknown>> & { rowsWritten?: number };
}): OperatorSql {
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
