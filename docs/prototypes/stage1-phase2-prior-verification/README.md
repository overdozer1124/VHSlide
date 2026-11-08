# 段階①フェーズ2 先行検証ハーネス（ローカル模擬）

実施計画 v0.5 第2節（独立した運営者認可）の §2.7 先行検証について、検証対象をローカルで試作し、ローカルテストを実行するためのハーネスです。設計と §2.7 対応表（ローカル確認の範囲／実環境必須の区別／未決定事項）は [DESIGN.md](./DESIGN.md) にあります。

> **これは模擬層です。** すべてこの VM 内のローカル作業で、実 Google・実 Cloudflare には一切接続しません。ID トークンはモック形式（`mockop|<sub>|<nonce>|<iss>|<aud>|<exp>`）で、検証器が iss・aud・exp・nonce・主体を明示的に検査しますが、**署名検証はモックでは代替できません**。承認内容・診断キーなどの値はすべてダミーです。ここでの結果は「ローカル模擬での確認」であり、§2.7 の受入条件（検証環境での実測）の充足ではありません。

## 実行

```sh
npm install
npm test   # = node test/run.mjs。全項目 PASS で終了コード 0
```

試験ランナーは Miniflare をプログラムから起動し、プラットフォーム経路の一時ビルド（`src/platform-worker.js`）と通常ビルド（`src/worker.js`）を、同じ永続化ディレクトリに対して差し替えながら、「配置→操作→通常ビルドへ復帰→登録簿の読み戻し」という実際の手順の順序で確認します。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/worker.js` | 通常ビルド。アプリ内管理ルート（運営者セッションなし、操作ごとのトークン検証、在籍・世代照合と変更の同一トランザクション化）＋診断読み取り。専用経路は持たない |
| `src/platform-worker.js` | プラットフォーム経路の一時ビルド。固定した承認内容（環境・用途・対象主体ハッシュ・期限・一回値・操作ID）をバインディングに持ち、完全一致時のみ登録簿の初期投入／全面差し替えを行う専用経路を持つ。管理ルートは持たない |
| `fault-builds/apply-after-writes/` | 故障版ビルド（検証専用・非公開）。書込み「後」の途中失敗を実環境で確認するための別成果物。差分は `apply-after-writes.diff` に固定 |
| `public/login-real.html` / `tools/serve-real.mjs` | 実ログイン画面と、その提供サーバー（PC 側運用）。フェーズ1の型でフェーズ2用に用意 |
| `public/subject-hash.html` / `tools/subject-hash-verify.mjs` | 対象主体ハッシュの取得専用ページと、PC 内署名検証（公開鍵・JWKS 方式）の共用モジュール。ID トークンを外部へ送らず、検証が通った場合だけ SHA-256(sub) を表示する。提供は `tools/serve-real.mjs`（`/subject-hash`） |
| `test/subject-hash-verify.test.mjs` | 上記検証モジュールの試験（`node --test`。正例2件＋負例10件＋ハッシュ相違1件＝13件。`npm test` は run.mjs と合わせて実行する） |
| `public/trial-apply.html` / `tools/trial-apply.mjs` | 不一致試験（環境不一致・一回値不一致）専用の検証画面と純粋モジュール。送信に使う単一の要求を凍結し、送信直前に非秘密項目と一致／不一致の事実だけを表示して、その同じ要求を送る。送信する JSON の全文表示はしない。主体の確認は署名検証と `tools/subject-hash-verify.mjs` を再利用する。提供は `tools/serve-real.mjs`（`/trial-apply`） |
| `test/trial-apply.test.mjs` | 上記モジュールの試験（`node --test`。14件。`npm test` は run.mjs・subject-hash 検証と合わせて実行する） |
| `test/trial-apply.screen.mjs` | 上記画面の実画面試験（`npm run test:screen`。34件。偽 GIS・偽 JWKS・遅延応答でページ自体を実行し、旧コールバック／古い finally が新試行を変更しないこと、送信とログが対応し二重送信されないこと、成功・現行の失敗・旧試行の遅延 finally の各ケースで一回値入力欄が適切に扱われることを確認する。実ブラウザーが使えない環境のため jsdom で実行する。詳細は DESIGN.md の付録を参照） |
| `tools/build-realenv-manifest.mjs` / `realenv-manifest.json` | 実環境用マニフェスト（成果物ハッシュ・バインディング一覧・ソース検査）の生成ツールと生成結果 |
| `test/run.mjs` | 試験ランナー（§2.7 の項目番号を各チェック名に付与） |
| `test/real-ui.smoke.mjs` | 実ログイン画面と提供サーバーのローカル疎通確認（`node test/real-ui.smoke.mjs`。run.mjs とは別枠） |
| `DESIGN.md` | 設計、§2.7 対応表、試作としての解釈、未決定事項 |

## テーブル（すべて `op2_*`、RegistryDO の SQLite storage）

- `op2_operators`（subject_hash 主キー、added_at、added_by）
- `op2_meta`（generation、initialized）
- `op2_consumed_ops`（operation_id 主キー、purpose、env_id、subject_hash、consumed_at）
- `op2_completion`（operation_id 一意、env_id、subject_hash、purpose、applied_at。不変記録）
- `op2_pending_nonce`（nonce、expires_at、used、ctx_hash）

識別子は生の sub を保存せず SHA-256 ハッシュで記録します（仮名識別子であり匿名化ではありません）。一回値はストレージに保存しません。
