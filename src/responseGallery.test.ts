import { expect, it } from "vitest";
import { blank } from "./model";
import { galleryCommand } from "./responseGallery";
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
