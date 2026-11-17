// S12（項目6 手順5：運営者 B の失効）専用送信器（PC 側）。
//
// 役割：試行ごとに4つのスロット（heldB / revokeA / freshB /
// checkC）を保持し、スロットごとに独立した nonce 取得と Cookie
// 保持（op2_nonce_ctx）を行い、凍結済み要求をそれぞれ1回だけ
// 提示する。トークン・nonce・Cookie の値を戻り値や例外に含め
// ない。
//
// 【S11 送信器との差】S11 の送信器は「手順ごとに1回の発行を
// 持つ」形だった（手順3 = 1件、手順4 = 2件の並行）。S12 では、
// 手順1で取得した B のトークン＋nonce を、手順2（A の失効）と
// 手順3（新しい B の取得・提示）をまたいで未使用のまま保持
// しなければならず、スロットは「試行中に同時に最大4件が生き
// ている」。そのため S12 ではスロットを名前（heldB / revokeA /
// freshB / checkC）で持ち、発行（issueNonce）、失効送信
// （sendRevoke）、提示送信（sendVerifyOnly）をスロット単位の
// 操作にする。Cookie の分離・発行開始時刻の基準・再送不可・
// redirect: "manual" などの安全規則は S11 送信器からそのまま
// 引き継ぐ。
//
// スロットのライフサイクル：
// - issueNonce({ trialId, slot })：そのスロットの nonce を中継
//   の /nonce から取得し、レスポンスの op2_nonce_ctx Cookie 値
//   をスロットの Cookie Jar として保持する。nonce 発行済みの
//   スロットの再発行は s12_slot_already_issued。nonce の発行は
//   スロット単位で1回のみ。発行開始時刻（発行 await の直前）を
//   スロットの期限基準（issuedAt）に固定する（Worker は /nonce
//   の要求受理時に期限を始めるため、応答時刻より保守的）。
// - freezeRevokeTarget({ trialId, subjectHash })：失効対象の
//   固定。画面が失効要求を凍結した時点で、凍結済み要求の対象
//   （状態機械が手順1で保持した B の主体ハッシュから作る）を
//   送信器にも登録し、以後の sendRevoke はこの固定値と一致
//   する要求だけを受け付ける（送信器の境界での対象の結び
//   付け）。固定は試行ごとに1回だけであり、同じ値の再登録は
//   冪等に成功し、異なる値の再登録は
//   s12_revoke_target_mismatch で拒否する。固定値は送信器の
//   メモリー内だけに保持し、戻り値・snapshot・例外には含め
//   ない（snapshot は固定済みかどうかの真偽だけを出す）。
// - sendRevoke({ trialId, request })：revokeA のスロットを消費
//   して /admin/registry/revoke へ1回だけ送る。送信前に次の
//   すべてを確認する（1つでも欠ければ1件も送らない）：
//   (1) heldB のスロットが発行済みで未消費であり、かつ発行
//   開始から HELD_MAX_AGE_AT_REVOKE_MS 以内（保持トークンの
//   鮮度。手順4の提示が送信窓に間に合わない状態では失効を
//   送らない。失敗コード s12_held_token_stale）。
//   (2) スロットの確保済み nonce が要求の ID トークンの nonce
//   主張と一致（s12_slot_nonce_mismatch）。
//   (3) 対象の結び付け：要求の subject_hash が、凍結時に
//   freezeRevokeTarget で固定した対象と一致すること。固定が
//   まだ無い場合は s12_revoke_not_frozen、要求の対象が空の
//   場合は s12_revoke_target_fixed、固定値と異なる場合は
//   s12_revoke_target_mismatch。
//   (4) expected_generation が手順の固定値 4 であること
//   （s12_unexpected_generation）。
//   (5) revokeA のスロットの送信窓（発行開始＋4分）内である
//   こと（s12_nonces_expired）。
// - sendVerifyOnly({ trialId, slot, request })：指定スロットを
//   消費して /admin/verify-only へ1回だけ送る。対象スロットは
//   freshB / heldB / checkC のいずれか（revokeA は失効専用）。
//   スロットの送信窓を過ぎていれば s12_nonces_expired で送信
//   自体を拒否する（手順4では、これが「保持トークンが期限切れ
//   で提示できない」場合に当たる。提示は未実施であり、成功と
//   して記録しない）。nonce 主張の一致も同じように確認する。
//
// その他の規則（S10・S11 送信器と共通）：
// - 発行の確保は送信 assert の前に同期的に行い、発行済みでは
//   二重送信は不可能である。busy フラグで飛行中の送信の重複を
//   拒否する。
// - 中継 /nonce への GET は redirect: "manual"。中継の 3xx は
//   追従せず発行失敗として扱う。失効・提示の POST も
//   redirect: "manual"。3xx は redirect_not_followed として
//   記録し、再送しない。
// - fetch 例外時は { status: null, error: "no_response" } を
//   返し、状態未確定として扱う（再送手段なし）。
// - 応答から持ち帰るのは { status, error（理由コードのみ）、
//   generation } だけ。本体・nonce・Cookie・ハッシュは
//   持ち帰らない。

import { extractNonceCtx, tokenNonce } from "./s5-sender.mjs";
import {
  REVOKE_PATH,
  VERIFY_ONLY_PATH,
  REVOKE_EXPECTED_GENERATION,
  S12_SLOTS,
  SLOT_SEND_WINDOW_MS,
  HELD_MAX_AGE_AT_REVOKE_MS,
  normalizeS12ResponseError,
} from "./s12-revoke.mjs";

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
  if (!S12_SLOTS.includes(slot)) {
    fail("s12_bad_slot", "スロットが heldB / revokeA / freshB / checkC ではありません");
  }
  return slot;
}

function emptySlot() {
  return { nonce: null, ctx: null, issuedAt: null, consumed: false };
}

export function createS12Sender({ relayUrl, fetchImpl = fetch, now = () => Date.now() }) {
  if (typeof relayUrl !== "string" || relayUrl.length === 0) {
    throw new Error("relayUrl が必要です");
  }
  const base = relayUrl.replace(/\/+$/, "");
  let current = null;
  let busy = false;

  function mustCurrent(trialId) {
    if (current === null || current.trialId !== trialId) {
      fail("s12_trial_mismatch", "試行が現在の試行ではありません");
    }
    return current;
  }

  function assertIssuedNotConsumed(cur, slot) {
    const s = cur.slots[slot];
    if (s.nonce === null || s.ctx === null) {
      fail("s12_not_prepared", `${slot} の nonce が確保されていません`);
    }
    if (s.consumed) {
      fail("s12_not_prepared", `${slot} の nonce は消費済みです`);
    }
    return s;
  }

  function assertWithinWindow(s, atMs) {
    if (!(atMs < s.issuedAt + SLOT_SEND_WINDOW_MS)) {
      fail("s12_nonces_expired", "nonce の送信期限を過ぎています");
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
      fail("s12_slot_nonce_mismatch", "トークンの nonce がスロットの nonce と一致しません");
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
          // 返す（S5・S11 送信器と同じ固定値）。
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
    // （S11 送信器と同じ）。error 文字列があるのに許可一覧に
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
      error: normalizeS12ResponseError(error),
      generation: data && Number.isInteger(data.generation) ? data.generation : null,
    };
  }

  return {
    // 新しい試行を開始する。4スロットを空にする。秘密は試行の
    // 外に持ち出さない。
    beginTrial(trialId) {
      if (current !== null && current.trialId === trialId) {
        fail("s12_trial_mismatch", "同じ試行が既に開始されています");
      }
      const slots = {};
      for (const slot of S12_SLOTS) slots[slot] = emptySlot();
      current = { trialId, slots, frozenRevokeTarget: null };
      return true;
    },
    // 失効対象の固定：画面が失効要求を凍結した時点で、凍結済み
    // 要求の対象（手順1で保持した B の主体ハッシュ）を登録する。
    // 以後の sendRevoke は、この固定値と一致する要求だけを受け
    // 付ける。固定は試行ごとに1回だけ（同じ値の再登録は冪等、
    // 異なる値は s12_revoke_target_mismatch で拒否）。固定値は
    // メモリー内だけに保持し、戻り値には含めない。
    freezeRevokeTarget({ trialId, subjectHash }) {
      if (busy) {
        fail("s12_sender_busy", "別の送信または発行が進行中です");
      }
      const cur = mustCurrent(trialId);
      if (typeof subjectHash !== "string" || !/^[0-9a-f]{64}$/.test(subjectHash)) {
        fail("s12_revoke_target_fixed", "固定する失効対象の主体ハッシュが64桁の16進数ではありません");
      }
      if (cur.frozenRevokeTarget !== null) {
        if (cur.frozenRevokeTarget === subjectHash) return true;
        fail("s12_revoke_target_mismatch", "失効対象は既に別の主体ハッシュで固定されています");
      }
      // 固定は手順1の保持（heldB の発行）の後、失効の送信の前で
      // なければならない。
      if (cur.slots.heldB.nonce === null) {
        fail("s12_not_prepared", "保持トークン（heldB）が確保される前に失効対象は固定できません");
      }
      if (cur.slots.revokeA.consumed) {
        fail("s12_not_prepared", "失効は送信済みです");
      }
      cur.frozenRevokeTarget = subjectHash;
      return true;
    },
    // スロットの nonce を発行する。発行開始時刻（発行 await の
    // 直前）を期限基準に固定する。戻り値は { nonce } のみ。
    // Cookie 値は戻さない。取得済みスロットの再発行は
    // s12_slot_already_issued。取得の失敗はスロットを空に戻し
    // s12_nonce_issuance_failed を投げる。
    async issueNonce({ trialId, slot }) {
      if (busy) {
        fail("s12_sender_busy", "別の送信または発行が進行中です");
      }
      busy = true;
      try {
        const cur = mustCurrent(trialId);
        requireSlotName(slot);
        const s = cur.slots[slot];
        if (s.nonce !== null) {
          fail("s12_slot_already_issued", `${slot} の nonce は既に発行済みです`);
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
          fail("s12_nonce_issuance_failed", "nonce の取得に失敗しました");
        }
        const data = await res.json().catch(() => null);
        const setCookies =
          typeof res.headers.getSetCookie === "function"
            ? res.headers.getSetCookie()
            : [];
        const ctx = extractNonceCtx(setCookies);
        if (!res.ok || !data || !data.nonce || !ctx) {
          s.issuedAt = null;
          fail("s12_nonce_issuance_failed", "nonce の取得に失敗しました");
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
      if (!S12_SLOTS.includes(slot)) return null;
      return cur.slots[slot].issuedAt;
    },
    // スロットが消費済みかどうか。
    slotConsumed(trialId, slot) {
      const cur = current;
      if (cur === null || cur.trialId !== trialId) return false;
      if (!S12_SLOTS.includes(slot)) return false;
      return cur.slots[slot].consumed;
    },
    // 手順2：revokeA のスロットを消費して失効を1回だけ送る。
    // 送信前確認（保持トークンの鮮度・nonce 一致・対象の結び
    // 付け（凍結時の固定値との一致）・期待世代・送信窓）の
    // どれか1つでも失敗したら1件も送らない。
    async sendRevoke({ trialId, request }) {
      if (busy) {
        fail("s12_sender_busy", "別の送信または発行が進行中です");
      }
      const cur = mustCurrent(trialId);
      const s = assertIssuedNotConsumed(cur, "revokeA");
      // (1) 保持トークンの鮮度：heldB が発行済み・未消費であり、
      // 発行開始からの経過が HELD_MAX_AGE_AT_REVOKE_MS 以内。
      const held = cur.slots.heldB;
      if (held.nonce === null || held.consumed) {
        fail("s12_not_prepared", "保持トークン（heldB）が確保されていません");
      }
      if (now() - held.issuedAt > HELD_MAX_AGE_AT_REVOKE_MS) {
        fail(
          "s12_held_token_stale",
          "保持トークンの発行開始から時間が過ぎているため失効を送りません。試行を破棄して取得からやり直してください"
        );
      }
      // (2) nonce の一致。
      assertTokenMatchesSlot(s, request);
      // (3) 対象の結び付け：要求の subject_hash が、凍結時に
      // freezeRevokeTarget で固定した対象と一致すること。固定値
      // は状態機械が手順1の B から作る凍結済み要求の対象であり、
      // 送信されてきた要求の値だけでは決まらない。一致しなけれ
      // ば1件も送らない（スロットも消費しない）。
      if (typeof request.subject_hash !== "string" || request.subject_hash.length === 0) {
        fail("s12_revoke_target_fixed", "失効対象の主体ハッシュが要求にありません");
      }
      if (cur.frozenRevokeTarget === null) {
        fail("s12_revoke_not_frozen", "失効対象が送信器に固定されていません");
      }
      if (request.subject_hash !== cur.frozenRevokeTarget) {
        fail("s12_revoke_target_mismatch", "失効対象が凍結時に固定した対象と一致しません");
      }
      // (4) 期待世代の固定値。
      if (request.expected_generation !== REVOKE_EXPECTED_GENERATION) {
        fail("s12_unexpected_generation", "期待世代が S12 手順の固定値ではありません");
      }
      // (5) revokeA の送信窓。
      assertWithinWindow(s, now());
      s.consumed = true;
      busy = true;
      try {
        return await postAdmin(REVOKE_PATH, s, request);
      } finally {
        busy = false;
      }
    },
    // 手順3・4・5：指定スロットを消費して verify-only へ1回だけ
    // 送る。対象スロットは freshB / heldB / checkC。revokeA は
    // 失効専用であり、ここでは拒否する。スロットの送信窓を
    // 過ぎていたら s12_nonces_expired で送信自体を拒否する
    // （提示は未実施）。
    async sendVerifyOnly({ trialId, slot, request }) {
      if (busy) {
        fail("s12_sender_busy", "別の送信または発行が進行中です");
      }
      const cur = mustCurrent(trialId);
      requireSlotName(slot);
      if (slot === "revokeA") {
        fail("s12_bad_slot", "revokeA は失効専用であり verify-only には使えません");
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
      for (const slot of S12_SLOTS) {
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
        // 失効対象が固定済みかどうかだけ（固定値そのものは出さない）。
        revokeTargetFrozen: current.frozenRevokeTarget !== null,
      });
    },
  };
}
