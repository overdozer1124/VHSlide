// S15（項目7 手順1：応答破棄を伴う全面復旧）専用送信器（PC 側）。
//
// 役割：試行ごとに最大3つの試行枠（attempt 1〜3）を保持し、
// 試行枠ごとに独立した nonce 取得と Cookie 保持
// （op2_nonce_ctx）を行い、凍結済みの承認内容に結び付けた
// 全面復旧の要求を、応答を読み取らずに1回だけ送る。
//
// 破棄送信の規律（本送信器の要点）：
// - sendDiscard は送信を完了させ、応答をアプリケーションへ
//   渡さない。fetch の Promise が解決しても、応答の状態・
//   本文・ヘッダーには一切触れず、接続を閉じる（本文の
//   cancel）だけを行う。戻り値は
//   { sent: true, outcome: "discarded" } だけであり、成否の
//   判断材料は構造上ここに存在しない（判断は独立した読み
//   戻しだけで行う。手順書 §4.4）。
// - 通信例外・タイムアウト（fetch の拒否として現れるもの）
//   でも、同じ要求を自動で再送することは一切ない。例外は
//   「成否不明・応答破棄」として同じ破棄記録を返し、試行枠
//   は消費済みとして扱う。再送の経路はこの送信器に存在
//   しない（送信の入口は sendDiscard だけであり、消費済みの
//   試行枠は s15_not_prepared で拒否される）。
// - リダイレクトは追従しない（redirect: "manual"）。3xx が
//   返っても、ID トークン・一回値・Cookie を含む POST が別
//   宛先へ転送されることはない。3xx の応答も読み取らずに
//   破棄する。
// - 未確定（送信済み・判定前）の間は次の試行を送れない。
//   送信器は試行ごとの判定（recordJudgment）も保持し、
//   未成立（uncommitted）の判定が記録された試行の次だけが
//   開く。committed／discrepancy の判定の後は、以後一切の
//   発行・固定・送信を拒否する。再実施の上限（合計3回）は
//   試行番号そのもので数える。
//
// 試行枠のライフサイクル：
// - issueNonce({ trialId, attempt })：その試行枠の nonce を
//   中継の /nonce から取得し、Set-Cookie の op2_nonce_ctx
//   だけを試行枠の Cookie Jar として保持する。発行開始時刻
//   （発行 await の直前）を期限基準（issuedAt）に固定する。
//   戻り値は { nonce } だけであり、ctx は返さない。同じ試行
//   枠の再発行は s15_slot_already_issued。
// - freezeApproval({ trialId, attempt, operationId, purpose,
//   subjectHash, envId, oneTimeValue })：その試行枠へ承認内容
//   を固定する。用途は手順の固定値（full-replace）でなければ
//   s15_purpose_mismatch。固定値はメモリー内だけに保持し、
//   戻り値・snapshot・例外には含めない（snapshot は固定済み
//   かどうかだけを出す）。同じ試行枠への再固定は、内容が
//   同じ場合だけ冪等に成功する。再実施の試行枠では、操作ID・
//   用途・対象・環境は先行試行と同一でなければならず
//   （s15_approval_mismatch）、一回値だけが新しい値でよい
//   （再実施は新しい一回値で、同じ操作IDで行う）。
// - sendDiscard({ trialId, attempt, request })：送信前に次を
//   すべて確認し、1つでも欠ければ1件も送らず試行枠も消費
//   しない。(1) 試行枠の確保済み nonce が要求の ID トークン
//   の nonce 主張と一致（s15_slot_nonce_mismatch）。(2) 承認
//   内容が固定済みであり、要求の用途・環境ID・一回値が固定
//   値と一致（s15_approval_not_frozen /
//   s15_purpose_mismatch / s15_env_mismatch /
//   s15_one_time_mismatch。一回値の比較はメモリー内だけで
//   行い、値そのものは例外文・ログに出さない）。(3) 試行枠
//   の送信窓（発行開始＋4分）内であること
//   （s15_nonces_expired）。確認が通れば、最初の await の
//   前に同期的に試行枠を消費して送信中へ遷移し、1回だけ
//   送る。
// - recordJudgment({ trialId, attempt, outcome })：送信済みの
//   試行への判定（committed / uncommitted / discrepancy）を
//   記録する。判定は送信済みの最新試行に1回だけ記録でき、
//   次の試行の発行・固定・送信はこの記録を前提とする。
//
// その他の規則（S10〜S14 送信器と共通）：
// - busy フラグで飛行中の発行・送信の重複を拒否する。
// - 中継 /nonce への GET も redirect: "manual" で、3xx は
//   発行失敗として扱う。
// - POST には固定の Origin（http://localhost:8787）を付ける
//   （実ビルドの /platform/apply は固定 Origin でなければ
//   403 bad_origin を返す。S12 の教訓と同じ）。
// - トークン・一回値・nonce・Cookie の値を戻り値や例外に
//   含めない。snapshot() が出すのは長さ・真偽・件数だけである。

import { extractNonceCtx, tokenNonce } from "./s5-sender.mjs";
import {
  APPLY_PATH,
  APPLY_PURPOSE,
  MAX_SENDS,
  S15_DISCARDED_OUTCOME,
  S15_JUDGMENT_COMMITTED,
  S15_JUDGMENT_DISCREPANCY,
  S15_JUDGMENT_UNCOMMITTED,
  ATTEMPT_SEND_WINDOW_MS,
} from "./s15-apply.mjs";

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

function requireAttempt(attempt) {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_SENDS) {
    fail("s15_bad_attempt", "試行番号が 1〜3 ではありません");
  }
  return attempt;
}

function emptySlot() {
  return { nonce: null, ctx: null, issuedAt: null, consumed: false, frozenApproval: null };
}

export function createS15Sender({ relayUrl, fetchImpl = fetch, now = () => Date.now() }) {
  if (typeof relayUrl !== "string" || relayUrl.length === 0) {
    throw new Error("relayUrl が必要です");
  }
  const base = relayUrl.replace(/\/+$/, "");
  let current = null;
  let busy = false;

  function mustCurrent(trialId) {
    if (current === null || current.trialId !== trialId) {
      fail("s15_trial_mismatch", "試行が現在の試行ではありません");
    }
    return current;
  }

  // 試行番号に対する関門。次の試行（attempt）は、先行試行が
  // 送信済みであり、その判定が未成立（uncommitted）として
  // 記録されている場合にだけ開く。committed／discrepancy の
  // 判定の後は永久に開かない。
  function assertAttemptGate(cur, attempt) {
    if (cur.settledOutcome === S15_JUDGMENT_COMMITTED) {
      fail("s15_already_committed", "committed の判定の後に新しい試行は始められません");
    }
    if (cur.settledOutcome === S15_JUDGMENT_DISCREPANCY) {
      fail("s15_sender_halted", "discrepancy の判定の後に新しい試行は始められません");
    }
    if (attempt === 1) return;
    if (cur.attemptsSent !== attempt - 1) {
      fail("s15_attempt_gate", "先行試行の送信が済んでいません");
    }
    const prev = cur.judgments.get(attempt - 1);
    if (prev !== S15_JUDGMENT_UNCOMMITTED) {
      fail("s15_attempt_gate", "先行試行の未成立の判定が記録されていません");
    }
  }

  function assertWithinWindow(slot, atMs) {
    if (!(atMs < slot.issuedAt + ATTEMPT_SEND_WINDOW_MS)) {
      fail("s15_nonces_expired", "nonce の送信期限を過ぎています");
    }
  }

  return {
    // 新しい試行を開始する。試行枠と判定の保持を空にする。
    beginTrial(trialId) {
      if (current !== null && current.trialId === trialId) {
        fail("s15_trial_mismatch", "同じ試行が既に開始されています");
      }
      const slots = {};
      for (let n = 1; n <= MAX_SENDS; n++) slots[n] = emptySlot();
      current = {
        trialId,
        slots,
        attemptsSent: 0,
        judgments: new Map(),
        settledOutcome: null,
        frozenContent: null, // 試行を通じた承認内容（操作ID・用途・対象・環境。一回値は含めない）
      };
      return true;
    },
    // 試行枠の nonce を発行する。戻り値は { nonce } のみ。
    // Cookie 値は戻さない。関門（判定の前提）を通らない試行
    // 枠の発行は s15_attempt_gate 等で拒否する。
    async issueNonce({ trialId, attempt }) {
      if (busy) {
        fail("s15_sender_busy", "別の送信または発行が進行中です");
      }
      busy = true;
      try {
        const cur = mustCurrent(trialId);
        requireAttempt(attempt);
        assertAttemptGate(cur, attempt);
        const slot = cur.slots[attempt];
        if (slot.nonce !== null) {
          fail("s15_slot_already_issued", `試行${attempt} の nonce は既に発行済みです`);
        }
        // 非同期の境界の直前：発行開始時刻が期限の起点。
        slot.issuedAt = now();
        let res;
        try {
          res = await fetchImpl(`${base}/nonce`, {
            method: "GET",
            redirect: "manual",
          });
        } catch {
          slot.issuedAt = null;
          fail("s15_nonce_issuance_failed", "nonce の取得に失敗しました");
        }
        if (res.status >= 300 && res.status < 400) {
          try {
            if (res.body) await res.body.cancel();
          } catch { /* 本文破棄の失敗は無視する */ }
          slot.issuedAt = null;
          fail("s15_nonce_issuance_failed", "nonce の取得に失敗しました");
        }
        const data = await res.json().catch(() => null);
        const setCookies =
          typeof res.headers.getSetCookie === "function"
            ? res.headers.getSetCookie()
            : [];
        const ctx = extractNonceCtx(setCookies);
        if (!res.ok || !data || !data.nonce || !ctx) {
          slot.issuedAt = null;
          fail("s15_nonce_issuance_failed", "nonce の取得に失敗しました");
        }
        slot.nonce = data.nonce;
        slot.ctx = ctx;
        return { nonce: data.nonce };
      } finally {
        busy = false;
      }
    },
    // 試行枠へ承認内容を固定する。固定値はメモリー内だけに
    // 保持し、戻り値には含めない。固定できるのは、その試行
    // 枠が未送信であり、関門が開いている場合だけである。
    freezeApproval({ trialId, attempt, operationId, purpose, subjectHash, envId, oneTimeValue }) {
      if (busy) {
        fail("s15_sender_busy", "別の送信または発行が進行中です");
      }
      const cur = mustCurrent(trialId);
      requireAttempt(attempt);
      assertAttemptGate(cur, attempt);
      if (typeof operationId !== "string" || operationId.length === 0) {
        fail("bad_trial_input", "操作IDが空でない文字列ではありません");
      }
      if (purpose !== APPLY_PURPOSE) {
        fail("s15_purpose_mismatch", "用途が手順の固定値（full-replace）ではありません");
      }
      if (typeof subjectHash !== "string" || !/^[0-9a-f]{64}$/.test(subjectHash)) {
        fail("s15_approval_mismatch", "対象主体の主体ハッシュが64桁の16進数ではありません");
      }
      if (typeof envId !== "string" || envId.length === 0) {
        fail("bad_trial_input", "環境IDが空でない文字列ではありません");
      }
      if (typeof oneTimeValue !== "string" || oneTimeValue.length === 0) {
        fail("bad_trial_input", "一回値が空でない文字列ではありません");
      }
      const slot = cur.slots[attempt];
      if (slot.consumed) {
        fail("s15_not_prepared", `試行${attempt} は送信済みです`);
      }
      const content = { operationId, purpose, subjectHash, envId };
      if (cur.frozenContent !== null) {
        const f = cur.frozenContent;
        if (
          f.operationId !== content.operationId ||
          f.purpose !== content.purpose ||
          f.subjectHash !== content.subjectHash ||
          f.envId !== content.envId
        ) {
          fail("s15_approval_mismatch", "承認内容が先行試行の固定内容と一致しません");
        }
      }
      if (slot.frozenApproval !== null) {
        const f = slot.frozenApproval;
        if (
          f.operationId === content.operationId &&
          f.purpose === content.purpose &&
          f.subjectHash === content.subjectHash &&
          f.envId === content.envId &&
          f.oneTimeValue === oneTimeValue
        ) {
          return true;
        }
        fail("s15_approval_mismatch", "その試行枠の承認内容は既に別の値で固定されています");
      }
      slot.frozenApproval = { ...content, oneTimeValue };
      if (cur.frozenContent === null) cur.frozenContent = content;
      return true;
    },
    // 試行枠の破棄送信。送信前の確認に失敗すれば1件も送ら
    // ず、試行枠も消費しない。確認が通れば試行枠を同期的に
    // 消費し、1回だけ送る。応答は読み取らず、戻り値は破棄
    // 記録だけである。通信例外・タイムアウトでも再送しない。
    async sendDiscard({ trialId, attempt, request }) {
      if (busy) {
        fail("s15_sender_busy", "別の送信または発行が進行中です");
      }
      const cur = mustCurrent(trialId);
      requireAttempt(attempt);
      assertAttemptGate(cur, attempt);
      const slot = cur.slots[attempt];
      if (slot.nonce === null || slot.ctx === null) {
        fail("s15_not_prepared", `試行${attempt} の nonce が確保されていません`);
      }
      if (slot.consumed) {
        fail("s15_not_prepared", `試行${attempt} の nonce は消費済みです`);
      }
      if (slot.frozenApproval === null) {
        fail("s15_approval_not_frozen", `試行${attempt} の承認内容が送信器に固定されていません`);
      }
      const frozen = slot.frozenApproval;
      // (1) nonce の一致。
      let nonceInToken = null;
      try {
        nonceInToken = tokenNonce(request.id_token);
      } catch {
        nonceInToken = null;
      }
      if (nonceInToken !== slot.nonce) {
        fail("s15_slot_nonce_mismatch", "トークンの nonce が試行枠の nonce と一致しません");
      }
      // (2) 承認内容との一致（用途・環境ID・一回値）。比較は
      // メモリー内だけで行い、値は例外文に出さない。
      if (request.purpose !== frozen.purpose) {
        fail("s15_purpose_mismatch", "要求の用途が固定した承認内容と一致しません");
      }
      if (request.env_id !== frozen.envId) {
        fail("s15_env_mismatch", "要求の環境IDが固定した承認内容と一致しません");
      }
      if (request.one_time_value !== frozen.oneTimeValue) {
        fail("s15_one_time_mismatch", "要求の一回値が固定した承認内容と一致しません");
      }
      // (3) 試行枠の送信窓。
      assertWithinWindow(slot, now());
      // 確認が通ったここで、最初の await の前に同期的に試行
      // 枠を消費して送信中へ遷移する。以後の同じ試行枠の送信
      // は s15_not_prepared で拒否され、再送の経路はない。
      slot.consumed = true;
      cur.attemptsSent = attempt;
      busy = true;
      try {
        // [discard-send-begin]
        // 破棄送信の本体。送信を完了させ、応答は読み取らない。
        // 応答オブジェクトには、接続を閉じるための本文の
        // cancel のほかは一切触れない（状態・本文・ヘッダーを
        // 読まない）。fetch の拒否（通信例外・タイムアウト）は
        // 「成否不明・応答破棄」として同じ扱いにし、再送しない。
        let res = null;
        try {
          res = await fetchImpl(`${base}${APPLY_PATH}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // 実ビルドの /platform/apply は Origin が固定値
              // （http://localhost:8787）でなければ 403
              // bad_origin を返す（S5・S11〜S14 送信器と同じ固定値）。
              Origin: "http://localhost:8787",
              Cookie: `op2_nonce_ctx=${slot.ctx}`,
            },
            body: JSON.stringify(request),
            // リダイレクトは追従しない。3xx で中継先が外部 URL
            // を返しても、ID トークン・一回値・Cookie を含む
            // POST が転送されることはない。
            redirect: "manual",
          });
        } catch {
          res = null;
        }
        if (res !== null) {
          try {
            const responseBody = res.body;
            if (responseBody && typeof responseBody.cancel === "function") {
              await responseBody.cancel();
            }
          } catch { /* 接続の後始末の失敗は無視する */ }
        }
        // [discard-send-end]
      } finally {
        busy = false;
      }
      return Object.freeze({ sent: true, outcome: S15_DISCARDED_OUTCOME });
    },
    // 送信済みの試行への判定を記録する。判定は、その試行が
    // 送信済みの最新試行であり、まだ判定が記録されていない
    // 場合にだけ1回記録できる。次の試行の発行・固定・送信は
    // この記録を前提とする（assertAttemptGate）。
    recordJudgment({ trialId, attempt, outcome }) {
      const cur = mustCurrent(trialId);
      requireAttempt(attempt);
      if (
        outcome !== S15_JUDGMENT_COMMITTED &&
        outcome !== S15_JUDGMENT_UNCOMMITTED &&
        outcome !== S15_JUDGMENT_DISCREPANCY
      ) {
        fail("bad_trial_input", "判定区分が committed / uncommitted / discrepancy ではありません");
      }
      if (cur.attemptsSent !== attempt || cur.judgments.has(attempt)) {
        fail("s15_judgment_order", "判定は送信済みの最新試行に1回だけ記録できます");
      }
      cur.judgments.set(attempt, outcome);
      if (outcome !== S15_JUDGMENT_UNCOMMITTED) cur.settledOutcome = outcome;
      return true;
    },
    // 試行枠の発行開始時刻（期限基準）。未発行なら null。
    slotIssuedAt(trialId, attempt) {
      const cur = current;
      if (cur === null || cur.trialId !== trialId) return null;
      if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_SENDS) return null;
      return cur.slots[attempt].issuedAt;
    },
    // 試行枠が消費済みかどうか。
    slotConsumed(trialId, attempt) {
      const cur = current;
      if (cur === null || cur.trialId !== trialId) return false;
      if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_SENDS) return false;
      return cur.slots[attempt].consumed;
    },
    // 試行を破棄し、送信器側の状態を消す。
    discard() {
      current = null;
      return true;
    },
    snapshot() {
      if (current === null) return null;
      const attempts = {};
      for (let n = 1; n <= MAX_SENDS; n++) {
        const s = current.slots[n];
        attempts[n] = {
          nonceLen: s.nonce === null ? 0 : s.nonce.length,
          ctxLen: s.ctx === null ? 0 : s.ctx.length,
          issuedAt: s.issuedAt,
          consumed: s.consumed,
          // 承認内容が固定済みかどうかだけ（固定値そのもの、
          // 特に一回値は出さない）。
          approvalFrozen: s.frozenApproval !== null,
        };
      }
      return Object.freeze({
        trialId: current.trialId,
        attempts,
        attemptsSent: current.attemptsSent,
        judgmentsRecorded: current.judgments.size,
        settled: current.settledOutcome !== null,
      });
    },
  };
}
