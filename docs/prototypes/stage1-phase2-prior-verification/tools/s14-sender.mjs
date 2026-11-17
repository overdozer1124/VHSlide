// S14（項目6 手順7：ローテーション A→B）専用送信器（PC 側）。
//
// 役割：試行ごとに3つのスロット（rotateAB / checkA / checkB）を
// 保持し、スロットごとに独立した nonce 取得と Cookie 保持
// （op2_nonce_ctx）を行い、凍結済み要求をそれぞれ1回だけ提示
// する。トークン・nonce・Cookie の値を戻り値や例外に含めない。
//
// S14 には保持トークンがない（手順をまたいで未使用のまま置く
// トークンは存在しない）。S13 送信器との差は主に2点である。
// (1) 登録簿の変更はローテーション1回だけであり、対象の結び
// 付け（freezeRotateTargets）は、旧主体・新主体の「組」を
// rotateAB スロットに固定する（S13 の手順ごとの単一対象の固定
// を組へ拡張したもの）。固定は1回限りとする。期待世代も固定
// 値が1つだけである（rotateAB = 6）。
// (2) verify-only の提示が2回あり、期待が正反対である（手順2
// の checkA はローテーション元 A が 403 not_operator で拒否
// されることが合格、手順3の checkB はローテーション先 B が
// 200 で通ることが合格）。送信器はどちらのスロットの提示も
// 同じ sendVerifyOnly で送り、期待との照合は状態機械が行う。
// 鮮度ゲート（保持トークンの残り時間確認）は S14 にはない。
// 代わりに、スロットごとの送信窓（発行開始時刻から4分）を
// 過ぎた捕捉は s14_nonces_expired で拒否し、古い捕捉のまま
// 送らない規律をローテーションと提示の両方に適用する。
//
// スロットのライフサイクル：
// - issueNonce({ trialId, slot})：そのスロットの nonce を中継
//   の /nonce から取得し、レスポンスの op2_nonce_ctx Cookie 値
//   をスロットの Cookie Jar として保持する。nonce 発行済みの
//   スロットの再発行は s14_slot_already_issued。nonce の発行は
//   スロット単位で1回のみ。発行開始時刻（発行 await の直前）を
//   スロットの期限基準（issuedAt）に固定する（Worker は /nonce
//   の要求受理時に期限を始めるため、応答時刻より保守的）。
// - freezeRotateTargets({ trialId, oldSubjectHash,
//   newSubjectHash})：ローテーション対象の組の固定。画面が
//   ローテーション要求を凍結した時点で、凍結済み要求の対象
//   （手順0で取得した A と B）を送信器にも登録し、以後の
//   sendRotate はこの固定値の組と一致する要求だけを受け付け
//   る（送信器の境界での対象の結び付け。S13 の仕組みを組へ
//   適用）。固定は1回だけであり、同じ組の再登録は冪等に成功
//   し、異なる組の再登録は s14_rotate_target_mismatch で拒否
//   する。固定値は送信器のメモリー内だけに保持し、戻り値・
//   snapshot・例外には含めない（snapshot は固定済みかどうか
//   の真偽だけを出す）。固定は、rotateAB スロットが発行済みで
//   未消費のときにだけ受け付ける（それ以外は
//   s14_not_prepared）。
// - sendRotate({ trialId, slot, request})：rotateAB スロットを
//   消費して /admin/registry/rotate へ1回だけ送る。対象スロッ
//   トは rotateAB のみ（checkA / checkB は提示専用）。送信前に
//   次のすべてを確認する（1つでも欠ければ1件も送らず、スロッ
//   トも消費しない）：
//   (1) スロットの確保済み nonce が要求の ID トークンの nonce
//   主張と一致（s14_slot_nonce_mismatch）。
//   (2) 対象の結び付け：要求の old_subject_hash /
//   new_subject_hash が、freezeRotateTargets で固定した組と
//   一致すること。固定がまだ無い場合は s14_rotate_not_frozen、
//   要求の対象が空の場合は s14_rotate_target_fixed、固定値と
//   異なる場合は s14_rotate_target_mismatch。
//   (3) expected_generation が固定値 6 であること
//   （s14_unexpected_generation）。
//   (4) スロットの送信窓（発行開始＋4分）内であること
//   （s14_nonces_expired）。
// - sendVerifyOnly({ trialId, slot, request})：checkA または
//   checkB スロットを消費して /admin/verify-only へ1回だけ
//   送る。対象スロットは checkA / checkB のみ（rotateAB は
//   ローテーション専用）。スロットの送信窓を過ぎていれば
//   s14_nonces_expired で送信自体を拒否する（提示は未実施で
//   あり、成功として記録しない）。nonce 主張の一致も同じよう
//   に確認する。
//
// その他の規則（S10〜S13 送信器と共通）：
// - 発行の確保は送信 assert の前に同期的に行い、発行済みでは
//   二重送信は不可能である。busy フラグで飛行中の送信の重複を
//   拒否する。
// - 中継 /nonce への GET は redirect: "manual"。中継の 3xx は
//   追従せず発行失敗として扱う。ローテーション・提示の POST
//   も redirect: "manual"。3xx は redirect_not_followed として
//   記録し、再送しない。
// - POST には固定の Origin（http://localhost:8787）を付ける
//   （実ビルドの /admin/* は固定 Origin でなければ 403
//   bad_origin を返す。S12 でガード試験が捉えた教訓）。
// - fetch 例外時は { status: null, error: "no_response"} を
//   返し、状態未確定として扱う（再送手段なし）。
// - 応答から持ち帰るのは { status, error（理由コードのみ）、
//   generation} だけ。本体・nonce・Cookie・ハッシュは
//   持ち帰らない。

import { extractNonceCtx, tokenNonce } from "./s5-sender.mjs";
import {
  ROTATE_PATH,
  VERIFY_ONLY_PATH,
  ROTATE_EXPECTED_GENERATION,
  S14_SLOTS,
  SLOT_SEND_WINDOW_MS,
  normalizeS14ResponseError,
} from "./s14-rotate.mjs";

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

const VALID_REASONS = new Set([
  "not_operator",
  "stale_generation",
  "nonce_replayed",
  "nonce_expired",
  "nonce_context_mismatch",
  "unknown_nonce",
  "target_not_member",
  "last_operator",
  "already_member",
  "bad_request",
  "uninitialized",
  "provider_unreachable",
  "invalid_token",
  "token_expired",
  "audience_mismatch",
  "unauthorized",
]);

function requireSlotName(slot) {
  if (!S14_SLOTS.includes(slot)) {
    fail("s14_bad_slot", "スロットが rotateAB / checkA / checkB ではありません");
  }
  return slot;
}

function requireRotateSlot(slot) {
  requireSlotName(slot);
  if (slot !== "rotateAB") {
    fail("s14_bad_slot", `${slot} は提示専用でありローテーションには使えません`);
  }
  return slot;
}

function emptySlot() {
  return { nonce: null, ctx: null, issuedAt: null, consumed: false };
}

export function createS14Sender({ relayUrl, fetchImpl = fetch, now = () => Date.now() }) {
  if (typeof relayUrl !== "string" || relayUrl.length === 0) {
    throw new Error("relayUrl が必要です");
  }
  const base = relayUrl.replace(/\/+$/, "");
  let current = null;
  let busy = false;

  function mustCurrent(trialId) {
    if (current === null || current.trialId !== trialId) {
      fail("s14_trial_mismatch", "試行が現在の試行ではありません");
    }
    return current;
  }

  function assertIssuedNotConsumed(cur, slot) {
    const s = cur.slots[slot];
    if (s.nonce === null || s.ctx === null) {
      fail("s14_not_prepared", `${slot} の nonce が確保されていません`);
    }
    if (s.consumed) {
      fail("s14_not_prepared", `${slot} の nonce は消費済みです`);
    }
    return s;
  }

  function assertWithinWindow(s, atMs) {
    if (!(atMs < s.issuedAt + SLOT_SEND_WINDOW_MS)) {
      fail("s14_nonces_expired", "nonce の送信期限を過ぎています");
    }
  }

  function assertTokenMatchesSlot(s, request) {
    let nonceInToken = null;
    try {
      nonceInToken = tokenNonce(request.id_token);
    } catch {
      nonceInToken = null;
    }
    if (nonceInToken !== s.nonce) {
      fail("s14_slot_nonce_mismatch", "トークンの nonce がスロットの nonce と一致しません");
    }
  }

  async function postAdmin(path, slotState, request) {
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // 実ビルドの /admin/* は Origin が固定値
          // （http://localhost:8787）でなければ 403 bad_origin を
          // 返す（S5・S11・S12・S13 送信器と同じ固定値）。
          Origin: "http://localhost:8787",
          Cookie: `op2_nonce_ctx=${slotState.ctx}`,
        },
        body: JSON.stringify(request),
        redirect: "manual",
      });
    } catch {
      return { status: null, error: "no_response", generation: null };
    }
    if (res.status >= 300 && res.status < 400) {
      return { status: res.status, error: "redirect_not_followed", generation: null };
    }
    const data = await res.json().catch(() => null);
    // 成功応答は error を持たないため、その場合は null を通す
    // （S11〜S13 送信器と同じ）。error 文字列があるのに許可一覧に
    // なければ unexpected_error に置き換える。
    const rawError = data && data.error !== undefined ? data.error : null;
    const error =
      rawError === null
        ? null
        : VALID_REASONS.has(rawError)
          ? rawError
          : "unexpected_error";
    return {
      status: res.status,
      error: normalizeS14ResponseError(error),
      generation: data && Number.isInteger(data.generation) ? data.generation : null,
    };
  }

  return {
    // 新しい試行を開始する。3スロットを空にし、対象の固定も
    // 空にする。秘密は試行の外に持ち出さない。
    beginTrial(trialId) {
      if (current !== null && current.trialId === trialId) {
        fail("s14_trial_mismatch", "同じ試行が既に開始されています");
      }
      const slots = {};
      for (const slot of S14_SLOTS) slots[slot] = emptySlot();
      current = { trialId, slots, frozenRotateTargets: null };
      return true;
    },
    // ローテーション対象の組の固定：画面がローテーション要求を
    // 凍結した時点で、凍結済み要求の旧主体・新主体を登録する。
    // 以後の sendRotate は、この固定値の組と一致する要求だけを
    // 受け付ける。固定は1回だけ（同じ組の再登録は冪等、異なる
    // 組は s14_rotate_target_mismatch で拒否）。固定値はメモリー
    // 内だけに保持し、戻り値には含めない。固定できるのは、
    // rotateAB スロットが発行済みで未消費のときだけである。
    freezeRotateTargets({ trialId, oldSubjectHash, newSubjectHash }) {
      if (busy) {
        fail("s14_sender_busy", "別の送信または発行が進行中です");
      }
      const cur = mustCurrent(trialId);
      if (
        typeof oldSubjectHash !== "string" || !/^[0-9a-f]{64}$/.test(oldSubjectHash) ||
        typeof newSubjectHash !== "string" || !/^[0-9a-f]{64}$/.test(newSubjectHash)
      ) {
        fail("s14_rotate_target_fixed", "固定するローテーション対象の主体ハッシュが64桁の16進数ではありません");
      }
      if (cur.frozenRotateTargets !== null) {
        if (
          cur.frozenRotateTargets.oldSubjectHash === oldSubjectHash &&
          cur.frozenRotateTargets.newSubjectHash === newSubjectHash
        ) {
          return true;
        }
        fail("s14_rotate_target_mismatch", "ローテーション対象は既に別の主体ハッシュの組で固定されています");
      }
      // 固定は、rotateAB の発行の後、ローテーションの送信の前で
      // なければならない。
      if (cur.slots.rotateAB.nonce === null) {
        fail("s14_not_prepared", "rotateAB が確保される前にローテーション対象は固定できません");
      }
      if (cur.slots.rotateAB.consumed) {
        fail("s14_not_prepared", "ローテーションは送信済みです");
      }
      cur.frozenRotateTargets = { oldSubjectHash, newSubjectHash };
      return true;
    },
    // スロットの nonce を発行する。発行開始時刻（発行 await の
    // 直前）を期限基準に固定する。戻り値は { nonce} のみ。
    // Cookie 値は戻さない。取得済みスロットの再発行は
    // s14_slot_already_issued。取得の失敗はスロットを空に戻し
    // s14_nonce_issuance_failed を投げる。
    async issueNonce({ trialId, slot }) {
      if (busy) {
        fail("s14_sender_busy", "別の送信または発行が進行中です");
      }
      busy = true;
      try {
        const cur = mustCurrent(trialId);
        requireSlotName(slot);
        const s = cur.slots[slot];
        if (s.nonce !== null) {
          fail("s14_slot_already_issued", `${slot} の nonce は既に発行済みです`);
        }
        // 非同期の境界の直前：発行開始時刻が期限の起点。
        s.issuedAt = now();
        let res;
        try {
          res = await fetchImpl(`${base}/nonce`, {
            method: "GET",
            redirect: "manual",
          });
        } catch {
          s.issuedAt = null;
          fail("s14_nonce_issuance_failed", "nonce の取得に失敗しました");
        }
        const data = await res.json().catch(() => null);
        const setCookies =
          typeof res.headers.getSetCookie === "function"
            ? res.headers.getSetCookie()
            : [];
        const ctx = extractNonceCtx(setCookies);
        if (!res.ok || !data || !data.nonce || !ctx) {
          s.issuedAt = null;
          fail("s14_nonce_issuance_failed", "nonce の取得に失敗しました");
        }
        s.nonce = data.nonce;
        s.ctx = ctx;
        return { nonce: data.nonce };
      } finally {
        busy = false;
      }
    },
    // スロットの発行開始時刻（期限基準）。未発行なら null。
    slotIssuedAt(trialId, slot) {
      const cur = current;
      if (cur === null || cur.trialId !== trialId) return null;
      if (!S14_SLOTS.includes(slot)) return null;
      return cur.slots[slot].issuedAt;
    },
    // スロットが消費済みかどうか。
    slotConsumed(trialId, slot) {
      const cur = current;
      if (cur === null || cur.trialId !== trialId) return false;
      if (!S14_SLOTS.includes(slot)) return false;
      return cur.slots[slot].consumed;
    },
    // 手順1：rotateAB スロットを消費してローテーションを1回だけ
    // 送る。送信前確認（nonce 一致・対象の結び付け（固定した組
    // との一致）・期待世代の固定値・送信窓）のどれか1つでも
    // 失敗したら1件も送らず、スロットも消費しない。
    async sendRotate({ trialId, slot, request }) {
      if (busy) {
        fail("s14_sender_busy", "別の送信または発行が進行中です");
      }
      const cur = mustCurrent(trialId);
      requireRotateSlot(slot);
      const s = assertIssuedNotConsumed(cur, slot);
      // (1) nonce の一致。
      assertTokenMatchesSlot(s, request);
      // (2) 対象の結び付け：要求の old_subject_hash /
      // new_subject_hash が、凍結時に freezeRotateTargets で固定
      // した組と一致すること。固定値は状態機械が作る凍結済み
      // 要求の対象であり、送信されてきた要求の値だけでは決まら
      // ない。一致しなければ1件も送らない（スロットも消費しない）。
      if (
        typeof request.old_subject_hash !== "string" || request.old_subject_hash.length === 0 ||
        typeof request.new_subject_hash !== "string" || request.new_subject_hash.length === 0
      ) {
        fail("s14_rotate_target_fixed", "ローテーション対象の主体ハッシュが要求にありません");
      }
      if (cur.frozenRotateTargets === null) {
        fail("s14_rotate_not_frozen", "ローテーション対象が送信器に固定されていません");
      }
      if (
        request.old_subject_hash !== cur.frozenRotateTargets.oldSubjectHash ||
        request.new_subject_hash !== cur.frozenRotateTargets.newSubjectHash
      ) {
        fail("s14_rotate_target_mismatch", "ローテーション対象が凍結時に固定した組と一致しません");
      }
      // (3) 期待世代の固定値。
      if (request.expected_generation !== ROTATE_EXPECTED_GENERATION) {
        fail("s14_unexpected_generation", "期待世代が手順の固定値ではありません");
      }
      // (4) スロットの送信窓。
      assertWithinWindow(s, now());
      s.consumed = true;
      busy = true;
      try {
        return await postAdmin(ROTATE_PATH, s, request);
      } finally {
        busy = false;
      }
    },
    // 手順2・手順3：checkA または checkB スロットを消費して
    // verify-only へ1回だけ送る。対象スロットは checkA /
    // checkB のみ。rotateAB はローテーション専用であり、ここ
    // では拒否する。スロットの送信窓を過ぎていたら
    // s14_nonces_expired で送信自体を拒否する（提示は未実施）。
    async sendVerifyOnly({ trialId, slot, request }) {
      if (busy) {
        fail("s14_sender_busy", "別の送信または発行が進行中です");
      }
      const cur = mustCurrent(trialId);
      requireSlotName(slot);
      if (slot === "rotateAB") {
        fail("s14_bad_slot", "rotateAB はローテーション専用であり verify-only には使えません");
      }
      const s = assertIssuedNotConsumed(cur, slot);
      assertTokenMatchesSlot(s, request);
      assertWithinWindow(s, now());
      s.consumed = true;
      busy = true;
      try {
        return await postAdmin(VERIFY_ONLY_PATH, s, request);
      } finally {
        busy = false;
      }
    },
    // 試行を破棄し、送信器側の状態を消す。
    discard() {
      current = null;
      return true;
    },
    snapshot() {
      if (current === null) return null;
      const slots = {};
      for (const slot of S14_SLOTS) {
        const s = current.slots[slot];
        slots[slot] = {
          nonceLen: s.nonce === null ? 0 : s.nonce.length,
          ctxLen: s.ctx === null ? 0 : s.ctx.length,
          issuedAt: s.issuedAt,
          consumed: s.consumed,
        };
      }
      return Object.freeze({
        trialId: current.trialId,
        slots,
        // ローテーション対象が固定済みかどうかだけ（固定値
        // そのものは出さない）。
        rotateTargetsFrozen: current.frozenRotateTargets !== null,
      });
    },
  };
}
