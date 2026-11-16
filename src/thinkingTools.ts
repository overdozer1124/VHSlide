import type { HistorySQL } from "./historyStore.ts";
import { effectiveGroupId } from "./groups.ts";
import { featureVersionSchema, versionTriggers } from "./featureVersions.ts";

/** Thinking tools (思考ツール): teacher-placed surfaces students write on.
 *
 * Stage 1 covers the "point" kind: a learner places a point on axes, a
 * line, an emotion meter or a two-part ratio circle. Every scene (場面)
 * keeps its own point, so how a learner's thinking moved stays visible.
 * A tool is written by an individual, by a group (班) or by the whole
 * class, mirroring the worksheet/webbing permission shape: the shared
 * command enforces everything server-side for both servers.
 */
export type ThinkingKind = "point";
export type ThinkingTemplate = "axis2" | "axis1" | "emotion" | "ratio";
export type ThinkingUnit = "individual" | "group" | "class";
export type ThinkingStatus = "draft" | "open" | "closed";
export type ThinkingScale = "none" | "s5" | "s10";

export type ThinkingScene = { id: string; label: string };
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
  expires: number;
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
  locks: ThinkingLock[];
  /** The group the viewer belongs to (group-unit tools). */
  myGroupId?: string;
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

export const thinkingSchema =
  `
CREATE TABLE IF NOT EXISTS thinking_tools(id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, kind TEXT NOT NULL, template TEXT NOT NULL, unit TEXT NOT NULL, definition TEXT NOT NULL, series TEXT, status TEXT NOT NULL, scene TEXT, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS thinking_tools_deck ON thinking_tools(deck);
CREATE TABLE IF NOT EXISTS thinking_points(tool TEXT NOT NULL REFERENCES thinking_tools(id) ON DELETE CASCADE, owner TEXT NOT NULL, scene TEXT NOT NULL, value TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', author TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(tool, owner, scene));
CREATE INDEX IF NOT EXISTS thinking_points_tool ON thinking_points(tool);
CREATE TABLE IF NOT EXISTS thinking_locks(tool TEXT NOT NULL REFERENCES thinking_tools(id) ON DELETE CASCADE, owner TEXT NOT NULL, scene TEXT NOT NULL, user TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(tool, owner, scene));` +
  featureVersionSchema +
  versionTriggers("thinking_tools", "thinking", (a) => `${a}.deck`) +
  versionTriggers(
    "thinking_points",
    "thinking",
    (a) => `COALESCE((SELECT deck FROM thinking_tools WHERE id=${a}.tool),'')`,
  ) +
  versionTriggers(
    "thinking_locks",
    "thinking",
    (a) => `COALESCE((SELECT deck FROM thinking_tools WHERE id=${a}.tool),'')`,
  );

function cleanLabel(value: unknown, label: string, max = MAX_LABEL): string {
  insist(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    400,
    `${label}は1〜${max}文字で入力してください。`,
  );
  return (value as string).trim().replace(/\s+/g, " ");
}
const TEMPLATES: ThinkingTemplate[] = ["axis2", "axis1", "emotion", "ratio"];
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

function readTool(row: Record<string, unknown>): ThinkingTool {
  let definition: ThinkingDefinition;
  try {
    definition = JSON.parse(row.definition as string) as ThinkingDefinition;
  } catch {
    definition = {
      title: "思考ツール",
      xMin: "",
      xMax: "",
      yMin: "",
      yMax: "",
      scale: "none",
      vertical: false,
      nameA: "",
      nameB: "",
      scenes: [],
      sceneMode: "teacher",
      reason: false,
    };
  }
  return {
    id: row.id as string,
    kind: "point",
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
 * host may name an owner explicitly (demonstration/moderation). */
function resolveOwner(
  sql: HistorySQL,
  deck: string,
  tool: ThinkingTool,
  actor: string,
  host: boolean,
  requested: unknown,
): string {
  if (tool.unit === "individual") {
    if (typeof requested === "string" && requested !== "" && requested !== actor)
      insist(host, 403, "ほかの人の点は変更できません。");
    return typeof requested === "string" && requested !== "" && host
      ? requested
      : actor;
  }
  if (tool.unit === "class") return "";
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
): ThinkingView[] {
  const now = Date.now();
  return [
    ...sql(
      "SELECT * FROM thinking_tools WHERE deck=? ORDER BY created DESC,id",
      deck,
    ),
  ]
    .filter((row) => host || row.status !== "draft")
    .map((row) => {
      const tool = readTool(row);
      const { owners, myGroupId } = visibleOwners(sql, deck, tool, actor, host);
      const points = [
        ...sql(
          "SELECT p.*,u.name AS author_name FROM thinking_points p LEFT JOIN users u ON u.id=p.author WHERE p.tool=? ORDER BY p.updated,p.owner",
          tool.id,
        ),
      ]
        .filter((p) => owners === null || owners.includes(p.owner as string))
        .map((p): ThinkingPoint => {
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
            // Author identity is only for the host and same-group members;
            // a class point keeps the name (attribution) but not the id.
            authorId: host || tool.unit === "group" ? (p.author as string) : "",
            authorName: (p.author_name as string) || "名前未登録",
            updated: p.updated as number,
          };
        });
      const locks = [
        ...sql(
          "SELECT owner,scene,user,name,expires FROM thinking_locks WHERE tool=? AND expires>?",
          tool.id,
          now,
        ),
      ]
        .filter((l) => owners === null || owners.includes(l.owner as string))
        .map(
          (l): ThinkingLock => ({
            owner: l.owner as string,
            scene: l.scene as string,
            userId: l.user as string,
            name: l.name as string,
            expires: l.expires as number,
          }),
        );
      return { ...tool, points, locks, ...(myGroupId ? { myGroupId } : {}) };
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

/** Take (or refresh) the short editing lock; another holder rejects. */
function takeLock(
  sql: HistorySQL,
  tool: ThinkingTool,
  owner: string,
  scene: string,
  actor: string,
  now: number,
) {
  if (tool.unit === "individual") return;
  const lock = activeLock(sql, tool.id, owner, scene, now);
  insist(
    !lock || lock.user === actor,
    409,
    `${lock?.name ?? "他の参加者"}さんが編集中です。`,
  );
  sql(
    "INSERT INTO thinking_locks(tool,owner,scene,user,name,expires) VALUES(?,?,?,?,?,?) ON CONFLICT(tool,owner,scene) DO UPDATE SET user=excluded.user,name=excluded.name,expires=excluded.expires",
    tool.id,
    owner,
    scene,
    actor,
    actorName(sql, actor),
    now + THINKING_LOCK_MS,
  );
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

/** Must run within the caller's transaction after membership validation.
 * Returns extra response fields (create reports the new id). */
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
      kind: "point",
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
    insist(
      unit === tool.unit || pointCount === 0,
      409,
      "回答があるため、書き込む単位は変更できません。",
    );
    // Scenes that already hold points cannot be removed.
    if (pointCount > 0) {
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
    if (!host && tool.unit !== "individual") {
      const lock = activeLock(sql, tool.id, owner, scene, now);
      insist(
        existing.author === actor || (lock && lock.user === actor),
        403,
        "その点を消せるのは、書いた人か編集中の人だけです。",
      );
    }
    if (!host && tool.unit === "individual")
      insist(existing.author === actor, 403, "ほかの人の点は消せません。");
    sql(
      "DELETE FROM thinking_points WHERE tool=? AND owner=? AND scene=?",
      tool.id,
      owner,
      scene,
    );
    return undefined;
  }
  insist(false, 404, "思考ツールの操作が見つかりません。");
  return undefined;
}
