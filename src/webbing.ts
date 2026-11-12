import type { HistorySQL } from "./historyStore.ts";

/** Shared webbing-map (brainstorming web) activities.
 *
 * One map lives on one slide; every participant writes into the same map.
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
};
export type WebbingNode = {
  id: string;
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
const MAX_NODES = 200;
export const webbingSchema = `
CREATE TABLE IF NOT EXISTS webbing_maps(id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE, title TEXT NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS webbing_maps_deck ON webbing_maps(deck);
CREATE TABLE IF NOT EXISTS webbing_nodes(id TEXT PRIMARY KEY, map TEXT NOT NULL REFERENCES webbing_maps(id) ON DELETE CASCADE, parent TEXT, author TEXT NOT NULL, text TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS webbing_nodes_map ON webbing_nodes(map);
CREATE TABLE IF NOT EXISTS webbing_locks(map TEXT NOT NULL REFERENCES webbing_maps(id) ON DELETE CASCADE, node TEXT NOT NULL, user TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(map,node));`;
function readMap(row: Record<string, any>): WebbingMap {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    created: row.created,
  };
}
function cleanText(value: unknown, label: string): string {
  insist(
    typeof value === "string" && value.trim().length > 0 && value.length <= 100,
    400,
    `${label}は1〜100文字で入力してください。`,
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
      const nodes = [
        ...sql(
          "SELECT n.*,u.name AS author_name FROM webbing_nodes n LEFT JOIN users u ON u.id=n.author WHERE n.map=? ORDER BY n.created,n.id",
          map.id,
        ),
      ].map(
        (n): WebbingNode => ({
          id: n.id,
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
    const map: WebbingMap = {
      id: crypto.randomUUID(),
      title,
      status: "draft",
      created: now,
    };
    sql(
      "INSERT INTO webbing_maps VALUES(?,?,?,?,?)",
      map.id,
      deck,
      map.title,
      map.status,
      map.created,
    );
    sql(
      "INSERT INTO webbing_nodes VALUES(?,?,?,?,?,?,?,?,?)",
      crypto.randomUUID(),
      map.id,
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
      "INSERT INTO webbing_nodes VALUES(?,?,?,?,?,?,?,?,?)",
      nodeId,
      map.id,
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
    if (!node.parent && text !== map.title)
      sql(
        "UPDATE webbing_maps SET title=? WHERE id=? AND deck=?",
        text,
        map.id,
        deck,
      );
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
    insistCanWrite(map, host);
    insistNotLockedByOther(sql, map.id, node.id, actor, now);
    const me = [...sql("SELECT name FROM users WHERE id=?", actor)][0];
    sql(
      "INSERT INTO webbing_locks VALUES(?,?,?,?,?) ON CONFLICT(map,node) DO UPDATE SET user=excluded.user,name=excluded.name,expires=excluded.expires",
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
