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
      { answered: 1, slideId: "slide-1" },
      { answered: 1, slideId: "slide-2" },
    ]);
    // Bob answered the worksheet only; the empty cell still names
    // the row's first slide as its open target.
    expect(bob.cells).toEqual([
      { answered: 1, slideId: "slide-1" },
      { answered: 0, slideId: "slide-2" },
    ]);
    const filtered = learningRecordMatrix(sql, deck, "deck", "host", "bob");
    expect(filtered.rows.map((r) => r.userId)).toEqual(["bob"]);
    expect(filtered.columns).toHaveLength(2);
  });
});
