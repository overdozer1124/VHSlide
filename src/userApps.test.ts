import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { HistorySQL } from "./historyStore";
import {
  addUserApp,
  deleteUserApp,
  listUserApps,
  readUserAppHtml,
  userAppSchema,
  UserAppError,
  USER_APP_MAX_COUNT,
} from "./userApps";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(userAppSchema);
  const sql: HistorySQL = (query, ...args) => db.prepare(query).all(...args);
  return { db, sql };
}

function fails(fn: () => unknown, status = 400) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(UserAppError);
    expect((e as UserAppError).status).toBe(status);
    return;
  }
  throw new Error("expected the command to fail");
}

const HTML =
  "<!doctype html><html><body><h1>テスト</h1><script>1</script></body></html>";

describe("user apps", () => {
  it("registers URL apps and lists them per user", () => {
    const { sql } = fixture();
    const apps = addUserApp(
      sql,
      "alice",
      { kind: "url", name: " 外部ツール ", url: "https://example.com/tool" },
      1000,
    );
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      name: "外部ツール",
      kind: "url",
      url: "https://example.com/tool",
    });
    expect(listUserApps(sql, "bob")).toEqual([]);
  });

  it("rejects dangerous URLs and bad names", () => {
    const { sql } = fixture();
    fails(() =>
      addUserApp(
        sql,
        "alice",
        { kind: "url", name: "x", url: "javascript:alert(1)" },
        1,
      ),
    );
    fails(() =>
      addUserApp(sql, "alice", { kind: "url", name: " ", url: "https://a.b" }, 1),
    );
    fails(() =>
      addUserApp(
        sql,
        "alice",
        { kind: "url", name: "あ".repeat(81), url: "https://a.b" },
        1,
      ),
    );
  });

  it("stores uploaded HTML in chunks and reads it back intact", () => {
    const { sql } = fixture();
    const big = `<!doctype html><p>${"日本語の文章です。".repeat(60_000)}</p>`;
    const apps = addUserApp(
      sql,
      "alice",
      { kind: "upload", name: "自作", html: big },
      2000,
    );
    expect(apps[0].kind).toBe("upload");
    expect(apps[0].sizeBytes).toBe(new TextEncoder().encode(big).length);
    expect(readUserAppHtml(sql, apps[0].id)).toBe(big);
    expect(readUserAppHtml(sql, "missing-id")).toBeNull();
  });

  it("rejects empty, non-HTML and oversized uploads", () => {
    const { sql } = fixture();
    fails(() =>
      addUserApp(sql, "alice", { kind: "upload", name: "x", html: "" }, 1),
    );
    fails(() =>
      addUserApp(
        sql,
        "alice",
        { kind: "upload", name: "x", html: "ただの文章" },
        1,
      ),
    );
    fails(() =>
      addUserApp(
        sql,
        "alice",
        {
          kind: "upload",
          name: "x",
          html: `<p>${"a".repeat(10_000_001)}</p>`,
        },
        1,
      ),
    );
  });

  it("enforces the per-user app limit", () => {
    const { sql } = fixture();
    for (let i = 0; i < USER_APP_MAX_COUNT; i++)
      addUserApp(
        sql,
        "alice",
        { kind: "url", name: `app${i}`, url: "https://example.com" },
        i,
      );
    fails(() =>
      addUserApp(
        sql,
        "alice",
        { kind: "url", name: "over", url: "https://example.com" },
        999,
      ),
    );
  });

  it("deletes only the owner's apps, and the public copy goes with them", () => {
    const { sql } = fixture();
    const apps = addUserApp(
      sql,
      "alice",
      { kind: "upload", name: "自作", html: HTML },
      1,
    );
    const id = apps[0].id;
    expect(deleteUserApp(sql, "bob", id)).toEqual([]);
    expect(readUserAppHtml(sql, id)).toBe(HTML);
    expect(deleteUserApp(sql, "alice", id)).toEqual([]);
    expect(readUserAppHtml(sql, id)).toBeNull();
  });
});
