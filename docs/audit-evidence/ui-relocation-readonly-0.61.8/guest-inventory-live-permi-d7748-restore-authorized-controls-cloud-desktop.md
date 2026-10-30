# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: guest-inventory.spec.ts >> live permission changes cancel a pending map move and restore authorized controls
- Location: tests/cloud/guest-inventory.spec.ts:250:1

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator: getByRole('menu', { name: 'ページの操作', exact: true }).getByRole('menuitem', { name: 'このページを削除', exact: true })
Expected: enabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeEnabled" getByRole('menu', { name: 'ページの操作', exact: true }).getByRole('menuitem', { name: 'このページを削除', exact: true }) with timeout 5000ms
  - waiting for getByRole('menu', { name: 'ページの操作', exact: true }).getByRole('menuitem', { name: 'このページを削除', exact: true })

```

```yaml
- banner:
  - link "VHSlide 全体マップ":
    - /url: "#"
    - img
    - text: VH Slide
  - textbox "作品のタイトル": 範囲の検証
  - status "クラウドに保存済み · 本文と付箋の保存状態です。端末へ書き出すJSONには付箋・共有設定・過去の版は含みません。": クラウドに保存済み
  - text: スライドを編集 2人が参加中
  - button "作品"
  - button "ファイルに保存":
    - img
    - text: ファイルに保存
  - button "保存方法を選ぶ":
    - img
  - button "発表する":
    - img
    - text: 発表する
  - button "発表方法を選ぶ":
    - img
- navigation:
  - button "全体マップ":
    - img
    - text: 全体マップ
  - button "ページを編集":
    - img
    - text: ページを編集
  - button "もとに戻す" [disabled]:
    - img
  - button "やり直す" [disabled]:
    - img
  - button "その他"
- main:
  - region "ページの全体マップ":
    - heading "全体マップ" [level=1]:
      - img
      - text: 全体マップ
    - text: 学級の比較・全体 9ページ
    - button "マップをフィルタ":
      - img
      - text: フィルタ
    - button "スライドを複数選択": 選択
    - textbox "ページ番号で探す":
      - /placeholder: "3.2"
    - button "番号のページを探す":
      - img
    - group "マップの表示サイズ":
      - button "マップを縮小":
        - img
      - button "表示サイズを100%に戻す": 100%
      - button "マップを拡大" [disabled]:
        - img
    - button "マップの表示設定":
      - img
      - text: 表示
    - region "スライドのマップ":
      - text: 次の話題へ
      - img
      - text: "01"
      - textbox "列1の見出し":
        - /placeholder: 列の名前
        - text: 問い
      - button "話題1を移動":
        - img
      - text: "02"
      - textbox "列2の見出し":
        - /placeholder: 列の名前
        - text: 理由
      - button "話題2を移動":
        - img
      - text: "03"
      - textbox "列3の見出し":
        - /placeholder: 列の名前
        - text: まとめ
      - button "話題3を移動":
        - img
      - button "高さ1のページをまとめて移動": "01"
      - textbox "行1の見出し":
        - /placeholder: ""
        - text: A班
      - button "ページ1.1を編集": S1.1 発表の先頭
      - text: "1.1"
      - textbox "1.1のフッター": cloud-desktop-live-controls-guest
      - button "ページ1.1のページメニュー":
        - img
      - button "ページ1.1を移動":
        - img
      - button "ページ1.1を削除":
        - img
      - button "ページ1.1の右に次の話題を追加":
        - img
      - button "ページ1.1の下に詳しいページを追加":
        - img
      - button "ページ1.2を編集": S1.2
      - text: "1.2"
      - textbox "1.2のフッター": cloud-desktop-live-controls-guest
      - button "ページ1.2のページメニュー":
        - img
      - button "ページ1.2を移動":
        - img
      - button "ページ1.2を削除":
        - img
      - button "ページ1.2の右に次の話題を追加":
        - img
      - button "ページ1.2の下に詳しいページを追加":
        - img
      - button "ページ1.3を編集": S1.3
      - text: "1.3"
      - textbox "1.3のフッター": cloud-desktop-live-controls-guest
      - button "ページ1.3のページメニュー":
        - img
      - button "ページ1.3を移動":
        - img
      - button "ページ1.3を削除":
        - img
      - button "ページ1.3の右に次の話題を追加":
        - img
      - button "ページ1.3の下に詳しいページを追加":
        - img
      - button "高さ2のページをまとめて移動": "02"
      - textbox "行2の見出し":
        - /placeholder: ""
        - text: B班
      - button "ページ2.1を編集": S2.1
      - text: "2.1"
      - textbox "2.1のフッター": cloud-desktop-live-controls-guest
      - button "ページ2.1のページメニュー":
        - img
      - button "ページ2.1を移動":
        - img
      - button "ページ2.1を削除":
        - img
      - button "ページ2.1の右に次の話題を追加":
        - img
      - button "ページ2.1の下に詳しいページを追加":
        - img
      - button "ページ2.2を編集": S2.2
      - text: "2.2"
      - textbox "2.2のフッター": cloud-desktop-live-controls-guest
      - button "ページ2.2のページメニュー":
        - img
      - button "ページ2.2を移動":
        - img
      - button "ページ2.2を削除":
        - img
      - button "ページ2.2の右に次の話題を追加":
        - img
      - button "ページ2.2の下に詳しいページを追加":
        - img
      - button "ページ2.3を編集": S2.3
      - text: "2.3"
      - textbox "2.3のフッター": cloud-desktop-live-controls-guest
      - button "ページ2.3のページメニュー":
        - img
      - button "ページ2.3を移動":
        - img
      - button "ページ2.3を削除":
        - img
      - button "ページ2.3の右に次の話題を追加":
        - img
      - button "ページ2.3の下に詳しいページを追加":
        - img
      - button "高さ3のページをまとめて移動": "03"
      - textbox "行3の見出し":
        - /placeholder: ""
        - text: C班
      - button "ページ3.1を編集": S3.1
      - text: "3.1"
      - textbox "3.1のフッター": cloud-desktop-live-controls-guest
      - button "ページ3.1のページメニュー":
        - img
      - button "ページ3.1を移動":
        - img
      - button "ページ3.1を削除":
        - img
      - button "ページ3.1の右に次の話題を追加":
        - img
      - button "ページ3.1の下に詳しいページを追加":
        - img
      - button "ページ3.2を編集": S3.2
      - text: "3.2"
      - textbox "3.2のフッター": cloud-desktop-live-controls-guest
      - button "ページ3.2のページメニュー":
        - img
      - button "ページ3.2を移動":
        - img
      - button "ページ3.2を削除":
        - img
      - button "ページ3.2の右に次の話題を追加":
        - img
      - button "ページ3.2の下に詳しいページを追加":
        - img
      - button "ページ3.3を編集": S3.3
      - text: "3.3"
      - textbox "3.3のフッター": cloud-desktop-live-controls-guest
      - button "ページ3.3のページメニュー":
        - img
      - button "ページ3.3を移動":
        - img
      - button "ページ3.3を削除":
        - img
      - button "ページ3.3の右に次の話題を追加":
        - img
      - button "ページ3.3の下に詳しいページを追加":
        - img
    - text: ↔ よこは「次の話題」 / ↕ たては「くわしい説明」 長押し・つまみで移動 · ピンチで拡大・縮小
- tablist "作品のシート":
  - tab "学級の比較" [selected]
  - tab "別シート"
- button "空のシートを追加" [disabled]:
  - img
- button "シートの操作" [disabled]:
  - img
- status
```

# Test source

```ts
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
  266 |               {
  267 |                 email: `${name}@example.test`,
  268 |                 access: {
  269 |                   mode,
  270 |                   comment: true,
  271 |                   rows: [],
  272 |                   columns: [],
  273 |                   slides: [],
  274 |                 },
  275 |               },
  276 |             ],
  277 |           },
  278 |         })
  279 |       ).status(),
  280 |     ).toBe(200);
  281 |   };
  282 |   await grant("all");
  283 |   const before = (
  284 |     await (await page.request.get(`/api/decks/${id}/backup`)).json()
  285 |   ).deck;
  286 |   const context = await browser.newContext({
  287 |     baseURL: scopeOrigin,
  288 |     hasTouch: !!info.project.use.hasTouch,
  289 |     isMobile: !!info.project.use.isMobile,
  290 |     viewport: { width: 1024, height: 768 },
  291 |   });
  292 |   try {
  293 |     const guest = await context.newPage();
  294 |     await scopeLogin(guest, name);
  295 |     await guest.goto(`/?room=${id}`);
  296 |     const handle = guest.locator(".slide-card [data-map-drag-handle]").first();
  297 |     await expect(handle).toBeEnabled();
  298 |     await handle.click();
  299 |     await expect(guest.locator(".move-banner")).toBeVisible();
  300 |     await grant("none");
  301 |     await expect(guest.locator(".map-readonly-note")).toBeVisible();
  302 |     await expect(guest.locator(".move-banner")).toHaveCount(0);
  303 |     await expect(handle).toBeDisabled();
  304 |     await guest
  305 |       .locator(".slide-card .thumbnail")
  306 |       .first()
  307 |       .click({ button: "right" });
  308 |     const menu = guest.getByRole("menu", { name: "ページの操作", exact: true });
  309 |     await expect(
  310 |       menu.getByRole("menuitem", { name: "このページを削除", exact: true }),
  311 |     ).toBeDisabled();
  312 |     await grant("all");
  313 |     await expect(guest.locator(".map-readonly-note")).toHaveCount(0);
  314 |     await expect(
  315 |       menu.getByRole("menuitem", { name: "このページを削除", exact: true }),
> 316 |     ).toBeEnabled();
      |       ^ Error: expect(locator).toBeEnabled() failed
  317 |     await guest.keyboard.press("Escape");
  318 |     await expect(handle).toBeEnabled();
  319 |     await handle.click();
  320 |     await expect(guest.locator(".move-banner")).toBeVisible();
  321 |     await guest
  322 |       .getByRole("button", { name: "キャンセル", exact: true })
  323 |       .click();
  324 |     await expect(guest.locator(".move-banner")).toHaveCount(0);
  325 |     expect(
  326 |       (await (await page.request.get(`/api/decks/${id}/backup`)).json()).deck,
  327 |     ).toEqual(before);
  328 |   } finally {
  329 |     await context.close();
  330 |   }
  331 | });
  332 | 
```