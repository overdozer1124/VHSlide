# 個人用スキルとして使う

## claude.ai（チャット）
1. `vhslide-lesson.zip` を用意する（VHSlide リポジトリで `bash .claude/skills/vhslide-lesson/package.sh` を実行すると作れる）。
2. claude.ai の「設定 → 機能（Capabilities）」で「コード実行とファイル作成」を有効にし、「スキル」から zip をアップロードする。
3. チャットで指導書の画像やPDFを添えて「この指導書から授業スライドを作って」と頼む。

claude.ai では VHSlide 本体に接続できないため、同梱の検査処理（VHSlide の読み込み処理を同梱したもの）で検証し、画面の撮影は省略する。

## Claude Code（自分のパソコン）
```bash
mkdir -p ~/.claude/skills && cp -r vhslide-lesson ~/.claude/skills/
```
どのフォルダで Claude Code を開いても使える。GitHub の VHSlide リポジトリを取得できる場合は、最新版のアプリで読み込み検査と全ページの撮影まで行う（初回は取得と準備に数分）。取得先は `VHSLIDE_REPO`（手元のチェックアウト）または `VHSLIDE_GIT_URL` で変えられる。

## 必要なもの
- Node.js 18 以上（必須）
- 図の PNG 化：Chromium（Playwright）、`rsvg-convert`、Python の `cairosvg` のいずれか（なくてもキャラクターは同梱画像で入る）
