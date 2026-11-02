# 段階① フェーズ1 次期試作 手順1（ローカル模擬）の記録（2026-11-02）

対象計画： `docs/stage1-next-prototype-plan.md` v0.2 の手順1。すべて Muse の実行環境内のローカル模擬（Miniflare）であり、実 Google・実 Cloudflare には接続していない。模擬 ID トークンとダミーのシークレットのみを使用した。結果は模擬層のものであり、実環境の実証ではない。

## 作成物（Muse の作業領域に保持。GitHub へは未コミット）

- ハーネス Worker： fetch ハンドラ＋ Durable Object `VerificationDO`（SQLite storage、transactionSync）。テーブルは `mtrial_credentials / mtrial_completion / mtrial_recovery / mtrial_sessions / mtrial_pending_nonce / mtrial_meta`
- ログイン画面（`http://localhost:8787` で配信する想定の静的 HTML。実 GIS ライブラリは読み込まない模擬 UI）
- 変形B用の中継ひな形（service binding への素通し。ローカル試験では通常の fetch 転送に切り替え可能）
- 試験ランナー（Miniflare をプログラムから起動し、全項目を自動確認）

## 実装上の決定

- 識別子は計画第2節どおり、生の sub を保存せず SHA-256 ハッシュで記録する。セッション ID もハッシュで保持する
- nonce は単回使用・期限5分とし、消費は登録・復旧のトランザクション内で原子的に行う（失敗時は消費もロールバックされる）
- /register・/login・/operate・/recover はすべて Origin の完全一致（`http://localhost:8787`）を要求し、応答には受け取った Origin を含める。Cookie は HttpOnly・SameSite=Strict・Path=/・Max-Age=1800
- 失敗注入（`X-Test-Fail: register-mid / recover-mid`）は `ALLOW_TEST_HOOKS=1` のときだけ有効
- 追加した経路： `POST /login`。手順5の「復旧後の再ログイン」を担うため、/register の一回性（完了後は 409）を保ったまま、完了記録の subject 本人だけがセッションを再発行できる経路を新設した。試作の範囲内の追加であり、本番方式への提案ではない

## 試験結果（全29件 PASS、複数回実行で再現）

- 登録： 誤った初回用シークレットで 403・状態不変／不正 Origin・Origin 欠落で拒否・状態不変／通常登録 201 で完了記録に env_id・subject_hash・registered_at がそろう／再登録 409／並行登録で成功1・拒否1／登録途中の失敗注入で資格も完了記録も残らない
- セッションと操作： /operate が有効セッションで 200／CSRF 欠落・不一致で 403／不正 Origin で 403／nonce の再利用・未知の nonce・期限切れ nonce が拒否される
- 復旧： 誤った復旧キーで 403・旧資格維持／復旧キーだけ・ID トークンだけでは復旧できない／復旧途中の失敗注入で旧資格が維持され新資格が付かない／正常な復旧で復旧記録に旧新の対応と日時が残る／復旧前の旧セッションが 403・新セッションが 200／再ログインで旧 ID トークン拒否・新 ID トークン許可
- 記録： 事後照合（両アカウントの sub を SHA-256 化して再計算し、完了記録・復旧記録と一致）／生の sub が DO の保存内容のどこにも現れない
- 中継： 中継経由でも Origin が素通しされ応答に含まれる／Cookie・CSRF・Origin 素通しで /operate 200
- 再起動： dispose → 同じ永続化先で再生成した後も資格状態・再登録拒否・旧セッション拒否が維持され、boot_count の変化で再起動を検出できる

## 制約（1件）

`/admin/restart`（鍵照合のうえで DO 内に例外を投げて再起動を強制する試験用フック）は、ローカルの workerd／Miniflare では再現できなかった。例外を投げても 500 が返るだけでインスタンスは再生成されず、boot_count も増えない。フック自体（鍵不一致 403・一致時の例外送出）は実装・確認済みであり、再起動後の保持は dispose → 再生成方式で確認した。実 Cloudflare の DO で例外時に再起動するかは、実環境の手順6で確認する（前回試作で Codex が実 DO の意図的な再起動を行った実績がある）。

## 次の段階

手順2以降（検証用 Worker への配置）は、計画 v0.2 の再確認と、変形A／変形B の開発者の判断を経てから開始する。ハーネスのコードは Muse の作業領域にあり、Codex がコード自体の確認を希望する場合はこのリポジトリへ置く。
