# Cloudflare：無料枠で停止する構成

VHSlideの画面、Googleサインイン、共同編集、写真の永続保存をCloudflare WorkersとSQLite型Durable Objectsで動かします。R2・D1・KV・Containersは使いません。Railway用のサーバーも引き続き利用できます。

## 料金について最初に確認すること

**この構成はCloudflareアカウントのWorkersプランがFreeであることを前提とします。Workers Paidへ変更しないでください。** ドメインのFree/Proプランとは別の設定です。既にWorkers Paidを契約しているアカウントでは、このコードでも利用量による課金が発生します。コードや容量制限だけでPaidアカウントの請求を止めるものではありません。

Workers Free・SQLite型Durable Objects Freeは無料枠を超えた操作がエラーになります。自動で有料枠へ切り替えて継続する構成にはしていません。R2は無料枠超過分が従量課金になるため有効化せず、支払い方法の登録も不要です。有料プランや追加商品を購入する設定は同梱していません。

2026年10月22日に確認した公式資料での主な無料上限です。アカウント内の他のアプリと共有します。

| 対象                        | 無料上限                        | 超えた場合                      |
| --------------------------- | ------------------------------- | ------------------------------- |
| Workersの動的リクエスト     | 1日100,000回、CPU 10ms/呼び出し | APIに接続できない場合があります |
| Durable Objectsのリクエスト | 1日100,000課金換算リクエスト    | 共同編集などが停止します        |
| Durable Objectsの実行時間   | 1日13,000 GB-s                  | 共同編集などが停止します        |
| SQLiteの読み取り・書き込み  | 1日500万行・10万行              | 読み込みや保存が停止します      |
| Durable Objectsの保存容量   | 合計5GB                         | 新規保存が停止します            |

静的ファイルの配信はWorkersの動的リクエスト枠とは別です。日次の枠はUTC 0時（日本時間9時）にリセットされます。容量は作品を削除するなどして空ける必要があります。接続人数40人だけでは消費量は決まらず、文字入力・画像追加・共同編集する作品数によって変わります。学校での実利用前にダッシュボードで消費量を確認してください。

無料枠を超えると保存済み写真の取得や、写真を含むJSONの書き出しもできない場合があります。授業の途中・終わりにJSONを保存してください。上限時に未保存の編集を保存済みと表示しないよう、サーバーは永続化に成功してから保存確認を返し、ブラウザは未送信の編集をIndexedDBに一時保存します。サーバー停止中の共同編集継続や、無制限の無料運用を保証する構成ではありません。

公式資料：[Workers Free](https://developers.cloudflare.com/workers/platform/limits/) / [Durable Objectsの料金](https://developers.cloudflare.com/durable-objects/platform/pricing/) / [保存容量](https://developers.cloudflare.com/durable-objects/platform/limits/) / [R2の従量課金](https://developers.cloudflare.com/r2/pricing/)

## 構成とアプリ内の制限

- Workers Static Assets：Reactの画面を配信。従来のJSONインポート・エクスポートを利用できます。
- Directory Durable Object：Google IDトークンの署名検証、HttpOnlyセッション、作品一覧、招待、参加者、写真容量の予約を管理します。
- SlideRoom Durable Object：作品ごとにYjsの共有データ、変更履歴、写真をSQLiteへ保存します。写真・共有データは64KB単位に分割し、大きなSQLite行に依存しません。
- WebSocket Hibernation API：操作していない間は接続を維持したまま休眠できる構成です。常駐タイマーは使いません。編集の送信は入力が約1秒途切れた時にまとめます。
- 同じ作品に最大50接続、作成者ごと40作品、1作品最大400枚です。Google認証と招待への参加が必要です。写真は公開URLにせず、参加権限を確認して配信します。
- 写真は1枚6MB、作成者ごと50MB、アプリ全体500MBです。容量を先に予約するため、並行アップロードでも制限を超えません。作品削除で写真と容量予約を解放します。これらは料金の上限設定ではなく、無料プランの保存領域を守る補助制限です。
- 写真を含むクラウドへの作品アップロードは10MBまで、写真を分離した文字・図形データは2MB、Yjsの保存データは8MBまでです。端末でのJSON保存の従来上限25MBとは異なります。

## 公開の手順（Windows PowerShellでも可）

`/workspace/VHSlide`はCodex環境のパスです。WindowsではVHSlideをダウンロード／cloneしたフォルダを使ってください。`package.json`があるフォルダで、Node.js 24を使います。

1. CloudflareのダッシュボードでWorkersのプランが**Free**であることを確認します。R2の契約・Workers Paidへのアップグレードはしません。
2. リポジトリの最新版を取得し、依存関係と画面を準備します。

```sh
npm ci
npm run build
npm run cf:check
```

3. 自分のPCのターミナルでCloudflareへログインします。このコマンドで開くブラウザから認証し、トークンはチャットに貼り付けないでください。

```sh
npx wrangler login
```

4. `wrangler.jsonc`の`name`はCloudflare内のWorker名です。既存の同名アプリがある場合は別の名前に変えてから、公開します。初回はGoogle IDを空にしておき、端末での編集が動くURLを先に取得できます。

```sh
npm run cf:deploy
```

`https://vhslide.<アカウントのサブドメイン>.workers.dev`のようなURLが表示されます。独自ドメインは不要です。初回にSQLite型Durable Objectsの2クラスが作成されます。`migrations`を削除・変更しないでください。

5. Google Cloud ConsoleでOAuth同意画面と「ウェブアプリケーション」のOAuthクライアントを作成します。「承認済みのJavaScript生成元」に取得した公開URLの**originだけ**（末尾のパス・スラッシュなし）を登録します。この実装はGoogle Identity ServicesのIDトークン方式なので、クライアントシークレットやGoogle Driveの権限は使いません。テスト公開では授業で使うGoogleアカウントをテストユーザーへ追加し、学校管理アカウントでは管理者によるアプリ許可が必要な場合もあります。
6. `wrangler.jsonc`の`vars`を設定し、再度`npm run cf:deploy`を実行します。

```json
"vars": {
  "GOOGLE_CLIENT_ID": "取得したID.apps.googleusercontent.com",
  "PUBLIC_ORIGIN": "https://vhslide.あなたのサブドメイン.workers.dev"
}
```

GoogleクライアントIDは公開用の識別子です。CloudflareのAPIトークンやGoogleのクライアントシークレットはここへ書かないでください。`PUBLIC_ORIGIN`とブラウザで開くURLが一致しない場合、アクセスは拒否されます。

7. ブラウザを再読み込みし、「クラウド」→Googleサインイン→作品をクラウドへ保存→招待リンクを作成、の順に確認します。別のアカウントで招待を開き、同時編集・写真入りJSONの保存・翌日の再表示を試してください。

このチャットのクラウド環境にはCloudflareの接続情報が設定されていません。デプロイ用コードとローカル検証を用意し、実アカウントへの公開は上記の手順で行います。Wranglerの`--dry-run`は公開やアカウントのプラン変更を行いません。

## ローカル開発・検証

```sh
npm run cf:dev                # 画面をビルドし、localhost:8787でWorkersを実行
npm run test:cloudflare       # Workers実行系でJWT・権限・40接続・写真・再起動を検証
npm run test:cloudflare:e2e   # ビルド・cf:check後、PC/タッチでブラウザ検証
```

`cf:dev`の保存先はローカルの`.wrangler`内です。本番のデータとは共有しません。ローカルで実際のGoogleサインインを使う場合は、Googleに`http://localhost:8787`も登録し、ローカル用設定で`PUBLIC_ORIGIN`をそのURLに合わせます。

テストはMiniflare/workerdのSQLite型Durable Objectsを使います。Googleの外部通信はテスト用JWKSで置き換えますが、JWTの署名・発行者・audience検証は本番のコードを通します。テスト用の署名鍵・トークン発行は`tests/cloudflare`内にだけあり、本番Workerには含まれません。ローカル実行では本番の日次無料枠・CPU時間の消費や課金停止そのものは再現されません。

Cloudflareのサービス間通信とGoogleの公開鍵取得は本番Worker内で行われます。Codex環境のネットワーク制限を解除しなくてもローカルテストは実行できます。Codex環境でWranglerの設定フォルダに書き込めない場合だけ、実行時の`XDG_CONFIG_HOME`を`/tmp`内の作業用フォルダに設定します。
