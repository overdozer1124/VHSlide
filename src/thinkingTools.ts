import type { HistorySQL } from "./historyStore.ts";
import { effectiveGroupId } from "./groups.ts";
import { featureVersionSchema, versionTriggers } from "./featureVersions.ts";

/** Thinking tools (思考ツール): teacher-placed surfaces students write on.
 *
 * Stage 1 covers the "point" kind: a learner places a point on axes, a
 * line, an emotion meter or a two-part ratio circle. Every scene (場面)
 * keeps its own point, so how a learner's thinking moved stays visible.
 * Stage 2 adds the "board" kind: cards written into the zones of a
 * chart (Venn diagrams, Y/X/W/T charts, PMI, a 2x2 matrix, KWL). A
 * board written by the whole class is ONE shared board (plan §4.1.2) —
 * unlike point tools, where a class tool still keys points per learner.
 * A tool is written by an individual, by a group (班) or by the whole
 * class, mirroring the worksheet/webbing permission shape: the shared
 * command enforces everything server-side for both servers.
 */
export type ThinkingKind = "point" | "board";
export type ThinkingTemplate =
  | "axis2"
  | "axis1"
  | "emotion"
  | "ratio"
  | "venn2"
  | "venn3"
  | "ychart"
  | "xchart"
  | "wchart"
  | "tchart"
  | "pmi"
  | "matrix"
  | "kwl";
export type ThinkingUnit = "individual" | "group" | "class";
export type ThinkingStatus = "draft" | "open" | "closed";
export type ThinkingScale = "none" | "s5" | "s10";

export type ThinkingScene = { id: string; label: string };
/** One zone （区切り） of a board template. The ids and geometry come
 * from BOARD_ZONE_SPECS; the teacher edits only the labels. */
export type ThinkingZone = { id: string; label: string };
/** A card colour and the meaning the teacher gave it (e.g. yellow =
 * 自分の考え). The colour is one of CARD_COLORS. */
export type ThinkingCardColor = { color: string; label: string };
export type ThinkingDefinition = {
  title: string;
  /** Axis end labels. x is used by axis2/axis1/emotion, y by axis2. */
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  scale: ThinkingScale;
  /** axis1/emotion: draw the line vertically (温度計). */
  vertical: boolean;
  /** ratio: the two feelings/parts whose share is shown. */
  nameA: string;
  nameB: string;
  /** Board templates: the zone labels (ids fixed per template). */
  zones: ThinkingZone[];
  /** Board templates: what each card colour means (may be empty). */
  cardColors: ThinkingCardColor[];
  scenes: ThinkingScene[];
  sceneMode: "teacher" | "free";
  reason: boolean;
};
export type ThinkingPointValue = { x?: number; y?: number; v?: number };
export type ThinkingPoint = {
  owner: string;
  scene: string;
  value: ThinkingPointValue;
  reason: string;
  authorId: string;
  authorName: string;
  updated: number;
};
export type ThinkingLock = {
  owner: string;
  scene: string;
  userId: string;
  name: string;
  /** True when the lock is the viewer's own. Identity fields are
   * blanked for viewers who may not see who is editing (plan
   * §4.1.8), so clients must judge "someone else is editing" from
   * this flag, never from a blank userId. */
  mine: boolean;
  expires: number;
};
/** One card on a board tool. For board tools the lock row's scene
 * column holds the card id while someone edits its text. */
export type ThinkingCard = {
  id: string;
  owner: string;
  zone: string;
  text: string;
  color: string;
  x: number;
  y: number;
  sort: number;
  authorId: string;
  authorName: string;
  /** True when the viewer wrote this card (author ids are not returned
   * to most participants, so the client needs this to offer editing). */
  mine: boolean;
  created: number;
  updated: number;
};
export type ThinkingTool = {
  id: string;
  kind: ThinkingKind;
  template: ThinkingTemplate;
  unit: ThinkingUnit;
  definition: ThinkingDefinition;
  status: ThinkingStatus;
  /** The scene the teacher is showing (teacher scene mode). */
  scene: string;
  created: number;
};
export type ThinkingView = ThinkingTool & {
  points: ThinkingPoint[];
  cards: ThinkingCard[];
  locks: ThinkingLock[];
  /** The group the viewer belongs to (group-unit tools). */
  myGroupId?: string;
  /** Host only: every member's id in join order, so the pseudonym
   * numbers （生徒1・生徒2…) stay put for the whole lesson even
   * when a student answers for the first time midway or joins the
   * deck midway (stage-4 🟡3). Never sent to students — it lists
   * other students' ids. */
  roster?: string[];
};
export class ThinkingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const insist = (ok: unknown, status: number, message: string): void => {
  if (!ok) throw new ThinkingError(status, message);
};
export const THINKING_LOCK_MS = 20000;
export const MAX_THINKING_TOOLS = 30;
const MAX_SCENES = 10;
const MAX_LABEL = 40;
const MAX_REASON = 200;
export const MAX_CARDS_PER_BOARD = 100;
export const MAX_CARD_TEXT = 80;
const MAX_DECK_CARDS = 5000;
/** The fixed card colour palette. "" means no colour (white). */
export const CARD_COLORS = ["yellow", "blue", "pink", "green"];

export const thinkingSchema =
  `
CREATE TABLE IF NOT EXISTS thinking_tools(id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, kind TEXT NOT NULL, template TEXT NOT NULL, unit TEXT NOT NULL, definition TEXT NOT NULL, series TEXT, status TEXT NOT NULL, scene TEXT, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS thinking_tools_deck ON thinking_tools(deck);
CREATE TABLE IF NOT EXISTS thinking_points(tool TEXT NOT NULL REFERENCES thinking_tools(id) ON DELETE CASCADE, owner TEXT NOT NULL, scene TEXT NOT NULL, value TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', author TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(tool, owner, scene));
CREATE INDEX IF NOT EXISTS thinking_points_tool ON thinking_points(tool);
CREATE TABLE IF NOT EXISTS thinking_locks(tool TEXT NOT NULL REFERENCES thinking_tools(id) ON DELETE CASCADE, owner TEXT NOT NULL, scene TEXT NOT NULL, user TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(tool, owner, scene));
CREATE TABLE IF NOT EXISTS thinking_cards(id TEXT PRIMARY KEY, tool TEXT NOT NULL REFERENCES thinking_tools(id) ON DELETE CASCADE, deck TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL, zone TEXT NOT NULL, parent TEXT, sort INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, color TEXT NOT NULL DEFAULT '', x REAL NOT NULL DEFAULT 0.5, y REAL NOT NULL DEFAULT 0.5, author TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS thinking_cards_tool ON thinking_cards(tool, owner);
CREATE INDEX IF NOT EXISTS thinking_cards_deck ON thinking_cards(deck);` +
  featureVersionSchema +
  versionTriggers("thinking_tools", "thinking", (a) => `${a}.deck`) +
  versionTriggers(
    "thinking_points",
    "thinking",
    (a) => `COALESCE((SELECT deck FROM thinking_tools WHERE id=${a}.tool),'')`,
  ) +
  versionTriggers(
    "thinking_cards",
    "thinking",
    (a) => `COALESCE((SELECT deck FROM thinking_tools WHERE id=${a}.tool),'')`,
  ) +
  versionTriggers(
    "thinking_locks",
    "thinking",
    (a) => `COALESCE((SELECT deck FROM thinking_tools WHERE id=${a}.tool),'')`,
  );

/** Zone geometry for one board template. Coordinates are fractions of
 * the board surface (0..1). Rect zones hit-test by their rect; the Venn
 * templates hit-test by circle membership (see zoneAtPoint) and only
 * carry an anchor — where the zone's cards and label sit. */
export type ThinkingZoneSpec = {
  id: string;
  label: string;
  rect?: [number, number, number, number];
  anchor: [number, number];
  /** X chart only: the zone is one of the four triangles the two
   * diagonals cut the board into. `rect` then gives the box the
   * zone's cards are stacked in (inscribed in the triangle), and
   * zone membership follows the diagonals, not the box. */
  wedge?: "top" | "right" | "bottom" | "left";
};
const cols = (labels: string[]): ThinkingZoneSpec[] =>
  labels.map((label, i) => ({
    id: String.fromCharCode(97 + i),
    label,
    rect: [i / labels.length, 0, 1 / labels.length, 1] as [
      number,
      number,
      number,
      number,
    ],
    anchor: [(i + 0.5) / labels.length, 0.5] as [number, number],
  }));
const quad = (labels: [string, string, string, string]): ThinkingZoneSpec[] =>
  labels.map((label, i) => ({
    id: String.fromCharCode(97 + i),
    label,
    rect: [i % 2 === 1 ? 0.5 : 0, i >= 2 ? 0.5 : 0, 0.5, 0.5] as [
      number,
      number,
      number,
      number,
    ],
    anchor: [i % 2 === 1 ? 0.75 : 0.25, i >= 2 ? 0.75 : 0.25] as [
      number,
      number,
    ],
  }));
export const BOARD_ZONE_SPECS: Partial<
  Record<ThinkingTemplate, ThinkingZoneSpec[]>
> = {
  venn2: [
    { id: "a", label: "A", anchor: [0.2, 0.5] },
    { id: "b", label: "B", anchor: [0.8, 0.5] },
    { id: "ab", label: "AとBの重なり", anchor: [0.5, 0.5] },
  ],
  venn3: [
    { id: "a", label: "A", anchor: [0.5, 0.18] },
    { id: "b", label: "B", anchor: [0.18, 0.8] },
    { id: "c", label: "C", anchor: [0.82, 0.8] },
    { id: "ab", label: "AとB", anchor: [0.38, 0.42] },
    { id: "ac", label: "AとC", anchor: [0.62, 0.42] },
    { id: "bc", label: "BとC", anchor: [0.5, 0.76] },
    { id: "abc", label: "AとBとC", anchor: [0.5, 0.56] },
  ],
  ychart: [
    { id: "a", label: "見たこと", rect: [0, 0, 0.5, 0.55], anchor: [0.25, 0.27] },
    { id: "b", label: "聞いたこと", rect: [0.5, 0, 0.5, 0.55], anchor: [0.75, 0.27] },
    { id: "c", label: "感じたこと", rect: [0.25, 0.55, 0.5, 0.45], anchor: [0.5, 0.77] },
  ],
  xchart: [
    { id: "a", label: "見た目", wedge: "top", rect: [0.33, 0.03, 0.34, 0.28], anchor: [0.5, 0.15] },
    { id: "b", label: "音", wedge: "right", rect: [0.69, 0.33, 0.28, 0.34], anchor: [0.85, 0.5] },
    { id: "c", label: "感じ", wedge: "bottom", rect: [0.33, 0.69, 0.34, 0.28], anchor: [0.5, 0.85] },
    { id: "d", label: "におい", wedge: "left", rect: [0.03, 0.33, 0.28, 0.34], anchor: [0.15, 0.5] },
  ],
  wchart: cols(["いつ", "どこで", "だれが", "何を", "なぜ・どのように"]),
  tchart: cols(["メリット", "デメリット"]),
  pmi: cols(["よい点（Plus）", "課題（Minus）", "面白い点（Interesting）"]),
  matrix: quad(["左上", "右上", "左下", "右下"]),
  kwl: cols([
    "知っていること（K）",
    "知りたいこと（W）",
    "分かったこと（L）",
  ]),
};
/** The X chart's centre circle, which holds the topic (the tool's
 * title), in the same 0..1 space (x, y, r). Cards cannot be placed
 * inside it. */
export const XCHART_CENTER = { x: 0.5, y: 0.5, r: 0.14 };
/** The Venn circles, in the same 0..1 space (x, y, r). */
export const VENN_CIRCLES: Partial<
  Record<ThinkingTemplate, { x: number; y: number; r: number }[]>
> = {
  venn2: [
    { x: 0.38, y: 0.5, r: 0.3 },
    { x: 0.62, y: 0.5, r: 0.3 },
  ],
  venn3: [
    { x: 0.5, y: 0.37, r: 0.27 },
    { x: 0.36, y: 0.61, r: 0.27 },
    { x: 0.64, y: 0.61, r: 0.27 },
  ],
};
export function templateKind(template: ThinkingTemplate): ThinkingKind {
  return BOARD_ZONE_SPECS[template] ? "board" : "point";
}
/** Display labels for the students (owners) shown on the host's slide
 * where names stay hidden until the host turns them on. Owners are
 * sorted by id so the pseudonym numbers (生徒1, 生徒2, …) never
 * change while a lesson runs: the server returns points and cards in
 * last-updated order, so first-appearance order would shuffle the
 * numbers whenever a student moves a point or a card. Point tools
 * and card boards share this helper, so a student keeps the same
 * number in both views.
 *
 * When the host's roster (every member, in a fixed order) is known,
 * the number is the owner's place in the roster instead of their
 * place among the owners who happen to have answered: a student who
 * answers for the first time midway through the lesson then takes
 * their own fixed number instead of pushing everyone after them
 * down by one (stage-4 🟡3). Owners missing from the roster (they
 * left the deck) are numbered after it, in id order. */
export function thinkingOwnerLabels(
  owners: readonly string[],
  nameOf: (owner: string) => string | undefined,
  showNames: boolean,
  roster?: readonly string[],
): { owner: string; label: string }[] {
  const unique = [...new Set(owners)];
  if (!roster) {
    return unique.sort().map((owner, i) => ({
      owner,
      label: showNames ? nameOf(owner) || "名前未登録" : `生徒${i + 1}`,
    }));
  }
  const place = new Map(roster.map((id, i) => [id, i]));
  const ordered = unique.sort(
    (a, b) =>
      (place.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (place.get(b) ?? Number.MAX_SAFE_INTEGER) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  let extra = roster.length;
  const numbers = new Map(
    ordered.map((owner) => {
      const at = place.get(owner);
      return [owner, at !== undefined ? at + 1 : ++extra] as const;
    }),
  );
  return ordered.map((owner) => ({
    owner,
    label: showNames
      ? nameOf(owner) || "名前未登録"
      : `生徒${numbers.get(owner)}`,
  }));
}
/** Which zone of a board template contains the point (x, y in 0..1)?
 * Null when the point falls outside every zone. */
export function zoneAtPoint(
  template: ThinkingTemplate,
  x: number,
  y: number,
): string | null {
  const circles = VENN_CIRCLES[template];
  if (circles) {
    const inside = circles.map(
      (c) => (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r,
    );
    if (!inside.some(Boolean)) return null;
    return inside
      .map((on, i) => (on ? String.fromCharCode(97 + i) : ""))
      .join("");
  }
  const spec = BOARD_ZONE_SPECS[template];
  if (!spec) return null;
  if (spec.some((zone) => zone.wedge)) {
    // X chart: the centre circle holds the topic, and the two
    // diagonals decide which triangle a point belongs to.
    const c = XCHART_CENTER;
    if ((x - c.x) ** 2 + (y - c.y) ** 2 <= c.r * c.r) return null;
    const wedge =
      y <= x && y <= 1 - x
        ? "top"
        : y >= x && y >= 1 - x
          ? "bottom"
          : x < y && x < 1 - y
            ? "left"
            : "right";
    return spec.find((zone) => zone.wedge === wedge)?.id ?? null;
  }
  for (const zone of spec) {
    if (!zone.rect) continue;
    const [rx, ry, rw, rh] = zone.rect;
    if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return zone.id;
  }
  return null;
}

function cleanLabel(value: unknown, label: string, max = MAX_LABEL): string {
  insist(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    400,
    `${label}は1〜${max}文字で入力してください。`,
  );
  return (value as string).trim().replace(/\s+/g, " ");
}
const TEMPLATES: ThinkingTemplate[] = [
  "axis2",
  "axis1",
  "emotion",
  "ratio",
  "venn2",
  "venn3",
  "ychart",
  "xchart",
  "wchart",
  "tchart",
  "pmi",
  "matrix",
  "kwl",
];
const UNITS: ThinkingUnit[] = ["individual", "group", "class"];

/** Validate and normalize a tool definition for its template. Throws
 * ThinkingError(400) on anything the surface cannot render. */
export function parseThinkingDefinition(
  template: unknown,
  raw: unknown,
): { template: ThinkingTemplate; definition: ThinkingDefinition } {
  insist(
    typeof template === "string" &&
      (TEMPLATES as string[]).includes(template),
    400,
    "思考ツールの種類を確認してください。",
  );
  const t = template as ThinkingTemplate;
  const value = raw as Record<string, unknown>;
  insist(
    value && typeof value === "object" && !Array.isArray(value),
    400,
    "思考ツールの設定を確認してください。",
  );
  const title = cleanLabel(value.title, "ツールの名前", 60);
  if (BOARD_ZONE_SPECS[t]) {
    // Board templates: the zones are fixed by the template; only their
    // labels (and the card colour meanings) are the teacher's to edit.
    // Boards have no scenes and no reason field.
    const spec = BOARD_ZONE_SPECS[t]!;
    insist(
      value.zones === undefined || Array.isArray(value.zones),
      400,
      "区切りの設定を確認してください。",
    );
    const given = new Map<string, unknown>();
    for (const entry of (value.zones as unknown[] | undefined) ?? []) {
      const z = entry as Record<string, unknown>;
      insist(
        z && typeof z === "object" && typeof z.id === "string",
        400,
        "区切りの設定を確認してください。",
      );
      given.set(z.id as string, z.label);
    }
    const zones: ThinkingZone[] = migrateXChartLabels(
      t,
      spec.map((zone) => ({
        id: zone.id,
        label:
          given.get(zone.id) === undefined
            ? zone.label
            : cleanLabel(given.get(zone.id), "区切りの名前"),
      })),
    );
    insist(
      [...given.keys()].every((id) => spec.some((zone) => zone.id === id)),
      400,
      "区切りの設定を確認してください。",
    );
    const cardColors: ThinkingCardColor[] = [];
    insist(
      value.cardColors === undefined || Array.isArray(value.cardColors),
      400,
      "カードの色の設定を確認してください。",
    );
    for (const entry of (value.cardColors as unknown[] | undefined) ?? []) {
      const c = entry as Record<string, unknown>;
      insist(
        c &&
          typeof c === "object" &&
          typeof c.color === "string" &&
          CARD_COLORS.includes(c.color as string) &&
          !cardColors.some((x) => x.color === c.color),
        400,
        "カードの色の設定を確認してください。",
      );
      cardColors.push({
        color: c.color as string,
        label: cleanLabel(c.label, "色の意味", 20),
      });
    }
    insist(cardColors.length <= 4, 400, "カードの色は4つまでです。");
    return {
      template: t,
      definition: {
        title,
        xMin: "",
        xMax: "",
        yMin: "",
        yMax: "",
        scale: "none",
        vertical: false,
        nameA: "",
        nameB: "",
        zones,
        cardColors,
        scenes: [],
        sceneMode: "teacher",
        reason: false,
      },
    };
  }
  insist(
    value.scenes === undefined || Array.isArray(value.scenes),
    400,
    "場面の設定を確認してください。",
  );
  const scenesRaw: unknown[] = Array.isArray(value.scenes)
    ? value.scenes
    : [];
  insist(
    scenesRaw.length <= MAX_SCENES,
    400,
    `場面は${MAX_SCENES}個までです。`,
  );
  const scenes: ThinkingScene[] = [];
  const seen = new Set<string>();
  for (const entry of scenesRaw) {
    const s = entry as Record<string, unknown>;
    insist(
      s && typeof s === "object" && typeof s.id === "string" && s.id !== "",
      400,
      "場面の設定を確認してください。",
    );
    insist(!seen.has(s.id as string), 400, "場面が重なっています。");
    seen.add(s.id as string);
    scenes.push({
      id: s.id as string,
      label: cleanLabel(s.label, "場面の名前"),
    });
  }
  insist(
    value.sceneMode === undefined ||
      value.sceneMode === "teacher" ||
      value.sceneMode === "free",
    400,
    "場面の進め方を確認してください。",
  );
  insist(
    value.scale === undefined ||
      value.scale === "none" ||
      value.scale === "s5" ||
      value.scale === "s10",
    400,
    "目盛りの設定を確認してください。",
  );
  const definition: ThinkingDefinition = {
    title,
    xMin: "",
    xMax: "",
    yMin: "",
    yMax: "",
    scale: (value.scale as ThinkingScale) ?? "none",
    vertical: value.vertical === true,
    nameA: "",
    nameB: "",
    zones: [],
    cardColors: [],
    scenes,
    sceneMode: scenes.length
      ? value.sceneMode === "free"
        ? "free"
        : "teacher"
      : "teacher",
    reason: value.reason === true,
  };
  if (t === "axis2" || t === "axis1" || t === "emotion") {
    definition.xMin = cleanLabel(value.xMin, "軸の左端（下端）の言葉");
    definition.xMax = cleanLabel(value.xMax, "軸の右端（上端）の言葉");
  }
  if (t === "axis2") {
    definition.yMin = cleanLabel(value.yMin, "縦軸の下端の言葉");
    definition.yMax = cleanLabel(value.yMax, "縦軸の上端の言葉");
  }
  if (t === "ratio") {
    definition.nameA = cleanLabel(value.nameA, "1つめの気持ちの名前");
    definition.nameB = cleanLabel(value.nameB, "2つめの気持ちの名前");
  }
  return { template: t, definition };
}

function parseUnit(raw: unknown): ThinkingUnit {
  insist(
    typeof raw === "string" && (UNITS as string[]).includes(raw),
    400,
    "書き込む単位を確認してください。",
  );
  return raw as ThinkingUnit;
}

const EMPTY_DEFINITION: ThinkingDefinition = {
  title: "思考ツール",
  xMin: "",
  xMax: "",
  yMin: "",
  yMax: "",
  scale: "none",
  vertical: false,
  nameA: "",
  nameB: "",
  zones: [],
  cardColors: [],
  scenes: [],
  sceneMode: "teacher",
  reason: false,
};

/** X charts created before 0.140.2 stored the quadrant defaults
 * （左上・右上・左下・右下） as their zone labels. When all four labels
 * are exactly those old defaults they were never the teacher's own
 * names, so read them as the wedge defaults （見た目・音・感じ・におい）;
 * otherwise an old chart would label its left triangle 「右下」. A set
 * with any customised label is left completely untouched. */
const XCHART_OLD_DEFAULTS = ["左上", "右上", "左下", "右下"];
export function migrateXChartLabels(
  template: ThinkingTemplate,
  zones: ThinkingZone[],
): ThinkingZone[] {
  if (template !== "xchart" || zones.length !== 4) return zones;
  const spec = BOARD_ZONE_SPECS.xchart!;
  const byId = new Map(zones.map((z) => [z.id, z.label]));
  if (!spec.every((zone, i) => byId.get(zone.id) === XCHART_OLD_DEFAULTS[i]))
    return zones;
  return zones.map((z) => ({
    ...z,
    label: spec.find((s) => s.id === z.id)?.label ?? z.label,
  }));
}

function readTool(row: Record<string, unknown>): ThinkingTool {
  let definition: ThinkingDefinition;
  try {
    const parsed = JSON.parse(row.definition as string) as ThinkingDefinition;
    // Definitions written before stage 2 lack the board fields.
    definition = {
      ...EMPTY_DEFINITION,
      ...parsed,
      zones: migrateXChartLabels(
        row.template as ThinkingTemplate,
        parsed.zones ?? [],
      ),
      cardColors: parsed.cardColors ?? [],
      scenes: parsed.scenes ?? [],
    };
  } catch {
    definition = EMPTY_DEFINITION;
  }
  return {
    id: row.id as string,
    kind: (row.kind as ThinkingKind) ?? "point",
    template: row.template as ThinkingTemplate,
    unit: row.unit as ThinkingUnit,
    definition,
    status: row.status as ThinkingStatus,
    scene: (row.scene as string) ?? "",
    created: row.created as number,
  };
}

function loadTool(
  sql: HistorySQL,
  deck: string,
  id: string | undefined,
): ThinkingTool {
  const row = [
    ...sql("SELECT * FROM thinking_tools WHERE deck=? AND id=?", deck, id ?? ""),
  ][0];
  insist(row, 404, "思考ツールが見つかりません。");
  return readTool(row);
}

/** The owner key a point write/read uses for this actor and tool. The
 * host may name an owner explicitly (demonstration/moderation).
 * Individual and class tools both key points by the actor themself:
 * a class tool differs from an individual one in intent (its points
 * feed the shared distribution the host shows), not in ownership —
 * participants only ever receive their own point (review 2026-11-17,
 * user decision; plan §4.1.3 / decision 2). Only group tools share one
 * point per owner key. */
function resolveOwner(
  sql: HistorySQL,
  deck: string,
  tool: ThinkingTool,
  actor: string,
  host: boolean,
  requested: unknown,
): string {
  if (tool.unit === "individual" || tool.unit === "class") {
    if (typeof requested === "string" && requested !== "" && requested !== actor)
      insist(host, 403, "ほかの人の点は変更できません。");
    return typeof requested === "string" && requested !== "" && host
      ? requested
      : actor;
  }
  // group
  if (host && typeof requested === "string" && requested !== "") {
    const exists = [
      ...sql("SELECT id FROM deck_groups WHERE deck=? AND id=?", deck, requested),
    ][0];
    insist(exists, 404, "その班が見つかりません。");
    return requested;
  }
  const mine = effectiveGroupId(sql, deck, actor);
  insist(mine, 409, "班に入ってから書き込んでください。");
  if (typeof requested === "string" && requested !== "" && requested !== mine)
    insist(false, 403, "ほかの班の点は変更できません。");
  return mine as string;
}

function visibleOwners(
  sql: HistorySQL,
  deck: string,
  tool: ThinkingTool,
  actor: string,
  host: boolean,
): { owners: string[] | null; myGroupId?: string } {
  if (host) return { owners: null };
  if (tool.unit === "individual" || tool.unit === "class")
    return { owners: [actor] };
  const mine = effectiveGroupId(sql, deck, actor);
  return { owners: mine ? [mine] : [], myGroupId: mine };
}

/** The owner keys whose cards a viewer receives on a board tool. A
 * class board is one shared board (owner ""), unlike point tools. */
function boardVisibleOwners(
  sql: HistorySQL,
  deck: string,
  tool: ThinkingTool,
  actor: string,
  host: boolean,
): { owners: string[] | null; myGroupId?: string } {
  if (host) return { owners: null };
  if (tool.unit === "individual") return { owners: [actor] };
  if (tool.unit === "class") return { owners: [""] };
  const mine = effectiveGroupId(sql, deck, actor);
  return { owners: mine ? [mine] : [], myGroupId: mine };
}

export function thinkingList(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  caps?: { board?: boolean },
): ThinkingView[] {
  const now = Date.now();
  // The host's fixed member order for stable pseudonym numbers:
  // JOIN order (the members table's rowid), never id order — a
  // student who joins the deck midway takes the next number at the
  // end instead of slotting into the id order and pushing everyone
  // after them down by one. Students never receive the roster (it
  // lists other students' ids).
  const roster = host
    ? [...sql("SELECT user_id FROM members WHERE deck=? ORDER BY rowid", deck)]
        .map((row) => String(row.user_id))
        .filter((id) => id !== actor)
    : undefined;
  return [
    ...sql(
      "SELECT * FROM thinking_tools WHERE deck=? ORDER BY created DESC,id",
      deck,
    ),
  ]
    .filter((row) => host || row.status !== "draft")
    .filter((row) => caps?.board || row.kind !== "board")
    .map((row) => {
      const tool = readTool(row);
      if (tool.kind === "board") {
        const { owners, myGroupId } = boardVisibleOwners(
          sql,
          deck,
          tool,
          actor,
          host,
        );
        const showAuthor = host || tool.unit === "group";
        const ownerClause =
          owners === null
            ? ""
            : owners.length === 0
              ? " AND 1=0"
              : ` AND c.owner IN (${owners.map(() => "?").join(",")})`;
        const cards = (
          owners !== null && owners.length === 0
            ? []
            : [
                ...sql(
                  showAuthor
                    ? `SELECT c.*,u.name AS author_name FROM thinking_cards c LEFT JOIN users u ON u.id=c.author WHERE c.tool=?${ownerClause} ORDER BY c.zone,c.sort,c.created`
                    : `SELECT c.* FROM thinking_cards c WHERE c.tool=?${ownerClause} ORDER BY c.zone,c.sort,c.created`,
                  tool.id,
                  ...(owners ?? []),
                ),
              ]
        ).map(
          (c): ThinkingCard => ({
            id: c.id as string,
            owner: c.owner as string,
            zone: c.zone as string,
            text: c.text as string,
            color: c.color as string,
            x: c.x as number,
            y: c.y as number,
            sort: c.sort as number,
            authorId: showAuthor ? (c.author as string) : "",
            authorName: showAuthor
              ? (c.author_name as string) || "名前未登録"
              : "",
            mine: c.author === actor,
            created: c.created as number,
            updated: c.updated as number,
          }),
        );
        const lockOwnerClause =
          owners === null
            ? ""
            : owners.length === 0
              ? " AND 1=0"
              : ` AND owner IN (${owners.map(() => "?").join(",")})`;
        const locks = (
          owners !== null && owners.length === 0
            ? []
            : [
                ...sql(
                  `SELECT owner,scene,user,name,expires FROM thinking_locks WHERE tool=? AND expires>?${lockOwnerClause}`,
                  tool.id,
                  now,
                  ...(owners ?? []),
                ),
              ]
        ).map((l): ThinkingLock => {
          // A board lock names the card's author (only the author or
          // the host may take it), so its identity is the author's:
          // return it only to the host and same-group members, like
          // card authors (plan §4.1.8, stage-2 review 🔴2).
          const showIdentity = host || tool.unit === "group";
          return {
            owner: l.owner as string,
            scene: l.scene as string,
            userId: showIdentity ? (l.user as string) : "",
            name: showIdentity ? (l.name as string) : "",
            mine: (l.user as string) === actor,
            expires: l.expires as number,
          };
        });
        return {
          ...tool,
          points: [],
          cards,
          locks,
          ...(myGroupId ? { myGroupId } : {}),
          ...(roster ? { roster } : {}),
        };
      }
      const { owners, myGroupId } = visibleOwners(sql, deck, tool, actor, host);
      // Participants read only their own owners' rows: the owner filter
      // belongs in SQL (the points primary key starts with
      // (tool, owner, scene)), never read-everything-then-filter — on
      // Cloudflare every poll would otherwise re-read the whole class
      // (review 2026-11-17 🔴3). Author names/ids are returned only to
      // the host and to same-group members (plan §4.1.8), so the users
      // join is only needed for those viewers.
      const showAuthor = host || tool.unit === "group";
      const ownerClause =
        owners === null
          ? ""
          : owners.length === 0
            ? " AND 1=0"
            : ` AND p.owner IN (${owners.map(() => "?").join(",")})`;
      const points = (
        owners !== null && owners.length === 0
          ? []
          : [
              ...sql(
                showAuthor
                  ? `SELECT p.*,u.name AS author_name FROM thinking_points p LEFT JOIN users u ON u.id=p.author WHERE p.tool=?${ownerClause} ORDER BY p.updated,p.owner`
                  : `SELECT p.* FROM thinking_points p WHERE p.tool=?${ownerClause} ORDER BY p.updated,p.owner`,
                tool.id,
                ...(owners ?? []),
              ),
            ]
      ).map((p): ThinkingPoint => {
        let value: ThinkingPointValue = {};
        try {
          value = JSON.parse(p.value as string) as ThinkingPointValue;
        } catch {
          value = {};
        }
        return {
          owner: p.owner as string,
          scene: p.scene as string,
          value,
          reason: p.reason as string,
          authorId: showAuthor ? (p.author as string) : "",
          authorName: showAuthor
            ? (p.author_name as string) || "名前未登録"
            : "",
          updated: p.updated as number,
        };
      });
      const lockOwnerClause =
        owners === null
          ? ""
          : owners.length === 0
            ? " AND 1=0"
            : ` AND owner IN (${owners.map(() => "?").join(",")})`;
      const locks = (
        owners !== null && owners.length === 0
          ? []
          : [
              ...sql(
                `SELECT owner,scene,user,name,expires FROM thinking_locks WHERE tool=? AND expires>?${lockOwnerClause}`,
                tool.id,
                now,
                ...(owners ?? []),
              ),
            ]
      ).map(
        (l): ThinkingLock => ({
          owner: l.owner as string,
          scene: l.scene as string,
          userId: l.user as string,
          name: l.name as string,
          mine: (l.user as string) === actor,
          expires: l.expires as number,
        }),
      );
      return {
        ...tool,
        points,
        cards: [],
        locks,
        ...(myGroupId ? { myGroupId } : {}),
        ...(roster ? { roster } : {}),
      };
    });
}

function activeLock(
  sql: HistorySQL,
  tool: string,
  owner: string,
  scene: string,
  now: number,
) {
  return [
    ...sql(
      "SELECT user,name FROM thinking_locks WHERE tool=? AND owner=? AND scene=? AND expires>?",
      tool,
      owner,
      scene,
      now,
    ),
  ][0];
}

function actorName(sql: HistorySQL, actor: string): string {
  const row = [...sql("SELECT name FROM users WHERE id=?", actor)][0];
  return (row?.name as string) || "名前未登録";
}

/** Take (or refresh) the short editing lock; another holder rejects.
 * The key is a scene id for point tools and a card id for board tools. */
function lockRow(
  sql: HistorySQL,
  tool: ThinkingTool,
  owner: string,
  key: string,
  actor: string,
  now: number,
) {
  const lock = activeLock(sql, tool.id, owner, key, now);
  insist(
    !lock || lock.user === actor,
    409,
    `${lock?.name ?? "他の参加者"}さんが編集中です。`,
  );
  sql(
    "INSERT INTO thinking_locks(tool,owner,scene,user,name,expires) VALUES(?,?,?,?,?,?) ON CONFLICT(tool,owner,scene) DO UPDATE SET user=excluded.user,name=excluded.name,expires=excluded.expires",
    tool.id,
    owner,
    key,
    actor,
    actorName(sql, actor),
    now + THINKING_LOCK_MS,
  );
}

function takeLock(
  sql: HistorySQL,
  tool: ThinkingTool,
  owner: string,
  scene: string,
  actor: string,
  now: number,
) {
  if (tool.unit === "individual" || tool.unit === "class") return;
  lockRow(sql, tool, owner, scene, actor, now);
}

function cleanScene(tool: ThinkingTool, raw: unknown): string {
  if (tool.definition.scenes.length === 0) {
    insist(
      raw === undefined || raw === "",
      400,
      "このツールに場面はありません。",
    );
    return "";
  }
  insist(
    typeof raw === "string" &&
      tool.definition.scenes.some((s) => s.id === raw),
    400,
    "場面を確認してください。",
  );
  return raw as string;
}

function cleanPointValue(
  tool: ThinkingTool,
  raw: unknown,
): ThinkingPointValue {
  const value = raw as Record<string, unknown>;
  insist(
    value && typeof value === "object" && !Array.isArray(value),
    400,
    "点の位置を確認してください。",
  );
  const unit = (n: unknown) => {
    insist(
      typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
      400,
      "点の位置を確認してください。",
    );
    return n as number;
  };
  if (tool.template === "axis2") return { x: unit(value.x), y: unit(value.y) };
  if (tool.template === "ratio") {
    insist(
      typeof value.v === "number" &&
        Number.isFinite(value.v) &&
        value.v >= 0 &&
        value.v <= 100,
      400,
      "割合を確認してください。",
    );
    return { v: Math.round(value.v as number) };
  }
  return { v: unit(value.v) };
}

/** The owner key a new card lands under. Class boards are shared
 * (owner ""); the host may name a group explicitly. */
function boardOwner(
  sql: HistorySQL,
  deck: string,
  tool: ThinkingTool,
  actor: string,
  host: boolean,
  requested: unknown,
): string {
  if (tool.unit === "class") return "";
  if (tool.unit === "individual") {
    if (typeof requested === "string" && requested !== "" && requested !== actor)
      insist(host, 403, "ほかの人のカードは変更できません。");
    return typeof requested === "string" && requested !== "" && host
      ? requested
      : actor;
  }
  if (host && typeof requested === "string" && requested !== "") {
    const exists = [
      ...sql("SELECT id FROM deck_groups WHERE deck=? AND id=?", deck, requested),
    ][0];
    insist(exists, 404, "その班が見つかりません。");
    return requested;
  }
  const mine = effectiveGroupId(sql, deck, actor);
  insist(mine, 409, "班に入ってから書き込んでください。");
  if (typeof requested === "string" && requested !== "" && requested !== mine)
    insist(false, 403, "ほかの班のカードは変更できません。");
  return mine as string;
}

type CardRow = Record<string, unknown>;

function loadCard(
  sql: HistorySQL,
  tool: ThinkingTool,
  raw: unknown,
): CardRow {
  insist(
    typeof raw === "string" && raw !== "",
    400,
    "カードを確認してください。",
  );
  const row = [
    ...sql(
      "SELECT * FROM thinking_cards WHERE tool=? AND id=?",
      tool.id,
      raw as string,
    ),
  ][0];
  insist(row, 404, "そのカードは既に消えています。");
  return row;
}

/** A card is in the actor's writing scope when it sits on a board the
 * actor writes to: their own (individual), their group's (group) or the
 * shared board (class). The host may act on any card. */
function insistCardScope(
  sql: HistorySQL,
  deck: string,
  tool: ThinkingTool,
  card: CardRow,
  actor: string,
  host: boolean,
) {
  if (host) return;
  if (tool.unit === "individual")
    insist(card.owner === actor, 403, "ほかの人のカードは変更できません。");
  else if (tool.unit === "class")
    insist(card.owner === "", 403, "そのカードは変更できません。");
  else {
    const mine = effectiveGroupId(sql, deck, actor);
    insist(mine, 409, "班に入ってから書き込んでください。");
    insist(card.owner === mine, 403, "ほかの班のカードは変更できません。");
  }
}

function cleanZone(tool: ThinkingTool, raw: unknown): string {
  insist(
    typeof raw === "string" &&
      tool.definition.zones.some((z) => z.id === raw),
    400,
    "区切りを確認してください。",
  );
  return raw as string;
}

function cleanCardText(raw: unknown): string {
  insist(
    typeof raw === "string" && raw.trim().length > 0,
    400,
    "カードの内容を入力してください。",
  );
  const text = (raw as string).trim().replace(/\s+/g, " ");
  insist(
    text.length <= MAX_CARD_TEXT,
    400,
    `カードは${MAX_CARD_TEXT}文字までです。`,
  );
  return text;
}

function cleanCardColor(raw: unknown): string {
  if (raw === undefined || raw === "") return "";
  insist(
    typeof raw === "string" && CARD_COLORS.includes(raw as string),
    400,
    "カードの色を確認してください。",
  );
  return raw as string;
}

function cleanCardPos(raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  insist(
    typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1,
    400,
    "カードの位置を確認してください。",
  );
  return raw as number;
}

/** Must run within the caller's transaction after membership validation.
 * Returns extra response fields (create reports the new id). */
export type ThinkingShareCard = {
  zone: string;
  text: string;
  color: string;
  sort: number;
  created: number;
};
export type ThinkingShareView = {
  label: string;
  unit: ThinkingUnit;
  template: ThinkingTemplate;
  definition: ThinkingDefinition;
  cards: ThinkingShareCard[];
};
/** The one chart the host is showing to the whole class (stage 4c),
 * built for students: the owner's display label is resolved here,
 * with the same roster numbering the host's gallery uses, and the
 * cards carry no id, owner or author — nothing a student could use
 * to identify who wrote what beyond the label the host chose to
 * show. Returns undefined when the tool is not a card board. */
export function thinkingShareView(
  sql: HistorySQL,
  deck: string,
  toolId: string,
  owner: string,
  showNames: boolean,
  hostId: string,
): ThinkingShareView | undefined {
  const row = [
    ...sql("SELECT * FROM thinking_tools WHERE id=? AND deck=?", toolId, deck),
  ][0];
  if (!row) return undefined;
  const tool = readTool(row);
  if (tool.kind !== "board") return undefined;
  let label = "";
  if (tool.unit === "class") label = "全員";
  else {
    const owners = [
      ...new Set(
        [...sql("SELECT owner FROM thinking_cards WHERE tool=?", toolId)].map(
          (r) => String(r.owner),
        ),
      ),
    ];
    const roster = [
      ...sql(
        "SELECT user_id FROM members WHERE deck=? ORDER BY rowid",
        deck,
      ),
    ]
      .map((r) => String(r.user_id))
      .filter((id) => id !== hostId);
    const nameOf = (o: string): string | undefined => {
      if (tool.unit === "group") {
        const g = [
          ...sql("SELECT name FROM deck_groups WHERE deck=? AND id=?", deck, o),
        ][0];
        return g ? String(g.name) : undefined;
      }
      const c = [
        ...sql(
          "SELECT u.name AS name FROM thinking_cards c LEFT JOIN users u ON u.id=c.author WHERE c.tool=? AND c.owner=? LIMIT 1",
          toolId,
          o,
        ),
      ][0];
      return c?.name ? String(c.name) : undefined;
    };
    label =
      thinkingOwnerLabels(
        owners,
        nameOf,
        tool.unit === "group" || showNames,
        roster,
      ).find((e) => e.owner === owner)?.label ?? "";
  }
  const cards = [
    ...sql(
      "SELECT zone,text,color,sort,created FROM thinking_cards WHERE tool=? AND owner=? ORDER BY zone,sort,created",
      toolId,
      owner,
    ),
  ].map(
    (c): ThinkingShareCard => ({
      zone: String(c.zone),
      text: String(c.text),
      color: String(c.color),
      sort: Number(c.sort),
      created: Number(c.created),
    }),
  );
  return {
    label,
    unit: tool.unit,
    template: tool.template,
    definition: tool.definition,
    cards,
  };
}
export function thinkingCommand(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  action: string,
  id: string | undefined,
  input: unknown,
): { createdId?: string } | undefined {
  const value = input as Record<string, unknown>;
  insist(
    value && typeof value === "object" && !Array.isArray(value),
    400,
    "入力を確認してください。",
  );
  const now = Date.now();
  if (action === "create") {
    insist(host, 403, "思考ツールを作成できるのはホストだけです。");
    insist(
      [...sql("SELECT id FROM thinking_tools WHERE deck=?", deck)].length <
        MAX_THINKING_TOOLS,
      413,
      `思考ツールは作品ごとに${MAX_THINKING_TOOLS}件までです。`,
    );
    const unit = parseUnit(value.unit);
    const { template, definition } = parseThinkingDefinition(
      value.template,
      value.definition,
    );
    const tool: ThinkingTool = {
      id: crypto.randomUUID(),
      kind: templateKind(template),
      template,
      unit,
      definition,
      status: "draft",
      scene: definition.scenes[0]?.id ?? "",
      created: now,
    };
    sql(
      "INSERT INTO thinking_tools(id,deck,kind,template,unit,definition,series,status,scene,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
      tool.id,
      deck,
      tool.kind,
      tool.template,
      tool.unit,
      JSON.stringify(tool.definition),
      "",
      tool.status,
      tool.scene,
      tool.created,
    );
    return { createdId: tool.id };
  }
  const tool = loadTool(sql, deck, id);
  if (action === "edit") {
    insist(host, 403, "思考ツールを編集できるのはホストだけです。");
    const unit = parseUnit(value.unit === undefined ? tool.unit : value.unit);
    const { definition } = parseThinkingDefinition(
      tool.template,
      value.definition === undefined ? tool.definition : value.definition,
    );
    const pointCount = [
      ...sql("SELECT COUNT(*) AS n FROM thinking_points WHERE tool=?", tool.id),
    ][0].n as number;
    const cardCount = [
      ...sql("SELECT COUNT(*) AS n FROM thinking_cards WHERE tool=?", tool.id),
    ][0].n as number;
    const writingCount = pointCount + cardCount;
    insist(
      unit === tool.unit || writingCount === 0,
      409,
      "回答があるため、書き込む単位は変更できません。",
    );
    // Scenes that already hold points cannot be removed.
    if (writingCount > 0) {
      const usedScenes = new Set(
        [...sql("SELECT DISTINCT scene FROM thinking_points WHERE tool=?", tool.id)].map(
          (r) => r.scene as string,
        ),
      );
      for (const used of usedScenes)
        insist(
          definition.scenes.some((s) => s.id === used),
          409,
          "回答のある場面は削除できません。",
        );
    }
    const scene = definition.scenes.some((s) => s.id === tool.scene)
      ? tool.scene
      : (definition.scenes[0]?.id ?? "");
    sql(
      "UPDATE thinking_tools SET unit=?,definition=?,scene=? WHERE id=?",
      unit,
      JSON.stringify(definition),
      scene,
      tool.id,
    );
    return undefined;
  }
  if (action === "status") {
    insist(host, 403, "受付の状態を変更できるのはホストだけです。");
    insist(
      value.status === "draft" ||
        value.status === "open" ||
        value.status === "closed",
      400,
      "受付の状態を確認してください。",
    );
    sql(
      "UPDATE thinking_tools SET status=? WHERE id=?",
      value.status as string,
      tool.id,
    );
    return undefined;
  }
  if (action === "scene") {
    insist(host, 403, "場面を切り替えられるのはホストだけです。");
    const scene = cleanScene(tool, value.scene);
    sql("UPDATE thinking_tools SET scene=? WHERE id=?", scene, tool.id);
    return undefined;
  }
  if (action === "delete") {
    insist(host, 403, "思考ツールを削除できるのはホストだけです。");
    sql("DELETE FROM thinking_points WHERE tool=?", tool.id);
    sql("DELETE FROM thinking_cards WHERE tool=?", tool.id);
    sql("DELETE FROM thinking_locks WHERE tool=?", tool.id);
    sql("DELETE FROM thinking_tools WHERE id=?", tool.id);
    return undefined;
  }
  if (action === "lock") {
    insist(
      host || tool.status === "open",
      409,
      "このツールは書き込みを受け付けていません。",
    );
    if (tool.kind === "board") {
      // Board locks guard one card's text editing (key = card id).
      // Only the card's author or the host may take it: anyone else
      // could otherwise keep re-taking it and block the author from
      // editing at all (stage-2 review 🔴2).
      const card = loadCard(sql, tool, value.cardId);
      insistCardScope(sql, deck, tool, card, actor, host);
      insist(
        host || card.author === actor,
        403,
        "カードのロックを取れるのは、書いた人と先生だけです。",
      );
      lockRow(sql, tool, card.owner as string, card.id as string, actor, now);
      return undefined;
    }
    const owner = resolveOwner(sql, deck, tool, actor, host, value.owner);
    const scene = cleanScene(tool, value.scene);
    takeLock(sql, tool, owner, scene, actor, now);
    return undefined;
  }
  if (action === "point") {
    insist(
      host || tool.status === "open",
      409,
      "このツールは書き込みを受け付けていません。",
    );
    const owner = resolveOwner(sql, deck, tool, actor, host, value.owner);
    const scene = cleanScene(tool, value.scene);
    if (
      tool.definition.sceneMode === "teacher" &&
      tool.definition.scenes.length > 0 &&
      !host
    )
      insist(
        scene === tool.scene,
        409,
        "今の場面にだけ書き込めます。",
      );
    takeLock(sql, tool, owner, scene, actor, now);
    const pointValue = cleanPointValue(tool, value.value);
    let reason = "";
    if (tool.definition.reason) {
      insist(
        value.reason === undefined || typeof value.reason === "string",
        400,
        "理由を確認してください。",
      );
      reason = ((value.reason as string) ?? "").trim();
      insist(
        reason.length <= MAX_REASON,
        400,
        `理由は${MAX_REASON}文字までです。`,
      );
    }
    sql(
      "INSERT INTO thinking_points(tool,owner,scene,value,reason,author,updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tool,owner,scene) DO UPDATE SET value=excluded.value,reason=excluded.reason,author=excluded.author,updated=excluded.updated",
      tool.id,
      owner,
      scene,
      JSON.stringify(pointValue),
      reason,
      actor,
      now,
    );
    return undefined;
  }
  if (action === "clear") {
    insist(
      host || tool.status === "open",
      409,
      "このツールは書き込みを受け付けていません。",
    );
    const owner = resolveOwner(sql, deck, tool, actor, host, value.owner);
    const scene = cleanScene(tool, value.scene);
    const existing = [
      ...sql(
        "SELECT author FROM thinking_points WHERE tool=? AND owner=? AND scene=?",
        tool.id,
        owner,
        scene,
      ),
    ][0];
    insist(existing, 404, "その点は既に消えています。");
    if (!host && tool.unit === "group") {
      const lock = activeLock(sql, tool.id, owner, scene, now);
      insist(
        existing.author === actor || (lock && lock.user === actor),
        403,
        "その点を消せるのは、書いた人か編集中の人だけです。",
      );
    }
    if (!host && tool.unit !== "group")
      insist(existing.author === actor, 403, "ほかの人の点は消せません。");
    sql(
      "DELETE FROM thinking_points WHERE tool=? AND owner=? AND scene=?",
      tool.id,
      owner,
      scene,
    );
    return undefined;
  }
  if (action === "card") {
    insist(tool.kind === "board", 400, "このツールにカードは書けません。");
    insist(
      host || tool.status === "open",
      409,
      "このツールは書き込みを受け付けていません。",
    );
    const owner = boardOwner(sql, deck, tool, actor, host, value.owner);
    const zone = cleanZone(tool, value.zone);
    const text = cleanCardText(value.text);
    const color = cleanCardColor(value.color);
    const boardCount = [
      ...sql(
        "SELECT COUNT(*) AS n FROM thinking_cards WHERE tool=? AND owner=?",
        tool.id,
        owner,
      ),
    ][0].n as number;
    insist(
      boardCount < MAX_CARDS_PER_BOARD,
      413,
      `カードは1枚のチャートに${MAX_CARDS_PER_BOARD}枚までです。`,
    );
    // The deck total counts through the (deck) index on the card
    // rows themselves — no join against thinking_tools per write
    // (stage-2 review 🟡6).
    const deckCount = [
      ...sql(
        "SELECT COUNT(*) AS n FROM thinking_cards WHERE deck=?",
        deck,
      ),
    ][0].n as number;
    insist(
      deckCount < MAX_DECK_CARDS,
      413,
      "作品全体のカードの上限に達しています。",
    );
    const sort = [
      ...sql(
        "SELECT COUNT(*) AS n FROM thinking_cards WHERE tool=? AND owner=? AND zone=?",
        tool.id,
        owner,
        zone,
      ),
    ][0].n as number;
    const cardId = crypto.randomUUID();
    sql(
      "INSERT INTO thinking_cards(id,tool,deck,owner,zone,parent,sort,text,color,x,y,author,created,updated) VALUES(?,?,?,?,?,NULL,?,?,?,?,?,?,?,?)",
      cardId,
      tool.id,
      deck,
      owner,
      zone,
      sort,
      text,
      color,
      cleanCardPos(value.x, 0.5),
      cleanCardPos(value.y, 0.5),
      actor,
      now,
      now,
    );
    return { createdId: cardId };
  }
  if (action === "cardmove") {
    insist(tool.kind === "board", 400, "このツールにカードはありません。");
    insist(
      host || tool.status === "open",
      409,
      "このツールは書き込みを受け付けていません。",
    );
    const card = loadCard(sql, tool, value.cardId);
    insistCardScope(sql, deck, tool, card, actor, host);
    // Moving a card is open to everyone in scope (user decision 1);
    // only its text is the author's. The card lands at the end of the
    // target zone.
    const zone = cleanZone(tool, value.zone);
    const sort = [
      ...sql(
        "SELECT COUNT(*) AS n FROM thinking_cards WHERE tool=? AND owner=? AND zone=? AND id<>?",
        tool.id,
        card.owner as string,
        zone,
        card.id as string,
      ),
    ][0].n as number;
    sql(
      "UPDATE thinking_cards SET zone=?,sort=?,x=?,y=?,updated=? WHERE id=?",
      zone,
      sort,
      cleanCardPos(value.x, card.x as number),
      cleanCardPos(value.y, card.y as number),
      now,
      card.id as string,
    );
    return undefined;
  }
  if (action === "cardedit") {
    insist(tool.kind === "board", 400, "このツールにカードはありません。");
    insist(
      host || tool.status === "open",
      409,
      "このツールは書き込みを受け付けていません。",
    );
    const card = loadCard(sql, tool, value.cardId);
    insistCardScope(sql, deck, tool, card, actor, host);
    insist(
      host || card.author === actor,
      403,
      "カードの内容を変えられるのは、書いた人と先生だけです。",
    );
    lockRow(sql, tool, card.owner as string, card.id as string, actor, now);
    const text =
      value.text === undefined
        ? (card.text as string)
        : cleanCardText(value.text);
    const color =
      value.color === undefined
        ? (card.color as string)
        : cleanCardColor(value.color);
    sql(
      "UPDATE thinking_cards SET text=?,color=?,updated=? WHERE id=?",
      text,
      color,
      now,
      card.id as string,
    );
    return undefined;
  }
  if (action === "carddelete") {
    insist(tool.kind === "board", 400, "このツールにカードはありません。");
    insist(
      host || tool.status === "open",
      409,
      "このツールは書き込みを受け付けていません。",
    );
    const card = loadCard(sql, tool, value.cardId);
    insistCardScope(sql, deck, tool, card, actor, host);
    insist(
      host || card.author === actor,
      403,
      "カードを消せるのは、書いた人と先生だけです。",
    );
    sql("DELETE FROM thinking_cards WHERE id=?", card.id as string);
    sql(
      "DELETE FROM thinking_locks WHERE tool=? AND owner=? AND scene=?",
      tool.id,
      card.owner as string,
      card.id as string,
    );
    return undefined;
  }
  insist(false, 404, "思考ツールの操作が見つかりません。");
  return undefined;
}
