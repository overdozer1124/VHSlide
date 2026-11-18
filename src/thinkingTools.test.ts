import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { HistorySQL } from "./historyStore";
import { groupSchema, groupCommand } from "./groups";
import {
  thinkingSchema,
  thinkingList,
  thinkingCommand,
  parseThinkingDefinition,
  templateKind,
  thinkingOwnerLabels,
  zoneAtPoint,
  ThinkingError,
} from "./thinkingTools";
import {
  parseThinkingBinding,
  parseThinkingBindingLenient,
} from "./thinkingBinding";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE decks(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT, email TEXT); CREATE TABLE members(deck TEXT, user_id TEXT)",
  );
  db.exec(groupSchema);
  db.exec(thinkingSchema);
  db.prepare("INSERT INTO decks VALUES(?)").run("deck");
  for (const [id, name] of [
    ["host", "先生"],
    ["ana", "あな"],
    ["bob", "ぼぶ"],
    ["eve", "いぶ"],
  ]) {
    db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, name, "");
    db.prepare("INSERT INTO members VALUES(?,?)").run("deck", id);
  }
  const sql: HistorySQL = (query, ...args) => db.prepare(query).all(...args);
  return { db, sql };
}
function fails(fn: () => unknown, status: number) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ThinkingError);
    expect((e as ThinkingError).status).toBe(status);
    return;
  }
  throw new Error("expected the command to fail");
}
const axisDef = {
  title: "賛成と自信",
  xMin: "反対",
  xMax: "賛成",
  yMin: "自信がない",
  yMax: "自信がある",
  scenes: [
    { id: "s1", label: "読む前" },
    { id: "s2", label: "話し合いの後" },
  ],
  reason: true,
};
function createTool(
  sql: HistorySQL,
  overrides: Record<string, unknown> = {},
): string {
  const created = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
    template: "axis2",
    unit: "individual",
    definition: axisDef,
    ...overrides,
  });
  return created!.createdId!;
}
function open(sql: HistorySQL, id: string) {
  thinkingCommand(sql, "deck", "host", true, "status", id, {
    status: "open",
  });
}

describe("thinking tool definitions", () => {
  it("validates definitions per template", () => {
    expect(parseThinkingDefinition("axis2", axisDef).definition.scenes).toHaveLength(2);
    expect(() =>
      parseThinkingDefinition("axis2", { ...axisDef, yMax: "" }),
    ).toThrow();
    expect(() =>
      parseThinkingDefinition("ratio", { title: "気持ち", nameA: "言いたい" }),
    ).toThrow();
    expect(
      parseThinkingDefinition("ratio", {
        title: "気持ち",
        nameA: "言いたい",
        nameB: "黙っていたい",
      }).definition.nameB,
    ).toBe("黙っていたい");
    expect(() =>
      parseThinkingDefinition("axis1", {
        title: "数直線",
        xMin: "0",
        xMax: "10",
        scenes: Array.from({ length: 11 }, (_, i) => ({
          id: `s${i}`,
          label: `場面${i}`,
        })),
      }),
    ).toThrow();
  });
});

describe("thinking points", () => {
  it("keeps individual points private and per scene", () => {
    const { sql } = fixture();
    const id = createTool(sql);
    fails(
      () =>
        thinkingCommand(sql, "deck", "ana", false, "point", id, {
          scene: "s1",
          value: { x: 0.5, y: 0.5 },
        }),
      409,
    );
    open(sql, id);
    thinkingCommand(sql, "deck", "ana", false, "point", id, {
      scene: "s1",
      value: { x: 0.2, y: 0.8 },
      reason: "なんとなく賛成",
    });
    const mine = thinkingList(sql, "deck", "ana", false);
    expect(mine[0].points).toHaveLength(1);
    expect(mine[0].points[0].value).toEqual({ x: 0.2, y: 0.8 });
    expect(mine[0].points[0].reason).toBe("なんとなく賛成");
    // Another student sees the tool but none of ana's points.
    const bobs = thinkingList(sql, "deck", "bob", false);
    expect(bobs[0].points).toHaveLength(0);
    // The host sees everything.
    expect(thinkingList(sql, "deck", "host", true)[0].points).toHaveLength(1);
    // Teacher scene mode: students write only into the current scene.
    fails(
      () =>
        thinkingCommand(sql, "deck", "ana", false, "point", id, {
          scene: "s2",
          value: { x: 0.1, y: 0.1 },
        }),
      409,
    );
    thinkingCommand(sql, "deck", "host", true, "scene", id, { scene: "s2" });
    thinkingCommand(sql, "deck", "ana", false, "point", id, {
      scene: "s2",
      value: { x: 0.9, y: 0.9 },
    });
    expect(thinkingList(sql, "deck", "ana", false)[0].points).toHaveLength(2);
    // Only the author (or host) clears an individual point.
    fails(
      () =>
        thinkingCommand(sql, "deck", "bob", false, "clear", id, {
          scene: "s1",
          owner: "ana",
        }),
      403,
    );
  });

  it("shares one point per group and locks concurrent edits", () => {
    const { sql } = fixture();
    groupCommand(sql, "deck", "host", true, "create", undefined, {
      names: ["1班", "2班"],
    });
    groupCommand(sql, "deck", "ana", false, "join", undefined, {
      groupId: thinkingGroups(sql)[0],
    });
    groupCommand(sql, "deck", "bob", false, "join", undefined, {
      groupId: thinkingGroups(sql)[0],
    });
    groupCommand(sql, "deck", "eve", false, "join", undefined, {
      groupId: thinkingGroups(sql)[1],
    });
    const id = createTool(sql, { unit: "group" });
    open(sql, id);
    thinkingCommand(sql, "deck", "ana", false, "point", id, {
      scene: "s1",
      value: { x: 0.3, y: 0.3 },
    });
    // Bob is in the same group: he sees the point, but ana holds the lock.
    const bobs = thinkingList(sql, "deck", "bob", false);
    expect(bobs[0].points).toHaveLength(1);
    expect(bobs[0].points[0].authorName).toBe("あな");
    fails(
      () =>
        thinkingCommand(sql, "deck", "bob", false, "point", id, {
          scene: "s1",
          value: { x: 0.4, y: 0.4 },
        }),
      409,
    );
    // Eve is in another group: no point, and writing is refused.
    expect(thinkingList(sql, "deck", "eve", false)[0].points).toHaveLength(0);
    fails(
      () =>
        thinkingCommand(sql, "deck", "eve", false, "point", id, {
          scene: "s1",
          value: { x: 0.4, y: 0.4 },
          owner: thinkingGroups(sql)[0],
        }),
      403,
    );
  });

  it("gives every student their own point in a class tool", () => {
    const { sql } = fixture();
    const id = createTool(sql, { unit: "class" });
    open(sql, id);
    thinkingCommand(sql, "deck", "ana", false, "point", id, {
      scene: "s1",
      value: { x: 0.6, y: 0.2 },
    });
    // Bob places his own point: no shared point, no lock conflict.
    thinkingCommand(sql, "deck", "bob", false, "point", id, {
      scene: "s1",
      value: { x: 0.1, y: 0.9 },
    });
    // Each participant receives only their own point, keyed by themself,
    // with no author identity and no locks attached.
    const bobs = thinkingList(sql, "deck", "bob", false);
    expect(bobs[0].points).toHaveLength(1);
    expect(bobs[0].points[0].owner).toBe("bob");
    expect(bobs[0].points[0].value).toEqual({ x: 0.1, y: 0.9 });
    expect(bobs[0].points[0].authorId).toBe("");
    expect(bobs[0].points[0].authorName).toBe("");
    expect(bobs[0].locks).toHaveLength(0);
    const anas = thinkingList(sql, "deck", "ana", false);
    expect(anas[0].points).toHaveLength(1);
    expect(anas[0].points[0].owner).toBe("ana");
    // The host sees everyone's points, with names, for the distribution.
    const hosts = thinkingList(sql, "deck", "host", true);
    expect(hosts[0].points).toHaveLength(2);
    expect(
      hosts[0].points.map((p) => p.authorName).sort(),
    ).toEqual(["あな", "ぼぶ"]);
    // Nobody can write or clear another student's point.
    fails(
      () =>
        thinkingCommand(sql, "deck", "bob", false, "point", id, {
          scene: "s1",
          value: { x: 0.5, y: 0.5 },
          owner: "ana",
        }),
      403,
    );
    fails(
      () =>
        thinkingCommand(sql, "deck", "bob", false, "clear", id, {
          scene: "s1",
          owner: "ana",
        }),
      403,
    );
  });

  it("guards host operations and edits after answers exist", () => {
    const { sql } = fixture();
    const id = createTool(sql);
    fails(
      () =>
        thinkingCommand(sql, "deck", "ana", false, "status", id, {
          status: "open",
        }),
      403,
    );
    fails(
      () => thinkingCommand(sql, "deck", "ana", false, "delete", id, {}),
      403,
    );
    open(sql, id);
    thinkingCommand(sql, "deck", "ana", false, "point", id, {
      scene: "s1",
      value: { x: 0.5, y: 0.5 },
    });
    fails(
      () =>
        thinkingCommand(sql, "deck", "host", true, "edit", id, {
          unit: "class",
          definition: axisDef,
        }),
      409,
    );
    fails(
      () =>
        thinkingCommand(sql, "deck", "host", true, "edit", id, {
          definition: { ...axisDef, scenes: [{ id: "s2", label: "後" }] },
        }),
      409,
    );
    thinkingCommand(sql, "deck", "host", true, "delete", id, {});
    expect(thinkingList(sql, "deck", "host", true)).toHaveLength(0);
  });
});

describe("thinking board definitions", () => {
  it("fills board zones from the template and validates them", () => {
    const { definition } = parseThinkingDefinition("venn2", {
      title: "ベン図",
    });
    expect(definition.zones.map((z) => z.id)).toEqual(["a", "b", "ab"]);
    expect(definition.scenes).toEqual([]);
    const custom = parseThinkingDefinition("tchart", {
      title: "Tチャート",
      zones: [
        { id: "a", label: "分かった" },
        { id: "b", label: "疑問" },
      ],
      cardColors: [{ color: "yellow", label: "自分の考え" }],
    });
    expect(custom.definition.zones[1].label).toBe("疑問");
    expect(custom.definition.cardColors).toHaveLength(1);
    expect(() =>
      parseThinkingDefinition("tchart", {
        title: "Tチャート",
        zones: [{ id: "x", label: "?" }],
      }),
    ).toThrow();
    expect(() =>
      parseThinkingDefinition("kwl", {
        title: "KWL",
        cardColors: [
          { color: "yellow", label: "a" },
          { color: "yellow", label: "b" },
        ],
      }),
    ).toThrow();
    expect(templateKind("venn3")).toBe("board");
    expect(templateKind("axis2")).toBe("point");
  });

  it("hit-tests zones, including the Venn overlaps", () => {
    expect(zoneAtPoint("venn2", 0.5, 0.5)).toBe("ab");
    expect(zoneAtPoint("venn2", 0.15, 0.5)).toBe("a");
    expect(zoneAtPoint("venn2", 0.85, 0.5)).toBe("b");
    expect(zoneAtPoint("venn2", 0.05, 0.05)).toBeNull();
    expect(zoneAtPoint("venn3", 0.5, 0.55)).toBe("abc");
    expect(zoneAtPoint("tchart", 0.25, 0.5)).toBe("a");
    expect(zoneAtPoint("tchart", 0.75, 0.5)).toBe("b");
    expect(zoneAtPoint("ychart", 0.5, 0.8)).toBe("c");
    expect(zoneAtPoint("axis2", 0.5, 0.5)).toBeNull();
  });

  it("hit-tests the X chart by its diagonals, not by quadrants", () => {
    // The four triangles: top / right / bottom / left.
    expect(zoneAtPoint("xchart", 0.5, 0.1)).toBe("a");
    expect(zoneAtPoint("xchart", 0.9, 0.5)).toBe("b");
    expect(zoneAtPoint("xchart", 0.5, 0.9)).toBe("c");
    expect(zoneAtPoint("xchart", 0.1, 0.5)).toBe("d");
    // Near a corner the diagonals decide: the top-right corner
    // belongs to the top or right triangle, never to a quadrant.
    expect(zoneAtPoint("xchart", 0.9, 0.05)).toBe("a");
    expect(zoneAtPoint("xchart", 0.95, 0.4)).toBe("b");
    // The centre circle holds the topic: no card zone there.
    expect(zoneAtPoint("xchart", 0.5, 0.5)).toBeNull();
    expect(zoneAtPoint("xchart", 0.55, 0.45)).toBeNull();
    // The matrix keeps its plain quadrants.
    expect(zoneAtPoint("matrix", 0.9, 0.05)).toBe("b");
    expect(zoneAtPoint("matrix", 0.75, 0.75)).toBe("d");
  });

  it("renames an X chart's untouched quadrant labels to the wedge names", () => {
    const old = parseThinkingDefinition("xchart", {
      title: "観察",
      zones: [
        { id: "a", label: "左上" },
        { id: "b", label: "右上" },
        { id: "c", label: "左下" },
        { id: "d", label: "右下" },
      ],
    });
    expect(old.definition.zones.map((z) => z.label)).toEqual([
      "見た目",
      "音",
      "感じ",
      "におい",
    ]);
    // Any customised label keeps the teacher's whole set as-is.
    const custom = parseThinkingDefinition("xchart", {
      title: "観察",
      zones: [
        { id: "a", label: "色" },
        { id: "b", label: "右上" },
        { id: "c", label: "左下" },
        { id: "d", label: "右下" },
      ],
    });
    expect(custom.definition.zones.map((z) => z.label)).toEqual([
      "色",
      "右上",
      "左下",
      "右下",
    ]);
    // Other templates are never renamed.
    const matrix = parseThinkingDefinition("matrix", {
      title: "整理",
      zones: [
        { id: "a", label: "左上" },
        { id: "b", label: "右上" },
        { id: "c", label: "左下" },
        { id: "d", label: "右下" },
      ],
    });
    expect(matrix.definition.zones.map((z) => z.label)).toEqual([
      "左上",
      "右上",
      "左下",
      "右下",
    ]);
  });
});

const vennDef = {
  title: "ベン図",
  cardColors: [{ color: "yellow", label: "自分の考え" }],
};
function createBoard(
  sql: HistorySQL,
  overrides: Record<string, unknown> = {},
): string {
  const created = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
    template: "venn2",
    unit: "class",
    definition: vennDef,
    ...overrides,
  });
  return created!.createdId!;
}

describe("thinking board cards", () => {
  it("shares one class board: anyone moves, only the author edits", () => {
    const { sql } = fixture();
    const id = createBoard(sql);
    // Old clients (no board capability) never receive board tools.
    open(sql, id);
    expect(thinkingList(sql, "deck", "ana", false)).toHaveLength(0);
    expect(
      thinkingList(sql, "deck", "ana", false, { board: true }),
    ).toHaveLength(1);
    const card = thinkingCommand(sql, "deck", "ana", false, "card", id, {
      zone: "a",
      text: "Aだけの考え",
      color: "yellow",
    })!;
    const cardId = card.createdId!;
    // Bob sees the shared card without ana's identity, marked not his.
    const bobs = thinkingList(sql, "deck", "bob", false, { board: true });
    expect(bobs[0].kind).toBe("board");
    expect(bobs[0].cards).toHaveLength(1);
    expect(bobs[0].cards[0].authorId).toBe("");
    expect(bobs[0].cards[0].authorName).toBe("");
    expect(bobs[0].cards[0].mine).toBe(false);
    // Bob may move it to the overlap, but may not rewrite or delete it.
    thinkingCommand(sql, "deck", "bob", false, "cardmove", id, {
      cardId,
      zone: "ab",
    });
    fails(
      () =>
        thinkingCommand(sql, "deck", "bob", false, "cardedit", id, {
          cardId,
          text: "書き換え",
        }),
      403,
    );
    fails(
      () =>
        thinkingCommand(sql, "deck", "bob", false, "carddelete", id, {
          cardId,
        }),
      403,
    );
    // Ana edits her own card; the host sees names and can delete it.
    thinkingCommand(sql, "deck", "ana", false, "cardedit", id, {
      cardId,
      text: "直した考え",
    });
    const hosts = thinkingList(sql, "deck", "host", true, { board: true });
    expect(hosts[0].cards[0].text).toBe("直した考え");
    expect(hosts[0].cards[0].zone).toBe("ab");
    expect(hosts[0].cards[0].authorName).toBe("あな");
    thinkingCommand(sql, "deck", "host", true, "carddelete", id, { cardId });
    expect(
      thinkingList(sql, "deck", "host", true, { board: true })[0].cards,
    ).toHaveLength(0);
  });

  it("restricts card locks to the author and hides lock identity", () => {
    const { sql } = fixture();
    const id = createBoard(sql);
    open(sql, id);
    const card = thinkingCommand(sql, "deck", "ana", false, "card", id, {
      zone: "a",
      text: "Aだけの考え",
    })!;
    const cardId = card.createdId!;
    // Bob cannot take the lock on ana's card; ana can.
    fails(
      () =>
        thinkingCommand(sql, "deck", "bob", false, "lock", id, { cardId }),
      403,
    );
    thinkingCommand(sql, "deck", "ana", false, "lock", id, { cardId });
    // On a class board, other students get the lock without its
    // identity — only the mine flag (the lock names the author).
    const bobs = thinkingList(sql, "deck", "bob", false, { board: true });
    expect(bobs[0].locks).toHaveLength(1);
    expect(bobs[0].locks[0].userId).toBe("");
    expect(bobs[0].locks[0].name).toBe("");
    expect(bobs[0].locks[0].mine).toBe(false);
    const anas = thinkingList(sql, "deck", "ana", false, { board: true });
    expect(anas[0].locks[0].mine).toBe(true);
    // The host sees whose lock it is. While ana's lock is active,
    // even the host cannot take it over (the lock is mutual).
    const hosts = thinkingList(sql, "deck", "host", true, { board: true });
    expect(hosts[0].locks[0].userId).toBe("ana");
    expect(hosts[0].locks[0].name).toBe("あな");
    fails(
      () => thinkingCommand(sql, "deck", "host", true, "lock", id, { cardId }),
      409,
    );
  });

  it("keeps group boards inside the group and validates cards", () => {
    const { sql } = fixture();
    groupCommand(sql, "deck", "host", true, "create", undefined, {
      names: ["1班", "2班"],
    });
    groupCommand(sql, "deck", "ana", false, "join", undefined, {
      groupId: thinkingGroups(sql)[0],
    });
    groupCommand(sql, "deck", "bob", false, "join", undefined, {
      groupId: thinkingGroups(sql)[0],
    });
    groupCommand(sql, "deck", "eve", false, "join", undefined, {
      groupId: thinkingGroups(sql)[1],
    });
    const id = createBoard(sql, { unit: "group" });
    open(sql, id);
    const card = thinkingCommand(sql, "deck", "ana", false, "card", id, {
      zone: "b",
      text: "班のカード",
    })!;
    const cardId = card.createdId!;
    // Same group: bob sees it with ana's name and can move it, not edit.
    const bobs = thinkingList(sql, "deck", "bob", false, { board: true });
    expect(bobs[0].cards).toHaveLength(1);
    expect(bobs[0].cards[0].authorName).toBe("あな");
    thinkingCommand(sql, "deck", "bob", false, "cardmove", id, {
      cardId,
      zone: "a",
    });
    fails(
      () =>
        thinkingCommand(sql, "deck", "bob", false, "cardedit", id, {
          cardId,
          text: "だめ",
        }),
      403,
    );
    // Another group: nothing is returned and every write is refused.
    expect(
      thinkingList(sql, "deck", "eve", false, { board: true })[0].cards,
    ).toHaveLength(0);
    fails(
      () =>
        thinkingCommand(sql, "deck", "eve", false, "cardmove", id, {
          cardId,
          zone: "a",
        }),
      403,
    );
    fails(
      () =>
        thinkingCommand(sql, "deck", "eve", false, "carddelete", id, {
          cardId,
        }),
      403,
    );
    // Validation: bad zone, over-long text, unknown colour.
    fails(
      () =>
        thinkingCommand(sql, "deck", "ana", false, "card", id, {
          zone: "zz",
          text: "x",
        }),
      400,
    );
    fails(
      () =>
        thinkingCommand(sql, "deck", "ana", false, "card", id, {
          zone: "a",
          text: "あ".repeat(81),
        }),
      400,
    );
    fails(
      () =>
        thinkingCommand(sql, "deck", "ana", false, "card", id, {
          zone: "a",
          text: "x",
          color: "purple",
        }),
      400,
    );
  });

  it("keeps individual boards private", () => {
    const { sql } = fixture();
    const id = createBoard(sql, { unit: "individual" });
    open(sql, id);
    thinkingCommand(sql, "deck", "ana", false, "card", id, {
      zone: "a",
      text: "個人のカード",
    });
    expect(
      thinkingList(sql, "deck", "ana", false, { board: true })[0].cards,
    ).toHaveLength(1);
    expect(
      thinkingList(sql, "deck", "bob", false, { board: true })[0].cards,
    ).toHaveLength(0);
    expect(
      thinkingList(sql, "deck", "host", true, { board: true })[0].cards,
    ).toHaveLength(1);
  });
});

describe("thinking binding forward compatibility", () => {
  it("keeps an unknown template as a quiet preview when opening a deck", () => {
    const binding = {
      deckId: "123e4567-e89b-42d3-a456-426614174000",
      toolId: "123e4567-e89b-42d3-a456-426614174001",
      title: "ベン図",
      template: "venn",
      unit: "individual",
      definition: { title: "ベン図" },
    };
    // The strict parser (form adoption) still rejects what it cannot
    // validate; the lenient one (opening a deck) must not.
    expect(() => parseThinkingBinding(binding)).toThrow();
    const lenient = parseThinkingBindingLenient(binding);
    expect(lenient.template).toBe("venn");
    expect(lenient.title).toBe("ベン図");
    expect(lenient.definition.scenes).toEqual([]);
    // Identity problems stay fatal even for the lenient parser.
    expect(() =>
      parseThinkingBindingLenient({ ...binding, toolId: "x" }),
    ).toThrow();
  });
});

describe("thinking owner labels", () => {
  const names = (owner: string) =>
    ({ "user-a": "あおい", "user-b": "そら" })[owner];

  it("numbers owners in id order, not in the order they arrived", () => {
    // The server returns points/cards in last-updated order, so the
    // arrival order shuffles whenever a student edits. The labels
    // must come out identical for every arrival order.
    const expected = [
      { owner: "user-a", label: "生徒1" },
      { owner: "user-b", label: "生徒2" },
    ];
    expect(thinkingOwnerLabels(["user-a", "user-b"], names, false)).toEqual(
      expected,
    );
    expect(thinkingOwnerLabels(["user-b", "user-a"], names, false)).toEqual(
      expected,
    );
    expect(
      thinkingOwnerLabels(["user-b", "user-a", "user-b"], names, false),
    ).toEqual(expected);
  });

  it("shows names only when asked, with a fallback for missing names", () => {
    expect(thinkingOwnerLabels(["user-b", "user-a"], names, true)).toEqual([
      { owner: "user-a", label: "あおい" },
      { owner: "user-b", label: "そら" },
    ]);
    expect(thinkingOwnerLabels(["user-c"], names, true)).toEqual([
      { owner: "user-c", label: "名前未登録" },
    ]);
  });

  it("keeps roster numbers fixed when a student answers midway (stage-4 🟡3)", () => {
    const roster = ["user-a", "user-b", "user-c"];
    // Only user-c has answered so far: they are still 生徒3.
    expect(thinkingOwnerLabels(["user-c"], names, false, roster)).toEqual([
      { owner: "user-c", label: "生徒3" },
    ]);
    // When user-a joins in, nobody's number moves.
    expect(
      thinkingOwnerLabels(["user-c", "user-a"], names, false, roster),
    ).toEqual([
      { owner: "user-a", label: "生徒1" },
      { owner: "user-c", label: "生徒3" },
    ]);
    // An owner who left the roster is numbered after it.
    expect(
      thinkingOwnerLabels(["user-x", "user-b"], names, false, roster),
    ).toEqual([
      { owner: "user-b", label: "生徒2" },
      { owner: "user-x", label: "生徒4" },
    ]);
    // The host's list carries the roster; a student's never does.
    const { sql } = fixture();
    const createdTool = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "emotion",
      unit: "individual",
      definition: { title: "気持ち", xMin: "いや", xMax: "よい" },
    });
    thinkingCommand(sql, "deck", "host", true, "status", createdTool!.createdId, {
      status: "open",
    });
    const hostView = thinkingList(sql, "deck", "host", true);
    expect(hostView.length).toBeGreaterThan(0);
    expect(hostView[0].roster).toEqual(["ana", "bob", "eve"]);
    const studentView = thinkingList(sql, "deck", "ana", false);
    expect(studentView[0].roster).toBeUndefined();
  });
});

function thinkingGroups(sql: HistorySQL): string[] {
  return [...sql("SELECT id FROM deck_groups ORDER BY sort,id")].map(
    (r) => r.id as string,
  );
}
