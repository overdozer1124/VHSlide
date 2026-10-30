# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collaboration.spec.ts >> two users sign in, join by invitation, edit the same text, reconnect, and export photos
- Location: tests/cloud/collaboration.spec.ts:177:1

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 810
Received:    825
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - link "VHSlide 全体マップ" [ref=e5] [cursor=pointer]:
        - /url: "#"
        - text: VH
        - generic: Slide
      - generic [ref=e12]:
        - textbox "作品のタイトル" [ref=e13]: わたしたちのまちの、いいところ
        - generic [ref=e14]:
          - status "クラウドに保存済み · 本文と付箋の保存状態です。端末へ書き出すJSONには付箋・共有設定・過去の版は含みません。" [ref=e15]:
            - generic [ref=e18]: クラウドに保存済み
          - generic [ref=e19]: ホスト
          - generic [ref=e20]: 1人が参加中
      - generic [ref=e21]:
        - generic [ref=e22]:
          - button "ファイル" [ref=e24] [cursor=pointer]
          - button "ファイルに保存" [ref=e30] [cursor=pointer]:
            - generic [ref=e34]: 保存
        - button "クラウド" [ref=e35] [cursor=pointer]
        - button "全員の画面を同期" [ref=e40] [cursor=pointer]: 全員を集合
        - button "ゲストの設定" [ref=e42] [cursor=pointer]
        - generic [ref=e45]:
          - button "この2ページを発表" [ref=e46] [cursor=pointer]
          - button "発表方法を選ぶ" [ref=e52] [cursor=pointer]
    - main [ref=e55]:
      - generic [ref=e56]:
        - button "全体マップへ" [ref=e57] [cursor=pointer]
        - button "文字" [ref=e60] [cursor=pointer]
        - button "画像" [ref=e63] [cursor=pointer]
        - button "手描き" [ref=e68] [cursor=pointer]
        - button "付箋を追加" [ref=e72] [cursor=pointer]: 付箋
        - button "表を追加" [ref=e77] [cursor=pointer]: 表
        - button "図形を追加" [ref=e80] [cursor=pointer]: 図形
        - button "線を追加" [ref=e85] [cursor=pointer]: 線
        - button "もっと見る（図解・グラフ）" [ref=e89] [cursor=pointer]: もっと見る
        - button "まとめて選択" [ref=e92] [cursor=pointer]:
          - generic [aria-hidden] [ref=e93]: ▧
          - text: まとめて選択
        - button "スピーカーノート" [ref=e94] [cursor=pointer]: ノート
        - group "編集画面の表示" [ref=e98]:
          - button "表示の設定" [ref=e99] [cursor=pointer]: 表示
        - button "編集画面にもフィルタを適用" [pressed] [ref=e103] [cursor=pointer]
        - generic [ref=e106]:
          - button "もとに戻す" [ref=e107] [cursor=pointer]
          - button "やり直す" [disabled] [ref=e111]
          - button "その他" [ref=e117] [cursor=pointer]
      - generic [ref=e123]:
        - complementary "縦横のページ一覧" [ref=e124]:
          - generic [ref=e125]:
            - generic [ref=e126]:
              - strong [ref=e127]: ページ一覧
              - button "サムネイルバーをたたむ" [expanded] [ref=e128] [cursor=pointer]
            - button "行番号一覧" [ref=e132] [cursor=pointer]
          - generic [ref=e135]:
            - generic [ref=e136]:
              - button "1段目の横のページをひらく" [ref=e137] [cursor=pointer]:
                - generic [ref=e138]: "1.2"
                - generic [ref=e141]:
                  - generic:
                    - generic: 01 / NATURE
                    - generic: 自然がいっぱい。
                    - generic: 緑の道を、歩いてみよう。
                    - generic: フィルタ内の共同編集
              - textbox "1.2のフッター" [ref=e142]: touch-owner-friend
              - button "1段目のメニュー" [ref=e143] [cursor=pointer]
            - generic [ref=e148]:
              - button "2段目の横のページをひらく" [ref=e149] [cursor=pointer]:
                - generic [ref=e150]: "2.2"
                - generic [ref=e153]:
                  - generic:
                    - generic: ちいさな発見 02
                    - generic: お気に入りの公園
                    - generic: 季節が変わると、 どんな発見があるかな？
              - textbox "2.2のフッター" [ref=e154]: touch-owner-friend
              - button "2段目のメニュー" [ref=e155] [cursor=pointer]
          - generic [ref=e160]: フィルタしたページを表示中
          - separator "サムネイルバーの幅" [ref=e161]
        - status [ref=e162]
        - generic [ref=e163]:
          - generic [ref=e164]:
            - generic "シート1・絞り込み・2ページ" [ref=e165]:
              - generic [ref=e166]: シート1・絞り込み
              - generic [ref=e167]: 2ページ
            - textbox "ページの名前" [ref=e168]: 自然がいっぱい
            - group "このスライドの共有者" [ref=e169]:
              - generic [ref=e175]: 共有：touch-owner-friend
            - generic [ref=e176]: 1.2 / 16:9
          - generic "編集中のスライド" [ref=e177]:
            - generic [ref=e178]:
              - generic [ref=e180]:
                - generic "テキストボックス" [ref=e181]: 01 / NATURE
                - generic "テキストボックス" [ref=e189]: 自然がいっぱい。
                - generic "テキストボックス" [ref=e197]: 緑の道を、歩いてみよう。
                - generic "テキストボックス" [ref=e205]:
                  - generic [ref=e206]: フィルタ内の共同編集
                  - button "要素の上の枠でサイズを変更" [ref=e210]
                  - button "要素の右上の枠でサイズを変更" [ref=e211]
                  - button "要素の右の枠でサイズを変更" [ref=e212]
                  - button "要素のサイズを変更" [ref=e213]
                  - button "要素の下の枠でサイズを変更" [ref=e214]
                  - button "要素の左下の枠でサイズを変更" [ref=e215]
                  - button "要素の左の枠でサイズを変更" [ref=e216]
                  - button "要素の左上の枠でサイズを変更" [ref=e217]
              - generic "このスライドの付箋"
          - generic [ref=e218]: 文字はタップで入力 · 選択枠の辺・四隅でサイズ変更 · Alt＋枠で移動
        - complementary [ref=e220]:
          - generic [ref=e221]:
            - generic [ref=e222]:
              - generic [ref=e223]: 選択中
              - heading "文字" [level=2] [ref=e224]
            - button "右のサイドバーをたたむ" [expanded] [ref=e225] [cursor=pointer]
          - generic [ref=e229]:
            - button "複製" [ref=e230] [cursor=pointer]
            - button "選んだものを削除" [ref=e234] [cursor=pointer]: 削除
          - tablist "編集設定" [ref=e238]:
            - tab "見た目" [selected] [ref=e239] [cursor=pointer]
            - tab "配置" [ref=e244] [cursor=pointer]
            - tab "リンク" [ref=e250] [cursor=pointer]
          - group [ref=e255]:
            - tabpanel "見た目" [ref=e256]:
              - group [ref=e257]:
                - generic "ボックス全体の基本書式" [ref=e258] [cursor=pointer]
                - paragraph [ref=e259]: 文字の内容はキャンバス内で直接入力できます。文字の枠をクリックして編集します。
                - generic [ref=e260]:
                  - text: 文字の大きさ
                  - spinbutton "文字の大きさ" [ref=e261]: "40"
                - generic [ref=e262]:
                  - text: 文字の方向
                  - combobox "文字の方向" [ref=e263]:
                    - option "横書き" [selected]
                    - option "縦書き"
                - generic [ref=e264]:
                  - button "B 太字" [ref=e265] [cursor=pointer]
                  - button "☷ 箇条書き" [ref=e266] [cursor=pointer]
                - generic [ref=e267]:
                  - group "文字の左右の位置" [ref=e268]:
                    - text: 左右の位置
                    - generic [ref=e269]:
                      - button "文字を左揃え" [pressed] [ref=e270] [cursor=pointer]:
                        - generic [ref=e272]: 左揃え
                      - button "文字を中央揃え" [ref=e273] [cursor=pointer]:
                        - generic [ref=e275]: 中央揃え
                      - button "文字を右揃え" [ref=e276] [cursor=pointer]:
                        - generic [ref=e278]: 右揃え
                  - group "文字の上下の位置" [ref=e279]:
                    - text: 上下の位置
                    - generic [ref=e280]:
                      - button "文字を上揃え" [pressed] [ref=e281] [cursor=pointer]:
                        - generic [ref=e285]: 上揃え
                      - button "文字を上下中央揃え" [ref=e286] [cursor=pointer]:
                        - generic [ref=e290]: 中央揃え
                      - button "文字を下揃え" [ref=e291] [cursor=pointer]:
                        - generic [ref=e295]: 下揃え
                - generic [ref=e296]:
                  - text: 文字の色
                  - textbox "文字の色" [ref=e297] [cursor=pointer]: "#173d38"
                - generic [ref=e298]:
                  - text: ハイライト
                  - textbox "ハイライトの色" [ref=e299] [cursor=pointer]: "#ffffff"
    - generic "シート一覧" [ref=e300]:
      - tablist "作品のシート" [ref=e301]:
        - tab "シート2" [ref=e303] [cursor=pointer]
        - tab "シート1" [selected] [ref=e305] [cursor=pointer]
      - button "空のシートを追加" [ref=e306] [cursor=pointer]
      - button "シートの操作" [ref=e308] [cursor=pointer]
    - status [ref=e313]
    - status [ref=e314]:
      - text: JSONファイルを作成しました。ダウンロード先を確認してください。付箋・共有設定・過去の版は含みません。
      - button "通知を閉じる" [ref=e315] [cursor=pointer]
  - dialog "クラウドの作品" [ref=e320]:
    - banner [ref=e321]:
      - generic [ref=e322]:
        - heading "クラウドの作品" [level=2] [ref=e323]
        - paragraph [ref=e326]: 作品を開く・共有する・編集できる範囲を決める
      - generic [ref=e327]:
        - generic [ref=e328]:
          - generic [ref=e329]: t
          - generic [ref=e330]:
            - text: touch-owner
            - generic [ref=e331]: touch-owner@example.test
        - button "サインアウト" [ref=e332] [cursor=pointer]
      - button "クラウドの作品を閉じる" [active] [ref=e337] [cursor=pointer]
    - generic [ref=e341]:
      - generic [ref=e342]:
        - generic [ref=e343]: 開いている作品
        - strong [ref=e344]: わたしたちのまちの、いいところ
      - generic [ref=e345]: ホスト
    - tablist "クラウド画面の切り替え" [ref=e349]:
      - tab "作品一覧 1" [ref=e350] [cursor=pointer]:
        - text: 作品一覧
        - generic [ref=e353]: "1"
      - tab "共有管理" [selected] [ref=e354] [cursor=pointer]
    - tabpanel "共有管理" [ref=e361]:
      - generic [ref=e362]:
        - generic [ref=e363]:
          - region "参加待ちのアカウント" [ref=e364]:
            - generic [ref=e365]:
              - heading "参加待ち 0人" [level=3] [ref=e366]:
                - text: 参加待ち
                - generic [ref=e367]: 0人
              - button "参加待ちを更新" [ref=e368] [cursor=pointer]
            - paragraph [ref=e369]: 氏名とメールアドレスを確認してください。承認するまで作品は見えません。承認後は作品全体の閲覧・保存と付箋コメントが可能になり、編集権限は下の共有一覧で設定します。
            - paragraph [ref=e370]: 参加待ちのアカウントはありません。
          - group "共有アカウントの管理" [ref=e371]:
            - generic [ref=e373]:
              - heading "共有アカウント 1人" [level=3] [ref=e374]:
                - text: 共有アカウント
                - generic [ref=e380]: 1人
              - paragraph [ref=e381]: 名前・参加状況・編集できる範囲をまとめて確認できます。
            - region "アカウントの事前共有" [ref=e382]:
              - button "共有するアカウントを追加" [ref=e383] [cursor=pointer]
            - generic [ref=e384]:
              - textbox "共有アカウントを検索" [ref=e389]:
                - /placeholder: 名前・メールアドレスで検索
              - button "参加者一覧を更新" [ref=e390] [cursor=pointer]
            - generic [ref=e391]:
              - generic [ref=e392]:
                - checkbox "表示中のアカウントをすべて選択" [ref=e393] [cursor=pointer]
                - text: すべて選択
              - generic [ref=e394]: 0人を選択中
              - button "一括で権限を設定" [disabled] [ref=e395]
              - button "選択した共有を解除" [disabled] [ref=e399]
            - status
            - list "共有されているアカウント" [ref=e403]:
              - listitem [ref=e404]:
                - checkbox "touch-owner-friend@example.testを選択" [ref=e406] [cursor=pointer]
                - generic [ref=e407]:
                  - strong [ref=e408]: touch-owner-friend
                  - generic [ref=e409]: touch-owner-friend@example.test
                  - generic [ref=e410]: 参加済み
                - generic [ref=e411]:
                  - strong [ref=e412]: すべてのスライドを編集
                  - generic [ref=e413]: 6ページ
                  - generic [ref=e414]: 付箋コメント可
                - generic [ref=e415]:
                  - button "touch-owner-friendの編集権限を設定" [ref=e416] [cursor=pointer]: 権限を変更
                  - button "touch-owner-friendの参加を解除" [ref=e417] [cursor=pointer]
        - complementary "共有リンク" [ref=e421]:
          - heading "リンクを共有" [level=3] [ref=e422]
          - paragraph [ref=e426]: 登録したアカウントには、この作品のリンクを伝えてください。
          - generic [ref=e427]:
            - text: 作品リンク
            - textbox "事前共有した作品のリンク" [ref=e428]: http://127.0.0.1:3187/?room=722c78a4-35d8-4aa2-b687-af2a72787a3e
          - button "作品リンクをコピー" [ref=e429] [cursor=pointer]
          - status
          - generic [ref=e433]:
            - heading "招待リンクから参加" [level=4] [ref=e434]
            - paragraph [ref=e435]: リンクを開いた相手は参加待ちになります。氏名・メールアドレスを確認してホストが承認した後に、閲覧・付箋コメントが可能になります。
            - button "共同編集の招待リンクを作る" [ref=e436] [cursor=pointer]
            - status
            - button "招待リンクを無効にする" [ref=e437] [cursor=pointer]
            - generic [ref=e438]: 作り直すと、以前の招待リンクは使えなくなります。
    - contentinfo [ref=e439]:
      - group [ref=e440]:
        - generic "保存容量とご利用について" [ref=e441] [cursor=pointer]
      - button "端末の作品へ戻る" [ref=e442] [cursor=pointer]
      - generic [ref=e443]: JSONで端末にも保存できます
```

# Test source

```ts
  340 |     await expect(
  341 |       other
  342 |         .locator(".editor-workspace .element")
  343 |         .first()
  344 |         .locator(".text-layout"),
  345 |     ).toHaveAttribute("data-vertical-align", "bottom");
  346 |     await expect(other.locator(".editor-workspace")).toContainText("offline");
  347 |     await expect(
  348 |       other.locator(".editor-workspace img.slide-image"),
  349 |     ).toHaveCount(1);
  350 |     // The selected sheet is personal, while its content and tab order are shared.
  351 |     await page
  352 |       .getByRole("button", { name: "空のシートを追加", exact: true })
  353 |       .click();
  354 |     await expect(other.getByRole("tab")).toHaveCount(2);
  355 |     await expect(
  356 |       other.getByRole("tab", { name: "シート1", exact: true }),
  357 |     ).toHaveAttribute("aria-selected", "true");
  358 |     await page.getByRole("button", { name: "文字", exact: true }).click();
  359 |     const sheetText = page.getByRole("textbox", {
  360 |       name: "スライド内の文字",
  361 |       exact: true,
  362 |     });
  363 |     await sheetText.fill("別シートの共同編集");
  364 |     await sheetText.press("Escape");
  365 |     await other.getByRole("tab", { name: "シート2", exact: true }).click();
  366 |     await expect(other.locator(".editor-workspace")).toContainText(
  367 |       "別シートの共同編集",
  368 |     );
  369 |     await other.getByRole("tab", { name: "シート1", exact: true }).click();
  370 |     await expect(other.locator(".editor-workspace")).toContainText("offline");
  371 |     await page
  372 |       .getByRole("button", { name: "シートの操作", exact: true })
  373 |       .click();
  374 |     await page
  375 |       .getByRole("button", { name: "シートを左へ移動", exact: true })
  376 |       .click();
  377 |     await page.getByRole("button", { name: "閉じる", exact: true }).click();
  378 |     await expect
  379 |       .poll(() => other.getByRole("tab").allTextContents())
  380 |       .toEqual(["シート2", "シート1"]);
  381 |     await other.reload();
  382 |     await saved(other);
  383 |     await expect(
  384 |       other.getByRole("tab", { name: "シート1", exact: true }),
  385 |     ).toHaveAttribute("aria-selected", "true");
  386 |     // Filtering is personal and must never trim the shared document or export.
  387 |     await page.getByRole("tab", { name: "シート1", exact: true }).click();
  388 |     await page
  389 |       .getByRole("button", { name: "全体マップへ", exact: true })
  390 |       .click();
  391 |     await page
  392 |       .getByRole("button", { name: "マップをフィルタ", exact: true })
  393 |       .click();
  394 |     await page
  395 |       .getByRole("button", { name: "フィルタする列2", exact: true })
  396 |       .click();
  397 |     await page
  398 |       .getByRole("button", { name: "フィルタを適用", exact: true })
  399 |       .click();
  400 |     await expect(page.locator(".slide-card")).toHaveCount(2);
  401 |     await expect(other.locator(".slide-card")).toHaveCount(5);
  402 |     await page
  403 |       .getByRole("button", { name: "自然がいっぱいを編集", exact: true })
  404 |       .click();
  405 |     await page
  406 |       .getByRole("button", { name: "1段目の横のページをひらく", exact: true })
  407 |       .click();
  408 |     await expect(page.locator(".row-page")).toHaveCount(1);
  409 |     await page
  410 |       .getByRole("button", { name: "1.2 自然がいっぱいを編集", exact: true })
  411 |       .click();
  412 |     await page.getByRole("button", { name: "文字", exact: true }).click();
  413 |     const filteredInput = page.getByRole("textbox", {
  414 |       name: "スライド内の文字",
  415 |       exact: true,
  416 |     });
  417 |     await filteredInput.fill("フィルタ内の共同編集");
  418 |     await filteredInput.press("Escape");
  419 |     await other
  420 |       .getByRole("button", { name: "自然がいっぱいを編集", exact: true })
  421 |       .click();
  422 |     await expect(other.locator(".editor-workspace")).toContainText(
  423 |       "フィルタ内の共同編集",
  424 |     );
  425 |     const fullDownload = page.waitForEvent("download");
  426 |     await page
  427 |       .getByRole("button", { name: "ファイルに保存", exact: true })
  428 |       .click();
  429 |     const fullFile = await fullDownload,
  430 |       fullExport = JSON.parse(await readFile((await fullFile.path())!, "utf8"));
  431 |     expect(fullExport.slides).toHaveLength(6);
  432 |     expect(fullExport.sheets).toHaveLength(2);
  433 |     await page.getByRole("button", { name: "クラウド", exact: true }).click();
  434 |     await expect(
  435 |       page.getByRole("button", {
  436 |         name: `${name}-friendの参加を解除`,
  437 |         exact: true,
  438 |       }),
  439 |     ).toBeVisible();
> 440 |     expect(await page.evaluate(() => innerWidth)).toBeLessThanOrEqual(
      |                                                   ^ Error: expect(received).toBeLessThanOrEqual(expected)
  441 |       page.viewportSize()!.width,
  442 |     );
  443 |     await page
  444 |       .getByRole("button", { name: `${name}-friendの参加を解除`, exact: true })
  445 |       .click();
  446 |     await viewingRevoked(other);
  447 |     await page.screenshot({ path: info.outputPath("cloud-sharing.png") });
  448 |   } finally {
  449 |     await context.close();
  450 |   }
  451 | });
  452 |
  453 | test("host selects editing scopes visually, guests stay read-only elsewhere and exchange persistent sticky comments", async ({
  454 |   page,
  455 |   browser,
  456 | }, info) => {
  457 |   test.setTimeout(90000);
  458 |   const owner = `permissions-${info.project.name}`,
  459 |     guest = `${owner}-guest`;
  460 |   const button = (p: Page, name: string) =>
  461 |     p.getByRole("button", { name, exact: true });
  462 |   await signIn(page, owner);
  463 |   await button(page, "この作品をクラウドに保存").click();
  464 |   await saved(page);
  465 |   await page.getByRole("button", { name: "クラウド", exact: true }).click();
  466 |   await button(page, "共同編集の招待リンクを作る").click();
  467 |   const invite = await page
  468 |     .getByRole("textbox", { name: "共同編集の招待リンク", exact: true })
  469 |     .inputValue();
  470 |   const context = await browser.newContext({
  471 |     baseURL: "http://127.0.0.1:3187",
  472 |     viewport: { width: 1440, height: 1000 },
  473 |   });
  474 |   const other = await context.newPage();
  475 |   try {
  476 |     await signIn(other, guest, invite, page);
  477 |     await saved(other);
  478 |     await openEditor(other);
  479 |     await expect(
  480 |       other.getByRole("textbox", { name: "ページの名前", exact: true }),
  481 |     ).toHaveAttribute("readonly", "");
  482 |     await expect(button(other, "文字")).toBeDisabled();
  483 |     await expect(button(other, "空のシートを追加")).toBeDisabled();
  484 |     await button(other, "付箋を追加").click();
  485 |     const sticky = other.getByRole("textbox", {
  486 |       name: "付箋のコメント",
  487 |       exact: true,
  488 |     });
  489 |     await expect(sticky).toBeFocused();
  490 |     await sticky.fill("ここをもっと説明してほしいです");
  491 |     await expect(other.locator(".sticky-note")).toContainText("保存済み");
  492 |     await button(other, "付箋の色とサイズ").click();
  493 |     await button(other, "ピンクの付箋").click();
  494 |     await button(other, "付箋のサイズ：大").click();
  495 |     await expect(other.locator(".sticky-note")).toHaveCSS(
  496 |       "background-color",
  497 |       "rgb(255, 217, 227)",
  498 |     );
  499 |     await expect(other.locator(".sticky-note")).toContainText("保存済み");
  500 |
  501 |     await expect(
  502 |       other.getByRole("button", { name: "付箋を投稿", exact: true }),
  503 |     ).toHaveCount(0);
  504 |     await button(page, "参加者一覧を更新").click();
  505 |     await button(page, `${guest}の編集権限を設定`).click();
  506 |     await page
  507 |       .getByRole("combobox", { name: "編集の権限", exact: true })
  508 |       .selectOption("scoped");
  509 |     await button(page, "編集を許可する行2").click();
  510 |     await button(page, "編集を許可する列3").click();
  511 |     await button(page, "編集を許可するスライド1.1 わたしたちのまち").click();
  512 |     await page.screenshot({ path: info.outputPath("permissions.png") });
  513 |     await button(page, "権限を保存").click();
  514 |     await expect(button(other, "文字")).toBeEnabled();
  515 |     await button(page, "クラウドの作品を閉じる").click();
  516 |     await openEditor(page);
  517 |     await expect(page.locator(".sticky-note textarea")).toHaveValue(
  518 |       "ここをもっと説明してほしいです",
  519 |     );
  520 |     await expect(page.locator(".sticky-note")).toHaveCSS(
  521 |       "background-color",
  522 |       "rgb(255, 217, 227)",
  523 |     );
  524 |     await page.screenshot({ path: info.outputPath("comments.png") });
  525 |     await other.locator(".editor-workspace .element").first().click();
  526 |     const text = other.getByRole("textbox", {
  527 |       name: "スライド内の文字",
  528 |       exact: true,
  529 |     });
  530 |     await expect(text).toBeFocused();
  531 |     await text.press("Home");
  532 |     await other.keyboard.type("guest edit ");
  533 |     await saved(other);
  534 |     await expect(page.locator(".editor-workspace")).toContainText("guest edit");
  535 |     await other.keyboard.press("Escape");
  536 |     await button(other, "1段目の横のページをひらく").click();
  537 |     await button(other, "1.2 自然がいっぱいを編集").click();
  538 |     await expect(button(other, "文字")).toBeDisabled();
  539 |     await expect(
  540 |       other.getByRole("textbox", { name: "ページの名前", exact: true }),
```
