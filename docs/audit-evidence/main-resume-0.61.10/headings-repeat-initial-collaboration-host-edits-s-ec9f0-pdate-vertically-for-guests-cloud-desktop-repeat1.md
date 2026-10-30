# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: collaboration.spec.ts >> host edits shared map headings and row account names update vertically for guests
- Location: tests/cloud/collaboration.spec.ts:825:1

# Error details

```
Error: locator.click: Error: strict mode violation: getByRole('button', { name: '作品を開く：わたしたちのまちの、いいところ', exact: true }) resolved to 2 elements:
    1) <button class="cloud-deck-open" aria-label="作品を開く：わたしたちのまちの、いいところ">…</button> aka getByRole('button', { name: '作品を開く：わたしたちのまちの、いいところ' }).first()
    2) <button class="cloud-deck-open" aria-label="作品を開く：わたしたちのまちの、いいところ">…</button> aka getByRole('button', { name: '作品を開く：わたしたちのまちの、いいところ' }).nth(1)

Call log:
  - waiting for getByRole('button', { name: '作品を開く：わたしたちのまちの、いいところ', exact: true })

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
      - textbox "作品のタイトル" [ref=e15]: わたしたちのまちの、いいところ
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
      - button "全員の画面を同期" [ref=e44] [cursor=pointer]: 全員を集合
      - button "ゲストの設定" [ref=e46] [cursor=pointer]
      - generic [ref=e49]:
        - button "発表する" [ref=e50] [cursor=pointer]
        - button "発表方法を選ぶ" [ref=e56] [cursor=pointer]
  - navigation [ref=e59]:
    - generic [ref=e60]:
      - button "全体マップ" [ref=e61] [cursor=pointer]
      - button "ページを編集" [ref=e67] [cursor=pointer]
    - generic [ref=e70]:
      - button "もとに戻す" [ref=e71] [cursor=pointer]
      - button "やり直す" [disabled] [ref=e75]
      - button "その他" [ref=e81] [cursor=pointer]
  - main [ref=e87]:
    - region "ページの全体マップ" [ref=e88]:
      - generic [ref=e89]:
        - generic [ref=e90]:
          - heading "全体マップ" [level=1] [ref=e91]
          - generic "シート1・全体・5ページ" [ref=e98]:
            - generic [ref=e99]: シート1・全体
            - generic [ref=e100]: 5ページ
        - button "マップをフィルタ" [ref=e101] [cursor=pointer]: フィルタ
        - button "スライドを複数選択" [ref=e104] [cursor=pointer]: 選択
        - button "行・列を一括操作" [ref=e107] [cursor=pointer]
        - generic [ref=e108]:
          - textbox "ページ番号で探す" [ref=e109]:
            - /placeholder: "3.2"
          - button "番号のページを探す" [ref=e110] [cursor=pointer]
        - group "マップの表示サイズ" [ref=e114]:
          - button "マップを縮小" [ref=e115] [cursor=pointer]
          - button "表示サイズを100%に戻す" [ref=e119] [cursor=pointer]: 100%
          - button "マップを拡大" [disabled] [ref=e120]
        - button "マップの表示設定" [ref=e124] [cursor=pointer]: 表示
      - region "スライドのマップ" [ref=e126]:
        - generic [ref=e127]:
          - generic [ref=e129]: 次の話題へ
          - generic [aria-hidden] [ref=e134]: 行 / 列
          - generic [ref=e135]:
            - generic [ref=e136]: "01"
            - textbox "列1の見出し" [ref=e137]:
              - /placeholder: 列の名前
              - text: はじまり
            - button "話題1を移動" [ref=e138] [cursor=pointer]
          - generic [ref=e146]:
            - generic [ref=e147]: "02"
            - textbox "列2の見出し" [ref=e148]:
              - /placeholder: 列の名前
              - text: 共同調査
            - button "話題2を移動" [ref=e149] [cursor=pointer]
          - generic [ref=e157]:
            - generic [ref=e158]: "03"
            - textbox "列3の見出し" [ref=e159]:
              - /placeholder: 列の名前
              - text: 話題 3
            - button "話題3を移動" [ref=e160] [cursor=pointer]
          - generic [ref=e168]:
            - generic "headings-cloud-desktop-guest" [ref=e169]:
              - button "高さ1のページをまとめて移動" [ref=e170] [cursor=pointer]: "01"
              - textbox "行1の見出し" [ref=e171]:
                - /placeholder: 見出し
                - text: headings-cloud-desktop-guest
            - generic [ref=e172]:
              - generic [ref=e173]:
                - button "わたしたちのまちを編集" [ref=e174] [cursor=pointer]:
                  - generic [ref=e175]:
                    - generic:
                      - generic: OUR TOWN
                      - generic: わたしたちのまちの、 いいところ。
                      - generic: いつもの景色に、新しい発見。
                  - generic [ref=e176]: 発表の先頭
                - generic [ref=e177]:
                  - generic [ref=e178]: "1.1"
                  - textbox "1.1のフッター" [ref=e179]: headings-cloud-desktop-guest
                  - button "わたしたちのまちのページメニュー" [ref=e180] [cursor=pointer]
                  - button "わたしたちのまちを移動" [ref=e185] [cursor=pointer]
                  - button "わたしたちのまちを削除" [ref=e193] [cursor=pointer]
              - button "わたしたちのまちの右に次の話題を追加" [ref=e197] [cursor=pointer]
              - button "わたしたちのまちの下に詳しいページを追加" [ref=e199] [cursor=pointer]
            - generic [ref=e201]:
              - generic [ref=e202]:
                - button "自然がいっぱいを編集" [ref=e203] [cursor=pointer]:
                  - generic [ref=e204]:
                    - generic:
                      - generic: 01 / NATURE
                      - generic: 自然がいっぱい。
                      - generic: 緑の道を、歩いてみよう。
                - generic [ref=e205]:
                  - generic [ref=e206]: "1.2"
                  - textbox "1.2のフッター" [ref=e207]: headings-cloud-desktop-guest
                  - button "自然がいっぱいのページメニュー" [ref=e208] [cursor=pointer]
                  - button "自然がいっぱいを移動" [ref=e213] [cursor=pointer]
                  - button "自然がいっぱいを削除" [ref=e221] [cursor=pointer]
              - button "自然がいっぱいの右に次の話題を追加" [ref=e225] [cursor=pointer]
              - button "自然がいっぱいの下に詳しいページを追加" [ref=e227] [cursor=pointer]
            - generic [ref=e229]:
              - generic [ref=e230]:
                - button "人とつながるを編集" [ref=e231] [cursor=pointer]:
                  - generic [ref=e232]:
                    - generic:
                      - generic: 02 / PEOPLE
                      - generic: 人と、つながる。
                      - generic: 「こんにちは」から、はじまる。
                - generic [ref=e233]:
                  - generic [ref=e234]: "1.3"
                  - textbox "1.3のフッター" [ref=e235]: headings-cloud-desktop-guest
                  - button "人とつながるのページメニュー" [ref=e236] [cursor=pointer]
                  - button "人とつながるを移動" [ref=e241] [cursor=pointer]
                  - button "人とつながるを削除" [ref=e249] [cursor=pointer]
              - button "人とつながるの右に次の話題を追加" [ref=e253] [cursor=pointer]
              - button "人とつながるの下に詳しいページを追加" [ref=e255] [cursor=pointer]
          - generic [ref=e257]:
            - generic [ref=e258]:
              - button "高さ2のページをまとめて移動" [ref=e259] [cursor=pointer]: "02"
              - textbox "行2の見出し" [ref=e260]:
                - /placeholder: 見出し
            - generic [ref=e261]:
              - generic [ref=e262]:
                - button "まちを歩いてみたらを編集" [ref=e263] [cursor=pointer]:
                  - generic [ref=e264]:
                    - generic:
                      - generic: ちいさな発見 01
                      - generic: まちを歩いてみたら
                      - generic: いつもの通学路にも、 まだ知らないことがある。
                - generic [ref=e265]:
                  - generic [ref=e266]: "2.1"
                  - textbox "2.1のフッター" [ref=e267]: まちを歩いてみたら
                  - button "まちを歩いてみたらのページメニュー" [ref=e268] [cursor=pointer]
                  - button "まちを歩いてみたらを移動" [ref=e273] [cursor=pointer]
                  - button "まちを歩いてみたらを削除" [ref=e281] [cursor=pointer]
              - button "まちを歩いてみたらの右に次の話題を追加" [ref=e285] [cursor=pointer]
              - button "まちを歩いてみたらの下に詳しいページを追加" [ref=e287] [cursor=pointer]
            - generic [ref=e289]:
              - generic [ref=e290]:
                - button "お気に入りの公園を編集" [ref=e291] [cursor=pointer]:
                  - generic [ref=e292]:
                    - generic:
                      - generic: ちいさな発見 02
                      - generic: お気に入りの公園
                      - generic: 季節が変わると、 どんな発見があるかな？
                - generic [ref=e293]:
                  - generic [ref=e294]: "2.2"
                  - textbox "2.2のフッター" [ref=e295]: お気に入りの公園
                  - button "お気に入りの公園のページメニュー" [ref=e296] [cursor=pointer]
                  - button "お気に入りの公園を移動" [ref=e301] [cursor=pointer]
                  - button "お気に入りの公園を削除" [ref=e309] [cursor=pointer]
              - button "お気に入りの公園の右に次の話題を追加" [ref=e313] [cursor=pointer]
              - button "お気に入りの公園の下に詳しいページを追加" [ref=e315] [cursor=pointer]
            - button "2.3にページを追加" [ref=e318] [cursor=pointer]:
              - generic [ref=e320]: ページを追加
      - generic [ref=e321]:
        - generic [ref=e322]:
          - generic [ref=e323]: ↔
          - text: よこは「次の話題」
          - generic [ref=e324]: /
          - generic [ref=e325]: ↕
          - text: たては「くわしい説明」
        - generic [ref=e326]: 長押し・つまみで移動 · ピンチで拡大・縮小
  - generic "シート一覧" [ref=e327]:
    - tablist "作品のシート" [ref=e328]:
      - tab "シート1" [selected] [ref=e330] [cursor=pointer]
    - button "空のシートを追加" [ref=e331] [cursor=pointer]
    - button "シートの操作" [ref=e333] [cursor=pointer]
  - status [ref=e338]
```

# Test source

```ts
  764 |   }
  765 |   await expect
  766 |     .poll(async () => Math.round((await note.boundingBox())!.x))
  767 |     .toBeLessThan(Math.round(before.x - 50));
  768 |   await expect(note).toContainText("保存済み");
  769 |   const moved = (
  770 |     await (await page.request.get(`/api/decks/${room}/comments`)).json()
  771 |   ).comments;
  772 |   await page.screenshot({ path: info.outputPath("direct-sticky-notes.png") });
  773 |   await page.reload();
  774 |   await saved(page);
  775 |   await openEditor(page);
  776 |   await expect(inputs).toHaveCount(2);
  777 |   expect(
  778 |     (await (await page.request.get(`/api/decks/${room}/comments`)).json())
  779 |       .comments,
  780 |   ).toEqual(moved);
  781 |   // Bring an overlapping card to the front by focusing its text, just as
  782 |   // clicking the exposed part of a sticky does.
  783 |   await inputs.first().focus();
  784 |   await page
  785 |     .locator(".sticky-note")
  786 |     .first()
  787 |     .getByRole("button", { name: "付箋を削除", exact: true })
  788 |     .click();
  789 |   await expect(inputs).toHaveCount(1);
  790 | });
  791 |
  792 | test("failed sticky autosaves keep the input and can be retried", async ({
  793 |   page,
  794 | }, info) => {
  795 |   const button = (name: string) =>
  796 |     page.getByRole("button", { name, exact: true });
  797 |   await signIn(page, `sticky-retry-${info.project.name}`);
  798 |   await button("この作品をクラウドに保存").click();
  799 |   await saved(page);
  800 |   await openEditor(page);
  801 |   let fail = true;
  802 |   await page.route("**/comments/*", async (route) => {
  803 |     if (route.request().method() === "PUT" && fail) {
  804 |       fail = false;
  805 |       await route.abort();
  806 |     } else await route.continue();
  807 |   });
  808 |   await button("付箋を追加").click();
  809 |   const input = page.getByRole("textbox", {
  810 |     name: "付箋のコメント",
  811 |     exact: true,
  812 |   });
  813 |   await input.fill("通信が失敗しても入力を残す");
  814 |   await expect(page.locator(".sticky-error")).toBeVisible();
  815 |   await expect(input).toHaveValue("通信が失敗しても入力を残す");
  816 |   await button("再試行").click();
  817 |   await expect(page.locator(".sticky-note")).toContainText("保存済み");
  818 |   await expect(page.locator(".sticky-error")).toHaveCount(0);
  819 |   await page.reload();
  820 |   await saved(page);
  821 |   await openEditor(page);
  822 |   await expect(input).toHaveValue("通信が失敗しても入力を残す");
  823 | });
  824 |
  825 | test("host edits shared map headings and row account names update vertically for guests", async ({
  826 |   page,
  827 |   browser,
  828 | }, info) => {
  829 |   const owner = `headings-${info.project.name}`,
  830 |     guest = `${owner}-guest`;
  831 |   const button = (p: Page, name: string) =>
  832 |     p.getByRole("button", { name, exact: true });
  833 |   await signIn(page, owner);
  834 |   await button(page, "この作品をクラウドに保存").click();
  835 |   await saved(page);
  836 |   await page.getByRole("button", { name: "クラウド", exact: true }).click();
  837 |   await button(page, "共有するアカウントを追加").click();
  838 |   await page
  839 |     .getByRole("textbox", { name: "事前共有するメールアドレス", exact: true })
  840 |     .fill(`${guest}@example.test`);
  841 |   await button(page, "事前共有を保存").click();
  842 |   await expect(page.locator(".pre-share-account")).toHaveCount(1);
  843 |   await button(page, "クラウドの作品を閉じる").click();
  844 |   const toggle = page.getByRole("switch", {
  845 |     name: "行に共有相手の名前を表示",
  846 |     exact: true,
  847 |   });
  848 |   await button(page, "マップの表示設定").click();
  849 |   await toggle.click();
  850 |   await expect(toggle).toHaveAttribute("aria-checked", "true");
  851 |   await page.keyboard.press("Escape");
  852 |   const heading = (p: Page, name: string) =>
  853 |     p.getByRole("textbox", { name, exact: true });
  854 |   await expect(heading(page, "行1の見出し")).toHaveValue(guest);
  855 |   await heading(page, "列2の見出し").fill("共同調査");
  856 |   await heading(page, "列2の見出し").press("Enter");
  857 |   const context = await browser.newContext({
  858 |     baseURL: "http://127.0.0.1:3187",
  859 |     viewport: { width: 1366, height: 768 },
  860 |   });
  861 |   const other = await context.newPage();
  862 |   try {
  863 |     await signIn(other, guest);
> 864 |     await button(other, "作品を開く：わたしたちのまちの、いいところ").click();
      |                                                  ^ Error: locator.click: Error: strict mode violation: getByRole('button', { name: '作品を開く：わたしたちのまちの、いいところ', exact: true }) resolved to 2 elements:
  865 |     await saved(other);
  866 |     await expect(heading(other, "列2の見出し")).toHaveValue("共同調査");
  867 |     await expect(heading(other, "列2の見出し")).toHaveAttribute("readonly", "");
  868 |     await expect(heading(other, "行1の見出し")).toHaveValue(guest);
  869 |     await expect(heading(other, "行1の見出し")).toHaveCSS(
  870 |       "writing-mode",
  871 |       "vertical-rl",
  872 |     );
  873 |     await button(other, "マップの表示設定").click();
  874 |     await expect(
  875 |       other.getByRole("switch", {
  876 |         name: "行に共有相手の名前を表示",
  877 |         exact: true,
  878 |       }),
  879 |     ).toBeDisabled();
  880 |     await other.keyboard.press("Escape");
  881 |     await heading(page, "行1の見出し").fill("1班");
  882 |     await heading(page, "行1の見出し").press("Enter");
  883 |     await expect(heading(other, "行1の見出し")).toHaveValue("1班");
  884 |     await heading(page, "行1の見出し").fill("");
  885 |     await heading(page, "行1の見出し").press("Enter");
  886 |     await expect(heading(other, "行1の見出し")).toHaveValue(guest);
  887 |
  888 |     const footer = (p: Page, position: string) =>
  889 |       p.getByRole("textbox", { name: `${position}のフッター`, exact: true });
  890 |     await expect(footer(other, "1.1")).toHaveValue(guest);
  891 |     await expect(footer(other, "2.1")).toHaveAttribute("readonly", "");
  892 |     await footer(other, "1.1").fill("わたしの調査");
  893 |     await footer(other, "1.1").press("Enter");
  894 |     await expect(footer(page, "1.1")).toHaveValue("わたしの調査");
  895 |     await openEditor(other);
  896 |     const assignees = other.getByRole("group", {
  897 |       name: "このスライドの共有者",
  898 |       exact: true,
  899 |     });
  900 |     // The actual shared names stay visible even with a custom thumbnail label.
  901 |     await expect(assignees).toContainText(guest);
  902 |     await expect(assignees).not.toContainText("わたしの調査");
  903 |     await expect(other.locator(".workspace-flight")).toHaveCount(0);
  904 |     await other.screenshot({
  905 |       path: info.outputPath("editor-shared-names.png"),
  906 |     });
  907 |     await button(other, "全体マップへ").click();
  908 |     await footer(other, "1.1").fill("");
  909 |     await footer(other, "1.1").press("Enter");
  910 |     await expect(footer(page, "1.1")).toHaveValue(guest);
  911 |     // Moving the assignment changes the name's row on all clients without reloading.
  912 |     const room = new URL(page.url()).searchParams.get("room")!;
  913 |     const response = await page.request.post(`/api/decks/${room}/recipients`, {
  914 |       headers: { Origin: "http://127.0.0.1:3187" },
  915 |       data: {
  916 |         recipients: [
  917 |           {
  918 |             email: `${guest}@example.test`,
  919 |             access: {
  920 |               mode: "scoped",
  921 |               comment: true,
  922 |               rows: [{ sheetId: "main", index: 1 }],
  923 |               columns: [],
  924 |               slides: [],
  925 |             },
  926 |           },
  927 |         ],
  928 |       },
  929 |     });
  930 |     expect(response.ok(), await response.text()).toBe(true);
  931 |     await expect(heading(other, "行1の見出し")).toHaveValue("");
  932 |     await expect(heading(other, "行2の見出し")).toHaveValue(guest);
  933 |     await expect(footer(page, "2.1")).toHaveValue(guest);
  934 |     await expect(footer(other, "1.1")).toHaveAttribute("readonly", "");
  935 |     await openEditor(other);
  936 |     await expect(assignees).toHaveCount(0);
  937 |     await button(other, "2段目の横のページをひらく").click();
  938 |     await button(other, "2.1 まちを歩いてみたらを編集").click();
  939 |     await expect(assignees).toContainText(guest);
  940 |     await button(other, "全体マップへ").click();
  941 |     await page.screenshot({ path: info.outputPath("shared-row-headings.png") });
  942 |     await other.reload();
  943 |     await saved(other);
  944 |     await expect(heading(other, "行2の見出し")).toHaveValue(guest);
  945 |   } finally {
  946 |     await context.close();
  947 |   }
  948 | });
  949 |
  950 | test("sticky color, presets and direct resize persist with mouse and touch", async ({
  951 |   page,
  952 | }, info) => {
  953 |   const button = (name: string) =>
  954 |     page.getByRole("button", { name, exact: true });
  955 |   await signIn(page, `sticky-style-${info.project.name}`);
  956 |   await button("この作品をクラウドに保存").click();
  957 |   await saved(page);
  958 |   await openEditor(page);
  959 |   // Measure preset growth above the accessible 120px minimum note width.
  960 |   // Touch still uses real touch events; narrow-canvas layout is a separate concern.
  961 |   await button("右のサイドバーをたたむ").click();
  962 |   await expect
  963 |     .poll(
  964 |       async () =>
```
