import { expect, it } from "vitest";
import * as Y from "yjs";
import { blank, parseDeck, type Element, type Deck } from "./model";
import { shapeIds } from "./shapeCatalog";
import {
  resizeElementFromHandle,
  resizeBoxFromHandle,
  objectsInSelection,
  arrangeElements,
  translateElements,
  resizeElement,
  duplicateObjects,
  moveLinePoint,
  canDistribute,
} from "./objectEditing";
import {
  createSharedDeck,
  applyDeckChange,
  readSharedDeck,
  sharedText,
  LOCAL_CHANGE,
} from "./sharedDeck";
import { backupSnapshot } from "./backupData";
import { createBackupArchive, readBackupArchive } from "./backupArchive";
const shape = (id = "a", x = 40, y = 40): Element => ({
  id,
  type: "shape",
  shape: "triangle",
  x,
  y,
  w: 100,
  h: 80,
  fill: "none",
  stroke: "#173d38",
  text: "図形",
  fontSize: 24,
  color: "#173d38",
  textAlign: "center",
  verticalAlign: "middle",
});
const deck = (elements: Element[]): Deck => ({
  version: 1,
  title: "表現",
  slides: [{ ...blank(0, 0), elements }],
});
it("round trips every palette shape, styles and line via JSON and ZIP v1", async () => {
  const d = deck([
    ...shapeIds.map((s, i) => ({
      ...shape(String(i)),
      shape: s,
      rotation: 90 as const,
      flipX: true,
      opacity: 0.5,
      strokeWidth: 3,
      strokeDash: "dash" as const,
    })),
    {
      ...shape("line"),
      type: "line",
      text: undefined,
      shape: undefined,
      lineKind: "curve",
      lineStart: { x: 0, y: 100 },
      lineEnd: { x: 100, y: 0 },
      startArrow: "circle",
      endArrow: "triangle",
    },
  ]);
  const parsed = parseDeck(JSON.stringify(d));
  expect(parsed.slides[0].elements).toHaveLength(26);
  const s = backupSnapshot(parsed, [], [], []);
  const zip = await createBackupArchive(s, async () => {
    throw Error("no images");
  });
  expect((await readBackupArchive(zip)).snapshot.deck).toEqual(parsed);
  for (const patch of [
    { strokeWidth: 21 },
    { rotation: 45 },
    { opacity: 1.1 },
    { shape: "<svg>" },
    { lineEnd: { x: 101, y: 0 }, type: "line" },
  ])
    expect(() =>
      parseDeck(JSON.stringify(deck([{ ...shape(), ...patch } as Element]))),
    ).toThrow();
});
it("moves and duplicates selections atomically inside the canvas", () => {
  const es = [shape("a", 40, 40), shape("b", 180, 80)];
  const moved = translateElements(es, -100, 700);
  expect(moved.map((e) => [e.x, e.y])).toEqual([
    [0, 420],
    [140, 460],
  ]);
  const copied = duplicateObjects(es, ["a", "b"]);
  expect(new Set(copied.elements.map((e) => e.id)).size).toBe(4);
  expect(copied.elements[2].x).toBe(60);
  expect(es[0].x).toBe(40);
});
it("aligns, distributes and moves layers preserving selected order", () => {
  const es = [shape("a", 20), shape("b", 150), shape("c", 400)];
  expect(
    arrangeElements(es, ["a", "b", "c"], "horizontal").map((e) => e.x),
  ).toEqual([20, 210, 400]);
  expect(canDistribute(es, "horizontal")).toBe(true);
  expect(canDistribute([shape(), shape("b"), shape("c")], "horizontal")).toBe(
    false,
  );
  expect(arrangeElements(es, ["a"], "center")[0].x).toBe(430);
  expect(arrangeElements(es, ["a", "b"], "right")[0].x).toBe(150);
  expect(arrangeElements(es, ["a", "b"], "forward").map((e) => e.id)).toEqual([
    "c",
    "a",
    "b",
  ]);
  expect(arrangeElements(es, ["b", "c"], "backward").map((e) => e.id)).toEqual([
    "b",
    "c",
    "a",
  ]);
});
it("keeps proportions during locked resize and quarter rotation, normalizes line endpoints", () => {
  const e = { ...shape(), w: 800, h: 100 };
  const rotated = arrangeElements([e], [e.id], "rotateRight")[0];
  expect(rotated.h).toBe(540);
  expect(rotated.w).toBe(67.5);
  expect(rotated.rotation).toBe(90);
  const thin = arrangeElements(
    [{ ...shape(), x: 0, y: 0, w: 960, h: 20 }],
    ["a"],
    "rotateRight",
  )[0];
  expect(thin).toMatchObject({ w: 20, h: 540 });
  expect(() => parseDeck(JSON.stringify(deck([thin])))).not.toThrow();
  const resized = resizeElement({ ...shape(), aspectLocked: true }, 200, 80);
  expect(resized.w / resized.h).toBe(1.25);
  const line = {
    ...shape(),
    type: "line" as const,
    lineStart: { x: 0, y: 50 },
    lineEnd: { x: 100, y: 50 },
  };
  const moved = moveLinePoint(line, "end", 960, 540);
  expect(moved.x + (moved.w * moved.lineEnd!.x) / 100).toBe(960);
  expect(moved.y + (moved.h * moved.lineEnd!.y) / 100).toBe(540);
  expect(arrangeElements([line], [line.id], "rotateRight")[0]).toMatchObject({
    rotation: 0,
    lineStart: { x: 50, y: 0 },
    lineEnd: { x: 50, y: 100 },
  });
});
it("merges concurrent shape label edits and undoes only local geometry", () => {
  const d = deck([shape()]),
    a = createSharedDeck(d),
    b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const undo = new Y.UndoManager(a.getMap("slides"), {
    trackedOrigins: new Set([LOCAL_CHANGE]),
  });
  const next = structuredClone(d);
  next.slides[0].elements[0].x = 200;
  applyDeckChange(a, d, next);
  sharedText(b, d.slides[0].id, "a")!.insert(0, "他者 ");
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), "server");
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "server");
  expect(readSharedDeck(a)).toEqual(readSharedDeck(b));
  undo.undo();
  expect(readSharedDeck(a).slides[0].elements[0]).toMatchObject({
    x: 40,
    text: "他者 図形",
  });
});
it("concurrent typing into a new empty shape label merges rather than replacing the other writer", () => {
  const d = deck([{ ...shape(), text: "" }]),
    a = createSharedDeck(d),
    b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  sharedText(a, d.slides[0].id, "a")!.insert(0, "A");
  sharedText(b, d.slides[0].id, "a")!.insert(0, "B");
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), "server");
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "server");
  expect(readSharedDeck(a)).toEqual(readSharedDeck(b));
  expect(readSharedDeck(a).slides[0].elements[0].text).toMatch(/^(AB|BA)$/);
});

it("marquee selects intersecting bounds independent of drag direction and ignores empty regions", () => {
  const es = [
    { id: "a", type: "shape", x: 10, y: 20, w: 100, h: 50 },
    { id: "b", type: "text", x: 200, y: 30, w: 40, h: 40 },
  ] as Element[];
  expect(objectsInSelection(es, { x: 0, y: 0, w: 150, h: 100 })).toEqual(["a"]);
  expect(objectsInSelection(es, { x: 90, y: 40, w: 150, h: 20 })).toEqual([
    "a",
    "b",
  ]);
  expect(objectsInSelection(es, { x: 90, y: 40, w: 0, h: 0 })).toEqual([]);
  expect(objectsInSelection(es, { x: 300, y: 200, w: 20, h: 30 })).toEqual([]);
});

it("resizes each edge and corner around the opposite stationary anchor", () => {
  const box = { x: 100, y: 100, w: 200, h: 120 };
  for (const direction of [
    "n",
    "ne",
    "e",
    "se",
    "s",
    "sw",
    "w",
    "nw",
  ] as const) {
    const r = resizeBoxFromHandle(box, direction, 20, 10);
    if (direction.includes("w")) expect(r.x + r.w).toBe(300);
    else if (direction.includes("e")) expect(r.x).toBe(100);
    else expect([r.x, r.w]).toEqual([100, 200]);
    if (direction.includes("n")) expect(r.y + r.h).toBe(220);
    else if (direction.includes("s")) expect(r.y).toBe(100);
    else expect([r.y, r.h]).toEqual([100, 120]);
    expect(r.w).toBe(
      direction.includes("w") ? 180 : direction.includes("e") ? 220 : 200,
    );
    expect(r.h).toBe(
      direction.includes("n") ? 110 : direction.includes("s") ? 130 : 120,
    );
  }
});
it("clamps west/north/east/south resizing without crossing or moving the opposite edge", () => {
  const b = { x: 100, y: 100, w: 200, h: 120 };
  expect(resizeBoxFromHandle(b, "nw", -1000, -1000)).toEqual({
    x: 0,
    y: 0,
    w: 300,
    h: 220,
  });
  expect(resizeBoxFromHandle(b, "nw", 1000, 1000)).toEqual({
    x: 280,
    y: 200,
    w: 20,
    h: 20,
  });
  expect(resizeBoxFromHandle(b, "se", 1000, 1000)).toEqual({
    x: 100,
    y: 100,
    w: 860,
    h: 440,
  });
});
it("locked images keep ratio and opposite corner; side drags keep the perpendicular centre", () => {
  const e = { ...shape(), x: 100, y: 100, w: 200, h: 100, aspectLocked: true };
  expect(resizeElementFromHandle(e, "nw", -40, -20)).toMatchObject({
    x: 60,
    y: 80,
    w: 240,
    h: 120,
  });
  expect(resizeElementFromHandle(e, "e", 40, 0)).toMatchObject({
    x: 100,
    y: 90,
    w: 240,
    h: 120,
  });
  const limited = resizeElementFromHandle(e, "w", -1000, 0);
  expect(limited.x).toBeGreaterThanOrEqual(0);
  expect(limited.x + limited.w).toBe(300);
  expect(limited.w / limited.h).toBe(2);
});
