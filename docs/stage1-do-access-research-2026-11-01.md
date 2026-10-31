# 段階① Durable Objects運営経路の読取調査（2026-11-01）

- [Cloudflare Durable Objects Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/) はSQLite型DOの保存データをダッシュボードから閲覧・書き込みできると説明している。WorkerへのEditor以上の権限と対象DO識別子が必要であり、案Bの運営経路候補として調査できる。
- 同資料では、Queryタブで複数SQL文を実行する際、各文は別のDOリクエストとして送信される。初代登録と完了フラグの原子性・並行防止・復旧が満たせることは未確認。実データに接続していない。
- [DO環境の公式資料](https://developers.cloudflare.com/durable-objects/reference/environments/)はローカル開発を独立したローカル環境と説明している。ローカル試作は実Cloudflareへの運営経路の実証ではない。
- これらは公式文書の読取調査である。案Bの採用・対象環境の独立照合・安全な運用復旧手順はいずれも未確定。実Cloudflareへの書込み・本番アクセスは行っていない。
