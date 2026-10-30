# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: guest-inventory.spec.ts >> guest inventory: viewer keeps primary actions reachable at school screen widths
- Location: tests/cloud/guest-inventory.spec.ts:7:3

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator:  getByRole('button', { name: '比較', exact: true })
Expected: enabled
Received: disabled
Timeout:  5000ms

Call log:
  - Expect "toBeEnabled" getByRole('button', { name: '比較', exact: true }) with timeout 5000ms
  - waiting for getByRole('button', { name: '比較', exact: true })
    14 × locator resolved to <button disabled aria-describedby="_r_4_" title="比較するページを2〜4枚選んでください。" class="button outline map-compare">…</button>
       - unexpected value "disabled"

```

```yaml
- button "比較" [disabled]
```

# Test source

```ts
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
  91  |         if (role !== "assigned") {
  92  |           await expect(guest.locator(".map-readonly-note")).toContainText(
  93  |             "ページの追加・移動・削除はできません",
  94  |           );
  95  |           expect(
  96  |             await guest
  97  |               .locator(
  98  |                 ".map-panel .delete, .map-panel .add-dot, .map-panel .empty-cell, .map-panel [data-map-drag-handle]",
  99  |               )
  100 |               .evaluateAll((nodes) =>
  101 |                 nodes.every((node) => node.matches(":disabled")),
  102 |               ),
  103 |           ).toBe(true);
  104 |           await expect(
  105 |             guest.locator(".map-scroll [data-map-drag-source]"),
  106 |           ).toHaveCount(0);
  107 |           await expect(
  108 |             guest.locator('.slide-card[draggable="true"]'),
  109 |           ).toHaveCount(0);
  110 |         }
  111 |         await guest.screenshot({
  112 |           path: info.outputPath(`${role}-map-${width}.png`),
  113 |         });
  114 |         await guest.locator(".thumbnail").first().click();
  115 |         await expect(guest.locator(".workspace-flight")).toHaveCount(0);
  116 |         expect(
  117 |           (await guest.locator(".editor-layout").boundingBox())!.y,
  118 |         ).toBeLessThanOrEqual(104);
  119 |         const text = guest.getByRole("button", { name: "文字", exact: true });
  120 |         if (role === "assigned") await expect(text).toBeEnabled();
  121 |         else await expect(text).toBeDisabled();
  122 |         const note = guest.getByRole("button", {
  123 |           name: "付箋を追加",
  124 |           exact: true,
  125 |         });
  126 |         if (role === "viewer") await expect(note).toBeDisabled();
  127 |         else await expect(note).toBeEnabled();
  128 |         await guest.screenshot({
  129 |           path: info.outputPath(`${role}-editor-${width}.png`),
  130 |         });
  131 |         await guest
  132 |           .getByRole("button", { name: "全体マップへ", exact: true })
  133 |           .click();
  134 |         await expect(guest.locator(".workspace-flight")).toHaveCount(0);
  135 |       }
  136 |       if (role === "viewer") {
  137 |         const before = (
  138 |           await (await page.request.get(`/api/decks/${id}/backup`)).json()
  139 |         ).deck;
  140 |         await guest
  141 |           .locator(".slide-card .thumbnail")
  142 |           .first()
  143 |           .click({ button: "right" });
  144 |         const menu = guest.getByRole("menu", {
  145 |           name: "ページの操作",
  146 |           exact: true,
  147 |         });
  148 |         await expect(menu).toContainText(
  149 |           "閲覧のみのため、ページの複製・削除はできません。",
  150 |         );
  151 |         await expect(menu).toBeFocused();
  152 |         await expect(menu.locator("button:not(:disabled)")).toHaveCount(0);
  153 |         await guest.keyboard.press("Escape");
  154 |         await expect(
  155 |           guest.locator(".slide-card .thumbnail").first(),
  156 |         ).toBeFocused();
  157 | 
  158 |         await guest
  159 |           .getByRole("button", { name: "スライドを複数選択", exact: true })
  160 |           .click();
  161 |         await guest.locator(".slide-card .thumbnail").nth(0).click();
  162 |         await guest.locator(".slide-card .thumbnail").nth(1).click();
  163 |         await expect(
  164 |           guest.getByRole("button", { name: "比較", exact: true }),
> 165 |         ).toBeEnabled();
      |           ^ Error: expect(locator).toBeEnabled() failed
  166 |         await expect(
  167 |           guest.getByRole("button", {
  168 |             name: "選択したページでフィルタ",
  169 |             exact: true,
  170 |           }),
  171 |         ).toBeEnabled();
  172 |         await expect(
  173 |           guest.getByRole("button", {
  174 |             name: "選択したページを削除",
  175 |             exact: true,
  176 |           }),
  177 |         ).toBeDisabled();
  178 |         await guest.keyboard.press("Delete");
  179 |         await expect(guest.locator(".selection-delete-confirm")).toHaveCount(0);
  180 |         await guest.getByRole("button", { name: "比較", exact: true }).click();
  181 |         await expect(
  182 |           guest
  183 |             .getByLabel("対象スライド")
  184 |             .getByRole("checkbox", { checked: true }),
  185 |         ).toHaveCount(2);
  186 |         await guest
  187 |           .getByRole("button", { name: "閉じる", exact: true })
  188 |           .click();
  189 |         await guest
  190 |           .getByRole("button", { name: "選択を終了", exact: true })
  191 |           .click();
  192 | 
  193 |         if (info.project.use.hasTouch) {
  194 |           const box = (await guest
  195 |             .locator(".slide-card .thumbnail")
  196 |             .first()
  197 |             .boundingBox())!;
  198 |           const session = await context.newCDPSession(guest);
  199 |           await session.send("Input.dispatchTouchEvent", {
  200 |             type: "touchStart",
  201 |             touchPoints: [{ id: 1, x: box.x + 40, y: box.y + 40 }],
  202 |           });
  203 |           // The former drag threshold is 280ms: allow it to elapse, then move.
  204 |           await guest.waitForTimeout(350);
  205 |           await session.send("Input.dispatchTouchEvent", {
  206 |             type: "touchMove",
  207 |             touchPoints: [{ id: 1, x: box.x + 100, y: box.y + 60 }],
  208 |           });
  209 |           await expect(guest.locator(".map-touch-preview")).toHaveCount(0);
  210 |           await session.send("Input.dispatchTouchEvent", {
  211 |             type: "touchEnd",
  212 |             touchPoints: [],
  213 |           });
  214 |           await session.detach();
  215 |           await expect(guest.locator(".move-banner")).toHaveCount(0);
  216 |           await guest.keyboard.press("Escape");
  217 |         }
  218 |         await expect(
  219 |           guest.locator(".slide-card .delete").first(),
  220 |         ).toBeDisabled();
  221 |         await guest
  222 |           .locator(".slide-card .delete")
  223 |           .first()
  224 |           .click({ force: true });
  225 |         await expect(guest.locator(".slide-card")).toHaveCount(9);
  226 |         await expect(
  227 |           guest.locator(".toast").filter({ hasText: "ページを削除しました。" }),
  228 |         ).toHaveCount(0);
  229 |         expect(
  230 |           (await (await page.request.get(`/api/decks/${id}/backup`)).json())
  231 |             .deck,
  232 |         ).toEqual(before);
  233 |         await page.locator(".slide-card .delete").first().click();
  234 |         await expect(page.locator(".slide-card")).toHaveCount(8);
  235 |         await expect(page.locator(".toast")).toContainText(
  236 |           "ページを削除しました。",
  237 |         );
  238 |         await page
  239 |           .getByRole("button", { name: "もとに戻す", exact: true })
  240 |           .click();
  241 |         await expect(page.locator(".slide-card")).toHaveCount(9);
  242 |       }
  243 |       expect(errors).toEqual([]);
  244 |     } finally {
  245 |       await context.close();
  246 |     }
  247 |   });
  248 | }
  249 | 
  250 | test("live permission changes cancel a pending map move and restore authorized controls", async ({
  251 |   page,
  252 |   browser,
  253 | }, info) => {
  254 |   const id = await scopeFixture(
  255 |     page,
  256 |     `${info.project.name}-live-controls-host`,
  257 |   );
  258 |   const name = `${info.project.name}-live-controls-guest`;
  259 |   const grant = async (mode: "all" | "none") => {
  260 |     expect(
  261 |       (
  262 |         await page.request.post(`/api/decks/${id}/recipients`, {
  263 |           headers: { Origin: scopeOrigin },
  264 |           data: {
  265 |             recipients: [
```