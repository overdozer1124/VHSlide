# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: learning-tools.spec.ts >> purpose-specific entrances keep menus keyboard-accessible and restore focus
- Location: tests/e2e/learning-tools.spec.ts:304:1

# Error details

```
Error: expect(locator).toBeFocused() failed

Locator:  getByRole('menuitem', { name: /^JSONで保存/ })
Expected: focused
Received: inactive
Timeout:  5000ms

Call log:
  - Expect "toBeFocused" getByRole('menuitem', { name: /^JSONで保存/ }) with timeout 5000ms
  - waiting for getByRole('menuitem', { name: /^JSONで保存/ })
    13 × locator resolved to <button role="menuitem">…</button>
       - unexpected value "inactive"

```

```yaml
- menuitem "JSONで保存 全シートのページ・写真。付箋・共有設定は含みません":
  - strong: JSONで保存
  - text: 全シートのページ・写真。付箋・共有設定は含みません
```

# Test source

```ts
  222 |   await expect(page.locator(".present-caption")).toContainText("前半のページ");
  223 | });
  224 |
  225 | test("local versions work offline without native randomUUID", async ({
  226 |   page,
  227 | }) => {
  228 |   await page.addInitScript(() =>
  229 |     Object.defineProperty(crypto, "randomUUID", {
  230 |       configurable: true,
  231 |       value: undefined,
  232 |     }),
  233 |   );
  234 |   await page.goto("/");
  235 |   await expect(
  236 |     page.getByRole("button", { name: "ファイル", exact: true }),
  237 |   ).toBeVisible();
  238 |   await page.context().setOffline(true);
  239 |   await openTools(page, "保存した版");
  240 |   await page
  241 |     .getByRole("textbox", { name: "保存する版の名前", exact: true })
  242 |     .fill("オフラインで保存");
  243 |   await page.getByRole("button", { name: "版を保存", exact: true }).click();
  244 |   await expect(page.getByText(/オフラインで保存 ·/)).toBeVisible();
  245 | });
  246 |
  247 | test("a failed pre-delete version preserves the work and deletion can be retried after storage recovers", async ({
  248 |   page,
  249 | }) => {
  250 |   await page.goto("/");
  251 |   const before = await page.evaluate(() =>
  252 |     JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  253 |   );
  254 |   await page.evaluate(() => {
  255 |     (window as any).realHistoryDB = indexedDB;
  256 |     Object.defineProperty(window, "indexedDB", {
  257 |       configurable: true,
  258 |       value: {
  259 |         open() {
  260 |           const request: any = {
  261 |             error: new DOMException("容量不足（テスト）", "QuotaExceededError"),
  262 |           };
  263 |           setTimeout(() => request.onerror?.(), 0);
  264 |           return request;
  265 |         },
  266 |       },
  267 |     });
  268 |   });
  269 |   const remove = async () => {
  270 |     await page
  271 |       .getByRole("button", { name: "わたしたちのまちを編集", exact: true })
  272 |       .click({ button: "right" });
  273 |     await page
  274 |       .getByRole("menuitem", { name: "このページを削除", exact: true })
  275 |       .click();
  276 |   };
  277 |   await remove();
  278 |   await expect(
  279 |     page.getByText(/削除を中止しました。版を保存できません。/),
  280 |   ).toBeVisible();
  281 |   expect(
  282 |     await page.evaluate(() =>
  283 |       JSON.parse(localStorage.getItem("vhslide-deck-v1")!),
  284 |     ),
  285 |   ).toEqual(before);
  286 |   await page.evaluate(() =>
  287 |     Object.defineProperty(window, "indexedDB", {
  288 |       configurable: true,
  289 |       value: (window as any).realHistoryDB,
  290 |     }),
  291 |   );
  292 |   await remove();
  293 |   await expect
  294 |     .poll(
  295 |       async () =>
  296 |         await page.evaluate(
  297 |           () =>
  298 |             JSON.parse(localStorage.getItem("vhslide-deck-v1")!).slides.length,
  299 |         ),
  300 |     )
  301 |     .toBe(4);
  302 | });
  303 |
  304 | test("purpose-specific entrances keep menus keyboard-accessible and restore focus", async ({
  305 |   page,
  306 | }) => {
  307 |   await page.goto("/");
  308 |   await expect(
  309 |     page.getByRole("button", { name: "学習・発表", exact: true }),
  310 |   ).toHaveCount(0);
  311 |   await expect(
  312 |     page.getByRole("button", { name: "自分の担当", exact: true }),
  313 |   ).toHaveCount(0);
  314 |   const saveMenu = page.getByRole("button", {
  315 |     name: "ファイル",
  316 |     exact: true,
  317 |   });
  318 |   await saveMenu.focus();
  319 |   await page.keyboard.press("ArrowDown");
  320 |   await expect(
  321 |     page.getByRole("menuitem", { name: /^JSONで保存/ }),
> 322 |   ).toBeFocused();
      |     ^ Error: expect(locator).toBeFocused() failed
  323 |   await page.keyboard.press("ArrowDown");
  324 |   await expect(
  325 |     page.getByRole("menuitem", { name: /^PDFで保存/ }),
  326 |   ).toBeFocused();
  327 |   await page.keyboard.press("Enter");
  328 |   await expect(
  329 |     page.getByRole("dialog", { name: "PDFで保存", exact: true }),
  330 |   ).toBeVisible();
  331 |   await expect(
  332 |     page.getByRole("button", {
  333 |       name: "選んだスライドを比較（最大4枚）",
  334 |       exact: true,
  335 |     }),
  336 |   ).toHaveCount(0);
  337 |   await page.keyboard.press("Escape");
  338 |   await expect(saveMenu).toBeFocused();
  339 |   await saveMenu.click();
  340 |   await page.locator(".deck-title").click();
  341 |   await expect(page.getByRole("menu")).toHaveCount(0);
  342 |   const download = page.waitForEvent("download");
  343 |   await page
  344 |     .getByRole("button", { name: "ファイルに保存", exact: true })
  345 |     .click();
  346 |   expect((await download).suggestedFilename()).toMatch(/\.json$/);
  347 |   await page
  348 |     .getByRole("button", { name: "マップをフィルタ", exact: true })
  349 |     .click();
  350 |   const filter = page.getByRole("region", {
  351 |     name: "マップのフィルタ設定",
  352 |     exact: true,
  353 |   });
  354 |   await filter.getByRole("button", { name: /自分の担当を選択/ }).click();
  355 |   await expect(filter).toContainText("5ページ選択中");
  356 |   await filter
  357 |     .getByRole("button", { name: "フィルタを適用", exact: true })
  358 |     .click();
  359 |   await expect(page.locator(".map-scroll [data-page-id]")).toHaveCount(5);
  360 |   const compare = page.getByRole("button", { name: "比較", exact: true });
  361 |   await openTools(page, "比較");
  362 |   await expect(
  363 |     page.getByRole("dialog", { name: "スライドを比較", exact: true }),
  364 |   ).toBeVisible();
  365 |   await expect(
  366 |     page.getByRole("button", { name: "PDFの準備", exact: true }),
  367 |   ).toHaveCount(0);
  368 |   for (let i = 0; i < 4; i++)
  369 |     await page.getByLabel("対象スライド").getByRole("checkbox").nth(i).check();
  370 |   await page
  371 |     .getByRole("button", {
  372 |       name: "選んだスライドを比較（最大4枚）",
  373 |       exact: true,
  374 |     })
  375 |     .click();
  376 |   await expect(page.getByLabel("対象スライド")).toHaveCount(0);
  377 |   await expect(
  378 |     page.getByLabel("スライドの比較").locator(".slide-canvas"),
  379 |   ).toHaveCount(4);
  380 |   await expect
  381 |     .poll(() =>
  382 |       page.evaluate(() => {
  383 |         const dialog = document
  384 |           .querySelector("dialog")!
  385 |           .getBoundingClientRect();
  386 |         return [
  387 |           ...document.querySelectorAll(".compare-grid .slide-canvas"),
  388 |         ].every((el) => {
  389 |           const box = el.getBoundingClientRect();
  390 |           return (
  391 |             box.top >= dialog.top &&
  392 |             box.bottom <= dialog.bottom &&
  393 |             box.right <= dialog.right &&
  394 |             box.left >= dialog.left
  395 |           );
  396 |         });
  397 |       }),
  398 |     )
  399 |     .toBe(true);
  400 |
  401 |   await page.getByRole("button", { name: "閉じる", exact: true }).click();
  402 |   await expect(compare).toBeFocused();
  403 |   expect(
  404 |     await page.evaluate(
  405 |       () => document.documentElement.scrollWidth <= innerWidth,
  406 |     ),
  407 |   ).toBe(true);
  408 |   await page
  409 |     .getByRole("button", { name: "この5ページを発表", exact: true })
  410 |     .click();
  411 |   await expect(page.locator(".present-caption")).toBeAttached();
  412 | });
  413 |
  414 | test("a thousand-page picker only renders previews near the scroll viewport", async ({
  415 |   page,
  416 | }) => {
  417 |   await page.goto("/");
  418 |   const { blank } = await import("../../src/model");
  419 |   const book = {
  420 |     version: 1,
  421 |     title: "1000枚の選択",
  422 |     slides: Array.from({ length: 1000 }, (_, i) => ({
```
