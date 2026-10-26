import { expect, it } from "vitest";
import { blank, moveRowGroup, removeRowGroup, type Deck } from "./model";
import { axisGrant } from "./axes";
import { defaultAccess } from "./permissions";
import { assignmentReadiness } from "./assignmentReadiness";
it("distinguishes absent pages, deleted stable axes, viewing and another sheet without creating data", () => {
  const book: Deck = {
    version: 1,
    title: "準備",
    slides: [blank(0, 0), blank(0, 1)],
    sheets: [
      { id: "main", name: "シート1" },
      { id: "other", name: "別シート" },
    ],
  };
  const access = {
    ...defaultAccess(),
    mode: "scoped" as const,
    rows: [axisGrant(book, "main", "rows", 9)],
  };
  const before = JSON.stringify(book);
  expect(assignmentReadiness(book, access)).toMatchObject({
    kind: "waiting",
    pageIds: [],
    pending: ["シート1・10行目"],
  });
  expect(JSON.stringify(book)).toBe(before);
  expect(assignmentReadiness(book, defaultAccess()).kind).toBe("view");
  access.rows = [axisGrant(book, "main", "rows", 0)];
  const moved = moveRowGroup(book, 0, 1);
  expect(assignmentReadiness(moved, access).pageIds).toEqual([
    book.slides[0].id,
  ]);
  expect(assignmentReadiness(removeRowGroup(moved, 1), access).kind).toBe(
    "deleted",
  );
  expect(assignmentReadiness(book, access, "other")).toMatchObject({
    pageIds: [],
    otherSheets: [{ id: "main", name: "シート1", count: 1 }],
  });
});
