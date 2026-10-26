import { test, expect, type Page } from "@playwright/test";
import * as Y from "yjs";
import { readFile } from "node:fs/promises";
import { sample, parseDeck } from "../../src/model";
import { fromBase64, toBase64, readSharedDeck } from "../../src/sharedDeck";
import { COLLABORATION_PROTOCOL } from "../../src/collaborationProtocol";
const origin = "http://127.0.0.1:3187";
async function fixture(page: Page, name: string, large = false) {
  await page.route("https://accounts.google.com/**", (r) => r.abort());
  const credential =
    process.env.VHSLIDE_TEST_BACKEND === "cloudflare"
      ? await (await page.request.get(`/__test/token?name=${name}`)).text()
      : name;
  const login = await page.request.post("/api/auth/google", {
    headers: { Origin: origin },
    data: { credential },
  });
  expect(login.status()).toBe(200);
  const user = (await login.json()).user.id,
    book = sample();
  if (large) {
    const first = book.slides[0];
    book.slides = Array.from({ length: 400 }, (_, i) => ({
      ...structuredClone(first),
      id: crypto.randomUUID(),
      x: i % 10,
      y: Math.floor(i / 10),
      title: i ? `サンプル${i}` : first.title,
      elements: first.elements.map((e) => ({ ...e, id: crypto.randomUUID() })),
    }));
  }
  const made = await page.request.post("/api/decks", {
    headers: { Origin: origin },
    data: parseDeck(JSON.stringify(book)),
  });
  expect(made.status()).toBe(201);
  const { id } = await made.json(),
    result = await (await page.request.get(`/api/decks/${id}`)).json();
  await page.goto("/");
  return {
    id,
    key: `${user}/${id}`,
    user,
    result,
    book: parseDeck(JSON.stringify(book)),
  };
}
function broken(state: string, size = -1) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(state));
  const deck = readSharedDeck(doc),
    slide = doc.getMap<Y.Map<unknown>>("slides").get(deck.slides[0].id)!,
    elements = slide.get("elements") as Y.Map<Y.Map<unknown>>;
  elements.get(deck.slides[0].elements[0].id)!.set("fontSize", size);
  const bytes = Array.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return bytes;
}
async function seed(page: Page, key: string, bytes: number[]) {
  await page.evaluate(
    async ({ key, bytes, protocol }) => {
      await new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("vhslide-cloud", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("documents");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("documents", "readwrite");
          tx.objectStore("documents").put(
            { data: new Uint8Array(bytes), protocol },
            key,
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    { key, bytes, protocol: COLLABORATION_PROTOCOL },
  );
}
async function caches(page: Page, key: string) {
  return page.evaluate(
    async (key) =>
      new Promise<{
        primary: number[];
        records: { documents: number[][]; acknowledged: boolean }[];
      }>((resolve, reject) => {
        const r = indexedDB.open("vhslide-cloud", 1);
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            s = db.transaction("documents").objectStore("documents"),
            primary = s.get(key),
            all = s.getAll(),
            keys = s.getAllKeys();
          keys.onsuccess = () => {
            resolve({
              primary: Array.from(primary.result.data ?? primary.result),
              records: all.result
                .filter((_v, i) =>
                  String(keys.result[i]).startsWith(`recovery/${key}/`),
                )
                .map((v) => ({
                  documents: v.documents.map((d: any) =>
                    Array.from(d.data ?? d),
                  ),
                  acknowledged: !!v.acknowledged,
                })),
            });
            db.close();
          };
        };
      }),
    key,
  );
}
async function serverBook(page: Page, id: string) {
  const value = await (await page.request.get(`/api/decks/${id}`)).json(),
    doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(value.state));
  const book = parseDeck(JSON.stringify(readSharedDeck(doc)));
  doc.destroy();
  return book;
}

test("host automatically opens a 400-page work after isolating an invalid cache and retains its recovery file", async ({
  page,
}, info) => {
  const f = await fixture(page, `${info.project.name}-cache-host`, true),
    bytes = broken(f.result.state);
  await seed(page, f.key, bytes);
  await page.goto(`/?room=${f.id}`);
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const notice = page.getByRole("status", { name: "端末の一時保存の保護" });
  await expect(notice).toContainText("退避しました");
  expect((await serverBook(page, f.id)).slides).toEqual(f.book.slides);
  let saved = await caches(page, f.key);
  expect(saved.records).toHaveLength(1);
  expect(saved.records[0].documents).toEqual([bytes]);
  const primary = new Y.Doc();
  Y.applyUpdate(primary, new Uint8Array(saved.primary));
  expect(() =>
    parseDeck(JSON.stringify(readSharedDeck(primary))),
  ).not.toThrow();
  primary.destroy();
  const downloading = page.waitForEvent("download");
  await notice
    .getByRole("button", { name: "復旧用データをダウンロード", exact: true })
    .click();
  const data = JSON.parse(
    await readFile((await (await downloading).path())!, "utf8"),
  );
  expect(data.format).toBe("vhslide-local-recovery");
  expect(data.documents[0].data).toEqual({
    encoding: "base64",
    data: toBase64(new Uint8Array(bytes)),
  });
  await page.locator(".deck-title").fill("復帰後の編集");
  await expect
    .poll(async () => (await serverBook(page, f.id)).title)
    .toBe("復帰後の編集");
  await notice
    .getByRole("button", { name: "復旧の案内を閉じる", exact: true })
    .click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  await expect(notice).toHaveCount(0);
  await page.getByRole("button", { name: "クラウド", exact: true }).click();
  await page.getByRole("tab", { name: /作品一覧/ }).click();
  await expect(
    page.getByRole("button", {
      name: "復旧用データをダウンロード",
      exact: true,
    }),
  ).toBeVisible();
  saved = await caches(page, f.key);
  expect(saved.records[0].documents).toEqual([bytes]);
  expect(saved.records[0].acknowledged).toBe(true);
  await page.screenshot({
    path: info.outputPath("protected-cache-library.png"),
  });
});

test("malformed Yjs bytes cannot contaminate the authoritative snapshot", async ({
  page,
}, info) => {
  const f = await fixture(page, `${info.project.name}-bad-bytes`),
    bytes = [1, 2, 3];
  await seed(page, f.key, bytes);
  await page.goto(`/?room=${f.id}`);
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  expect((await caches(page, f.key)).records[0].documents).toEqual([bytes]);
  expect((await serverBook(page, f.id)).slides).toEqual(f.book.slides);
});

test("failed quarantine preserves the source and stays read-only until protection can be retried", async ({
  page,
}, info) => {
  const f = await fixture(page, `${info.project.name}-cache-quota`),
    bytes = broken(f.result.state);
  await seed(page, f.key, bytes);
  await page.addInitScript(() => {
    (window as any).__failRecovery = true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if ((window as any).__failRecovery && String(key).startsWith("recovery/"))
        throw new DOMException("local quota fixture", "QuotaExceededError");
      return put.call(this, value, key);
    };
  });
  await page.goto(`/?room=${f.id}`);
  const notice = page.getByRole("status", { name: "端末の一時保存の保護" });
  await expect(notice).toContainText("読み取り専用");
  expect((await caches(page, f.key)).primary).toEqual(bytes);
  expect((await serverBook(page, f.id)).slides).toEqual(f.book.slides);
  await page
    .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
    .click();
  await expect(
    page
      .locator(".editor-toolbar")
      .getByRole("button", { name: "文字", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => ((window as any).__failRecovery = false));
  await notice
    .getByRole("button", { name: "一時保存の保護を再試行", exact: true })
    .click();
  await expect(notice).toContainText("退避しました");
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  expect(
    (await caches(page, f.key)).records[0].documents.every(
      (d) => JSON.stringify(d) === JSON.stringify(bytes),
    ),
  ).toBe(true);
});

test("an intervening cache write from another tab is archived with the inspected copy", async ({
  page,
}, info) => {
  const f = await fixture(page, `${info.project.name}-cache-race`),
    a = broken(f.result.state, -1),
    b = broken(f.result.state, -2);
  await seed(page, f.key, a);
  await page.addInitScript(
    ({ key, bytes, protocol }) => {
      let injected = false;
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (query) {
        const request = get.call(this, query);
        if (query === key && !injected) {
          injected = true;
          request.addEventListener("success", () => {
            const tx = this.transaction.db.transaction(
              "documents",
              "readwrite",
            );
            tx.objectStore("documents").put(
              { data: new Uint8Array(bytes), protocol },
              key,
            );
          });
        }
        return request;
      };
    },
    { key: f.key, bytes: b, protocol: COLLABORATION_PROTOCOL },
  );
  await page.goto(`/?room=${f.id}`);
  await expect(page.locator(".cloud-presence")).toContainText(
    "クラウドに保存済み",
  );
  const saved = await caches(page, f.key);
  expect(saved.records[0].documents).toEqual(expect.arrayContaining([a, b]));
  expect((await serverBook(page, f.id)).slides).toEqual(f.book.slides);
});

test("invalid server data is reported separately and never replaces either saved copy", async ({
  page,
}, info) => {
  const f = await fixture(page, `${info.project.name}-invalid-server`),
    original = Array.from(fromBase64(f.result.state));
  await seed(page, f.key, original);
  await page.route(`**/api/decks/${f.id}`, (r) =>
    r.fulfill({
      json: {
        ...f.result,
        state: toBase64(new Uint8Array(broken(f.result.state))),
      },
    }),
  );
  await page.goto(`/?room=${f.id}`);
  await expect(page.getByRole("dialog")).toContainText(
    "クラウドに保存されている作品データを読み込めません",
  );
  expect((await caches(page, f.key)).primary).toEqual(original);
  expect((await caches(page, f.key)).records).toHaveLength(0);
  const session = await (await page.request.get("/api/session")).json();
  expect(session.user.id).toBe(f.user);
});
