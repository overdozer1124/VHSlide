import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  joinSchema,
  requestJoin,
  joinState,
  pendingJoins,
  decideJoins,
  JOIN_TTL,
} from "./joinRequests";
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT);CREATE TABLE decks(id TEXT PRIMARY KEY);CREATE TABLE members(deck TEXT,user_id TEXT,PRIMARY KEY(deck,user_id));CREATE TABLE invites(deck TEXT,hash TEXT);CREATE TABLE work_trash(deck TEXT);${joinSchema}`,
  );
  db.exec(
    "INSERT INTO decks VALUES('work'),('other');INSERT INTO invites VALUES('work','link'),('other','other-link')",
  );
  for (let i = 0; i < 105; i++)
    db.prepare("INSERT INTO users VALUES(?,?,?)").run(
      "u" + i,
      "Student " + i,
      "u" + i + "@example.test",
    );
  const sql = (q: string, ...a: (string | number)[]) => db.prepare(q).all(...a);
  const transaction = (fn: () => any) => {
    db.exec("BEGIN");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  return { db, sql, transaction };
}
it("keeps pending people outside membership; duplicate requests do not move their date; expiry and invalidation reveal no work", () => {
  const { db, sql } = fixture();
  try {
    const r = requestJoin(sql, "work", "u1", "link", 100) as any;
    expect(r.status).toBe("pending");
    expect(requestJoin(sql, "work", "u1", "link", 101)).toEqual(r);
    expect(sql("SELECT * FROM members")).toHaveLength(0);
    expect(joinState(sql, r.requestId, "u2", 102)).toEqual({
      status: "expired",
    });
    expect(joinState(sql, r.requestId, "u1", 101)).toEqual(r);
    expect(joinState(sql, r.requestId, "u1", 100 + JOIN_TTL)).toEqual({
      status: "expired",
    });
    sql("DELETE FROM invites WHERE deck=?", "work");
    expect(joinState(sql, r.requestId, "u1", 102)).toEqual({
      status: "expired",
    });
    expect(() =>
      decideJoins(sql, "work", { requestIds: [r.requestId] }, true, 102),
    ).toThrow(/失効/);
  } finally {
    db.close();
  }
});
it("validates a whole batch before granting anyone and approves only the checked people", () => {
  const { db, sql, transaction } = fixture();
  try {
    const a = requestJoin(sql, "work", "u1", "link", 100) as any,
      b = requestJoin(sql, "work", "u2", "link", 100) as any,
      c = requestJoin(sql, "other", "u3", "other-link", 100) as any;
    expect(() =>
      transaction(() =>
        decideJoins(
          sql,
          "work",
          { requestIds: [a.requestId, c.requestId] },
          true,
          101,
        ),
      ),
    ).toThrow();
    expect(sql("SELECT * FROM members")).toHaveLength(0);
    transaction(() =>
      decideJoins(sql, "work", { requestIds: [a.requestId] }, true, 101),
    );
    expect(joinState(sql, a.requestId, "u1", 102)).toEqual({
      status: "approved",
      id: "work",
    });
    expect(joinState(sql, b.requestId, "u2", 102).status).toBe("pending");
    transaction(() =>
      decideJoins(sql, "work", { requestIds: [b.requestId] }, false, 101),
    );
    expect(requestJoin(sql, "work", "u2", "link", 102).status).toBe("rejected");
    expect(pendingJoins(sql, "work", 102)).toHaveLength(0);
    expect(sql("SELECT * FROM members")).toHaveLength(1);
  } finally {
    db.close();
  }
});
it("retries approval idempotently without reactivating removed people; pre-sharing counts as existing consent", () => {
  const { db, sql, transaction } = fixture();
  try {
    const a = requestJoin(sql, "work", "u1", "link", 100) as any;
    transaction(() =>
      decideJoins(sql, "work", { requestIds: [a.requestId] }, true, 101),
    );
    transaction(() =>
      decideJoins(sql, "work", { requestIds: [a.requestId] }, true, 102),
    );
    expect(sql("SELECT * FROM members")).toHaveLength(1);
    sql("DELETE FROM members WHERE user_id=?", "u1");
    sql("DELETE FROM join_requests WHERE user_id=?", "u1");
    const next = requestJoin(sql, "work", "u1", "link", 103) as any;
    expect(next.status).toBe("pending");
    expect(next.requestId).not.toBe(a.requestId);
    expect(() =>
      transaction(() =>
        decideJoins(sql, "work", { requestIds: [a.requestId] }, true, 104),
      ),
    ).toThrow();
    expect(sql("SELECT * FROM members")).toHaveLength(0);
    sql("INSERT INTO members VALUES(?,?)", "work", "u1");
    expect(joinState(sql, next.requestId, "u1", 104)).toEqual({
      status: "approved",
      id: "work",
    });
    expect(requestJoin(sql, "work", "u1", "link", 104)).toEqual({
      status: "approved",
      id: "work",
    });
  } finally {
    db.close();
  }
});
it("bounds requests to 100 and frees expired slots; invalid batch input cannot grant access", () => {
  const { db, sql } = fixture();
  try {
    for (let i = 0; i < 100; i++)
      requestJoin(sql, "work", "u" + i, "link", 100);
    expect(() => requestJoin(sql, "work", "u100", "link", 101)).toThrow(/多い/);
    expect(
      requestJoin(sql, "work", "u100", "link", 101 + JOIN_TTL).status,
    ).toBe("pending");
    expect(pendingJoins(sql, "work", 102 + JOIN_TTL)).toHaveLength(1);
    for (const ids of [[], ["invalid"], Array(101).fill("x")])
      expect(() =>
        decideJoins(sql, "work", { requestIds: ids }, true, 102 + JOIN_TTL),
      ).toThrow();
    expect(sql("SELECT * FROM members")).toHaveLength(0);
  } finally {
    db.close();
  }
});
