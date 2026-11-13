import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { HistorySQL } from "./historyStore";
import {
  groupSchema,
  groupList,
  groupCommand,
  effectiveGroupId,
  GroupError,
} from "./groups";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE decks(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT, email TEXT)",
  );
  db.exec(groupSchema);
  db.prepare("INSERT INTO decks VALUES(?)").run("deck");
  const sql: HistorySQL = (query, ...args) => db.prepare(query).all(...args);
  return { db, sql };
}
function fails(fn: () => unknown, status: number) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GroupError);
    expect((e as GroupError).status).toBe(status);
    return;
  }
  throw new Error("expected the command to fail");
}

describe("deck groups", () => {
  it("lets the host define the set once, then add and rename", () => {
    const { sql } = fixture();
    fails(
      () => groupCommand(sql, "deck", "ana", false, "create", undefined, { names: ["1班"] }),
      403,
    );
    groupCommand(sql, "deck", "host", true, "create", undefined, {
      names: ["1班", "2班"],
    });
    expect(groupList(sql, "deck", "host", true).groups.map((g) => g.name)).toEqual([
      "1班",
      "2班",
    ]);
    fails(
      () => groupCommand(sql, "deck", "host", true, "create", undefined, { names: ["3班"] }),
      409,
    );
    groupCommand(sql, "deck", "host", true, "add", undefined, { name: "3班" });
    const three = groupList(sql, "deck", "host", true).groups;
    expect(three).toHaveLength(3);
    groupCommand(sql, "deck", "host", true, "rename", three[2].id, {
      name: "ひまわり班",
    });
    expect(groupList(sql, "deck", "host", true).groups[2].name).toBe(
      "ひまわり班",
    );
    fails(
      () => groupCommand(sql, "deck", "host", true, "add", undefined, { name: "1班" }),
      400,
    );
  });

  it("tracks membership, counts members and supports switching and leaving", () => {
    const { sql } = fixture();
    groupCommand(sql, "deck", "host", true, "create", undefined, {
      names: ["1班", "2班"],
    });
    const [g1, g2] = groupList(sql, "deck", "host", true).groups;
    expect(groupList(sql, "deck", "ana", false).myGroupId).toBeUndefined();
    groupCommand(sql, "deck", "ana", false, "join", undefined, { groupId: g1.id });
    expect(groupList(sql, "deck", "ana", false).myGroupId).toBe(g1.id);
    expect(
      groupList(sql, "deck", "host", true).groups.find((g) => g.id === g1.id)!
        .memberCount,
    ).toBe(1);
    groupCommand(sql, "deck", "ana", false, "join", undefined, { groupId: g2.id });
    expect(effectiveGroupId(sql, "deck", "ana")).toBe(g2.id);
    groupCommand(sql, "deck", "ana", false, "leave", undefined, {});
    expect(effectiveGroupId(sql, "deck", "ana")).toBeUndefined();
    fails(
      () => groupCommand(sql, "deck", "host", true, "join", undefined, { groupId: g1.id }),
      400,
    );
  });

  it("treats everyone as a member when the deck has exactly one group", () => {
    const { sql } = fixture();
    groupCommand(sql, "deck", "host", true, "create", undefined, {
      names: ["全員"],
    });
    const only = groupList(sql, "deck", "host", true).groups[0];
    expect(effectiveGroupId(sql, "deck", "ana")).toBe(only.id);
    expect(groupList(sql, "deck", "ana", false).myGroupId).toBe(only.id);
  });
});
