# 手順3（登録制フロー B群）置き場の洗い出し

作成: Cursor（2026-11-16）。実装前の地図。状態遷移は実装設計書 §5 に従う。

## 現行の関連入口

| 経路 | Node | Cloudflare | 備考 |
|---|---|---|---|
| Google ログイン | `POST /api/auth/google` | Directory 同パス | いまは users upsert のみ。ここに事前登録の原子的結びつけを足す |
| セッション | cookie `vhslide_session` | 同 | 結びつけ後も同一セッションで所属が効くこと |
| 学校用 Client ID | `schoolClientId` / `schoolDomain` | `GOOGLE_SCHOOL_*` | ログイン種別は資格に使わない（§5-3） |

## 手順3で追加する操作（API 案・未実装）

1. 学校管理者: 自校の事前登録 CRUD（有効の作成、有効→取消）。`(email, organization_id)` の有効一意を守る
2. ログイン時: email_verified なメール（小文字）で有効事前登録を消費 → `organization_members` 生成と `結びつけ済み` を同一 TX。`planned_is_school_admin` は所属に反映しない
3. 学校管理者申請: `school_admin_applications` の申請中作成
4. スーパー管理者のみ: 申請の登録／却下（`is_school_admin` 確定）。`audit_log` 必須書き込みと同一 TX
5. 所属の無効化／再有効化: status と role のみ再有効化。世代番号は無効化実装時に追加

## 競合・拒否（設計どおり）

- 結びつけと取消の競合は先勝ち（原子的状態遷移）
- 無効所属がある事前登録は結びつけず取消（理由: 所属無効）
- 別校への操作拒否、二重消費拒否

## 依存

- 手順1の表が両サーバーに存在すること（本ブランチ）
- 手順2の資格照会・audit 必須ヘルパ
- 初代スーパー管理者（手順4）がいないと任命フローの受入は完走できないが、表と遷移の単体試験は先行可能
