# 手順4（初代登録 A群）置き場

作成: Cursor（2026-11-16）。実施計画 §2 の A＋C。主体は生の sub を保存する（所有者判断）。監査は同一トランザクションで必須。

## 分離

| もの           | 置き場                                 | 認可                                                             |
| -------------- | -------------------------------------- | ---------------------------------------------------------------- |
| 運営者登録簿   | `stage1_operators.subject`（生の sub） | 製品セッションでは操作できない                                   |
| スーパー管理者 | `users.is_super_admin`                 | 運営者登録簿にいる主体の新しい ID トークンだけが付与・復旧できる |
| 初代の履歴     | `stage1_super_admin_registration`      | 環境ごとに1件。復旧では書き換えない                              |
| 復旧の履歴     | `stage1_super_admin_recovery`          | 追加のみ                                                         |

## 経路

1. プラットフォーム経路（初期投入／全面復旧）は `applyPlatformApproval`。通常の Worker（`cloudflare/index.ts`）は `/platform/apply` と `/admin/*` を先に受けて 404 を返す。一時版だけが `cloudflare/platform-temporary.ts` から `POST /platform/apply` を通し、`applyPlatformApproval` を Directory の `transactionSync` の中で呼ぶ。設定は `wrangler.stage1-platform-temporary.jsonc`。アップロードは `wrangler versions upload` のみで、有効化はしない。使い捨ての値と初代の主体は設定ファイルに書かず、版のシークレットとして渡す。
2. 常設のアプリ内ルートは `STAGE1_FEATURES` が有効なときだけ。`POST /api/stage1/operators/nonce` のあと、ID トークンの nonce と `vhslide_admin_ctx` を消費する。
   - `.../operators/verify|add|revoke|rotate`
   - `.../super-admin/bind|recover`
3. 登録簿が空の間は、アプリ内ルートは運営者不在で拒否する。初代運営者はプラットフォーム経路でしか入れない。失効は対象の不在を先に 404 とし、いるのが最後の1人のときだけ 409 にする。ローテーションで新しい主体が既に登録簿にいるとき（旧と新が同じ場合を含む）は 409 にする。
4. 移行 ID は `stage1_operator_v1`。起動時に手順1のあとで冪等適用する。

## まだ載せていないもの

- 一時版の有効化と、検証 Worker 上での初代運営者の実投入（所有者の個別承認のあと）。送信ページのひな型は `cloudflare/stage1-bootstrap-page.html`。一時値はアップロード時だけ差し込み、リポジトリには置かない。
- 運営ルートの画面
- 本番 `vhslide` への有効化
