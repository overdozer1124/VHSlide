import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { HistorySQL } from "./historyStore";
import type { Slide } from "./model";
import {
  EditSlideError,
  editAnswerAsset,
  editSlideAnswersMeta,
  editSlideSchema,
  editSlideCommand,
  followShareView,
  galleryShareViews,
  recordEditAnswerAsset,
  removeEditShare,
  takeEditShare,
} from "./editSlides";

const DECK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SOURCE = "11111111-1111-4111-8111-111111111111";
const PHOTO = "99999999-9999-4999-8999-999999999999";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE decks(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT,name TEXT,email TEXT); CREATE TABLE members(deck TEXT,user_id TEXT); CREATE TABLE recipients(deck TEXT,user_id TEXT,rank INTEGER); CREATE TABLE assets(id TEXT,deck TEXT,hash TEXT,bytes INTEGER); CREATE TABLE blobs(hash TEXT,owner TEXT,bytes INTEGER); INSERT INTO decks VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd')",
  );
  db.exec(editSlideSchema);
  const sql: HistorySQL = (query, ...args) =>
    db.prepare(query).all(...args) as Record<string, unknown>[];
  const people: [string, string, number][] = [
    ["host", "先生", 9],
    ["ana", "生徒A", 0],
    ["bob", "生徒B", 1],
  ];
  for (const [id, name, rank] of people) {
    db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, name, `${id}@t`);
    db.prepare("INSERT INTO members VALUES(?,?)").run(DECK, id);
    db.prepare("INSERT INTO recipients VALUES(?,?,?)").run(DECK, id, rank);
  }
  return { db, sql };
}

const baseSlide = (): Slide =>
  ({
    id: SOURCE,
    x: 0,
    y: 0,
    title: "土台",
    background: "#ffffff",
    elements: [
      {
        id: "t1",
        type: "text",
        x: 10,
        y: 10,
        w: 300,
        h: 60,
        text: "ここから作ろう",
        fontSize: 24,
        color: "#173d38",
      },
    ],
  }) as unknown as Slide;

function makeDef(sql: HistorySQL) {
  const created = editSlideCommand(sql, DECK, "host", true, "create", undefined, {
    source: SOURCE,
    slide: baseSlide(),
  });
  const id = created.createdId!;
  editSlideCommand(sql, DECK, "host", true, "status", id, {
    status: "open",
  });
  return id;
}

const answerSlide = (defId: string, text: string, photo = false): Slide =>
  ({
    id: SOURCE,
    x: 0,
    y: 0,
    title: "ぼくのスライド",
    background: "#ffffff",
    elements: [
      {
        id: "t1",
        type: "text",
        x: 10,
        y: 10,
        w: 300,
        h: 60,
        text,
        fontSize: 24,
        color: "#173d38",
      },
      ...(photo
        ? [
            {
              id: "p1",
              type: "image",
              x: 400,
              y: 10,
              w: 200,
              h: 150,
              src: `/api/decks/${DECK}/edit-slides/${defId}/answer-assets/${PHOTO}`,
            },
          ]
        : []),
    ],
  }) as unknown as Slide;

const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as EditSlideError).status;
  }
  return 0;
};

describe("edit-slide shares (stage 2b)", () => {
  it("follow snapshot is frozen, and its photo stays readable only while shared", () => {
    const { db, sql } = fixture();
    const defId = makeDef(sql);
    recordEditAnswerAsset(sql, DECK, "ana", defId, PHOTO, "hash-p", 500, "image/png");
    // First save establishes the answer; later saves need the
    // current updated stamp.
    editSlideCommand(sql, DECK, "ana", false, "answer", defId, {
      slide: answerSlide(defId, "v1", true),
      baseUpdated: 0,
    });
    const saveAs = (text: string, photo: boolean) => {
      // Age the previous save past the 1.5s save interval.
      db.prepare(
        "UPDATE edit_slide_answers SET updated=updated-10000 WHERE def=? AND author='ana'",
      ).run(defId);
      const row = [
        ...sql(
          "SELECT updated FROM edit_slide_answers WHERE def=? AND author='ana'",
          defId,
        ),
      ][0];
      editSlideCommand(sql, DECK, "ana", false, "answer", defId, {
        slide: answerSlide(defId, text, photo),
        baseUpdated: Number(row.updated),
      });
    };

    takeEditShare(sql, DECK, true, defId, "ana", "follow", true);
    const view = followShareView(sql, DECK, defId, "ana");
    expect(view?.name).toBe("生徒A");
    expect(JSON.stringify(view?.slide)).toContain("v1");

    // The student edits on: the snapshot does not move, and the
    // photo it uses survives the answer dropping it (past grace).
    db.prepare(
      "UPDATE edit_slide_answer_assets SET created=0 WHERE asset=?",
    ).run(PHOTO);
    saveAs("v2", false);
    expect(JSON.stringify(followShareView(sql, DECK, defId, "ana")?.slide)).toContain("v1");
    expect(
      [...sql("SELECT asset FROM edit_slide_answer_assets WHERE asset=?", PHOTO)].length,
    ).toBe(1);
    // Another student may read the photo only because it is shared.
    expect(editAnswerAsset(sql, DECK, "bob", false, defId, PHOTO).hash).toBe("hash-p");

    // Taking the share down ends both the view and the photo access;
    // the next save collects the photo at last.
    removeEditShare(sql, DECK, true, defId, { follow: true });
    expect(followShareView(sql, DECK, defId, "ana")).toBeUndefined();
    expect(status(() => editAnswerAsset(sql, DECK, "bob", false, defId, PHOTO))).toBe(404);
    saveAs("v3", false);
    expect(
      [...sql("SELECT asset FROM edit_slide_answer_assets WHERE asset=?", PHOTO)].length,
    ).toBe(0);
  });

  it("follow is one per deck; gallery is per answer and feeds the meta flag", () => {
    const { sql } = fixture();
    const defId = makeDef(sql);
    for (const author of ["ana", "bob"])
      editSlideCommand(sql, DECK, author, false, "answer", defId, {
        slide: answerSlide(defId, `${author}の答え`),
        baseUpdated: 0,
      });
    takeEditShare(sql, DECK, true, defId, "ana", "follow", false);
    expect(followShareView(sql, DECK, defId, "ana")?.name).toBeUndefined();
    takeEditShare(sql, DECK, true, defId, "bob", "follow", false);
    expect(followShareView(sql, DECK, defId, "ana")).toBeUndefined();
    expect(followShareView(sql, DECK, defId, "bob")).toBeDefined();

    takeEditShare(sql, DECK, true, defId, "ana", "gallery", true);
    const views = galleryShareViews(sql, DECK, SOURCE);
    expect(views.length).toBe(1);
    expect(views[0].name).toBe("生徒A");
    const meta = editSlideAnswersMeta(sql, DECK, "host", true).find(
      (m) => m.id === defId,
    );
    expect(meta?.answers.find((a) => a.author === "ana")?.shared).toBe(true);
    expect(meta?.answers.find((a) => a.author === "bob")?.shared).toBeUndefined();
    removeEditShare(sql, DECK, true, defId, { author: "ana" });
    expect(galleryShareViews(sql, DECK, SOURCE).length).toBe(0);
  });

  it("only the host shares, and only existing answers", () => {
    const { sql } = fixture();
    const defId = makeDef(sql);
    editSlideCommand(sql, DECK, "ana", false, "answer", defId, {
      slide: answerSlide(defId, "答え"),
      baseUpdated: 0,
    });
    expect(
      status(() => takeEditShare(sql, DECK, false, defId, "ana", "follow", false)),
    ).toBe(403);
    expect(
      status(() => takeEditShare(sql, DECK, true, defId, "bob", "gallery", false)),
    ).toBe(404);
  });
});
