// S15（項目7 手順1：応答破棄を伴う全面復旧）の PC 側運転コード。
//
// 役割：提供サーバー（tools/serve-real.mjs）の S15 入口
// （/s15/*）を HTTP で運転するハンドルを提供する。ハンドルの
// 得方は2通りある。
// - createS15Driver(options)：提供サーバーを同一プロセスで
//   生成して待ち受け、ハンドルを返す（従来どおり。試験が使う）。
// - attachS15Driver(created)：生成済みの提供サーバー
//   （createRealServer の戻り値）へ結び付けて、ハンドルを返す。
//   運転ランチャー（tools/s15-run.mjs）が使う。ランチャーは
//   提供サーバーを自プロセスで生成し、画面の配信とこの
//   ハンドルを同一プロセスで保持するため、ハンドル経由の
//   判定の記録は「画面が使っている送信器そのもの」へ届く
//   （Codex 再レビュー 6879939268 への対応）。新規に生成した
//   別プロセス・別サーバーのハンドルでは、別の送信器へ記録
//   されてしまい、現在の送信器の状態は復旧できない。
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
// - 運転の主経路は S15 専用画面（public/s15-apply.html）であ
//   り、B の実ログインから破棄送信・読み戻し判定・通常版復帰
//   の記録までを、同じ /s15/* 入口経由で運転する（Codex 再
//   レビュー 6879462050 への対応）。本モジュールは、その入口
//   に対するプログラム経路（同一プロセス・メモリー内だけの
//   受け渡し）であり、試験と、運転ランチャー経由で画面の送信
//   指示の結果が不明になった場合に読み戻し判定を送信器側へ
//   記録する復旧経路を担う。
//
// 各メソッドは HTTP の状態と応答 JSON を { status, ...body }
// の形で返す（入口の拒否は例外にせず、理由コードを含む応答
// として返す。呼び出し側が状態機械と照合して判断する）。
// ID トークン・一回値・nonce・Cookie の値はログに出さない。

import { createRealServer } from "./serve-real.mjs";

// 接続先とセッション（クロージャ内だけに保持）から、運転
// ハンドルを組み立てる。createS15Driver と attachS15Driver で
// 共用する。close() は結び付いた提供サーバーを閉じる。
function buildS15Driver({ server, session, base }) {
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

// 生成済みの提供サーバー（createRealServer の戻り値）へ結び
// 付けて、S15 の運転ハンドルを返す。まだ待ち受けていなければ
// created.port で待ち受ける（入口の Host 照合が待ち受けポート
// と結び付くため、自動採番は使わない）。セッション値は戻り値
// から JS の値としてだけ受け取り、クロージャ内に保持する。
export async function attachS15Driver(created) {
  const { server } = created;
  // セッション値はクロージャ内だけに保持する。戻り値のオブ
  // ジェクトのプロパティには載せない。
  const session = created.s15Session;
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(created.port, "127.0.0.1", resolve);
    });
  }
  const address = server.address();
  const port =
    address && typeof address === "object" && typeof address.port === "number"
      ? address.port
      : created.port;
  const base = `http://127.0.0.1:${port}`;
  return buildS15Driver({ server, session, base });
}

// 提供サーバーを生成して待ち受け、S15 の運転ハンドルを返す。
// options は { clientId, relayUrl, port } であり、createRealServer
// へそのまま渡す（指定がなければ環境変数から読む）。port は
// 入口の Host 照合が待ち受けポートと結び付くため、待ち受ける
// ポートそのものを指定すること（0 のような自動採番は使わない）。
export async function createS15Driver(options = {}) {
  const created = await createRealServer(options);
  return attachS15Driver(created);
}
