import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { blank } from "./model";
import {
  imageSources,
  visibleComments,
  assertMediaReferences,
  consumePendingAssets,
  pendingAssetSchema,
} from "./mediaVisibility";
it("uses all sheets and only active page IDs for participant comments", () => {
  const a = blank(0, 0),
    b = { ...blank(0, 0), sheetId: "second" };
  b.elements = [
    {
      id: "img",
      type: "image",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      src: "/api/decks/work/assets/photo",
    },
  ];
  const d = { version: 1 as const, title: "test", slides: [a, b] };
  const notes: any = [
    { slide: a.id, text: "current" },
    { slide: "deleted", text: "private" },
  ];
  expect(imageSources(d).has("/api/decks/work/assets/photo")).toBe(true);
  expect(visibleComments(d, notes, false).map((n) => n.text)).toEqual([
    "current",
  ]);
  expect(visibleComments(d, notes, true)).toEqual(notes);
});
it("permits a new upload and active references, but rejects image or note resurrection by ordinary editors", () => {
  const before = { version: 1 as const, title: "test", slides: [blank(0, 0)] };
  const image = {
    id: "img",
    type: "image" as const,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    src: "old",
  };
  const after = {
    ...before,
    slides: [{ ...before.slides[0], elements: [image] }],
  };
  expect(() =>
    assertMediaReferences(
      before,
      after,
      false,
      () => false,
      () => false,
    ),
  ).toThrow(/ホスト/);
  expect(() =>
    assertMediaReferences(
      before,
      after,
      false,
      () => true,
      () => false,
    ),
  ).not.toThrow();
  expect(() =>
    assertMediaReferences(
      after,
      after,
      false,
      () => false,
      () => false,
    ),
  ).not.toThrow();
  const resurrect = {
    ...before,
    slides: [...before.slides, { ...blank(0, 1), id: "retired" }],
  };
  expect(() =>
    assertMediaReferences(
      before,
      resurrect,
      false,
      () => false,
      (id) => id === "retired",
    ),
  ).toThrow(/ホスト/);
  expect(() =>
    assertMediaReferences(
      before,
      resurrect,
      true,
      () => false,
      () => true,
    ),
  ).not.toThrow();
});
it("consumes provisional upload access in the same transaction and preserves it on rollback", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE assets(id TEXT PRIMARY KEY);${pendingAssetSchema}`);
    const sql = (q: string, ...a: string[]) => db.prepare(q).all(...a);
    sql("INSERT INTO assets VALUES(?)", "one");
    sql("INSERT INTO pending_asset_access VALUES(?,?)", "one", "editor");
    db.exec("BEGIN");
    consumePendingAssets(sql, new Set(["/api/decks/work/assets/one"]));
    expect(sql("SELECT * FROM pending_asset_access")).toHaveLength(0);
    db.exec("ROLLBACK");
    expect(sql("SELECT * FROM pending_asset_access")).toHaveLength(1);
    consumePendingAssets(sql, new Set(["/api/decks/work/assets/one"]));
    expect(sql("SELECT * FROM pending_asset_access")).toHaveLength(0);
  } finally {
    db.close();
  }
});
