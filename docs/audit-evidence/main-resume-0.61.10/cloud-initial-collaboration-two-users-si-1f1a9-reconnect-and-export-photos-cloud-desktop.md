# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collaboration.spec.ts >> two users sign in, join by invitation, edit the same text, reconnect, and export photos
- Location: tests/cloud/collaboration.spec.ts:168:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.cloud-presence')
Expected substring: "共有停止"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" locator('.cloud-presence') with timeout 5000ms
  - waiting for locator('.cloud-presence')

```

```yaml
- alert:
  - heading "作品へのアクセスを確認してください" [level=1]
  - paragraph: 参加権限またはログイン状態が変わったため、作品の表示を停止しました。
  - button "ログイン状態を確認して開き直す"
  - button "作品一覧を開く"
```

# Test source

```ts
  337 |     await expect(other.locator(".editor-workspace")).toContainText("offline");
  338 |     await expect(
  339 |       other.locator(".editor-workspace img.slide-image"),
  340 |     ).toHaveCount(1);
  341 |     // The selected sheet is personal, while its content and tab order are shared.
  342 |     await page
  343 |       .getByRole("button", { name: "空のシートを追加", exact: true })
  344 |       .click();
  345 |     await expect(other.getByRole("tab")).toHaveCount(2);
  346 |     await expect(
  347 |       other.getByRole("tab", { name: "シート1", exact: true }),
  348 |     ).toHaveAttribute("aria-selected", "true");
  349 |     await page.getByRole("button", { name: "文字", exact: true }).click();
  350 |     const sheetText = page.getByRole("textbox", {
  351 |       name: "スライド内の文字",
  352 |       exact: true,
  353 |     });
  354 |     await sheetText.fill("別シートの共同編集");
  355 |     await sheetText.press("Escape");
  356 |     await other.getByRole("tab", { name: "シート2", exact: true }).click();
  357 |     await expect(other.locator(".editor-workspace")).toContainText(
  358 |       "別シートの共同編集",
  359 |     );
  360 |     await other.getByRole("tab", { name: "シート1", exact: true }).click();
  361 |     await expect(other.locator(".editor-workspace")).toContainText("offline");
  362 |     await page
  363 |       .getByRole("button", { name: "シートの操作", exact: true })
  364 |       .click();
  365 |     await page
  366 |       .getByRole("button", { name: "シートを左へ移動", exact: true })
  367 |       .click();
  368 |     await page.getByRole("button", { name: "閉じる", exact: true }).click();
  369 |     await expect
  370 |       .poll(() => other.getByRole("tab").allTextContents())
  371 |       .toEqual(["シート2", "シート1"]);
  372 |     await other.reload();
  373 |     await saved(other);
  374 |     await expect(
  375 |       other.getByRole("tab", { name: "シート1", exact: true }),
  376 |     ).toHaveAttribute("aria-selected", "true");
  377 |     // Filtering is personal and must never trim the shared document or export.
  378 |     await page.getByRole("tab", { name: "シート1", exact: true }).click();
  379 |     await page
  380 |       .getByRole("button", { name: "全体マップへ", exact: true })
  381 |       .click();
  382 |     await page
  383 |       .getByRole("button", { name: "マップをフィルタ", exact: true })
  384 |       .click();
  385 |     await page
  386 |       .getByRole("button", { name: "フィルタする列2", exact: true })
  387 |       .click();
  388 |     await page
  389 |       .getByRole("button", { name: "フィルタを適用", exact: true })
  390 |       .click();
  391 |     await expect(page.locator(".slide-card")).toHaveCount(2);
  392 |     await expect(other.locator(".slide-card")).toHaveCount(5);
  393 |     await page
  394 |       .getByRole("button", { name: "自然がいっぱいを編集", exact: true })
  395 |       .click();
  396 |     await page
  397 |       .getByRole("button", { name: "1段目の横のページをひらく", exact: true })
  398 |       .click();
  399 |     await expect(page.locator(".row-page")).toHaveCount(1);
  400 |     await page
  401 |       .getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true })
  402 |       .click();
  403 |     await page.getByRole("button", { name: "文字", exact: true }).click();
  404 |     const filteredInput = page.getByRole("textbox", {
  405 |       name: "スライド内の文字",
  406 |       exact: true,
  407 |     });
  408 |     await filteredInput.fill("フィルタ内の共同編集");
  409 |     await filteredInput.press("Escape");
  410 |     await other
  411 |       .getByRole("button", { name: "自然がいっぱいを編集", exact: true })
  412 |       .click();
  413 |     await expect(other.locator(".editor-workspace")).toContainText(
  414 |       "フィルタ内の共同編集",
  415 |     );
  416 |     const fullDownload = page.waitForEvent("download");
  417 |     await page
  418 |       .getByRole("button", { name: "ファイルに保存", exact: true })
  419 |       .click();
  420 |     const fullFile = await fullDownload,
  421 |       fullExport = JSON.parse(await readFile((await fullFile.path())!, "utf8"));
  422 |     expect(fullExport.slides).toHaveLength(6);
  423 |     expect(fullExport.sheets).toHaveLength(2);
  424 |     await page.getByRole("button", { name: "クラウド", exact: true }).click();
  425 |     await expect(
  426 |       page.getByRole("button", {
  427 |         name: `${name}-friendの参加を解除`,
  428 |         exact: true,
  429 |       }),
  430 |     ).toBeVisible();
  431 |     expect(await page.evaluate(() => innerWidth)).toBeLessThanOrEqual(
  432 |       page.viewportSize()!.width,
  433 |     );
  434 |     await page
  435 |       .getByRole("button", { name: `${name}-friendの参加を解除`, exact: true })
  436 |       .click();
> 437 |     await expect(other.locator(".cloud-presence")).toContainText("共有停止");
      |                                                    ^ Error: expect(locator).toContainText(expected) failed
  438 |     await page.screenshot({ path: info.outputPath("cloud-sharing.png") });
  439 |   } finally {
  440 |     await context.close();
  441 |   }
  442 | });
  443 |
  444 | test("host selects editing scopes visually, guests stay read-only elsewhere and exchange persistent sticky comments", async ({
  445 |   page,
  446 |   browser,
  447 | }, info) => {
  448 |   test.setTimeout(90000);
  449 |   const owner = `permissions-${info.project.name}`,
  450 |     guest = `${owner}-guest`;
  451 |   const button = (p: Page, name: string) =>
  452 |     p.getByRole("button", { name, exact: true });
  453 |   await signIn(page, owner);
  454 |   await button(page, "この作品をクラウドに保存").click();
  455 |   await saved(page);
  456 |   await page.getByRole("button", { name: "クラウド", exact: true }).click();
  457 |   await button(page, "共同編集の招待リンクを作る").click();
  458 |   const invite = await page
  459 |     .getByRole("textbox", { name: "共同編集の招待リンク", exact: true })
  460 |     .inputValue();
  461 |   const context = await browser.newContext({
  462 |     baseURL: "http://127.0.0.1:3187",
  463 |     viewport: { width: 1440, height: 1000 },
  464 |   });
  465 |   const other = await context.newPage();
  466 |   try {
  467 |     await signIn(other, guest, invite, page);
  468 |     await saved(other);
  469 |     await openEditor(other);
  470 |     await expect(
  471 |       other.getByRole("textbox", { name: "ページの名前", exact: true }),
  472 |     ).toHaveAttribute("readonly", "");
  473 |     await expect(button(other, "文字")).toBeDisabled();
  474 |     await expect(button(other, "空のシートを追加")).toBeDisabled();
  475 |     await button(other, "付箋を追加").click();
  476 |     const sticky = other.getByRole("textbox", {
  477 |       name: "付箋のコメント",
  478 |       exact: true,
  479 |     });
  480 |     await expect(sticky).toBeFocused();
  481 |     await sticky.fill("ここをもっと説明してほしいです");
  482 |     await expect(other.locator(".sticky-note")).toContainText("保存済み");
  483 |     await button(other, "付箋の色とサイズ").click();
  484 |     await button(other, "ピンクの付箋").click();
  485 |     await button(other, "付箋のサイズ：大").click();
  486 |     await expect(other.locator(".sticky-note")).toHaveCSS(
  487 |       "background-color",
  488 |       "rgb(255, 217, 227)",
  489 |     );
  490 |     await expect(other.locator(".sticky-note")).toContainText("保存済み");
  491 |
  492 |     await expect(
  493 |       other.getByRole("button", { name: "付箋を投稿", exact: true }),
  494 |     ).toHaveCount(0);
  495 |     await button(page, "参加者一覧を更新").click();
  496 |     await button(page, `${guest}の編集権限を設定`).click();
  497 |     await page
  498 |       .getByRole("combobox", { name: "編集の権限", exact: true })
  499 |       .selectOption("scoped");
  500 |     await button(page, "編集を許可する行2").click();
  501 |     await button(page, "編集を許可する列3").click();
  502 |     await button(page, "編集を許可するスライド1.1 わたしたちのまち").click();
  503 |     await page.screenshot({ path: info.outputPath("permissions.png") });
  504 |     await button(page, "権限を保存").click();
  505 |     await expect(button(other, "文字")).toBeEnabled();
  506 |     await button(page, "クラウドの作品を閉じる").click();
  507 |     await openEditor(page);
  508 |     await expect(page.locator(".sticky-note textarea")).toHaveValue(
  509 |       "ここをもっと説明してほしいです",
  510 |     );
  511 |     await expect(page.locator(".sticky-note")).toHaveCSS(
  512 |       "background-color",
  513 |       "rgb(255, 217, 227)",
  514 |     );
  515 |     await page.screenshot({ path: info.outputPath("comments.png") });
  516 |     await other.locator(".editor-workspace .element").first().click();
  517 |     const text = other.getByRole("textbox", {
  518 |       name: "スライド内の文字",
  519 |       exact: true,
  520 |     });
  521 |     await expect(text).toBeFocused();
  522 |     await text.press("Home");
  523 |     await other.keyboard.type("guest edit ");
  524 |     await saved(other);
  525 |     await expect(page.locator(".editor-workspace")).toContainText("guest edit");
  526 |     await other.keyboard.press("Escape");
  527 |     await button(other, "1段目の横のページをひらく").click();
  528 |     await button(other, "1.2 自然がいっぱいを編集").click();
  529 |     await expect(button(other, "文字")).toBeDisabled();
  530 |     await expect(
  531 |       other.getByRole("textbox", { name: "ページの名前", exact: true }),
  532 |     ).toHaveAttribute("readonly", "");
  533 |     await button(other, "横のページ一覧を閉じる").click();
  534 |     await page.getByRole("button", { name: "クラウド", exact: true }).click();
  535 |     await button(page, `${guest}の編集権限を設定`).click();
  536 |     await page
  537 |       .getByRole("combobox", { name: "編集の権限", exact: true })
```
