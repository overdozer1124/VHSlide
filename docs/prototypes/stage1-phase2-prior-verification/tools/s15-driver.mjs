// S15（項目7 手順1：応答破棄を伴う全面復旧）の PC 側運転コード。
//
// 役割：提供サーバー（tools/serve-real.mjs）を同一プロセスで生成
// し、S15 入口の試験単位セッションをメモリー内だけで受け取って、
// /s15/* 入口を HTTP で運転する（Codex レビュー 6879152477 への
// 対応。DESIGN.md の S15 付録の修正節）。
//
// セッションの受け渡し（本モジュールの要点）：
// - セッション値は createRealServer の戻り値（s15Session）とし
//   て、同一 PC・同一プロセスの中で JS の値としてだけ受け取る。
//   HTTP 応答・URL・ファイル・ログのいずれの経路でも値は移動
//   しない。
// - 受け取った値はこのモジュールのクロージャ内だけに保持し、
//   各入口の呼び出しで x-s15-session ヘッダーに示す。戻り値・
//   例外・snapshot() には含めない（snapshot() が出すのは接続先
//   と「保持しているかどうか」だけである）。
// - S15 専用画面は設けない。準備（対象 B の取得・凍結する要求
//   の照合）は既存の trial-apply 画面の流れが担い、本モジュー
//   ルは送信器への入口（nonce 発行・承認固定・破棄送信・判定
//   記録）だけを運転する。
//
// 各メソッドは HTTP の状態と応答 JSON を { status, ...body }
// の形で返す（入口の拒否は例外にせず、理由コードを含む応答
// として返す。呼び出し側が状態機械と照合して判断する）。
// ID トークン・一回値・nonce・Cookie の値はログに出さない。

import { createRealServer } from "./serve-real.mjs";

// 提供サーバーを生成して待ち受け、S15 の運転ハンドルを返す。
// options は { clientId, relayUrl, port } であり、createRealServer
// へそのまま渡す（指定がなければ環境変数から読む）。port は
// 入口の Host 照合が待ち受けポートと結び付くため、待ち受ける
// ポートそのものを指定すること（0 のような自動採番は使わない）。
export async function createS15Driver(options = {}) {
  const created = await createRealServer(options);
  const { server } = created;
  // セッション値はクロージャ内だけに保持する。戻り値のオブ
  // ジェクトのプロパティには載せない。
  const session = created.s15Session;
  const port = created.port;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${port}`;

  async function call(pathWithQuery, init = {}) {
    const res = await fetch(base + pathWithQuery, {
      ...init,
      headers: { ...(init.headers || {}), "x-s15-session": session },
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, ...(body && typeof body === "object" ? body : {}) };
  }

  function post(pathname, payload) {
    return call(pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  return {
    // 接続先（セッション値は含まない）。
    baseUrl: base,
    // 試行枠の nonce 発行。戻り値は { status, nonce } または
    // { status, error }（理由コードだけ）。
    issueNonce({ trialId, attempt }) {
      const q = new URLSearchParams({ trial_id: trialId, attempt: String(attempt) });
      return call(`/s15/nonces?${q.toString()}`);
    },
    // 承認内容の送信器への固定。固定値そのものは応答に含まれ
    // ない（{ status, ok } または { status, error }）。
    freezeApproval({ trialId, attempt, operationId, purpose, subjectHash, envId, oneTimeValue }) {
      return post("/s15/freeze-approval", {
        trial_id: trialId,
        attempt,
        operation_id: operationId,
        purpose,
        subject_hash: subjectHash,
        env_id: envId,
        one_time_value: oneTimeValue,
      });
    },
    // 破棄送信。戻り値は破棄記録 { status, sent, outcome } だけ
    // であり、実応答の状態・理由・世代は提供層にも存在しない。
    sendDiscard({ trialId, attempt, request }) {
      return post("/s15/send-discard", {
        trial_id: trialId,
        attempt,
        request,
      });
    },
    // 独立した読み戻しによる判定の送信器への記録。
    recordJudgment({ trialId, attempt, outcome }) {
      return post("/s15/record-judgment", {
        trial_id: trialId,
        attempt,
        outcome,
      });
    },
    // 保持の有無だけを出す（値そのものは出さない）。
    snapshot() {
      return Object.freeze({ baseUrl: base, sessionHeld: typeof session === "string" && session.length > 0 });
    },
    // 提供サーバーを閉じる。保持していた接続も閉じる。
    async close() {
      await new Promise((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
      });
    },
  };
}
