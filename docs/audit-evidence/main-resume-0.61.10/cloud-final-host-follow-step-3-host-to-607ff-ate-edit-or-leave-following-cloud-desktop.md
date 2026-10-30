# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: host-follow.spec.ts >> step 3 host toggles once and guests cannot navigate, edit or leave following
- Location: tests/cloud/host-follow.spec.ts:157:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 3
Received:   3

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - link "VHSlide 全体マップ" [ref=e5] [cursor=pointer]:
      - /url: "#"
      - text: VH
      - generic [ref=e12]: Slide
    - generic [ref=e14]:
      - textbox "作品のタイトル" [ref=e15]: 範囲の検証
      - generic [ref=e16]:
        - status "クラウドに保存済み · 本文と付箋の保存状態です。端末へ書き出すJSONには付箋・共有設定・過去の版は含みません。" [ref=e19]:
          - generic [ref=e22]: クラウドに保存済み
        - generic [ref=e23]: ホスト
        - generic [ref=e24]: 1人が参加中
    - generic [ref=e25]:
      - generic [ref=e26]:
        - button "ファイル" [ref=e28] [cursor=pointer]
        - button "ファイルに保存" [ref=e34] [cursor=pointer]:
          - generic [ref=e38]: 保存
      - button "クラウド" [ref=e39] [cursor=pointer]
      - generic [ref=e43]:
        - button "全員の画面を同期" [pressed] [ref=e44] [cursor=pointer]: 集合を終了
        - status [ref=e45]: 全員に表示中・ゲスト0人
      - button "ゲストの設定" [ref=e47] [cursor=pointer]
      - generic [ref=e50]:
        - button "発表する" [ref=e51] [cursor=pointer]
        - button "発表方法を選ぶ" [ref=e57] [cursor=pointer]
  - navigation [ref=e60]:
    - generic [ref=e61]:
      - button "全体マップ" [ref=e62] [cursor=pointer]
      - button "ページを編集" [ref=e68] [cursor=pointer]
    - generic [ref=e71]:
      - button "もとに戻す" [disabled] [ref=e72]
      - button "やり直す" [disabled] [ref=e76]
      - button "その他" [ref=e82] [cursor=pointer]
  - main [ref=e88]:
    - region "ページの全体マップ" [ref=e89]:
      - generic [ref=e90]:
        - generic [ref=e91]:
          - heading "全体マップ" [level=1] [ref=e92]
          - generic "学級の比較・全体・9ページ" [ref=e99]:
            - generic [ref=e100]: 学級の比較・全体
            - generic [ref=e101]: 9ページ
        - button "マップをフィルタ" [ref=e102] [cursor=pointer]: フィルタ
        - button "スライドを複数選択" [ref=e105] [cursor=pointer]: 選択
        - button "行・列を一括操作" [ref=e108] [cursor=pointer]
        - generic [ref=e109]:
          - textbox "ページ番号で探す" [ref=e110]:
            - /placeholder: "3.2"
          - button "番号のページを探す" [ref=e111] [cursor=pointer]
        - group "マップの表示サイズ" [ref=e115]:
          - button "マップを縮小" [ref=e116] [cursor=pointer]
          - button "表示サイズを100%に戻す" [ref=e120] [cursor=pointer]: 100%
          - button "マップを拡大" [disabled] [ref=e121]
        - button "マップの表示設定" [ref=e125] [cursor=pointer]: 表示
      - region "スライドのマップ" [ref=e127]:
        - generic [ref=e128]:
          - generic [ref=e130]: 次の話題へ
          - generic [aria-hidden] [ref=e135]: 行 / 列
          - generic [ref=e136]:
            - generic [ref=e137]: "01"
            - textbox "列1の見出し" [ref=e138]:
              - /placeholder: 列の名前
              - text: 問い
            - button "話題1を移動" [ref=e139] [cursor=pointer]
          - generic [ref=e147]:
            - generic [ref=e148]: "02"
            - textbox "列2の見出し" [ref=e149]:
              - /placeholder: 列の名前
              - text: 理由
            - button "話題2を移動" [ref=e150] [cursor=pointer]
          - generic [ref=e158]:
            - generic [ref=e159]: "03"
            - textbox "列3の見出し" [ref=e160]:
              - /placeholder: 列の名前
              - text: まとめ
            - button "話題3を移動" [ref=e161] [cursor=pointer]
          - generic [ref=e169]:
            - generic "A班" [ref=e170]:
              - button "高さ1のページをまとめて移動" [ref=e171] [cursor=pointer]: "01"
              - textbox "行1の見出し" [ref=e172]:
                - /placeholder: 見出し
                - text: A班
            - generic [ref=e173]:
              - generic [ref=e174]:
                - button "ページ1.1を編集" [ref=e175] [cursor=pointer]:
                  - generic [ref=e176]: S1.1
                  - generic [ref=e177]: 発表の先頭
                - generic [ref=e178]:
                  - generic [ref=e179]: "1.1"
                  - textbox "1.1のフッター" [ref=e180]: cloud-desktop-locked-guest
                  - button "ページ1.1のページメニュー" [ref=e181] [cursor=pointer]
                  - button "ページ1.1を移動" [ref=e186] [cursor=pointer]
                  - button "ページ1.1を削除" [ref=e194] [cursor=pointer]
              - button "ページ1.1の右に次の話題を追加" [ref=e198] [cursor=pointer]
              - button "ページ1.1の下に詳しいページを追加" [ref=e200] [cursor=pointer]
            - generic [ref=e202]:
              - generic [ref=e203]:
                - button "ページ1.2を編集" [ref=e204] [cursor=pointer]:
                  - generic [ref=e205]: S1.2
                - generic [ref=e206]:
                  - generic [ref=e207]: "1.2"
                  - textbox "1.2のフッター" [ref=e208]: cloud-desktop-locked-guest
                  - button "ページ1.2のページメニュー" [ref=e209] [cursor=pointer]
                  - button "ページ1.2を移動" [ref=e214] [cursor=pointer]
                  - button "ページ1.2を削除" [ref=e222] [cursor=pointer]
              - button "ページ1.2の右に次の話題を追加" [ref=e226] [cursor=pointer]
              - button "ページ1.2の下に詳しいページを追加" [ref=e228] [cursor=pointer]
            - generic [ref=e230]:
              - generic [ref=e231]:
                - button "ページ1.3を編集" [ref=e232] [cursor=pointer]:
                  - generic [ref=e233]: S1.3
                - generic [ref=e234]:
                  - generic [ref=e235]: "1.3"
                  - textbox "1.3のフッター" [ref=e236]: cloud-desktop-locked-guest
                  - button "ページ1.3のページメニュー" [ref=e237] [cursor=pointer]
                  - button "ページ1.3を移動" [ref=e242] [cursor=pointer]
                  - button "ページ1.3を削除" [ref=e250] [cursor=pointer]
              - button "ページ1.3の右に次の話題を追加" [ref=e254] [cursor=pointer]
              - button "ページ1.3の下に詳しいページを追加" [ref=e256] [cursor=pointer]
          - generic [ref=e258]:
            - generic "B班" [ref=e259]:
              - button "高さ2のページをまとめて移動" [ref=e260] [cursor=pointer]: "02"
              - textbox "行2の見出し" [ref=e261]:
                - /placeholder: 見出し
                - text: B班
            - generic [ref=e262]:
              - generic [ref=e263]:
                - button "ページ2.1を編集" [ref=e264] [cursor=pointer]:
                  - generic [ref=e265]: S2.1
                - generic [ref=e266]:
                  - generic [ref=e267]: "2.1"
                  - textbox "2.1のフッター" [ref=e268]: cloud-desktop-locked-guest
                  - button "ページ2.1のページメニュー" [ref=e269] [cursor=pointer]
                  - button "ページ2.1を移動" [ref=e274] [cursor=pointer]
                  - button "ページ2.1を削除" [ref=e282] [cursor=pointer]
              - button "ページ2.1の右に次の話題を追加" [ref=e286] [cursor=pointer]
              - button "ページ2.1の下に詳しいページを追加" [ref=e288] [cursor=pointer]
            - generic [ref=e290]:
              - generic [ref=e291]:
                - button "ページ2.2を編集" [ref=e292] [cursor=pointer]:
                  - generic [ref=e293]: S2.2
                - generic [ref=e294]:
                  - generic [ref=e295]: "2.2"
                  - textbox "2.2のフッター" [ref=e296]: cloud-desktop-locked-guest
                  - button "ページ2.2のページメニュー" [ref=e297] [cursor=pointer]
                  - button "ページ2.2を移動" [ref=e302] [cursor=pointer]
                  - button "ページ2.2を削除" [ref=e310] [cursor=pointer]
              - button "ページ2.2の右に次の話題を追加" [ref=e314] [cursor=pointer]
              - button "ページ2.2の下に詳しいページを追加" [ref=e316] [cursor=pointer]
            - generic [ref=e318]:
              - generic [ref=e319]:
                - button "ページ2.3を編集" [ref=e320] [cursor=pointer]:
                  - generic [ref=e321]: S2.3
                - generic [ref=e322]:
                  - generic [ref=e323]: "2.3"
                  - textbox "2.3のフッター" [ref=e324]: cloud-desktop-locked-guest
                  - button "ページ2.3のページメニュー" [ref=e325] [cursor=pointer]
                  - button "ページ2.3を移動" [ref=e330] [cursor=pointer]
                  - button "ページ2.3を削除" [ref=e338] [cursor=pointer]
              - button "ページ2.3の右に次の話題を追加" [ref=e342] [cursor=pointer]
              - button "ページ2.3の下に詳しいページを追加" [ref=e344] [cursor=pointer]
          - generic [ref=e346]:
            - generic "C班" [ref=e347]:
              - button "高さ3のページをまとめて移動" [ref=e348] [cursor=pointer]: "03"
              - textbox "行3の見出し" [ref=e349]:
                - /placeholder: 見出し
                - text: C班
            - generic [ref=e350]:
              - generic [ref=e351]:
                - button "ページ3.1を編集" [ref=e352] [cursor=pointer]:
                  - generic [ref=e353]: S3.1
                - generic [ref=e354]:
                  - generic [ref=e355]: "3.1"
                  - textbox "3.1のフッター" [ref=e356]: cloud-desktop-locked-guest
                  - button "ページ3.1のページメニュー" [ref=e357] [cursor=pointer]
                  - button "ページ3.1を移動" [ref=e362] [cursor=pointer]
                  - button "ページ3.1を削除" [ref=e370] [cursor=pointer]
              - button "ページ3.1の右に次の話題を追加" [ref=e374] [cursor=pointer]
              - button "ページ3.1の下に詳しいページを追加" [ref=e376] [cursor=pointer]
            - generic [ref=e378]:
              - generic [ref=e379]:
                - button "ページ3.2を編集" [ref=e380] [cursor=pointer]:
                  - generic [ref=e381]: S3.2
                - generic [ref=e382]:
                  - generic [ref=e383]: "3.2"
                  - textbox "3.2のフッター" [ref=e384]: cloud-desktop-locked-guest
                  - button "ページ3.2のページメニュー" [ref=e385] [cursor=pointer]
                  - button "ページ3.2を移動" [ref=e390] [cursor=pointer]
                  - button "ページ3.2を削除" [ref=e398] [cursor=pointer]
              - button "ページ3.2の右に次の話題を追加" [ref=e402] [cursor=pointer]
              - button "ページ3.2の下に詳しいページを追加" [ref=e404] [cursor=pointer]
            - generic [ref=e406]:
              - generic [ref=e407]:
                - button "ページ3.3を編集" [ref=e408] [cursor=pointer]:
                  - generic [ref=e409]: S3.3
                - generic [ref=e410]:
                  - generic [ref=e411]: "3.3"
                  - textbox "3.3のフッター" [ref=e412]: cloud-desktop-locked-guest
                  - button "ページ3.3のページメニュー" [ref=e413] [cursor=pointer]
                  - button "ページ3.3を移動" [ref=e418] [cursor=pointer]
                  - button "ページ3.3を削除" [ref=e426] [cursor=pointer]
              - button "ページ3.3の右に次の話題を追加" [ref=e430] [cursor=pointer]
              - button "ページ3.3の下に詳しいページを追加" [ref=e432] [cursor=pointer]
      - generic [ref=e434]:
        - generic [ref=e435]:
          - generic [ref=e436]: ↔
          - text: よこは「次の話題」
          - generic [ref=e437]: /
          - generic [ref=e438]: ↕
          - text: たては「くわしい説明」
        - generic [ref=e439]: 長押し・つまみで移動 · ピンチで拡大・縮小
  - generic "シート一覧" [ref=e440]:
    - tablist "作品のシート" [ref=e441]:
      - tab "学級の比較" [selected] [ref=e443] [cursor=pointer]
      - tab "別シート" [ref=e445] [cursor=pointer]
    - button "空のシートを追加" [ref=e446] [cursor=pointer]
    - button "シートの操作" [ref=e448] [cursor=pointer]
  - status [ref=e453]
```

# Test source

```ts
  136 |       { mode: "map", sheetId: "other", pageId: "q00" },
  137 |       running.sessionId,
  138 |     );
  139 |     await expect(
  140 |       guest.getByLabel("ホストの全体マップ", { exact: true }),
  141 |     ).toBeVisible();
  142 |     await host.send(
  143 |       "move",
  144 |       { mode: "page", sheetId: "main", pageId: "p11" },
  145 |       running.sessionId,
  146 |     );
  147 |     await assertFillsPage();
  148 |     await host.send("stop", undefined, running.sessionId);
  149 |     await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
  150 |     expect(await before!.evaluate((n) => n.isConnected)).toBe(true);
  151 |   } finally {
  152 |     host.close();
  153 |     await context.close();
  154 |   }
  155 | });
  156 |
  157 | test("step 3 host toggles once and guests cannot navigate, edit or leave following", async ({
  158 |   page,
  159 |   browser,
  160 | }, info) => {
  161 |   const id = await scopeFixture(page, `${info.project.name}-host-toggle`),
  162 |     name = `${info.project.name}-locked-guest`;
  163 |   expect(
  164 |     (
  165 |       await page.request.post(`/api/decks/${id}/recipients`, {
  166 |         headers: { Origin: scopeOrigin },
  167 |         data: {
  168 |           recipients: [
  169 |             {
  170 |               email: `${name}@example.test`,
  171 |               access: {
  172 |                 mode: "all",
  173 |                 comment: true,
  174 |                 rows: [],
  175 |                 columns: [],
  176 |                 slides: [],
  177 |               },
  178 |             },
  179 |           ],
  180 |         },
  181 |       })
  182 |     ).status(),
  183 |   ).toBe(200);
  184 |   const context = await browser.newContext({ baseURL: scopeOrigin }),
  185 |     guest = await context.newPage();
  186 |   try {
  187 |     await scopeLogin(guest, name);
  188 |     await guest.goto(`/?room=${id}`);
  189 |     await expect(guest.locator(".cloud-presence")).toContainText(
  190 |       "クラウドに保存済み",
  191 |     );
  192 |     await guest.locator(".thumbnail").first().click();
  193 |     await expect(guest.locator(".workspace-flight")).toHaveCount(0);
  194 |     const original = await guest
  195 |       .locator(".editor-workspace .slide-canvas")
  196 |       .elementHandle();
  197 |     const toggle = page.getByRole("button", {
  198 |       name: "全員の画面を同期",
  199 |       exact: true,
  200 |     });
  201 |     await toggle.click();
  202 |     await expect(toggle).toHaveAttribute("aria-pressed", "true");
  203 |     await expect(
  204 |       guest.getByLabel("ホストの全体マップ", { exact: true }),
  205 |     ).toBeVisible();
  206 |     await expect(
  207 |       guest.getByRole("button", { name: "全員の画面を同期", exact: true }),
  208 |     ).toHaveCount(0);
  209 |     await page.locator(".thumbnail").nth(4).click();
  210 |     await expect(guest.locator(".host-follow-page")).toHaveAttribute(
  211 |       "data-follow-page",
  212 |       "p11",
  213 |     );
  214 |     await guest.keyboard.press("Escape");
  215 |     await guest.keyboard.press("ArrowRight");
  216 |     await guest.keyboard.press("Control+z");
  217 |     await guest.keyboard.type("変更しない");
  218 |     await expect(guest.locator(".host-follow-page")).toHaveAttribute(
  219 |       "data-follow-page",
  220 |       "p11",
  221 |     );
  222 |     await page
  223 |       .getByRole("button", { name: "全体マップへ", exact: true })
  224 |       .click();
  225 |     await expect(
  226 |       guest.getByLabel("ホストの全体マップ", { exact: true }),
  227 |     ).toBeVisible();
  228 |     await expect(page.locator(".workspace-flight")).toHaveCount(0);
  229 |     await page.screenshot({ path: info.outputPath("host-map.png") });
  230 |     await guest.screenshot({ path: info.outputPath("guest-follow-map.png") });
  231 |     const observer = await controller(page, id);
  232 |     try {
  233 |       const revision = observer.current().revision;
  234 |       await expect
  235 |         .poll(() => observer.current()?.revision, { timeout: 20000 })
> 236 |         .toBeGreaterThan(revision);
      |          ^ Error: expect(received).toBeGreaterThan(expected)
  237 |       await expect(guest.locator(".host-follow-overlay")).toHaveCount(1);
  238 |     } finally {
  239 |       observer.close();
  240 |     }
  241 |     await toggle.click();
  242 |     await expect(guest.locator(".host-follow-overlay")).toHaveCount(0);
  243 |     expect(await original!.evaluate((n) => n.isConnected)).toBe(true);
  244 |     await expect(guest.locator(".canvas-page-position")).toContainText("1.1");
  245 |   } finally {
  246 |     await context.close();
  247 |   }
  248 | });
  249 |
  250 | test("step 4 preserves the live text editor, selected text and caret across interruption", async ({
  251 |   page,
  252 |   browser,
  253 | }, info) => {
  254 |   const id = await scopeFixture(page, `${info.project.name}-editing-host`),
  255 |     name = `${info.project.name}-editing-guest`;
  256 |   expect(
  257 |     (
  258 |       await page.request.post(`/api/decks/${id}/recipients`, {
  259 |         headers: { Origin: scopeOrigin },
  260 |         data: {
  261 |           recipients: [
  262 |             {
  263 |               email: `${name}@example.test`,
  264 |               access: {
  265 |                 mode: "all",
  266 |                 comment: true,
  267 |                 rows: [],
  268 |                 columns: [],
  269 |                 slides: [],
  270 |               },
  271 |             },
  272 |           ],
  273 |         },
  274 |       })
  275 |     ).status(),
  276 |   ).toBe(200);
  277 |   const context = await browser.newContext({ baseURL: scopeOrigin }),
  278 |     guest = await context.newPage();
  279 |   try {
  280 |     await scopeLogin(guest, name);
  281 |     await guest.goto(`/?room=${id}`);
  282 |     await expect(guest.locator(".cloud-presence")).toContainText(
  283 |       "クラウドに保存済み",
  284 |     );
  285 |     await guest.locator(".thumbnail").first().click();
  286 |     await expect(guest.locator(".workspace-flight")).toHaveCount(0);
  287 |     await guest.locator(".editor-workspace .element").first().click();
  288 |     const input = guest.locator(".editor-workspace .ql-editor");
  289 |     await input.fill("編集中の内容を保持します");
  290 |     await input.evaluate((n) => {
  291 |       (n as HTMLElement).focus();
  292 |       const t = n.querySelector("p")!.firstChild!,
  293 |         r = document.createRange();
  294 |       r.setStart(t, 2);
  295 |       r.setEnd(t, 5);
  296 |       const s = window.getSelection()!;
  297 |       s.removeAllRanges();
  298 |       s.addRange(r);
  299 |     });
  300 |     await expect
  301 |       .poll(() => input.evaluate(() => window.getSelection()?.toString()))
  302 |       .not.toBe("");
  303 |     const before = await input.evaluate(() =>
  304 |         window.getSelection()!.toString(),
  305 |       ),
  306 |       editor = await input.elementHandle();
  307 |     await guest.evaluate(() => {
  308 |       const v = { notice: 0, page: 0 };
  309 |       (window as any).__followTiming = v;
  310 |       new MutationObserver(() => {
  311 |         if (document.querySelector(".host-follow-notice") && !v.notice)
  312 |           v.notice = performance.now();
  313 |         if (document.querySelector(".host-follow-page") && !v.page)
  314 |           v.page = performance.now();
  315 |       }).observe(document.body, { subtree: true, childList: true });
  316 |     });
  317 |     await page.locator(".thumbnail").nth(4).click();
  318 |     const toggle = page.getByRole("button", {
  319 |       name: "全員の画面を同期",
  320 |       exact: true,
  321 |     });
  322 |     await toggle.click();
  323 |     await expect(guest.locator(".host-follow-page")).toHaveAttribute(
  324 |       "data-follow-page",
  325 |       "p11",
  326 |     );
  327 |     await expect(
  328 |       guest.getByText(
  329 |         "ホストが集合をかけました。編集中の内容はそのまま保持されています。",
  330 |         { exact: true },
  331 |       ),
  332 |     ).toBeVisible();
  333 |     expect(await editor!.evaluate((n) => n.isConnected)).toBe(true);
  334 |     await expect(input).toHaveText("編集中の内容を保持します");
  335 |     await guest.keyboard.type("変更されない");
  336 |     await expect(input).toHaveText("編集中の内容を保持します");
```
