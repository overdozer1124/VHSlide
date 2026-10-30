import { idleFollow, transitionFollow, publicFollow } from "./hostFollow";
import { addGuestPage } from "./guestPages";
import { blank, parseDeck } from "./model";
import { applyDeckChange } from "./sharedDeck";
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { sample } from "./model";
import { createSharedDeck, readSharedDeck, sharedText } from "./sharedDeck";
import { applyAuthorizedUpdate } from "./authorizeUpdate";
import {
  defaultAccess,
  parseAccess,
  canEdit,
  assertDeckAccess,
} from "./permissions";
const all = { ...defaultAccess(), mode: "all" as const };
function change(doc: Y.Doc, operation: (doc: Y.Doc) => void) {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(doc));
  readSharedDeck(client);
  const vector = Y.encodeStateVector(client);
  operation(client);
  const update = Y.encodeStateAsUpdate(client, vector),
    candidate = new Y.Doc();
  Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
  return { update, candidate, client };
}
describe("host and scoped editing", () => {
  it("separates sheets, combines row/column/page grants, and rejects malformed permission input", () => {
    const s = sample().slides[0],
      access = {
        ...defaultAccess(),
        mode: "scoped" as const,
        rows: [{ sheetId: "main", index: 0 }],
        slides: ["chosen"],
      };
    expect(canEdit(access, s)).toBe(true);
    expect(canEdit(access, { ...s, sheetId: "other" })).toBe(false);
    expect(canEdit(access, { ...s, id: "chosen", sheetId: "other" })).toBe(
      true,
    );
    expect(() =>
      parseAccess({ ...access, rows: [{ sheetId: "main", index: -1 }] }),
    ).toThrow();
    expect(() => parseAccess({ ...access, mode: "owner" })).toThrow();
  });
  it("accepts authorized rich text but denies changes to protected text and mixed batches", () => {
    const deck = sample(),
      doc = createSharedDeck(deck),
      s = deck.slides[0],
      locked = deck.slides[1];
    const access = {
      ...defaultAccess(),
      mode: "scoped" as const,
      slides: [s.id],
    };
    const edit = change(doc, (c) =>
      sharedText(c, s.id, s.elements[0].id)!.insert(0, "自分"),
    );
    expect(() =>
      applyAuthorizedUpdate(doc, edit.candidate, edit.update, access, false),
    ).not.toThrow();
    const attack = change(doc, (c) => {
      sharedText(c, s.id, s.elements[0].id)!.insert(0, "自分");
      sharedText(c, locked.id, locked.elements[0].id)!.delete(0, 1);
    });
    expect(() =>
      applyAuthorizedUpdate(
        doc,
        attack.candidate,
        attack.update,
        access,
        false,
      ),
    ).toThrow();
    expect(readSharedDeck(doc)).toEqual(readSharedDeck(createSharedDeck(deck)));
  });
  it("denies deck settings even for all-slide clients, hidden roots and deferred CRDT payloads", () => {
    const deck = sample(),
      doc = createSharedDeck(deck);
    for (const operation of [
      (c: Y.Doc) => c.getText("title").insert(0, "変更"),
      (c: Y.Doc) => c.getMap("future-permissions").set("owner", true),
    ]) {
      const a = change(doc, operation);
      expect(() =>
        applyAuthorizedUpdate(doc, a.candidate, a.update, all, false),
      ).toThrow();
    }
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(doc));
    readSharedDeck(client);
    const t = sharedText(
      client,
      deck.slides[0].id,
      deck.slides[0].elements[0].id,
    )!;
    t.insert(0, "first");
    const vector = Y.encodeStateVector(client);
    t.insert(1, "deferred");
    const candidate = new Y.Doc();
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
    expect(() =>
      applyAuthorizedUpdate(
        doc,
        candidate,
        Y.encodeStateAsUpdate(client, vector),
        all,
        false,
      ),
    ).toThrow();
  });
  it("denies moving granted slides into a protected range and changing other slides through grid collisions", () => {
    const deck = sample(),
      s = deck.slides[0],
      access = {
        ...defaultAccess(),
        mode: "scoped" as const,
        rows: [{ sheetId: "main", index: 0 }],
      };
    expect(() =>
      assertDeckAccess(
        deck,
        {
          ...deck,
          slides: deck.slides.map((p) => (p.id === s.id ? { ...p, y: 5 } : p)),
        },
        access,
        false,
      ),
    ).toThrow();
    const doc = createSharedDeck(deck),
      a = change(doc, (c) => {
        (c.getMap("slides").get(s.id) as Y.Map<unknown>).set("position", {
          x: 0,
          y: 1,
        });
      });
    expect(() =>
      applyAuthorizedUpdate(
        doc,
        a.candidate,
        a.update,
        { ...all, mode: "scoped", slides: [s.id] },
        false,
      ),
    ).toThrow();
  });
});

it("reserves map headings and account-name settings for the host even with full slide editing access", () => {
  const book = sample();
  book.sheets = [{ id: "main", name: "シート1" }];
  const changed = structuredClone(book);
  changed.sheets![0].rowLabels = { 0: "変更" };
  changed.sheets![0].showRowAccounts = true;
  expect(() => assertDeckAccess(book, changed, all, false)).toThrow();
  expect(() => assertDeckAccess(book, changed, all, true)).not.toThrow();
});

it("only the host changes the enforced guest display policy", () => {
  const before = sample(),
    after = { ...before, restrictGuests: true };
  expect(() => assertDeckAccess(before, after, all, false)).toThrow();
  expect(() => assertDeckAccess(before, after, all, true)).not.toThrow();
});
it("Yjs preserves the policy and rejects a guest removing it", () => {
  const book = { ...sample(), restrictGuests: true },
    doc = createSharedDeck(book);
  expect(readSharedDeck(doc).restrictGuests).toBe(true);
  const update = change(doc, (d) =>
    d.getMap("settings").set("restrictGuests", false),
  );
  expect(() =>
    applyAuthorizedUpdate(doc, update.candidate, update.update, all, false),
  ).toThrow();
  doc.destroy();
});

describe("guest page creation policy", () => {
  const book = () => ({
    version: 1 as const,
    title: "assigned",
    restrictGuests: true,
    slides: [
      ...Array.from({ length: 3 }, (_, x) => ({ ...blank(x, 0), id: `a${x}` })),
      ...Array.from({ length: 3 }, (_, x) => ({ ...blank(x, 1), id: `b${x}` })),
    ],
  });
  const row = {
    ...defaultAccess(),
    mode: "scoped" as const,
    rows: [{ sheetId: "main", index: 0 }],
  };
  it("defaults to append and inserts in the assigned row only without altering axes", () => {
    const b = book();
    const appended = addGuestPage(b, row, "main", 3, 0, "new");
    expect(appended.slides.at(-1)?.x).toBe(3);
    expect(appended.slides.slice(0, 6)).toEqual(b.slides);
    expect(() => addGuestPage(b, row, "main", 1, 0)).toThrow();
    const inserting = { ...b, guestPageCreation: "insert" as const };
    const result = addGuestPage(inserting, row, "main", 1, 0, "new");
    expect(result.slides.filter((s) => s.y === 1)).toEqual(
      b.slides.filter((s) => s.y === 1),
    );
    expect(result.slides.find((s) => s.id === "a1")?.x).toBe(2);
    expect(result.slides.find((s) => s.id === "a2")?.x).toBe(3);
    expect(result.sheets).toBeUndefined();
  });
  it("rejects disabled creation, tampered policy, middle append, protected shifts and scope escapes", () => {
    const b = book();
    expect(() =>
      addGuestPage({ ...b, guestPageCreation: "none" }, row, "main", 3, 0),
    ).toThrow();
    expect(() =>
      assertDeckAccess(b, { ...b, guestPageCreation: "insert" }, row, false),
    ).toThrow();
    expect(() =>
      assertDeckAccess(
        b,
        {
          ...b,
          slides: [
            ...b.slides.filter((s) => s.id !== "a1"),
            { ...blank(1, 0), id: "forged" },
          ],
        },
        row,
        false,
      ),
    ).toThrow();
    expect(() =>
      addGuestPage(
        { ...b, guestPageCreation: "insert" },
        { ...row, rows: [], columns: [{ sheetId: "main", index: 0 }] },
        "main",
        1,
        0,
      ),
    ).toThrow();
    expect(() =>
      addGuestPage(b, { ...row, rows: [], slides: ["a0"] }, "main", 3, 0),
    ).toThrow();
    expect(() => addGuestPage(b, row, "main", 3, 1)).toThrow();
    expect(() => addGuestPage(b, row, "main", 100, 0)).toThrow();
  });
  it("persists policy through JSON/Yjs and enforces it against forged Yjs updates", () => {
    const b = { ...book(), guestPageCreation: "none" as const };
    expect(parseDeck(JSON.stringify(b)).guestPageCreation).toBe("none");
    const server = createSharedDeck(b);
    expect(readSharedDeck(server).guestPageCreation).toBe("none");
    const fake = change(server, (client) => {
      const before = readSharedDeck(client);
      applyDeckChange(client, before, {
        ...before,
        slides: [...before.slides, { ...blank(3, 0), id: "forged" }],
      });
    });
    expect(() =>
      applyAuthorizedUpdate(server, fake.candidate, fake.update, row, false),
    ).toThrow();
    const policy = change(server, (client) =>
      client.getMap("settings").set("guestPageCreation", "insert"),
    );
    expect(() =>
      applyAuthorizedUpdate(
        server,
        policy.candidate,
        policy.update,
        row,
        false,
      ),
    ).toThrow();
    applyAuthorizedUpdate(server, policy.candidate, policy.update, all, true);
    Y.applyUpdate(server, policy.update);
    expect(readSharedDeck(server).guestPageCreation).toBe("insert");
    const approved = change(server, (client) => {
      const before = readSharedDeck(client);
      applyDeckChange(
        client,
        before,
        addGuestPage(before, row, "main", 1, 0, "inserted"),
      );
    });
    applyAuthorizedUpdate(
      server,
      approved.candidate,
      approved.update,
      row,
      false,
    );
    Y.applyUpdate(server, approved.update);
    expect(readSharedDeck(server).slides.some((s) => s.id === "inserted")).toBe(
      true,
    );
  });
});

it("speaker note edits respect the same slide permissions", () => {
  const b = sample(),
    access = {
      ...defaultAccess(),
      mode: "scoped" as const,
      slides: [b.slides[0].id],
    };
  expect(() =>
    assertDeckAccess(
      b,
      {
        ...b,
        slides: b.slides.map((s, i) =>
          i ? s : { ...s, speakerNotes: "担当のメモ" },
        ),
      },
      access,
      false,
    ),
  ).not.toThrow();
  expect(() =>
    assertDeckAccess(
      b,
      {
        ...b,
        slides: b.slides.map((s, i) =>
          i === 1 ? { ...s, speakerNotes: "他の人のメモ" } : s,
        ),
      },
      access,
      false,
    ),
  ).toThrow();
});

it("follow control state rejects guests and stale sessions while retaining stable targets", () => {
  const b = sample(),
    target = { mode: "page", sheetId: "main", pageId: b.slides[0].id },
    actor = {
      host: true,
      connection: "socket-a",
      user: { id: "owner", name: "先生" },
    };
  expect(() =>
    transitionFollow(
      idleFollow(),
      { id: "a", action: "start", target },
      { ...actor, host: false },
      b,
    ),
  ).toThrow();
  const running = transitionFollow(
    idleFollow(),
    { id: "a", action: "start", target },
    actor,
    b,
    100,
    "session-a",
  );
  expect(running.active).toBe(true);
  expect(publicFollow(running)).not.toHaveProperty("controller");
  expect(() =>
    transitionFollow(
      running,
      { id: "b", action: "move", sessionId: "session-a", target },
      { ...actor, connection: "socket-b" },
      b,
    ),
  ).toThrow();
  const ended = transitionFollow(
    running,
    { id: "b", action: "stop", sessionId: "session-a" },
    { ...actor, connection: "socket-b" },
    b,
  );
  const next = transitionFollow(
    ended,
    { id: "c", action: "start", target },
    actor,
    b,
    200,
    "session-b",
  );
  expect(() =>
    transitionFollow(
      next,
      { id: "late", action: "stop", sessionId: "session-a" },
      actor,
      b,
    ),
  ).toThrow();
  expect(() =>
    transitionFollow(
      idleFollow(),
      {
        id: "bad",
        action: "start",
        target: { mode: "page", sheetId: "main", pageId: "missing" },
      },
      actor,
      b,
    ),
  ).toThrow();
  expect(next.revision).toBe(3);
});
