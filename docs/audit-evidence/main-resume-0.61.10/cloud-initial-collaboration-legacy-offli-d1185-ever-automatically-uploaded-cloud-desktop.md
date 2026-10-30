# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collaboration.spec.ts >> legacy offline row moves are kept for JSON recovery and never automatically uploaded
- Location: tests/cloud/collaboration.spec.ts:1201:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.cloud-presence')
Expected substring: "共有停止"
Received string:    "一時保存の復旧を確認ホスト0人が参加中"
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('.cloud-presence') with timeout 5000ms
  - waiting for locator('.cloud-presence')
    10 × locator resolved to <div class="cloud-presence">…</div>
       - unexpected value "一時保存の復旧を確認ホスト0人が参加中"

```

```yaml
- img
- status "一時保存の復旧を確認 · 本文と付箋の保存状態です。端末へ書き出すJSONには付箋・共有設定・過去の版は含みません。": 一時保存の復旧を確認
- text: ホスト 0人が参加中
```

# Test source

```ts
  1168 |     );
  1169 |     await expect(select(guestEmail)).toBeChecked();
  1170 |     await expect(select(a)).toHaveCount(0);
  1171 |     await page.unroute(`**/api/decks/${room}/members/**`);
  1172 |     await button(page, "選択した共有を解除").click();
  1173 |     await button(page, "1人の共有を解除する").click();
  1174 |     await expect(page.locator(".sharing-feedback")).toContainText(
  1175 |       "1件の共有を解除しました",
  1176 |     );
  1177 |     await expect(page.locator(".sharing-person")).toHaveCount(1);
  1178 |     await expect(page.locator(".sharing-person")).toContainText(b);
  1179 |     await expect(other.locator(".cloud-presence")).toContainText("共有停止");
  1180 |     recipients = (
  1181 |       await (await page.request.get(`/api/decks/${room}/recipients`)).json()
  1182 |     ).recipients;
  1183 |     expect(recipients).toHaveLength(1);
  1184 |     expect(recipients[0].email).toBe(b);
  1185 |     expect(recipients[0].access.rows[0].index).toBe(1);
  1186 |     await button(page, "クラウドの作品を閉じる").focus();
  1187 |     await page.keyboard.press("Shift+Tab");
  1188 |     expect(
  1189 |       await page.evaluate(
  1190 |         () => !!document.activeElement?.closest(".cloud-panel"),
  1191 |       ),
  1192 |     ).toBe(true);
  1193 |     await page.keyboard.press("Escape");
  1194 |     await expect(dialog).toHaveCount(0);
  1195 |     await expect(page.locator(".app-shell")).not.toHaveAttribute("inert", "");
  1196 |   } finally {
  1197 |     await context.close();
  1198 |   }
  1199 | });
  1200 |
  1201 | test("legacy offline row moves are kept for JSON recovery and never automatically uploaded", async ({
  1202 |   page,
  1203 | }, info) => {
  1204 |   const { fromBase64, readSharedDeck } =
  1205 |     await import("../../src/sharedDeck.ts");
  1206 |   const { blank } = await import("../../src/model.ts");
  1207 |   const Y = await import("yjs");
  1208 |   const deck = {
  1209 |     version: 1 as const,
  1210 |     title: "旧版の未送信配置",
  1211 |     slides: [blank(0, 0), blank(0, 1)],
  1212 |   };
  1213 |   await signIn(page, `legacy-layout-${info.project.name}`);
  1214 |   const {
  1215 |     id,
  1216 |     user,
  1217 |     state: originalState,
  1218 |   } = await page.evaluate(async (deck) => {
  1219 |     const made = await fetch("/api/decks", {
  1220 |       method: "POST",
  1221 |       headers: { "Content-Type": "application/json" },
  1222 |       body: JSON.stringify(deck),
  1223 |     });
  1224 |     if (!made.ok) throw new Error(await made.text());
  1225 |     const work = await made.json(),
  1226 |       session = await (await fetch("/api/session")).json();
  1227 |     const saved = await (await fetch(`/api/decks/${work.id}`)).json();
  1228 |     return {
  1229 |       id: work.id as string,
  1230 |       user: session.user.id as string,
  1231 |       state: saved.state as string,
  1232 |     };
  1233 |   }, deck);
  1234 |   // An offline cache must descend from the actual server document; an unrelated
  1235 |   // Y.Doc with identical JSON would test arbitrary CRDT map conflicts instead.
  1236 |   const legacy = new Y.Doc();
  1237 |   Y.applyUpdate(legacy, fromBase64(originalState));
  1238 |   const slides = legacy.getMap<import("yjs").Map<unknown>>("slides");
  1239 |   slides.get(deck.slides[0].id)!.set("position", { x: 0, y: 1 });
  1240 |   slides.get(deck.slides[1].id)!.set("position", { x: 0, y: 0 });
  1241 |   const bytes = Array.from(Y.encodeStateAsUpdate(legacy));
  1242 |   legacy.destroy();
  1243 |   await page.evaluate(
  1244 |     async ({ id, user, bytes }) => {
  1245 |       await new Promise<void>((done, fail) => {
  1246 |         const request = indexedDB.open("vhslide-cloud", 1);
  1247 |         request.onupgradeneeded = () =>
  1248 |           request.result.createObjectStore("documents");
  1249 |         request.onerror = () => fail(request.error);
  1250 |         request.onsuccess = () => {
  1251 |           const db = request.result,
  1252 |             tx = db.transaction("documents", "readwrite");
  1253 |           tx.objectStore("documents").put(
  1254 |             new Uint8Array(bytes),
  1255 |             `${user}/${id}`,
  1256 |           );
  1257 |           tx.oncomplete = () => {
  1258 |             db.close();
  1259 |             done();
  1260 |           };
  1261 |           tx.onerror = () => fail(tx.error);
  1262 |         };
  1263 |       });
  1264 |     },
  1265 |     { id, user, bytes },
  1266 |   );
  1267 |   await page.goto(`/?room=${id}`);
> 1268 |   await expect(page.locator(".cloud-presence")).toContainText("共有停止");
       |                                                 ^ Error: expect(locator).toContainText(expected) failed
  1269 |   await expect(
  1270 |     page.getByText("旧版の未送信の配置変更を端末から復元しました。", {
  1271 |       exact: false,
  1272 |     }),
  1273 |   ).toBeVisible();
  1274 |   // The authoritative state is exactly the original Yjs document, not the cached move.
  1275 |   const state = await page.evaluate(
  1276 |     async (id) =>
  1277 |       (await (await fetch(`/api/decks/${id}`)).json()).state as string,
  1278 |     id,
  1279 |   );
  1280 |   const server = new Y.Doc();
  1281 |   Y.applyUpdate(server, fromBase64(state));
  1282 |   expect(
  1283 |     readSharedDeck(server).slides.find((s) => s.id === deck.slides[0].id)!.y,
  1284 |   ).toBe(0);
  1285 |   server.destroy();
  1286 |   await expect(
  1287 |     page.getByRole("button", { name: "ファイルに保存", exact: true }),
  1288 |   ).toBeEnabled();
  1289 |   const downloading = page.waitForEvent("download");
  1290 |   await page
  1291 |     .getByRole("button", { name: "ファイルに保存", exact: true })
  1292 |     .click();
  1293 |   const file = await (await downloading).path();
  1294 |   const recovered = JSON.parse(await readFile(file!, "utf8"));
  1295 |   expect(
  1296 |     recovered.slides.find((s: { id: string }) => s.id === deck.slides[0].id).y,
  1297 |   ).toBe(1);
  1298 |   page.once("dialog", (dialog) => dialog.accept());
  1299 |   await page.getByRole("button", { name: "クラウド", exact: true }).click();
  1300 |   await page.getByRole("tab", { name: /作品一覧/ }).click();
  1301 |   await page
  1302 |     .getByRole("button", { name: `作品を開く：${deck.title}`, exact: true })
  1303 |     .click();
  1304 |   await saved(page);
  1305 | });
  1306 |
  1307 | test("full ZIP backups preserve failed jobs and resume after reload with lost upload and commit responses", async ({
  1308 |   page,
  1309 | }, info) => {
  1310 |   await signIn(page, `backup-${info.project.name}`);
  1311 |   await page
  1312 |     .getByRole("button", { name: "この作品をクラウドに保存", exact: true })
  1313 |     .click();
  1314 |   await saved(page);
  1315 |   const source = new URL(page.url()).searchParams.get("room")!;
  1316 |   await openEditor(page);
  1317 |   const png = Buffer.from(
  1318 |     "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  1319 |     "base64",
  1320 |   );
  1321 |   await page
  1322 |     .locator('input[type="file"]')
  1323 |     .nth(1)
  1324 |     .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  1325 |   await expect(page.locator(".editor-workspace img.slide-image")).toHaveCount(
  1326 |     1,
  1327 |   );
  1328 |   await saved(page);
  1329 |   await page.getByRole("button", { name: "付箋を追加", exact: true }).click();
  1330 |   await page
  1331 |     .getByRole("textbox", { name: "付箋のコメント", exact: true })
  1332 |     .fill("バックアップする感想");
  1333 |   await page.getByRole("button", { name: "全体マップへ", exact: true }).click();
  1334 |   await expect
  1335 |     .poll(
  1336 |       async () =>
  1337 |         (await (await page.request.get(`/api/decks/${source}/comments`)).json())
  1338 |           .comments[0]?.text,
  1339 |     )
  1340 |     .toBe("バックアップする感想");
  1341 |   const access = {
  1342 |     mode: "scoped",
  1343 |     comment: true,
  1344 |     rows: [{ sheetId: "main", index: 0, axisId: "0" }],
  1345 |     columns: [],
  1346 |     slides: [],
  1347 |   };
  1348 |   const email = `backup-guest-${info.project.name}@example.test`;
  1349 |   await page.evaluate(
  1350 |     async ({ source, email, access }) => {
  1351 |       const r = await fetch(`/api/decks/${source}/recipients`, {
  1352 |         method: "POST",
  1353 |         headers: { "Content-Type": "application/json" },
  1354 |         body: JSON.stringify({ recipients: [{ email, access }] }),
  1355 |       });
  1356 |       if (!r.ok) throw new Error(await r.text());
  1357 |     },
  1358 |     { source, email, access },
  1359 |   );
  1360 |   await page.getByRole("button", { name: "クラウド", exact: true }).click();
  1361 |   await page.getByRole("tab", { name: /作品一覧/ }).click();
  1362 |   const saving = page.waitForEvent("download");
  1363 |   if (
  1364 |     !(await page
  1365 |       .getByRole("button", { name: "完全バックアップを保存", exact: true })
  1366 |       .isVisible())
  1367 |   ) {
  1368 |     await page
```
