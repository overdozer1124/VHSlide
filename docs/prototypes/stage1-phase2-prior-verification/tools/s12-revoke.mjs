// S12（項目6 手順5：運営者 B の失効）専用の純粋モジュール。
//
// 目的：S12 の手順を、専用画面（public/s12-revoke.html）と送信器
// （tools/s12-sender.mjs）から安全に行うための状態機械と検証を
// 提供する。表示・ログ・Issue・チャットに ID トークン・Cookie・
// nonce・主体ハッシュを出さない（主体ハッシュの表示は PC 画面の
// DOM だけ。S10・S11 と同じ扱い）。
//
// 実ビルド（src/worker.js）で確認した失効の仕様（本モジュールの
// 前提。行番号は本モジュール作成時点の src/worker.js）：
// - POST /admin/registry/revoke の本体は { id_token, subject_hash,
//   expected_generation }（worker.js の fetch がパスから action
//   "revoke" を決め、/do/admin へ渡す）。
// - RegistryDO の単一トランザクション内で、順に (1) nonce の消費
//   （consumeNonce。未知は 401 unknown_nonce、再送は 403
//   nonce_replayed、期限切れは 401 nonce_expired、文脈不一致は
//   403 nonce_context_mismatch）、(2) 呼び出し元の運営者在籍
//   （不在は 403 not_operator）、(3) 世代照合
//   （expected_generation が現在世代と異なれば 409
//   stale_generation）、(4) 対象の在籍（不在は 404
//   target_not_member）、(5) 最後の運営者の保護（運営者が1人
//   以下なら 409 last_operator）、(6) 対象行の削除と世代 +1、
//   200 { ok: true, generation } を返す。
// - POST /admin/verify-only の本体は { id_token }。nonce の消費と
//   在籍照合だけを行い、運営者なら 200 { ok: true, generation }、
//   非運営者なら 403 not_operator を返す。在籍は提示時点の登録簿
//   で判定される（発行時点ではない）。verify-only も nonce を
//   消費するため、トークンは提示1回限りである。
// - nonce の有効期限は発行から5分（S12_NONCE_TTL_MS = 5 * 60 * 1000、
//   Cookie の Max-Age も 300）。
//
// S12 の手順（固定順）：
//   1. B の新しい実トークンを取得し、未使用のまま保持する
//      （失効前トークン。スロット heldB）。
//   2. 運営者 A の認可で B の失効を送る（expected_generation = 4、
//      スロット revokeA）。期待は 200 ok・generation 5。
//   3. B の新しいトークン（別ログイン、スロット freshB）で
//      verify-only を提示する。期待は 403 not_operator。
//   4. 手順1で保持した失効前トークン（スロット heldB）を
//      verify-only へ提示する。期待は 403 not_operator（提示時点
//      の登録簿で判定されることの確認）。
//   5. C のトークン（スロット checkC）で verify-only を提示
//      する。期待は 200 ok（登録簿 {A, C} が生きている健全性
//      確認）。
// 終了時の固定状態：generation 5・登録簿 {A, C}、consumed=2・
// completion=2（登録簿操作はプラットフォームの操作IDを消費
// しない）。
//
// 保持トークンのタイミング設計（本ツールの要点）：
// - 手順1のトークンは、手順4の提示まで nonce の有効期限（発行
//   から5分）内であり続けなければならない。拘束条件はトークン
//   の exp（約1時間）ではなく nonce の期限である。
// - 送信器はスロットごとに、発行開始時刻から4分以内
//   （SLOT_SEND_WINDOW_MS。S5・S11 送信器と同じ保守的な規則）
//   の送信だけを許可する。したがって手順4の提示は、手順1の
//   発行開始から4分以内に終える必要がある。
// - 失効の送信（手順2）の前に、状態機械と送信器の両方が、保持
//   トークンの残り時間を機械確認する。失効送信の時点で保持
//   トークンの経過が HELD_MAX_AGE_AT_REVOKE_MS（= 送信窓4分
//   − 予備 POST_REVOKE_RESERVE_MS 2分 = 2分）を超えていたら、
//   1件も送らずに試行を破棄して取得からやり直す
//   （s12_held_token_stale）。予備の2分は、手順3の再ログインと
//   手順3・4の提示を終えるための見積もりである。
// - 実際に手順4の提示が送信窓を過ぎた場合は、送信器が
//   s12_nonces_expired で送信自体を拒否する（その場合は手順4
//   は未実施として記録し、成功として扱わない）。
//
// 機械的な確認（送信前に状態機械・送信器が強制する）：
// - 手順3の B の主体が、手順1の B の主体（＝失効対象）と同一で
//   あること（subject_mismatch で停止）。
// - 認可者 A の主体が B と異なること（wrong_authorizer で停止）。
// - C の主体が A・B のどちらとも異なること（wrong_subject で
//   停止）。
// - 順序の固定：保持トークンの提示は手順3の提示より前には
//   できない（状態機械の段階で拒否）。失効は保持トークンの
//   取得と鮮度確認より前には送れない。各提示は1回限りで、
//   失効の再送手段はない。
//
// - このモジュールはネットワーク通信を一切行わない。Node
//   （試験・送信器）とブラウザー（画面）の両方から同じ実装を
//   使う。秘密の比較は呼び出し側のメモリー内だけで行い、この
//   モジュールは値を保存・出力しない。
// - トークン消去の契機は S12_TOKEN_ERASE_TRIGGERS に明記する
//   （A のトークンは失効の送信後、B の保持トークンは手順4の
//   提示後、他は S11 と同じ）。

import { normalizeResponseError } from "./trial-apply.mjs";

// S12 の失効操作の固定値。送信先と action、期待世代は手順書
// §4.3 項目6 手順5と §4.7 S12 の固定状態（開始前 generation 4）
// から決まる定数であり、画面からの入力では変えられない。
export const REVOKE_ACTION = "revoke";
export const REVOKE_PATH = "/admin/registry/revoke";
export const VERIFY_ONLY_PATH = "/admin/verify-only";
// S12 開始前の現在世代。失効要求が指定する期待世代でもある。
export const REVOKE_EXPECTED_GENERATION = 4;
// 失効の成功後に返される世代（開始前＋1）。
export const EXPECTED_REVOKE_FINAL_GENERATION = REVOKE_EXPECTED_GENERATION + 1;

// 失効の期待応答。200 ok で generation が 5 であること。
export const EXPECTED_REVOKE_RESPONSE = Object.freeze({
  status: 200,
  generation: EXPECTED_REVOKE_FINAL_GENERATION,
});
// 失効後の B の提示（手順3・手順4）の期待応答。
export const EXPECTED_NOT_OPERATOR_RESPONSE = Object.freeze({
  status: 403,
  error: "not_operator",
});
// C の健全性確認（手順5）の期待応答。200 ok であること。
export const EXPECTED_VERIFY_OK_RESPONSE = Object.freeze({ status: 200 });

// スロット（役割）。heldB は手順1の保持用 B、revokeA は手順2の
// 認可者 A、freshB は手順3の新しい B、checkC は手順5の C。
// 送信器のスロット名と画面・状態機械の役割名は同じ文字列を使う。
export const S12_SLOTS = Object.freeze(["heldB", "revokeA", "freshB", "checkC"]);

// 送信器の局所コード：応答が返らなかった要求（再送しない）。
export const S12_NO_RESPONSE = "no_response";
// 送信器の局所コード：3xx の応答を追従せず、再送なしの失敗として
// 記録した要求（送信器が redirect: "manual" で受けた 3xx。Worker
// の理由コードではない）。
export const S12_REDIRECT_NOT_FOLLOWED = "redirect_not_followed";

// タイミングの定数。nonce の有効期限は5分（実ビルドの
// S12_NONCE_TTL_MS）。送信器のスロット送信窓は、発行開始時刻から
// 4分（S5・S11 送信器と同じ保守的な規則。起点は要求開始時刻
// であり、応答受信時刻ではない）。
export const S12_NONCE_TTL_MS = 5 * 60 * 1000;
export const SLOT_SEND_WINDOW_MS = 4 * 60 * 1000;
// 失効の送信後に、手順3の再ログインと手順3・4の提示を終える
// ために確保する予備時間。
export const POST_REVOKE_RESERVE_MS = 2 * 60 * 1000;
// 失効を送ってよい保持トークンの経過上限（送信窓 − 予備）。
// これを超えたら失効を送らず、試行を破棄して取得からやり直す。
export const HELD_MAX_AGE_AT_REVOKE_MS = SLOT_SEND_WINDOW_MS - POST_REVOKE_RESERVE_MS;

// トークン消去の契機。消去そのものは呼び出し側（ブラウザー画面）
// がメモリー内の変数を空にして行う。消去を忘れてはならない契機
// をここに列挙し、画面と試験で参照する。s11-parallel.mjs の
// 同種の定数とは別物であるため、S12 のものには接頭辞を付ける
// （画面試験で複数モジュールを結合するため、同名の const は
// 重複宣言になる）。
export const S12_TOKEN_ERASE_TRIGGERS = Object.freeze([
  "revoke-sent", // 手順2の失効送信後（A の認可トークンは消費済み。再利用しない）
  "held-presented", // 手順4の提示後（B の保持トークンは消費済み。再利用しない）
  "s12-completed", // S12 完了（手順5まで期待どおり）
  "s12-halted", // S12 停止（期待外れ応答・応答なし・機械確認の失敗）
  "trial-discarded", // 試行の破棄（破棄ボタン・捕捉時の検証失敗）
  "new-trial-begun", // 新規試行の開始（旧試行の無効化と同時に旧トークンを消去）
]);

// 各役割の GIS コールバックが有効な段階。heldB は start、
// revokeA は held-captured、freshB は revoke-sent、checkC は
// heldb-presented のときにだけ有効である。
const CALLBACK_PHASES = Object.freeze({
  heldB: "start",
  revokeA: "held-captured",
  freshB: "revoke-sent",
  checkC: "heldb-presented",
});

// 各役割の nonce 取得を始められる段階（コールバックの段階と同じ）。
const NONCE_PHASES = CALLBACK_PHASES;

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

// 主体ハッシュの形式（SHA-256 の 64桁 hex）。画面が PC 内署名検証
// で算出した値を渡すときの形式確認。値そのものは例外文に含めない。
function requireSubjectHash(value, what) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    fail("bad_trial_input", `${what} が64桁の16進数ではありません`);
  }
  return value;
}

// PC 内署名検証の結果。画面が verifyIdTokenLocal の成功を受けて
// 渡す。署名・iss・aud・exp・nonce のすべてが真であること。1つ
// でも偽・未指定なら、検証が通っていないものとして拒否する。
function requireVerified(verified, what) {
  const keys = ["signature", "iss", "aud", "exp", "nonce"];
  if (!verified || typeof verified !== "object") {
    fail("verification_incomplete", `${what} の検証結果がありません`);
  }
  for (const key of keys) {
    if (verified[key] !== true) {
      fail("verification_incomplete", `${what} の検証が通っていません`);
    }
  }
  return true;
}

function requireSlot(slot) {
  if (!S12_SLOTS.includes(slot)) {
    fail("bad_trial_input", "スロットが heldB / revokeA / freshB / checkC ではありません");
  }
  return slot;
}

// 保持トークンの鮮度。heldIssuedAtMs は手順1の nonce 発行開始
// 時刻（保守的な起点）であり、nowMs との差で測る。
// - ageMs：発行開始からの経過。
// - remainingMs：送信窓（発行開始＋4分）までの残り。マイナスは
//   送信窓を過ぎたことを示す。
// - enoughForRevoke：失効を送ってよい鮮度（経過が
//   HELD_MAX_AGE_AT_REVOKE_MS 以下）かどうか。手順3・4に必要な
//   予備（POST_REVOKE_RESERVE_MS）が残っていることと等しい。
export function heldTokenFreshness(heldIssuedAtMs, nowMs) {
  if (!Number.isFinite(heldIssuedAtMs) || !Number.isFinite(nowMs)) {
    fail("bad_trial_input", "保持トークンの時刻が数値ではありません");
  }
  const ageMs = nowMs - heldIssuedAtMs;
  const remainingMs = heldIssuedAtMs + SLOT_SEND_WINDOW_MS - nowMs;
  return deepFreeze({
    ageMs,
    remainingMs,
    enoughForRevoke: ageMs <= HELD_MAX_AGE_AT_REVOKE_MS,
    withinWindow: remainingMs > 0,
  });
}

// 送信する失効要求オブジェクトを作り、深く凍結して返す。値は
// 凍結済み要求の表示（displayData）から取る。手入力の値は使わない。
export function buildS12RevokeRequest({ idToken, subjectHash, expectedGeneration }) {
  requireNonEmptyString(idToken, "ID トークン");
  requireSubjectHash(subjectHash, "対象の主体ハッシュ");
  if (!Number.isInteger(expectedGeneration) || expectedGeneration < 0) {
    fail("bad_trial_input", "期待世代が 0 以上の整数ではありません");
  }
  return deepFreeze({
    id_token: idToken,
    subject_hash: subjectHash,
    expected_generation: expectedGeneration,
  });
}

// verify-only の提示要求オブジェクトを作り、深く凍結して返す。
// 本体は { id_token } だけである（実ビルドの仕様）。
export function buildS12VerifyOnlyRequest({ idToken }) {
  requireNonEmptyString(idToken, "ID トークン");
  return deepFreeze({ id_token: idToken });
}

// 応答の理由コードを正規化する。応答が返らなかった要求の局所
// コード "no_response" と、3xx 非追従の局所コード
// "redirect_not_followed" はそのまま通す。成功応答は理由コードを
// 持たないため、null / undefined はそのまま null として通す。
export function normalizeS12ResponseError(error) {
  if (error === null || error === undefined) return null;
  if (error === S12_NO_RESPONSE) return S12_NO_RESPONSE;
  if (error === S12_REDIRECT_NOT_FOLLOWED) return S12_REDIRECT_NOT_FOLLOWED;
  return normalizeResponseError(error);
}

// verify-only の応答1件を期待と照合する内部関数。kind は
// "not_operator"（手順3・4）または "ok"（手順5）。
function matchVerifyOnly(response, kind) {
  if (response === null || response === undefined) return "undetermined";
  if (typeof response.status !== "number") {
    fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
  }
  const error = normalizeS12ResponseError(response.error);
  if (kind === "not_operator") {
    return response.status === EXPECTED_NOT_OPERATOR_RESPONSE.status &&
      error === EXPECTED_NOT_OPERATOR_RESPONSE.error
      ? "matched"
      : "mismatched";
  }
  return response.status === EXPECTED_VERIFY_OK_RESPONSE.status && error === null
    ? "matched"
    : "mismatched";
}

// S12 試行の状態機械。許可する順序は B の保持トークン取得 →
// A の認可 → 失効の凍結 → 失効の送信 → 新しい B の取得 →
// 新しい B の提示 → 保持トークンの提示 → C の取得 → C の提示。
// 応答なしは状態未確定として停止し、再送を許可しない。各役割
// の捕捉は claimCallbackCapture で1回に固定する。nonce の取得
// も試行・役割に閉じ込める。beginNonceFetch は取得要求の開始
// 直前に同期的に呼び、開始時刻（startedAtMs）を試行に記録する。
export function createS12Session() {
  let current = null;
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
    // 新しい S12 試行を始める。前回の試行を無効化する（旧トークン
    // の消去は呼び出し側が S12_TOKEN_ERASE_TRIGGERS の
    // "new-trial-begun" で行う）。開始直後の段階は start である。
    beginTrial() {
      generation += 1;
      const trialId = makeTrialId();
      current = {
        trialId,
        generation,
        phase: "start",
        heldCapture: null, // { subjectHash, verified }（手順1の B）
        heldIssuedAtMs: null, // 手順1の nonce 発行開始時刻
        authorizerHash: null, // 手順2の認可者（A）の主体ハッシュ
        authorizerCapture: null, // { subjectHash, verified }
        freshBCapture: null, // { subjectHash, verified }（手順3の B）
        cCapture: null, // { subjectHash, verified }（手順5の C）
        claimed: { heldB: false, revokeA: false, freshB: false, checkC: false },
        nonces: { heldB: null, revokeA: null, freshB: null, checkC: null },
        frozenRevoke: null, // { action, subjectHash, expectedGeneration, path }
        undetermined: false,
      };
      return deepFreeze({ trialId, generation });
    },
    isCurrent(trialId, gen) {
      return (
        current !== null && current.trialId === trialId && current.generation === gen
      );
    },
    // GIS コールバックが現行の試行・役割・段階に属するかを照合
    // する。役割ごとに有効な段階が決まっている（CALLBACK_PHASES）。
    // 古い試行・役割外・段階外のコールバックは偽を返す。画面は
    // onGoogleSignIn の各 await の後でこれを呼び、遅延・破棄・
    // 新試行・役割移行をまたいだ古い／重複コールバックが共有の
    // 状態へ書き込むのを防ぐ（S11 と同じ型）。
    isCallbackCurrent(trialId, gen, role) {
      if (!this.isCurrent(trialId, gen)) return false;
      if (!S12_SLOTS.includes(role)) return false;
      return current.phase === CALLBACK_PHASES[role];
    },
    // 役割ごとの捕捉は1回だけ受け付ける。コールバックは受付の
    // 時点でこの claim を取り、受付済み・処理中の同一試行・役割
    // への後続コールバックは偽を返して拒否させる。claim は試行に
    // 閉じ込めるため、新しい試行は前の試行の claim に妨げられない。
    claimCallbackCapture(trialId, gen, role) {
      if (!this.isCallbackCurrent(trialId, gen, role)) return false;
      if (current.claimed[role]) return false;
      current.claimed[role] = true;
      return true;
    },
    // nonce 取得の開始を試行に記録する。役割ごとに許可された段階
    // のときにだけ始められる。取得中の再取得は nonce_fetch_busy、
    // 取得済みの再取得は nonce_already_issued で拒否する。古い
    // 試行は stale_attempt。startedAtMs は画面が送信器へ発行を
    // 依頼する直前の時刻であり、期限の保守的な起点になる。
    beginNonceFetch(trialId, gen, role, startedAtMs) {
      const cur = requireCurrent(trialId, gen);
      requireSlot(role);
      if (cur.phase !== NONCE_PHASES[role]) {
        fail("trial_order", `${role} の nonce 取得を始められる段階ではありません`);
      }
      if (!Number.isFinite(startedAtMs)) {
        fail("bad_trial_input", "nonce 要求の開始時刻が数値ではありません");
      }
      if (cur.nonces[role] && cur.nonces[role].state === "pending") {
        fail("nonce_fetch_busy", "nonce の取得中です");
      }
      if (cur.nonces[role] && cur.nonces[role].state === "issued") {
        fail("nonce_already_issued", "nonce は既に取得済みです");
      }
      cur.nonces[role] = { startedAtMs, state: "pending", nonce: null };
      return deepFreeze({ trialId, generation: gen, role, startedAtMs });
    },
    // nonce 取得の応答を試行に適用する。現行の試行・取得中のもの
    // に限る。遅れて戻った旧試行の応答・破棄後の応答は null を
    // 返して適用しない。適用時は期限の起点として要求開始時刻
    // （startedAtMs）をそのまま返す（応答の受信時刻は使わない）。
    finishNonceFetch(trialId, gen, role, nonce) {
      if (!this.isCurrent(trialId, gen)) return null;
      if (!S12_SLOTS.includes(role)) return null;
      const req = current.nonces[role];
      if (!req || req.state !== "pending") return null;
      if (typeof nonce !== "string" || nonce.length === 0) return null;
      req.state = "issued";
      req.nonce = nonce;
      return deepFreeze({ nonce, issuedAtMs: req.startedAtMs });
    },
    // 試行に記録された nonce 期限の起点（要求開始時刻）。未取得
    // なら null。古い試行は stale_attempt。
    nonceIssuedAt(trialId, gen, role) {
      const cur = requireCurrent(trialId, gen);
      requireSlot(role);
      const req = cur.nonces[role];
      if (!req || req.state !== "issued") return null;
      return req.startedAtMs;
    },
    // 試行の nonce 取得が飛行中かどうか。古い試行は偽。
    isNonceFetchPending(trialId, gen, role) {
      if (!this.isCurrent(trialId, gen)) return false;
      if (!S12_SLOTS.includes(role)) return false;
      const req = current.nonces[role];
      return !!req && req.state === "pending";
    },
    // 保持トークンの鮮度（手順1の発行開始時刻基準）。保持トークン
    // 未取得なら null。画面の表示と失効前の確認に使う。値は秘密を
    // 含まない（時刻と差分だけ）。
    heldFreshness(trialId, gen, nowMs) {
      const cur = requireCurrent(trialId, gen);
      if (cur.heldIssuedAtMs === null) return null;
      return heldTokenFreshness(cur.heldIssuedAtMs, nowMs);
    },
    // 手順1：B の保持トークンの取得完了。画面が PC 内署名検証を
    // 通した結果を渡す。start のときにだけ held-captured へ進む。
    // 保持の起点は heldB の nonce 発行開始時刻であり、ここで
    // 試行に固定する（以後の鮮度確認はこの時刻で測る）。この
    // トークンは失効が済むまで提示しない。
    markHeldBCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "start") {
        fail("trial_order", "試行が保持トークン取得の段階ではありません");
      }
      if (!cur.nonces.heldB || cur.nonces.heldB.state !== "issued") {
        fail("trial_order", "heldB の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "B の主体ハッシュ");
      requireVerified(verified, "B の署名検証");
      cur.heldCapture = { subjectHash, verified: { ...verified } };
      cur.heldIssuedAtMs = cur.nonces.heldB.startedAtMs;
      cur.phase = "held-captured";
      return true;
    },
    // 手順2の前段：A の認可の完了。held-captured のときにだけ
    // authorizer-captured へ進む。認可者の主体ハッシュが B と
    // 同一の場合は wrong_authorizer で試行を停止する（認可者は
    // 運営者 A でなければならない。B でログインした場合は保持
    // した B のハッシュと一致するため機械的に検出できる）。
    markAuthorizerCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "held-captured") {
        fail("trial_order", "試行が保持トークン取得の完了後ではありません");
      }
      if (!cur.nonces.revokeA || cur.nonces.revokeA.state !== "issued") {
        fail("trial_order", "revokeA の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "認可者の主体ハッシュ");
      requireVerified(verified, "認可者の署名検証");
      if (subjectHash === cur.heldCapture.subjectHash) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("wrong_authorizer", "認可者の主体ハッシュが B と同一です");
      }
      cur.authorizerCapture = { subjectHash, verified: { ...verified } };
      cur.authorizerHash = subjectHash;
      cur.phase = "authorizer-captured";
      return true;
    },
    // 手順2：失効要求を凍結する。authorizer-captured のときにだけ
    // 凍結できる。対象は手順1で保持した B の主体ハッシュ、期待
    // 世代は手順の固定値（REVOKE_EXPECTED_GENERATION = 4）で
    // あり、手入力の値は使わない。凍結の前に保持トークンの鮮度
    // を確認し、HELD_MAX_AGE_AT_REVOKE_MS を過ぎていれば
    // s12_held_token_stale で試行を停止する（失効を送ると手順4
    // の提示が送信窓に間に合わないため。破棄して取得から
    // やり直す）。画面はこの凍結内容を表示し、所有者の確認で
    // だけ送信指示を出す。
    freezeRevokeRequest(trialId, gen, nowMs) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "authorizer-captured") {
        fail("trial_order", "試行が A の認可の完了後ではありません");
      }
      const fresh = heldTokenFreshness(cur.heldIssuedAtMs, nowMs);
      if (!fresh.enoughForRevoke) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail(
          "s12_held_token_stale",
          "保持トークンの発行開始から時間が過ぎ、手順4の提示が送信窓に間に合いません。試行を破棄して取得からやり直してください"
        );
      }
      cur.frozenRevoke = {
        action: REVOKE_ACTION,
        subjectHash: cur.heldCapture.subjectHash,
        expectedGeneration: REVOKE_EXPECTED_GENERATION,
        path: REVOKE_PATH,
      };
      cur.phase = "revoke-frozen";
      return deepFreeze({
        trialId,
        action: cur.frozenRevoke.action,
        targetSubjectHash: cur.frozenRevoke.subjectHash,
        expectedGeneration: cur.frozenRevoke.expectedGeneration,
        path: cur.frozenRevoke.path,
      });
    },
    // 失効の凍結済み要求の表示内容。実際の凍結内容から生成する
    // （入力欄の値や画面の別表示からは作らない）。revoke-frozen
    // 以降の段階で読める。
    revokeDisplayData(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (!cur.frozenRevoke) {
        fail("trial_order", "失効要求が凍結されていません");
      }
      return deepFreeze({
        trialId: cur.trialId,
        action: cur.frozenRevoke.action,
        targetSubjectHash: cur.frozenRevoke.subjectHash,
        expectedGeneration: cur.frozenRevoke.expectedGeneration,
        path: cur.frozenRevoke.path,
      });
    },
    // 失効の要求を今送ってよいか。revoke-frozen で、保持トークン
    // の鮮度が失効可能な範囲のときにだけ真。送信直前の再確認に
    // 使う（凍結後に時間が過ぎた場合は送らない）。
    canSendRevoke(trialId, gen, nowMs) {
      if (!this.isCurrent(trialId, gen)) return false;
      if (current.phase !== "revoke-frozen") return false;
      return heldTokenFreshness(current.heldIssuedAtMs, nowMs).enoughForRevoke;
    },
    // 手順2：失効の送信結果を期待値と照合する。response が null
    // の場合は送信器が応答を得られなかった（状態未確定）であり、
    // 停止して再送を許可しない。期待は 200 ok・generation 5 で
    // あること。期待どおりなら revoke-sent へ進む。不一致なら
    // 試行を停止する（後段には進まない）。
    recordRevokeSend(trialId, gen, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "revoke-frozen") {
        fail("trial_order", "試行が失効の送信待ちの状態ではありません");
      }
      if (response === null || response === undefined) {
        cur.phase = "halted";
        cur.undetermined = true;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: true });
      }
      if (typeof response.status !== "number") {
        fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
      }
      const error = normalizeS12ResponseError(response.error);
      const matched =
        response.status === EXPECTED_REVOKE_RESPONSE.status &&
        error === null &&
        response.generation === EXPECTED_REVOKE_RESPONSE.generation;
      if (!matched) {
        cur.phase = "halted";
        cur.undetermined = false;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: false });
      }
      cur.phase = "revoke-sent";
      return deepFreeze({ trialId, matched: true, state: "revoke-sent", undetermined: false });
    },
    // 手順3の前段：新しい B の取得完了。revoke-sent のときにだけ
    // freshb-captured へ進む。主体ハッシュが手順1の B（失効対象）
    // と異なる場合は subject_mismatch で試行を停止する（別の
    // アカウントでログインした場合は、その提示結果では手順3の
    // 証拠にならないため）。
    markFreshBCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "revoke-sent") {
        fail("trial_order", "試行が失効の送信完了後ではありません");
      }
      if (!cur.nonces.freshB || cur.nonces.freshB.state !== "issued") {
        fail("trial_order", "freshB の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "新しい B の主体ハッシュ");
      requireVerified(verified, "新しい B の署名検証");
      if (subjectHash !== cur.heldCapture.subjectHash) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("subject_mismatch", "新しい B の主体ハッシュが失効対象の B と同一ではありません");
      }
      cur.freshBCapture = { subjectHash, verified: { ...verified } };
      cur.phase = "freshb-captured";
      return true;
    },
    // 手順3：新しい B の verify-only 提示結果を照合する。期待は
    // 403 not_operator。期待どおりなら freshb-presented へ進む。
    // 応答なしは状態未確定として停止する（提示の再送はしない）。
    recordFreshBVerifyOnly(trialId, gen, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "freshb-captured") {
        fail("trial_order", "試行が新しい B の提示待ちの状態ではありません");
      }
      const m = matchVerifyOnly(response, "not_operator");
      if (m === "undetermined") {
        cur.phase = "halted";
        cur.undetermined = true;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: true });
      }
      if (m !== "matched") {
        cur.phase = "halted";
        cur.undetermined = false;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: false });
      }
      cur.phase = "freshb-presented";
      return deepFreeze({ trialId, matched: true, state: "freshb-presented", undetermined: false });
    },
    // 手順4：保持トークン（手順1）の verify-only 提示結果を照合
    // する。freshb-presented のときにだけ呼べる（保持トークンを
    // 手順3より前に提示することは、状態機械の段階が許さない）。
    // 期待は 403 not_operator（提示時点の登録簿で判定される）。
    // 期待どおりなら heldb-presented へ進む。応答なしは状態
    // 未確定として停止する。
    recordHeldBVerifyOnly(trialId, gen, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "freshb-presented") {
        fail("trial_order", "保持トークンの提示は、新しい B の提示が期待どおりに終わった後にだけできます");
      }
      const m = matchVerifyOnly(response, "not_operator");
      if (m === "undetermined") {
        cur.phase = "halted";
        cur.undetermined = true;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: true });
      }
      if (m !== "matched") {
        cur.phase = "halted";
        cur.undetermined = false;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: false });
      }
      cur.phase = "heldb-presented";
      return deepFreeze({ trialId, matched: true, state: "heldb-presented", undetermined: false });
    },
    // 手順5の前段：C の取得完了。heldb-presented のときにだけ
    // c-captured へ進む。主体ハッシュが A・B のどちらかと同一の
    // 場合は wrong_subject で試行を停止する（C は A・B とは別の
    // 運営者でなければならない）。
    markCCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "heldb-presented") {
        fail("trial_order", "試行が保持トークンの提示完了後ではありません");
      }
      if (!cur.nonces.checkC || cur.nonces.checkC.state !== "issued") {
        fail("trial_order", "checkC の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "C の主体ハッシュ");
      requireVerified(verified, "C の署名検証");
      if (
        subjectHash === cur.authorizerHash ||
        subjectHash === cur.heldCapture.subjectHash
      ) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("wrong_subject", "C の主体ハッシュが A または B と同一です");
      }
      cur.cCapture = { subjectHash, verified: { ...verified } };
      cur.phase = "c-captured";
      return true;
    },
    // 手順5：C の verify-only 提示結果を照合する。期待は 200 ok
    // （登録簿 {A, C} の健全性確認）。期待どおりなら completed
    // へ進む。応答なしは状態未確定として停止する。
    recordCVerifyOnly(trialId, gen, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "c-captured") {
        fail("trial_order", "試行が C の提示待ちの状態ではありません");
      }
      const m = matchVerifyOnly(response, "ok");
      if (m === "undetermined") {
        cur.phase = "halted";
        cur.undetermined = true;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: true });
      }
      if (m !== "matched") {
        cur.phase = "halted";
        cur.undetermined = false;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: false });
      }
      cur.phase = "completed";
      return deepFreeze({ trialId, matched: true, state: "completed", undetermined: false });
    },
    // 試行の破棄。現行の試行なら無効化し（トークンの消去は呼び
    // 出し側が S12_TOKEN_ERASE_TRIGGERS の "trial-discarded" で
    // 行う）、古い試行に対しては無害に偽を返す。
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
        phase: cur.phase,
        heldCaptured: cur.heldCapture !== null,
        authorizerCaptured: cur.authorizerCapture !== null,
        revokeFrozen: cur.frozenRevoke !== null,
        freshBCaptured: cur.freshBCapture !== null,
        cCaptured: cur.cCapture !== null,
        undetermined: cur.undetermined,
      });
    },
    currentTrialId() {
      return current === null ? null : current.trialId;
    },
  };
}

// 試験 ID・ステップ・応答の状態と正規化された理由コードだけの
// 記録を返す。成功応答は error が null のまま通す。一覧にない
// 理由コードは unexpected_error へ置き換える。ID トークン・
// Cookie・nonce・主体ハッシュは含まない。
export function makeS12LogEntry({ trialId, step, response }) {
  requireNonEmptyString(trialId, "試験 ID");
  const steps = [
    "heldb-captured",
    "authorizer-captured",
    "revoke-frozen",
    "revoke-sent",
    "freshb-presented",
    "heldb-presented",
    "c-verified",
  ];
  if (!steps.includes(step)) {
    fail("bad_trial_input", "ステップが S12 のステップではありません");
  }
  if (!response || typeof response.status !== "number") {
    fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
  }
  return deepFreeze({
    trial_id: trialId,
    step,
    response: {
      status: response.status,
      error: normalizeS12ResponseError(response.error),
      generation:
        typeof response.generation === "number" ? response.generation : null,
    },
  });
}
