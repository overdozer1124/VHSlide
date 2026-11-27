import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { HistorySQL } from "./historyStore";
import { groupSchema, groupCommand } from "./groups";
import {
  thinkingSchema,
  thinkingList,
  thinkingCommand,
  thinkingShareView,
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

  it("numbers by join order, so a midway joiner never shifts others (stage-4 🔴)", () => {
    const { db, sql } = fixture();
    const tool = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "emotion",
      unit: "individual",
      definition: { title: "気持ち", xMin: "いや", xMax: "よい" },
    });
    thinkingCommand(sql, "deck", "host", true, "status", tool!.createdId, {
      status: "open",
    });
    const before = thinkingList(sql, "deck", "host", true)[0].roster;
    expect(before).toEqual(["ana", "bob", "eve"]);
    expect(
      thinkingOwnerLabels(["eve"], names, false, before).map((l) => l.label),
    ).toEqual(["生徒3"]);
    // A student whose id sorts before everyone's joins midway.
    db.prepare("INSERT INTO users VALUES(?,?,?)").run("aaron", "あろん", "");
    db.prepare("INSERT INTO members VALUES(?,?)").run("deck", "aaron");
    const after = thinkingList(sql, "deck", "host", true)[0].roster;
    // Join order: the newcomer takes the next number at the end and
    // nobody already there moves.
    expect(after).toEqual(["ana", "bob", "eve", "aaron"]);
    expect(
      thinkingOwnerLabels(["eve", "aaron"], names, false, after),
    ).toEqual([
      { owner: "eve", label: "生徒3" },
      { owner: "aaron", label: "生徒4" },
    ]);
  });
});

function thinkingGroups(sql: HistorySQL): string[] {
  return [...sql("SELECT id FROM deck_groups ORDER BY sort,id")].map(
    (r) => r.id as string,
  );
}

describe("thinking share view (stage 4c)", () => {
  it("labels by roster number, names only on request, and strips every id", () => {
    const { sql } = fixture();
    const id = createBoard(sql, { unit: "individual" });
    open(sql, id);
    thinkingCommand(sql, "deck", "ana", false, "card", id, {
      zone: "a",
      text: "あなの考え",
      color: "yellow",
    });
    thinkingCommand(sql, "deck", "bob", false, "card", id, {
      zone: "b",
      text: "ぼぶの考え",
      color: "yellow",
    });
    const anon = thinkingShareView(sql, "deck", id, "ana", false, "host");
    expect(anon?.label).toBe("生徒1");
    expect(anon?.cards).toHaveLength(1);
    expect(anon?.cards[0].text).toBe("あなの考え");
    // Nothing a student could identify anyone with: no ids, no
    // owner, no author anywhere in the payload.
    const raw = JSON.stringify(anon);
    expect(raw).not.toContain("ana");
    expect(raw).not.toContain("author");
    expect(Object.keys(anon!.cards[0]).sort()).toEqual([
      "color",
      "created",
      "sort",
      "text",
      "zone",
    ]);
    const named = thinkingShareView(sql, "deck", id, "ana", true, "host");
    expect(named?.label).toBe("あな");
    const second = thinkingShareView(sql, "deck", id, "bob", false, "host");
    expect(second?.label).toBe("生徒2");
    // D3: the view reports whether names are shown and whether
    // the requesting viewer owns the chart — a boolean only, so
    // an anonymous share still identifies no one to anyone else.
    expect(anon?.showNames).toBe(false);
    expect(anon?.mine).toBe(false);
    const ownAnon = thinkingShareView(
      sql, "deck", id, "ana", false, "host", undefined, "ana",
    );
    expect(ownAnon?.mine).toBe(true);
    expect(ownAnon?.showNames).toBe(false);
    const ownNamed = thinkingShareView(
      sql, "deck", id, "ana", true, "host", undefined, "ana",
    );
    expect(ownNamed?.mine).toBe(true);
    expect(ownNamed?.showNames).toBe(true);
    const others = thinkingShareView(
      sql, "deck", id, "ana", true, "host", undefined, "bob",
    );
    expect(others?.mine).toBe(false);
  });
  it("marks a group chart as the viewer's own only for its members", () => {
    const { sql } = fixture();
    const id = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "webbing",
      unit: "group",
      definition: { title: "海の生き物" },
    })!.createdId!;
    open(sql, id);
    groupCommand(sql, "deck", "host", true, "create", undefined, {
      names: ["1班", "2班"],
    });
    const g1 = [...sql("SELECT id FROM deck_groups ORDER BY rowid")][0]
      .id as string;
    const g2 = [...sql("SELECT id FROM deck_groups ORDER BY rowid")][1]
      .id as string;
    groupCommand(sql, "deck", "ana", false, "join", undefined, { groupId: g1 });
    groupCommand(sql, "deck", "eve", false, "join", undefined, { groupId: g2 });
    thinkingCommand(sql, "deck", "ana", false, "node", id, {
      text: "親",
      owner: g1,
    });
    const member = thinkingShareView(
      sql, "deck", id, g1, false, "host", { flow: true }, "ana",
    );
    expect(member?.mine).toBe(true);
    expect(member?.label).toBe("1班");
    const outsider = thinkingShareView(
      sql, "deck", id, g1, false, "host", { flow: true }, "eve",
    );
    expect(outsider?.mine).toBe(false);
  });
  it("labels a class board 全員 and refuses point tools", () => {
    const { sql } = fixture();
    const id = createBoard(sql);
    open(sql, id);
    expect(thinkingShareView(sql, "deck", id, "", false, "host")?.label).toBe(
      "全員",
    );
    const points = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "axis2",
      unit: "individual",
      definition: axisDef,
    });
    expect(
      thinkingShareView(sql, "deck", points!.createdId!, "ana", false, "host"),
    ).toBeUndefined();
    expect(
      thinkingShareView(sql, "deck", "missing", "ana", false, "host"),
    ).toBeUndefined();
  });
  it("names the owner even when the teacher wrote on the chart first (🔴1)", () => {
    const { sql } = fixture();
    const id = createBoard(sql, { unit: "individual" });
    open(sql, id);
    // The teacher writes on ana's chart BEFORE ana writes anything.
    thinkingCommand(sql, "deck", "host", true, "card", id, {
      zone: "a",
      text: "先生の書き込み",
      color: "yellow",
      owner: "ana",
    });
    thinkingCommand(sql, "deck", "ana", false, "card", id, {
      zone: "a",
      text: "あなの考え",
      color: "yellow",
    });
    const named = thinkingShareView(sql, "deck", id, "ana", true, "host");
    expect(named?.label).toBe("あな");
    expect(named?.cards).toHaveLength(2);
    const anon = thinkingShareView(sql, "deck", id, "ana", false, "host");
    expect(anon?.label).toBe("生徒1");
    // The host view resolves owner names from the owners themselves.
    const hostView = thinkingList(sql, "deck", "host", true, {
      board: true,
    })[0];
    expect(hostView.ownerNames?.ana).toBe("あな");
    expect(hostView.ownerNames?.host).toBe("先生");
    // Students never receive the name map.
    const studentView = thinkingList(sql, "deck", "ana", false, {
      board: true,
    })[0];
    expect(studentView.ownerNames).toBeUndefined();
  });
  it("numbers students from the deck owner's roster even for a co-teacher (🟡1)", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE decks(id TEXT PRIMARY KEY, owner TEXT); CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT, email TEXT); CREATE TABLE members(deck TEXT, user_id TEXT)",
    );
    db.exec(groupSchema);
    db.exec(thinkingSchema);
    db.prepare("INSERT INTO decks VALUES(?,?)").run("deck", "host");
    for (const [id, name] of [
      ["host", "先生"],
      ["co", "共同の先生"],
      ["ana", "あな"],
      ["bob", "ぼぶ"],
    ])
      db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, name, "");
    // The co-teacher is not a member row (they join through sharing),
    // which is exactly the case that used to shift the numbers: the
    // old gallery roster dropped the VIEWER (absent here, so the
    // deck owner stayed in and pushed every student down by one).
    for (const id of ["host", "ana", "bob"])
      db.prepare("INSERT INTO members VALUES(?,?)").run("deck", id);
    const sql: HistorySQL = (query, ...args) =>
      db.prepare(query).all(...args);
    const id = createBoard(sql, { unit: "individual" });
    open(sql, id);
    thinkingCommand(sql, "deck", "ana", false, "card", id, {
      zone: "a",
      text: "あなの考え",
      color: "yellow",
    });
    // A co-teacher's host view: the roster drops the deck owner,
    // not the viewer, so ana is 生徒1 — the same number the class
    // share (keyed on the deck owner) produces.
    const coView = thinkingList(sql, "deck", "co", true, {
      board: true,
    })[0];
    expect(coView.roster).toEqual(["ana", "bob"]);
    expect(
      thinkingOwnerLabels(["ana"], () => undefined, false, coView.roster),
    ).toEqual([{ owner: "ana", label: "生徒1" }]);
    const shared = thinkingShareView(sql, "deck", id, "ana", false, "host");
    expect(shared?.label).toBe("生徒1");
  });
});

describe("thinking curve (stage 4)", () => {
  const curveDef = {
    title: "主人公の気持ち",
    yMin: "気持ちが下がる",
    yMax: "気持ちが上がる",
    scenes: [
      { id: "s1", label: "場面1" },
      { id: "s2", label: "場面2" },
      { id: "s3", label: "場面3" },
    ],
    lines: [
      { id: "l1", label: "主人公" },
      { id: "l2", label: "友だち" },
    ],
  };
  function createCurve(
    sql: HistorySQL,
    overrides: Record<string, unknown> = {},
  ): string {
    const created = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "curve",
      unit: "individual",
      definition: { ...curveDef, ...overrides },
    });
    return created!.createdId!;
  }
  it("parses the definition: scenes and lines, free scenes, notes always on", () => {
    const { sql } = fixture();
    const id = createCurve(sql);
    const view = thinkingList(sql, "deck", "host", true)[0];
    expect(view.template).toBe("curve");
    expect(view.kind).toBe("point");
    expect(view.definition.lines.map((l) => l.label)).toEqual([
      "主人公",
      "友だち",
    ]);
    expect(view.definition.sceneMode).toBe("free");
    expect(view.definition.reason).toBe(true);
    expect(view.definition.yMax).toBe("気持ちが上がる");
    expect(id).toBeTruthy();
  });
  it("rejects missing scenes, no lines and more than three lines", () => {
    const { sql } = fixture();
    fails(() => createCurve(sql, { scenes: [] }), 400);
    fails(() => createCurve(sql, { lines: [] }), 400);
    fails(
      () =>
        createCurve(sql, {
          lines: [
            { id: "a", label: "a" },
            { id: "b", label: "b" },
            { id: "c", label: "c" },
            { id: "d", label: "d" },
          ],
        }),
      400,
    );
  });
  it("stores one point per scene and line under the composed key", () => {
    const { sql } = fixture();
    const id = createCurve(sql);
    open(sql, id);
    thinkingCommand(sql, "deck", "ana", false, "point", id, {
      scene: "s1:l1",
      value: { v: 0.8 },
      reason: "うれしい",
    });
    thinkingCommand(sql, "deck", "ana", false, "point", id, {
      scene: "s2:l1",
      value: { v: 0.3 },
    });
    thinkingCommand(sql, "deck", "ana", false, "point", id, {
      scene: "s1:l2",
      value: { v: 0.5 },
    });
    const mine = thinkingList(sql, "deck", "ana", false)[0];
    expect(mine.points).toHaveLength(3);
    const first = mine.points.find((p) => p.scene === "s1:l1");
    expect(first?.value.v).toBe(0.8);
    expect(first?.reason).toBe("うれしい");
    // Keys outside the definition's scenes × lines are refused.
    fails(
      () =>
        thinkingCommand(sql, "deck", "ana", false, "point", id, {
          scene: "s9:l1",
          value: { v: 0.5 },
        }),
      400,
    );
    fails(
      () =>
        thinkingCommand(sql, "deck", "ana", false, "point", id, {
          scene: "s1",
          value: { v: 0.5 },
        }),
      400,
    );
    // Clearing works per composed key.
    thinkingCommand(sql, "deck", "ana", false, "clear", id, {
      scene: "s1:l2",
    });
    expect(thinkingList(sql, "deck", "ana", false)[0].points).toHaveLength(2);
  });
});

describe("thinking curve review fixes", () => {
  it("rejects scene and line ids containing the key separator", () => {
    const { sql } = fixture();
    fails(
      () =>
        thinkingCommand(sql, "deck", "host", true, "create", undefined, {
          template: "curve",
          unit: "individual",
          definition: {
            title: "曲線",
            yMin: "下",
            yMax: "上",
            scenes: [{ id: "s:1", label: "場面1" }],
            lines: [{ id: "l1", label: "主人公" }],
          },
        }),
      400,
    );
    fails(
      () =>
        thinkingCommand(sql, "deck", "host", true, "create", undefined, {
          template: "curve",
          unit: "individual",
          definition: {
            title: "曲線",
            yMin: "下",
            yMax: "上",
            scenes: [{ id: "s1", label: "場面1" }],
            lines: [{ id: "l:1", label: "主人公" }],
          },
        }),
      400,
    );
  });
  it("lets two group members lock different curve keys at once", () => {
    const { sql } = fixture();
    groupCommand(sql, "deck", "host", true, "create", undefined, {
      names: ["1班"],
    });
    const gid = thinkingGroups(sql)[0];
    groupCommand(sql, "deck", "ana", false, "join", undefined, {
      groupId: gid,
    });
    groupCommand(sql, "deck", "bob", false, "join", undefined, {
      groupId: gid,
    });
    const created = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "curve",
      unit: "group",
      definition: {
        title: "班の曲線",
        yMin: "下",
        yMax: "上",
        scenes: [
          { id: "s1", label: "場面1" },
          { id: "s2", label: "場面2" },
        ],
        lines: [
          { id: "l1", label: "主人公" },
          { id: "l2", label: "友だち" },
        ],
      },
    });
    const id = created!.createdId!;
    open(sql, id);
    // Different scene, different line: both locks stand.
    thinkingCommand(sql, "deck", "ana", false, "lock", id, {
      scene: "s1:l1",
      owner: gid,
    });
    thinkingCommand(sql, "deck", "bob", false, "lock", id, {
      scene: "s2:l1",
      owner: gid,
    });
    thinkingCommand(sql, "deck", "bob", false, "lock", id, {
      scene: "s1:l2",
      owner: gid,
    });
    const view = thinkingList(sql, "deck", "ana", false).find(
      (t) => t.id === id,
    )!;
    expect(view.locks.map((l) => l.scene).sort()).toEqual([
      "s1:l1",
      "s1:l2",
      "s2:l1",
    ]);
    // The same key is held: bob's point there is refused while ana
    // holds the lock.
    fails(
      () =>
        thinkingCommand(sql, "deck", "bob", false, "point", id, {
          scene: "s1:l1",
          value: { v: 0.5 },
          owner: gid,
        }),
      409,
    );
  });
});

describe("thinking curve id length cap", () => {
  it("rejects scene and line ids longer than 64 characters", () => {
    const { sql } = fixture();
    const long = "a".repeat(65);
    const base = {
      title: "曲線",
      yMin: "下",
      yMax: "上",
      scenes: [{ id: "s1", label: "場面1" }],
      lines: [{ id: "l1", label: "主人公" }],
    };
    fails(
      () =>
        thinkingCommand(sql, "deck", "host", true, "create", undefined, {
          template: "curve",
          unit: "individual",
          definition: {
            ...base,
            scenes: [{ id: long, label: "場面1" }],
          },
        }),
      400,
    );
    fails(
      () =>
        thinkingCommand(sql, "deck", "host", true, "create", undefined, {
          template: "curve",
          unit: "individual",
          definition: { ...base, lines: [{ id: long, label: "主人公" }] },
        }),
      400,
    );
    // Exactly 64 is fine.
    const ok64 = "a".repeat(64);
    expect(
      thinkingCommand(sql, "deck", "host", true, "create", undefined, {
        template: "curve",
        unit: "individual",
        definition: {
          ...base,
          scenes: [{ id: ok64, label: "場面1" }],
        },
      })!.createdId,
    ).toBeTruthy();
  });
});

describe("thinking step chart (stage 4)", () => {
  const stepsDef = {
    title: "実験の手順",
    zones: [{ id: "all", label: "手順" }],
    cardColors: [],
  };
  function stepsTool(sql: HistorySQL, unit: string = "individual") {
    const created = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "steps",
      unit,
      definition: stepsDef,
    });
    const id = created!.createdId!;
    open(sql, id);
    return id;
  }
  it("creates as a board tool with one zone and appends in order", () => {
    const { sql } = fixture();
    const id = stepsTool(sql);
    const view = thinkingList(sql, "deck", "host", true, { board: true, steps: true }).find((t) => t.id === id)!;
    expect(view.kind).toBe("board");
    expect(view.definition.zones).toHaveLength(1);
    const a = thinkingCommand(sql, "deck", "ana", false, "card", id, { zone: "all", text: "水を入れる", color: "" })!.createdId!;
    const b = thinkingCommand(sql, "deck", "ana", false, "card", id, { zone: "all", text: "火にかける", color: "" })!.createdId!;
    thinkingCommand(sql, "deck", "ana", false, "card", id, { zone: "all", text: "まぜる", color: "" });
    // Delete the middle card, then append: the new card must sort
    // after the last one (max+1), not collide with it (review 🟡1).
    thinkingCommand(sql, "deck", "ana", false, "carddelete", id, { cardId: b });
    thinkingCommand(sql, "deck", "ana", false, "card", id, { zone: "all", text: "冷ます", color: "" });
    const cards = thinkingList(sql, "deck", "ana", false, { board: true, steps: true })
      .find((t) => t.id === id)!.cards.sort((x, y) => x.sort - y.sort);
    expect(cards.map((c) => c.text)).toEqual(["水を入れる", "まぜる", "冷ます"]);
    expect(a).toBeTruthy();
  });
  it("reorders only with the exact current set", () => {
    const { sql } = fixture();
    const id = stepsTool(sql);
    const ids: string[] = [];
    for (const text of ["一", "二", "三"])
      ids.push(thinkingCommand(sql, "deck", "ana", false, "card", id, { zone: "all", text, color: "" })!.createdId!);
    thinkingCommand(sql, "deck", "ana", false, "reorder", id, { order: [ids[2], ids[0], ids[1]] });
    const cards = thinkingList(sql, "deck", "ana", false, { board: true, steps: true })
      .find((t) => t.id === id)!.cards.sort((x, y) => x.sort - y.sort);
    expect(cards.map((c) => c.text)).toEqual(["三", "一", "二"]);
    // A stale order (someone else added a card meanwhile) is refused.
    thinkingCommand(sql, "deck", "ana", false, "card", id, { zone: "all", text: "四", color: "" });
    fails(() => thinkingCommand(sql, "deck", "ana", false, "reorder", id, { order: [ids[0], ids[1], ids[2]] }), 409);
    // Another student's cards are not bob's to reorder: the sent
    // set never matches his own (empty) sequence.
    fails(() => thinkingCommand(sql, "deck", "bob", false, "reorder", id, { order: [ids[0], ids[1], ids[2]] }), 409);
  });
  it("hides step charts from clients without the steps capability", () => {
    const { sql } = fixture();
    const id = stepsTool(sql);
    expect(thinkingList(sql, "deck", "ana", false, { board: true }).some((t) => t.id === id)).toBe(false);
    expect(thinkingList(sql, "deck", "ana", false, { board: true, steps: true }).some((t) => t.id === id)).toBe(true);
    expect(thinkingList(sql, "deck", "ana", false).some((t) => t.id === id)).toBe(false);
  });
  it("shares the sequence through the class share view", () => {
    const { sql } = fixture();
    const id = stepsTool(sql);
    thinkingCommand(sql, "deck", "ana", false, "card", id, { zone: "all", text: "最初", color: "" });
    thinkingCommand(sql, "deck", "ana", false, "card", id, { zone: "all", text: "最後", color: "" });
    const share = thinkingShareView(sql, "deck", id, "ana", false, "host", {
      steps: true,
    });
    expect(share).toBeTruthy();
    expect(share!.cards.map((c) => c.text)).toEqual(["最初", "最後"]);
    // Without the steps capability the share is refused, so an old
    // tab shows "nothing is being shown" instead of an empty board.
    expect(thinkingShareView(sql, "deck", id, "ana", false, "host")).toBeUndefined();
  });
  it("refuses generic card moves on a step chart", () => {
    const { sql } = fixture();
    const id = stepsTool(sql);
    const cardId = thinkingCommand(sql, "deck", "ana", false, "card", id, { zone: "all", text: "一", color: "" })!.createdId!;
    fails(
      () =>
        thinkingCommand(sql, "deck", "ana", false, "cardmove", id, {
          cardId,
          zone: "all",
          x: 0.5,
          y: 0.5,
        }),
      400,
    );
  });
});

describe("thinking personal webbing (stage 4, flow)", () => {
  const webDef = { title: "海の生き物" };
  function webTool(sql: HistorySQL, unit: string = "individual") {
    const created = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "webbing",
      unit,
      definition: webDef,
    });
    const id = created!.createdId!;
    open(sql, id);
    return id;
  }
  const listAs = (sql: HistorySQL, user: string, host = false) =>
    thinkingList(sql, "deck", user, host, { board: true, steps: true, flow: true });

  it("is a flow tool and hides without the flow cap", () => {
    const { sql } = fixture();
    expect(templateKind("webbing")).toBe("flow");
    const id = webTool(sql);
    const view = listAs(sql, "host", true).find((t) => t.id === id)!;
    expect(view.kind).toBe("flow");
    expect(view.nodes).toEqual([]);
    // No centre row is ever stored: the title is the centre.
    expect(
      thinkingList(sql, "deck", "ana", false, { board: true, steps: true }).some(
        (t) => t.id === id,
      ),
    ).toBe(false);
    expect(listAs(sql, "ana").some((t) => t.id === id)).toBe(true);
  });

  it("grows a tree and refuses grafts onto another owner's nodes", () => {
    const { sql } = fixture();
    const id = webTool(sql);
    const root = thinkingCommand(sql, "deck", "ana", false, "node", id, {
      text: "魚",
      x: 0.3,
      y: 0.3,
    })!.createdId!;
    const child = thinkingCommand(sql, "deck", "ana", false, "node", id, {
      parent: root,
      text: "さけ",
      x: 0.2,
      y: 0.2,
    })!.createdId!;
    const nodes = listAs(sql, "ana").find((t) => t.id === id)!.nodes;
    expect(nodes.map((n) => n.text)).toEqual(["魚", "さけ"]);
    expect(nodes.find((n) => n.id === child)!.parent).toBe(root);
    expect(nodes.find((n) => n.id === root)!.parent).toBeNull();
    // Bob cannot hang a node on ana's tree, nor see it.
    fails(
      () =>
        thinkingCommand(sql, "deck", "bob", false, "node", id, {
          parent: root,
          text: "横取り",
        }),
      403,
    );
    expect(listAs(sql, "bob").find((t) => t.id === id)!.nodes).toEqual([]);
    // Out-of-stage positions are refused (they clamp at draw time).
    fails(
      () =>
        thinkingCommand(sql, "deck", "ana", false, "node", id, {
          text: "外",
          x: 1.5,
          y: 0.5,
        }),
      400,
    );
  });

  it("edits text as the author only, moves as anyone in scope, and reparents on delete", () => {
    const { sql } = fixture();
    const id = webTool(sql, "group");
    groupCommand(sql, "deck", "host", true, "create", undefined, {
      names: ["1班", "2班"],
    });
    const g1 = [...sql("SELECT id FROM deck_groups ORDER BY rowid")][0].id as string;
    const g2 = [...sql("SELECT id FROM deck_groups ORDER BY rowid")][1].id as string;
    groupCommand(sql, "deck", "ana", false, "join", undefined, { groupId: g1 });
    groupCommand(sql, "deck", "bob", false, "join", undefined, { groupId: g1 });
    groupCommand(sql, "deck", "eve", false, "join", undefined, { groupId: g2 });
    const root = thinkingCommand(sql, "deck", "ana", false, "node", id, {
      text: "親",
      owner: g1,
    })!.createdId!;
    const child = thinkingCommand(sql, "deck", "bob", false, "node", id, {
      parent: root,
      text: "子",
      owner: g1,
    })!.createdId!;
    const grand = thinkingCommand(sql, "deck", "ana", false, "node", id, {
      parent: child,
      text: "孫",
      owner: g1,
    })!.createdId!;
    // Bob (same group) may move ana's node but not rewrite it.
    thinkingCommand(sql, "deck", "bob", false, "nodeedit", id, {
      nodeId: root,
      x: 0.4,
      y: 0.4,
    });
    fails(
      () =>
        thinkingCommand(sql, "deck", "bob", false, "nodeedit", id, {
          nodeId: root,
          text: "書き換え",
        }),
      403,
    );
    // Eve (other group) sees nothing and can do nothing.
    expect(listAs(sql, "eve").find((t) => t.id === id)!.nodes).toEqual([]);
    fails(
      () =>
        thinkingCommand(sql, "deck", "eve", false, "nodeedit", id, {
          nodeId: root,
          x: 0.1,
          y: 0.1,
        }),
      403,
    );
    // Deleting the child lifts the grandchild up to the root.
    thinkingCommand(sql, "deck", "bob", false, "nodedelete", id, {
      nodeId: child,
    });
    const nodes = listAs(sql, "ana").find((t) => t.id === id)!.nodes;
    expect(nodes.map((n) => n.text)).toEqual(["親", "孫"]);
    expect(nodes.find((n) => n.id === grand)!.parent).toBe(root);
    // Locks: only the author (or host) may take a node's lock.
    fails(
      () =>
        thinkingCommand(sql, "deck", "bob", false, "lock", id, {
          nodeId: root,
        }),
      403,
    );
    thinkingCommand(sql, "deck", "ana", false, "lock", id, { nodeId: root });
  });

  it("refuses point/card actions, locks the unit once nodes exist, and cleans up on delete", () => {
    const { sql } = fixture();
    const id = webTool(sql);
    thinkingCommand(sql, "deck", "ana", false, "node", id, { text: "言葉" });
    fails(
      () => thinkingCommand(sql, "deck", "ana", false, "point", id, { scene: "s", value: {} }),
      400,
    );
    fails(
      () => thinkingCommand(sql, "deck", "ana", false, "card", id, { zone: "all", text: "x" }),
      400,
    );
    fails(
      () => thinkingCommand(sql, "deck", "host", true, "scene", id, { scene: "s" }),
      400,
    );
    fails(
      () =>
        thinkingCommand(sql, "deck", "host", true, "edit", id, {
          unit: "group",
          definition: webDef,
        }),
      409,
    );
    thinkingCommand(sql, "deck", "host", true, "delete", id, {});
    expect(
      [...sql("SELECT COUNT(*) AS n FROM thinking_nodes WHERE tool=?", id)][0].n,
    ).toBe(0);
  });

  it("shares nodes by sequence number only, gated by the flow cap", () => {
    const { sql } = fixture();
    const id = webTool(sql);
    const root = thinkingCommand(sql, "deck", "ana", false, "node", id, {
      text: "魚",
      x: 0.3,
      y: 0.3,
    })!.createdId!;
    thinkingCommand(sql, "deck", "ana", false, "node", id, {
      parent: root,
      text: "さけ",
      x: 0.2,
      y: 0.25,
    });
    expect(thinkingShareView(sql, "deck", id, "ana", false, "host")).toBeUndefined();
    expect(
      thinkingShareView(sql, "deck", id, "ana", false, "host", { steps: true }),
    ).toBeUndefined();
    const share = thinkingShareView(sql, "deck", id, "ana", false, "host", {
      flow: true,
    })!;
    expect(share.nodes!.map((n) => [n.n, n.parent, n.text])).toEqual([
      [1, null, "魚"],
      [2, 1, "さけ"],
    ]);
    expect(JSON.stringify(share)).not.toContain(root);
  });
});

describe("thinking — class webbing (the integrated whole-class map)", () => {
  const webDef = { title: "海の生き物" };
  const listAs = (sql: HistorySQL, user: string, host = false) =>
    thinkingList(sql, "deck", user, host, {
      board: true,
      steps: true,
      flow: true,
      board5: true,
    });

  const classWeb = (sql: HistorySQL): string => {
    const r = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "webbing",
      unit: "class",
      definition: webDef,
    }) as { createdId: string };
    thinkingCommand(sql, "deck", "host", true, "status", r.createdId, {
      status: "open",
    });
    return r.createdId;
  };

  it("shares one tree across the class: anyone may branch off anyone's node", () => {
    const { sql } = fixture();
    const id = classWeb(sql);
    const root = thinkingCommand(sql, "deck", "user", false, "node", id, {
      text: "海",
      x: 0.3,
      y: 0.3,
    }) as { createdId: string };
    // Another student hangs a child off the first student's node.
    const child = thinkingCommand(sql, "deck", "peer", false, "node", id, {
      parent: root.createdId,
      text: "魚",
      x: 0.5,
      y: 0.5,
    }) as { createdId: string };
    expect(child.createdId).toBeTruthy();
    // Both students see the whole tree, with author names (the old
    // shared webbing map showed who wrote each node).
    const asPeer = listAs(sql, "peer", false).find((t) => t.id === id)!;
    expect(asPeer.nodes.map((n) => n.text).sort()).toEqual(["海", "魚"]);
    // (For an individual tool a peer would not see the node at all.)
    const asHost = listAs(sql, "host", true).find((t) => t.id === id)!;
    expect(asPeer.nodes.find((n) => n.text === "海")?.authorName).toBe(
      asHost.nodes.find((n) => n.text === "海")?.authorName,
    );
    expect(asPeer.nodes.find((n) => n.text === "海")?.authorName).toBeTruthy();
    // Text stays the author's; position is shared like the old map.
    fails(
      () =>
        thinkingCommand(sql, "deck", "peer", false, "nodeedit", id, {
          nodeId: root.createdId,
          text: "書き換え",
        }),
      403,
    );
    thinkingCommand(sql, "deck", "peer", false, "nodeedit", id, {
      nodeId: root.createdId,
      x: 0.4,
      y: 0.4,
    });
    // The host's share view of the class chart is labelled 全員.
    const share = thinkingShareView(sql, "deck", id, "", false, "host", { flow: true }, "peer")!;
    expect(share.unit).toBe("class");
    expect(share.nodes).toHaveLength(2);
  });
});

describe("thinking remaining board templates (stage 4, board5)", () => {
  const caps = { board: true, board5: true };
  function boardTool(sql: HistorySQL, template: string, title = "テーマ") {
    const created = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template,
      unit: "individual",
      definition: { title, zones: [], cardColors: [] },
    });
    const id = created!.createdId!;
    open(sql, id);
    return id;
  }
  it("parses all seven templates as boards with the agreed zone counts", () => {
    const counts: Record<string, number> = {
      fishbone: 4,
      butterfly2: 2,
      butterfly4: 4,
      jellyfish: 4,
      pyramid3: 3,
      pyramid4: 4,
      kumade: 5,
    };
    for (const [template, n] of Object.entries(counts)) {
      expect(templateKind(template as never)).toBe("board");
      const { definition } = parseThinkingDefinition(template, { title: "題" });
      expect(definition.zones).toHaveLength(n);
    }
    const b4 = parseThinkingDefinition("butterfly4", { title: "賛否" });
    expect(b4.definition.zones.map((z) => z.label)).toEqual([
      "強い賛成",
      "賛成",
      "反対",
      "強い反対",
    ]);
  });
  it("places points into the new shapes' zones and refuses the pyramid's corners", () => {
    expect(zoneAtPoint("fishbone", 0.2, 0.2)).toBe("a");
    expect(zoneAtPoint("fishbone", 0.6, 0.8)).toBe("d");
    expect(zoneAtPoint("butterfly4", 0.2, 0.7)).toBe("b");
    expect(zoneAtPoint("jellyfish", 0.85, 0.6)).toBe("d");
    expect(zoneAtPoint("kumade", 0.5, 0.6)).toBe("c");
    expect(zoneAtPoint("pyramid3", 0.5, 0.19)).toBe("a");
    expect(zoneAtPoint("pyramid3", 0.5, 0.81)).toBe("c");
    // The top tier's trapezoid is narrow: the band's corner is
    // outside every zone, so a click there places nothing (🟡).
    expect(zoneAtPoint("pyramid3", 0.05, 0.19)).toBeNull();
    expect(zoneAtPoint("pyramid4", 0.05, 0.15)).toBeNull();
  });
  it("hides the new templates without the board5 capability and shares only with it", () => {
    const { sql } = fixture();
    const id = boardTool(sql, "fishbone", "結果のわけ");
    thinkingCommand(sql, "deck", "ana", false, "card", id, { zone: "a", text: "人の原因", color: "" });
    expect(thinkingList(sql, "deck", "ana", false, { board: true }).some((t) => t.id === id)).toBe(false);
    expect(thinkingList(sql, "deck", "ana", false, caps).some((t) => t.id === id)).toBe(true);
    expect(thinkingShareView(sql, "deck", id, "ana", false, "host")).toBeUndefined();
    const share = thinkingShareView(sql, "deck", id, "ana", false, "host", { board5: true });
    expect(share).toBeTruthy();
    expect(share!.cards.map((c) => c.text)).toEqual(["人の原因"]);
    // An older board (kwl) is unaffected by the new capability.
    const kwl = boardTool(sql, "kwl", "単元の導入");
    expect(thinkingList(sql, "deck", "ana", false, { board: true }).some((t) => t.id === kwl)).toBe(true);
  });
});

describe("thinking board5 counts are fixed at creation (design review point 2)", () => {
  it("an edit can never change a tool's template, zone count or zone ids", () => {
    const { sql } = fixture();
    const created = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "pyramid4",
      unit: "individual",
      definition: { title: "大切なもの", zones: [], cardColors: [] },
    });
    const id = created!.createdId!;
    open(sql, id);
    thinkingCommand(sql, "deck", "ana", false, "card", id, { zone: "a", text: "いのち", color: "" });
    // Even with a card in place and a body that names another
    // template with fewer zones, the stored tool keeps its own
    // template and all four zones: edit re-parses against the
    // stored template only.
    thinkingCommand(sql, "deck", "host", true, "edit", id, {
      template: "pyramid3",
      unit: "individual",
      definition: {
        title: "大切なもの",
        zones: [{ id: "a", label: "1段目" }],
        cardColors: [],
      },
    });
    const view = thinkingList(sql, "deck", "host", true, { board: true, board5: true }).find((t) => t.id === id)!;
    expect(view.template).toBe("pyramid4");
    expect(view.definition.zones.map((z) => z.id)).toEqual(["a", "b", "c", "d"]);
    expect(view.cards).toHaveLength(1);
  });
});
