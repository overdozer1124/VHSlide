import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { featureVersion } from "./featureVersions.ts";
import { groupSchema } from "./groups.ts";
import { webbingSchema } from "./webbing.ts";
import { worksheetSchema } from "./worksheets.ts";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE decks(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE members(deck TEXT, user_id TEXT);",
  );
  db.exec(worksheetSchema);
  db.exec(webbingSchema);
  db.exec(groupSchema);
  const sql = (query: string, ...args: (string | number)[]) =>
    db.prepare(query).all(...(args as never[])) as Record<string, any>[];
  db.prepare("INSERT INTO decks VALUES('d1')").run();
  return { db, sql };
}

describe("feature version triggers", () => {
  it("bumps the worksheets counter on sheet and answer changes", () => {
    const { db, sql } = fixture();
    expect(featureVersion(sql, "d1", "worksheets")).toBe(0);
    db.prepare(
      "INSERT INTO worksheets VALUES('w1','d1','{}','open',1)",
    ).run();
    expect(featureVersion(sql, "d1", "worksheets")).toBe(1);
    db.prepare(
      "INSERT INTO worksheet_answers VALUES('w1','u1','{}',2)",
    ).run();
    expect(featureVersion(sql, "d1", "worksheets")).toBe(2);
    db.prepare(
      "UPDATE worksheet_answers SET value='{\"a\":1}' WHERE worksheet='w1'",
    ).run();
    expect(featureVersion(sql, "d1", "worksheets")).toBe(3);
    db.prepare("DELETE FROM worksheets WHERE id='w1'").run();
    expect(featureVersion(sql, "d1", "worksheets")).toBeGreaterThan(3);
    expect(featureVersion(sql, "other", "worksheets")).toBe(0);
  });

  it("bumps webbing and groups counters via their own tables", () => {
    const { db, sql } = fixture();
    db.prepare(
      "INSERT INTO webbing_maps(id,deck,title,status,created) VALUES('m1','d1','題','open',1)",
    ).run();
    expect(featureVersion(sql, "d1", "webbing")).toBe(1);
    db.prepare(
      "INSERT INTO webbing_nodes VALUES('n1','m1','',NULL,'u1','x',0,0,1,1)",
    ).run();
    expect(featureVersion(sql, "d1", "webbing")).toBe(2);
    db.prepare("INSERT INTO deck_groups VALUES('g1','d1','1班',0)").run();
    db.prepare(
      "INSERT INTO deck_group_members VALUES('d1','u1','g1')",
    ).run();
    expect(featureVersion(sql, "d1", "groups")).toBe(2);
  });
});
