import { expect, it } from "vitest";
import * as Y from "yjs";
import { blank, parseDeck, type Deck, type Element } from "./model";
import { createDiagram, createChartElement } from "./diagramTemplates";
import { parseChart } from "./chartData";
import {
  anchorPoint,
  endpoint,
  resolveConnections,
  copyElements,
  copyPages,
  expandGroups,
  groupElements,
  ungroupElements,
  removeObjects,
  movableElements,
  nearestAnchor,
} from "./structureData";
import {
  arrangeStructured,
  resizeSelection,
  resizeSelectionFromHandle,
} from "./structuredEditing";
import {
  createSharedDeck,
  readSharedDeck,
  applyDeckChange,
  LOCAL_CHANGE,
} from "./sharedDeck";
import { applyAuthorizedUpdate } from "./authorizeUpdate";
import { defaultAccess } from "./permissions";
import { backupSnapshot } from "./backupData";
import { createBackupArchive, readBackupArchive } from "./backupArchive";
let serial = 0;
const id = () => `structure-${++serial}`;
const shape = (name: string, x: number, y = 100): Element => ({
  id: name,
  type: "shape",
  shape: "rect",
  x,
  y,
  w: 100,
  h: 80,
  fill: "#ffffff",
  stroke: "#173d38",
});
const book = (elements: Element[]): Deck => ({
  version: 1,
  title: "構造の検証",
  slides: [{ ...blank(0, 0), id: "page-a", elements }],
});
const diagram = () => resolveConnections(createDiagram("process", id));
it("accepts old JSON and all editable templates/charts; rejects unsafe and malformed structure data", () => {
  for (const kind of ["compare", "process", "timeline"] as const)
    expect(
      parseDeck(JSON.stringify(book(createDiagram(kind, id)))).slides[0]
        .elements.length,
    ).toBeGreaterThan(4);
  for (const kind of ["bar", "line", "pie"] as const)
    expect(
      parseDeck(JSON.stringify(book([createChartElement(kind, id)]))).slides[0]
        .elements[0].chart?.kind,
    ).toBe(kind);
  expect(
    parseDeck(JSON.stringify(book([shape("old", 20)]))).slides[0].elements[0]
      .groupId,
  ).toBeUndefined();
  const c = createChartElement("bar", id).chart!;
  for (const bad of [
    { ...c, kind: "html" },
    { ...c, series: [{ ...c.series[0], value: Infinity }] },
    { ...c, kind: "pie", series: [{ ...c.series[0], value: -1 }] },
    { ...c, series: [c.series[0], c.series[0]] },
    { ...c, series: [{ ...c.series[0], color: "url(x)" }] },
  ])
    expect(() => parseChart(bad)).toThrow();
  const es = diagram(),
    line = es.find((e) => e.type === "line")!;
  for (const ref of [
    { elementId: line.id, side: "right" },
    { elementId: "x", side: "evil" },
  ])
    expect(() =>
      parseDeck(
        JSON.stringify(
          book(
            es.map((e) =>
              e.id === line.id
                ? { ...e, startAnchor: ref as Element["startAnchor"] }
                : e,
            ),
          ),
        ),
      ),
    ).toThrow();
  expect(() =>
    parseDeck(
      JSON.stringify(book([{ ...shape("s", 20), link: { slideId: "" } }])),
    ),
  ).toThrow();
});
it("connectors follow transformed local targets, survive missing targets, freeze on deletion and detach on independent move", () => {
  const es = diagram(),
    node = es.find((e) => e.type === "shape")!,
    line = es.find((e) => e.type === "line")!;
  const moved = resolveConnections(
    es.map((e) =>
      e.id === node.id
        ? { ...e, x: e.x + 30, rotation: 90 as const, flipX: true }
        : e,
    ),
  );
  expect(
    endpoint(
      moved.find((e) => e.id === line.id)!,
      "start",
    ),
  ).toEqual(
    anchorPoint(
      moved.find((e) => e.id === node.id)!,
      "right",
    ),
  );
  const removed = removeObjects(moved, [node.id]),
    frozen = removed.find((e) => e.id === line.id)!;
  expect(frozen.startAnchor).toBeUndefined();
  expect(endpoint(frozen, "start")).toEqual(
    endpoint(
      moved.find((e) => e.id === line.id)!,
      "start",
    ),
  );
  expect(movableElements(moved, [line.id])[0].startAnchor).toBeUndefined();
  expect(movableElements(moved, [line.id, node.id])[0].startAnchor).toEqual(
    line.startAnchor,
  );
  expect(
    resolveConnections([
      {
        ...line,
        startAnchor: { elementId: "foreign", side: "top" },
        endAnchor: undefined,
      },
    ])[0].lineStart,
  ).toEqual(line.lineStart);
  const a = shape("under", 20),
    b = { ...a, id: "over" };
  expect(nearestAnchor([a, b], "line", 20, 140, 10)?.elementId).toBe("over");
});
it("persistent groups expand, align/resize/layer as a unit and can be edited and ungrouped", () => {
  const a = shape("a", 100),
    b = shape("b", 300),
    other = shape("other", 600);
  const grouped = groupElements([a, other, b], [a.id, b.id], id),
    ids = [a.id, b.id];
  expect(grouped.map((e) => e.id)).toEqual(["other", "a", "b"]);
  expect(expandGroups(grouped, [a.id])).toEqual(ids);
  const left = arrangeStructured(grouped, ids, "left");
  expect(left.find((e) => e.id === "a")!.x).toBe(0);
  expect(left.find((e) => e.id === "b")!.x).toBe(200);
  const resized = resizeSelection(
    grouped.filter((e) => ids.includes(e.id)),
    150,
    40,
  );
  expect(resized.map((e) => [e.x, e.w])).toEqual([
    [100, 50],
    [200, 50],
  ]);
  expect(arrangeStructured(grouped, ids, "back").map((e) => e.id)).toEqual([
    "a",
    "b",
    "other",
  ]);
  expect(arrangeStructured(grouped, ["a"], "front").map((e) => e.id)).toEqual([
    "other",
    "b",
    "a",
  ]);
  const rotated = arrangeStructured(grouped, ids, "rotateRight");
  expect(rotated.find((e) => e.id === "a")!.rotation).toBe(90);
  expect(rotated.find((e) => e.id === "a")!.y).toBeLessThan(
    rotated.find((e) => e.id === "b")!.y,
  );
  expect(ungroupElements(grouped, [a.id]).every((e) => !e.groupId)).toBe(true);
});
it("cloning remaps group, anchor, point and copied-page links without leaking graph references", () => {
  const es = diagram(),
    line = es.find((e) => e.type === "line")!,
    chart = createChartElement("bar", id);
  es[0].link = { slideId: "page-a" };
  const d = book([...es, chart]),
    clone = copyPages(d.slides, id)[0];
  expect(clone.id).not.toBe("page-a");
  expect(clone.elements[0].link!.slideId).toBe(clone.id);
  expect(clone.elements[0].groupId).not.toBe(es[0].groupId);
  const l = clone.elements.find((e) => e.type === "line")!;
  expect(clone.elements.some((e) => e.id === l.startAnchor!.elementId)).toBe(
    true,
  );
  expect(clone.elements.at(-1)!.chart!.series[0].id).not.toBe(
    chart.chart!.series[0].id,
  );
  const alone = copyElements(es, [line.id], id)[0];
  expect(alone.startAnchor).toBeUndefined();
  expect(alone.groupId).toBeUndefined();
  expect(endpoint(alone, "start")).toEqual(endpoint(line, "start"));
  const external = copyPages(
    [
      {
        ...d.slides[0],
        elements: [{ ...chart, link: { slideId: "other-page" } }],
      },
    ],
    id,
  )[0];
  expect(external.elements[0].link?.slideId).toBe("other-page");
});
it("chart fields/points converge independently and own undo keeps a remote change", () => {
  const d = book([createChartElement("bar", id)]),
    a = createSharedDeck(d),
    b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const undo = new Y.UndoManager(a.getMap("slides"), {
    trackedOrigins: new Set([LOCAL_CHANGE]),
  });
  const da = structuredClone(d),
    db = structuredClone(d);
  da.slides[0].elements[0].chart!.series[0].value = 77;
  db.slides[0].elements[0].chart!.series[1].label = "相手";
  applyDeckChange(a, d, da);
  applyDeckChange(b, d, db);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), "server");
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), "server");
  expect(readSharedDeck(a)).toEqual(readSharedDeck(b));
  expect(readSharedDeck(a).slides[0].elements[0].chart!.series[0].value).toBe(
    77,
  );
  expect(readSharedDeck(a).slides[0].elements[0].chart!.series[1].label).toBe(
    "相手",
  );
  undo.undo();
  expect(readSharedDeck(a).slides[0].elements[0].chart!.series[0].value).toBe(
    d.slides[0].elements[0].chart!.series[0].value,
  );
  expect(readSharedDeck(a).slides[0].elements[0].chart!.series[1].label).toBe(
    "相手",
  );
  a.destroy();
  b.destroy();
  undo.destroy();
});
it("concurrent point deletion does not resurrect stale data or create invalid empty charts", () => {
  const d = book([createChartElement("bar", id)]);
  d.slides[0].elements[0].chart!.series =
    d.slides[0].elements[0].chart!.series.slice(0, 2);
  const a = createSharedDeck(d),
    b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const da = structuredClone(d),
    db = structuredClone(d);
  da.slides[0].elements[0].chart!.series.splice(0, 1);
  db.slides[0].elements[0].chart!.series.splice(1, 1);
  applyDeckChange(a, d, da);
  applyDeckChange(b, d, db);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  expect(readSharedDeck(a).slides[0].elements[0].chart!.series).toEqual([]);
  expect(() => parseDeck(JSON.stringify(readSharedDeck(a)))).not.toThrow();
  a.destroy();
  b.destroy();
});
it("new structure edits obey server-side scoped and read-only permissions", () => {
  const d = book(diagram()),
    server = createSharedDeck(d);
  const c = new Y.Doc();
  Y.applyUpdate(c, Y.encodeStateAsUpdate(server));
  const state = Y.encodeStateVector(c),
    after = structuredClone(d);
  after.slides[0].elements.push(createChartElement("bar", id));
  applyDeckChange(c, d, after);
  const update = Y.encodeStateAsUpdate(c, state);
  const candidate = new Y.Doc();
  Y.applyUpdate(candidate, Y.encodeStateAsUpdate(server));
  expect(() =>
    applyAuthorizedUpdate(server, candidate, update, defaultAccess(), false),
  ).toThrow();
  const outside = new Y.Doc();
  Y.applyUpdate(outside, Y.encodeStateAsUpdate(server));
  expect(() =>
    applyAuthorizedUpdate(
      server,
      outside,
      update,
      { ...defaultAccess(), mode: "scoped", slides: ["elsewhere"] },
      false,
    ),
  ).toThrow();
  outside.destroy();
  const allowed = new Y.Doc();
  Y.applyUpdate(allowed, Y.encodeStateAsUpdate(server));
  expect(() =>
    applyAuthorizedUpdate(
      server,
      allowed,
      update,
      { ...defaultAccess(), mode: "scoped", slides: [d.slides[0].id] },
      false,
    ),
  ).not.toThrow();
  expect(readSharedDeck(allowed).slides[0].elements.at(-1)!.type).toBe("chart");
  candidate.destroy();
  allowed.destroy();
  server.destroy();
  c.destroy();
});
it("ZIP version 1 roundtrip keeps chart data, groups, anchors and internal links", async () => {
  const d = book([...diagram(), createChartElement("pie", id)]);
  d.slides[0].elements[0].link = { slideId: d.slides[0].id };
  const snap = backupSnapshot(d, [], [], []);
  const bytes = await createBackupArchive(snap, async () => {
    throw Error("no images");
  });
  const loaded = await readBackupArchive(bytes);
  expect(loaded.snapshot.deck).toEqual(d);
});

it("group west/north resizing preserves opposite bounds and minimum member sizes", () => {
  const es = [
    { ...shape("a", 100), y: 100, w: 100, h: 80 },
    { ...shape("b", 300), y: 100, w: 100, h: 80 },
  ];
  const result = resizeSelectionFromHandle(es, "nw", -75, -20);
  expect(Math.max(...result.map((e) => e.x + e.w))).toBe(400);
  expect(Math.max(...result.map((e) => e.y + e.h))).toBe(180);
  expect(result[0].w / result[0].h).toBe(100 / 80);
  expect(
    Math.min(
      ...resizeSelectionFromHandle(es, "nw", 10000, 10000).map((e) => e.w),
    ),
  ).toBeGreaterThanOrEqual(20);
});
