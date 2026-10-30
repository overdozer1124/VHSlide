# 0.38.0 検証証跡（2026-10-24）

Linux・Node 24・ローカルChromiumによる検証。touchプロジェクトもChromiumで、実iPad/Safari・Chromebookではない。機能試験では本番API・公開ルームを使用していない。公開後の読み取り確認は`deploy-verification.json`に区別して記録する。

- `unit-node.log`：単体テストとNode API。
- `build.log`：型検査・本番ビルド。500kB超のチャンク警告あり。
- `cloudflare-api.log`：Cloudflare型検査・dry-run・MiniflareのAPI/障害注入。dry-runはデプロイではない。ログ中のクライアントIDは公開OAuth識別子。
- `local-browser-full.log`：本番プレビューでの全体試験（176件）。
- `local-browser-final-targeted.log`：最終追加・修正箇所の試験（22件）。全体試験との重複を含む。
- `node-browser.log`、`cloudflare-browser.log`：認証付きの独立したテストサーバーで実行する共同編集試験。
- `purge-regression-before.log`：完全削除の部分失敗で復帰が200になった修正前の再現。
- `purge-regression-after.log`：永続的な削除開始状態を追加した後の回帰試験。
- `comparison.pdf`、`pdf-preview.png`、`pdf-text.txt`：新しいPDF準備画面からの2ページ出力・描画・文字抽出。印刷設定はブラウザー依存。
- `source-sha256.txt`：今回の5機能に関係するソース・設定・テストの検証時点のハッシュ。過去バージョンの未コミット変更も含むため、Git HEADだけを検証対象とみなさない。

実行コマンド・合否・保証範囲は[機能説明](../../learning-tools.md)を参照。各ログは一回の実行を表し、重複試験を足して機能数や検証網羅率に換算しない。単体画面のクラウド設定API接続拒否はオフライン用試験構成のログ。

利用者の公開指示によるデプロイ記録：`deploy.log`、`deploy-verification.json`。2026-10-24、Cloudflare Version ID `549dda9e-2d4a-4b7a-bc0b-7570b9e43f42`。作品データの変更は行っていない。
