import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { blank } from "./model";
import { galleryBuild, galleryCommand } from "./responseGallery";
import { worksheetTemplate } from "./worksheetTemplates";
import type { HistorySQL } from "./historyStore";

it("reads and removes a gallery saved in the original single-slide format", () => {
  const slide = blank(0, 0);
  const snapshot = { slide, cards: [], names: false, live: false, created: 1 };
  let row: Record<string, string> | undefined = {
    slide: JSON.stringify(slide),
    config: JSON.stringify({ participants: null, names: false, live: false }),
    snapshot: JSON.stringify(snapshot),
  };
  const sql: HistorySQL = (query) => {
    if (query.startsWith("SELECT * FROM response_gallery"))
      return row ? [row] : [];
    if (query.startsWith("DELETE FROM response_gallery")) row = undefined;
    return [];
  };
  const read = galleryCommand(sql, "deck", "guest", false, "read", {});
  expect(read.gallery).toEqual(snapshot);
  expect(read.galleries).toEqual([snapshot]);
  expect(
    galleryCommand(sql, "deck", "host", true, "stop", { slideId: slide.id })
      .galleries,
  ).toEqual([]);
  expect(
    galleryCommand(sql, "deck", "guest", false, "read", {}).gallery,
  ).toBeNull();
});

describe("gallery card order", () => {
  it("follows the account order (recipient rank), not respondent ids or answer time", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE worksheets(id TEXT,deck TEXT,definition TEXT,status TEXT,created INTEGER); CREATE TABLE worksheet_answers(worksheet TEXT,author TEXT,value TEXT,updated INTEGER); CREATE TABLE surveys(id TEXT,deck TEXT,definition TEXT,status TEXT,created INTEGER); CREATE TABLE survey_answers(survey TEXT,author TEXT,value TEXT,updated INTEGER); CREATE TABLE survey_chart_publications(survey TEXT); CREATE TABLE users(id TEXT,name TEXT,email TEXT); CREATE TABLE members(deck TEXT,user_id TEXT); CREATE TABLE recipients(deck TEXT,user_id TEXT,rank INTEGER)",
    );
    const sql: HistorySQL = (query, ...args) =>
      db.prepare(query).all(...args) as Record<string, unknown>[];
    const field = { ...worksheetTemplate("blank").fields[0], id: "memo" };
    db.prepare("INSERT INTO worksheets VALUES(?,?,?,?,?)").run(
      "sheet",
      "deck",
      JSON.stringify({ title: "質問", description: "", fields: [field] }),
      "open",
      1,
    );
    // Account order is b (rank 0), c (rank 1), a (rank 2); the ids and
    // the answer times both run in the opposite direction on purpose.
    // d has no recipient row and falls back to member registration order.
    const people: [string, string, number | null, number][] = [
      ["a-user", "生徒A", 2, 100],
      ["b-user", "生徒B", 0, 300],
      ["c-user", "生徒C", 1, 200],
      ["d-user", "生徒D", null, 400],
    ];
    for (const [id, name, rank, updated] of people) {
      db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, name, `${id}@test`);
      db.prepare("INSERT INTO members VALUES(?,?)").run("deck", id);
      if (rank !== null)
        db.prepare("INSERT INTO recipients VALUES(?,?,?)").run("deck", id, rank);
      db.prepare("INSERT INTO worksheet_answers VALUES(?,?,?,?)").run(
        "sheet",
        id,
        JSON.stringify({ memo: `${name}の回答` }),
        updated,
      );
    }
    const slide = {
      ...blank(0, 0),
      id: "s1",
      elements: [
        {
          id: "el",
          type: "shape" as const,
          x: 0,
          y: 0,
          w: 100,
          h: 100,
          fill: "#ffffff",
          stroke: "#000000",
          worksheet: {
            deckId: "deck",
            worksheetId: "sheet",
            title: "質問",
            description: "",
            fields: [field],
          },
        },
      ],
    };
    const gallery = galleryBuild(
      sql,
      "deck",
      "host",
      slide,
      { participants: null, names: true, live: false },
      true,
    );
    expect(gallery.cards.map((c) => c.name)).toEqual([
      "生徒B",
      "生徒C",
      "生徒A",
      "生徒D",
    ]);
  });
});
