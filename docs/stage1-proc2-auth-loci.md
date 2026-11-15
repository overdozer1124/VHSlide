# 手順2（認可基盤 C1〜C3）置き場の洗い出し

作成: Cursor（2026-11-16）。手順1移行下書きと並行した準備メモ。実装前の地図であり、コード変更はまだ入れない。

## 現行の認可の入口（両サーバーで対になる）

| 役割 | Node (`server/app.ts`) | Cloudflare (`cloudflare/directory.ts`) |
|---|---|---|
| セッション→利用者 | `user(req)`（公開列のみ） | `identity(request)`（返却は id/name/email） |
| 作品参加・所有者 | `member(id, u, ownerOnly?)` | `access(id, user, ownerOnly?, incomplete?)` |
| 編集範囲 | `permissions(id, user, owner)` ← `grants` + owner なら `hostAccess()` | 同名の private メソッド（同じ規則） |
| 招待の自動取込 | `claim(u)` | `claim(user)` |
| スライド編集の実体 | 共有 `src/permissions.ts`（`canEdit` / `assertDeckAccess`） | 同 |

呼び出し数の目安: Node で `member`/`permissions` 系が数十箇所、Directory で `access`/`permissions` が同程度。Room DO（`cloudflare/room.ts`）は Directory 経由の参加前提で、Directory がゲート。

## 手順2で足すもの（設計書 §4・実施計画 §3）

1. **資格照会 API**（サーバーが操作資格を返す）— Node／CF で同一の判定関数を共有モジュール化
2. **作品区分分岐** — 一般作品は現行 `member`/`permissions` を維持。学校作品は `organization_id` / `space_id` 導入後に分岐（段階②の列が前提の部分はスタブまたは未公開のまま）
3. **内部フラグ非混入（C3）** — 手順1で公開 SELECT を明示済み。手順2では資格照会レスポンスにも `is_super_admin` を出さない（管理者専用経路のみ）
4. **既存セッションへの資格変更の反映** — セッションを切らなくても次の操作で新資格／失効が効く（fail-closed）。世代番号は所属無効化の実装時に `organization_members` へ追加予定（手順1スキーマには未含有）
5. **`audit_log` 必須** — 所有者判断 (a)。権限付与・解除・任命・失効はログ書き込みと同一トランザクション。書けなければ操作不成立

## 触らない／後回し

- スペース表・decks の学校列（段階②）
- 登録制フロー本体（手順3）
- 初代登録経路（手順4）。運営者登録簿は `users.is_super_admin` とは別

## 次の実装単位（提案）

1. 共有の資格判定モジュール（一般作品パス = 現行互換の回帰テスト付き）
2. `audit_log` 書き込みヘルパ（必須・同一 TX）
3. 資格照会エンドポイント（検証環境フラグ下）
4. Node／CF の `member`/`access`/`permissions` を共有判定へ寄せる（挙動不変のリファクタ）
