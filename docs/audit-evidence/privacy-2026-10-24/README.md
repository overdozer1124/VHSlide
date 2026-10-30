# 個人情報監査の証跡（2026-10-24）

[報告書](../../privacy-security-audit-2026-10-24.md)。実在する生徒の情報を使用せず、Nodeの一時SQLite、Miniflareの一時Room/Directory、独立したChromiumプロファイルで試験した。監査用のアプリ改修・デプロイはない。

- `api-observations.json` / `api-audit.log`：両バックエンドで28件の観察。7種類のリスクを各バックエンドで再現し、防御・暫定対策も記録した。スクリプト成功はリスクがないという判定ではない。
- `browser-observations.json` / `browser-audit.log`：ログアウト後の残存キャッシュ、次アカウントからの端末内読み取り、オフライン終了拒否、閲覧専用でのJSON保存等。実Googleサインインではなく架空のローカル認証を利用。
- `unit-node.log`：既存の単体87件・Node API14件。
- `cloudflare-tests.log`：型検査・dry-run、既存Cloudflare19件。dry-runは公開ではない。
- `dependency-audit.json`：`npm audit --omit=dev --json`の取得結果。
- `public-anonymous-check.json`：公開サイトの個人情報を含まない読み取りのみ。トップ・匿名セッション・未認証作品一覧と、公開JSがローカルビルドに一致することを確認。共有ルームへのアクセスはない。
- `source-sha256.txt`：監査対象と監査スクリプト・報告書のハッシュ。

再現：本番用の接続情報は不要。既存の依存をインストール・ビルド後、`npm run cf:check`でテスト用bundleを作り、`node tests/audit/privacy-audit.ts`、`node tests/audit/privacy-browser.ts`を実行する。後者は`/usr/bin/chromium`とローカルポート3188を使用。結果は`/tmp/vhslide-privacy-*.json`等へ保存する。`tests/audit/fixtures/privacy-photo.jpg`は2×2px、架空のArtist値とダミーGPSを持つ合成画像で、個人の写真ではない。

NodeのID検証器やCloudflareの署名鍵はテスト環境だけのもの。本番のOAuth同意画面、学校の実アカウント制限、実機の消去挙動、Google/Cloudflareの契約・ログ・保存地域を確認した試験ではない。
