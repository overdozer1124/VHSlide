# 段階①フェーズ2 先行検証ハーネス（ローカル模擬）

実施計画 v0.5 第2節（独立した運営者認可）の §2.7 先行検証について、検証対象をローカルで試作し、ローカルテストを実行するためのハーネスです。設計と §2.7 対応表（ローカル確認の範囲／実環境必須の区別／未決定事項）は [DESIGN.md](./DESIGN.md) にあります。

> **これは模擬層です。** すべてこの VM 内のローカル作業で、実 Google・実 Cloudflare には一切接続しません。ID トークンはモック形式（`mockop|<sub>|<nonce>|<iss>|<aud>|<exp>`）で、検証器が iss・aud・exp・nonce・主体を明示的に検査しますが、**署名検証はモックでは代替できません**。承認内容・診断キーなどの値はすべてダミーです。ここでの結果は「ローカル模擬での確認」であり、§2.7 の受入条件（検証環境での実測）の充足ではありません。

## 実行

```sh
npm install
npm test   # = node test/run.mjs + 各モジュール試験。全項目 PASS で終了コード 0
npm run test:screen   # trial-apply 画面の実画面試験（jsdom）
npm run test:screen:s5   # s5-apply 画面の実画面試験（jsdom）
node test/real-ui.smoke.mjs   # 配信の疎通確認
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
| `public/trial-apply.html` / `tools/trial-apply.mjs` | 不一致試験（環境不一致・一回値不一致）と S4 の消費済み・初期化済み試験の専用画面と純粋モジュール。送信に使う単一の要求を凍結し、送信直前に非秘密項目と一致／不一致の事実だけを表示して、その同じ要求を送る。送信する JSON の全文表示はしない。主体の確認は署名検証と `tools/subject-hash-verify.mjs` を再利用する。提供は `tools/serve-real.mjs`（`/trial-apply`）。用途は試験種別で決まる固定値（不一致試験は full-replace、S4 の2試験は bootstrap） |
| `test/trial-apply.test.mjs` | 上記モジュールの試験（`node --test`。17件。`npm test` は run.mjs・subject-hash 検証と合わせて実行する） |
| `test/trial-apply.screen.mjs` | 上記画面の実画面試験（`npm run test:screen`。44件。偽 GIS・偽 JWKS・遅延応答でページ自体を実行し、旧コールバック／古い finally が新試行を変更しないこと、送信とログが対応し二重送信されないこと、成功・現行の失敗・旧試行の遅延 finally の各ケースで一回値入力欄が適切に扱われること、S4 の2試験の表示・送信・環境条件を確認する。実ブラウザーが使えない環境のため jsdom で実行する。詳細は DESIGN.md の付録を参照） |
| `public/s5-apply.html` / `tools/s5-apply.mjs` | S5 並行試験（full-replace への並行6件）専用の検証画面と純粋モジュール。6件の実トークンを集めて凍結した要求を作り、送信直前に6件の条件が等しいことと nonce が異なることを表示して、その同じ6件の要求を送信指示として送信器へ渡す。提供は `tools/serve-real.mjs`（`/s5-apply`） |
| `tools/s5-sender.mjs` | S5 の Node 側送信器（提供サーバー専用。ブラウザーには配信しない）。スロットごとに Cookie jar を分け、6件を Promise.allSettled で並行送信する。fetch はすべて redirect: "manual" で、3xx は追従せず再送なしの失敗として記録する。送信前の結び付け確認（トークンの nonce とスロットの nonce の一致、6件の条件の等しさ、6件の発行開始から4分以内、送信指示の試行 ID と発行した試行 ID の一致）に失敗すれば1件も送らない。確認が通れば送信前に同期的に発行状態を消費して送信中へ遷移し、並行 send・送信中の再発行は s5_busy で拒否する。送信の完了直後に保持を破棄する |
| `test/s5-apply.test.mjs` | 上記純粋モジュールの試験（`node --test`。7件。`npm test` で合わせて実行する） |
| `test/s5-sender.test.mjs` | 上記送信器の試験（`node --test`。17件。Miniflare の一時ビルド相手に、6件の並行送信で 201 が正確に1件・残りが 409 operation_consumed になることと、結び付け・条件・期限の各ガードを確認する。Codex レビュー 6720755818 への対応で、3xx 非追従・2並行 send の拒否・送信中の再発行と並行 issue の拒否・試行の結び付け・応答喪失時の再送なし・nonce 寿命の起点（6件の発行開始から4分）の試験を追加した。Codex レビュー 6720906411 への対応で、最初の `/nonce` の応答を61秒遅らせた遅延試験を追加した。`npm test` で合わせて実行する） |
| `test/serve-real-s5.test.mjs` | 提供サーバーの S5 入口（/s5/nonces・/s5/send）の呼び出し元境界の実行試験（`node --test`。12件。Codex レビュー 6720755818 の指摘3への対応。偽の中継を相手に、セッションなし・不一致・別オリジン・DNS rebinding の模擬（Host 別名・ポート違い）の拒否、JSON content-type・本体サイズ上限、試行の結び付けと別画面との競合を確認する。`npm test` で合わせて実行する） |
| `test/s5-apply.screen.mjs` | 上記画面の実画面試験（`npm run test:screen:s5`。39件。偽 GIS・偽 JWKS でページ自体を実行し、6スロットの準備・並行送信・ログ対応・二重送信防止・失敗時の扱いを確認する。Codex レビュー 6720755818 への対応で、/s5/nonces・/s5/send の呼び出しが試験単位のセッションと試行 ID を示すことの確認を追加した。送信器は本物を通すが、中継先は local-mock の通常ビルドのため応答は 404 になる。201・409 の判定は送信器の試験で確認する。実ブラウザーが使えない環境のため jsdom で実行する。詳細は DESIGN.md の付録を参照） |
| `tools/build-realenv-manifest.mjs` / `realenv-manifest.json` | 実環境用マニフェスト（成果物ハッシュ・バインディング一覧・ソース検査）の生成ツールと生成結果。成果物 21 件・ソース検査 79 件 |
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
