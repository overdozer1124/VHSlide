import { writeSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  applyPlatformApproval,
  nodeOperatorSql,
} from "../../src/stage1InitialRegistration.ts";

const file = process.argv[2];
const db = new DatabaseSync(file);
db.exec("PRAGMA busy_timeout=5000");
writeSync(1, "trying\n");
try {
  db.exec("BEGIN IMMEDIATE");
  applyPlatformApproval(nodeOperatorSql(db), {
    now: 1_000,
    expiresAt: 5_000,
    operationId: "operation-child",
    subject: "raw-sub-operator",
    nonce: "nonce-child-00001",
    ctxHash: "ctx-nonce-child-00001",
    presented: {
      purpose: "bootstrap",
      envId: "verify-env",
      oneTime: "one-time-secret",
    },
    expected: {
      purpose: "bootstrap",
      envId: "verify-env",
      oneTime: "one-time-secret",
      subject: "raw-sub-operator",
    },
    auditId: "audit-child",
  });
  db.exec("COMMIT");
  writeSync(1, "ok\n");
} catch (error) {
  try {
    db.exec("ROLLBACK");
  } catch {
    /* The lock wait can fail before a transaction starts. */
  }
  const message = error instanceof Error ? error.message : String(error);
  writeSync(1, `err ${message}\n`);
  process.exit(1);
}
