# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cache-recovery.spec.ts >> malformed Yjs bytes cannot contaminate the authoritative snapshot
- Location: tests/cloud/cache-recovery.spec.ts:193:1

# Error details

```
Error: apiRequestContext.get: socket hang up (ECONNRESET)
Call log:
  - → GET http://127.0.0.1:3187/api/decks/a196a362-cbd8-4d9f-ad4b-b9ee68904ec4
    - user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.4 Safari/537.36
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - cookie: vhslide_session=J4dS2CSKomVxxnR8lp3ZSEhZdAhlvLity8q5B-44c78

```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - banner [ref=f1e4]:
    - link "VHSlide 全体マップ" [ref=f1e5] [cursor=pointer]:
      - /url: "#"
      - text: VH
      - generic [ref=f1e12]: Slide
    - generic [ref=f1e14]:
      - textbox "作品のタイトル" [ref=f1e15]: わたしたちのまちの、いいところ
      - generic [ref=f1e16]:
        - status "クラウドに保存済み · 本文と付箋の保存状態です。端末へ書き出すJSONには付箋・共有設定・過去の版は含みません。" [ref=f1e19]:
          - generic [ref=f1e22]: クラウドに保存済み
        - generic [ref=f1e23]: ホスト
        - generic [ref=f1e24]: 1人が参加中
    - generic [ref=f1e25]:
      - generic [ref=f1e26]:
        - button "ファイル" [ref=f1e28] [cursor=pointer]
        - button "ファイルに保存" [ref=f1e34] [cursor=pointer]:
          - generic [ref=f1e38]: 保存
      - button "クラウド" [ref=f1e39] [cursor=pointer]
      - button "全員の画面を同期" [ref=f1e44] [cursor=pointer]: 全員を集合
      - button "ゲストの設定" [ref=f1e46] [cursor=pointer]
      - generic [ref=f1e49]:
        - button "発表する" [ref=f1e50] [cursor=pointer]
        - button "発表方法を選ぶ" [ref=f1e56] [cursor=pointer]
  - status "端末の一時保存の保護" [ref=f1e59]:
    - strong [ref=f1e60]: 読み込めなかった一時保存を、この端末に退避しました
    - paragraph [ref=f1e61]: クラウドに保存済みの内容を開いています。読み込めなかった未送信の変更は削除せずに保管し、クラウドへ送信していません。
    - generic [ref=f1e62]:
      - button "復旧用データをダウンロード" [ref=f1e63] [cursor=pointer]
      - button "復旧の案内を閉じる" [ref=f1e64] [cursor=pointer]: 閉じる
    - generic [ref=f1e65]: 復旧用ファイルは通常の作品JSONとは異なります。作品の内容を含みます。閉じた後も「クラウド」の作品一覧から保存できます。
  - navigation [ref=f1e66]:
    - generic [ref=f1e67]:
      - button "全体マップ" [ref=f1e68] [cursor=pointer]
      - button "ページを編集" [ref=f1e74] [cursor=pointer]
    - generic [ref=f1e77]:
      - button "もとに戻す" [disabled] [ref=f1e78]
      - button "やり直す" [disabled] [ref=f1e82]
      - button "その他" [ref=f1e88] [cursor=pointer]
  - main [ref=f1e94]:
    - region "ページの全体マップ" [ref=f1e95]:
      - generic [ref=f1e96]:
        - generic [ref=f1e97]:
          - heading "全体マップ" [level=1] [ref=f1e98]
          - generic "シート1・全体・5ページ" [ref=f1e105]:
            - generic [ref=f1e106]: シート1・全体
            - generic [ref=f1e107]: 5ページ
        - button "マップをフィルタ" [ref=f1e108] [cursor=pointer]: フィルタ
        - button "スライドを複数選択" [ref=f1e111] [cursor=pointer]: 選択
        - button "行・列を一括操作" [ref=f1e114] [cursor=pointer]
        - generic [ref=f1e115]:
          - textbox "ページ番号で探す" [ref=f1e116]:
            - /placeholder: "3.2"
          - button "番号のページを探す" [ref=f1e117] [cursor=pointer]
        - group "マップの表示サイズ" [ref=f1e121]:
          - button "マップを縮小" [ref=f1e122] [cursor=pointer]
          - button "表示サイズを100%に戻す" [ref=f1e126] [cursor=pointer]: 100%
          - button "マップを拡大" [disabled] [ref=f1e127]
        - button "マップの表示設定" [ref=f1e131] [cursor=pointer]: 表示
      - region "スライドのマップ" [ref=f1e133]:
        - generic [ref=f1e134]:
          - generic [ref=f1e136]: 次の話題へ
          - generic [aria-hidden] [ref=f1e141]: 行 / 列
          - generic [ref=f1e142]:
            - generic [ref=f1e143]: "01"
            - textbox "列1の見出し" [ref=f1e144]:
              - /placeholder: 列の名前
              - text: はじまり
            - button "話題1を移動" [ref=f1e145] [cursor=pointer]
          - generic [ref=f1e153]:
            - generic [ref=f1e154]: "02"
            - textbox "列2の見出し" [ref=f1e155]:
              - /placeholder: 列の名前
              - text: 話題 2
            - button "話題2を移動" [ref=f1e156] [cursor=pointer]
          - generic [ref=f1e164]:
            - generic [ref=f1e165]: "03"
            - textbox "列3の見出し" [ref=f1e166]:
              - /placeholder: 列の名前
              - text: 話題 3
            - button "話題3を移動" [ref=f1e167] [cursor=pointer]
          - generic [ref=f1e175]:
            - generic [ref=f1e176]:
              - button "高さ1のページをまとめて移動" [ref=f1e177] [cursor=pointer]: "01"
              - textbox "行1の見出し" [ref=f1e178]:
                - /placeholder: 見出し
            - generic [ref=f1e179]:
              - generic [ref=f1e180]:
                - button "わたしたちのまちを編集" [ref=f1e181] [cursor=pointer]:
                  - generic [ref=f1e182]:
                    - generic:
                      - generic: OUR TOWN
                      - generic: わたしたちのまちの、 いいところ。
                      - generic: いつもの景色に、新しい発見。
                  - generic [ref=f1e183]: 発表の先頭
                - generic [ref=f1e184]:
                  - generic [ref=f1e185]: "1.1"
                  - textbox "1.1のフッター" [ref=f1e186]: わたしたちのまち
                  - button "わたしたちのまちのページメニュー" [ref=f1e187] [cursor=pointer]
                  - button "わたしたちのまちを移動" [ref=f1e192] [cursor=pointer]
                  - button "わたしたちのまちを削除" [ref=f1e200] [cursor=pointer]
              - button "わたしたちのまちの右に次の話題を追加" [ref=f1e204] [cursor=pointer]
              - button "わたしたちのまちの下に詳しいページを追加" [ref=f1e206] [cursor=pointer]
            - generic [ref=f1e208]:
              - generic [ref=f1e209]:
                - button "自然がいっぱいを編集" [ref=f1e210] [cursor=pointer]:
                  - generic [ref=f1e211]:
                    - generic:
                      - generic: 01 / NATURE
                      - generic: 自然がいっぱい。
                      - generic: 緑の道を、歩いてみよう。
                - generic [ref=f1e212]:
                  - generic [ref=f1e213]: "1.2"
                  - textbox "1.2のフッター" [ref=f1e214]: 自然がいっぱい
                  - button "自然がいっぱいのページメニュー" [ref=f1e215] [cursor=pointer]
                  - button "自然がいっぱいを移動" [ref=f1e220] [cursor=pointer]
                  - button "自然がいっぱいを削除" [ref=f1e228] [cursor=pointer]
              - button "自然がいっぱいの右に次の話題を追加" [ref=f1e232] [cursor=pointer]
              - button "自然がいっぱいの下に詳しいページを追加" [ref=f1e234] [cursor=pointer]
            - generic [ref=f1e236]:
              - generic [ref=f1e237]:
                - button "人とつながるを編集" [ref=f1e238] [cursor=pointer]:
                  - generic [ref=f1e239]:
                    - generic:
                      - generic: 02 / PEOPLE
                      - generic: 人と、つながる。
                      - generic: 「こんにちは」から、はじまる。
                - generic [ref=f1e240]:
                  - generic [ref=f1e241]: "1.3"
                  - textbox "1.3のフッター" [ref=f1e242]: 人とつながる
                  - button "人とつながるのページメニュー" [ref=f1e243] [cursor=pointer]
                  - button "人とつながるを移動" [ref=f1e248] [cursor=pointer]
                  - button "人とつながるを削除" [ref=f1e256] [cursor=pointer]
              - button "人とつながるの右に次の話題を追加" [ref=f1e260] [cursor=pointer]
              - button "人とつながるの下に詳しいページを追加" [ref=f1e262] [cursor=pointer]
          - generic [ref=f1e264]:
            - generic [ref=f1e265]:
              - button "高さ2のページをまとめて移動" [ref=f1e266] [cursor=pointer]: "02"
              - textbox "行2の見出し" [ref=f1e267]:
                - /placeholder: 見出し
            - generic [ref=f1e268]:
              - generic [ref=f1e269]:
                - button "まちを歩いてみたらを編集" [ref=f1e270] [cursor=pointer]:
                  - generic [ref=f1e271]:
                    - generic:
                      - generic: ちいさな発見 01
                      - generic: まちを歩いてみたら
                      - generic: いつもの通学路にも、 まだ知らないことがある。
                - generic [ref=f1e272]:
                  - generic [ref=f1e273]: "2.1"
                  - textbox "2.1のフッター" [ref=f1e274]: まちを歩いてみたら
                  - button "まちを歩いてみたらのページメニュー" [ref=f1e275] [cursor=pointer]
                  - button "まちを歩いてみたらを移動" [ref=f1e280] [cursor=pointer]
                  - button "まちを歩いてみたらを削除" [ref=f1e288] [cursor=pointer]
              - button "まちを歩いてみたらの右に次の話題を追加" [ref=f1e292] [cursor=pointer]
              - button "まちを歩いてみたらの下に詳しいページを追加" [ref=f1e294] [cursor=pointer]
            - generic [ref=f1e296]:
              - generic [ref=f1e297]:
                - button "お気に入りの公園を編集" [ref=f1e298] [cursor=pointer]:
                  - generic [ref=f1e299]:
                    - generic:
                      - generic: ちいさな発見 02
                      - generic: お気に入りの公園
                      - generic: 季節が変わると、 どんな発見があるかな？
                - generic [ref=f1e300]:
                  - generic [ref=f1e301]: "2.2"
                  - textbox "2.2のフッター" [ref=f1e302]: お気に入りの公園
                  - button "お気に入りの公園のページメニュー" [ref=f1e303] [cursor=pointer]
                  - button "お気に入りの公園を移動" [ref=f1e308] [cursor=pointer]
                  - button "お気に入りの公園を削除" [ref=f1e316] [cursor=pointer]
              - button "お気に入りの公園の右に次の話題を追加" [ref=f1e320] [cursor=pointer]
              - button "お気に入りの公園の下に詳しいページを追加" [ref=f1e322] [cursor=pointer]
            - button "2.3にページを追加" [ref=f1e325] [cursor=pointer]:
              - generic [ref=f1e327]: ページを追加
      - generic [ref=f1e328]:
        - generic [ref=f1e329]:
          - generic [ref=f1e330]: ↔
          - text: よこは「次の話題」
          - generic [ref=f1e331]: /
          - generic [ref=f1e332]: ↕
          - text: たては「くわしい説明」
        - generic [ref=f1e333]: 長押し・つまみで移動 · ピンチで拡大・縮小
  - generic "シート一覧" [ref=f1e334]:
    - tablist "作品のシート" [ref=f1e335]:
      - tab "シート1" [selected] [ref=f1e337] [cursor=pointer]
    - button "空のシートを追加" [ref=f1e338] [cursor=pointer]
    - button "シートの操作" [ref=f1e340] [cursor=pointer]
  - status [ref=f1e345]
```

# Test source

```ts
  21  |   if (large) {
  22  |     const first = book.slides[0];
  23  |     book.slides = Array.from({ length: 400 }, (_, i) => ({
  24  |       ...structuredClone(first),
  25  |       id: crypto.randomUUID(),
  26  |       x: i % 10,
  27  |       y: Math.floor(i / 10),
  28  |       title: i ? `サンプル${i}` : first.title,
  29  |       elements: first.elements.map((e) => ({ ...e, id: crypto.randomUUID() })),
  30  |     }));
  31  |   }
  32  |   const made = await page.request.post("/api/decks", {
  33  |     headers: { Origin: origin },
  34  |     data: parseDeck(JSON.stringify(book)),
  35  |   });
  36  |   expect(made.status()).toBe(201);
  37  |   const { id } = await made.json(),
  38  |     result = await (await page.request.get(`/api/decks/${id}`)).json();
  39  |   await page.goto("/");
  40  |   return {
  41  |     id,
  42  |     key: `${user}/${id}`,
  43  |     user,
  44  |     result,
  45  |     book: parseDeck(JSON.stringify(book)),
  46  |   };
  47  | }
  48  | function broken(state: string, size = -1) {
  49  |   const doc = new Y.Doc();
  50  |   Y.applyUpdate(doc, fromBase64(state));
  51  |   const deck = readSharedDeck(doc),
  52  |     slide = doc.getMap<Y.Map<unknown>>("slides").get(deck.slides[0].id)!,
  53  |     elements = slide.get("elements") as Y.Map<Y.Map<unknown>>;
  54  |   elements.get(deck.slides[0].elements[0].id)!.set("fontSize", size);
  55  |   const bytes = Array.from(Y.encodeStateAsUpdate(doc));
  56  |   doc.destroy();
  57  |   return bytes;
  58  | }
  59  | async function seed(page: Page, key: string, bytes: number[]) {
  60  |   await page.evaluate(
  61  |     async ({ key, bytes, protocol }) => {
  62  |       await new Promise<void>((resolve, reject) => {
  63  |         const r = indexedDB.open("vhslide-cloud", 1);
  64  |         r.onupgradeneeded = () => r.result.createObjectStore("documents");
  65  |         r.onerror = () => reject(r.error);
  66  |         r.onsuccess = () => {
  67  |           const db = r.result,
  68  |             tx = db.transaction("documents", "readwrite");
  69  |           tx.objectStore("documents").put(
  70  |             { data: new Uint8Array(bytes), protocol },
  71  |             key,
  72  |           );
  73  |           tx.oncomplete = () => {
  74  |             db.close();
  75  |             resolve();
  76  |           };
  77  |           tx.onerror = () => reject(tx.error);
  78  |         };
  79  |       });
  80  |     },
  81  |     { key, bytes, protocol: COLLABORATION_PROTOCOL },
  82  |   );
  83  | }
  84  | async function caches(page: Page, key: string) {
  85  |   return page.evaluate(
  86  |     async (key) =>
  87  |       new Promise<{
  88  |         primary: number[];
  89  |         records: { documents: number[][]; acknowledged: boolean }[];
  90  |       }>((resolve, reject) => {
  91  |         const r = indexedDB.open("vhslide-cloud", 1);
  92  |         r.onerror = () => reject(r.error);
  93  |         r.onsuccess = () => {
  94  |           const db = r.result,
  95  |             s = db.transaction("documents").objectStore("documents"),
  96  |             primary = s.get(key),
  97  |             all = s.getAll(),
  98  |             keys = s.getAllKeys();
  99  |           keys.onsuccess = () => {
  100 |             resolve({
  101 |               primary: Array.from(primary.result.data ?? primary.result),
  102 |               records: all.result
  103 |                 .filter((_v, i) =>
  104 |                   String(keys.result[i]).startsWith(`recovery/${key}/`),
  105 |                 )
  106 |                 .map((v) => ({
  107 |                   documents: v.documents.map((d: any) =>
  108 |                     Array.from(d.data ?? d),
  109 |                   ),
  110 |                   acknowledged: !!v.acknowledged,
  111 |                 })),
  112 |             });
  113 |             db.close();
  114 |           };
  115 |         };
  116 |       }),
  117 |     key,
  118 |   );
  119 | }
  120 | async function serverBook(page: Page, id: string) {
> 121 |   const value = await (await page.request.get(`/api/decks/${id}`)).json(),
      |                                           ^ Error: apiRequestContext.get: socket hang up (ECONNRESET)
  122 |     doc = new Y.Doc();
  123 |   Y.applyUpdate(doc, fromBase64(value.state));
  124 |   const book = parseDeck(JSON.stringify(readSharedDeck(doc)));
  125 |   doc.destroy();
  126 |   return book;
  127 | }
  128 |
  129 | test("host automatically opens a 400-page work after isolating an invalid cache and retains its recovery file", async ({
  130 |   page,
  131 | }, info) => {
  132 |   const f = await fixture(page, `${info.project.name}-cache-host`, true),
  133 |     bytes = broken(f.result.state);
  134 |   await seed(page, f.key, bytes);
  135 |   await page.goto(`/?room=${f.id}`);
  136 |   await expect(page.locator(".cloud-presence")).toContainText(
  137 |     "クラウドに保存済み",
  138 |   );
  139 |   await expect(page.getByRole("dialog")).toHaveCount(0);
  140 |   const notice = page.getByRole("status", { name: "端末の一時保存の保護" });
  141 |   await expect(notice).toContainText("退避しました");
  142 |   expect((await serverBook(page, f.id)).slides).toEqual(f.book.slides);
  143 |   let saved = await caches(page, f.key);
  144 |   expect(saved.records).toHaveLength(1);
  145 |   expect(saved.records[0].documents).toEqual([bytes]);
  146 |   const primary = new Y.Doc();
  147 |   Y.applyUpdate(primary, new Uint8Array(saved.primary));
  148 |   expect(() =>
  149 |     parseDeck(JSON.stringify(readSharedDeck(primary))),
  150 |   ).not.toThrow();
  151 |   primary.destroy();
  152 |   const downloading = page.waitForEvent("download");
  153 |   await notice
  154 |     .getByRole("button", { name: "復旧用データをダウンロード", exact: true })
  155 |     .click();
  156 |   const data = JSON.parse(
  157 |     await readFile((await (await downloading).path())!, "utf8"),
  158 |   );
  159 |   expect(data.format).toBe("vhslide-local-recovery");
  160 |   expect(data.documents[0].data).toEqual({
  161 |     encoding: "base64",
  162 |     data: toBase64(new Uint8Array(bytes)),
  163 |   });
  164 |   await page.locator(".deck-title").fill("復帰後の編集");
  165 |   await expect
  166 |     .poll(async () => (await serverBook(page, f.id)).title)
  167 |     .toBe("復帰後の編集");
  168 |   await notice
  169 |     .getByRole("button", { name: "復旧の案内を閉じる", exact: true })
  170 |     .click();
  171 |   await expect(notice).toHaveCount(0);
  172 |   await page.reload();
  173 |   await expect(page.locator(".cloud-presence")).toContainText(
  174 |     "クラウドに保存済み",
  175 |   );
  176 |   await expect(notice).toHaveCount(0);
  177 |   await page.getByRole("button", { name: "クラウド", exact: true }).click();
  178 |   await page.getByRole("tab", { name: /作品一覧/ }).click();
  179 |   await expect(
  180 |     page.getByRole("button", {
  181 |       name: "復旧用データをダウンロード",
  182 |       exact: true,
  183 |     }),
  184 |   ).toBeVisible();
  185 |   saved = await caches(page, f.key);
  186 |   expect(saved.records[0].documents).toEqual([bytes]);
  187 |   expect(saved.records[0].acknowledged).toBe(true);
  188 |   await page.screenshot({
  189 |     path: info.outputPath("protected-cache-library.png"),
  190 |   });
  191 | });
  192 |
  193 | test("malformed Yjs bytes cannot contaminate the authoritative snapshot", async ({
  194 |   page,
  195 | }, info) => {
  196 |   const f = await fixture(page, `${info.project.name}-bad-bytes`),
  197 |     bytes = [1, 2, 3];
  198 |   await seed(page, f.key, bytes);
  199 |   await page.goto(`/?room=${f.id}`);
  200 |   await expect(page.locator(".cloud-presence")).toContainText(
  201 |     "クラウドに保存済み",
  202 |   );
  203 |   expect((await caches(page, f.key)).records[0].documents).toEqual([bytes]);
  204 |   expect((await serverBook(page, f.id)).slides).toEqual(f.book.slides);
  205 | });
  206 |
  207 | test("failed quarantine preserves the source and stays read-only until protection can be retried", async ({
  208 |   page,
  209 | }, info) => {
  210 |   const f = await fixture(page, `${info.project.name}-cache-quota`),
  211 |     bytes = broken(f.result.state);
  212 |   await seed(page, f.key, bytes);
  213 |   await page.addInitScript(() => {
  214 |     (window as any).__failRecovery = true;
  215 |     const put = IDBObjectStore.prototype.put;
  216 |     IDBObjectStore.prototype.put = function (value, key) {
  217 |       if ((window as any).__failRecovery && String(key).startsWith("recovery/"))
  218 |         throw new DOMException("local quota fixture", "QuotaExceededError");
  219 |       return put.call(this, value, key);
  220 |     };
  221 |   });
```
