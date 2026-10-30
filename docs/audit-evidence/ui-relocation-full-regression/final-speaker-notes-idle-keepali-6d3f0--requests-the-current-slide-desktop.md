# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: speaker-notes.spec.ts >> idle keepalives do not repeatedly copy preview payloads, and reopening requests the current slide
- Location: tests/e2e/speaker-notes.spec.ts:457:1

# Error details

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('button', { name: '閉じる', exact: true })
    - locator resolved to <button class="button">閉じる</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - performing click action

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic "発表の操作":
    - generic:
      - text: VHSlide
      - generic: / 発表の検証
      - generic "発表対象": シート1・全体・3ページ
    - generic:
      - button "発表者用ノートを開く": 発表者ノート
      - button "全画面切り替え"
      - button "発表をおわる"
  - generic:
    - generic "現在地マップ":
      - generic "はじめ"
      - generic "つづき"
      - generic "下のページ"
      - generic: 1.1 現在地
    - generic:
      - text: はじめ
      - generic: マウスを上下の端へ · タッチは画面をタップ
    - generic:
      - button "上のページ" [disabled]
      - generic:
        - button "前の話題" [disabled]
        - button "下のページ"
        - button "次の話題"
```

# Test source

```ts
  400 |     .toBe(true);
  401 |   await expect(preview).not.toContainText("発表者だけのメモ");
  402 |   await expect(
  403 |     preview.locator("[contenteditable=true],textarea,.resize-handle"),
  404 |   ).toHaveCount(0);
  405 |   const notes = speaker.getByLabel("現在のスピーカーノート", { exact: true });
  406 |   await expect(notes).toHaveText("発表者だけのメモ");
  407 |   for (const size of [
  408 |     { width: 1366, height: 768 },
  409 |     { width: 700, height: 900 },
  410 |   ]) {
  411 |     await speaker.setViewportSize(size);
  412 |     await expect
  413 |       .poll(async () => {
  414 |         const frame = (await preview
  415 |             .locator(".speaker-slide-frame")
  416 |             .boundingBox())!,
  417 |           canvas = (await preview.locator(".slide-canvas").boundingBox())!;
  418 |         const expected = Math.min(frame.width, (frame.height * 16) / 9);
  419 |         return (
  420 |           Math.abs(canvas.width - expected) < 2 &&
  421 |           canvas.x >= 0 &&
  422 |           canvas.x + canvas.width <= size.width + 1
  423 |         );
  424 |       })
  425 |       .toBe(true);
  426 |     const p = (await preview.boundingBox())!,
  427 |       n = (await speaker.locator(".speaker-notes-pane").boundingBox())!;
  428 |     if (size.width > 800) expect(n.x).toBeGreaterThan(p.x + p.width);
  429 |     else expect(n.y).toBeGreaterThanOrEqual(p.y + p.height);
  430 |     await speaker.screenshot({
  431 |       path: info.outputPath(`speaker-preview-${size.width}.png`),
  432 |     });
  433 |   }
  434 |   await speaker.keyboard.press("ArrowRight");
  435 |   await expect(preview.locator("[data-preview-slide]")).toHaveAttribute(
  436 |     "data-preview-slide",
  437 |     "p1",
  438 |   );
  439 |   await expect(preview).toContainText("次のスライドの本文");
  440 |   await expect(notes).toHaveText("2枚目だけのメモ");
  441 |   await page.keyboard.press("ArrowLeft");
  442 |   await expect(preview.locator("[data-preview-slide]")).toHaveAttribute(
  443 |     "data-preview-slide",
  444 |     "p0",
  445 |   );
  446 |   await speaker.reload();
  447 |   await expect(speaker.locator("[data-preview-slide]")).toHaveAttribute(
  448 |     "data-preview-slide",
  449 |     "p0",
  450 |   );
  451 |   await expect(page.locator(".present-mode")).not.toContainText(
  452 |     "発表者だけのメモ",
  453 |   );
  454 |   await page.keyboard.press("Escape");
  455 |   await expect.poll(() => speaker.isClosed()).toBe(true);
  456 | });
  457 | test("idle keepalives do not repeatedly copy preview payloads, and reopening requests the current slide", async ({
  458 |   page,
  459 | }) => {
  460 |   await page.evaluate(() => {
  461 |     const Original = window.BroadcastChannel,
  462 |       state = window as unknown as {
  463 |         speakerCounts: { states: number; alive: number };
  464 |       };
  465 |     state.speakerCounts = { states: 0, alive: 0 };
  466 |     window.BroadcastChannel = class extends Original {
  467 |       postMessage(message: any) {
  468 |         if (this.name.startsWith("vhslide-speaker-")) {
  469 |           if (message.type === "state") state.speakerCounts.states++;
  470 |           if (message.type === "alive") state.speakerCounts.alive++;
  471 |         }
  472 |         super.postMessage(message);
  473 |       }
  474 |     };
  475 |   });
  476 |   const opened = page.waitForEvent("popup");
  477 |   await startWithNotes(page);
  478 |   let speaker = await opened;
  479 |   await expect(speaker.locator("[data-preview-slide]")).toHaveAttribute(
  480 |     "data-preview-slide",
  481 |     "p0",
  482 |   );
  483 |   const counts = () =>
  484 |     page.evaluate(
  485 |       () =>
  486 |         (
  487 |           window as unknown as {
  488 |             speakerCounts: { states: number; alive: number };
  489 |           }
  490 |         ).speakerCounts,
  491 |     );
  492 |   await expect
  493 |     .poll(async () => (await counts()).alive)
  494 |     .toBeGreaterThanOrEqual(1);
  495 |   const before = await counts();
  496 |   await expect
  497 |     .poll(async () => (await counts()).alive, { timeout: 10000 })
  498 |     .toBeGreaterThanOrEqual(before.alive + 2);
  499 |   expect((await counts()).states).toBe(before.states);
> 500 |   await speaker.getByRole("button", { name: "閉じる", exact: true }).click();
      |                                                                   ^ Error: locator.click: Target page, context or browser has been closed
  501 |   await expect.poll(() => speaker.isClosed()).toBe(true);
  502 |   await page.mouse.move(10, 10);
  503 |   const reopened = page.waitForEvent("popup");
  504 |   await page
  505 |     .getByRole("button", { name: "発表者用ノートを開く", exact: true })
  506 |     .click();
  507 |   speaker = await reopened;
  508 |   await expect(speaker.locator("[data-preview-slide]")).toHaveAttribute(
  509 |     "data-preview-slide",
  510 |     "p0",
  511 |   );
  512 |   await page.keyboard.press("Escape");
  513 |   await expect.poll(() => speaker.isClosed()).toBe(true);
  514 | });
  515 | 
```