import { it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { digestBytes, revisionQuery, revisionSchema } from "./backupProtocol";
it("hashes only the visible bytes, including pooled Buffer slices", async () => {
  const backing = Buffer.allocUnsafe(200);
  backing.fill(9);
  const bytes = backing.subarray(41, 59);
  bytes.fill(1);
  expect(await digestBytes(bytes)).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  expect(
    await digestBytes(
      new Uint8Array(backing.buffer, backing.byteOffset + 41, 18),
    ),
  ).toBe(await digestBytes(bytes));
});
it("node revisions are atomic with rollback, detect ABA and stay scoped to affected works", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,email TEXT); CREATE TABLE decks(id TEXT PRIMARY KEY);
 CREATE TABLE members(deck TEXT,user_id TEXT); CREATE TABLE grants(deck TEXT); CREATE TABLE recipients(deck TEXT);
 CREATE TABLE assets(deck TEXT); CREATE TABLE updates(deck TEXT); CREATE TABLE comments(deck TEXT,text TEXT);`);
    db.exec(revisionSchema("node"));
    const rev = (id: string) =>
      (db.prepare(revisionQuery).get(id) as { revision: string }).revision;
    db.exec(
      "INSERT INTO users VALUES('a','A','a@test'); INSERT INTO decks VALUES('one'),('two'); INSERT INTO members VALUES('one','a'); INSERT INTO comments VALUES('one','A');",
    );
    const initial = rev("one"),
      other = rev("two");
    db.exec("BEGIN; UPDATE comments SET text='B'; ROLLBACK;");
    expect(rev("one")).toBe(initial);
    db.exec("UPDATE comments SET text='B'; UPDATE comments SET text='A';");
    expect(BigInt(rev("one"))).toBe(BigInt(initial) + 2n);
    expect(rev("two")).toBe(other);
    const before = rev("one");
    db.exec("UPDATE users SET name='別名' WHERE id='a';");
    expect(BigInt(rev("one"))).toBe(BigInt(before) + 1n);
    expect(rev("two")).toBe(other);
  } finally {
    db.close();
  }
});
it("room revisions survive deletion and reject overflow instead of wrapping", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE snapshot(part INTEGER); CREATE TABLE updates(seq INTEGER); CREATE TABLE comments(id TEXT);
 CREATE TABLE assets(id TEXT); CREATE TABLE asset_chunks(asset TEXT); CREATE TABLE meta(key TEXT,value TEXT);`);
    db.exec(revisionSchema("room"));
    db.exec(
      "INSERT INTO meta VALUES('id','work'); INSERT INTO comments VALUES('n'); DELETE FROM comments; DELETE FROM meta;",
    );
    expect(
      (db.prepare(revisionQuery).get("room") as { revision: string }).revision,
    ).toBe("4");
    db.exec(
      "UPDATE backup_revisions SET rev=9223372036854775807 WHERE id='room';",
    );
    expect(() => db.exec("INSERT INTO updates VALUES(1)")).toThrow();
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM updates").get() as { n: number })
        .n,
    ).toBe(0);
    expect(
      (db.prepare(revisionQuery).get("room") as { revision: string }).revision,
    ).toBe("9223372036854775807");
  } finally {
    db.close();
  }
});
