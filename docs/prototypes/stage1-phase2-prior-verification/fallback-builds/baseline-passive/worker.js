// 復旧用受動ビルド（ベースライン相当）― 段階①フェーズ2 先行検証 実環境試験
//
// 目的: 初回配置で RegistryDO の移行（新規 SQLite クラス追加）が適用された
// 後は、Cloudflare の Rollbacks 仕様により移行前の版（ベースライン
// dbb7d21e）へのロールバックは許可されない。そのため「安全な状態へ戻す」
// ための復旧先として、移行後のクラス構成と互換な受動ビルドを新規に用意
// する。通常ビルドの読み戻し不一致やカナリア失敗時に、このビルドを
// 100% 配置してベースライン相当の状態（全経路が受付をしない）へ戻す。
//
// 性質:
// - 既存クラス（VerificationDO）と新規クラス（RegistryDO）の両方を
//   export し、両方のバインディングを受ける。クラス・名前空間・データの
//   削除は一切行わない（削除移行は含めないし、このビルド自体も状態を
//   変更しない）。
// - DO のスタブは状態に触れず、404 を返すだけである。
// - 既定ハンドラは全経路にベースラインで観測された応答（HTTP 200、
//   本文 "verification-only"）を返す。受付経路は存在しない。
// - このビルドは移行が適用された後にのみ配置できる（移行前の版管理
//   アップロードでは新規クラスを伴うため 10211 になる）。初回配置の
//   直後に未配信の版として作成し、配置可能性を実証してから復旧用に
//   温存する。
export class RegistryDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async fetch() {
    return new Response("not_configured", { status: 404 });
  }
}
export class VerificationDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async fetch() {
    return new Response("not_configured", { status: 404 });
  }
}
export default {
  async fetch() {
    return new Response("verification-only", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
