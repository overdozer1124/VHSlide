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
- 生成イラストの圧縮（`scripts/prep-image.mjs`）：Python の Pillow。挿絵を使わない場合は不要
- 挿絵の生成：その環境の画像生成機能（Muse の画像生成など）。なくても、挿絵なしで作れる
- SKILL.md の「利用者の保存済みの好み」（背景・挿絵の初期値）は配布元の設定。そのまま使うか、使う人の好みに書き換える

## 環境の用意は Muse 側が行う（初回セットアップ）
受け取った Muse は、初回に `scripts/setup.mjs` で環境をチェックし、足りないもの（cairosvg・Pillow、Node.js が無い場合はポータブル版 Node）があれば、利用者の承認を得てからスキル内のフォルダに閉じて用意する。利用者が自分でインストール作業をする必要はない。詳しい手順は SKILL.md の「初回セットアップ」。
