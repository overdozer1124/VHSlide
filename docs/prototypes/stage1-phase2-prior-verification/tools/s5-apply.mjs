// S5 並行試験（項目2 手順3：full-replace への並行6件）専用の純粋モジュール。
//
// 目的：6件の要求を1つの試行として扱い、送信直前に6件の条件が等しい
// ことと nonce が6件とも異なることを確認し、6件の応答を1つの試験 ID
// で結んだ記録にする。表示・ログ・Issue・チャットに ID トークン・
// 一回値・Cookie・nonce・主体ハッシュを出さない。
//
// - buildS5Requests(...) は6件の要求オブジェクトを buildTrialRequest
//   で作り、深く凍結して返す。6件の env_id・purpose・一回値は同一の
//   固定値であり、ID トークンだけがスロットごとに異なる。
// - verifyNoncesDistinct(nonces) は6件の nonce がすべて空でない文字列
//   で、互いに異なることを確認する。値そのものは返さず、失敗時の例外
//   文にも値を含めない。
// - verifyS5RequestsEqual(requests) は6件の要求の env_id・purpose・
//   一回値がすべて同一であることを確認する。等しいことだけを確認し、
//   値は返さない（Codex レビュー 6720499137 の「他の条件が等しいこと」）。
// - buildS5SlotDisplay(...) はスロットごとの表示記録だけを返す。
//   含むのは試験 ID・スロット番号・env_id・purpose・主体の確認事実・
//   一回値の使用事実・nonce の発行事実のみ。ID トークン・一回値・
//   nonce・主体ハッシュは含まない。
// - verifyS5DisplayMatchesSent(displays, requests) は各スロットの表示の
//   env_id・purpose が実際に送る本体のものと一致することを確認する。
// - makeS5LogEntry(...) は6件の表示と応答を同一の試験 ID で結んだ記録
//   を返す。応答はスロット番号・HTTP 状態・正規化された理由コードだけ
//   を含む。応答が返らなかったスロットは status null・error
//   "no_response"（送信側の局所コード。再送しない）として記録する。
// - aggregateS5Results(results) は6件の応答を集計する。成功（201）が
//   正確に1件で、残り5件がすべて 409 operation_consumed のときに
//   だけ ok が真になる。同一 nonce を使った場合の nonce 再送拒否とは
//   別の結果になるため、集計だけでは並行消費の証拠にならない
//   （nonce の相異は verifyNoncesDistinct で送信前に確認する）。
//
// このモジュールはネットワーク通信を一切行わない。Node（試験）と
// ブラウザー（s5-apply 画面）の両方から同じ実装を使うため、依存する
// のは trial-apply.mjs と Object.freeze・JSON だけである。秘密の比較
// は呼び出し側（ブラウザー画面・送信側）のメモリー内だけで行い、
// このモジュールは値を保存・出力しない。
//
// 並行送信そのものはブラウザーではできない。nonce context は Cookie
// 経由で結び付き、ブラウザーの fetch では Cookie ヘッダーを任意に
// 設定できない（forbidden header）ため、単一のブラウザープロファイル
// からは6件それぞれに異なる nonce context Cookie を送れない。送信は
// 提供サーバー側の tools/s5-sender.mjs（Node）が行う。画面は6件の
// 実トークンを集めて凍結した要求を作り、表示を確認したうえで、送信
// 側へ1回の送信指示として渡す。送信側はスロットごとに Cookie jar を
// 分け、6件を Promise.all で並行送信する。

import { buildTrialRequest, normalizeResponseError } from "./trial-apply.mjs";

export const S5_SLOT_COUNT = 6;

// 送信側の局所コード：応答が返らなかったスロット（再送しない）。
export const S5_NO_RESPONSE = "no_response";

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  for (const value of Object.values(obj)) deepFreeze(value);
  return Object.freeze(obj);
}

function requireNonEmptyString(value, what) {
  if (typeof value !== "string" || value.length === 0) {
    fail("bad_trial_input", `${what} が空でない文字列ではありません`);
  }
  return value;
}

// 6件の要求オブジェクトを作り、深く凍結して返す。ID トークンだけが
// スロットごとに異なり、env_id・purpose・一回値は6件で同一である。
export function buildS5Requests({ tokens, oneTimeValue, purpose, envId }) {
  if (!Array.isArray(tokens) || tokens.length !== S5_SLOT_COUNT) {
    fail("bad_trial_input", "ID トークンが6件ではありません");
  }
  requireNonEmptyString(oneTimeValue, "一回値");
  requireNonEmptyString(purpose, "用途");
  requireNonEmptyString(envId, "環境ID");
  return deepFreeze(
    tokens.map((idToken) =>
      buildTrialRequest({ idToken, oneTimeValue, purpose, envId })
    )
  );
}

// 6件の nonce がすべて空でない文字列で、互いに異なることを確認する。
// 値そのものは返さず、失敗時の例外文にも値を含めない。
export function verifyNoncesDistinct(nonces) {
  if (!Array.isArray(nonces) || nonces.length !== S5_SLOT_COUNT) {
    fail("bad_trial_input", "nonce が6件ではありません");
  }
  for (const n of nonces) requireNonEmptyString(n, "nonce");
  if (new Set(nonces).size !== S5_SLOT_COUNT) {
    fail("bad_trial_input", "6件の nonce の中に重複があります");
  }
  return true;
}

// 6件の要求の env_id・purpose・一回値がすべて同一であることを確認する。
// 等しいことだけを確認し、値は返さない。ID トークンはスロットごとに
// 異なることが前提であり、ここでは確認しない。
export function verifyS5RequestsEqual(requests) {
  if (!Array.isArray(requests) || requests.length !== S5_SLOT_COUNT) {
    fail("bad_trial_input", "要求が6件ではありません");
  }
  const first = requests[0];
  for (const r of requests) {
    if (
      r.env_id !== first.env_id ||
      r.purpose !== first.purpose ||
      r.one_time_value !== first.one_time_value
    ) {
      fail("s5_slots_differ", "6件の要求の条件（環境ID・用途・一回値）が等しくありません");
    }
  }
  return true;
}

// スロットごとの表示記録だけを返す。含むのは試験 ID・スロット番号・
// env_id・purpose・主体の確認事実・一回値の使用事実・nonce の発行事実
// のみ。one_time は「固定の一回値を6件で共用する」という事実であり、
// 値の比較ではない（S5 は完全一致の試行であり、送信する一回値は承認
// に固定された値そのものである）。nonce は「発行済み・他スロットと
// 異なる」という事実であり、値ではない。
export function buildS5SlotDisplay(request, { trialId, slot, subjectConfirmed }) {
  requireNonEmptyString(trialId, "試験 ID");
  if (!Number.isInteger(slot) || slot < 0 || slot >= S5_SLOT_COUNT) {
    fail("bad_trial_input", "スロット番号が 0〜5 ではありません");
  }
  if (typeof subjectConfirmed !== "boolean") {
    fail("bad_trial_input", "主体の確認結果が真偽ではありません");
  }
  return deepFreeze({
    trial_id: trialId,
    slot,
    env_id: request.env_id,
    purpose: request.purpose,
    // 主体の確認は、アカウント選択での所有者の申告と、トークンの署名検証
    // の通過である。sub と承認済み主体ハッシュの機械的照合ではない。
    subject: subjectConfirmed
      ? "アカウント選択でA（所有者の申告）・署名検証通過（subと承認主体ハッシュの機械的照合ではない）"
      : "未確認",
    one_time: "固定の一回値を6件で共用",
    nonce: "発行済み・他スロットと異なる",
  });
}

// 表示記録が許された鍵だけを持つことを確認する（試験用の検査関数）。
// 許された鍵：trial_id・slot・env_id・purpose・subject・one_time・nonce。
export function assertS5DisplayKeys(display) {
  const allowed = new Set([
    "trial_id",
    "slot",
    "env_id",
    "purpose",
    "subject",
    "one_time",
    "nonce",
  ]);
  for (const key of Object.keys(display)) {
    if (!allowed.has(key)) {
      fail("bad_display", "表示記録に許されない鍵があります");
    }
  }
  return true;
}

// 各スロットの表示の env_id・purpose が、実際に送る本体のものと一致
// することを確認する。不一致なら例外（表示と実送信の食い違い）。
export function verifyS5DisplayMatchesSent(displays, requests) {
  if (!Array.isArray(displays) || displays.length !== S5_SLOT_COUNT) {
    fail("bad_trial_input", "表示記録が6件ではありません");
  }
  if (!Array.isArray(requests) || requests.length !== S5_SLOT_COUNT) {
    fail("bad_trial_input", "要求が6件ではありません");
  }
  for (let i = 0; i < S5_SLOT_COUNT; i++) {
    if (displays[i].slot !== i) {
      fail("display_sent_mismatch", "表示記録のスロット番号が順序と一致しません");
    }
    if (displays[i].env_id !== requests[i].env_id) {
      fail("display_sent_mismatch", "表示の env_id と送信する env_id が一致しません");
    }
    if (displays[i].purpose !== requests[i].purpose) {
      fail("display_sent_mismatch", "表示の purpose と送信する purpose が一致しません");
    }
  }
  return true;
}

// 応答の理由コードを正規化する。応答が返らなかったスロットの局所
// コード "no_response" はそのまま通す（Worker の理由コードではなく、
// 送信側で「応答なし・再送しない」を示す記録である）。
export function normalizeS5ResponseError(error) {
  if (error === S5_NO_RESPONSE) return S5_NO_RESPONSE;
  return normalizeResponseError(error);
}

// 6件の表示と応答を同一の試験 ID で結んだ記録を返す。応答はスロット
// 番号・HTTP 状態・正規化された理由コードだけを含む。ID トークン・
// 一回値・Cookie・nonce は含まない。status が null のスロットは応答
// なし（再送しない）として記録する。
export function makeS5LogEntry({ trialId, slots }) {
  requireNonEmptyString(trialId, "試験 ID");
  if (!Array.isArray(slots) || slots.length !== S5_SLOT_COUNT) {
    fail("bad_trial_input", "試験ログのスロットが6件ではありません");
  }
  return deepFreeze({
    trial_id: trialId,
    slots: slots.map(({ display, response }, i) => {
      if (!display || display.slot !== i) {
        fail("bad_trial_input", "試験ログの表示記録のスロット番号が順序と一致しません");
      }
      if (!response || (response.status !== null && typeof response.status !== "number")) {
        fail("bad_trial_input", "試験ログの応答の HTTP 状態が数値または null ではありません");
      }
      return {
        slot: i,
        display,
        response: {
          status: response.status,
          error: normalizeS5ResponseError(response.error),
        },
      };
    }),
  });
}

// 6件の応答を集計する。成功（201）が正確に1件で、残り5件がすべて
// 409 operation_consumed のときにだけ ok が真になる。応答なしの
// スロットがある場合や、成功が0件・2件以上の場合は ok は偽である。
// 集計だけでは並行消費の証拠にならない（同一 nonce の場合は nonce
// 再送拒否と区別できないため、nonce の相異は送信前に
// verifyNoncesDistinct で確認する）。
export function aggregateS5Results(results) {
  if (!Array.isArray(results) || results.length !== S5_SLOT_COUNT) {
    fail("bad_trial_input", "集計対象の応答が6件ではありません");
  }
  let success = 0;
  let consumed = 0;
  let noResponse = 0;
  const others = [];
  for (const r of results) {
    if (r.status === 201) success += 1;
    else if (r.status === 409 && r.error === "operation_consumed") consumed += 1;
    else if (r.status === null) noResponse += 1;
    else others.push({ slot: r.slot, status: r.status, error: r.error });
  }
  return deepFreeze({
    success,
    consumed,
    no_response: noResponse,
    other: others,
    ok: success === 1 && consumed === S5_SLOT_COUNT - 1,
  });
}
