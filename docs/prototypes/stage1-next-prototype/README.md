# 段階①フェーズ1 次期独立試作ハーネス（手順1・ローカル模擬）

実施計画 v0.2（`~/workspace/vhslide-stage1-next-prototype-plan.md`）の **手順1（ローカル模擬）** の成果物です。

> **これは模擬層です。** すべてこの VM 内のローカル作業で、実 Google・実 Cloudflare には一切接続しません。ID トークンは模擬値（`mock.<sub>.<nonce>`）、シークレットはすべてダミー値を使います。ここでの結果は「模擬層での確認」であり、実経路（手順2以降）の実証ではありません。

## ファイル構成と計画 v0.2 との対応

| ファイル | 役割 | 計画の対応箇所 |
|---|---|---|
| `src/worker.js` | ハーネス本体。fetch ハンドラ＋ Durable Object クラス `VerificationDO`（SQLite storage、`transactionSync` 使用）。テーブルは接頭辞 `mtrial_*` | 第3節（構成・Origin/CSRF/Cookie・nonce・原子性）、第2節（識別子の記録方法） |
| `public/login.html` | ログイン画面（静的 HTML）。nonce 取得 → GIS 風の模擬ログイン（sub を選んで模擬トークンを組み立てる）→ /register 送信、結果と CSRF トークンを表示。実 GIS ライブラリは読み込まない | 第3節（ログイン画面を localhost に置く形） |
| `relay/worker.js` | PC 側中継のひな形（変形B用）。受けた要求のヘッダー（Origin・Cookie）を変更せず、検証用 Worker への service binding 呼び出しへ素通しする | 第3節（中継：素通し・アプリケーションレベルの拒否をしない） |
| `relay/wrangler.toml.example` | 中継の設定例（変形Bの service binding／ローカル模擬の HARNESS_URL） | 第3節（変形B） |
| `tools/serve-login.mjs` | ログイン画面を `http://localhost:8787` で配信し、それ以外の経路をハーネスへ素通しする小さなサーバー | 手順1（ローカルで画面を動かすため） |
| `tools/serve-harness.mjs` | ハーネスを固定ポート 8799 で起動する手動確認用ランチャー（Miniflare） | 手順1 |
| `test/run.mjs` | 試験ランナー。Miniflare をプログラムから起動し、手順3〜6の項目＋中継の対照を自動確認する | 第6節 手順3〜6 |
| `package.json` | 依存（miniflare のみ）と `npm test` の定義 | ― |

## ハーネスの仕様

### テーブル（すべて `mtrial_*`、DO の SQLite storage）

- `mtrial_credentials`（subject_hash 主キー、created_at）
- `mtrial_completion`（単一行： env_id・subject_hash・registered_at）
- `mtrial_recovery`（old_subject_hash・new_subject_hash・recovered_at）
- `mtrial_sessions`（session id の **ハッシュ**、subject_hash、CSRF トークン、created_at、expires_at）
- `mtrial_pending_nonce`（nonce、expires_at、used）
- `mtrial_meta`（boot_count など）

### 識別子の記録（計画 第2節）

- 生の sub は保存しません。sub の **SHA-256 ハッシュ** を対象識別子として記録します。導出が決定的なため、提示された sub を同じ方法で変換すれば事後照合ができます（塩を削除した HMAC とは異なります）。
- セッション ID も生値を保存せずハッシュで保持します。
- このハッシュは仮名識別子であり匿名化ではありません。

### エンドポイント

| 経路 | 内容 |
|---|---|
| `GET /nonce` | nonce を生成し認証待ち記録に保存（期限は既定5分、単回使用）して返す |
| `POST /register` | Origin 完全一致（`http://localhost:8787`）＋ ID トークン検証（aud・iss・exp・nonce・email_verified・sub の存在）＋ 初回用シークレット照合。資格と完了記録を1トランザクションで記録。完了記録があれば 409。成功時 201 でセッション Cookie（HttpOnly、SameSite=Strict、Path=/、Max-Age=1800）と CSRF トークンを発行 |
| `POST /login` | 登録済み subject の再ログイン（追加エンドポイント。下記「仕様への追加」参照） |
| `POST /operate` | セッション Cookie と X-CSRF ヘッダーを要求し、毎回現在の資格（セッションの subject が credentials に現存すること・有効期限・CSRF 一致）を照合 |
| `POST /recover` | Origin 照合 ＋ 新しい ID トークンの検証（nonce 含む）＋ 復旧キー照合。旧資格の失効・新資格の付与・復旧記録・旧 subject のセッション削除を同一の原子的更新で実施。完了記録は初代登録の履歴として更新しない。成功時 201 で新セッションを発行 |
| `POST /admin/restart` | 試験用フック。`X-Restart-Key` が env RESTART_KEY と一致する場合のみ例外を投げて再起動を強制する（下記「既知の制約」参照） |
| `GET /test/state` / `GET /test/boot` | 試験用読み取り（`ALLOW_TEST_HOOKS=1` のときのみ） |

- すべての応答 JSON に、受け取った Origin の値（`origin`）を含めます（計画 第3節の試験用読み取り）。
- 失敗注入: `ALLOW_TEST_HOOKS=1` のときだけ、ヘッダー `X-Test-Fail: register-mid` / `recover-mid` でトランザクション途中に例外を投げ、ロールバックを確認できます。
- 認証の差し替え: env `MOCK_AUTH=1` のとき模擬トークンを受け付けます（aud・iss・exp・email_verified は模擬値で満たされたものとし、sub と nonce は実際に照合）。MOCK_AUTH でない場合は Google tokeninfo で検証する経路を用意してありますが、ローカル試験では使いません。
- env: `BOOTSTRAP_SECRET`（初回用シークレット）、`RECOVERY_KEY`、`RESTART_KEY`、`ENV_ID`（完了記録の対象環境識別子）、`NONCE_TTL_SECONDS`（既定 300）、`GOOGLE_CLIENT_ID`（実経路用、ローカルでは未使用）。値はすべてダミーです。

### 仕様への追加（判断の記録）

- `POST /login` を追加しました。手順5は「復旧後に両アカウントで再ログインし事後照合する」ことを求めますが、/register は一回性（完了後は 409）を保つ必要があるため、登録済み subject 専用の再ログイン経路を分けました。ログイン可否の正本は「現在の資格」（`mtrial_credentials`）であり、提示された subject が現在の資格に現存する場合のみセッションを発行します。完了記録は初代登録の履歴として不変に保ち、ログイン判定には使いません（復旧後、完了記録は初代のまま、現在の資格だけが新 subject に切り替わります）。

## 試験の実行方法

```sh
cd ~/workspace/stage1-harness
npm install   # 初回のみ（miniflare）
npm test      # = node test/run.mjs
```

- 項目ごとに `PASS` / `FAIL` を出力し、FAIL があれば終了コード 1 を返します。
- 内容: 通常登録 201 と完了記録の必須項目、再登録 409、並行登録（成功1・拒否1）、登録途中・復旧途中の失敗注入でのロールバック、誤った初回用シークレット／復旧キーの拒否、鍵単独では復旧できないこと、不正 Origin・Origin 欠落・CSRF 欠落／不一致の拒否、nonce の再利用・期限切れ・未知 nonce の拒否、/operate の資格照合、復旧後の旧セッション拒否・新セッション許可、旧 ID トークン拒否・新 ID トークン許可（再ログイン）、事後照合（ハッシュ再計算）、生の sub が保存内容に現れないこと、DO 再起動（Miniflare の dispose → 同じ永続化先で再生成）後の保持と boot_count による検出、中継の素通し対照（extra）。
- 期限切れ nonce の試験は、待ち時間を避けるため `NONCE_TTL_SECONDS=0` の専用インスタンスで確認します（既定値は計画どおり 300 秒）。
- 最終確認結果: **29 件すべて PASS**（2026-11-02、2回連続実行で再現）。

## 手動で動かす場合

```sh
node tools/serve-harness.mjs   # ハーネス http://127.0.0.1:8799（永続化先 .persist-manual/）
node tools/serve-login.mjs     # ログイン画面 http://localhost:8787/
```

ブラウザーで `http://localhost:8787/` を開き、アカウントを選んで登録 → 操作 → 復旧の順に試せます（中継ひな形 `relay/worker.js` は、ローカルでは `HARNESS_URL` を指す通常 fetch 転送として試験ランナーが使います。実 binding の経路はコードのみで、ローカルでは実行しません）。

## 既知の制約（模擬層）

1. **/admin/restart の再起動強制**: ローカルの workerd/Miniflare では、DO の fetch で例外を投げてもインスタンスは破棄・再生成されません（500 が返るだけで boot_count は増えません。実測で確認）。本番 Cloudflare では例外時に DO は再起動する想定ですが、模擬層では再現できないため、再起動の検出は dispose → 再生成 ＋ boot_count で確認しています。フック自体（鍵照合と例外送出）は仕様どおり実装してあります。
2. **模擬 ID トークン**: aud・iss・exp・email_verified は検証しません（模擬値で満たされたものとして扱う）。実経路の検証は手順2以降の対象です。
3. **変形A／変形B の実経路**: このハーネスはどちらの変形でも使える形にしてありますが、実経路の測定（手順3の直接要求との対照を含む）は検証用 Worker 配置後（手順2以降）の対象で、手順1では中継の素通しをローカル fetch 転送で確認するに留めます。
