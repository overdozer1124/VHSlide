import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { HistorySQL } from "./historyStore";
import {
  webbingSchema,
  webbingList,
  webbingCommand,
  WebbingError,
} from "./webbing";
import { groupSchema, groupList, groupCommand } from "./groups";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE decks(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT, email TEXT)",
  );
  db.exec(webbingSchema);
  db.exec(groupSchema);
  db.prepare("INSERT INTO decks VALUES(?)").run("deck");
  for (const [id, name] of [
    ["host", "先生"],
    ["ana", "あな"],
    ["bob", "ぼぶ"],
  ] as const)
    db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, name, `${id}@test`);
  const sql: HistorySQL = (query, ...args) => db.prepare(query).all(...args);
  return { db, sql };
}
function makeMap(sql: HistorySQL) {
  const created = webbingCommand(sql, "deck", "host", true, "create", undefined, {
    title: "将来の夢",
  });
  const mapId = created!.createdId!;
  webbingCommand(sql, "deck", "host", true, "status", mapId, {
    status: "open",
  });
  return mapId;
}
function fails(fn: () => unknown, status: number, message?: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(WebbingError);
    expect((e as WebbingError).status).toBe(status);
    if (message) expect((e as Error).message).toContain(message);
    return;
  }
  throw new Error("expected the command to fail");
}

describe("webbing maps", () => {
  it("creates a draft map with a central theme node, hidden from guests", () => {
    const { sql } = fixture();
    fails(
      () => webbingCommand(sql, "deck", "ana", false, "create", undefined, { title: "x" }),
      403,
    );
    const created = webbingCommand(sql, "deck", "host", true, "create", undefined, {
      title: "将来の夢",
    });
    const hostList = webbingList(sql, "deck", true);
    expect(hostList).toHaveLength(1);
    expect(hostList[0].id).toBe(created!.createdId);
    expect(hostList[0].status).toBe("draft");
    expect(hostList[0].nodes).toHaveLength(1);
    expect(hostList[0].nodes[0].parentId).toBeNull();
    expect(hostList[0].nodes[0].text).toBe("将来の夢");
    expect(hostList[0].nodes[0].authorName).toBe("先生");
    expect(webbingList(sql, "deck", false)).toHaveLength(0);
  });

  it("lets everyone add nodes once open, but only the author or host can edit", () => {
    const { sql } = fixture();
    const mapId = makeMap(sql);
    const root = webbingList(sql, "deck", true)[0].nodes[0];
    const added = webbingCommand(sql, "deck", "ana", false, "node-add", mapId, {
      parentId: root.id,
      text: "宇宙飛行士",
      x: 300,
      y: 200,
    });
    const view = webbingList(sql, "deck", false)[0];
    expect(view.nodes).toHaveLength(2);
    const node = view.nodes.find((n) => n.id === added!.createdId)!;
    expect(node.authorId).toBe("ana");
    expect(node.authorName).toBe("あな");
    // Another guest cannot edit or delete ana's node.
    fails(
      () =>
        webbingCommand(sql, "deck", "bob", false, "node-edit", mapId, {
          nodeId: node.id,
          text: "書き換え",
        }),
      403,
    );
    fails(
      () =>
        webbingCommand(sql, "deck", "bob", false, "node-delete", mapId, {
          nodeId: node.id,
        }),
      403,
    );
    // The author can edit; the host can edit too.
    webbingCommand(sql, "deck", "ana", false, "node-edit", mapId, {
      nodeId: node.id,
      text: "宇宙飛行士になる",
    });
    webbingCommand(sql, "deck", "host", true, "node-edit", mapId, {
      nodeId: node.id,
      x: 320,
    });
    const after = webbingList(sql, "deck", true)[0].nodes.find(
      (n) => n.id === node.id,
    )!;
    expect(after.text).toBe("宇宙飛行士になる");
    expect(after.x).toBe(320);
  });

  it("blocks writing while closed, except for the host", () => {
    const { sql } = fixture();
    const mapId = makeMap(sql);
    const root = webbingList(sql, "deck", true)[0].nodes[0];
    webbingCommand(sql, "deck", "host", true, "status", mapId, {
      status: "closed",
    });
    fails(
      () =>
        webbingCommand(sql, "deck", "ana", false, "node-add", mapId, {
          parentId: root.id,
          text: "遅刻",
          x: 1,
          y: 1,
        }),
      409,
    );
    const ok = webbingCommand(sql, "deck", "host", true, "node-add", mapId, {
      parentId: root.id,
      text: "ホストの追加",
      x: 1,
      y: 1,
    });
    expect(ok!.createdId).toBeTruthy();
  });

  it("locks a node against other editors until released or expired", () => {
    const { db, sql } = fixture();
    const mapId = makeMap(sql);
    const root = webbingList(sql, "deck", true)[0].nodes[0];
    const added = webbingCommand(sql, "deck", "ana", false, "node-add", mapId, {
      parentId: root.id,
      text: "項目",
      x: 100,
      y: 100,
    });
    const nodeId = added!.createdId!;
    webbingCommand(sql, "deck", "ana", false, "lock", mapId, { nodeId });
    // The host would normally be allowed to edit, but the lock blocks it.
    fails(
      () =>
        webbingCommand(sql, "deck", "host", true, "node-edit", mapId, {
          nodeId,
          text: "上書き",
        }),
      409,
      "編集中",
    );
    // Only the author or the host may take the edit lock at all.
    fails(
      () => webbingCommand(sql, "deck", "bob", false, "lock", mapId, { nodeId }),
      403,
    );
    // The lock holder can save, and the list shows the lock with her name.
    const locked = webbingList(sql, "deck", false)[0];
    expect(locked.locks).toEqual([
      expect.objectContaining({ nodeId, userId: "ana", name: "あな" }),
    ]);
    webbingCommand(sql, "deck", "ana", false, "node-edit", mapId, {
      nodeId,
      text: "項目（更新）",
    });
    webbingCommand(sql, "deck", "ana", false, "unlock", mapId, { nodeId });
    expect(webbingList(sql, "deck", false)[0].locks).toHaveLength(0);
    // An expired lock no longer blocks anyone.
    db.prepare("INSERT INTO webbing_locks VALUES(?,?,?,?,?)").run(
      mapId,
      nodeId,
      "bob",
      "ぼぶ",
      Date.now() - 1000,
    );
    webbingCommand(sql, "deck", "host", true, "node-edit", mapId, {
      nodeId,
      text: "期限切れ後は編集できる",
    });
    expect(
      webbingList(sql, "deck", true)[0].nodes.find((n) => n.id === nodeId)!.text,
    ).toBe("期限切れ後は編集できる");
  });

  it("deletes a whole branch with its node, and never the theme node", () => {
    const { sql } = fixture();
    const mapId = makeMap(sql);
    const root = webbingList(sql, "deck", true)[0].nodes[0];
    const a = webbingCommand(sql, "deck", "ana", false, "node-add", mapId, {
      parentId: root.id,
      text: "枝",
      x: 200,
      y: 200,
    })!;
    webbingCommand(sql, "deck", "bob", false, "node-add", mapId, {
      parentId: a.createdId,
      text: "小枝",
      x: 260,
      y: 240,
    });
    expect(webbingList(sql, "deck", true)[0].nodes).toHaveLength(3);
    fails(
      () =>
        webbingCommand(sql, "deck", "ana", false, "node-delete", mapId, {
          nodeId: root.id,
        }),
      400,
    );
    // The host deletes ana's branch; bob's child on it goes too.
    webbingCommand(sql, "deck", "host", true, "node-delete", mapId, {
      nodeId: a.createdId,
    });
    expect(webbingList(sql, "deck", true)[0].nodes).toHaveLength(1);
  });

  it("syncs the map title when the host edits the theme node", () => {
    const { sql } = fixture();
    const mapId = makeMap(sql);
    const root = webbingList(sql, "deck", true)[0].nodes[0];
    webbingCommand(sql, "deck", "host", true, "node-edit", mapId, {
      nodeId: root.id,
      text: "10年後の自分",
    });
    expect(webbingList(sql, "deck", true)[0].title).toBe("10年後の自分");
  });

  it("splits a grouped map by the deck's shared groups", () => {
    const { sql } = fixture();
    groupCommand(sql, "deck", "host", true, "create", undefined, {
      names: ["1班", "2班"],
    });
    const [g1, g2] = groupList(sql, "deck", "host", true).groups;
    const created = webbingCommand(sql, "deck", "host", true, "create", undefined, {
      title: "班で考えよう",
      grouped: true,
    });
    const mapId = created!.createdId!;
    webbingCommand(sql, "deck", "host", true, "status", mapId, {
      status: "open",
    });
    const view = webbingList(sql, "deck", true)[0];
    expect(view.grouped).toBe(true);
    // One theme root per group.
    const roots = view.nodes.filter((n) => n.parentId === null);
    expect(roots.map((r) => r.groupId).sort()).toEqual([g1.id, g2.id].sort());
    const root1 = roots.find((r) => r.groupId === g1.id)!;
    const root2 = roots.find((r) => r.groupId === g2.id)!;
    // Ana cannot write anywhere before joining a group.
    fails(
      () =>
        webbingCommand(sql, "deck", "ana", false, "node-add", mapId, {
          parentId: root1.id,
          text: "まだ",
          x: 100,
          y: 100,
        }),
      403,
    );
    groupCommand(sql, "deck", "ana", false, "join", undefined, {
      groupId: g1.id,
    });
    // She writes in her own group, never in the other group.
    const added = webbingCommand(sql, "deck", "ana", false, "node-add", mapId, {
      parentId: root1.id,
      text: "1班のアイデア",
      x: 200,
      y: 160,
    });
    expect(added!.createdId).toBeTruthy();
    fails(
      () =>
        webbingCommand(sql, "deck", "ana", false, "node-add", mapId, {
          parentId: root2.id,
          text: "よその班へ",
          x: 100,
          y: 100,
        }),
      403,
    );
    // Everyone still SEES all groups' nodes (view-only for other groups).
    const guestView = webbingList(sql, "deck", false)[0];
    expect(
      guestView.nodes.some((n) => n.text === "1班のアイデア"),
    ).toBe(true);
    // Editing the theme on one root renames it for every group.
    webbingCommand(sql, "deck", "host", true, "node-edit", mapId, {
      nodeId: root2.id,
      text: "みんなで考えよう",
    });
    const renamed = webbingList(sql, "deck", true)[0];
    expect(renamed.title).toBe("みんなで考えよう");
    expect(
      renamed.nodes
        .filter((n) => n.parentId === null)
        .every((n) => n.text === "みんなで考えよう"),
    ).toBe(true);
  });

  it("deletes the map with its nodes for the host only", () => {
    const { sql } = fixture();
    const mapId = makeMap(sql);
    fails(
      () => webbingCommand(sql, "deck", "ana", false, "delete", mapId, {}),
      403,
    );
    webbingCommand(sql, "deck", "host", true, "delete", mapId, {});
    expect(webbingList(sql, "deck", true)).toHaveLength(0);
  });
});
