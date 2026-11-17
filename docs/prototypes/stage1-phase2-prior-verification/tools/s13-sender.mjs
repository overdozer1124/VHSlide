// S13（項目6 手順6：最後の運営者の保護）専用送信器（PC 側）。
//
// 役割：試行ごとに3つのスロット（revokeC / revokeA / checkA）を
// 保持し、スロットごとに独立した nonce 取得と Cookie 保持
// （op2_nonce_ctx）を行い、凍結済み要求をそれぞれ1回だけ提示
// する。トークン・nonce・Cookie の値を戻り値や例外に含めない。
//
// S13 には保持トークンがない（手順をまたいで
// 未使用のまま置くトークンは存在しない）。差は主に2点である。
// (1) 失効が2回ある（手順1 = C の失効・手順2 = A 自身の失効
// 試行）。対象の結び付け（freezeRevokeTarget）はスロット
// （手順）ごとに持ち、固定は手順ごとに1回限りとする。期待世代
// もスロットごとに固定値が異なる（revokeC = 5、revokeA = 6）。
// (2) 手順2の固定は、手順1の失効が送信済み（revokeC スロット
// 消費済み）のときにだけ受け付ける（送信器の境界でも順序を
// 守る）。鮮度ゲート（保持トークンの残り時間確認）は S13 には
// ない。代わりに、スロットごとの送信窓（発行開始時刻から4分）
// を過ぎた捕捉は s13_nonces_expired で拒否し、古い捕捉のまま
// 送らない規律を両方の失効と提示に適用する。
//
// スロットのライフサイクル：
// - issueNonce({ trialId, slot})：そのスロットの nonce を中継
// の /nonce から取得し、レスポンスの op2_nonce_ctx Cookie 値
// をスロットの Cookie Jar として保持する。nonce 発行済みの
// スロットの再発行は s13_slot_already_issued。nonce の発行は
// スロット単位で1回のみ。発行開始時刻（発行 await の直前）を
// スロットの期限基準（issuedAt）に固定する（Worker は /nonce
// の要求受理時に期限を始めるため、応答時刻より保守的）。
// - freezeRevokeTarget({ trialId, slot, subjectHash})：失効対象
// の固定（手順ごと）。画面がその手順の失効要求を凍結した時点
// で、凍結済み要求の対象（手順1は状態機械が対象取得で得た C、
// 手順2は認可者 A 自身）を送信器にも登録し、以後の sendRevoke
// はこの固定値と一致する要求だけを受け付ける（送信器の境界
// での対象の結び付け。S12 の df8024c0 の仕組みを手順ごとに
// 適用）。固定は手順ごとに1回だけであり、同じ値の再登録は
// 冪等に成功し、異なる値の再登録は
// s13_revoke_target_mismatch で拒否する。固定値は送信器の
// メモリー内だけに保持し、戻り値・snapshot・例外には含め
// ない（snapshot は固定済みかどうかの真偽だけを出す）。固定
// は、そのスロットが発行済みで未消費であり、かつ（手順2で
// は）手順1の失効が送信済みのときにだけ受け付ける（それ以外
// は s13_not_prepared）。
// - sendRevoke({ trialId, slot, request})：指定スロットを消費
// して /admin/registry/revoke へ1回だけ送る。送信前に次の
// すべてを確認する（1つでも欠ければ1件も送らず、スロットも
// 消費しない）：
// (1) スロットの確保済み nonce が要求の ID トークンの nonce
// 主張と一致（s13_slot_nonce_mismatch）。
// (2) 対象の結び付け：要求の subject_hash が、その手順の
// freezeRevokeTarget で固定した対象と一致すること。固定が
// まだ無い場合は s13_revoke_not_frozen、要求の対象が空の
// 場合は s13_revoke_target_fixed、固定値と異なる場合は
// s13_revoke_target_mismatch。
// (3) expected_generation がそのスロットの固定値であること
// （revokeC = 5、revokeA = 6。s13_unexpected_generation）。
// (4) スロットの送信窓（発行開始＋4分）内であること
// （s13_nonces_expired）。
// - sendVerifyOnly({ trialId, slot, request})：checkA スロット
// を消費して /admin/verify-only へ1回だけ送る。対象スロット
// は checkA のみ（revokeC / revokeA は失効専用）。スロットの
// 送信窓を過ぎていれば s13_nonces_expired で送信自体を拒否
// する（提示は未実施であり、成功として記録しない）。nonce
// 主張の一致も同じように確認する。
//
// その他の規則（S10〜S12 送信器と共通）：
// - 発行の確保は送信 assert の前に同期的に行い、発行済みでは
// 二重送信は不可能である。busy フラグで飛行中の送信の重複を
// 拒否する。
// - 中継 /nonce への GET は redirect: "manual"。中継の 3xx は
// 追従せず発行失敗として扱う。失効・提示の POST も
// redirect: "manual"。3xx は redirect_not_followed として
// 記録し、再送しない。
// - POST には固定の Origin（http://localhost:8787）を付ける
// （実ビルドの /admin/* は固定 Origin でなければ 403
// bad_origin を返す。S12 でガード試験が捉えた教訓）。
// - fetch 例外時は { status: null, error: "no_response"} を
// 返し、状態未確定として扱う（再送手段なし）。
// - 応答から持ち帰るのは { status, error（理由コードのみ）、
// generation} だけ。本体・nonce・Cookie・ハッシュは
// 持ち帰らない。

import { extractNonceCtx, tokenNonce} from "./s5-sender.mjs";
import {
REVOKE_PATH,
VERIFY_ONLY_PATH,
REVOKE_EXPECTED_GENERATION_BY_SLOT,
S13_SLOTS,
SLOT_SEND_WINDOW_MS,
normalizeS13ResponseError,
} from "./s13-revoke.mjs";

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
if (!S13_SLOTS.includes(slot)) {
fail("s13_bad_slot", "スロットが revokeC / revokeA / checkA ではありません");
}
return slot;
}

function requireRevokeSlot(slot) {
requireSlotName(slot);
if (slot === "checkA") {
fail("s13_bad_slot", "checkA は verify-only 専用であり失効には使えません");
}
return slot;
}

function emptySlot() {
return { nonce: null, ctx: null, issuedAt: null, consumed: false};
}

export function createS13Sender({ relayUrl, fetchImpl = fetch, now = () => Date.now()}) {
if (typeof relayUrl!== "string" || relayUrl.length === 0) {
throw new Error("relayUrl が必要です");
}
const base = relayUrl.replace(/\/+$/, "");
let current = null;
let busy = false;

function mustCurrent(trialId) {
if (current === null || current.trialId!== trialId) {
fail("s13_trial_mismatch", "試行が現在の試行ではありません");
}
return current;
}

function assertIssuedNotConsumed(cur, slot) {
const s = cur.slots[slot];
if (s.nonce === null || s.ctx === null) {
fail("s13_not_prepared", `${slot} の nonce が確保されていません`);
}
if (s.consumed) {
fail("s13_not_prepared", `${slot} の nonce は消費済みです`);
}
return s;
}

function assertWithinWindow(s, atMs) {
if (!(atMs < s.issuedAt + SLOT_SEND_WINDOW_MS)) {
fail("s13_nonces_expired", "nonce の送信期限を過ぎています");
}
}

function assertTokenMatchesSlot(s, request) {
let nonceInToken = null;
try {
nonceInToken = tokenNonce(request.id_token);
} catch {
nonceInToken = null;
}
if (nonceInToken!== s.nonce) {
fail("s13_slot_nonce_mismatch", "トークンの nonce がスロットの nonce と一致しません");
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
// 返す（S5・S11・S12 送信器と同じ固定値）。
Origin: "http://localhost:8787",
Cookie: `op2_nonce_ctx=${slotState.ctx}`,
},
body: JSON.stringify(request),
redirect: "manual",
});
} catch {
return { status: null, error: "no_response", generation: null};
}
if (res.status >= 300 && res.status < 400) {
return { status: res.status, error: "redirect_not_followed", generation: null};
}
const data = await res.json().catch(() => null);
// 成功応答は error を持たないため、その場合は null を通す
// （S11・S12 送信器と同じ）。error 文字列があるのに許可一覧に
// なければ unexpected_error に置き換える。
const rawError = data && data.error!== undefined? data.error: null;
const error =
rawError === null
? null
: VALID_REASONS.has(rawError)
? rawError
: "unexpected_error";
return {
status: res.status,
error: normalizeS13ResponseError(error),
generation: data && Number.isInteger(data.generation)? data.generation: null,
};
}

return {
// 新しい試行を開始する。3スロットを空にし、対象の固定も
// 手順ごとに空にする。秘密は試行の外に持ち出さない。
beginTrial(trialId) {
if (current!== null && current.trialId === trialId) {
fail("s13_trial_mismatch", "同じ試行が既に開始されています");
}
const slots = {};
for (const slot of S13_SLOTS) slots[slot] = emptySlot();
current = { trialId, slots, frozenTargets: { revokeC: null, revokeA: null}};
return true;
},
// 失効対象の固定（手順ごと）：画面がその手順の失効要求を
// 凍結した時点で、凍結済み要求の対象を登録する。以後の
// sendRevoke は、その手順についてこの固定値と一致する要求
// だけを受け付ける。固定は手順ごとに1回だけ（同じ値の再
// 登録は冪等、異なる値は s13_revoke_target_mismatch で
// 拒否）。固定値はメモリー内だけに保持し、戻り値には含め
// ない。固定できるのは、そのスロットが発行済みで未消費で
// あり、かつ（revokeA では）手順1の失効が送信済みのとき
// だけである。
freezeRevokeTarget({ trialId, slot, subjectHash}) {
if (busy) {
fail("s13_sender_busy", "別の送信または発行が進行中です");
}
const cur = mustCurrent(trialId);
requireRevokeSlot(slot);
if (typeof subjectHash!== "string" ||!/^[0-9a-f]{64}$/.test(subjectHash)) {
fail("s13_revoke_target_fixed", "固定する失効対象の主体ハッシュが64桁の16進数ではありません");
}
if (cur.frozenTargets[slot]!== null) {
if (cur.frozenTargets[slot] === subjectHash) return true;
fail("s13_revoke_target_mismatch", "失効対象は既に別の主体ハッシュで固定されています");
}
// 固定は、そのスロットの発行の後、その手順の失効の送信の
// 前でなければならない。
if (cur.slots[slot].nonce === null) {
fail("s13_not_prepared", `${slot} が確保される前に失効対象は固定できません`);
}
if (cur.slots[slot].consumed) {
fail("s13_not_prepared", `${slot} の失効は送信済みです`);
}
// 手順2の固定は、手順1の失効が送信済みのときにだけ受け
// 付ける（送信器の境界でも順序を守る）。
if (slot === "revokeA" &&!cur.slots.revokeC.consumed) {
fail("s13_not_prepared", "手順1の失効が送信される前に手順2の対象は固定できません");
}
cur.frozenTargets[slot] = subjectHash;
return true;
},
// スロットの nonce を発行する。発行開始時刻（発行 await の
// 直前）を期限基準に固定する。戻り値は { nonce} のみ。
// Cookie 値は戻さない。取得済みスロットの再発行は
// s13_slot_already_issued。取得の失敗はスロットを空に戻し
// s13_nonce_issuance_failed を投げる。
async issueNonce({ trialId, slot}) {
if (busy) {
fail("s13_sender_busy", "別の送信または発行が進行中です");
}
busy = true;
try {
const cur = mustCurrent(trialId);
requireSlotName(slot);
const s = cur.slots[slot];
if (s.nonce!== null) {
fail("s13_slot_already_issued", `${slot} の nonce は既に発行済みです`);
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
fail("s13_nonce_issuance_failed", "nonce の取得に失敗しました");
}
const data = await res.json().catch(() => null);
const setCookies =
typeof res.headers.getSetCookie === "function"
? res.headers.getSetCookie()
: [];
const ctx = extractNonceCtx(setCookies);
if (!res.ok ||!data ||!data.nonce ||!ctx) {
s.issuedAt = null;
fail("s13_nonce_issuance_failed", "nonce の取得に失敗しました");
}
s.nonce = data.nonce;
s.ctx = ctx;
return { nonce: data.nonce};
} finally {
busy = false;
}
},
// スロットの発行開始時刻（期限基準）。未発行なら null。
slotIssuedAt(trialId, slot) {
const cur = current;
if (cur === null || cur.trialId!== trialId) return null;
if (!S13_SLOTS.includes(slot)) return null;
return cur.slots[slot].issuedAt;
},
// スロットが消費済みかどうか。
slotConsumed(trialId, slot) {
const cur = current;
if (cur === null || cur.trialId!== trialId) return false;
if (!S13_SLOTS.includes(slot)) return false;
return cur.slots[slot].consumed;
},
// 手順1・手順2：指定スロットを消費して失効を1回だけ送る。
// 送信前確認（nonce 一致・対象の結び付け（その手順の固定値
// との一致）・期待世代のスロット固定値・送信窓）のどれか
// 1つでも失敗したら1件も送らず、スロットも消費しない。
async sendRevoke({ trialId, slot, request}) {
if (busy) {
fail("s13_sender_busy", "別の送信または発行が進行中です");
}
const cur = mustCurrent(trialId);
requireRevokeSlot(slot);
const s = assertIssuedNotConsumed(cur, slot);
// (1) nonce の一致。
assertTokenMatchesSlot(s, request);
// (2) 対象の結び付け：要求の subject_hash が、その手順の
// 凍結時に freezeRevokeTarget で固定した対象と一致する
// こと。固定値は状態機械が作る凍結済み要求の対象であり、
// 送信されてきた要求の値だけでは決まらない。一致しなけれ
// ば1件も送らない（スロットも消費しない）。
if (typeof request.subject_hash!== "string" || request.subject_hash.length === 0) {
fail("s13_revoke_target_fixed", "失効対象の主体ハッシュが要求にありません");
}
if (cur.frozenTargets[slot] === null) {
fail("s13_revoke_not_frozen", "失効対象が送信器に固定されていません");
}
if (request.subject_hash!== cur.frozenTargets[slot]) {
fail("s13_revoke_target_mismatch", "失効対象が凍結時に固定した対象と一致しません");
}
// (3) 期待世代のスロット固定値。
if (request.expected_generation!== REVOKE_EXPECTED_GENERATION_BY_SLOT[slot]) {
fail("s13_unexpected_generation", "期待世代がその手順の固定値ではありません");
}
// (4) スロットの送信窓。
assertWithinWindow(s, now());
s.consumed = true;
busy = true;
try {
return await postAdmin(REVOKE_PATH, s, request);
} finally {
busy = false;
}
},
// 手順3：checkA スロットを消費して verify-only へ1回だけ
// 送る。対象スロットは checkA のみ。revokeC / revokeA は
// 失効専用であり、ここでは拒否する。スロットの送信窓を
// 過ぎていたら s13_nonces_expired で送信自体を拒否する
// （提示は未実施）。
async sendVerifyOnly({ trialId, slot, request}) {
if (busy) {
fail("s13_sender_busy", "別の送信または発行が進行中です");
}
const cur = mustCurrent(trialId);
requireSlotName(slot);
if (slot!== "checkA") {
fail("s13_bad_slot", `${slot} は失効専用であり verify-only には使えません`);
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
for (const slot of S13_SLOTS) {
const s = current.slots[slot];
slots[slot] = {
nonceLen: s.nonce === null? 0: s.nonce.length,
ctxLen: s.ctx === null? 0: s.ctx.length,
issuedAt: s.issuedAt,
consumed: s.consumed,
};
}
return Object.freeze({
trialId: current.trialId,
slots,
// 手順ごとに、失効対象が固定済みかどうかだけ（固定値
// そのものは出さない）。
revokeTargetsFrozen: Object.freeze({
revokeC: current.frozenTargets.revokeC!== null,
revokeA: current.frozenTargets.revokeA!== null,
}),
});
},
};
}
