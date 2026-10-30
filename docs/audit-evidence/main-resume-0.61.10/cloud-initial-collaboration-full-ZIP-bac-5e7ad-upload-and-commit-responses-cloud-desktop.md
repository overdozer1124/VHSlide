# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collaboration.spec.ts >> full ZIP backups preserve failed jobs and resume after reload with lost upload and commit responses
- Location: tests/cloud/collaboration.spec.ts:1307:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.backup-message')
Expected substring: "写真の保存容量が不足しています"
Received string:    "写真を復元中 1 / 1"

Call log:
  - Expect "toContainText" locator('.backup-message') with timeout 5000ms
  - waiting for locator('.backup-message')
    - locator resolved to <p role="status" class="backup-message">バックアップと前回の復元を確認しています…</p>
    - unexpected value "バックアップと前回の復元を確認しています…"
    4 × locator resolved to <p role="status" class="backup-message">写真を復元中 1 / 1</p>
      - unexpected value "写真を復元中 1 / 1"
  - Test ended.

```

```yaml
- status: 写真を復元中 1 / 1
```

# Test source

```ts
  1389 |     blockedDownloads++;
  1390 |   };
  1391 |   page.on("download", unexpectedDownload);
  1392 |   await page.route(`**/api/decks/${source}/backup/verify`, async (route) => {
  1393 |     const r = await page.request.post(`/api/decks/${source}/recipients`, {
  1394 |       headers: { Origin: "http://127.0.0.1:3187" },
  1395 |       data: { recipients: [{ email, name: "取得中の変更", access }] },
  1396 |     });
  1397 |     expect(r.ok()).toBe(true);
  1398 |     await route.continue();
  1399 |   });
  1400 |   if (
  1401 |     !(await page
  1402 |       .getByRole("button", { name: "完全バックアップを保存", exact: true })
  1403 |       .isVisible())
  1404 |   ) {
  1405 |     await page
  1406 |       .getByRole("button", { name: "作品一覧のその他", exact: true })
  1407 |       .click();
  1408 |     await page
  1409 |       .getByRole("menuitem", { name: "バックアップと復元", exact: true })
  1410 |       .click();
  1411 |   }
  1412 |   await page
  1413 |     .getByRole("button", { name: "完全バックアップを保存", exact: true })
  1414 |     .click();
  1415 |   await expect(page.locator(".backup-message")).toContainText("変更");
  1416 |   expect(blockedDownloads).toBe(0);
  1417 |   page.off("download", unexpectedDownload);
  1418 |   await page.unroute(`**/api/decks/${source}/backup/verify`);
  1419 |   const input = page.locator('input[aria-label="復元するバックアップ"]');
  1420 |   await input.setInputFiles({
  1421 |     name: "broken.zip",
  1422 |     mimeType: "application/zip",
  1423 |     buffer: Buffer.from("broken"),
  1424 |   });
  1425 |   await expect(
  1426 |     page.getByRole("button", { name: "バックアップから復元", exact: true }),
  1427 |   ).toBeEnabled();
  1428 |   await expect(page.locator(".backup-message")).not.toBeEmpty();
  1429 |   await input.setInputFiles({
  1430 |     name: "saved.vhslide.zip",
  1431 |     mimeType: "application/zip",
  1432 |     buffer: bytes,
  1433 |   });
  1434 |   // The confirmation is a named block, while the checkbox is an explicit opt-in.
  1435 |   const share = page.getByRole("checkbox", {
  1436 |     name: "共有アカウントと編集権限も確認して復元する",
  1437 |     exact: true,
  1438 |   });
  1439 |   await expect(share).not.toBeChecked();
  1440 |   await share.check();
  1441 |   await expect(
  1442 |     page.getByRole("list", { name: "復元する共有アカウント", exact: true }),
  1443 |   ).toContainText(email);
  1444 |   await page
  1445 |     .getByRole("button", { name: "新しい作品に復元する", exact: true })
  1446 |     .click();
  1447 |   await expect
  1448 |     .poll(() => new URL(page.url()).searchParams.get("room"))
  1449 |     .not.toBe(source);
  1450 |   await saved(page);
  1451 |   const target = new URL(page.url()).searchParams.get("room")!;
  1452 |   const restored = await (
  1453 |     await page.request.get(`/api/decks/${target}/backup`)
  1454 |   ).json();
  1455 |   expect(restored.comments[0].authorName).toMatch(/（復元）$/);
  1456 |   expect(restored.sharing[0].access).toEqual(access);
  1457 |   expect(
  1458 |     restored.deck.slides
  1459 |       .flatMap((s: any) => s.elements)
  1460 |       .find((e: any) => e.type === "image").src,
  1461 |   ).toContain(`/api/decks/${target}/assets/`);
  1462 |   const sourceAfter = await (
  1463 |     await page.request.get(`/api/decks/${source}/backup`)
  1464 |   ).json();
  1465 |   expect(sourceAfter.deck).toEqual(archive.snapshot.deck);
  1466 |   await page.getByRole("button", { name: "クラウド", exact: true }).click();
  1467 |   await page.getByRole("tab", { name: /作品一覧/ }).click();
  1468 |   await page.locator('input[aria-label="復元するバックアップ"]').setInputFiles({
  1469 |     name: "saved.zip",
  1470 |     mimeType: "application/zip",
  1471 |     buffer: bytes,
  1472 |   });
  1473 |   for (const failure of [
  1474 |     { status: 503, message: "写真の復元テスト失敗" },
  1475 |     { status: 413, message: "写真の保存容量が不足しています" },
  1476 |   ]) {
  1477 |     await page.route("**/api/decks/*/assets", async (route) => {
  1478 |       if (route.request().method() === "POST")
  1479 |         await route.fulfill({
  1480 |           status: failure.status,
  1481 |           contentType: "application/json",
  1482 |           body: JSON.stringify({ error: failure.message }),
  1483 |         });
  1484 |       else await route.continue();
  1485 |     });
  1486 |     await page
  1487 |       .getByRole("button", { name: "新しい作品に復元する", exact: true })
  1488 |       .click();
> 1489 |     await expect(page.locator(".backup-message")).toContainText(
       |                                                   ^ Error: expect(locator).toContainText(expected) failed
  1490 |       failure.message,
  1491 |     );
  1492 |     await page.unroute("**/api/decks/*/assets");
  1493 |   }
  1494 |   const works = await (await page.request.get("/api/decks")).json();
  1495 |   expect(works.decks).toHaveLength(3);
  1496 |   expect(works.decks.some((d: any) => d.status === "restoring")).toBe(true);
  1497 |   expect(new URL(page.url()).searchParams.get("room")).toBe(target);
  1498 |   const pendingId = works.decks.find((d: any) => d.status === "restoring").id;
  1499 |   await page.unroute("**/api/decks/*/assets");
  1500 |   await page.reload();
  1501 |   await saved(page);
  1502 |   await page.getByRole("button", { name: "クラウド", exact: true }).click();
  1503 |   await page.getByRole("tab", { name: /作品一覧/ }).click();
  1504 |   await expect(page.getByLabel("未完了の復元", { exact: true })).toBeVisible();
  1505 |   await page
  1506 |     .getByRole("button", { name: "ファイルを選んで再開", exact: true })
  1507 |     .click();
  1508 |   await page.locator('input[aria-label="復元するバックアップ"]').setInputFiles({
  1509 |     name: "saved.zip",
  1510 |     mimeType: "application/zip",
  1511 |     buffer: bytes,
  1512 |   });
  1513 |   await expect(
  1514 |     page.getByRole("checkbox", {
  1515 |       name: "共有アカウントと編集権限も確認して復元する",
  1516 |       exact: true,
  1517 |     }),
  1518 |   ).not.toBeChecked();
  1519 |   let lostUpload = false,
  1520 |     lostCommit = 0;
  1521 |   await page.route("**/api/decks/*/assets", async (route) => {
  1522 |     if (route.request().method() === "POST" && !lostUpload) {
  1523 |       lostUpload = true;
  1524 |       const r = await route.fetch();
  1525 |       expect(r.status()).toBe(201);
  1526 |       await route.abort("connectionreset");
  1527 |     } else await route.continue();
  1528 |   });
  1529 |   await page.route("**/api/decks/*/restore", async (route) => {
  1530 |     if (route.request().method() === "POST" && lostCommit < 3) {
  1531 |       lostCommit++;
  1532 |       const r = await route.fetch();
  1533 |       expect(r.status()).toBe(200);
  1534 |       await route.abort("connectionreset");
  1535 |     } else await route.continue();
  1536 |   });
  1537 |   await page
  1538 |     .getByRole("button", { name: "復元を再開する", exact: true })
  1539 |     .click();
  1540 |   await expect
  1541 |     .poll(() => new URL(page.url()).searchParams.get("room"))
  1542 |     .toBe(pendingId);
  1543 |   await saved(page);
  1544 |   expect(lostUpload).toBe(true);
  1545 |   expect(lostCommit).toBe(3);
  1546 |   const job = await (
  1547 |     await page.request.get(`/api/restores/${pendingId}`)
  1548 |   ).json();
  1549 |   expect(job.status).toBe("ready");
  1550 |   expect(job.images).toBe(1);
  1551 |   const after = await (await page.request.get("/api/decks")).json();
  1552 |   expect(after.decks).toHaveLength(3);
  1553 |   expect(after.decks.some((d: any) => d.status === "restoring")).toBe(false);
  1554 | });
  1555 |
  1556 | test("restores a signed-in room in the background without flashing the cloud dialog", async ({
  1557 |   page,
  1558 | }, info) => {
  1559 |   await signIn(page, `quiet-reload-${info.project.name}`);
  1560 |   await page
  1561 |     .getByRole("button", { name: "この作品をクラウドに保存", exact: true })
  1562 |     .click();
  1563 |   await saved(page);
  1564 |   const room = new URL(page.url()).searchParams.get("room")!;
  1565 |   const endpoint = `**/api/decks/${room}`;
  1566 |   await page.addInitScript(() => {
  1567 |     const state = window as typeof window & { cloudDialogAppeared: boolean };
  1568 |     state.cloudDialogAppeared = false;
  1569 |     const selector = '[role="dialog"][aria-label="クラウドの作品"]';
  1570 |     new MutationObserver((records) => {
  1571 |       for (const record of records)
  1572 |         for (const node of record.addedNodes)
  1573 |           if (
  1574 |             node instanceof Element &&
  1575 |             (node.matches(selector) || node.querySelector(selector))
  1576 |           )
  1577 |             state.cloudDialogAppeared = true;
  1578 |     }).observe(document, { childList: true, subtree: true });
  1579 |   });
  1580 |   let release!: () => void;
  1581 |   const gate = new Promise<void>((resolve) => {
  1582 |     release = resolve;
  1583 |   });
  1584 |   await page.route(endpoint, async (route) => {
  1585 |     await gate;
  1586 |     await route.continue();
  1587 |   });
  1588 |   const opening = page.waitForRequest((request) =>
  1589 |     request.url().endsWith(`/api/decks/${room}`),
```
