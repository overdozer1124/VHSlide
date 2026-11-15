# 手順1（移行 C4・C5）メモ

作成: Cursor（2026-11-16）。根拠: 実施計画 §3・§4、実装設計書 §2.2–2.4。検証環境向けの下書き。本番有効化は含まない。

## 変更内容

- 共有モジュール `src/stage1OrgSchema.ts`
  - 追加テーブル: `organizations` / `preregistrations` / `organization_members` / `school_admin_applications` / `audit_log` / `schema_migrations`
  - `users.is_super_admin`（DEFAULT 0）を冪等に追加
  - `organization_members.generation`（DEFAULT 1）を手順1に含める（実装設計 §5 の恒久的無効化。Muse 照合 6901968480 の指摘どおり、実適用前に列を足す）
  - 移行ID: `stage1_org_v1`（`schema_migrations` に記録）。世代列欠落の旧下書き DB は再実行時に `ALTER` で補完（移行行は増やさない）
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
- 世代番号の増分・認可での照合（列は手順1、ロジックは手順2以降）
- 検証環境への実適用と移行直後の回帰（D群の本試験は手順5。照合完了後に PC 側）
