import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { HistorySQL } from "./historyStore";
import type { Slide } from "./model";
import { editSlideCommand, editSlideSchema } from "./editSlides";
import { deckGroups, groupCommand, groupSchema } from "./groups";
import { featureVersion } from "./featureVersions";
import {
  FeedbackError,
  feedbackAnswerFlags,
  feedbackCommand,
  feedbackList,
  feedbackReopenActive,
} from "./feedback";

const DECK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE decks(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT,name TEXT,email TEXT); CREATE TABLE members(deck TEXT,user_id TEXT); CREATE TABLE recipients(deck TEXT,user_id TEXT,rank INTEGER); CREATE TABLE assets(id TEXT,deck TEXT,hash TEXT,bytes INTEGER); CREATE TABLE blobs(hash TEXT,owner TEXT,bytes INTEGER); INSERT INTO decks VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd')",
  );
  db.exec(editSlideSchema);
  db.exec(groupSchema);
  const sql: HistorySQL = (query, ...args) =>
    db.prepare(query).all(...args) as Record<string, unknown>[];
  for (const [id, name] of [
    ["host", "先生"],
    ["ana", "生徒A"],
    ["bob", "生徒B"],
  ]) {
    db.prepare("INSERT INTO users VALUES(?,?,?)").run(id, name, `${id}@t`);
    db.prepare("INSERT INTO members VALUES(?,?)").run(DECK, id);
  }
  return { db, sql };
}

const editSlideAnswerUpdated = (
  sql: HistorySQL,
  defId: string,
  author: string,
) =>
  Number(
    [...sql("SELECT updated FROM edit_slide_answers WHERE def=? AND author=?", defId, author)][0]
      .updated,
  );

const slide = (text: string): Slide =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    x: 0,
    y: 0,
    title: "土台",
    background: "#ffffff",
    elements: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        type: "text",
        x: 10,
        y: 10,
        w: 300,
        h: 60,
        text,
        fontSize: 24,
        color: "#173d38",
      },
    ],
  }) as Slide;

/** A definition with ana's answer, intake closed. */
function closedDeckWithAnswer(sql: HistorySQL) {
  const created = editSlideCommand(sql, DECK, "host", true, "create", undefined, {
    source: "11111111-1111-4111-8111-111111111111",
    slide: slide("土台"),
  });
  const defId = created.createdId!;
  editSlideCommand(sql, DECK, "host", true, "status", defId, {
    status: "open",
  });
  editSlideCommand(sql, DECK, "ana", false, "answer", defId, {
    slide: slide(" anaの回答"),
    baseUpdated: 0,
  });
  editSlideCommand(sql, DECK, "host", true, "status", defId, {
    status: "closed",
  });
  return defId;
}

function send(
  sql: HistorySQL,
  defId: string,
  value: Record<string, unknown>,
  actor = "host",
  host = true,
) {
  return feedbackCommand(sql, DECK, actor, host, "send", {
    targetKind: "editslide",
    targetId: defId,
    owner: "ana",
    text: "よく見ました",
    stamp: "",
    ...value,
  });
}

describe("feedback (§4.3) for free-edit slides", () => {
  it("sends, lists per viewer, and marks read for the owner only", () => {
    const { sql } = fixture();
    const defId = closedDeckWithAnswer(sql);
    const before = featureVersion(sql, DECK, "editfeedback");
    const answersBefore = featureVersion(sql, DECK, "editanswers");
    send(sql, defId, { stamp: "よくできました" });
    expect(featureVersion(sql, DECK, "editfeedback")).toBeGreaterThan(before);
    // The console's answer overview moves too, so its cards can
    // refresh their flags without a reload.
    expect(featureVersion(sql, DECK, "editanswers")).toBeGreaterThan(
      answersBefore,
    );
    const mine = feedbackList(sql, DECK, "ana", false);
    expect(mine).toHaveLength(1);
    expect(mine[0].stamp).toBe("よくできました");
    expect(mine[0].readAt).toBeNull();
    // Another student never receives it; the host sees everything.
    expect(feedbackList(sql, DECK, "bob", false)).toHaveLength(0);
    expect(feedbackList(sql, DECK, "host", true)).toHaveLength(1);
    // Bob cannot mark ana's row read; ana can.
    feedbackCommand(sql, DECK, "bob", false, "read", { ids: [mine[0].id] });
    expect(feedbackList(sql, DECK, "ana", false)[0].readAt).toBeNull();
    // Marking read moves no poll counter: the reader gets the fresh
    // rows in the response, and the host need not re-read for it.
    const efBefore = featureVersion(sql, DECK, "editfeedback");
    const eaBefore = featureVersion(sql, DECK, "editanswers");
    feedbackCommand(sql, DECK, "ana", false, "read", { ids: [mine[0].id] });
    expect(feedbackList(sql, DECK, "ana", false)[0].readAt).not.toBeNull();
    expect(featureVersion(sql, DECK, "editfeedback")).toBe(efBefore);
    expect(featureVersion(sql, DECK, "editanswers")).toBe(eaBefore);
  });

  it("validates sender, stamp, length and emptiness", () => {
    const { sql } = fixture();
    const defId = closedDeckWithAnswer(sql);
    expect(() => send(sql, defId, {}, "ana", false)).toThrow(FeedbackError);
    expect(() => send(sql, defId, { stamp: "すごい" })).toThrow(/スタンプ/);
    expect(() => send(sql, defId, { text: "あ".repeat(201) })).toThrow(
      /200文字/,
    );
    expect(() => send(sql, defId, { text: "", stamp: "" })).toThrow(
      /コメントかスタンプ/,
    );
    expect(() =>
      send(sql, defId, { owner: "bob" }),
    ).toThrow(/回答が見つかりません/);
  });

  it("caps rows per answer and per deck", () => {
    const { sql } = fixture();
    const defId = closedDeckWithAnswer(sql);
    for (let i = 0; i < 50; i++) send(sql, defId, { text: `c${i}` });
    expect(() => send(sql, defId, {})).toThrow(/50件/);
    // Fill the deck cap directly, then a different answer (bob's,
    // on a second definition, with no rows of its own) hits the
    // deck cap rather than the per-answer one.
    const slide2 = slide("土台2");
    (slide2 as { id: string }).id = "33333333-3333-4333-8333-333333333333";
    const created2 = editSlideCommand(sql, DECK, "host", true, "create", undefined, {
      source: "33333333-3333-4333-8333-333333333333",
      slide: slide2,
    });
    const def2 = created2.createdId!;
    editSlideCommand(sql, DECK, "host", true, "status", def2, {
      status: "open",
    });
    editSlideCommand(sql, DECK, "bob", false, "answer", def2, {
      slide: slide("bobの回答"),
      baseUpdated: 0,
    });
    const now = Date.now();
    for (let i = 0; i < 4950; i++)
      sql(
        "INSERT INTO form_feedback VALUES(?,?,?,?,?,?,?,?,?,?)",
        `bulk-${i}`,
        DECK,
        "editslide",
        defId,
        "bob",
        "x",
        "",
        0,
        now,
        0,
      );
    expect(() =>
      feedbackCommand(sql, DECK, "host", true, "send", {
        targetKind: "editslide",
        targetId: def2,
        owner: "bob",
        text: "y",
        stamp: "",
      }),
    ).toThrow(/5,000件/);
  });

  it("a send-back lets only that student keep saving after close, until resubmit", () => {
    const { db, sql } = fixture();
    const defId = closedDeckWithAnswer(sql);
    const save = (actor: string, baseUpdated: number) =>
      editSlideCommand(sql, DECK, actor, false, "answer", defId, {
        slide: slide("書き直し"),
        baseUpdated,
      });
    const updated = () =>
      Number(
        db
          .prepare(
            "SELECT updated FROM edit_slide_answers WHERE def=? AND author='ana'",
          )
          .get(defId)?.updated,
      );
    // Closed: nobody saves.
    expect(() => save("ana", updated())).toThrow(/受付中ではない/);
    // Age the answer past the save rate limit before the reopen saves.
    db.prepare(
      "UPDATE edit_slide_answers SET updated=updated-10000 WHERE def=? AND author='ana'",
    ).run(defId);
    send(sql, defId, { text: "ここを直して", reopen: true });
    expect(feedbackReopenActive(sql, DECK, "editslide", defId, "ana")).toBe(
      true,
    );
    // Ana saves twice in a row (the send-back is not consumed);
    // bob (no answer, no send-back) still cannot.
    save("ana", updated());
    db.prepare(
      "UPDATE edit_slide_answers SET updated=updated-10000 WHERE def=? AND author='ana'",
    ).run(defId);
    save("ana", updated());
    expect(() => save("bob", 0)).toThrow(/受付中ではない/);
    // Resubmit closes the send-back; saving stops again, and the
    // console flag reports the resubmission.
    const eaBeforeResubmit = featureVersion(sql, DECK, "editanswers");
    feedbackCommand(sql, DECK, "ana", false, "resubmit", { targetId: defId });
    expect(featureVersion(sql, DECK, "editanswers")).toBeGreaterThan(
      eaBeforeResubmit,
    );
    expect(feedbackReopenActive(sql, DECK, "editslide", defId, "ana")).toBe(
      false,
    );
    expect(() => save("ana", updated())).toThrow(/受付中ではない/);
    expect(
      feedbackAnswerFlags(sql, DECK, "editslide", defId, "ana", updated()),
    ).toEqual({ reopen: false, resubmitted: true });
  });

  it("the host can cancel a send-back", () => {
    const { sql } = fixture();
    const defId = closedDeckWithAnswer(sql);
    send(sql, defId, { text: "直して", reopen: true });
    feedbackCommand(sql, DECK, "host", true, "cancel-reopen", {
      targetId: defId,
      owner: "ana",
    });
    expect(feedbackReopenActive(sql, DECK, "editslide", defId, "ana")).toBe(
      false,
    );
    expect(
      feedbackAnswerFlags(sql, DECK, "editslide", defId, "ana", 0),
    ).toEqual({ reopen: false, resubmitted: false });
  });

  it("deleting the definition removes its feedback", () => {
    const { sql } = fixture();
    const defId = closedDeckWithAnswer(sql);
    send(sql, defId, {});
    editSlideCommand(sql, DECK, "host", true, "delete", defId, {});
    expect(feedbackList(sql, DECK, "host", true)).toHaveLength(0);
  });
});

describe("feedback for group free-edit answers (stage 3b)", () => {
  it("reaches every member of the group, and a member can resubmit", () => {
    const { sql } = fixture();
    groupCommand(sql, DECK, "host", true, "create", undefined, {
      names: ["あか", "あお"],
    });
    const groups = deckGroups(sql, DECK);
    const aka = groups.find((g) => g.name === "あか")!;
    const ao = groups.find((g) => g.name === "あお")!;
    groupCommand(sql, DECK, "ana", false, "join", undefined, { groupId: aka.id });
    groupCommand(sql, DECK, "bob", false, "join", undefined, { groupId: ao.id });
    const created = editSlideCommand(sql, DECK, "host", true, "create", undefined, {
      source: "11111111-1111-4111-8111-111111111111",
      slide: slide("土台"),
      mode: "group",
    });
    const defId = created.createdId!;
    editSlideCommand(sql, DECK, "host", true, "status", defId, { status: "open" });
    editSlideCommand(sql, DECK, "ana", false, "answer", defId, {
      slide: slide("あかの回答"),
      baseUpdated: 0,
    });
    editSlideCommand(sql, DECK, "host", true, "status", defId, { status: "closed" });
    feedbackCommand(sql, DECK, "host", true, "send", {
      targetKind: "editslide",
      targetId: defId,
      owner: aka.id,
      text: "班のみんなで直してね",
      stamp: "",
      reopen: true,
    });
    // The group's member sees it; the other group's member does not.
    const anaRows = feedbackList(sql, DECK, "ana", false).filter(
      (f) => f.targetId === defId,
    );
    expect(anaRows).toHaveLength(1);
    expect(anaRows[0].reopen).toBe(1);
    expect(
      feedbackList(sql, DECK, "bob", false).filter((f) => f.targetId === defId),
    ).toHaveLength(0);
    // The send-back re-opens saving for the group, and any member
    // can close it by resubmitting. (Age the first save past the
    // rapid-save limit first.)
    sql("UPDATE edit_slide_answers SET updated=updated-10000 WHERE def=?", defId);
    editSlideCommand(sql, DECK, "ana", false, "answer", defId, {
      slide: slide("直した"),
      baseUpdated: editSlideAnswerUpdated(sql, defId, aka.id),
    });
    feedbackCommand(sql, DECK, "ana", false, "resubmit", { targetId: defId });
    expect(
      feedbackList(sql, DECK, "ana", false).find((f) => f.targetId === defId)
        ?.reopen,
    ).toBe(2);
  });
});
