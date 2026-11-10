import { describe, expect, it } from "vitest";
import type { Deck, Slide } from "./model";
import { idleFollow, type FollowState } from "./hostFollow";
import {
  consoleDefaultSheet,
  consoleInitialSlide,
  consoleSlides,
  fieldAnswered,
} from "./teacherConsole";

const slide = (id: string, x: number, y: number, sheetId?: string): Slide => ({
  id,
  x,
  y,
  sheetId,
  title: id,
  background: "#fff",
  elements: [],
});
const deck: Deck = {
  version: 1,
  title: "t",
  activeSheetId: "main",
  sheets: [
    { id: "main", name: "メイン" },
    { id: "sub", name: "サブ" },
  ],
  slides: [
    slide("b", 1, 0),
    slide("a", 0, 0),
    slide("c", 0, 1),
    slide("z", 0, 0, "sub"),
  ],
};
const followTo = (pageId: string): FollowState => ({
  active: true,
  revision: 1,
  sessionId: "s",
  controller: "c",
  host: { id: "h", name: "先生" },
  startedAt: 0,
  updatedAt: 0,
  expiresAt: 0,
  target: { mode: "page", sheetId: "main", pageId },
});

describe("teacher console helpers", () => {
  it("orders a sheet's slides across rows first, then down", () => {
    expect(consoleSlides(deck, "main").map((s) => s.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(consoleSlides(deck, "sub").map((s) => s.id)).toEqual(["z"]);
  });

  it("opens on the followed sheet and focuses the projected slide", () => {
    expect(consoleDefaultSheet(deck, followTo("a"))).toBe("main");
    expect(consoleInitialSlide(deck, followTo("b"))).toBe("b");
  });

  it("falls back to the first slide when nothing is projected", () => {
    expect(consoleInitialSlide(deck, idleFollow())).toBe("a");
  });

  it("counts real answers per field kind", () => {
    expect(fieldAnswered({ t: " かいた " }, "t")).toBe(true);
    expect(fieldAnswered({ t: "  " }, "t")).toBe(false);
    expect(fieldAnswered({ c: true }, "c")).toBe(true);
    expect(fieldAnswered({ c: false }, "c")).toBe(false);
    expect(fieldAnswered({ r: [null, 3] }, "r")).toBe(true);
    expect(fieldAnswered({ r: [null, null] }, "r")).toBe(false);
    expect(fieldAnswered(undefined, "t")).toBe(false);
  });
});
