// PC 側中継のひな形（実施計画 v0.2 第3節・変形B用）
//
// 役割: ブラウザー（http://localhost:8787 のログイン画面）からの要求を、
// ヘッダー（特に Origin と Cookie）を変更せず、検証用 Worker へ素通しする。
// 中継はアプリケーションレベルの拒否を行わない。拒否はすべて検証用 Worker
// 自身が行い、Worker は受け取った Origin を応答に含めて返すため、
// 中継が Origin を書き換えていないことを対照試験で確認できる。
//
// 実環境（変形B）: wrangler dev から remote service binding（env.VERIFY）で
// 検証用 Worker を呼ぶ。前回試作と同じ到達形態。
// ローカル模擬: env.HARNESS_URL が設定されていれば、実 binding の代わりに
// 通常の fetch で Miniflare ハーネスへ転送する（試験ランナーが使う）。

export default {
  async fetch(request, env) {
    if (env.HARNESS_URL) {
      const u = new URL(request.url);
      const target =
        env.HARNESS_URL.replace(/\/+$/, "") + u.pathname + u.search;
      // new Request(target, request) はメソッド・ヘッダー・本文をそのまま引き継ぐ。
      return fetch(new Request(target, request));
    }
    if (env.VERIFY) {
      // service binding 呼び出し: 要求オブジェクトをそのまま渡す（ヘッダー素通し）。
      return env.VERIFY.fetch(request);
    }
    return new Response("relay not configured: set HARNESS_URL or VERIFY binding", {
      status: 500,
    });
  },
};
