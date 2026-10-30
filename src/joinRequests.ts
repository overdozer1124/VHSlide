export const JOIN_TTL = 24 * 60 * 60 * 1000;
export const joinSchema = `CREATE TABLE IF NOT EXISTS join_requests (
 id TEXT PRIMARY KEY, deck TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id), invite_hash TEXT NOT NULL,
 created INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 UNIQUE(deck,user_id));
 CREATE INDEX IF NOT EXISTS join_requests_deck ON join_requests(deck,status,created);`;
type SQL = (
  query: string,
  ...args: (string | number)[]
) => Iterable<Record<string, any>>;
export class JoinRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
function requireJoin(
  value: unknown,
  status: number,
  message: string,
): asserts value {
  if (!value) throw new JoinRequestError(status, message);
}
const one = (sql: SQL, q: string, ...args: (string | number)[]) =>
  [...sql(q, ...args)][0];
export type JoinState =
  | { status: "approved"; id: string }
  | { status: "pending" | "rejected"; requestId: string }
  | { status: "expired" };
export function requestJoin(
  sql: SQL,
  deck: string,
  user: string,
  hash: string,
  now = Date.now(),
): JoinState {
  if (
    one(
      sql,
      "SELECT user_id FROM members WHERE deck=? AND user_id=?",
      deck,
      user,
    )
  )
    return { status: "approved", id: deck };
  const prior = one(
    sql,
    "SELECT * FROM join_requests WHERE deck=? AND user_id=?",
    deck,
    user,
  );
  if (
    prior &&
    prior.invite_hash === hash &&
    prior.created > now - JOIN_TTL &&
    prior.status !== "approved"
  )
    return { status: prior.status, requestId: prior.id } as JoinState;
  sql("DELETE FROM join_requests WHERE created<=?", now - JOIN_TTL);
  requireJoin(
    Number(
      one(
        sql,
        "SELECT COUNT(*) AS n FROM join_requests WHERE deck=? AND status<>'approved'",
        deck,
      )!.n,
    ) < 100,
    429,
    "参加申請が多いため、ホストに連絡してください。",
  );
  const id = crypto.randomUUID();
  sql(
    "INSERT INTO join_requests VALUES(?,?,?,?,?,'pending') ON CONFLICT(deck,user_id) DO UPDATE SET id=excluded.id,invite_hash=excluded.invite_hash,created=excluded.created,status='pending'",
    id,
    deck,
    user,
    hash,
    now,
  );
  return { status: "pending", requestId: id };
}
export function joinState(
  sql: SQL,
  id: string,
  user: string,
  now = Date.now(),
): JoinState {
  const row = one(
    sql,
    "SELECT * FROM join_requests WHERE id=? AND user_id=?",
    id,
    user,
  );
  if (
    !row ||
    row.created <= now - JOIN_TTL ||
    !one(
      sql,
      "SELECT id FROM decks WHERE id=? AND NOT EXISTS(SELECT 1 FROM work_trash WHERE deck=decks.id)",
      row.deck,
    )
  )
    return { status: "expired" };
  if (
    one(
      sql,
      "SELECT user_id FROM members WHERE deck=? AND user_id=?",
      row.deck,
      user,
    )
  )
    return { status: "approved", id: row.deck };
  if (
    row.status === "approved" ||
    !one(
      sql,
      "SELECT hash FROM invites WHERE deck=? AND hash=?",
      row.deck,
      row.invite_hash,
    )
  )
    return { status: "expired" };
  return { status: row.status, requestId: id } as JoinState;
}
export function pendingJoins(sql: SQL, deck: string, now = Date.now()) {
  return [
    ...sql(
      "SELECT j.id,u.name,u.email,j.created FROM join_requests j JOIN users u ON u.id=j.user_id JOIN invites i ON i.deck=j.deck AND i.hash=j.invite_hash WHERE j.deck=? AND j.status='pending' AND j.created>? AND NOT EXISTS(SELECT 1 FROM members m WHERE m.deck=j.deck AND m.user_id=j.user_id) ORDER BY j.created,j.id",
      deck,
      now - JOIN_TTL,
    ),
  ];
}
export function pendingJoinCountSQL(userExpression: string) {
  return `CASE WHEN decks.owner=${userExpression} THEN (SELECT COUNT(*) FROM join_requests j JOIN invites i ON i.deck=j.deck AND i.hash=j.invite_hash WHERE j.deck=decks.id AND j.status='pending' AND j.created>CAST(strftime('%s','now') AS INTEGER)*1000-${JOIN_TTL} AND NOT EXISTS(SELECT 1 FROM members m WHERE m.deck=j.deck AND m.user_id=j.user_id)) ELSE 0 END AS pendingRequests`;
}
/** Caller holds a durable transaction and has rechecked host access. Validate the whole batch before granting anyone. */
export function decideJoins(
  sql: SQL,
  deck: string,
  value: unknown,
  approve: boolean,
  now = Date.now(),
) {
  const ids = (value as any)?.requestIds;
  requireJoin(
    Array.isArray(ids) &&
      ids.length > 0 &&
      ids.length <= 100 &&
      new Set(ids).size === ids.length &&
      ids.every((id) => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)),
    400,
    "申請を1〜100件選択してください。",
  );
  const records = ids.map((id) =>
    one(sql, "SELECT * FROM join_requests WHERE id=? AND deck=?", id, deck),
  );
  for (const r of records)
    requireJoin(
      r &&
        r.created > now - JOIN_TTL &&
        ((approve &&
          r.status === "approved" &&
          one(
            sql,
            "SELECT user_id FROM members WHERE deck=? AND user_id=?",
            deck,
            r.user_id,
          )) ||
          ((r.status === (approve ? "pending" : "rejected") ||
            (!approve && r.status === "pending")) &&
            one(
              sql,
              "SELECT hash FROM invites WHERE deck=? AND hash=?",
              deck,
              r.invite_hash,
            ))),
      409,
      "参加申請が更新・失効しました。一覧を更新してください。",
    );
  for (const r of records) {
    if (approve)
      sql("INSERT OR IGNORE INTO members VALUES(?,?)", deck, r!.user_id);
    sql(
      "UPDATE join_requests SET status=? WHERE id=?",
      approve ? "approved" : "rejected",
      r!.id,
    );
  }
  return { ok: true, count: records.length };
}
