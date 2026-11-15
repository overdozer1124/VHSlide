# 手順1（移行 C4・C5）メモ

作成: Cursor（2026-11-16）。根拠: 実施計画 §3・§4、実装設計書 §2.2–2.4。検証環境向けの下書き。本番有効化は含まない。

## 変更内容

- 共有モジュール `src/stage1OrgSchema.ts`
  - 追加テーブル: `organizations` / `preregistrations` / `organization_members` / `school_admin_applications` / `audit_log` / `schema_migrations`
  - `users.is_super_admin`（DEFAULT 0）を冪等に追加
  - 移行ID: `stage1_org_v1`（`schema_migrations` に記録）
- `audit_log` は計画 §6 で所有者が「必須」と判断済みのため、空テーブルとして手順1に含める（書き込みは手順2）
- Node `server/app.ts` と Cloudflare `cloudflare/directory.ts` の両方で起動時に適用
- `INSERT INTO users` / `INSERT INTO decks` を列名指定へ変更（列追加で壊れないようにする）
- 参加者向けの `SELECT users.*` を `users.id, users.name, users.email` に変更（内部フラグ非混入）

## 再実行・復旧

- 再実行: `CREATE IF NOT EXISTS` + 列欠落時のみ `ALTER` + 移行行は `INSERT OR IGNORE`。データ行は書き換えない
- 復旧: 追加テーブルを FK 順に `DROP`、`users.is_super_admin` を `DROP COLUMN`（SQLite 3.35+）、`schema_migrations` から当該IDを削除。既存の users／decks／sessions は手を付けない

## 未実施（意図的）

- 学校機能の有効化フラグ・API・UI
- decks への `organization_id` / `space_id` 等（段階②）
- `organization_members` の世代番号（無効化波及の実装時）
- 検証環境への実デプロイと移行直後の回帰（D群の本試験は手順5）
