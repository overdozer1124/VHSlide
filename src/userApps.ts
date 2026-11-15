import type { HistorySQL } from "./historyStore.ts";
import { normalizeEmbedUrl } from "./embedBinding.ts";

/**
 * アカウントに保存する「自分のアプリ」。URL登録と、単体HTMLファイルの
 * アップロードの2通りで追加できる。アップロードしたHTMLは /pub/apps/<id>
 * で配信される（推測できないID＋CSP sandbox で隔離）。
 */
export class UserAppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function check(
  ok: unknown,
  message: string,
  status = 400,
): asserts ok {
  if (!ok) throw new UserAppError(status, message);
}

export const USER_APP_MAX_BYTES = 10_000_000;
export const USER_APP_MAX_COUNT = 50;
/** 1行に収める base64 の長さ（保存先の行サイズ上限に余裕を持たせる）。 */
const CHUNK_CHARS = 400_000;

export const userAppSchema = `
CREATE TABLE IF NOT EXISTS user_apps (user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, url TEXT NOT NULL, size_bytes INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(user_id, id));
CREATE TABLE IF NOT EXISTS user_app_chunks (user_id TEXT NOT NULL, app_id TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(user_id, app_id, idx));
`;

export type UserApp = {
  id: string;
  name: string;
  kind: "upload" | "url";
  /** kind が "url" のときの登録URL。"upload" のときは ""（配信パスは id から決まる）。 */
  url: string;
  sizeBytes: number;
  created: number;
};

type Row = {
  id: string;
  name: string;
  kind: string;
  url: string;
  size_bytes: number;
  created: number;
};

export function listUserApps(sql: HistorySQL, userId: string): UserApp[] {
  return [
    ...sql(
      "SELECT id,name,kind,url,size_bytes,created FROM user_apps WHERE user_id=? ORDER BY created ASC, id ASC",
      userId,
    ),
  ].map((row) => {
    const r = row as Row;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind === "upload" ? ("upload" as const) : ("url" as const),
      url: r.url,
      sizeBytes: r.size_bytes,
      created: r.created,
    };
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const SLICE = 0x8000;
  for (let i = 0; i < bytes.length; i += SLICE)
    binary += String.fromCharCode(...bytes.subarray(i, i + SLICE));
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** HTML文字列を base64 化して CHUNK_CHARS ごとに割る（ASCIIだけなので安全に分割・再結合できる）。 */
export function encodeUserAppHtml(html: string): string[] {
  const base64 = bytesToBase64(new TextEncoder().encode(html));
  const chunks: string[] = [];
  for (let i = 0; i < base64.length; i += CHUNK_CHARS)
    chunks.push(base64.slice(i, i + CHUNK_CHARS));
  return chunks;
}

export function decodeUserAppHtml(chunks: string[]): string {
  return new TextDecoder().decode(base64ToBytes(chunks.join("")));
}

function cleanName(value: unknown): string {
  check(
    typeof value === "string",
    "アプリの名前を入力してください。",
  );
  const name = (value as string).trim();
  check(name.length > 0, "アプリの名前を入力してください。");
  check(
    [...name].length <= 80,
    "アプリの名前は80文字までです。",
  );
  return name;
}

export function addUserApp(
  sql: HistorySQL,
  userId: string,
  value: unknown,
  now: number,
): UserApp[] {
  check(
    value !== null && typeof value === "object",
    "アプリの情報が正しくありません。",
  );
  const data = value as { kind?: unknown; name?: unknown; url?: unknown; html?: unknown };
  const name = cleanName(data.name);
  const count = [
    ...sql("SELECT COUNT(*) AS n FROM user_apps WHERE user_id=?", userId),
  ][0] as unknown as { n: number };
  check(
    count.n < USER_APP_MAX_COUNT,
    `自分のアプリは${USER_APP_MAX_COUNT}件までです。`,
  );
  const id = crypto.randomUUID();
  if (data.kind === "url") {
    let url: string;
    try {
      url = normalizeEmbedUrl(
        typeof data.url === "string" ? data.url : "",
      );
    } catch (error) {
      throw new UserAppError(400, (error as Error).message);
    }
    sql(
      "INSERT INTO user_apps VALUES(?,?,?,?,?,?,?)",
      userId,
      id,
      name,
      "url",
      url,
      0,
      now,
    );
  } else if (data.kind === "upload") {
    check(
      typeof data.html === "string",
      "HTMLファイルの内容を読み取れませんでした。",
    );
    const html = data.html as string;
    const bytes = new TextEncoder().encode(html).length;
    check(bytes > 0, "HTMLファイルが空です。");
    check(
      bytes <= USER_APP_MAX_BYTES,
      `HTMLファイルは${USER_APP_MAX_BYTES / 1_000_000}MBまでです。`,
    );
    check(
      html.trimStart().startsWith("<"),
      "HTMLファイルではないようです。",
    );
    sql(
      "INSERT INTO user_apps VALUES(?,?,?,?,?,?,?)",
      userId,
      id,
      name,
      "upload",
      "",
      bytes,
      now,
    );
    encodeUserAppHtml(html).forEach((chunk, idx) =>
      sql(
        "INSERT INTO user_app_chunks VALUES(?,?,?,?)",
        userId,
        id,
        idx,
        chunk,
      ),
    );
  } else {
    check(false, "アプリの種類が正しくありません。");
  }
  return listUserApps(sql, userId);
}

export function deleteUserApp(
  sql: HistorySQL,
  userId: string,
  id: string,
): UserApp[] {
  sql("DELETE FROM user_app_chunks WHERE user_id=? AND app_id=?", userId, id);
  sql("DELETE FROM user_apps WHERE user_id=? AND id=?", userId, id);
  return listUserApps(sql, userId);
}

/** 配信側（認証なし・IDのみ）でアップロード済みHTMLを取り出す。無ければ null。 */
export function readUserAppHtml(sql: HistorySQL, id: string): string | null {
  const app = [
    ...sql("SELECT kind FROM user_apps WHERE id=?", id),
  ][0] as unknown as { kind: string } | undefined;
  if (!app || app.kind !== "upload") return null;
  const chunks = [
    ...sql(
      "SELECT data FROM user_app_chunks WHERE app_id=? ORDER BY idx ASC",
      id,
    ),
  ].map((row) => (row as unknown as { data: string }).data);
  if (!chunks.length) return null;
  return decodeUserAppHtml(chunks);
}
