# 手順2（認可基盤 C1〜C3）置き場の洗い出し

作成: Cursor（2026-11-16）。手順1移行と並行。地図に加え、共有モジュールの第一弾を実装中。

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
4. **既存セッションへの資格変更の反映** — セッションを切らなくても次の操作で新資格／失効が効く（fail-closed）。`organization_members.generation` 列は手順1で追加済み。無効化時の増分と認可での照合は本手順で実装する
5. **`audit_log` 必須** — 所有者判断 (a)。権限付与・解除・任命・失効はログ書き込みと同一トランザクション。書けなければ操作不成立

## 触らない／後回し

- スペース表・decks の学校列（段階②）
- 登録制フロー本体（手順3）
- 初代登録経路（手順4）。運営者登録簿は `users.is_super_admin` とは別

## 実装の進み（第一弾）

1. ✅ `src/stage1Capabilities.ts` — 一般作品の資格（host／grant／default）を共有化。`STAGE1_FEATURES` フラグ
2. ✅ `src/stage1Audit.ts` — `audit_log` 必須書き込み（失敗で操作不成立）
3. ✅ Node／CF の `permissions` を `generalDeckAccess` へ寄せ（挙動は現行どおり。付与JSON不正は throw）
4. ✅ `GET /api/decks/:id/capabilities`（`STAGE1_FEATURES` または Node の `stage1Features` オプション下のみ。未有効は 404。`isMember` は実所属を検索 — Muse 照合 6902361527）
5. ⬜ 権限変更経路への audit 同一 TX 配線（任命・失効など手順3と接続する箇所）
6. ✅ `src/stage1Generation.ts` — 無効化時の世代+1、再有効化で世代を戻さない、照合ヘルパ。HTTP 配線は手順3の所属操作と同時
