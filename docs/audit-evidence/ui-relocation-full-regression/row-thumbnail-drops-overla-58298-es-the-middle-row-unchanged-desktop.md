# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: row-thumbnail-drops.spec.ts >> overlapping vertical thumbnails swaps complete groups and leaves the middle row unchanged
- Location: tests/e2e/row-thumbnail-drops.spec.ts:79:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 4
+ Received  + 4

@@ -3,19 +3,19 @@
      "background": "#e8efdf",
      "elements": Array [],
      "id": "page-0",
      "title": "段1-1",
      "x": 0,
-     "y": 0,
+     "y": 2,
    },
    Object {
      "background": "#e8efdf",
      "elements": Array [],
      "id": "page-1",
      "title": "段1-2",
      "x": 1,
-     "y": 0,
+     "y": 2,
    },
    Object {
      "background": "#e8efdf",
      "elements": Array [],
      "id": "page-2",
@@ -35,16 +35,16 @@
      "background": "#e8efdf",
      "elements": Array [],
      "id": "page-4",
      "title": "段3-1",
      "x": 0,
-     "y": 2,
+     "y": 0,
    },
    Object {
      "background": "#e8efdf",
      "elements": Array [],
      "id": "page-5",
      "title": "段3-2",
      "x": 1,
-     "y": 2,
+     "y": 0,
    },
  ]
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
      - textbox "作品のタイトル" [ref=e15]: 3段の移動
      - status "この端末に保存済み · このブラウザの一時保存です。授業の終わりにファイルへ書き出してください。" [ref=e16]:
        - generic [ref=e19]: この端末に保存済み
    - generic [ref=e20]:
      - button "作品" [ref=e22] [cursor=pointer]
      - generic [ref=e28]:
        - button "ファイルに保存" [ref=e29] [cursor=pointer]
        - button "保存方法を選ぶ" [ref=e35] [cursor=pointer]
      - generic [ref=e38]:
        - button "発表する" [ref=e39] [cursor=pointer]
        - button "発表方法を選ぶ" [ref=e45] [cursor=pointer]
  - main [ref=e48]:
    - generic [ref=e49]:
      - button "全体マップへ" [ref=e50] [cursor=pointer]
      - button "文字" [ref=e54] [cursor=pointer]
      - button "画像" [ref=e57] [cursor=pointer]
      - button "手描き" [ref=e62] [cursor=pointer]
      - button "表を追加" [ref=e64] [cursor=pointer]: 表
      - button "図形を追加" [ref=e67] [cursor=pointer]: 図形
      - button "線を追加" [ref=e72] [cursor=pointer]: 線
      - button "もっと見る（図解・グラフ）" [ref=e76] [cursor=pointer]: もっと見る
      - button "スピーカーノート" [ref=e79] [cursor=pointer]: ノート
      - group "編集画面の表示" [ref=e83]:
        - button "表示の設定" [ref=e84] [cursor=pointer]: 表示
        - button "サムネイルバーをたたむ" [expanded] [ref=e88] [cursor=pointer]
        - button "右のサイドバーをたたむ" [expanded] [ref=e92] [cursor=pointer]
      - generic [ref=e96]:
        - button "もとに戻す" [active] [ref=e97] [cursor=pointer]
        - button "やり直す" [disabled] [ref=e101]
        - button "その他" [ref=e107] [cursor=pointer]
    - generic [ref=e113]:
      - complementary "縦横のページ一覧" [ref=e114]:
        - generic [ref=e115]:
          - strong [ref=e116]: ページ一覧
          - button "行番号一覧" [ref=e117] [cursor=pointer]
        - generic [ref=e120]:
          - generic [ref=e122]:
            - button "1段目の横のページをひらく" [ref=e123] [cursor=pointer]:
              - generic [ref=e124]:
                - generic [ref=e125]: "1.1"
                - generic "ここをドラッグで段ごと移動" [ref=e126]
            - textbox "1.1のフッター" [ref=e138]: 段3-1
            - button "1段目のメニュー" [ref=e139] [cursor=pointer]
            - button "1段目の下に行を挿入" [ref=e145] [cursor=pointer]
          - generic [ref=e149]:
            - button "2段目の横のページをひらく" [ref=e150] [cursor=pointer]:
              - generic [ref=e151]:
                - generic [ref=e152]: "2.1"
                - generic "ここをドラッグで段ごと移動" [ref=e153]
            - textbox "2.1のフッター" [ref=e165]: 段2-1
            - button "2段目のメニュー" [ref=e166] [cursor=pointer]
            - button "2段目の下に行を挿入" [ref=e172] [cursor=pointer]
          - generic [ref=e176]:
            - button "3段目の横のページをひらく" [ref=e177] [cursor=pointer]:
              - generic [ref=e178]:
                - generic [ref=e179]: "3.1"
                - generic "ここをドラッグで段ごと移動" [ref=e180]
            - textbox "3.1のフッター" [ref=e192]: 段1-1
            - button "3段目のメニュー" [ref=e193] [cursor=pointer]
            - button "3段目の下に行を挿入" [ref=e199] [cursor=pointer]
        - generic [ref=e203]: 段ごと移動 ↕ · 重ねて入れ替え · 間に挿入
        - separator "サムネイルバーの幅" [ref=e204]
      - status [ref=e205]: Draggable item row-0 was dropped over droppable area row-target-2
      - generic [ref=e206]:
        - generic [ref=e207]:
          - generic "シート1・全体・6ページ" [ref=e208]:
            - generic [ref=e209]: シート1・全体
            - generic [ref=e210]: 6ページ
          - textbox "ページの名前" [ref=e211]: 段1-1
          - generic [ref=e212]: 3.1 / 16:9
        - generic "編集中のスライド" [ref=e213]
        - generic [ref=e217]: 空白からドラッグで範囲選択 · Shift/Ctrl＋クリックで追加
      - complementary [ref=e219]:
        - generic [ref=e221]:
          - generic [ref=e222]: ページ設定
          - heading "ページのデザイン" [level=2] [ref=e223]
        - group [ref=e225]:
          - generic [ref=e226]:
            - generic [ref=e227]:
              - text: 背景の色
              - textbox "背景の色" [ref=e228] [cursor=pointer]: "#e8efdf"
            - generic [ref=e229]:
              - button "背景を#ffffffに変更" [ref=e230] [cursor=pointer]
              - button "背景を#e5f0dcに変更" [ref=e231] [cursor=pointer]
              - button "背景を#e7efeaに変更" [ref=e232] [cursor=pointer]
              - button "背景を#f8eddcに変更" [ref=e233] [cursor=pointer]
              - button "背景を#f4e5e4に変更" [ref=e234] [cursor=pointer]
              - button "背景を#e4eaf6に変更" [ref=e235] [cursor=pointer]
              - button "背景を#173d38に変更" [ref=e236] [cursor=pointer]
              - button "背景を#d6bc94に変更" [ref=e237] [cursor=pointer]
            - paragraph [ref=e238]: キャンバスの中の文字や図形をタップすると、色や大きさを変えられます。
  - generic "シート一覧" [ref=e239]:
    - tablist "作品のシート" [ref=e240]:
      - tab "シート1" [selected] [ref=e242] [cursor=pointer]
    - button "空のシートを追加" [ref=e243] [cursor=pointer]
    - button "シートの操作" [ref=e245] [cursor=pointer]
  - status [ref=e250]
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | import type { Page, Locator } from "@playwright/test";
  3   | 
  4   | const readDeck = (page: Page) =>
  5   |   page.evaluate(() => JSON.parse(localStorage.getItem("vhslide-deck-v1")!));
  6   | 
  7   | async function editor(page: Page) {
  8   |   await page.addInitScript(() => {
  9   |     localStorage.setItem(
  10  |       "vhslide-deck-v1",
  11  |       JSON.stringify({
  12  |         version: 1,
  13  |         title: "3段の移動",
  14  |         slides: Array.from({ length: 6 }, (_, i) => ({
  15  |           id: `page-${i}`,
  16  |           x: i % 2,
  17  |           y: Math.floor(i / 2),
  18  |           title: `段${Math.floor(i / 2) + 1}-${(i % 2) + 1}`,
  19  |           background: "#e8efdf",
  20  |           elements: [],
  21  |         })),
  22  |       }),
  23  |     );
  24  |   });
  25  |   await page.goto("/");
  26  |   await page.getByRole("button", { name: "段1-1を編集", exact: true }).click();
  27  |   await expect(page.locator(".workspace-flight")).toHaveCount(0);
  28  | }
  29  | 
  30  | async function drag(page: Page, source: Locator, touch: boolean) {
  31  |   const box = (await source.boundingBox())!;
  32  |   let point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  33  |   const cdp = touch ? await page.context().newCDPSession(page) : undefined;
  34  |   if (cdp)
  35  |     await cdp.send("Input.dispatchTouchEvent", {
  36  |       type: "touchStart",
  37  |       touchPoints: [{ ...point, id: 1 }],
  38  |     });
  39  |   else {
  40  |     await page.mouse.move(point.x, point.y);
  41  |     await page.mouse.down();
  42  |     await page.mouse.move(point.x + 10, point.y, { steps: 3 });
  43  |   }
  44  |   await expect(page.locator(".rail-drag-preview")).toBeVisible();
  45  |   return {
  46  |     async move(target: Locator, offset?: { x: number; y: number }) {
  47  |       const b = (await target.boundingBox())!;
  48  |       const next = {
  49  |         x: b.x + (offset?.x ?? b.width / 2),
  50  |         y: b.y + (offset?.y ?? b.height / 2),
  51  |       };
  52  |       if (cdp)
  53  |         for (let i = 1; i <= 12; i++)
  54  |           await cdp.send("Input.dispatchTouchEvent", {
  55  |             type: "touchMove",
  56  |             touchPoints: [
  57  |               {
  58  |                 id: 1,
  59  |                 x: point.x + ((next.x - point.x) * i) / 12,
  60  |                 y: point.y + ((next.y - point.y) * i) / 12,
  61  |               },
  62  |             ],
  63  |           });
  64  |       else await page.mouse.move(next.x, next.y, { steps: 12 });
  65  |       point = next;
  66  |     },
  67  |     async end() {
  68  |       if (cdp)
  69  |         await cdp.send("Input.dispatchTouchEvent", {
  70  |           type: "touchEnd",
  71  |           touchPoints: [],
  72  |         });
  73  |       else await page.mouse.up();
  74  |       await expect(page.locator(".rail-drag-preview")).toHaveCount(0);
  75  |     },
  76  |   };
  77  | }
  78  | 
  79  | test("overlapping vertical thumbnails swaps complete groups and leaves the middle row unchanged", async ({
  80  |   page,
  81  | }, info) => {
  82  |   await editor(page);
  83  |   const before = await readDeck(page);
  84  |   // Use the thumbnail body so the touch project exercises long-press activation.
  85  |   const gesture = await drag(
  86  |     page,
  87  |     page.locator('[data-drop-row="0"] .rail-trigger'),
  88  |     info.project.name === "touch",
  89  |   );
  90  |   await gesture.move(page.locator('[data-drop-row="2"] .rail-trigger'));
  91  |   await gesture.end();
  92  |   const after = await readDeck(page);
  93  |   expect(after.slides.map((s: any) => s.y)).toEqual([2, 2, 1, 1, 0, 0]);
  94  |   for (const slide of before.slides)
  95  |     expect(after.slides.find((s: any) => s.id === slide.id)).toEqual({
  96  |       ...slide,
  97  |       y: 2 - slide.y,
  98  |     });
  99  |   await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
> 100 |   expect((await readDeck(page)).slides).toEqual(before.slides);
      |                                         ^ Error: expect(received).toEqual(expected) // deep equality
  101 | });
  102 | 
  103 | test("vertical gaps animate and insert a group, including the expanded gap and final boundary", async ({
  104 |   page,
  105 | }, info) => {
  106 |   await editor(page);
  107 |   const before = await readDeck(page);
  108 |   const touch = info.project.name === "touch";
  109 |   // The grip bypasses the delay and starts a touch drag immediately.
  110 |   let gesture = await drag(
  111 |     page,
  112 |     page.locator('[data-drop-row="0"] .rail-drag-hint'),
  113 |     touch,
  114 |   );
  115 |   const gap = page.locator('[data-drop-row-insert="2"]');
  116 |   const neighbor = page.locator('[data-drop-row="2"] .rail-trigger');
  117 |   const top = (await neighbor.boundingBox())!.y;
  118 |   await gesture.move(gap);
  119 |   await expect(gap).toHaveAttribute("data-over", "true");
  120 |   await expect
  121 |     .poll(async () => (await neighbor.boundingBox())!.y - top)
  122 |     .toBeGreaterThan(12);
  123 |   const b = (await gap.boundingBox())!;
  124 |   await gesture.move(gap, { x: b.width / 2, y: b.height + 8 });
  125 |   await expect(gap).toHaveAttribute("data-over", "true");
  126 |   expect((await readDeck(page)).slides).toEqual(before.slides);
  127 |   await gesture.end();
  128 |   expect((await readDeck(page)).slides.map((s: any) => s.y)).toEqual([
  129 |     1, 1, 0, 0, 2, 2,
  130 |   ]);
  131 | 
  132 |   await page.getByRole("button", { name: "もとに戻す", exact: true }).click();
  133 |   expect((await readDeck(page)).slides).toEqual(before.slides);
  134 |   gesture = await drag(
  135 |     page,
  136 |     page.locator('[data-drop-row="0"] .rail-drag-hint'),
  137 |     touch,
  138 |   );
  139 |   await gesture.move(page.locator(".rail-new-row-drop"));
  140 |   await gesture.end();
  141 |   expect((await readDeck(page)).slides.map((s: any) => s.y)).toEqual([
  142 |     2, 2, 0, 0, 1, 1,
  143 |   ]);
  144 | });
  145 | 
```