# 招待承認の検証記録（2026-10-24）

[設計・使い方・検証](../../invitation-approval.md)。実生徒・本番ルームは使わず、架空のアカウント、Nodeの一時SQLite、Miniflareの一時Durable Objects、独立したChromiumで試験。

- `unit-node.log`：共通の状態管理・一括処理・有効期限の単体試験とNode APIの回帰試験。
- `cloudflare-tests.log`：型検査・dry-runとCloudflare API・障害復旧の回帰試験。dry-runはデプロイではない。
- `node-browser-full.log` / `cloudflare-browser-full.log`：既存共同編集と新しい個別／選択／全選択承認・再申請のブラウザー試験。
- `node-browser-final.log` / `cloudflare-browser-final.log`：最後の待機画面の非同期応答処理を含む、最終ビルドの重点試験。
- `privacy-api.log` / `privacy-browser.log`：以前の監査スクリプトを承認後の仕様へ更新して実行。招待だけでの参加・共有解除後の自動再参加は拒否することを確認。他の監査事項を今回すべて修正したという意味ではない。
- `build.log`：本番ビルドとNode型検査。500kB超のJSチャンク警告は残る。
- `host-requests.png` / `student-waiting.png` / `library-request-count.png`：ローカルの架空の児童A/B/Cによる画面例。`example.test`と合成データを使用。`visual-check.json`に表示チェックを記録。
- `source-sha256.txt`：最終検証対象のファイルのハッシュ。

実Chromebook・iPad/SafariではなくLinux Chromium。実Google認証やOAuth同意画面を変更した検証でもない。本番デプロイは別途必要。
