import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { emptyInkImage } from "./InkObject";
import type { HistorySQL } from "./historyStore";
import type { Slide } from "./model";
import {
  EditSlideError,
  editAnswerAsset,
  editSlideAnswerContent,
  editSlideAnswersMeta,
  editSlideSchema,
  editSlideCommand,
  editSlideList,
  recordEditAnswerAsset,
  sanitizeEditBase,
} from "./editSlides";
import { featureVersion } from "./featureVersions";

const DECK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ASSET_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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
    db.prepare("INSERT INTO members VALUES(?,?)").run("dddddddd-dddd-4ddd-8ddd-dddddddddddd", id);
    db.prepare("INSERT INTO recipients VALUES(?,?,?)").run("dddddddd-dddd-4ddd-8ddd-dddddddddddd", id, rank);
  }
  db.prepare("INSERT INTO assets VALUES(?,?,?,?)").run(
    ASSET_A,
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    "hash-a",
    1000,
  );
  db.prepare("INSERT INTO assets VALUES(?,?,?,?)").run(
    ASSET_B,
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    "hash-b",
    1000,
  );
  db.prepare("INSERT INTO blobs VALUES(?,?,?)").run("hash-a", "host", 1000);
  db.prepare("INSERT INTO blobs VALUES(?,?,?)").run("hash-b", "ana", 1000);
  db.prepare("INSERT INTO assets VALUES(?,?,?,?)").run(ASSET_C, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "hash-c", 1000);
  db.prepare("INSERT INTO blobs VALUES(?,?,?)").run("hash-c", "ana", 1000);
  return { db, sql };
}

const baseSlide = (): Slide =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    x: 0,
    y: 0,
    title: "土台",
    background: "#ffffff",
    speakerNotes: "先生だけのメモ",
    elements: [
      {
        id: "t1",
        type: "text",
        x: 10,
        y: 10,
        w: 300,
        h: 60,
        text: "ここから作ろう", fontSize: 24, color: "#173d38",
        link: { url: "https://example.com" },
      },
      {
        id: "w1",
        type: "shape",
        shape: "rect",
        x: 10,
        y: 100,
        w: 200,
        h: 100,
        fill: "#ffffff", stroke: "#000000",
        worksheet: { deckId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", worksheetId: "ws", title: "t", description: "", fields: [] },
      },
      {
        id: "p1",
        type: "image",
        x: 400,
        y: 10,
        w: 200,
        h: 150,
        src: `/api/decks/dddddddd-dddd-4ddd-8ddd-dddddddddddd/assets/${ASSET_A}`,
      },
    ],
  }) as unknown as Slide;

function makeDef(sql: HistorySQL) {
  const created = editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "host", true, "create", undefined, {
    source: "11111111-1111-4111-8111-111111111111",
    slide: baseSlide(),
  });
  const id = created.createdId!;
  editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "host", true, "status", id, { status: "open" });
  return id;
}

const answerSlide = (extra: Record<string, unknown> = {}): Slide =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    x: 0,
    y: 0,
    title: "ぼくのスライド",
    background: "#ffffff",
    elements: [
      { id: "t1", type: "text", x: 10, y: 10, w: 300, h: 60, text: "ぼくの答え", fontSize: 24, color: "#173d38" },
    ],
    ...extra,
  }) as unknown as Slide;

const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as EditSlideError).status;
  }
  return 0;
};

describe("edit slides: ink placeholder", () => {
  it("pins the module's data: exception to InkObject's emptyInkImage", () => {
    expect(emptyInkImage).toBe(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    );
  });
  it("accepts a hand-drawing layer in an answer", () => {
    const { sql } = fixture();
    const id = makeDef(sql);
    editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "answer", id, {
      slide: answerSlide({
        elements: [
          {
            id: "ink1",
            type: "image",
            x: 100,
            y: 100,
            w: 480,
            h: 270,
            src: emptyInkImage,
            drawing: [],
            stroke: "#173d38",
            strokeWidth: 5,
          },
        ],
      }),
      baseUpdated: 0,
    });
  });
});

describe("edit slides: base snapshot", () => {
  it("strips speaker notes, learning parts and links from the base", () => {
    const base = sanitizeEditBase(baseSlide());
    expect(base.speakerNotes).toBeUndefined();
    expect(base.elements.find((e) => e.id === "t1")?.link).toBeUndefined();
    expect(base.elements.find((e) => e.id === "w1")?.worksheet).toBeUndefined();
    expect(base.elements.find((e) => e.id === "p1")?.src).toContain(ASSET_A);
  });
  it("only the host can create, change status, or delete", () => {
    const { sql } = fixture();
    expect(
      status(() =>
        editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "create", undefined, {
          source: "11111111-1111-4111-8111-111111111111",
          slide: baseSlide(),
        }),
      ),
    ).toBe(403);
    const id = makeDef(sql);
    expect(
      status(() =>
        editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "status", id, { status: "closed" }),
      ),
    ).toBe(403);
    expect(
      status(() => editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "delete", id, {})),
    ).toBe(403);
  });
});

describe("edit slides: answers", () => {
  it("saves an own answer only while open, and lists it back", () => {
    const { sql } = fixture();
    const id = makeDef(sql);
    const before = editSlideList(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false)[0];
    expect(before.mine).toBeUndefined();
    editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "answer", id, {
      slide: answerSlide(),
      baseUpdated: 0,
    });
    const after = editSlideList(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false)[0];
    expect(after.mine?.slide.elements[0].text).toBe("ぼくの答え");
    // The list itself never carries anyone's answer content: the
    // host's overview is metadata only, on the separate function.
    const hostView = editSlideList(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "host", true)[0];
    expect(JSON.stringify(hostView)).not.toContain("ぼくの答え");
    const meta = editSlideAnswersMeta(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "host", true)[0];
    expect(meta.answers.map((a) => a.name)).toEqual(["生徒A"]);
    expect(meta.uncreated).toEqual([{ name: "生徒B" }]);
    expect(JSON.stringify(meta)).not.toContain("ぼくの答え");
    // Students get no overview at all.
    expect(editSlideAnswersMeta(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false)).toEqual([]);
    // Content is fetched per answer: host and author may, others not.
    expect(
      editSlideAnswerContent(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "host", true, id, "ana").slide
        .elements[0].text,
    ).toBe("ぼくの答え");
    expect(
      editSlideAnswerContent(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, id, "ana").updated,
    ).toBe(after.mine!.updated);
    expect(
      status(() =>
        editSlideAnswerContent(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "bob", false, id, "ana"),
      ),
    ).toBe(404);
    // Another student never sees Ana's answer in the list either.
    const bobView = editSlideList(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "bob", false)[0];
    expect(bobView.mine).toBeUndefined();
    expect(JSON.stringify(bobView)).not.toContain("ぼくの答え");
    // Closed definitions refuse saves.
    editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "host", true, "status", id, { status: "closed" });
    expect(
      status(() =>
        editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "bob", false, "answer", id, {
          slide: answerSlide(),
          baseUpdated: 0,
        }),
      ),
    ).toBe(403);
  });

  it("refuses stale saves with 409 and rapid saves with 429", () => {
    const { sql, db } = fixture();
    const id = makeDef(sql);
    editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "answer", id, {
      slide: answerSlide(),
      baseUpdated: 0,
    });
    expect(
      status(() =>
        editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "answer", id, {
          slide: answerSlide(),
          baseUpdated: 0,
        }),
      ),
    ).toBe(409);
    const updated = Number(
      db.prepare("SELECT updated FROM edit_slide_answers WHERE def=?").get(id)!
        .updated,
    );
    expect(
      status(() =>
        editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "answer", id, {
          slide: answerSlide(),
          baseUpdated: updated,
        }),
      ),
    ).toBe(429);
    db.prepare("UPDATE edit_slide_answers SET updated=? WHERE def=?").run(
      updated - 10_000,
      id,
    );
    editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "answer", id, {
      slide: answerSlide(),
      baseUpdated: updated - 10_000,
    });
  });

  it("rejects learning parts, embeds, links, notes and foreign photos", () => {
    const { sql } = fixture();
    const id = makeDef(sql);
    const save = (slide: unknown) => () =>
      editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "answer", id, {
        slide,
        baseUpdated: 0,
      });
    const withElement = (element: Record<string, unknown>) =>
      answerSlide({
        elements: [
          { id: "x1", type: "text", x: 0, y: 0, w: 100, h: 40, text: "x", fontSize: 20, color: "#173d38", ...element },
        ],
      });
    expect(status(save(withElement({ worksheet: { deckId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", worksheetId: "w", title: "", description: "", fields: [] } })))).toBe(400);
    expect(status(save(withElement({ survey: { deckId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", surveyId: "s" } })))).toBe(400);
    expect(status(save(withElement({ embed: { url: "https://www.youtube.com/embed/x" } })))).toBe(400);
    expect(status(save(withElement({ link: { url: "https://example.com" } })))).toBe(400);
    expect(status(save(answerSlide({ speakerNotes: "メモ" })))).toBe(400);
    expect(
      status(
        save(
          answerSlide({
            elements: [
              { id: "i1", type: "image", x: 0, y: 0, w: 100, h: 80, src: "data:image/png;base64,AAAA" },
            ],
          }),
        ),
      ),
    ).toBe(400);
    // Bob's recorded answer photo cannot be used by Ana.
    recordEditAnswerAsset(sql, DECK, "bob", id, ASSET_B, "hash-b", 1000, "image/png");
    expect(
      status(
        save(
          answerSlide({
            elements: [
              { id: "i1", type: "image", x: 0, y: 0, w: 100, h: 80, src: `/api/decks/dddddddd-dddd-4ddd-8ddd-dddddddddddd/edit-slides/${id}/answer-assets/${ASSET_B}` },
            ],
          }),
        ),
      ),
    ).toBe(400);
    // The base snapshot's photo and Ana's own recorded photo are fine.
    recordEditAnswerAsset(sql, DECK, "ana", id, ASSET_C, "hash-c", 1000, "image/png");
    editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "answer", id, {
      slide: answerSlide({
        elements: [
          { id: "i1", type: "image", x: 0, y: 0, w: 100, h: 80, src: `/api/decks/dddddddd-dddd-4ddd-8ddd-dddddddddddd/assets/${ASSET_A}` },
          { id: "i2", type: "image", x: 0, y: 100, w: 100, h: 80, src: `/api/decks/dddddddd-dddd-4ddd-8ddd-dddddddddddd/edit-slides/${id}/answer-assets/${ASSET_C}` },
        ],
      }),
      baseUpdated: 0,
    });
  });

  it("caps one answer at 256KB with a 413", () => {
    const { sql } = fixture();
    const id = makeDef(sql);
    const big = answerSlide({
      elements: Array.from({ length: 60 }, (_, i) => ({
        id: `t${i}`,
        type: "text",
        x: 0,
        y: 0,
        w: 100,
        h: 40,
        text: "あ".repeat(5000), fontSize: 20, color: "#173d38",
      })),
    });
    expect(
      status(() =>
        editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "answer", id, {
          slide: big,
          baseUpdated: 0,
        }),
      ),
    ).toBe(413);
  });

  it("keeps a just-uploaded photo through an unreferencing save (grace)", () => {
    const { sql } = fixture();
    const id = makeDef(sql);
    recordEditAnswerAsset(sql, DECK, "ana", id, ASSET_C, "hash-c", 1000, "image/png");
    const result = editSlideCommand(sql, DECK, "ana", false, "answer", id, {
      slide: answerSlide(),
      baseUpdated: 0,
    });
    expect(result.orphanAssets).toEqual([]);
    // The author and the host can read it; another student cannot.
    expect(editAnswerAsset(sql, DECK, "ana", false, id, ASSET_C).hash).toBe("hash-c");
    expect(editAnswerAsset(sql, DECK, "host", true, id, ASSET_C).hash).toBe("hash-c");
    expect(status(() => editAnswerAsset(sql, DECK, "bob", false, id, ASSET_C))).toBe(404);
  });

  it("deletes unreferenced answer photos on save and reports orphans", () => {
    const { sql } = fixture();
    const id = makeDef(sql);
    recordEditAnswerAsset(sql, DECK, "ana", id, ASSET_C, "hash-c", 1000, "image/png");
    // Age the upload past the grace window so the save collects it.
    sql("UPDATE edit_slide_answer_assets SET created=? WHERE asset=?", Date.now() - 600_000, ASSET_C);
    editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "answer", id, {
      slide: answerSlide({
        elements: [
          { id: "i2", type: "image", x: 0, y: 100, w: 100, h: 80, src: `/api/decks/dddddddd-dddd-4ddd-8ddd-dddddddddddd/edit-slides/${id}/answer-assets/${ASSET_C}` },
        ],
      }),
      baseUpdated: 0,
    });
    const updated = editSlideList(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false)[0].mine!.updated;
    // Rewind the clock so the rapid-save guard lets the next save in.
    sql("UPDATE edit_slide_answers SET updated=? WHERE def=?", updated - 10_000, id);
    const result = editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "ana", false, "answer", id, {
      slide: answerSlide(),
      baseUpdated: updated - 10_000,
    });
    expect(result.orphanAssets).toEqual([{ asset: ASSET_C, hash: "hash-c" }]);
    // Deleting the definition reports every remaining answer photo.
    recordEditAnswerAsset(sql, DECK, "ana", id, ASSET_C, "hash-c", 1000, "image/png");
    const deleted = editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "host", true, "delete", id, {});
    expect(deleted.orphanAssets).toEqual([{ asset: ASSET_C, hash: "hash-c" }]);
    expect(editSlideList(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "host", true)).toEqual([]);
  });

  it("limits recorded answer photos to 10 and requires an open def", () => {
    const { sql } = fixture();
    const id = makeDef(sql);
    for (let i = 0; i < 10; i++) {
      const asset = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      recordEditAnswerAsset(sql, DECK, "ana", id, asset, `h${i}`, 10, "image/png");
    }
    const extra = "00000000-0000-4000-8000-000000000010";
    expect(status(() => recordEditAnswerAsset(sql, DECK, "ana", id, extra, "hx", 10, "image/png"))).toBe(400);
    editSlideCommand(sql, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "host", true, "status", id, { status: "closed" });
    expect(status(() => recordEditAnswerAsset(sql, DECK, "bob", id, extra, "hx", 10, "image/png"))).toBe(403);
  });
});

describe("edit slides: poll counters and visibility", () => {
  it("answer saves bump only the host-console counter, never the shared one", () => {
    const { sql } = fixture();
    const id = makeDef(sql);
    const sharedBefore = featureVersion(sql, DECK, "editslides");
    const consoleBefore = featureVersion(sql, DECK, "editanswers");
    editSlideCommand(sql, DECK, "ana", false, "answer", id, {
      slide: answerSlide(),
      baseUpdated: 0,
    });
    expect(featureVersion(sql, DECK, "editslides")).toBe(sharedBefore);
    expect(featureVersion(sql, DECK, "editanswers")).toBe(consoleBefore + 1);
    // Definition changes are what the shared counter is for.
    editSlideCommand(sql, DECK, "host", true, "status", id, { status: "closed" });
    expect(featureVersion(sql, DECK, "editslides")).toBe(sharedBefore + 1);
  });

  it("hides draft definitions from students until the host opens them", () => {
    const { sql } = fixture();
    const created = editSlideCommand(sql, DECK, "host", true, "create", undefined, {
      source: "11111111-1111-4111-8111-111111111111",
      slide: baseSlide(),
    });
    expect(editSlideList(sql, DECK, "ana", false)).toEqual([]);
    expect(editSlideList(sql, DECK, "host", true)).toHaveLength(1);
    editSlideCommand(sql, DECK, "host", true, "status", created.createdId!, { status: "open" });
    expect(editSlideList(sql, DECK, "ana", false)).toHaveLength(1);
    editSlideCommand(sql, DECK, "host", true, "status", created.createdId!, { status: "closed" });
    expect(editSlideList(sql, DECK, "ana", false)).toHaveLength(1);
  });

  it("counts the 256KB cap in stored bytes, not characters", () => {
    const { sql } = fixture();
    const id = makeDef(sql);
    // ~120k characters of Japanese: under the cap as a character
    // count, well over it as stored bytes (3 bytes per character).
    const wide = answerSlide({
      elements: Array.from({ length: 30 }, (_, i) => ({
        id: `t${i}`,
        type: "text",
        x: 0,
        y: 0,
        w: 100,
        h: 40,
        text: "あ".repeat(4000), fontSize: 20, color: "#173d38",
      })),
    });
    expect(
      status(() =>
        editSlideCommand(sql, DECK, "ana", false, "answer", id, {
          slide: wide,
          baseUpdated: 0,
        }),
      ),
    ).toBe(413);
  });

  it("refuses a base carrying another deck's photo, at creation time", () => {
    const { sql } = fixture();
    const foreign = baseSlide();
    (foreign.elements[2] as { src: string }).src =
      `/api/decks/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/assets/${ASSET_A}`;
    expect(
      status(() =>
        editSlideCommand(sql, DECK, "host", true, "create", undefined, {
          source: "11111111-1111-4111-8111-111111111111",
          slide: foreign,
        }),
      ),
    ).toBe(400);
    expect(() =>
      editSlideCommand(sql, DECK, "host", true, "create", undefined, {
        source: "11111111-1111-4111-8111-111111111111",
        slide: foreign,
      }),
    ).toThrow("ほかの作品の写真が含まれています。");
  });
});
