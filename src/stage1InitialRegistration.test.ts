import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { applyStage1OrgMigration, nodeStage1OrgDb } from "./stage1OrgSchema";
import {
  InitialRegistrationError,
  applyPlatformApproval,
  applyStage1OperatorInviteMigration,
  applyStage1OperatorMigration,
  createOperatorInvitation,
  issueAdminNonce,
  nodeOperatorSql,
  performOperatorAction,
  revokeOperatorByPublicId,
} from "./stage1InitialRegistration";

const expected = {
  purpose: "bootstrap" as const,
  envId: "verify-env",
  oneTime: "one-time-secret",
  subject: "raw-sub-operator",
};

function open() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(
    "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
  );
  const org = nodeStage1OrgDb(db);
  applyStage1OrgMigration(org, 1);
  applyStage1OperatorMigration(org, 2);
  applyStage1OperatorInviteMigration(org, 3);
  return db;
}

function tx<T>(db: DatabaseSync, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function nonce(db: DatabaseSync, id: string, expiresAt = 5_000) {
  tx(db, () =>
    issueAdminNonce(nodeOperatorSql(db), {
      nonce: id,
      ctxHash: `ctx-${id}`,
      expiresAt,
    }),
  );
}

function platform(
  db: DatabaseSync,
  patch: Partial<Parameters<typeof applyPlatformApproval>[1]> = {},
) {
  const nonceId = patch.nonce ?? "nonce-bootstrap-1";
  return tx(db, () =>
    applyPlatformApproval(nodeOperatorSql(db), {
      now: 1_000,
      expiresAt: 5_000,
      operationId: "operation-bootstrap",
      subject: expected.subject,
      nonce: nonceId,
      ctxHash: `ctx-${nonceId}`,
      presented: {
        purpose: "bootstrap",
        envId: "verify-env",
        oneTime: "one-time-secret",
      },
      expected,
      auditId: `audit-${patch.operationId ?? "operation-bootstrap"}`,
      ...patch,
    }),
  );
}

describe("stage1 operator migration", () => {
  it("records stage1_operator_v1 once and does not grant a super admin", () => {
    const db = open();
    const again = applyStage1OperatorMigration(nodeStage1OrgDb(db), 3);
    expect(again).toEqual({ applied: false, already: true });
    expect(
      db
        .prepare("SELECT id FROM schema_migrations WHERE id=?")
        .get("stage1_operator_v1"),
    ).toBeTruthy();
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM stage1_operators").get(),
    ).toEqual({ n: 0 });
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE is_super_admin=1")
        .get(),
    ).toEqual({ n: 0 });
  });
});

describe("platform approval", () => {
  it("stores the raw sub and rejects a second bootstrap", () => {
    const db = open();
    nonce(db, "nonce-bootstrap-1");
    expect(platform(db).generation).toBe(1);
    const row = db.prepare("SELECT subject FROM stage1_operators").get() as {
      subject: string;
    };
    expect(row.subject).toBe("raw-sub-operator");
    expect(row.subject).not.toBe(
      createHash("sha256").update("raw-sub-operator").digest("hex"),
    );
    nonce(db, "nonce-bootstrap-2");
    expect(() =>
      platform(db, {
        nonce: "nonce-bootstrap-2",
        operationId: "operation-bootstrap-2",
        auditId: "audit-2",
      }),
    ).toThrow(InitialRegistrationError);
    expect(
      db
        .prepare(
          "SELECT value FROM stage1_operator_meta WHERE key='generation'",
        )
        .get(),
    ).toEqual({ value: "1" });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM stage1_operator_completion").get(),
    ).toEqual({ n: 1 });
  });

  it("does not consume a nonce when the fixed subject does not match", () => {
    const db = open();
    nonce(db, "nonce-mismatch-01");
    expect(() =>
      platform(db, {
        nonce: "nonce-mismatch-01",
        subject: "someone-else",
        operationId: "operation-mismatch",
        auditId: "audit-mismatch",
      }),
    ).toThrow(/アカウントが一致しません/);
    expect(
      db
        .prepare("SELECT used FROM stage1_admin_nonce WHERE nonce=?")
        .get("nonce-mismatch-01"),
    ).toEqual({ used: 0 });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM stage1_operators").get(),
    ).toEqual({ n: 0 });
  });

  it("replaces the registry on full-replace and keeps the old completion", () => {
    const db = open();
    nonce(db, "nonce-bootstrap-1");
    platform(db);
    nonce(db, "nonce-replace-001");
    const replaced = platform(db, {
      nonce: "nonce-replace-001",
      operationId: "operation-replace",
      subject: "raw-sub-replacement",
      auditId: "audit-replace",
      presented: {
        purpose: "full-replace",
        envId: "verify-env",
        oneTime: "one-time-secret",
      },
      expected: {
        ...expected,
        purpose: "full-replace",
        subject: "raw-sub-replacement",
      },
    });
    expect(replaced.generation).toBe(2);
    expect(db.prepare("SELECT subject FROM stage1_operators").get()).toEqual({
      subject: "raw-sub-replacement",
    });
    expect(
      db
        .prepare(
          "SELECT purpose FROM stage1_operator_completion ORDER BY applied_at",
        )
        .all(),
    ).toEqual([{ purpose: "bootstrap" }, { purpose: "full-replace" }]);
  });

  it("rejects a replay of a consumed full-replace operation", () => {
    const db = open();
    nonce(db, "nonce-bootstrap-1");
    platform(db);
    const replaced = {
      nonce: "nonce-replace-001",
      operationId: "operation-replace",
      subject: "raw-sub-replacement",
      auditId: "audit-replace",
      presented: {
        purpose: "full-replace",
        envId: "verify-env",
        oneTime: "one-time-secret",
      },
      expected: {
        ...expected,
        purpose: "full-replace" as const,
        subject: "raw-sub-replacement",
      },
    };
    nonce(db, replaced.nonce);
    platform(db, replaced);
    nonce(db, "nonce-replace-replay");
    expect(() =>
      platform(db, {
        ...replaced,
        nonce: "nonce-replace-replay",
        auditId: "audit-replace-replay",
      }),
    ).toThrow(/実施済み/);
    expect(
      db
        .prepare(
          "SELECT value FROM stage1_operator_meta WHERE key='generation'",
        )
        .get(),
    ).toEqual({ value: "2" });
    expect(db.prepare("SELECT subject FROM stage1_operators").get()).toEqual({
      subject: "raw-sub-replacement",
    });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM stage1_operator_completion").get(),
    ).toEqual({ n: 2 });
  });
});

describe("in-app operator actions", () => {
  function ready() {
    const db = open();
    nonce(db, "nonce-bootstrap-1");
    platform(db);
    db.prepare("INSERT INTO users(id,name,email) VALUES(?,?,?)").run(
      "raw-sub-admin",
      "admin",
      "admin@example.test",
    );
    db.prepare("INSERT INTO users(id,name,email) VALUES(?,?,?)").run(
      "raw-sub-next",
      "next",
      "next@example.test",
    );
    return db;
  }

  function act(
    db: DatabaseSync,
    action: Parameters<typeof performOperatorAction>[1]["action"],
    nonceId: string,
    patch: Partial<Parameters<typeof performOperatorAction>[1]> = {},
  ) {
    nonce(db, nonceId);
    return tx(db, () =>
      performOperatorAction(nodeOperatorSql(db), {
        action,
        actor: "raw-sub-operator",
        nonce: nonceId,
        ctxHash: `ctx-${nonceId}`,
        now: 2_000,
        envId: "verify-env",
        auditId: `audit-${nonceId}`,
        ...patch,
      }),
    );
  }

  it("binds the first super admin once and recovers without the old session", () => {
    const db = ready();
    expect(
      act(
        db,
        { type: "bind", subject: "raw-sub-admin", operationId: "bind-op-0001" },
        "nonce-bind-000001",
      ).ok,
    ).toBe(true);
    expect(
      db
        .prepare("SELECT is_super_admin FROM users WHERE id=?")
        .get("raw-sub-admin"),
    ).toEqual({ is_super_admin: 1 });
    expect(() =>
      act(
        db,
        { type: "bind", subject: "raw-sub-next", operationId: "bind-op-0002" },
        "nonce-bind-000002",
      ),
    ).toThrow(/登録済み/);
    expect(
      db.prepare("SELECT subject FROM stage1_super_admin_registration").get(),
    ).toEqual({ subject: "raw-sub-admin" });
    act(
      db,
      {
        type: "recover",
        oldSubject: "raw-sub-admin",
        newSubject: "raw-sub-next",
      },
      "nonce-recover-001",
      { actor: "raw-sub-operator" },
    );
    expect(
      db.prepare("SELECT id FROM users WHERE is_super_admin=1").get(),
    ).toEqual({ id: "raw-sub-next" });
    expect(
      db.prepare("SELECT subject FROM stage1_super_admin_registration").get(),
    ).toEqual({ subject: "raw-sub-admin" });
    expect(
      db
        .prepare(
          "SELECT old_subject, new_subject FROM stage1_super_admin_recovery",
        )
        .get(),
    ).toEqual({ old_subject: "raw-sub-admin", new_subject: "raw-sub-next" });
  });

  it("rejects a replayed nonce and protects the last operator", () => {
    const db = ready();
    const nonceId = "nonce-verify-0001";
    nonce(db, nonceId);
    const once = () =>
      tx(db, () =>
        performOperatorAction(nodeOperatorSql(db), {
          action: { type: "verify" },
          actor: "raw-sub-operator",
          nonce: nonceId,
          ctxHash: `ctx-${nonceId}`,
          now: 2_000,
          envId: "verify-env",
          auditId: "audit-verify",
        }),
      );
    once();
    expect(once).toThrow(/使用済み/);
    const publicId = (
      db.prepare("SELECT public_id FROM stage1_operators").get() as {
        public_id: string;
      }
    ).public_id;
    nonce(db, "nonce-revoke-0001");
    expect(() =>
      tx(db, () =>
        revokeOperatorByPublicId(nodeOperatorSql(db), {
          publicId,
          expectedGeneration: 1,
          actor: "raw-sub-operator",
          nonce: "nonce-revoke-0001",
          ctxHash: "ctx-nonce-revoke-0001",
          now: 2_000,
          envId: "verify-env",
          auditId: "audit-revoke-last",
        }),
      ),
    ).toThrow(expect.objectContaining({ status: 409 }));
    nonce(db, "nonce-revoke-absent");
    let absent: unknown;
    try {
      tx(db, () =>
        revokeOperatorByPublicId(nodeOperatorSql(db), {
          publicId: "missing-public-id",
          expectedGeneration: 1,
          actor: "raw-sub-operator",
          nonce: "nonce-revoke-absent",
          ctxHash: "ctx-nonce-revoke-absent",
          now: 2_000,
          envId: "verify-env",
          auditId: "audit-revoke-absent",
        }),
      );
    } catch (error) {
      absent = error;
    }
    expect(absent).toMatchObject({ status: 404 });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM stage1_operators").get(),
    ).toEqual({ n: 1 });
  });

  it("does not put a subject in an invitation and refuses a second active invite", () => {
    const db = ready();
    db.prepare("INSERT INTO users(id,name,email) VALUES(?,?,?)").run(
      "raw-sub-operator",
      "operator",
      "operator@example.test",
    );
    const invite = (nonceId: string, email: string) => {
      nonce(db, nonceId);
      return tx(db, () =>
        createOperatorInvitation(nodeOperatorSql(db), {
          id: `invite-${nonceId}`,
          email,
          actor: "raw-sub-operator",
          nonce: nonceId,
          ctxHash: `ctx-${nonceId}`,
          now: 2_000,
          envId: "verify-env",
          auditId: `audit-${nonceId}`,
        }),
      );
    };
    const created = invite("nonce-invite-0001", "Next@Example.test");
    expect(created.email).toBe("next@example.test");
    expect(JSON.stringify(created)).not.toContain("raw-sub");
    expect(
      db
        .prepare("SELECT target FROM audit_log WHERE id=?")
        .get("audit-nonce-invite-0001"),
    ).toEqual({ target: "invitation:invite-nonce-invite-0001" });
    expect(() => invite("nonce-invite-0002", "next@example.test")).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(() => invite("nonce-invite-0003", "operator@example.test")).toThrow(
      expect.objectContaining({ status: 409 }),
    );
  });

  it("rolls back registry and super-admin changes when the audit write fails", () => {
    const db = ready();
    db.prepare(
      "INSERT INTO audit_log(id, actor_user_id, action, target, created_at) VALUES(?,?,?,?,?)",
    ).run("audit-nonce-add-fail-01", null, "seed", "seed", 1);
    db.prepare(
      "INSERT INTO audit_log(id, actor_user_id, action, target, created_at) VALUES(?,?,?,?,?)",
    ).run("audit-nonce-bind-fail-01", null, "seed", "seed", 1);
    nonce(db, "nonce-add-fail-01");
    expect(() =>
      tx(db, () =>
        createOperatorInvitation(nodeOperatorSql(db), {
          id: "invite-fail",
          email: "extra@example.test",
          actor: "raw-sub-operator",
          nonce: "nonce-add-fail-01",
          ctxHash: "ctx-nonce-add-fail-01",
          now: 2_000,
          envId: "verify-env",
          auditId: "audit-nonce-add-fail-01",
        }),
      ),
    ).toThrow(/監査ログ/);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM stage1_operators").get(),
    ).toEqual({ n: 1 });
    expect(
      db
        .prepare(
          "SELECT value FROM stage1_operator_meta WHERE key='generation'",
        )
        .get(),
    ).toEqual({ value: "1" });
    expect(() =>
      act(
        db,
        {
          type: "bind",
          subject: "raw-sub-admin",
          operationId: "bind-op-fail01",
        },
        "nonce-bind-fail-01",
      ),
    ).toThrow(/監査ログ/);
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE is_super_admin=1")
        .get(),
    ).toEqual({ n: 0 });
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM stage1_super_admin_registration")
        .get(),
    ).toEqual({ n: 0 });
  });
});

describe("concurrent bootstrap", () => {
  it("lets exactly one bootstrap commit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vhslide-op-race-"));
    const file = join(dir, "race.sqlite");
    const db = new DatabaseSync(file);
    db.exec("PRAGMA busy_timeout=5000");
    db.exec(
      "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL)",
    );
    applyStage1OrgMigration(nodeStage1OrgDb(db), 1);
    applyStage1OperatorMigration(nodeStage1OrgDb(db), 2);
    applyStage1OperatorInviteMigration(nodeStage1OrgDb(db), 3);
    nonce(db, "nonce-parent-0001");
    nonce(db, "nonce-child-00001");
    db.exec("BEGIN IMMEDIATE");
    applyPlatformApproval(nodeOperatorSql(db), {
      now: 1_000,
      expiresAt: 5_000,
      operationId: "operation-parent",
      subject: expected.subject,
      nonce: "nonce-parent-0001",
      ctxHash: "ctx-nonce-parent-0001",
      presented: {
        purpose: "bootstrap",
        envId: "verify-env",
        oneTime: "one-time-secret",
      },
      expected,
      auditId: "audit-parent",
    });
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "tests/server/stage1-operator-race-child.ts",
        file,
      ],
      { cwd: process.cwd() },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`child did not start: ${output}`)),
        5_000,
      );
      child.stdout.on("data", () => {
        if (output.includes("trying")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    db.exec("COMMIT");
    const code = await new Promise<number>((resolve) =>
      child.on("exit", (status) => resolve(status ?? 1)),
    );
    expect(code).not.toBe(0);
    expect(output).toContain("初期登録は完了しています。");
    expect(
      db
        .prepare(
          "SELECT value FROM stage1_operator_meta WHERE key='generation'",
        )
        .get(),
    ).toEqual({ value: "1" });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM stage1_operator_completion").get(),
    ).toEqual({ n: 1 });
    db.close();
  });
});
