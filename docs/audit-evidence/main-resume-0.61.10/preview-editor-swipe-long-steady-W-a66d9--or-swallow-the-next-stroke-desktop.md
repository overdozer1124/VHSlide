# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: editor-swipe.spec.ts >> long steady Windows-style wheel inertia does not delay paging or swallow the next stroke
- Location: tests/e2e/editor-swipe.spec.ts:345:3

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator:  getByRole('textbox', { name: 'ページの名前', exact: true })
Expected: "1.2"
Received: "1.1"
Timeout:  650ms

Call log:
  - Expect "toHaveValue" getByRole('textbox', { name: 'ページの名前', exact: true }) with timeout 650ms
  - waiting for getByRole('textbox', { name: 'ページの名前', exact: true })
    5 × locator resolved to <input value="1.1" maxlength="200" aria-label="ページの名前"/>
      - unexpected value "1.1"

```

```yaml
- textbox "ページの名前": "1.1"
```

# Test source

```ts
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
  322 |   await expect(title(page)).toHaveValue("1.2");
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
> 397 |     await expect(title(page)).toHaveValue("1.2", { timeout: 650 });
      |                               ^ Error: expect(locator).toHaveValue(expected) failed
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
  423 |     await open(page, edge.page);
  424 |     await pager(page).evaluate((node, edge) => {
  425 |       const probe = { sent: 0, done: false, returnedMs: 0 };
  426 |       (window as any).__edgeProbe = probe;
  427 |       const started = performance.now();
  428 |       const outward = () =>
  429 |         node.dispatchEvent(
  430 |           new WheelEvent("wheel", {
  431 |             bubbles: true,
  432 |             cancelable: true,
  433 |             deltaX: edge.dx,
  434 |             deltaY: edge.dy,
  435 |           }),
  436 |         );
  437 |       outward();
  438 |       const stream = setInterval(() => {
  439 |         const elapsed = performance.now() - started;
  440 |         if (
  441 |           elapsed >= 100 &&
  442 |           !probe.returnedMs &&
  443 |           node.getAttribute("data-pan-phase") === "idle"
  444 |         )
  445 |           probe.returnedMs = elapsed;
  446 |         outward();
  447 |         if (++probe.sent === 60) {
  448 |           clearInterval(stream);
  449 |           probe.done = true;
  450 |         }
  451 |       }, 16);
  452 |     }, edge);
  453 |     await expect
  454 |       .poll(() => page.evaluate(() => (window as any).__edgeProbe.sent), {
  455 |         intervals: [16, 16, 32],
  456 |       })
  457 |       .toBeGreaterThanOrEqual(8);
  458 |     await expect(pager(page)).toHaveAttribute("data-pan-phase", "idle", {
  459 |       timeout: 300,
  460 |     });
  461 |     expect(await offset(page)).toEqual({ x: 0, y: 0 });
  462 |     expect(await page.evaluate(() => (window as any).__edgeProbe.done)).toBe(
  463 |       false,
  464 |     );
  465 |     await expect
  466 |       .poll(() => page.evaluate(() => (window as any).__edgeProbe.done))
  467 |       .toBe(true);
  468 |     const probe = await page.evaluate(() => (window as any).__edgeProbe);
  469 |     expect(probe.returnedMs).toBeGreaterThan(0);
  470 |     expect(probe.returnedMs).toBeLessThan(350);
  471 |     await idle(page);
  472 |     await expect(title(page)).toHaveValue(edge.page);
  473 |     expect((await saved(page)).slides).toEqual(fixture.slides);
  474 |   });
  475 | }
  476 |
  477 | test("an inward wheel gesture interrupts the edge return without being cleared by the old timer", async ({
  478 |   page,
  479 | }, info) => {
  480 |   test.skip(info.project.name !== "desktop", "タッチパッドの操作");
  481 |   await open(page);
  482 |   await pager(page).evaluate((node) => {
  483 |     const probe = { reversedDuringReturn: false, duration: "" };
  484 |     (window as any).__returnProbe = probe;
  485 |     const observer = new MutationObserver(() => {
  486 |       if (node.getAttribute("data-pan-phase") !== "settling") return;
  487 |       observer.disconnect();
  488 |       probe.reversedDuringReturn = true;
  489 |       probe.duration = getComputedStyle(node).getPropertyValue(
  490 |         "--page-settle-duration",
  491 |       );
  492 |       node.dispatchEvent(
  493 |         new WheelEvent("wheel", {
  494 |           bubbles: true,
  495 |           cancelable: true,
  496 |           deltaX: 100,
  497 |         }),
```
