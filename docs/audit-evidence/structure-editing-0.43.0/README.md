# 0.43.0 検証記録

ローカルのみ。公開ルームへアクセスせず、本番デプロイなし。実機検証なし。

- `build.log`：最終本番ビルド成功（チャンクサイズ警告あり）。
- `unit-node.log`：単体119件・Node16件成功。
- `structure-unit.log`：指定ページ権限の拒否・許可を明示した新規8件の最終実行。
- `cloudflare-api-and-faults.log`：ローカルCloudflare API21件と障害A・B・C。
- `node-cloud-browser.log` / `cloudflare-cloud-browser.log`：各2件成功。テスト専用認証・独立作品。
- `local-browser-regressions.log`：54成功・対象外14スキップ。新機能12件を含む。
- `palette-*.png` / `chart-*.pdf`：各プロジェクトの生成物。
- `chart-pdf-preview.png`：desktop PDFの1ページ目を変換し目視確認。
- `types.log`：最終型検査（npmの更新通知以外に診断なし）。
- `manifest.json`：バージョン・代替試験環境と主な検証対象ファイルのSHA-256。

ブラウザ試験は `playwright.preview.config.ts` のproduction previewに対し、structure-editing / object-editing / content-editing / element-border-drag / element-stacking / tables / editor-swipe の7ファイルをworkers=1で実行。Node・Cloudflareの共同編集は各設定で `tests/cloud/structure-editing.spec.ts` を実行。Cloudflare APIは `XDG_CONFIG_HOME=/tmp/vhslide-config WRANGLER_LOG_PATH=/tmp/vhslide-wrangler.log npm run test:cloudflare`。dry-runでありデプロイではない。
