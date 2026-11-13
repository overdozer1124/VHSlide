import type { HistorySQL } from "./historyStore.ts";
import { deckGroups, effectiveGroupId } from "./groups.ts";
import { featureVersionSchema, versionTriggers } from "./featureVersions.ts";

/** Shared webbing-map (brainstorming web) activities.
 *
 * One map lives on one slide; every participant writes into the same map.
 * A map can be split into groups: each group webs on its own copy of the
 * map inside the same slide, participants join one group, write only in
 * their own group, and can view the other groups' maps read-only.
 * A node can only be edited or deleted by its author — or by the host, who
 * can edit and delete everything. While a participant edits a node, a
 * short-lived server lock keeps everyone else out of that node.
 */
export type WebbingStatus = "draft" | "open" | "closed";
export type WebbingMap = {
  id: string;
  title: string;
  status: WebbingStatus;
  created: number;
  /** True when the map is split by the deck's shared groups. */
  grouped: boolean;
};
export type WebbingNode = {
  id: string;
  groupId: string;
  parentId: string | null;
  text: string;
  x: number;
  y: number;
  authorId: string;
  authorName: string;
  created: number;
  updated: number;
};
export type WebbingLock = {
  nodeId: string;
  userId: string;
  name: string;
  expires: number;
};
export type WebbingView = WebbingMap & {
  nodes: WebbingNode[];
  locks: WebbingLock[];
};
export class WebbingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const insist = (ok: unknown, status: number, message: string): void => {
  if (!ok) throw new WebbingError(status, message);
};
export const WEBBING_W = 960;
export const WEBBING_H = 540;
export const WEBBING_LOCK_MS = 20000;
const MAX_MAPS = 10;
const MAX_NODES = 300;
export const webbingSchema =
  `
CREATE TABLE IF NOT EXISTS schema_markers(name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS webbing_maps(id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, title TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS webbing_maps_deck ON webbing_maps(deck);
CREATE TABLE IF NOT EXISTS webbing_nodes(id TEXT PRIMARY KEY, map TEXT NOT NULL REFERENCES webbing_maps(id) ON DELETE CASCADE, grp TEXT NOT NULL DEFAULT '', parent TEXT, author TEXT NOT NULL, text TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS webbing_nodes_map ON webbing_nodes(map);
CREATE TABLE IF NOT EXISTS webbing_locks(map TEXT NOT NULL REFERENCES webbing_maps(id) ON DELETE CASCADE, node TEXT NOT NULL, user TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(map,node));` +
  featureVersionSchema +
  versionTriggers("webbing_maps", "webbing", (a) => `${a}.deck`) +
  versionTriggers(
    "webbing_nodes",
    "webbing",
    (a) => `COALESCE((SELECT deck FROM webbing_maps WHERE id=${a}.map),'')`,
  ) +
  versionTriggers(
    "webbing_locks",
    "webbing",
    (a) => `COALESCE((SELECT deck FROM webbing_maps WHERE id=${a}.map),'')`,
  );
/** Older databases lack the grp column on nodes and the grouped/creator
 * columns on maps. Add whatever is missing; existing maps stay ungrouped. */
export function ensureWebbingShape(sql: HistorySQL): void {
  sql("CREATE TABLE IF NOT EXISTS schema_markers(name TEXT PRIMARY KEY)");
  const done = [
    ...sql("SELECT name FROM schema_markers WHERE name='webbing-shape-2'"),
  ][0];
  if (done) return;
  const nodeColumns = [...sql("PRAGMA table_info(webbing_nodes)")].map(
    (c) => c.name,
  );
  if (nodeColumns.length && !nodeColumns.includes("grp"))
    sql("ALTER TABLE webbing_nodes ADD COLUMN grp TEXT NOT NULL DEFAULT ''");
  const mapColumns = [...sql("PRAGMA table_info(webbing_maps)")].map(
    (c) => c.name,
  );
  if (mapColumns.length && !mapColumns.includes("grouped"))
    sql(
      "ALTER TABLE webbing_maps ADD COLUMN grouped INTEGER NOT NULL DEFAULT 0",
    );
  if (mapColumns.length && !mapColumns.includes("creator"))
    sql("ALTER TABLE webbing_maps ADD COLUMN creator TEXT NOT NULL DEFAULT ''");
  // Rows written while the node INSERT was positional landed shifted by
  // one column on ALTER-upgraded databases (grp went to parent, the text
  // into x, ...). They are exactly the rows whose x is text; shift every
  // field back. SQLite reads pre-update values for every SET expression.
  sql(
    "UPDATE webbing_nodes SET grp=parent, parent=author, author=text, text=CAST(x AS TEXT), x=y, y=created, created=updated, updated=CAST(grp AS INTEGER) WHERE typeof(x)='text'",
  );
  // The same bug made the root check miss on every read, multiplying
  // identical theme roots. Keep the earliest root per map+group and drop
  // later childless duplicates.
  sql(
    `DELETE FROM webbing_nodes WHERE parent='' AND EXISTS (
       SELECT 1 FROM webbing_nodes o
       WHERE o.map=webbing_nodes.map AND o.grp=webbing_nodes.grp AND o.parent=''
         AND (o.created < webbing_nodes.created
              OR (o.created=webbing_nodes.created AND o.id < webbing_nodes.id))
     ) AND NOT EXISTS (
       SELECT 1 FROM webbing_nodes c WHERE c.parent=webbing_nodes.id
     )`,
  );
  sql("INSERT OR IGNORE INTO schema_markers VALUES('webbing-shape-2')");
}
/** A grouped map keeps one theme root per deck group; groups defined or
 * added later get their root on first sight. */
function ensureGroupedRoots(
  sql: HistorySQL,
  deck: string,
  map: WebbingMap,
  creator: string,
  now: number,
): void {
  if (!map.grouped) return;
  const roots = new Set(
    [...sql("SELECT grp FROM webbing_nodes WHERE map=? AND parent=''", map.id)].map(
      (r) => r.grp as string,
    ),
  );
  for (const group of deckGroups(sql, deck)) {
    if (roots.has(group.id)) continue;
    sql(
      "INSERT INTO webbing_nodes(id,map,grp,parent,author,text,x,y,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)",
      crypto.randomUUID(),
      map.id,
      group.id,
      "",
      creator,
      map.title,
      WEBBING_W / 2,
      WEBBING_H / 2,
      now,
      now,
    );
  }
}
function readMap(row: Record<string, any>): WebbingMap {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    created: row.created,
    grouped: row.grouped === 1 || row.grouped === true,
  };
}
function cleanText(
  value: unknown,
  label: string,
  max = 100,
): string {
  insist(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    400,
    `${label}は1〜${max}文字で入力してください。`,
  );
  return (value as string).trim().replace(/\s+/g, " ");
}
function cleanCoord(value: unknown, max: number): number {
  insist(
    typeof value === "number" && Number.isFinite(value),
    400,
    "位置を確認してください。",
  );
  return Math.min(max, Math.max(0, value as number));
}
export function webbingList(
  sql: HistorySQL,
  deck: string,
  host: boolean,
): WebbingView[] {
  ensureWebbingShape(sql);
  const now = Date.now();
  return [
    ...sql(
      "SELECT * FROM webbing_maps WHERE deck=? ORDER BY created DESC,id",
      deck,
    ),
  ]
    .filter((row) => host || row.status !== "draft")
    .map((row) => {
      const map = readMap(row);
      ensureGroupedRoots(sql, deck, map, (row.creator as string) ?? "", now);
      const nodes = [
        ...sql(
          "SELECT n.*,u.name AS author_name FROM webbing_nodes n LEFT JOIN users u ON u.id=n.author WHERE n.map=? ORDER BY n.created,n.id",
          map.id,
        ),
      ].map(
        (n): WebbingNode => ({
          id: n.id,
          groupId: n.grp,
          parentId: n.parent ? n.parent : null,
          text: n.text,
          x: n.x,
          y: n.y,
          authorId: n.author,
          authorName: n.author_name || "名前未登録",
          created: n.created,
          updated: n.updated,
        }),
      );
      const locks = [
        ...sql(
          "SELECT node,user,name,expires FROM webbing_locks WHERE map=? AND expires>?",
          map.id,
          now,
        ),
      ].map(
        (l): WebbingLock => ({
          nodeId: l.node,
          userId: l.user,
          name: l.name,
          expires: l.expires,
        }),
      );
      return { ...map, nodes, locks };
    });
}
function loadMap(sql: HistorySQL, deck: string, id: string | undefined) {
  const row = [
    ...sql("SELECT * FROM webbing_maps WHERE deck=? AND id=?", deck, id ?? ""),
  ][0];
  insist(row, 404, "ウェビングマップが見つかりません。");
  return readMap(row);
}
function loadNode(sql: HistorySQL, map: string, nodeId: unknown) {
  insist(
    typeof nodeId === "string" && nodeId.length > 0,
    400,
    "項目を指定してください。",
  );
  const row = [
    ...sql(
      "SELECT * FROM webbing_nodes WHERE map=? AND id=?",
      map,
      nodeId as string,
    ),
  ][0];
  insist(row, 404, "その項目は既に削除されています。");
  return row;
}
function activeLock(sql: HistorySQL, map: string, node: string, now: number) {
  return [
    ...sql(
      "SELECT user,name FROM webbing_locks WHERE map=? AND node=? AND expires>?",
      map,
      node,
      now,
    ),
  ][0];
}
function insistCanWrite(map: WebbingMap, host: boolean) {
  insist(
    host || map.status === "open",
    409,
    "このマップは書き込みを受け付けていません。",
  );
}
function insistNotLockedByOther(
  sql: HistorySQL,
  map: string,
  node: string,
  actor: string,
  now: number,
) {
  const lock = activeLock(sql, map, node, now);
  insist(
    !lock || lock.user === actor,
    409,
    `${lock?.name ?? "他の参加者"}さんが編集中です。`,
  );
}
/** Must run within the caller's transaction after membership validation.
 * Returns extra response fields (create / node-add report the new id). */
export function webbingCommand(
  sql: HistorySQL,
  deck: string,
  actor: string,
  host: boolean,
  action: string,
  id: string | undefined,
  input: unknown,
): { createdId?: string } | undefined {
  ensureWebbingShape(sql);
  const value = input as Record<string, unknown>;
  insist(
    value && typeof value === "object" && !Array.isArray(value),
    400,
    "入力を確認してください。",
  );
  const now = Date.now();
  if (action === "create") {
    insist(host, 403, "ウェビングマップを作成できるのはホストだけです。");
    insist(
      [...sql("SELECT id FROM webbing_maps WHERE deck=?", deck)].length <
        MAX_MAPS,
      413,
      `ウェビングマップは作品ごとに${MAX_MAPS}件までです。`,
    );
    const title = cleanText(value.title, "中心のテーマ");
    insist(
      value.grouped === undefined || typeof value.grouped === "boolean",
      400,
      "グループ分けの指定を確認してください。",
    );
    const map: WebbingMap = {
      id: crypto.randomUUID(),
      title,
      status: "draft",
      created: now,
      grouped: value.grouped === true,
    };
    sql(
      "INSERT INTO webbing_maps(id,deck,title,status,created,grouped,creator) VALUES(?,?,?,?,?,?,?)",
      map.id,
      deck,
      map.title,
      map.status,
      map.created,
      map.grouped ? 1 : 0,
      actor,
    );
    if (map.grouped) ensureGroupedRoots(sql, deck, map, actor, now);
    else
      sql(
        "INSERT INTO webbing_nodes(id,map,grp,parent,author,text,x,y,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)",
        crypto.randomUUID(),
        map.id,
        "",
        "",
        actor,
        title,
        WEBBING_W / 2,
        WEBBING_H / 2,
        now,
        now,
      );
    return { createdId: map.id };
  }
  const map = loadMap(sql, deck, id);
  if (action === "status") {
    insist(host, 403, "受付を変更できるのはホストだけです。");
    insist(
      ["open", "closed"].includes(String(value.status)),
      400,
      "受付状態を確認してください。",
    );
    sql(
      "UPDATE webbing_maps SET status=? WHERE id=? AND deck=?",
      value.status as string,
      map.id,
      deck,
    );
  } else if (action === "delete") {
    insist(host, 403, "削除できるのはホストだけです。");
    sql("DELETE FROM webbing_locks WHERE map=?", map.id);
    sql("DELETE FROM webbing_nodes WHERE map=?", map.id);
    sql("DELETE FROM webbing_maps WHERE id=? AND deck=?", map.id, deck);
  } else if (action === "node-add") {
    insistCanWrite(map, host);
    const parent = loadNode(sql, map.id, value.parentId);
    insist(
      host ||
        !map.grouped ||
        effectiveGroupId(sql, deck, actor) === parent.grp,
      403,
      "書き込めるのは、自分のグループのマップだけです。まず自分のグループに参加してください。",
    );
    const text = cleanText(value.text, "書き込み");
    const count = [
      ...sql("SELECT COUNT(*) AS n FROM webbing_nodes WHERE map=?", map.id),
    ][0].n;
    insist(
      count < MAX_NODES,
      413,
      `書き込みは1つのマップに${MAX_NODES}件までです。`,
    );
    const nodeId = crypto.randomUUID();
    sql(
      "INSERT INTO webbing_nodes(id,map,grp,parent,author,text,x,y,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)",
      nodeId,
      map.id,
      parent.grp,
      parent.id,
      actor,
      text,
      cleanCoord(value.x, WEBBING_W),
      cleanCoord(value.y, WEBBING_H),
      now,
      now,
    );
    return { createdId: nodeId };
  } else if (action === "node-edit") {
    const node = loadNode(sql, map.id, value.nodeId);
    insist(
      host || node.author === actor,
      403,
      "編集できるのは、書いた本人とホストだけです。",
    );
    insistCanWrite(map, host);
    insistNotLockedByOther(sql, map.id, node.id, actor, now);
    const text =
      value.text === undefined ? node.text : cleanText(value.text, "書き込み");
    const x = value.x === undefined ? node.x : cleanCoord(value.x, WEBBING_W);
    const y = value.y === undefined ? node.y : cleanCoord(value.y, WEBBING_H);
    sql(
      "UPDATE webbing_nodes SET text=?,x=?,y=?,updated=? WHERE id=? AND map=?",
      text,
      x,
      y,
      now,
      node.id,
      map.id,
    );
    if (!node.parent && text !== map.title) {
      // The theme is shared by every group: keep all roots and the title in sync.
      sql(
        "UPDATE webbing_nodes SET text=?,updated=? WHERE map=? AND parent=''",
        text,
        now,
        map.id,
      );
      sql(
        "UPDATE webbing_maps SET title=? WHERE id=? AND deck=?",
        text,
        map.id,
        deck,
      );
    }
  } else if (action === "node-delete") {
    const node = loadNode(sql, map.id, value.nodeId);
    insist(
      !!node.parent,
      400,
      "中心のテーマは削除できません。マップごと削除してください。",
    );
    insist(
      host || node.author === actor,
      403,
      "削除できるのは、書いた本人とホストだけです。",
    );
    insistCanWrite(map, host);
    insistNotLockedByOther(sql, map.id, node.id, actor, now);
    // Delete the whole branch below the node as well.
    const all = [
      ...sql("SELECT id,parent FROM webbing_nodes WHERE map=?", map.id),
    ];
    const doomed = new Set<string>([node.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const row of all)
        if (row.parent && doomed.has(row.parent) && !doomed.has(row.id)) {
          doomed.add(row.id);
          grew = true;
        }
    }
    for (const nodeId of doomed) {
      sql("DELETE FROM webbing_locks WHERE map=? AND node=?", map.id, nodeId);
      sql("DELETE FROM webbing_nodes WHERE id=? AND map=?", nodeId, map.id);
    }
  } else if (action === "lock") {
    const node = loadNode(sql, map.id, value.nodeId);
    insist(
      host || node.author === actor,
      403,
      "編集できるのは、書いた本人とホストだけです。",
    );
    insistCanWrite(map, host);
    insistNotLockedByOther(sql, map.id, node.id, actor, now);
    const me = [...sql("SELECT name FROM users WHERE id=?", actor)][0];
    sql(
      "INSERT INTO webbing_locks(map,node,user,name,expires) VALUES(?,?,?,?,?) ON CONFLICT(map,node) DO UPDATE SET user=excluded.user,name=excluded.name,expires=excluded.expires",
      map.id,
      node.id,
      actor,
      me?.name || "名前未登録",
      now + WEBBING_LOCK_MS,
    );
  } else if (action === "unlock") {
    insist(
      typeof value.nodeId === "string" && value.nodeId.length > 0,
      400,
      "項目を指定してください。",
    );
    sql(
      "DELETE FROM webbing_locks WHERE map=? AND node=? AND user=?",
      map.id,
      value.nodeId as string,
      actor,
    );
  } else throw new WebbingError(404, "ウェビングマップの操作が見つかりません。");
  return undefined;
}
