# 手順3（登録制フロー B群）置き場の洗い出し

作成: Cursor（2026-11-16）。状態遷移は実装設計書 §5 に従う。共有ヘルパの実装を進行中。

## 現行の関連入口

| 経路 | Node | Cloudflare | 備考 |
|---|---|---|---|
| Google ログイン | `POST /api/auth/google` | Directory 同パス | いまは users upsert のみ。ここに事前登録の原子的結びつけを足す |
| セッション | cookie `vhslide_session` | 同 | 結びつけ後も同一セッションで所属が効くこと |
| 学校用 Client ID | `schoolClientId` / `schoolDomain` | `GOOGLE_SCHOOL_*` | ログイン種別は資格に使わない（§5-3） |

## 実装の進み

1. ✅ `src/stage1Preregistration.ts` — 有効作成／取消／ログイン時結びつけ（原子的・`planned_is_school_admin` は所属に載せない・無効所属なら取消）
2. ✅ HTTP API（`POST /api/organizations/:id/preregistrations`・`DELETE /api/preregistrations/:id`、`STAGE1_FEATURES` 下、audit 同一 TX）
3. ✅ ログイン経路への `bindPreregistrationsOnLogin` 配線（同一 TX）
4. ⬜ 学校管理者申請・スーパー管理者の確定（audit 同一 TX）
5. ⬜ 所属の無効化／再有効化 HTTP（世代ヘルパは手順2済み）

## 競合・拒否（設計どおり）

- 結びつけと取消の競合は先勝ち（原子的状態遷移）
- 無効所属がある事前登録は結びつけず取消（理由: 所属無効）
- 別校への操作拒否、二重消費拒否

## 依存

- 手順1の表が両サーバーに存在すること（本ブランチ）
- 手順2の資格照会・audit 必須ヘルパ
- 初代スーパー管理者（手順4）がいないと任命フローの受入は完走できないが、表と遷移の単体試験は先行可能
