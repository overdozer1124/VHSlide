# 編集UI/UX 0.43.1 検証資料

ローカルのテスト作品のみ。公開ルームの読み書きなし。本番へのデプロイなし。実Chromebook／iPad Safari／Windowsタッチパッド未検証。

- `build.log`：最終の型検査・Viteビルド。既存チャンク警告あり。
- `unit-node.log`：単体119件、Node API16件合格。
- `browser-regressions.log`：9ファイル、desktop／タッチ、72合格・対象外16スキップ。
- `node-cloud-browser.log` / `cloudflare-cloud-browser.log`：各8件合格。文字・セル・画像・図形・グラフ・表・権限・本人Undo・ZIP復元。
- `final-ux-browser.log`：タッチの範囲選択ボタンへの44px指定を確実にした最終CSSで、UI専用8件を再実行して合格。前の72件に含まれる8件の再実行であり、異なる8件ではない。
- `desktop-*.png` / `touch-*.png`：最終ビルドの試験で取得した画面。
- `manifest.json`：環境と対象ファイルのSHA-256。

静的画面は `playwright.preview.config.ts` でworkers=1。対象は `app` / `content-editing` / `editor-inspector-ux` / `object-editing` / `structure-editing` / `element-stacking` / `element-border-drag` / `tables` / `editor-swipe`。最終CSS後は `editor-inspector-ux` のみ再実行。共同編集はNode・Cloudflare各設定で `tests/cloud/{content-editing,objects,structure-editing,tables}.spec.ts`。全ブラウザテストの一括実行ではない。
