// S9 負例試験（項目8：トークン検証＋再送）専用の純粋モジュール。
//
// 目的：Codex レビュー Issue #3 コメント 6734391864 への対応として、
// S9 の負例試験（署名改変・Cookie なし・再送）を、専用画面
// （public/s9-negative.html）から安全に行うための状態機械と検証を
// 提供する。表示・ログ・Issue・チャットに ID トークン・Cookie・
// nonce・主体ハッシュを出さない。
//
// - base64urlEncode／base64urlDecode は base64url の変換だけを行う。
//   秘密の保存・出力はしない。
// - tamperSignature(idToken) は JWT の署名バイトの先頭バイトの1ビット
//   だけを反転（XOR 0x01）し、base64url で正しく再符号化して返す。
//   header・payload の文字列は一切変えない（ペイロード先頭文字の改変
//   ではない。Codex レビュー 6734391864 の指摘(1)）。
// - verifyTamperPreservesStructure(original, tampered) は改変前後で
//   署名バイト以外と JWT の構造が同一なことを、非秘密の真偽だけで返す。
// - createChainSession() はチェーンの状態機械である。許可する順序は
//   チェーンA：tampered → control → resend、チェーンB：no-cookie →
//   control。recordStep で応答を期待値と照合し、不一致ならチェーンを
//   停止（halted）してそれ以上の送信を不可にする。fetch が例外
//   （レスポンスなし）の場合は状態未確定として停止し、再送を許可しない。
//   古い世代のコールバックは拒否する。トークンの消去の契機は
//   TOKEN_ERASE_TRIGGERS に明記する（チェーン完了・停止・破棄・新規
//   試行）。消去そのものは呼び出し側（ブラウザー画面）が行い、この
//   モジュールはトークンを保持しない。
// - expectedResponse(step) は各ステップの期待応答を返す。正常対照
//   （control）が期待どおり 200 ok になった後のみ再送（resend）を
//   許可する（Codex レビュー 6734391864 の指摘(2)）。Cookie 欠落等も
//   期待した応答以外なら後続を停止する。
// - makeTrialLogEntry(...) は試験 ID・チェーン・ステップ・応答の状態と
//   正規化された理由コードだけの記録を返す。成功応答（control の
//   200 ok）は理由コードを持たないため error は null のまま通す
//   （s5-apply.mjs の normalizeS5ResponseError と同じ扱い）。
// - nonceDeadline(issuedAtMs) は発行時刻＋5分を返す。nonce の期限の
//   開始時点は /nonce 要求の開始時刻（fetch 呼び出し直前に同期的に
//   記録した時刻）であり、試行に閉じ込める（createChainSession の
//   beginNonceFetch／finishNonceFetch）。応答の受信時刻は使わない。
//   要求開始時刻は、サーバーが有効期限を開始する要求の到着時より早く、
//   応答がどれだけ遅れても実際の期限より新しく見積もることはない
//   （S5 の issueStartedAt と同じ型。Codex レビュー 6734640413 の
//   指摘2）。isNonceExpired(nowMs, issuedAtMs) は現在時刻が期限以上
//   かどうかを真偽で返す。取得中の再準備・破棄は beginNonceFetch の
//   nonce_fetch_busy と画面側の無効化で拒否し、遅れて戻った旧応答は
//   finishNonceFetch が null で破棄する（期限・nonce を上書きしない）。
//   Cookie の上書きは、並行する /nonce 要求を出さないことで防ぐ。
//   ブラウザーは応答受信時に Set-Cookie を自動適用するため、事後の
//   照合だけでは防げない。
// - assertLogHasNoSecrets(logText, secrets) は trial-apply.mjs の
//   assertNoSecrets を使って、ログ文字列に秘密らしい値が含まれてい
//   ないことを確認する（画面の log() が書き込む前に呼ぶ）。
//
// このモジュールはネットワーク通信を一切行わない。Node（テスト）と
// ブラウザー（s9-negative 画面）の両方から同じ実装を使うため、依存
// するのは trial-apply.mjs と Object.freeze・JSON・atob／btoa だけ
// である。秘密の比較は呼び出し側（ブラウザー画面）のメモリー内だけ
// で行い、このモジュールは値を保存・出力しない。
//
// 送信中の排他・古い GIS コールバック拒否・試行単位のトークン消去・
// nonce 期限の開始時点・入力／Origin 境界・転送先固定・リダイレクト
// 非追従は、このモジュールと画面の注記・回帰試験で明記する（Codex
// レビュー 6734391864 の指摘(3)）。Origin の対照は秘密なしの2要求が
// 指定経路と想定した判定層に届くことを事前に確認するものであり、
// Origin 試験そのものは画面ではなく秘密なし curl 対で行うため、画面
// の実装対象外である（指摘(4)。画面のヘッダーコメントに境界として
// 明記する）。

import { normalizeResponseError, assertNoSecrets } from "./trial-apply.mjs";

// nonce の有効期間。/nonce 応答の nonce context Cookie の Max-Age
// （300秒）と同一の 5分である。期限の開始時点は /nonce 要求の開始
// 時刻（fetch 呼び出し直前に同期的に記録した時刻）であり、応答の
// 受信時刻ではない。
export const NONCE_TTL_MS = 5 * 60 * 1000;

// チェーンの種別と許可するステップの順序。チェーンA は改変＋再送、
// チェーンB は Cookie なし。正常対照（control）は両チェーンの共通の
// 関門であり、resend は control が期待どおり 200 ok になった後のみ
// 許可される。
export const CHAIN_KINDS = Object.freeze(["A", "B"]);
export const CHAIN_STEPS = Object.freeze({
  A: Object.freeze(["tampered", "control", "resend"]),
  B: Object.freeze(["no-cookie", "control"]),
});

// トークン消去の契機。消去そのものは呼び出し側（ブラウザー画面）が
// メモリー内の変数を空にして行う。消去を忘れてはならない契機をここに
// 列挙し、画面と試験で参照する。
export const TOKEN_ERASE_TRIGGERS = Object.freeze([
  "chain-completed", // チェーン完了（全ステップが期待どおり）
  "chain-halted", // チェーン停止（期待外れ応答・応答なし・構造確認失敗）
  "trial-discarded", // 試行の破棄（破棄ボタン・捕捉時の検証失敗）
  "new-trial-begun", // 新規試行の開始（旧試行の無効化と同時に旧トークンを消去）
]);

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

// base64url の変換。atob／btoa は Node とブラウザーの両方にある。
// 不正な文字・長さは bad_trial_input で失敗する（秘密の値は例外文に
// 含めない）。
export function base64urlEncode(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    fail("bad_trial_input", "符号化する値がバイト列ではありません");
  }
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(input) {
  if (typeof input !== "string" || input.length === 0) {
    fail("bad_trial_input", "base64url 値が空でない文字列ではありません");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(input)) {
    fail("bad_trial_input", "base64url 値に不正な文字があります");
  }
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    fail("bad_trial_input", "base64url 値を復号できません");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// JWT の署名バイトの先頭バイトの1ビットだけを反転（XOR 0x01）し、
// base64url で正しく再符号化して返す。header・payload の文字列は
// 一切変えない。3分割でなければ bad_trial_input で例外。
export function tamperSignature(idToken) {
  requireNonEmptyString(idToken, "ID トークン");
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    fail("bad_trial_input", "ID トークンが3部分ではありません");
  }
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) {
    fail("bad_trial_input", "ID トークンのいずれかの部分が空です");
  }
  const sigBytes = base64urlDecode(signature);
  if (sigBytes.length === 0) {
    fail("bad_trial_input", "署名が空です");
  }
  const tampered = new Uint8Array(sigBytes);
  tampered[0] ^= 0x01;
  return `${header}.${payload}.${base64urlEncode(tampered)}`;
}

// 改変前後で署名バイト以外と JWT の構造が同一なことを、非秘密の真偽
// だけで返す。signatureDiffersByOneBit は署名バイト列がちょうど1ビット
// だけ異なる場合に真。不正な入力（文字列でない場合）は例外とし、それ
// 以外の不一致は偽の組み合わせで返す（呼び出し側が送信可否を決める）。
export function verifyTamperPreservesStructure(original, tampered) {
  if (typeof original !== "string" || typeof tampered !== "string") {
    fail("bad_trial_input", "比較するトークンが文字列ではありません");
  }
  const o = original.split(".");
  const t = tampered.split(".");
  const threeParts = o.length === 3 && t.length === 3;
  const sameHeader = threeParts && o[0] === t[0];
  const samePayload = threeParts && o[1] === t[1];
  let validBase64url = false;
  if (threeParts) {
    validBase64url = [...o, ...t].every(
      (part) => typeof part === "string" && part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part)
    );
    if (validBase64url) {
      // 復号できることも確認する（長さの不正などは atob が拒否する）。
      try {
        for (const part of [...o, ...t]) base64urlDecode(part);
      } catch {
        validBase64url = false;
      }
    }
  }
  let signatureDiffersByOneBit = false;
  if (threeParts && validBase64url) {
    try {
      const a = base64urlDecode(o[2]);
      const b = base64urlDecode(t[2]);
      if (a.length === b.length) {
        let differingBits = 0;
        for (let i = 0; i < a.length; i++) {
          let x = a[i] ^ b[i];
          while (x) {
            differingBits += x & 1;
            x >>= 1;
          }
        }
        signatureDiffersByOneBit = differingBits === 1;
      }
    } catch {
      signatureDiffersByOneBit = false;
    }
  }
  return deepFreeze({
    sameHeader,
    samePayload,
    threeParts,
    validBase64url,
    signatureDiffersByOneBit,
  });
}

// 各ステップの期待応答。control の成功応答は理由コードを持たない
// （error は null）。resend は control が期待どおり 200 ok になった
// 後のみ許可される（順序は createChainSession が強制する）。
const EXPECTED_RESPONSES = {
  tampered: { status: 401, error: "tokeninfo_rejected" },
  control: { status: 200, error: null, ok: true },
  resend: { status: 403, error: "nonce_replayed" },
  "no-cookie": { status: 403, error: "nonce_context_mismatch" },
};

export function expectedResponse(step) {
  const expected = EXPECTED_RESPONSES[step];
  if (!expected) {
    fail("bad_trial_input", "ステップが tampered / control / resend / no-cookie ではありません");
  }
  return deepFreeze({ ...expected });
}

export function expectedSteps(chainKind) {
  const steps = CHAIN_STEPS[chainKind];
  if (!steps) {
    fail("bad_trial_input", "チェーン種別が A / B ではありません");
  }
  return steps;
}

// チェーンの状態機械。準備の開始時に新しい試験 ID を発行し、前回の
// 試行を無効化する（旧トークンの消去は呼び出し側が TOKEN_ERASE_TRIGGERS
// の "new-trial-begun" で行う）。非同期の古いコールバックは世代照合で
// 拒否する。状態：preparing（準備中・捕捉待ち）→ ready（捕捉済み・
// 送信可）→ active（送信中）→ completed（完了）／halted（停止）。
// 停止は期待外れ応答（undetermined: false）と応答なし（undetermined:
// true）の2種類があり、どちらもそれ以上の送信を不可にし、再送も許可
// しない。送信中の排他（sending フラグ）は呼び出し側（画面）が行い、
// このモジュールは送信可否の判定（canSend）を提供する。
// nonce の取得も試行に閉じ込める。beginNonceFetch は /nonce 要求の
// 開始直前に同期的に呼び、開始時刻（startedAtMs）を試行に記録する。
// 取得中の再取得は nonce_fetch_busy で拒否し（S5 の s5_busy と同じ
// 型）、取得済みの試行での再取得は nonce_already_issued で拒否する。
// finishNonceFetch は応答が現行の試行・取得中のものに限って適用し、
// 期限の起点は開始時刻のまま返す。遅れて戻った旧試行の応答・破棄後の
// 応答・取得中でない試行の応答は null を返して適用しない（呼び出し側
// は null を受けたら破棄し、期限・nonce を上書きしない）。
export function createChainSession() {
  let current = null; // { trialId, generation, chain, state, stepIndex, undetermined, nonceRequest }
  let generation = 0;

  function makeTrialId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    fail("no_trial_id", "試験 ID を発行できません");
  }

  function requireCurrent(trialId, gen) {
    if (
      current === null ||
      current.trialId !== trialId ||
      current.generation !== gen
    ) {
      fail("stale_attempt", "古い試行のコールバックです");
    }
    return current;
  }

  return {
    beginChain(chainKind) {
      if (!CHAIN_STEPS[chainKind]) {
        fail("bad_trial_input", "チェーン種別が A / B ではありません");
      }
      generation += 1;
      const trialId = makeTrialId();
      current = {
        trialId,
        generation,
        chain: chainKind,
        state: "preparing",
        stepIndex: 0,
        undetermined: false,
        nonceRequest: null, // { startedAtMs, state: "pending" | "issued", nonce }
      };
      return deepFreeze({ trialId, generation, chain: chainKind });
    },
    isCurrent(trialId, gen) {
      return (
        current !== null && current.trialId === trialId && current.generation === gen
      );
    },
    // /nonce 要求の開始を試行に記録する。startedAtMs は fetch 呼び出し
    // 直前に同期的に記録した要求開始時刻であり、期限の起点になる。
    // 取得中の再取得は nonce_fetch_busy、取得済みの再取得は
    // nonce_already_issued で拒否する。古い試行は stale_attempt。
    beginNonceFetch(trialId, gen, startedAtMs) {
      const cur = requireCurrent(trialId, gen);
      if (!Number.isFinite(startedAtMs)) {
        fail("bad_trial_input", "nonce 要求の開始時刻が数値ではありません");
      }
      if (cur.nonceRequest && cur.nonceRequest.state === "pending") {
        fail("nonce_fetch_busy", "nonce の取得中です");
      }
      if (cur.nonceRequest && cur.nonceRequest.state === "issued") {
        fail("nonce_already_issued", "nonce は既に取得済みです");
      }
      cur.nonceRequest = { startedAtMs, state: "pending", nonce: null };
      return deepFreeze({ trialId, generation: gen, startedAtMs });
    },
    // /nonce 応答を試行に適用する。現行の試行・取得中のものに限る。
    // 遅れて戻った旧試行の応答・破棄後の応答・取得中でない試行の応答は
    // null を返して適用しない。適用時は期限の起点として要求開始時刻
    // （startedAtMs）をそのまま返す（応答の受信時刻は使わない）。
    finishNonceFetch(trialId, gen, nonce) {
      if (!this.isCurrent(trialId, gen)) return null;
      const req = current.nonceRequest;
      if (!req || req.state !== "pending") return null;
      if (typeof nonce !== "string" || nonce.length === 0) return null;
      req.state = "issued";
      req.nonce = nonce;
      return deepFreeze({ nonce, issuedAtMs: req.startedAtMs });
    },
    // 試行に記録された nonce 期限の起点（要求開始時刻）。未取得なら
    // null。古い試行は stale_attempt。
    nonceIssuedAt(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (!cur.nonceRequest || cur.nonceRequest.state !== "issued") return null;
      return cur.nonceRequest.startedAtMs;
    },
    // 試行の nonce 取得が飛行中かどうか。古い試行は偽。
    isNonceFetchPending(trialId, gen) {
      if (!this.isCurrent(trialId, gen)) return false;
      return !!current.nonceRequest && current.nonceRequest.state === "pending";
    },
    // 捕捉モードでトークンを受け取り、PC 内署名検証が通ったことを
    // 記録する。preparing のときにだけ ready へ進む。
    markCaptured(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (cur.state !== "preparing") {
        fail("chain_state", "試行が準備中の状態ではありません");
      }
      cur.state = "ready";
      return true;
    },
    // 次に送るべきステップ。完了・停止した試行は null を返す。
    nextStep(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (cur.state === "completed" || cur.state === "halted") return null;
      return CHAIN_STEPS[cur.chain][cur.stepIndex];
    },
    // そのステップを今送ってよいか。順序外・未捕捉・完了・停止は偽。
    canSend(trialId, gen, step) {
      if (!this.isCurrent(trialId, gen)) return false;
      if (current.state !== "ready" && current.state !== "active") return false;
      return CHAIN_STEPS[current.chain][current.stepIndex] === step;
    },
    // 応答を期待値と照合する。response が null の場合は fetch の例外
    // （レスポンスなし）であり、状態未確定として停止し、再送を許可
    // しない。順序外のステップ・古い試行は例外（送信そのものを拒否）。
    recordStep(trialId, gen, step, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.state === "completed" || cur.state === "halted") {
        fail("chain_state", "試行が完了または停止しています");
      }
      const expectedStep = CHAIN_STEPS[cur.chain][cur.stepIndex];
      if (step !== expectedStep) {
        fail("chain_order", "チェーンの順序と異なるステップです");
      }
      if (response === null || response === undefined) {
        cur.state = "halted";
        cur.undetermined = true;
        return deepFreeze({
          trialId,
          chain: cur.chain,
          step,
          matched: false,
          state: "halted",
          undetermined: true,
          nextStep: null,
        });
      }
      if (typeof response.status !== "number") {
        fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
      }
      const expected = EXPECTED_RESPONSES[step];
      let matched;
      if (step === "control") {
        // 成功応答は理由コードを持たない。error が null／未指定で
        // 状態が 200 のときにだけ一致とする。
        matched =
          response.status === 200 &&
          (response.error === null || response.error === undefined);
      } else {
        matched =
          response.status === expected.status &&
          normalizeResponseError(response.error) === expected.error;
      }
      if (!matched) {
        cur.state = "halted";
        cur.undetermined = false;
        return deepFreeze({
          trialId,
          chain: cur.chain,
          step,
          matched: false,
          state: "halted",
          undetermined: false,
          nextStep: null,
        });
      }
      cur.stepIndex += 1;
      if (cur.stepIndex >= CHAIN_STEPS[cur.chain].length) {
        cur.state = "completed";
        return deepFreeze({
          trialId,
          chain: cur.chain,
          step,
          matched: true,
          state: "completed",
          undetermined: false,
          nextStep: null,
        });
      }
      cur.state = "active";
      return deepFreeze({
        trialId,
        chain: cur.chain,
        step,
        matched: true,
        state: "active",
        undetermined: false,
        nextStep: CHAIN_STEPS[cur.chain][cur.stepIndex],
      });
    },
    // fetch が例外（レスポンスなし）の場合の記録。recordStep に
    // null を渡すことと同じである。
    recordNoResponse(trialId, gen, step) {
      return this.recordStep(trialId, gen, step, null);
    },
    // 試行の破棄。現行の試行なら無効化し（トークンの消去は呼び出し側
    // が TOKEN_ERASE_TRIGGERS の "trial-discarded" で行う）、古い試行
    // に対しては無害に偽を返す。
    discard(trialId, gen) {
      if (!this.isCurrent(trialId, gen)) return false;
      current = null;
      return true;
    },
    snapshot() {
      if (current === null) return null;
      const cur = current;
      return deepFreeze({
        trialId: cur.trialId,
        generation: cur.generation,
        chain: cur.chain,
        state: cur.state,
        stepIndex: cur.stepIndex,
        nextStep:
          cur.state === "completed" || cur.state === "halted"
            ? null
            : CHAIN_STEPS[cur.chain][cur.stepIndex],
        undetermined: cur.undetermined,
      });
    },
    currentTrialId() {
      return current === null ? null : current.trialId;
    },
  };
}

// nonce の期限。発行時刻（/nonce 要求の開始時刻）＋5分。開始時刻は
// createChainSession の beginNonceFetch が fetch 呼び出し直前に同期
// 的に記録したものであり、応答の受信時刻ではない。
export function nonceDeadline(issuedAtMs) {
  if (!Number.isFinite(issuedAtMs)) {
    fail("bad_trial_input", "nonce の発行時刻が数値ではありません");
  }
  return issuedAtMs + NONCE_TTL_MS;
}

// 現在時刻が nonce の期限以上かどうか。期限ちょうどは期限切れとする。
export function isNonceExpired(nowMs, issuedAtMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(issuedAtMs)) {
    fail("bad_trial_input", "時刻が数値ではありません");
  }
  return nowMs >= nonceDeadline(issuedAtMs);
}

// 試験 ID・チェーン・ステップ・応答の状態と正規化された理由コードだけ
// の記録を返す。成功応答（control の 200 ok）は error が null のまま
// 通す。一覧にない理由コードは unexpected_error へ置き換える。
// ID トークン・Cookie・nonce は含まない。
export function makeTrialLogEntry({ trialId, chain, step, response }) {
  requireNonEmptyString(trialId, "試験 ID");
  if (!CHAIN_STEPS[chain]) {
    fail("bad_trial_input", "チェーン種別が A / B ではありません");
  }
  if (!Object.prototype.hasOwnProperty.call(EXPECTED_RESPONSES, step)) {
    fail("bad_trial_input", "ステップが tampered / control / resend / no-cookie ではありません");
  }
  if (!response || typeof response.status !== "number") {
    fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
  }
  const error =
    response.error === null || response.error === undefined
      ? null
      : normalizeResponseError(response.error);
  return deepFreeze({
    trial_id: trialId,
    chain,
    step,
    response: {
      status: response.status,
      error,
    },
  });
}

// ログ文字列に秘密らしい値が含まれていないことを確認する。画面の
// log() が書き込む前に、捕捉したトークンと nonce を渡して呼ぶ。
export function assertLogHasNoSecrets(logText, secrets) {
  return assertNoSecrets(logText, secrets);
}
