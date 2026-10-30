# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: guest-inventory.spec.ts >> guest inventory: viewer keeps primary actions reachable at school screen widths
- Location: tests/cloud/guest-inventory.spec.ts:7:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.toast')
Expected substring: "この操作はホストから許可された編集範囲を超えています。"
Received string:    "ページを削除しました。「もとに戻す」で戻せます。"
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('.toast') with timeout 5000ms
  - waiting for locator('.toast')
    14 × locator resolved to <div role="status" class="toast">…</div>
       - unexpected value "ページを削除しました。「もとに戻す」で戻せます。"

```

```yaml
- status:
  - text: ページを削除しました。「もとに戻す」で戻せます。
  - button "通知を閉じる":
    - img
```

# Test source

```ts
  22  |               {
  23  |                 email: `${name}@example.test`,
  24  |                 access: {
  25  |                   mode: role === "assigned" ? "scoped" : "none",
  26  |                   comment: role !== "viewer",
  27  |                   rows:
  28  |                     role === "assigned" ? [{ sheetId: "main", index: 0 }] : [],
  29  |                   columns: [],
  30  |                   slides: [],
  31  |                 },
  32  |               },
  33  |             ],
  34  |           },
  35  |         })
  36  |       ).status(),
  37  |     ).toBe(200);
  38  |     if (role === "assigned") {
  39  |       await page
  40  |         .getByRole("button", { name: "ゲストの設定", exact: true })
  41  |         .click();
  42  |       await page.getByLabel("ゲストの表示範囲").selectOption("assigned");
  43  |       await page.keyboard.press("Escape");
  44  |     }
  45  |     const context = await browser.newContext({
  46  |       baseURL: scopeOrigin,
  47  |       hasTouch: !!info.project.use.hasTouch,
  48  |       isMobile: !!info.project.use.isMobile,
  49  |       deviceScaleFactor: info.project.use.deviceScaleFactor,
  50  |       viewport: { width: 1024, height: 768 },
  51  |     });
  52  |     const guest = await context.newPage();
  53  |     const errors: string[] = [];
  54  |     guest.on("pageerror", (error) => errors.push(error.message));
  55  |     try {
  56  |       await scopeLogin(guest, name);
  57  |       await guest.goto(`/?room=${id}`);
  58  |       await expect(guest.locator(".cloud-presence")).toContainText(
  59  |         "クラウドに保存済み",
  60  |       );
  61  |       await expect(guest.locator(".slide-card")).toHaveCount(
  62  |         role === "assigned" ? 3 : 9,
  63  |       );
  64  |       expect(await guest.evaluate(() => navigator.maxTouchPoints > 0)).toBe(
  65  |         !!info.project.use.hasTouch,
  66  |       );
  67  |       for (const width of [1366, 1024, 810]) {
  68  |         await guest.setViewportSize({ width, height: 768 });
  69  |         await expect(
  70  |           guest.getByRole("button", { name: "ファイルに保存", exact: true }),
  71  |         ).toBeEnabled();
  72  |         const present = guest.getByRole("button", {
  73  |           name: role === "assigned" ? "この3ページを発表" : "発表する",
  74  |           exact: true,
  75  |         });
  76  |         await expect(present).toBeEnabled();
  77  |         for (const button of [
  78  |           present,
  79  |           guest.getByRole("button", { name: "ファイルに保存", exact: true }),
  80  |         ]) {
  81  |           const box = (await button.boundingBox())!;
  82  |           expect(box.x).toBeGreaterThanOrEqual(0);
  83  |           expect(box.x + box.width).toBeLessThanOrEqual(width);
  84  |         }
  85  |         await expect(
  86  |           guest.getByRole("button", { name: "ゲストの設定", exact: true }),
  87  |         ).toHaveCount(0);
  88  |         await expect(
  89  |           guest.getByRole("button", { name: "全員の画面を同期", exact: true }),
  90  |         ).toHaveCount(0);
  91  |         await guest.screenshot({
  92  |           path: info.outputPath(`${role}-map-${width}.png`),
  93  |         });
  94  |         await guest.locator(".thumbnail").first().click();
  95  |         await expect(guest.locator(".workspace-flight")).toHaveCount(0);
  96  |         expect(
  97  |           (await guest.locator(".editor-layout").boundingBox())!.y,
  98  |         ).toBeLessThanOrEqual(104);
  99  |         const text = guest.getByRole("button", { name: "文字", exact: true });
  100 |         if (role === "assigned") await expect(text).toBeEnabled();
  101 |         else await expect(text).toBeDisabled();
  102 |         const note = guest.getByRole("button", {
  103 |           name: "付箋を追加",
  104 |           exact: true,
  105 |         });
  106 |         if (role === "viewer") await expect(note).toBeDisabled();
  107 |         else await expect(note).toBeEnabled();
  108 |         await guest.screenshot({
  109 |           path: info.outputPath(`${role}-editor-${width}.png`),
  110 |         });
  111 |         await guest
  112 |           .getByRole("button", { name: "全体マップへ", exact: true })
  113 |           .click();
  114 |         await expect(guest.locator(".workspace-flight")).toHaveCount(0);
  115 |       }
  116 |       if (role === "viewer") {
  117 |         const before = (
  118 |           await (await page.request.get(`/api/decks/${id}/backup`)).json()
  119 |         ).deck;
  120 |         await guest.locator(".slide-card .delete").first().click();
  121 |         await expect(guest.locator(".slide-card")).toHaveCount(9);
> 122 |         await expect(guest.locator(".toast")).toContainText(
      |                                               ^ Error: expect(locator).toContainText(expected) failed
  123 |           "この操作はホストから許可された編集範囲を超えています。",
  124 |         );
  125 |         expect(
  126 |           (await (await page.request.get(`/api/decks/${id}/backup`)).json())
  127 |             .deck,
  128 |         ).toEqual(before);
  129 |         await page.locator(".slide-card .delete").first().click();
  130 |         await expect(page.locator(".slide-card")).toHaveCount(8);
  131 |         await expect(page.locator(".toast")).toContainText("ページを削除しました。");
  132 |         await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  133 |         await expect(page.locator(".slide-card")).toHaveCount(9);
  134 |       }
  135 |       expect(errors).toEqual([]);
  136 |     } finally {
  137 |       await context.close();
  138 |     }
  139 |   });
  140 | }
  141 | 
```