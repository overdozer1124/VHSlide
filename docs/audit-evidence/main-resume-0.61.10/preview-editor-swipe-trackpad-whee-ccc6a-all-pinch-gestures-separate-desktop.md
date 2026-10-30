# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor-swipe.spec.ts >> trackpad wheel gestures follow both axes, reverse, settle once, and keep small pinch gestures separate
- Location: tests/e2e/editor-swipe.spec.ts:301:1

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator:  getByRole('textbox', { name: 'ページの名前', exact: true })
Expected: "1.2"
Received: "1.3"
Timeout:  5000ms

Call log:
  - Expect "toHaveValue" getByRole('textbox', { name: 'ページの名前', exact: true }) with timeout 5000ms
  - waiting for getByRole('textbox', { name: 'ページの名前', exact: true })
    13 × locator resolved to <input value="1.3" maxlength="200" aria-label="ページの名前"/>
       - unexpected value "1.3"

```

```yaml
- textbox "ページの名前": "1.3"
```

# Test source

```ts
  222 |     touchPoints: [start],
  223 |   });
  224 |   const pair = [start, { ...start, id: 2, x: start.x + 60 }];
  225 |   await cdp.send("Input.dispatchTouchEvent", {
  226 |     type: "touchStart",
  227 |     touchPoints: pair,
  228 |   });
  229 |   await cdp.send("Input.dispatchTouchEvent", {
  230 |     type: "touchMove",
  231 |     touchPoints: pair.map((point, i) => ({
  232 |       ...point,
  233 |       x: point.x - 95 + i * 60,
  234 |     })),
  235 |   });
  236 |   await cdp.send("Input.dispatchTouchEvent", {
  237 |     type: "touchEnd",
  238 |     touchPoints: [],
  239 |   });
  240 |   await idle(page);
  241 |   await expect(title(page)).toHaveValue("1.1");
  242 |   expect((await saved(page)).slides).toEqual(fixture.slides);
  243 | });
  244 |
  245 | test("touch taps edit text, selected frames resize, and swiping an active textbox preserves its text", async ({
  246 |   page,
  247 | }, info) => {
  248 |   test.skip(info.project.name !== "touch", "実タッチの操作");
  249 |   const cdp = await open(page);
  250 |   await page.locator(".editor-page-current .element").nth(1).tap();
  251 |   const input = page.getByRole("textbox", {
  252 |     name: "スライド内の文字",
  253 |     exact: true,
  254 |   });
  255 |   await expect(input).toBeFocused();
  256 |   await input.fill("入力を残す");
  257 |   const b = (await input.boundingBox())!;
  258 |   await gesture(
  259 |     page,
  260 |     cdp,
  261 |     { id: 1, x: b.x + b.width * 0.7, y: b.y + b.height / 2 },
  262 |     -95,
  263 |     0,
  264 |   );
  265 |   await expect(title(page)).toHaveValue("1.2");
  266 |   expect((await saved(page)).slides[0].elements[1].text).toBe("入力を残す");
  267 |   await swipe(page, cdp, 95, 0);
  268 |   await page.locator(".editor-page-current .element").first().tap();
  269 |   const handle = (await page
  270 |     .locator(".editor-page-current .element")
  271 |     .first()
  272 |     .locator('[data-resize-direction="e"]')
  273 |     .boundingBox())!;
  274 |   await gesture(
  275 |     page,
  276 |     cdp,
  277 |     { id: 1, x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
  278 |     40,
  279 |     0,
  280 |   );
  281 |   await expect(title(page)).toHaveValue("1.1");
  282 |   await expect
  283 |     .poll(async () => (await saved(page)).slides[0].elements[0].w)
  284 |     .toBeGreaterThan(280);
  285 |   const resize = (await page
  286 |     .getByRole("button", { name: "要素のサイズを変更" })
  287 |     .boundingBox())!;
  288 |   await gesture(
  289 |     page,
  290 |     cdp,
  291 |     { id: 1, x: resize.x + resize.width / 2, y: resize.y + resize.height / 2 },
  292 |     30,
  293 |     20,
  294 |   );
  295 |   await expect
  296 |     .poll(async () => (await saved(page)).slides[0].elements[0].w)
  297 |     .toBeGreaterThan(280);
  298 |   await expect(title(page)).toHaveValue("1.1");
  299 | });
  300 |
  301 | test("trackpad wheel gestures follow both axes, reverse, settle once, and keep small pinch gestures separate", async ({
  302 |   page,
  303 | }, info) => {
  304 |   test.skip(info.project.name !== "desktop", "ノートPCのタッチパッド操作");
  305 |   await open(page);
  306 |   const b = (await canvas(page).boundingBox())!;
  307 |   await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
  308 |   await page.mouse.wheel(45, 0);
  309 |   await expect
  310 |     .poll(() => offset(page), { intervals: [16, 16, 32] })
  311 |     .toEqual({ x: -45, y: 0 });
  312 |   await page.mouse.wheel(-45, 0);
  313 |   await idle(page);
  314 |   await expect(title(page)).toHaveValue("1.1");
  315 |   await page.waitForTimeout(210);
  316 |   await page.mouse.wheel(95, 0);
  317 |   await expect(pager(page)).toHaveAttribute("data-pan-phase", "settling");
  318 |   // Momentum arriving during settling must not queue another page change.
  319 |   await page.mouse.wheel(100, 0);
  320 |   await page.mouse.wheel(50, 0);
  321 |   await idle(page);
> 322 |   await expect(title(page)).toHaveValue("1.2");
      |                             ^ Error: expect(locator).toHaveValue(expected) failed
  323 |   await page.waitForTimeout(210);
  324 |   await page.mouse.wheel(0, 95);
  325 |   await expect(title(page)).toHaveValue("2.3");
  326 |   await page.waitForTimeout(210);
  327 |   await page.mouse.wheel(0, -95);
  328 |   await expect(title(page)).toHaveValue("1.2");
  329 |   await canvas(page).evaluate((node) =>
  330 |     node.dispatchEvent(
  331 |       new WheelEvent("wheel", {
  332 |         bubbles: true,
  333 |         cancelable: true,
  334 |         ctrlKey: true,
  335 |         deltaY: 1,
  336 |       }),
  337 |     ),
  338 |   );
  339 |   await idle(page);
  340 |   await expect(title(page)).toHaveValue("1.2");
  341 |   expect((await saved(page)).slides).toEqual(fixture.slides);
  342 | });
  343 |
  344 | for (const streamKind of ["decaying", "steady"] as const) {
  345 |   test(`long ${streamKind} Windows-style wheel inertia does not delay paging or swallow the next stroke`, async ({
  346 |     page,
  347 |   }, info) => {
  348 |     test.skip(info.project.name !== "desktop", "ノートPCのタッチパッド操作");
  349 |     await open(page);
  350 |     await pager(page).evaluate((node, streamKind) => {
  351 |       const probe = {
  352 |         sent: 0,
  353 |         done: false,
  354 |         beforeReverse: "",
  355 |         firstNavigationMs: 0,
  356 |       };
  357 |       (window as any).__wheelProbe = probe;
  358 |       const started = performance.now();
  359 |       // Precision touchpads can emit small momentum events for well over a second.
  360 |       const deltas =
  361 |         streamKind === "steady" ? [8] : [42, 34, 26, 18, 12, 8, 5, 3, 2, 1];
  362 |       const stream = setInterval(() => {
  363 |         if (
  364 |           !probe.firstNavigationMs &&
  365 |           document.querySelector<HTMLInputElement>(
  366 |             '[aria-label="ページの名前"]',
  367 |           )!.value === "1.2"
  368 |         )
  369 |           probe.firstNavigationMs = performance.now() - started;
  370 |         node.dispatchEvent(
  371 |           new WheelEvent("wheel", {
  372 |             bubbles: true,
  373 |             cancelable: true,
  374 |             deltaX: deltas[Math.min(probe.sent, deltas.length - 1)],
  375 |             deltaMode: 0,
  376 |           }),
  377 |         );
  378 |         if (++probe.sent === 90) {
  379 |           clearInterval(stream);
  380 |           probe.beforeReverse = document.querySelector<HTMLInputElement>(
  381 |             '[aria-label="ページの名前"]',
  382 |           )!.value;
  383 |           // A fresh reverse stroke must work immediately, even before a quiet gap.
  384 |           // Some Windows drivers report wheel distances in lines rather than pixels.
  385 |           node.dispatchEvent(
  386 |             new WheelEvent("wheel", {
  387 |               bubbles: true,
  388 |               cancelable: true,
  389 |               deltaX: -6,
  390 |               deltaMode: 1,
  391 |             }),
  392 |           );
  393 |           probe.done = true;
  394 |         }
  395 |       }, 16);
  396 |     }, streamKind);
  397 |     await expect(title(page)).toHaveValue("1.2", { timeout: 650 });
  398 |     const early = await page.evaluate(() => (window as any).__wheelProbe);
  399 |     expect(early.done).toBe(false);
  400 |     await expect
  401 |       .poll(() => page.evaluate(() => (window as any).__wheelProbe.done))
  402 |       .toBe(true);
  403 |     const result = await page.evaluate(() => (window as any).__wheelProbe);
  404 |     expect(result.beforeReverse).toBe("1.2");
  405 |     expect(result.firstNavigationMs).toBeGreaterThan(0);
  406 |     expect(result.firstNavigationMs).toBeLessThan(650);
  407 |     await expect(title(page)).toHaveValue("1.1");
  408 |     await idle(page);
  409 |     expect((await saved(page)).slides).toEqual(fixture.slides);
  410 |   });
  411 | }
  412 |
  413 | for (const edge of [
  414 |   { name: "left", page: "1.1", dx: -24, dy: 0 },
  415 |   { name: "top", page: "1.1", dx: 0, dy: -24 },
  416 |   { name: "right", page: "3.3", dx: 24, dy: 0 },
  417 |   { name: "bottom", page: "3.3", dx: 0, dy: 24 },
  418 | ]) {
  419 |   test(`the ${edge.name} edge returns promptly while outward wheel momentum continues`, async ({
  420 |     page,
  421 |   }, info) => {
  422 |     test.skip(info.project.name !== "desktop", "タッチパッドの慣性操作");
```
