import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  applyStage1OrgMigration,
  nodeStage1OrgDb,
} from "./stage1OrgSchema";
import { AuditRequiredError, writeAuditLog } from "./stage1Audit";

describe("stage1Audit", () => {
  it("writes audit_log and fails closed when the table is missing", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );
    applyStage1OrgMigration(nodeStage1OrgDb(db));
    const sql = {
      exec(query: string, ...args: (string | number | null)[]) {
        db.prepare(query).run(...args);
      },
    };
    writeAuditLog(sql, {
      id: "a1",
      actorUserId: "u1",
      action: "test.action",
      target: "org:1",
      createdAt: 10,
    });
    expect(
      db.prepare("SELECT action, target FROM audit_log WHERE id=?").get("a1"),
    ).toEqual({ action: "test.action", target: "org:1" });

    const bare = new DatabaseSync(":memory:");
    expect(() =>
      writeAuditLog(
        {
          exec(query: string, ...args: (string | number | null)[]) {
            bare.prepare(query).run(...args);
          },
        },
        {
          id: "a2",
          actorUserId: null,
          action: "x",
          target: "y",
          createdAt: 1,
        },
      ),
    ).toThrow(AuditRequiredError);
  });
});
