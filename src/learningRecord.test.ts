import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { HistorySQL } from "./historyStore";
import type { Deck } from "./model";
import { groupSchema, groupCommand, groupList } from "./groups";
import { worksheetSchema } from "./worksheets";
import { surveySchema } from "./surveys";
import { thinkingSchema, thinkingCommand } from "./thinkingTools";
import {
  learningRecord,
  learningRecordMatrix,
  myLearningRecord,
} from "./learningRecord";

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

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE decks(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT, email TEXT); CREATE TABLE members(deck TEXT, user_id TEXT)",
  );
  db.exec(groupSchema);
  db.exec(worksheetSchema);
  db.exec(surveySchema);
  db.exec(thinkingSchema);
  db.prepare("INSERT INTO decks VALUES(?)").run("deck");
  for (const [id, name] of [
    ["host", "先生"],
    ["ana", "あな"],
    ["bob", "ぼぶ"],
  ]) {
    db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, name, "");
    db.prepare("INSERT INTO members VALUES(?,?)").run("deck", id);
  }
  const sql: HistorySQL = (query, ...args) =>
    db.prepare(query).all(...(args as never[]));

  // A worksheet answered by both students.
  db.prepare(
    "INSERT INTO worksheets VALUES(?,?,?,?,?)",
  ).run(
    "ws-1",
    "deck",
    JSON.stringify({
      title: "ふりかえり",
      description: "",
      fields: [
        { id: "f1", label: "かんそう", kind: "text", options: [] },
        {
          id: "f2",
          label: "むずかしさ",
          kind: "single",
          options: ["かんたん", "ふつう", "むずかしい"],
        },
      ],
    }),
    "open",
    100,
  );
  db.prepare("INSERT INTO worksheet_answers VALUES(?,?,?,?)").run(
    "ws-1",
    "ana",
    JSON.stringify({ f1: "あなの感想", f2: [1] }),
    1000,
  );
  db.prepare("INSERT INTO worksheet_answers VALUES(?,?,?,?)").run(
    "ws-1",
    "bob",
    JSON.stringify({ f1: "ぼぶの感想", f2: [2] }),
    1001,
  );
  // A survey answered by ana only.
  db.prepare("INSERT INTO surveys VALUES(?,?,?,?,?,?,?)").run(
    "sv-1",
    "deck",
    "今日の授業は楽しかったですか",
    "single",
    JSON.stringify(["はい", "いいえ"]),
    "open",
    200,
  );
  db.prepare("INSERT INTO survey_answers VALUES(?,?,?,?)").run(
    "sv-1",
    "ana",
    JSON.stringify({ choices: [0], text: "" }),
    1002,
  );
  // An individual point tool: ana placed a point in scene 1.
  const axis = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
    template: "axis2",
    unit: "individual",
    definition: axisDef,
  })!.createdId!;
  thinkingCommand(sql, "deck", "host", true, "status", axis, { status: "open" });
  thinkingCommand(sql, "deck", "ana", false, "point", axis, {
    scene: "s1",
    value: { x: 0.2, y: 0.3 },
    reason: "なんとなく",
  });
  // A group board: ana is in group 1 and wrote its card.
  groupCommand(sql, "deck", "host", true, "create", undefined, {
    names: ["1班", "2班"],
  });
  const g1 = groupList(sql, "deck", "host", true).groups[0];
  groupCommand(sql, "deck", "ana", false, "join", undefined, { groupId: g1.id });
  const board = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
    template: "venn2",
    unit: "group",
    definition: { title: "班のベン図", cardColors: [] },
  })!.createdId!;
  thinkingCommand(sql, "deck", "host", true, "status", board, { status: "open" });
  thinkingCommand(sql, "deck", "ana", false, "card", board, {
    zone: "a",
    text: "班のカード",
    color: "",
  });
  // A class board: bob wrote a card in the shared chart.
  const shared = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
    template: "tchart",
    unit: "class",
    definition: { title: "全体のT", cardColors: [] },
  })!.createdId!;
  thinkingCommand(sql, "deck", "host", true, "status", shared, { status: "open" });
  thinkingCommand(sql, "deck", "bob", false, "card", shared, {
    zone: "a",
    text: "ぼぶの全体カード",
    color: "",
  });

  const deck = {
    version: 1,
    title: "テスト作品",
    sheets: [
      { id: "main", name: "シート1", rowLabels: { 0: "第1時", 1: "第2時" } },
    ],
    slides: [
      {
        id: "slide-1",
        sheetId: "main",
        x: 0,
        y: 0,
        title: "予想しよう",
        background: "",
        elements: [
          { id: "e1", worksheet: { deckId: "deck", worksheetId: "ws-1" } },
        ],
      },
      {
        id: "slide-2",
        sheetId: "main",
        x: 0,
        y: 1,
        title: "考えを置こう",
        background: "",
        elements: [{ id: "e2", thinking: { deckId: "deck", toolId: axis } }],
      },
    ],
  } as unknown as Deck;
  return { sql, deck };
}

describe("learning record", () => {
  it("orders a student's own answers by their place on the map", () => {
    const { sql, deck } = fixture();
    const record = myLearningRecord(sql, deck, "deck", "ana");
    expect(record.name).toBe("あな");
    expect(record.entries.map((e) => e.kind)).toEqual([
      "worksheet",
      "thinking",
      "survey",
      "thinking",
    ]);
    const [sheet, axis, , board] = record.entries;
    expect(sheet.placement?.rowLabel).toBe("第1時");
    expect(sheet.fields?.find((f) => f.id === "f1")?.value).toBe("あなの感想");
    expect(axis.placement?.rowLabel).toBe("第2時");
    expect(axis.scenes?.[0].value).toEqual({ x: 0.2, y: 0.3 });
    expect(axis.scenes?.[0].reason).toBe("なんとなく");
    expect(axis.scenes?.[1].value).toEqual({});
    expect(board.groupName).toBe("1班");
    expect(board.zones?.[0].cards.map((c) => c.text)).toEqual(["班のカード"]);
    expect(record.answered).toBe(4);
    expect(record.total).toBe(5);
  });

  it("never includes another student's answers in one's own record", () => {
    const { sql, deck } = fixture();
    const ana = JSON.stringify(myLearningRecord(sql, deck, "deck", "ana"));
    expect(ana).not.toContain("ぼぶの感想");
    expect(ana).not.toContain("ぼぶの全体カード");
    const bob = myLearningRecord(sql, deck, "deck", "bob");
    expect(JSON.stringify(bob)).not.toContain("あなの感想");
    expect(JSON.stringify(bob)).not.toContain("班のカード");
    // Bob's own class-board card is his contribution to the shared chart.
    const shared = bob.entries.find((e) => e.title === "全体のT");
    expect(shared?.zones?.[0].cards.map((c) => c.text)).toEqual([
      "ぼぶの全体カード",
    ]);
    // Bob is in no group, so the group board stays out of his record.
    expect(bob.entries.some((e) => e.title === "班のベン図")).toBe(false);
  });

  it("follows the board a student wrote on, not their current group", () => {
    const { sql, deck } = fixture();
    const boardId = String(
      [...sql("SELECT id FROM thinking_tools WHERE unit=?", "group")][0].id,
    );
    const g2 = groupList(sql, "deck", "host", true).groups[1];
    // Coco is in group 2 and wrote on the group board there.
    sql("INSERT INTO users VALUES(?,?,?)", "coco", "ここ", "");
    sql("INSERT INTO members VALUES(?,?)", "deck", "coco");
    groupCommand(sql, "deck", "coco", false, "join", undefined, {
      groupId: g2.id,
    });
    thinkingCommand(sql, "deck", "coco", false, "card", boardId, {
      zone: "a",
      text: "2班のカード",
      color: "",
    });
    // Ana wrote in group 1 (fixture) but has since moved to group 2.
    sql("UPDATE deck_group_members SET grp=? WHERE deck=? AND user=?", g2.id, "deck", "ana");
    const ana = myLearningRecord(sql, deck, "deck", "ana");
    const anaBoards = ana.entries.filter((e) => e.title === "班のベン図");
    expect(anaBoards).toHaveLength(1);
    expect(anaBoards[0].groupName).toBe("1班");
    expect(anaBoards[0].groupCurrent).toBeUndefined();
    expect(JSON.stringify(ana)).toContain("班のカード");
    expect(JSON.stringify(ana)).not.toContain("2班のカード");
    // Bob joins group 2 without writing anything: he sees its board
    // as his current group's, marked as such.
    groupCommand(sql, "deck", "bob", false, "join", undefined, {
      groupId: g2.id,
    });
    const bob = myLearningRecord(sql, deck, "deck", "bob");
    const bobBoard = bob.entries.find((e) => e.title === "班のベン図");
    expect(bobBoard?.groupName).toBe("2班");
    expect(bobBoard?.groupCurrent).toBe(true);
    expect(JSON.stringify(bobBoard)).toContain("2班のカード");
  });

  it("lists every student for the host and narrows with a filter", () => {
    const { sql, deck } = fixture();
    const all = learningRecord(sql, deck, "deck", "host");
    expect(all.map((s) => s.userId)).toEqual(["ana", "bob"]);
    expect(all.map((s) => s.name)).toEqual(["あな", "ぼぶ"]);
    const one = learningRecord(sql, deck, "deck", "host", "bob");
    expect(one).toHaveLength(1);
    expect(one[0].userId).toBe("bob");
    expect(one[0].entries.some((e) => e.kind === "worksheet")).toBe(true);
  });

  it("builds the answer-status matrix by map row", () => {
    const { sql, deck } = fixture();
    const matrix = learningRecordMatrix(sql, deck, "deck", "host");
    // Only placed items form columns: the worksheet （第1時） and the
    // axis tool （第2時）. The survey and the two boards are not
    // placed on any slide, so they never appear here.
    expect(matrix.columns.map((c) => c.rowLabel)).toEqual(["第1時", "第2時"]);
    expect(matrix.columns.map((c) => c.total)).toEqual([1, 1]);
    expect(matrix.columns.map((c) => c.slideId)).toEqual([
      "slide-1",
      "slide-2",
    ]);
    const ana = matrix.rows.find((r) => r.userId === "ana")!;
    const bob = matrix.rows.find((r) => r.userId === "bob")!;
    expect(ana.cells).toEqual([
      { answered: 1, group: 0, slideId: "slide-1" },
      { answered: 1, group: 0, slideId: "slide-2" },
    ]);
    // Bob answered the worksheet only; the empty cell still names
    // the row's first slide as its open target.
    expect(bob.cells).toEqual([
      { answered: 1, group: 0, slideId: "slide-1" },
      { answered: 0, group: 0, slideId: "slide-2" },
    ]);
    const filtered = learningRecordMatrix(sql, deck, "deck", "host", "bob");
    expect(filtered.rows.map((r) => r.userId)).toEqual(["bob"]);
    expect(filtered.columns).toHaveLength(2);
  });

  it("counts a moved student's group item once and marks group-only coverage", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE decks(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT, email TEXT); CREATE TABLE members(deck TEXT, user_id TEXT)",
    );
    db.exec(groupSchema);
    db.exec(worksheetSchema);
    db.exec(surveySchema);
    db.exec(thinkingSchema);
    db.prepare("INSERT INTO decks VALUES(?)").run("deck");
    for (const [id, name] of [
      ["host", "先生"],
      ["ana", "あな"],
      ["bob", "ぼぶ"],
      ["coco", "ここ"],
    ]) {
      db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, name, "");
      db.prepare("INSERT INTO members VALUES(?,?)").run("deck", id);
    }
    const sql: HistorySQL = (query, ...args) =>
      db.prepare(query).all(...(args as never[]));
    groupCommand(sql, "deck", "host", true, "create", undefined, {
      names: ["1班", "2班"],
    });
    const [g1, g2] = groupList(sql, "deck", "host", true).groups;
    const board = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "venn2",
      unit: "group",
      definition: { title: "班のベン図", cardColors: [] },
    })!.createdId!;
    thinkingCommand(sql, "deck", "host", true, "status", board, {
      status: "open",
    });
    const axis = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "axis2",
      unit: "individual",
      definition: axisDef,
    })!.createdId!;
    thinkingCommand(sql, "deck", "host", true, "status", axis, {
      status: "open",
    });
    // Ana writes her group's card; bob (same group) writes nothing.
    groupCommand(sql, "deck", "ana", false, "join", undefined, { groupId: g1.id });
    groupCommand(sql, "deck", "bob", false, "join", undefined, { groupId: g1.id });
    thinkingCommand(sql, "deck", "ana", false, "card", board, {
      zone: "a",
      text: "あなのカード",
      color: "",
    });
    // Coco writes in group 1, moves to group 2 and writes there too:
    // two boards, but still one item.
    groupCommand(sql, "deck", "coco", false, "join", undefined, { groupId: g1.id });
    thinkingCommand(sql, "deck", "coco", false, "card", board, {
      zone: "a",
      text: "ここの1班カード",
      color: "",
    });
    groupCommand(sql, "deck", "coco", false, "join", undefined, { groupId: g2.id });
    thinkingCommand(sql, "deck", "coco", false, "card", board, {
      zone: "b",
      text: "ここの2班カード",
      color: "",
    });
    const deck = {
      version: 1,
      title: "テスト作品",
      sheets: [{ id: "main", name: "", rowLabels: { 0: "第1時" } }],
      slides: [
        {
          id: "slide-g",
          sheetId: "main",
          x: 0,
          y: 0,
          title: "班で考えよう",
          background: "",
          elements: [
            { id: "e1", thinking: { deckId: "deck", toolId: board } },
            { id: "e2", thinking: { deckId: "deck", toolId: axis } },
          ],
        },
      ],
    } as unknown as Deck;

    const matrix = learningRecordMatrix(sql, deck, "deck", "host");
    expect(matrix.columns).toHaveLength(1);
    expect(matrix.columns[0].total).toBe(2);
    const cellOf = (uid: string) =>
      matrix.rows.find((r) => r.userId === uid)!.cells[0];
    // Ana answered the board herself; the axis is still open.
    expect(cellOf("ana")).toEqual({ answered: 1, group: 0, slideId: "slide-g" });
    // Bob wrote nothing: the board shows as his group's work only,
    // never as his own answer.
    expect(cellOf("bob")).toEqual({ answered: 0, group: 1, slideId: "slide-g" });
    // Coco's two boards are one item: 1 of 2, not 2 of 2.
    expect(cellOf("coco")).toEqual({ answered: 1, group: 0, slideId: "slide-g" });
  });
});

describe("learning record: emotion curve (stage 4)", () => {
  function curveFixture() {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE decks(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT, email TEXT); CREATE TABLE members(deck TEXT, user_id TEXT)",
    );
    db.exec(groupSchema);
    db.exec(worksheetSchema);
    db.exec(surveySchema);
    db.exec(thinkingSchema);
    db.prepare("INSERT INTO decks VALUES(?)").run("deck");
    for (const [id, name] of [
      ["host", "先生"],
      ["ana", "あな"],
      ["bob", "ぼぶ"],
    ]) {
      db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, name, "");
      db.prepare("INSERT INTO members VALUES(?,?)").run("deck", id);
    }
    const sql: HistorySQL = (query, ...args) =>
      db.prepare(query).all(...(args as never[]));
    const curve = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "curve",
      unit: "individual",
      definition: {
        title: "主人公の気持ち",
        yMin: "下がる",
        yMax: "上がる",
        scenes: [
          { id: "s1", label: "場面1" },
          { id: "s2", label: "場面2" },
        ],
        lines: [
          { id: "l1", label: "主人公" },
          { id: "l2", label: "友だち" },
        ],
      },
    })!.createdId!;
    thinkingCommand(sql, "deck", "host", true, "status", curve, {
      status: "open",
    });
    thinkingCommand(sql, "deck", "ana", false, "point", curve, {
      scene: "s1:l1",
      value: { v: 0.8 },
      reason: "どきどき",
    });
    thinkingCommand(sql, "deck", "ana", false, "point", curve, {
      scene: "s2:l1",
      value: { v: 0.3 },
    });
    thinkingCommand(sql, "deck", "ana", false, "point", curve, {
      scene: "s1:l2",
      value: { v: 0.5 },
    });
    const deck = {
      version: 1,
      title: "テスト作品",
      sheets: [
        { id: "main", name: "シート1", rowLabels: { 0: "第1時" } },
      ],
      slides: [
        {
          id: "slide-1",
          sheetId: "main",
          x: 0,
          y: 0,
          title: "気持ちの変化",
          background: "",
          elements: [{ id: "e1", thinking: { deckId: "deck", toolId: curve } }],
        },
      ],
    } as unknown as Deck;
    return { sql, deck };
  }

  it("lists the timeline per scene and line", () => {
    const { sql, deck } = curveFixture();
    const record = myLearningRecord(sql, deck, "deck", "ana");
    const entry = record.entries.find((e) => e.template === "curve");
    expect(entry).toBeTruthy();
    expect(entry!.scenes!.map((s) => s.label)).toEqual([
      "場面1（主人公）",
      "場面1（友だち）",
      "場面2（主人公）",
      "場面2（友だち）",
    ]);
    const first = entry!.scenes!.find((s) => s.id === "s1:l1");
    expect(first?.value.v).toBe(0.8);
    expect(first?.reason).toBe("どきどき");
    const empty = entry!.scenes!.find((s) => s.id === "s2:l2");
    expect(empty?.value).toEqual({});
  });

  it("counts the curve as answered in the matrix", () => {
    const { sql, deck } = curveFixture();
    const matrix = learningRecordMatrix(sql, deck, "deck", "host");
    expect(matrix.columns.map((c) => c.rowLabel)).toEqual(["第1時"]);
    const ana = matrix.rows.find((r) => r.userId === "ana");
    const bob = matrix.rows.find((r) => r.userId === "bob");
    expect(ana?.cells[0].answered).toBe(1);
    expect(bob?.cells[0].answered).toBe(0);
  });
});

describe("learning record: step chart (stage 4)", () => {
  it("lists the cards in order and counts the chart as answered", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE decks(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT, email TEXT); CREATE TABLE members(deck TEXT, user_id TEXT)",
    );
    db.exec(groupSchema);
    db.exec(worksheetSchema);
    db.exec(surveySchema);
    db.exec(thinkingSchema);
    db.prepare("INSERT INTO decks VALUES(?)").run("deck");
    for (const [id, name] of [
      ["host", "先生"],
      ["ana", "あな"],
      ["bob", "ぼぶ"],
    ]) {
      db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, name, "");
      db.prepare("INSERT INTO members VALUES(?,?)").run("deck", id);
    }
    const sql: HistorySQL = (query, ...args) =>
      db.prepare(query).all(...(args as never[]));
    const steps = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "steps",
      unit: "individual",
      definition: {
        title: "実験の手順",
        zones: [{ id: "all", label: "手順" }],
        cardColors: [],
      },
    })!.createdId!;
    thinkingCommand(sql, "deck", "host", true, "status", steps, {
      status: "open",
    });
    thinkingCommand(sql, "deck", "ana", false, "card", steps, {
      zone: "all",
      text: "水を入れる",
      color: "",
    });
    thinkingCommand(sql, "deck", "ana", false, "card", steps, {
      zone: "all",
      text: "火にかける",
      color: "",
    });
    const deck = {
      version: 1,
      title: "テスト作品",
      sheets: [{ id: "main", name: "シート1", rowLabels: { 0: "第1時" } }],
      slides: [
        {
          id: "slide-1",
          sheetId: "main",
          x: 0,
          y: 0,
          title: "手順を並べよう",
          background: "",
          elements: [{ id: "e1", thinking: { deckId: "deck", toolId: steps } }],
        },
      ],
    } as unknown as Deck;
    const record = myLearningRecord(sql, deck, "deck", "ana");
    const entry = record.entries.find((e) => e.template === "steps");
    expect(entry).toBeTruthy();
    expect(entry!.kind).toBe("thinking");
    const zone = entry!.zones?.find((z) => z.id === "all");
    expect(zone?.cards.map((c) => c.text)).toEqual(["水を入れる", "火にかける"]);
    const matrix = learningRecordMatrix(sql, deck, "deck", "host");
    const ana = matrix.rows.find((r) => r.userId === "ana");
    const bob = matrix.rows.find((r) => r.userId === "bob");
    expect(ana?.cells[0].answered).toBe(1);
    expect(bob?.cells[0].answered).toBe(0);
  });
});

describe("learning record: personal webbing (stage 4)", () => {
  it("lists the nodes in tree order and counts the webbing as answered", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE decks(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT, email TEXT); CREATE TABLE members(deck TEXT, user_id TEXT)",
    );
    db.exec(groupSchema);
    db.exec(worksheetSchema);
    db.exec(surveySchema);
    db.exec(thinkingSchema);
    db.prepare("INSERT INTO decks VALUES(?)").run("deck");
    for (const [id, name] of [
      ["host", "先生"],
      ["ana", "あな"],
      ["bob", "ぼぶ"],
    ]) {
      db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, name, "");
      db.prepare("INSERT INTO members VALUES(?,?)").run("deck", id);
    }
    const sql: HistorySQL = (query, ...args) =>
      db.prepare(query).all(...(args as never[]));
    const web = thinkingCommand(sql, "deck", "host", true, "create", undefined, {
      template: "webbing",
      unit: "individual",
      definition: { title: "海の生き物" },
    })!.createdId!;
    thinkingCommand(sql, "deck", "host", true, "status", web, {
      status: "open",
    });
    const root = thinkingCommand(sql, "deck", "ana", false, "node", web, {
      text: "魚",
      x: 0.3,
      y: 0.3,
    })!.createdId!;
    thinkingCommand(sql, "deck", "ana", false, "node", web, {
      parent: root,
      text: "さけ",
      x: 0.2,
      y: 0.2,
    });
    thinkingCommand(sql, "deck", "ana", false, "node", web, {
      text: "貝",
      x: 0.7,
      y: 0.3,
    });
    const deck = {
      version: 1,
      title: "テスト作品",
      sheets: [{ id: "main", name: "シート1", rowLabels: { 0: "第1時" } }],
      slides: [
        {
          id: "slide-1",
          sheetId: "main",
          x: 0,
          y: 0,
          title: "ウェビング",
          background: "",
          elements: [{ id: "e1", thinking: { deckId: "deck", toolId: web } }],
        },
      ],
    } as unknown as Deck;
    const record = myLearningRecord(sql, deck, "deck", "ana");
    const entry = record.entries.find((e) => e.template === "webbing");
    expect(entry).toBeTruthy();
    expect(entry!.nodes).toEqual([
      { text: "魚", depth: 0 },
      { text: "さけ", depth: 1 },
      { text: "貝", depth: 0 },
    ]);
    const matrix = learningRecordMatrix(sql, deck, "deck", "host");
    const ana = matrix.rows.find((r) => r.userId === "ana");
    const bob = matrix.rows.find((r) => r.userId === "bob");
    expect(ana?.cells[0].answered).toBe(1);
    expect(bob?.cells[0].answered).toBe(0);
    // The host record lists ana as a writer (roster comes from the
    // node authors too).
    const all = learningRecord(sql, deck, "deck", "host");
    expect(
      all
        .find((r) => r.userId === "ana")
        ?.entries.some((e) => e.template === "webbing"),
    ).toBe(true);
  });
});
