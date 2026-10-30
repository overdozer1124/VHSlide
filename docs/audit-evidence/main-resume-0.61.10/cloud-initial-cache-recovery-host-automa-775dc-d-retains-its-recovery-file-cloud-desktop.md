# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cache-recovery.spec.ts >> host automatically opens a 400-page work after isolating an invalid cache and retains its recovery file
- Location: tests/cloud/cache-recovery.spec.ts:129:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.cloud-presence')
Expected substring: "クラウドに保存済み"
Received string:    "クラウドに保存中ホスト1人が参加中cloud-desktop-cache-host"
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('.cloud-presence') with timeout 5000ms
  - waiting for locator('.cloud-presence')
    - locator resolved to <div class="cloud-presence">…</div>
    - unexpected value "再接続中・端末に一時保存ホスト0人が参加中"
    2 × locator resolved to <div class="cloud-presence">…</div>
      - unexpected value "クラウドに保存中ホスト1人が参加中cloud-desktop-cache-host"

```

```yaml
- img
- status "クラウドに保存中 · 本文と付箋の保存状態です。端末へ書き出すJSONには付箋・共有設定・過去の版は含みません。": クラウドに保存中
- text: ホスト 1人が参加中
```

# Test source

```ts
  73  |           tx.oncomplete = () => {
  74  |             db.close();
  75  |             resolve();
  76  |           };
  77  |           tx.onerror = () => reject(tx.error);
  78  |         };
  79  |       });
  80  |     },
  81  |     { key, bytes, protocol: COLLABORATION_PROTOCOL },
  82  |   );
  83  | }
  84  | async function caches(page: Page, key: string) {
  85  |   return page.evaluate(
  86  |     async (key) =>
  87  |       new Promise<{
  88  |         primary: number[];
  89  |         records: { documents: number[][]; acknowledged: boolean }[];
  90  |       }>((resolve, reject) => {
  91  |         const r = indexedDB.open("vhslide-cloud", 1);
  92  |         r.onerror = () => reject(r.error);
  93  |         r.onsuccess = () => {
  94  |           const db = r.result,
  95  |             s = db.transaction("documents").objectStore("documents"),
  96  |             primary = s.get(key),
  97  |             all = s.getAll(),
  98  |             keys = s.getAllKeys();
  99  |           keys.onsuccess = () => {
  100 |             resolve({
  101 |               primary: Array.from(primary.result.data ?? primary.result),
  102 |               records: all.result
  103 |                 .filter((_v, i) =>
  104 |                   String(keys.result[i]).startsWith(`recovery/${key}/`),
  105 |                 )
  106 |                 .map((v) => ({
  107 |                   documents: v.documents.map((d: any) =>
  108 |                     Array.from(d.data ?? d),
  109 |                   ),
  110 |                   acknowledged: !!v.acknowledged,
  111 |                 })),
  112 |             });
  113 |             db.close();
  114 |           };
  115 |         };
  116 |       }),
  117 |     key,
  118 |   );
  119 | }
  120 | async function serverBook(page: Page, id: string) {
  121 |   const value = await (await page.request.get(`/api/decks/${id}`)).json(),
  122 |     doc = new Y.Doc();
  123 |   Y.applyUpdate(doc, fromBase64(value.state));
  124 |   const book = parseDeck(JSON.stringify(readSharedDeck(doc)));
  125 |   doc.destroy();
  126 |   return book;
  127 | }
  128 |
  129 | test("host automatically opens a 400-page work after isolating an invalid cache and retains its recovery file", async ({
  130 |   page,
  131 | }, info) => {
  132 |   const f = await fixture(page, `${info.project.name}-cache-host`, true),
  133 |     bytes = broken(f.result.state);
  134 |   await seed(page, f.key, bytes);
  135 |   await page.goto(`/?room=${f.id}`);
  136 |   await expect(page.locator(".cloud-presence")).toContainText(
  137 |     "クラウドに保存済み",
  138 |   );
  139 |   await expect(page.getByRole("dialog")).toHaveCount(0);
  140 |   const notice = page.getByRole("status", { name: "端末の一時保存の保護" });
  141 |   await expect(notice).toContainText("退避しました");
  142 |   expect((await serverBook(page, f.id)).slides).toEqual(f.book.slides);
  143 |   let saved = await caches(page, f.key);
  144 |   expect(saved.records).toHaveLength(1);
  145 |   expect(saved.records[0].documents).toEqual([bytes]);
  146 |   const primary = new Y.Doc();
  147 |   Y.applyUpdate(primary, new Uint8Array(saved.primary));
  148 |   expect(() =>
  149 |     parseDeck(JSON.stringify(readSharedDeck(primary))),
  150 |   ).not.toThrow();
  151 |   primary.destroy();
  152 |   const downloading = page.waitForEvent("download");
  153 |   await notice
  154 |     .getByRole("button", { name: "復旧用データをダウンロード", exact: true })
  155 |     .click();
  156 |   const data = JSON.parse(
  157 |     await readFile((await (await downloading).path())!, "utf8"),
  158 |   );
  159 |   expect(data.format).toBe("vhslide-local-recovery");
  160 |   expect(data.documents[0].data).toEqual({
  161 |     encoding: "base64",
  162 |     data: toBase64(new Uint8Array(bytes)),
  163 |   });
  164 |   await page.locator(".deck-title").fill("復帰後の編集");
  165 |   await expect
  166 |     .poll(async () => (await serverBook(page, f.id)).title)
  167 |     .toBe("復帰後の編集");
  168 |   await notice
  169 |     .getByRole("button", { name: "復旧の案内を閉じる", exact: true })
  170 |     .click();
  171 |   await expect(notice).toHaveCount(0);
  172 |   await page.reload();
> 173 |   await expect(page.locator(".cloud-presence")).toContainText(
      |                                                 ^ Error: expect(locator).toContainText(expected) failed
  174 |     "クラウドに保存済み",
  175 |   );
  176 |   await expect(notice).toHaveCount(0);
  177 |   await page.getByRole("button", { name: "クラウド", exact: true }).click();
  178 |   await page.getByRole("tab", { name: /作品一覧/ }).click();
  179 |   await expect(
  180 |     page.getByRole("button", {
  181 |       name: "復旧用データをダウンロード",
  182 |       exact: true,
  183 |     }),
  184 |   ).toBeVisible();
  185 |   saved = await caches(page, f.key);
  186 |   expect(saved.records[0].documents).toEqual([bytes]);
  187 |   expect(saved.records[0].acknowledged).toBe(true);
  188 |   await page.screenshot({
  189 |     path: info.outputPath("protected-cache-library.png"),
  190 |   });
  191 | });
  192 |
  193 | test("malformed Yjs bytes cannot contaminate the authoritative snapshot", async ({
  194 |   page,
  195 | }, info) => {
  196 |   const f = await fixture(page, `${info.project.name}-bad-bytes`),
  197 |     bytes = [1, 2, 3];
  198 |   await seed(page, f.key, bytes);
  199 |   await page.goto(`/?room=${f.id}`);
  200 |   await expect(page.locator(".cloud-presence")).toContainText(
  201 |     "クラウドに保存済み",
  202 |   );
  203 |   expect((await caches(page, f.key)).records[0].documents).toEqual([bytes]);
  204 |   expect((await serverBook(page, f.id)).slides).toEqual(f.book.slides);
  205 | });
  206 |
  207 | test("failed quarantine preserves the source and stays read-only until protection can be retried", async ({
  208 |   page,
  209 | }, info) => {
  210 |   const f = await fixture(page, `${info.project.name}-cache-quota`),
  211 |     bytes = broken(f.result.state);
  212 |   await seed(page, f.key, bytes);
  213 |   await page.addInitScript(() => {
  214 |     (window as any).__failRecovery = true;
  215 |     const put = IDBObjectStore.prototype.put;
  216 |     IDBObjectStore.prototype.put = function (value, key) {
  217 |       if ((window as any).__failRecovery && String(key).startsWith("recovery/"))
  218 |         throw new DOMException("local quota fixture", "QuotaExceededError");
  219 |       return put.call(this, value, key);
  220 |     };
  221 |   });
  222 |   await page.goto(`/?room=${f.id}`);
  223 |   const notice = page.getByRole("status", { name: "端末の一時保存の保護" });
  224 |   await expect(notice).toContainText("読み取り専用");
  225 |   expect((await caches(page, f.key)).primary).toEqual(bytes);
  226 |   expect((await serverBook(page, f.id)).slides).toEqual(f.book.slides);
  227 |   await page
  228 |     .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
  229 |     .click();
  230 |   await expect(
  231 |     page
  232 |       .locator(".editor-toolbar")
  233 |       .getByRole("button", { name: "文字", exact: true }),
  234 |   ).toBeDisabled();
  235 |   await page.evaluate(() => ((window as any).__failRecovery = false));
  236 |   await notice
  237 |     .getByRole("button", { name: "一時保存の保護を再試行", exact: true })
  238 |     .click();
  239 |   await expect(notice).toContainText("退避しました");
  240 |   await expect(page.locator(".cloud-presence")).toContainText(
  241 |     "クラウドに保存済み",
  242 |   );
  243 |   expect(
  244 |     (await caches(page, f.key)).records[0].documents.every(
  245 |       (d) => JSON.stringify(d) === JSON.stringify(bytes),
  246 |     ),
  247 |   ).toBe(true);
  248 | });
  249 |
  250 | test("an intervening cache write from another tab is archived with the inspected copy", async ({
  251 |   page,
  252 | }, info) => {
  253 |   const f = await fixture(page, `${info.project.name}-cache-race`),
  254 |     a = broken(f.result.state, -1),
  255 |     b = broken(f.result.state, -2);
  256 |   await seed(page, f.key, a);
  257 |   await page.addInitScript(
  258 |     ({ key, bytes, protocol }) => {
  259 |       let injected = false;
  260 |       const get = IDBObjectStore.prototype.get;
  261 |       IDBObjectStore.prototype.get = function (query) {
  262 |         const request = get.call(this, query);
  263 |         if (query === key && !injected) {
  264 |           injected = true;
  265 |           request.addEventListener("success", () => {
  266 |             const tx = this.transaction.db.transaction(
  267 |               "documents",
  268 |               "readwrite",
  269 |             );
  270 |             tx.objectStore("documents").put(
  271 |               { data: new Uint8Array(bytes), protocol },
  272 |               key,
  273 |             );
```
