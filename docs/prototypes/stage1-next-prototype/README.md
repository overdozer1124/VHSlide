# 段階①フェーズ1 次期独立試作ハーネス（手順1・ローカル模擬）

実施計画 v0.3（`~/workspace/vhslide-stage1-next-prototype-plan.md`）の **手順1（ローカル模擬）** の成果物です。共有コードへの Codex レビュー（Issue #3 コメント 6590319199 の指摘6点、同 6590552695 の再レビュー指摘）への修正を反映しています。再レビューへの対応: exp の有限数値の明示検査（fail-closed）、DEPLOYMENT_TIER の明示指定必須化と配置防護（マニフェスト生成＋カナリア確認）、実画面の提供サーバー `tools/serve-real.mjs`、試験ランナーの接続リトライと実行環境の出力。なお再レビュー指摘3（verify 形態では失敗注入・診断・再起動フックが無効なため、実 Cloudflare での途中失敗・再起動・状態照合をどう扱うか）は、計画側の判断事項として本コード変更には含めていません。

Codex の再確認レビュー（Issue #3 コメント 6590721879）への対応も反映しています: 項目1 = `tools/serve-real.mjs` の `RELAY_URL` 制限（起動時検証＋リダイレクト非追従、下記「RELAY_URL の制限」参照）、項目2 = 試験ランナーの再試行ポリシーの見直し（再試行は冪等な読み取りのみ、下記「再試行ポリシー」参照）。同レビューの項目3（fault 入りビルドと再生成の実操作手順の事前共有）は計画文書側の対応であり、本コード変更には含めていません。

> **これは模擬層です。** すべてこの VM 内のローカル作業で、実 Google・実 Cloudflare には一切接続しません。ID トークンは模擬値（`mock.<sub>.<nonce>`）、シークレットはすべてダミー値を使います。実認証の検証ロジックは、ローカルに立てた偽 tokeninfo サーバー（fabricated な JSON を返すだけ）で確認します。ここでの結果は「模擬層での確認」であり、実経路（手順2以降）の実証ではありません。

## ファイル構成と計画 v0.3 との対応

| ファイル | 役割 | 計画の対応箇所 |
|---|---|---|
| `src/worker.js` | ハーネス本体。fetch ハンドラ＋ Durable Object クラス `VerificationDO`（SQLite storage、`transactionSync` 使用）。テーブルは接頭辞 `mtrial_*` | 第3節（構成・Origin/CSRF/Cookie・nonce・原子性）、第2節（識別子の記録方法） |
| `public/login-mock.html` | **模擬専用**のログイン画面（静的 HTML）。nonce 取得 → 模擬トークンを組み立てて /register 等へ送信。**実試験には使いません** | 手順1（ローカル模擬） |
| `public/login-real.html` | **実試験用**のログイン画面。Google Identity Services（GIS）を読み込み、nonce を取得してから実 Google ログインを行い、ID トークンを同一生成元の固定パスへ送る。クライアント ID はプレースホルダで、実値は PC 側で設定する | 第3節（ログイン画面）、手順2以降 |
| `relay/worker.js` | PC 側中継のひな形（変形B用）。受けた要求のヘッダー（Origin・Cookie）を変更せず、検証用 Worker への service binding 呼び出しへ素通しする | 第3節（中継：素通し・アプリケーションレベルの拒否をしない） |
| `relay/wrangler.toml.example` | 中継の設定例（変形Bの service binding は `remote = true` 付き／ローカル模擬の HARNESS_URL） | 第3節（変形B）、手順0（接続先の照合） |
| `tools/serve-login.mjs` | **模擬専用**の小さな配信サーバー。模擬画面を `http://localhost:8787` で配信し、それ以外の経路をハーネスへ素通しする。実試験では使いません（実画面用は `tools/serve-real.mjs`） | 手順1（ローカルで画面を動かすため） |
| `tools/serve-real.mjs` | **実試験用**の提供サーバー（PC 側）。実画面を 127.0.0.1:8787 で配信し、API 経路を中継（RELAY_URL）へ素通しして、画面と API を同一生成元で提供する。クライアント ID は環境変数からメモリ上で差し込む。RELAY_URL は起動時に検証し（http＋ループバック＋ポート明示のみ許可）、転送時のリダイレクトは追従しない | 第3節（ログイン画面）、手順2以降 |
| `tools/build-deploy-manifest.mjs` | 配置用マニフェストの生成（`--tier verify` の明示時のみ）。バインディングの一覧（値は含めない）と、ソース検査による配置防護の根拠（行番号）を JSON で出す | 手順0・手順2（配置前の照合） |
| `tools/serve-harness.mjs` | ハーネスを固定ポート 8799 で起動する手動確認用ランチャー（Miniflare） | 手順1 |
| `test/run.mjs` | 試験ランナー。Miniflare をプログラムから起動し、手順3〜6の項目＋中継の対照＋設定検証＋実認証ロジック（偽 tokeninfo）＋serve-real の動作確認（RELAY_URL の起動時検証・リダイレクト非追従を含む）を自動確認する。実行環境（OS／Node／Miniflare）を冒頭に出力する。再試行は冪等な読み取りだけに限定し、状態変更要求は接続例外でも再送しない（下記「再試行ポリシー」参照） | 第6節 手順3〜6 |
| `package.json` | 依存（miniflare のみ）と `npm test` の定義 | ― |

## ハーネスの仕様

### 設定検証（fail-closed）

env `DEPLOYMENT_TIER` は `local-mock` / `verify` の2値で、**明示指定が必須**です。未設定・空・想定外の値は既定値へ読み替えず、全経路を `500 config_refused`（detail: `config_bad_tier`）で拒否します（配置設定の取り違えで MOCK_AUTH やテストフックが意図せず有効になる組合せを残さないため）。全リクエストの入口（Worker 本体と DO の双方）で設定を検証します。

- tier=verify では `MOCK_AUTH=1`・`ALLOW_TEST_HOOKS=1`・`TOKENINFO_URL` の設定（上書き）を禁止し、いずれか有効なら全経路を拒否します
- 非 MOCK 時は `GOOGLE_CLIENT_ID` が未設定・空なら必ず拒否します（aud 検査を省略しません）
- `ENV_ID` が未設定・空なら登録・復旧を `500 config_missing_env_id` で拒否します（`unknown-env` のような代替値への読み替えはしません）

### 配置防護（配置形態の取り違え対策）

設定値だけでは環境を独立に証明したことにはならないため、配置側の手順と併せて防護します。

- `tools/build-deploy-manifest.mjs --tier verify` が、配置に使うバインディングの一覧（シークレットや環境固有値は名前と種別だけで、値は含めない）を JSON で出力します。形態を明示しないと生成しません。あわせて `src/worker.js` を静的に検査し、(1) tier の既定値フォールバックが残っていないこと、(2) MOCK_AUTH の分岐が tier=verify では設定検証で到達不能になる根拠（該当箇所の行番号）、をマニフェストに含めます。問題があれば生成せず終了コード 1 で終わります
- 配置後のカナリア確認を用意しています: verify 形態で起動したハーネスに対し、模擬形式のトークン（`mock.*`）での /register が拒否されることを試験ランナーが確認します（模擬認証が実配置で効いていないことの、振る舞いによる確認）
- 実 Worker 自体への local-mock の適用は運用側で禁じる前提です（対象照合は計画 手順0、配置はこのマニフェストで形態を verify に固定する）

### テーブル（すべて `mtrial_*`、DO の SQLite storage）

- `mtrial_credentials`（subject_hash 主キー、created_at）
- `mtrial_completion`（単一行： env_id・subject_hash・registered_at）
- `mtrial_recovery`（env_id・old_subject_hash・new_subject_hash・recovered_at）
- `mtrial_sessions`（session id の **ハッシュ**、subject_hash、CSRF トークン、created_at、expires_at）
- `mtrial_pending_nonce`（nonce、expires_at、used、認証試行コンテキストのハッシュ `ctx_hash`）
- `mtrial_meta`（boot_count など）

### 識別子の記録（計画 第2節）

- 生の sub は保存しません。sub の **SHA-256 ハッシュ** を対象識別子として記録します。導出が決定的なため、提示された sub を同じ方法で変換すれば事後照合ができます（塩を削除した HMAC とは異なります）。
- セッション ID も生値を保存せずハッシュで保持します。
- このハッシュは仮名識別子であり匿名化ではありません。

### エンドポイント

| 経路 | 内容 |
|---|---|
| `GET /nonce` | nonce を生成し認証待ち記録に保存（期限は既定5分、単回使用）して返す。あわせて認証試行コンテキスト（ランダム値）を HttpOnly Cookie `mtrial_nonce_ctx`（SameSite=Strict、Path=/、Max-Age=300）で返し、そのハッシュを nonce 記録に結び付ける |
| `POST /register` | Origin 完全一致（`http://localhost:8787`）＋ ID トークン検証（aud・iss・exp・nonce・email_verified・sub の存在）＋ 初回用シークレット照合。資格と完了記録を1トランザクションで記録。完了記録があれば 409。成功時 201 でセッション Cookie（HttpOnly、SameSite=Strict、Path=/、Max-Age=1800）と CSRF トークンを発行 |
| `POST /login` | 登録済み subject の再ログイン（追加エンドポイント。下記「仕様への追加」参照） |
| `POST /operate` | セッション Cookie と X-CSRF ヘッダーを要求し、毎回現在の資格（セッションの subject が credentials に現存すること・有効期限・CSRF 一致）を照合 |
| `POST /recover` | Origin 照合 ＋ 新しい ID トークンの検証（nonce 含む）＋ 復旧キー照合。旧資格の失効・新資格の付与・復旧記録（env_id を含む）・旧 subject のセッション削除を同一の原子的更新で実施。完了記録は初代登録の履歴として更新しない。成功時 201 で新セッションを発行 |
| `POST /admin/restart` | 試験用フック。tier=local-mock でのみ有効で、`X-Restart-Key` が env RESTART_KEY と一致する場合に例外を投げて再起動を強制する（下記「既知の制約」参照）。tier=verify では経路自体を無効化（404） |
| `GET /test/state` / `GET /test/boot` | 診断用読み取り。tier=local-mock かつ `ALLOW_TEST_HOOKS=1` かつ `DIAG_KEY` ヘッダーの照合が必須（不一致・欠落は 403、tier=verify やフック無効時は 404）。応答は秘匿化済み（下記） |

- すべての応答 JSON に、受け取った Origin の値（`origin`）を含めます（計画 第3節の試験用読み取り）。
- 失敗注入: `ALLOW_TEST_HOOKS=1` かつ tier=local-mock のときだけ、ヘッダー `X-Test-Fail: register-mid` / `recover-mid` でトランザクション途中に例外を投げ、ロールバックを確認できます。

### CSRF 対策の区別（計画 第3節）

- `/register`・`/login`・`/recover`（セッション発行前の経路）の CSRF 対策は、**Origin の完全一致 ＋ nonce の認証試行コンテキスト結び付け ＋ ワンタイムな秘密・トークンの要求**です。nonce は発行したブラウザーのコンテキスト Cookie と一致しない限り使えず、別ブラウザーや別コンテキストへ持ち込んだ nonce は拒否されます。
- セッション発行後の `/operate` は、**セッションに結び付いた CSRF トークン**（X-CSRF ヘッダー）で守ります。

### 診断応答の秘匿化

`/test/state` が返すのは検証に必要な集計と記録だけです。

- 返すもの: 資格（subject_hash と作成日時）、完了記録、復旧記録、boot_count、sessions と pending_nonce の**件数**（総数・使用済み・未使用）
- 返さないもの: `mtrial_sessions` の csrf_token、未使用 nonce の値、セッション ID（ハッシュ含む）
- このため、試験ランナーの「生の sub が保存内容に現れない」確認は、秘匿化済みの診断応答に対する確認に範囲が狭まっています（以前の全表ダンプに対する確認ではありません）。あわせて、診断応答に CSRF 値・未使用 nonce の値・セッション ID が含まれないこと自体も試験項目にしています。

### 認証の差し替えと実認証ロジックの試験

- env `MOCK_AUTH=1` のとき模擬トークンを受け付けます（sub と nonce は実際に照合し、他のクレームは模擬値で満たされたものとして扱う）。
- MOCK_AUTH でない場合は tokeninfo で検証します。検証先は env `TOKENINFO_URL` で上書きできますが、**tier=local-mock でのみ有効**です（tier=verify では設定自体を拒否し、既定の Google tokeninfo だけを使います）。
- `exp` は有限の数値であることを明示的に検査します（fail-closed）。数値または数値として解釈できる文字列は受理しますが、非数値文字列・NaN・Infinity・null・欠落はすべて拒否します。単なる `Number(exp) <= now` の比較では、非数値が NaN となって拒否条件をすり抜けるためです。
- 試験ランナーはローカルに偽 tokeninfo サーバーを立て、`TOKENINFO_URL` を向けて実認証ロジックを確認します: 正しいクレームで登録できること、aud 不一致・exp 切れ・exp の非数値文字列／null／Infinity 文字列・email_verified=false・sub 欠落で拒否されること、`GOOGLE_CLIENT_ID` 未設定では tokeninfo に届く前に（リクエスト件数が増えないことで）拒否されること。

### env 一覧

`DEPLOYMENT_TIER`（`local-mock` / `verify`、**明示指定が必須**。未設定・空・想定外は全経路を拒否）、`MOCK_AUTH`、`ALLOW_TEST_HOOKS`、`DIAG_KEY`（診断経路の鍵）、`BOOTSTRAP_SECRET`（初回用シークレット）、`RECOVERY_KEY`、`RESTART_KEY`、`ENV_ID`（完了・復旧記録の対象環境識別子）、`NONCE_TTL_SECONDS`（既定 300）、`GOOGLE_CLIENT_ID`（非 MOCK 時の aud 照合に必須）、`TOKENINFO_URL`（local-mock でのみ有効な検証先の上書き）。値はすべてダミーです。

### 仕様への追加（判断の記録）

- `POST /login` を追加しました。手順5は「復旧後に両アカウントで再ログインし事後照合する」ことを求めますが、/register は一回性（完了後は 409）を保つ必要があるため、登録済み subject 専用の再ログイン経路を分けました。ログイン可否の正本は「現在の資格」（`mtrial_credentials`）であり、提示された subject が現在の資格に現存する場合のみセッションを発行します。完了記録は初代登録の履歴として不変に保ち、ログイン判定には使いません（復旧後、完了記録は初代のまま、現在の資格だけが新 subject に切り替わります）。

## 実ログイン画面（public/login-real.html）と PC 側の実行構成

- Google Identity Services（`https://accounts.google.com/gsi/client`）を読み込みます。検証用 OAuth クライアント ID はプレースホルダ定数で、実値は提供サーバーがメモリ上で差し込みます（ファイル自体は書き換えません）。
- 流れ: Worker の /nonce（中継経由）で nonce とコンテキスト Cookie を取得 → その nonce で GIS を初期化 → コールバックの ID トークンを、初回用シークレット（登録）や復旧キー（復旧）とともに同一生成元（`http://localhost:8787`）の固定パスへ POST します。/login（再ログイン）にも対応します。
- 秘匿の扱い: シークレット類は password 型の入力欄に入れ、送信後に値を消去します。CSRF トークンと ID トークンはメモリー内にだけ保持し、画面のログ領域には成否と HTTP 状態だけを表示します。転送先は同一生成元の固定パスで、URL を入力・変更できる欄はありません。

### PC 側の実行構成（実試験）

1. 中継（`relay/worker.js`）を wrangler dev で起動し、検証用 Worker への remote service binding 経由で要求が届くようにします（接続先のサービス名は手順0で照合します）。この中継が `tools/serve-real.mjs` の転送先（`RELAY_URL`）になります
2. `GOOGLE_CLIENT_ID=<検証用 OAuth クライアント ID> RELAY_URL=<中継の URL> node tools/serve-real.mjs` で提供サーバーを起動します。提供サーバーは **127.0.0.1 のみ**にバインドし（0.0.0.0 は使いません）、画面（`GET /`）と API 経路（`/nonce`・`/register`・`/login`・`/recover`・`/operate` の中継への素通し転送）を同一生成元 `http://localhost:8787` で提供します。これにより、ブラウザーから見た生成元が OAuth クライアントの登録済み生成元と一致し、Origin と Cookie がそのまま検証用 Worker まで届きます
3. 提供サーバーのログにはメソッド・パス・応答状態だけを出します（ヘッダー・ボディ・クエリの値は出しません）。クライアント ID 未設定では起動時にエラーで終了します
4. `tools/serve-login.mjs` は模擬専用で、実試験では使いません（配信する画面自体が模擬版です）

### RELAY_URL の制限（serve-real）

`tools/serve-real.mjs` は ID トークン・復旧キー・Cookie を `RELAY_URL` の宛先へ転送するため、宛先を同一マシン内のローカル中継だけに制限します。誤指定や外部 URL による機密転送を防ぐのが目的です。

- 起動時に `RELAY_URL` を検証し、許可条件を満たさなければ理由を表示して終了コード 1 で終了します（理由にもログにも URL の値自体は出しません）。既定値 `http://127.0.0.1:8798` は検証を通過します
- 許可条件: scheme は **http のみ**（同一マシン内のローカル中継が前提です。https はループバック宛てでも TLS の終端先がこのサーバーからは確認できないため許可しません）、ホストは**明示されたループバックアドレスのみ**（`127.0.0.1` / `::1` / `localhost`）、**ポート番号の明示必須**、ユーザー情報（`user:pass@`）なし、パスは空か `/` のみ、クエリ・フラグメントなし
- 転送時はリダイレクトを追従しません（fetch の `redirect: "manual"`）。中継先が 3xx を返した場合は追従せず、クライアントへ 502 エラーとして返します（3xx 自体をそのまま返すとブラウザーが Location へ進み得るため、状態はログにだけ残します）
- 試験ランナーは負例を確認します: 外部 URL（`https://example.com`）、非ループバック IP、ポート欠落、ユーザー情報つき URL を指定すると子プロセスが起動を拒否すること、偽の中継先が 302 を返す場合に Location 先へ到達しないこと

## 試験の実行方法

```sh
cd ~/workspace/stage1-harness
npm install   # 初回のみ（miniflare）
npm test      # = node test/run.mjs
```

- 冒頭に実行環境（OS・Node バージョン・Miniflare バージョン）を出力します。環境差で再現条件が異なる場合の切り分け用です。
- 項目ごとに `PASS` / `FAIL` を出力し、FAIL があれば終了コード 1 を返します。状態変更要求で接続レベルの例外が起きた場合は、FAIL と区別する専用表記 `UNKNOWN（結果不明・再送せず）` で出力し、やはり終了コード 1 を返します（下記「再試行ポリシー」参照）。

### 再試行ポリシー

接続レベルの例外（`fetch failed`／ECONNRESET 等）への再試行は、**冪等な読み取りだけ**に限定します。根拠と扱いは次のとおりです（コード内コメントにも同じ根拠を明記しています）。

- **再試行するもの**: 状態取得（秘匿化済み状態の読み取り `/test/state`）などの GET 読み取りだけです。短い間隔で最大3回まで再試行し、再試行は行ごとに出力し、最終サマリにも「再試行は読み取りのみに限定し、状態変更要求は再送していない」ことと、発生した場合の内訳（メソッド・経路・回数）を出します。HTTP 状態や応答内容の不一致は再試行しません（アサーションの失敗をごまかさないため）
- **再試行しないもの**: 状態変更を伴う要求はすべて再送しません。応答前に接続が切れた場合、サーバー側で処理が確定している可能性があり、`/register`・`/login`・`/recover`・`/operate` を再送すると 409 や重複副作用が生じ、結果の解釈もできなくなるためです。該当する要求は「結果不明（再送せず）」として記録し、サマリに件数と対象経路を出します。後続の項目が前提を欠く場合は、そのシナリオの残りを打ち切ります（無理に続けません）
- **`/nonce` 発行の扱い**: `/nonce` は GET ですが、発行は状態を作る（未使用 nonce の記録が残る）ため、冪等な読み取りとは扱わず再送しません。なお `/nonce` は同一コンテキストで複数発行しても未使用 nonce が残るだけであり、再送しても安全側に倒れる性質はあります。それでも `/register` 等と区別して例外扱いにせず、「状態を作る要求は再送しない」という一律の根拠を保つ側に倒しました
- **例外**: `/admin/restart` の「鍵一致で例外を投げる」確認だけは、接続が切れる形の例外伝播自体が期待する結果であり、呼び出し側が例外を捕まえて判定します。その呼び出しでは結果不明として記録しませんが、再送もしません
- 再試行そのものの動作（読み取りは再試行され復帰すること、状態変更と `/nonce` 発行は再送されず結果不明として記録されること）は、接続を意図的に切る偽サーバーで試験項目として確認します。この意図的な確認は項目専用の記録に分けるため、通常項目の再試行・結果不明の集計には混ざりません。再試行が発生しなかった通常実行では、結果不明の項目は 0 件です
- なお接続断の根本原因（Windows 環境で ECONNRESET 等が多発した件）は未解明のままです。再試行範囲を読み取りに限定したことで、状態変更要求に接続断が起きた実行は「結果不明」で打ち切られるようになりました。これは意図した fail-closed の挙動であり、完走しなかった実行を PASS とは数えません

- 内容: 通常登録 201 と完了記録の必須項目、再登録 409、並行登録（成功1・拒否1）、登録途中・復旧途中の失敗注入でのロールバック、誤った初回用シークレット／復旧キーの拒否、鍵単独では復旧できないこと、不正 Origin・Origin 欠落・CSRF 欠落／不一致の拒否、nonce の再利用・期限切れ・未知 nonce の拒否、nonce のコンテキスト結び付け（別コンテキスト・Cookie なしの拒否と正規の流れ）、/operate の資格照合、復旧後の旧セッション拒否・新セッション許可、旧 ID トークン拒否・新 ID トークン許可（再ログイン）、復旧記録の env_id、事後照合（ハッシュ再計算）、生の sub が診断応答に現れないこと、診断応答の秘匿化と DIAG_KEY 照合、DO 再起動（Miniflare の dispose → 同じ永続化先で再生成）後の保持と boot_count による検出、中継の素通し対照（extra）、serve-real の動作確認（画面へのクライアント ID 差し込み、経由での nonce → 登録 → 操作、ログ秘匿、RELAY_URL の起動時検証の負例4件、中継先 3xx の非追従）、再試行ポリシーの確認（意図的な接続切断: 読み取りの再試行復帰、POST /register と /nonce 発行の再送なし・結果不明記録）、実認証ロジック（偽 tokeninfo: 正常系と aud・exp 切れ・exp の非数値文字列／null／Infinity 文字列・email_verified・sub の異常系、GOOGLE_CLIENT_ID 未設定時の事前拒否）、設定検証（tier=verify の禁止事項、tier 未設定・想定外の値での全経路拒否、カナリア確認、ENV_ID 未設定時の拒否、診断経路と再起動フックの無効化）。
- 期限切れ nonce の試験は、待ち時間を避けるため `NONCE_TTL_SECONDS=0` の専用インスタンスで確認します（既定値は計画どおり 300 秒）。
- 最終確認結果: **66 件すべて PASS**（2026-11-03、最終確認として2回連続実行で確認）。実行環境: Linux、Node v24.22.1、Miniflare 4.20260730.0。この2回では結果不明は 0 件で、ハーネス本体への接続再試行は発生しませんでした（再試行・再送なしの挙動自体は、意図的な接続切断の項目で確認しています）。なお変更後の初回実行では `POST /operate` に ECONNRESET が発生し、新ポリシーどおり結果不明 1 件で打ち切られました（再送はしていません）。これは接続断の間欠性によるもので、その後の実行で 66 件すべて PASS を確認しています。

## 手動で動かす場合

```sh
node tools/serve-harness.mjs   # ハーネス http://127.0.0.1:8799（永続化先 .persist-manual/）
node tools/serve-login.mjs     # 模擬画面 http://localhost:8787/（模擬専用）
node tools/build-deploy-manifest.mjs --tier verify   # 配置用マニフェストの生成（値は含めない）

# 実画面の提供サーバー（ローカルでの動作確認用。中継の代わりにハーネスへ向ける）
GOOGLE_CLIENT_ID=<検証用 OAuth クライアント ID> RELAY_URL=http://127.0.0.1:8799 \
  node tools/serve-real.mjs    # 実画面 http://127.0.0.1:8787/
```

ブラウザーで `http://localhost:8787/` を開き、アカウントを選んで登録 → 操作 → 復旧の順に試せます（中継ひな形 `relay/worker.js` は、ローカルでは `HARNESS_URL` を指す通常 fetch 転送として試験ランナーが使います。実 binding の経路はコードのみで、ローカルでは実行しません）。

## 既知の制約（模擬層）

1. **再起動の確認方法**: ローカルの workerd/Miniflare では、DO の fetch で例外を投げてもインスタンスは破棄・再生成されません（500 が返るだけで boot_count は増えません。実測で確認）。**例外送出のみを DO の再生成（再起動）とみなしてはいけません。** 実環境での再起動は、実際のインスタンス再生成手段（デプロイや `ctx.abort` 等）で確認する必要がありますが、現時点では未確認です。模擬層では dispose → 再生成 ＋ boot_count で保持を確認しています。フック自体（tier ゲートと鍵照合と例外送出）は仕様どおり実装してあります。
2. **模擬 ID トークン**: MOCK 経路では aud・iss・exp・email_verified を検証しません（模擬値で満たされたものとして扱う）。これらのクレーム検査は、偽 tokeninfo を使う実認証ロジックの試験で確認しています。実 Google での確認は手順2以降の対象です。
3. **変形A／変形B の実経路**: このハーネスはどちらの変形でも使える形にしてありますが、実経路の測定（手順3の直接要求との対照を含む）は検証用 Worker 配置後（手順2以降）の対象で、手順1では中継の素通しをローカル fetch 転送で確認するに留めます。
