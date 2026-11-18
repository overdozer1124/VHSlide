import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { HistorySQL } from "./historyStore";
import { parseDeck, sample, serializeDeck } from "./model";
import type { Element } from "./model";
import { worksheetSchema } from "./worksheets";
import { surveySchema } from "./surveys";
import { thinkingSchema, thinkingCommand } from "./thinkingTools";
import { groupSchema } from "./groups";
import {
  parsePrevAnswerBinding,
  parsePrevAnswerBindingLenient,
  prevAnswerFor,
} from "./prevAnswer";

const DECK = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE decks(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT, email TEXT); CREATE TABLE members(deck TEXT, user_id TEXT)",
  );
  db.exec(worksheetSchema);
  db.exec(surveySchema);
  db.exec(thinkingSchema);
  db.exec(groupSchema);
  const sql: HistorySQL = (query, ...args) =>
    db.prepare(query).all(...(args as never[]));
  db.prepare("INSERT INTO decks VALUES(?)").run(DECK);
  for (const id of ["host", "ana", "bob"]) {
    db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, id, "");
    db.prepare("INSERT INTO members VALUES(?,?)").run(DECK, id);
  }
  db.prepare("INSERT INTO worksheets VALUES(?,?,?,?,?)").run(
    WS,
    DECK,
    JSON.stringify({
      title: "予想シート",
      description: "",
      fields: [
        { id: "f1", label: "予想", kind: "text", options: [] },
        {
          id: "f2",
          label: "自信",
          kind: "single",
          options: ["ある", "ない"],
        },
      ],
    }),
    "open",
    100,
  );
  db.prepare("INSERT INTO worksheet_answers VALUES(?,?,?,?)").run(
    WS,
    "ana",
    JSON.stringify({ f1: "あなの予想", f2: [0], "f1:reason": "根拠" }),
    1000,
  );
  db.prepare("INSERT INTO worksheet_answers VALUES(?,?,?,?)").run(
    WS,
    "bob",
    JSON.stringify({ f1: "ぼぶの予想", f2: [1] }),
    1001,
  );
  // A draft worksheet with a stray answer row: never served.
  const draft = "33333333-3333-4333-8333-333333333333";
  db.prepare("INSERT INTO worksheets VALUES(?,?,?,?,?)").run(
    draft,
    DECK,
    JSON.stringify({
      title: "下書き",
      description: "",
      fields: [{ id: "f1", label: "x", kind: "text", options: [] }],
    }),
    "draft",
    90,
  );
  db.prepare("INSERT INTO worksheet_answers VALUES(?,?,?,?)").run(
    draft,
    "ana",
    JSON.stringify({ f1: "下書きの答え" }),
    900,
  );
  const survey = "44444444-4444-4444-8444-444444444444";
  db.prepare("INSERT INTO surveys VALUES(?,?,?,?,?,?,?)").run(
    survey,
    DECK,
    "楽しかったですか",
    "single",
    JSON.stringify(["はい", "いいえ"]),
    "open",
    200,
  );
  db.prepare("INSERT INTO survey_answers VALUES(?,?,?,?)").run(
    survey,
    "ana",
    JSON.stringify({ choices: [0], text: "" }),
    1002,
  );
  const axis = thinkingCommand(sql, DECK, "host", true, "create", undefined, {
    template: "axis2",
    unit: "individual",
    definition: {
      title: "賛成と自信",
      xMin: "反対",
      xMax: "賛成",
      yMin: "自信がない",
      yMax: "自信がある",
      scenes: [{ id: "s1", label: "読む前" }],
      reason: true,
    },
  })!.createdId!;
  thinkingCommand(sql, DECK, "host", true, "status", axis, {
    status: "open",
  });
  thinkingCommand(sql, DECK, "ana", false, "point", axis, {
    scene: "s1",
    value: { x: 0.2, y: 0.3 },
    reason: "なんとなく",
  });
  const board = thinkingCommand(sql, DECK, "host", true, "create", undefined, {
    template: "venn2",
    unit: "class",
    definition: { title: "班のベン図", cardColors: [] },
  })!.createdId!;
  thinkingCommand(sql, DECK, "host", true, "status", board, {
    status: "open",
  });
  // A group for the group-unit scenarios: ana and bob are in 1班.
  db.prepare("INSERT INTO deck_groups VALUES(?,?,?,?)").run("g1", DECK, "1班", 0);
  db.prepare("INSERT INTO deck_group_members VALUES(?,?,?)").run(DECK, "ana", "g1");
  db.prepare("INSERT INTO deck_group_members VALUES(?,?,?)").run(DECK, "bob", "g1");
  const groupAxis = thinkingCommand(sql, DECK, "host", true, "create", undefined, {
    template: "axis2",
    unit: "group",
    definition: {
      title: "班の賛成と自信",
      xMin: "反対",
      xMax: "賛成",
      yMin: "自信がない",
      yMax: "自信がある",
      scenes: [{ id: "s1", label: "話し合いの後" }],
      reason: true,
    },
  })!.createdId!;
  thinkingCommand(sql, DECK, "host", true, "status", groupAxis, {
    status: "open",
  });
  return { sql, draft, survey, axis, board, groupAxis };
}

describe("prevAnswerFor", () => {
  it("returns the worksheet answer of the signed-in student only", () => {
    const { sql } = fixture();
    const ana = prevAnswerFor(sql, DECK, "ana", {
      source: "worksheet",
      refId: WS,
      fieldId: "f1",
    });
    expect(ana).toMatchObject({
      source: "worksheet",
      title: "予想シート",
      label: "予想",
      value: "あなの予想",
      reason: "根拠",
    });
    const bob = prevAnswerFor(sql, DECK, "bob", {
      source: "worksheet",
      refId: WS,
      fieldId: "f1",
    });
    expect(bob).toMatchObject({ value: "ぼぶの予想", reason: "" });
    const single = prevAnswerFor(sql, DECK, "ana", {
      source: "worksheet",
      refId: WS,
      fieldId: "f2",
    });
    expect(single).toMatchObject({
      fieldKind: "single",
      options: ["ある", "ない"],
      value: [0],
    });
    // A member with no answer, and an unknown field, get nothing.
    expect(
      prevAnswerFor(sql, DECK, "host", {
        source: "worksheet",
        refId: WS,
        fieldId: "f1",
      }),
    ).toBeNull();
    expect(
      prevAnswerFor(sql, DECK, "ana", {
        source: "worksheet",
        refId: WS,
        fieldId: "nope",
      }),
    ).toBeNull();
  });

  it("never serves a draft source", () => {
    const { sql, draft } = fixture();
    expect(
      prevAnswerFor(sql, DECK, "ana", {
        source: "worksheet",
        refId: draft,
        fieldId: "f1",
      }),
    ).toBeNull();
  });

  it("returns the survey answer of the signed-in student only", () => {
    const { sql, survey } = fixture();
    expect(
      prevAnswerFor(sql, DECK, "ana", { source: "survey", refId: survey }),
    ).toMatchObject({ source: "survey", choices: [0], options: ["はい", "いいえ"] });
    expect(
      prevAnswerFor(sql, DECK, "bob", { source: "survey", refId: survey }),
    ).toBeNull();
  });

  it("returns the student's own point; board tools are refused", () => {
    const { sql, axis, board } = fixture();
    expect(
      prevAnswerFor(sql, DECK, "ana", {
        source: "thinking",
        refId: axis,
        sceneId: "s1",
      }),
    ).toMatchObject({
      source: "thinking",
      label: "読む前",
      value: { x: 0.2, y: 0.3 },
      reason: "なんとなく",
    });
    expect(
      prevAnswerFor(sql, DECK, "bob", {
        source: "thinking",
        refId: axis,
        sceneId: "s1",
      }),
    ).toBeNull();
    expect(
      prevAnswerFor(sql, DECK, "ana", {
        source: "thinking",
        refId: board,
        sceneId: "s1",
      }),
    ).toBeNull();
  });

  it("still serves a student's point after the host moves it", () => {
    const { sql, axis } = fixture();
    // The host adjusts ana's point: owner stays ana, author becomes
    // the host. The point is still ana's answer.
    thinkingCommand(sql, DECK, "host", true, "point", axis, {
      scene: "s1",
      owner: "ana",
      value: { x: 0.9, y: 0.8 },
      reason: "先生が直した",
    });
    expect(
      prevAnswerFor(sql, DECK, "ana", {
        source: "thinking",
        refId: axis,
        sceneId: "s1",
      }),
    ).toMatchObject({
      source: "thinking",
      value: { x: 0.9, y: 0.8 },
      reason: "先生が直した",
    });
    // The host has no point of their own on the tool.
    expect(
      prevAnswerFor(sql, DECK, "host", {
        source: "thinking",
        refId: axis,
        sceneId: "s1",
      }),
    ).toBeNull();
  });

  it("serves a group point to every member as the group's answer", () => {
    const { sql, groupAxis } = fixture();
    thinkingCommand(sql, DECK, "ana", false, "point", groupAxis, {
      scene: "s1",
      value: { x: 0.4, y: 0.4 },
      reason: "班の考え",
    });
    // Bob moves the group's point: author changes, owner (the
    // group) does not. Both members get it, labelled as the group's.
    // (Ana's edit lock is released by then; drop it to model that.)
    sql("DELETE FROM thinking_locks WHERE tool = ?", groupAxis);
    thinkingCommand(sql, DECK, "bob", false, "point", groupAxis, {
      scene: "s1",
      value: { x: 0.6, y: 0.5 },
      reason: "直した",
    });
    for (const who of ["ana", "bob"]) {
      expect(
        prevAnswerFor(sql, DECK, who, {
          source: "thinking",
          refId: groupAxis,
          sceneId: "s1",
        }),
      ).toMatchObject({
        source: "thinking",
        unit: "group",
        groupName: "1班",
        value: { x: 0.6, y: 0.5 },
      });
    }
  });
});

describe("prevAnswer binding", () => {
  const base = {
    deckId: DECK,
    source: "worksheet" as const,
    refId: WS,
    fieldId: "f1",
    title: "予想シート",
    label: "予想",
  };
  it("parses valid bindings and rejects broken ones", () => {
    expect(parsePrevAnswerBinding(base)).toEqual(base);
    expect(() =>
      parsePrevAnswerBinding({ ...base, fieldId: undefined }),
    ).toThrow();
    expect(() => parsePrevAnswerBinding({ ...base, refId: "x" })).toThrow();
    expect(parsePrevAnswerBindingLenient({ nope: true })).toBeUndefined();
    expect(
      parsePrevAnswerBinding({
        deckId: DECK,
        source: "survey",
        refId: WS,
        title: "質問",
        label: "",
      }),
    ).toEqual({
      deckId: DECK,
      source: "survey",
      refId: WS,
      title: "質問",
      label: "",
    });
  });

  it("survives a deck round trip and excludes other bindings", () => {
    const deck = sample();
    const element: Element = {
      id: "el-1",
      type: "shape",
      shape: "rounded",
      x: 60,
      y: 150,
      w: 420,
      h: 180,
      fill: "#ffffff",
      stroke: "#5b7fa6",
      strokeWidth: 1,
      text: "前の回答：予想シート（予想）",
      fontSize: 20,
      color: "#24425e",
      prevAnswer: parsePrevAnswerBinding(base),
    };
    deck.slides[0].elements.push(element);
    const back = parseDeck(serializeDeck(deck));
    expect(
      back.slides[0].elements.find((e) => e.id === "el-1")?.prevAnswer,
    ).toEqual(base);
    // A broken binding is dropped leniently, the element stays.
    const broken = sample();
    broken.slides[0].elements.push({
      ...element,
      id: "el-2",
      prevAnswer: { deckId: "bad" } as never,
    });
    const backBroken = parseDeck(serializeDeck(broken));
    expect(
      backBroken.slides[0].elements.find((e) => e.id === "el-2")?.prevAnswer,
    ).toBeUndefined();
    // Two bindings on one element are rejected.
    const clash = sample();
    clash.slides[0].elements.push({
      ...element,
      id: "el-3",
      worksheet: { deckId: DECK, worksheetId: WS } as never,
    });
    expect(() => parseDeck(serializeDeck(clash))).toThrow();
  });
});
