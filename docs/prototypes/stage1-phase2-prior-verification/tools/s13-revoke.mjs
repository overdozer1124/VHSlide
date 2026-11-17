// S13（項目6 手順6：最後の運営者の保護）専用の純粋モジュール。
//
// 目的：S13 の手順を、専用画面（public/s13-revoke.html）と送信器
// （tools/s13-sender.mjs）から安全に行うための状態機械と検証を
// 提供する。表示・ログ・Issue・チャットに ID トークン・Cookie・
// nonce・主体ハッシュを出さない（主体ハッシュの表示は PC 画面の
// DOM だけ。S10〜S12 と同じ扱い）。
//
// 実ビルド（src/worker.js）で確認した失効の仕様（本モジュールの
// 前提。S12 モジュールで確認済みのものと同じ）：
// - POST /admin/registry/revoke の本体は { id_token, subject_hash,
//   expected_generation }。
// - RegistryDO の単一トランザクション内で、順に (1) ID トークン
//   の検証、(2) nonce の消費（未知は 401 unknown_nonce、再送は
//   403 nonce_replayed、期限切れは 401 nonce_expired、文脈不一
//   致は 403 nonce_context_mismatch。verify-only を含むすべての
//   管理提示が nonce を消費するため、トークンは提示1回限り）、
//   (3) 呼び出し元の運営者在籍（不在は 403 not_operator）、
//   (4) verify-only なら 200 { ok: true, generation } を返して
//   終了、(5) 世代照合（expected_generation が現在世代と異な
//   れば 409 stale_generation）、(6) 対象の在籍（不在は 404
//   target_not_member）、(7) 最後の運営者の保護（運営者が1人
//   以下なら 409 last_operator）、(8) 対象行の削除と世代 +1、
//   200 { ok: true, generation } を返す。
// - 在籍は提示時点の登録簿で判定される（発行時点ではない）。
// - nonce の有効期限は発行から5分（NONCE_TTL_MS = 5 * 60 *
//   1000、Cookie の Max-Age も 300）。
// - /admin/* は固定の Origin（http://localhost:8787）でなけれ
//   ば 403 bad_origin を返す。
//
// S13 の手順（固定順）。開始時の実状態は S12 終了時（generation
// 5・登録簿 {A, C}・consumed=2・completion=2）：
//   0. 失効対象 C の主体ハッシュを取得する（対象取得。この
//      トークンは管理操作には提示しない。S10・S11 の対象取得と
//      同じ型）。
//   1. revokeC：運営者 A の新しい実トークンで、C を対象に失効
//      を送る（expected_generation = 5）。期待は 200 ok・
//      generation 6・登録簿 {A}。
//   2. revokeA：A の別の新しいトークンで、A 自身を対象に失効
//      を送る（expected_generation = 6）。期待は 409
//      last_operator であり、状態は変わらない。この拒否が本
//      手順の合格（PASS）である（失敗ではない）。
//   3. checkA：A の新しいトークンで verify-only を提示する。
//      期待は 200 ok（唯一の運営者 A が残って操作できること
//      の確認）。
// 終了時の固定状態：generation 6・登録簿 {A}、consumed=2・
// completion=2（登録簿操作はプラットフォームの操作IDを消費
// しない。手順2の拒否でも状態は変わらない）。
//
// 順序の強制（状態機械の段階で機械的に守る）：
// - 手順2（revokeA）の凍結・送信は、手順1（revokeC）が期待
//   どおり 200 で記録されるまでできない（段階 revokec-sent
//   に進んでいなければ、revokeA の取得自体も始められない）。
// - 手順3（checkA）の取得・提示は、手順2の結果が期待どおり
//   （409 last_operator）記録されるまでできない。
// - 各提示・送信は1回限りで、再送の手段はない。応答なしは
//   状態未確定として停止する。
//
// 機械的な確認（送信前に状態機械・送信器が強制する）：
// - 認可者 A の主体が失効対象 C と異なること（同一なら
//   wrong_authorizer で停止）。
// - 手順2・手順3の A の主体が、手順1の認可者 A と同一である
//   こと（異なれば wrong_authorizer で停止。手順2の対象は
//   「手順1の認可者自身」でなければならない）。
// - 失効対象は送信器の境界でも結び付ける：画面が各失効要求を
//   凍結した時点で、凍結済み要求の対象を送信器にも登録し
//   （freezeRevokeTarget）、送信器は登録値と一致する要求だけ
//   を受け付ける（S12 の Codex レビュー対応 df8024c0 と同じ
//   仕組みを手順ごとに適用する）。
// - 期待世代は手順の固定値（手順1 = 5、手順2 = 6）であり、
//   画面からの入力では変えられない。送信器もスロットごとに
//   固定値を照合する。
//
// タイミングの規律：S13 には保持トークンがないため、拘束は
// スロットごとの送信窓（nonce 発行開始時刻から4分。S5・S11・
// S12 送信器と同じ保守的な規則）である。送信窓を過ぎた捕捉は
// 送信器が s13_nonces_expired で拒否し、その提示は未実施とし
// て扱う（古い捕捉のまま送らない。試行を破棄して取得から
// やり直す）。
//
// - このモジュールはネットワーク通信を一切行わない。Node
//   （試験・送信器）とブラウザー（画面）の両方から同じ実装を
//   使う。秘密の比較は呼び出し側のメモリー内だけで行い、この
//   モジュールは値を保存・出力しない。
// - トークン消去の契機は S13_TOKEN_ERASE_TRIGGERS に明記する。

import { normalizeResponseError } from "./trial-apply.mjs";

// S13 の失効操作の固定値。送信先と action、期待世代は手順書
// §4.3 項目6 手順6と §4.7 S13 の固定状態（開始前 generation 5）
// から決まる定数であり、画面からの入力では変えられない。
export const REVOKE_ACTION = "revoke";
export const REVOKE_PATH = "/admin/registry/revoke";
export const VERIFY_ONLY_PATH = "/admin/verify-only";
// 手順1（C の失効）が指定する期待世代＝S13 開始前の現在世代。
export const REVOKEC_EXPECTED_GENERATION = 5;
// 手順1の成功後に返される世代（開始前＋1）。
export const EXPECTED_REVOKEC_FINAL_GENERATION = REVOKEC_EXPECTED_GENERATION + 1;
// 手順2（A 自身の失効試行）が指定する期待世代＝手順1後の世代。
export const REVOKEA_EXPECTED_GENERATION = EXPECTED_REVOKEC_FINAL_GENERATION;

// 手順1の期待応答。200 ok で generation が 6 であること。
export const EXPECTED_REVOKEC_RESPONSE = Object.freeze({
  status: 200,
  generation: EXPECTED_REVOKEC_FINAL_GENERATION,
});
// 手順2の期待応答。409 last_operator。この拒否が合格である。
export const EXPECTED_LAST_OPERATOR_RESPONSE = Object.freeze({
  status: 409,
  error: "last_operator",
});
// 手順3の期待応答。200 ok であること。
export const EXPECTED_VERIFY_OK_RESPONSE = Object.freeze({ status: 200 });

// 送信器のスロット（役割）。revokeC は手順1の A、revokeA は
// 手順2の A、checkA は手順3の A。送信器のスロット名と画面・
// 状態機械の役割名は同じ文字列を使う。
export const S13_SLOTS = Object.freeze(["revokeC", "revokeA", "checkA"]);
// 状態機械の捕捉役割。スロットに加えて、対象取得（targetC）が
// ある。targetC のトークンは管理操作に提示しないため送信器の
// スロットは持たない（nonce は画面が /nonce から直接取得する。
// 対象主体ハッシュ取得ページと同じ経路）。
export const S13_ROLES = Object.freeze(["targetC", "revokeC", "revokeA", "checkA"]);

// スロットごとの失効の期待世代（固定値）。送信器もこの表で照合
// する。checkA は失効に使わないため含めない。
export const REVOKE_EXPECTED_GENERATION_BY_SLOT = Object.freeze({
  revokeC: REVOKEC_EXPECTED_GENERATION,
  revokeA: REVOKEA_EXPECTED_GENERATION,
});

// 送信器の局所コード：応答が返らなかった要求（再送しない）。
export const S13_NO_RESPONSE = "no_response";
// 送信器の局所コード：3xx の応答を追従せず、再送なしの失敗として
// 記録した要求（送信器が redirect: "manual" で受けた 3xx。Worker
// の理由コードではない）。
export const S13_REDIRECT_NOT_FOLLOWED = "redirect_not_followed";

// タイミングの定数。nonce の有効期限は5分（実ビルドの
// NONCE_TTL_MS）。送信器のスロット送信窓は、発行開始時刻から
// 4分（S5・S11・S12 送信器と同じ保守的な規則。起点は要求開始
// 時刻であり、応答受信時刻ではない）。
export const S13_NONCE_TTL_MS = 5 * 60 * 1000;
export const SLOT_SEND_WINDOW_MS = 4 * 60 * 1000;

// トークン消去の契機。消去そのものは呼び出し側（ブラウザー画面）
// がメモリー内の変数を空にして行う。消去を忘れてはならない契機
// をここに列挙し、画面と試験で参照する。s12-revoke.mjs の同種の
// 定数とは別物であるため、S13 のものには接頭辞を付ける（画面
// 試験で複数モジュールを結合するため、同名の const は重複宣言
// になる）。
export const S13_TOKEN_ERASE_TRIGGERS = Object.freeze([
  "revokec-sent", // 手順1の失効送信後（A のトークンは消費済み。再利用しない）
  "revokea-recorded", // 手順2の失効試行の記録後（A のトークンは消費済み）
  "s13-completed", // S13 完了（手順3まで期待どおり）
  "s13-halted", // S13 停止（期待外れ応答・応答なし・機械確認の失敗）
  "trial-discarded", // 試行の破棄（破棄ボタン・捕捉時の検証失敗）
  "new-trial-begun", // 新規試行の開始（旧試行の無効化と同時に旧トークンを消去）
]);

// 各役割の GIS コールバックが有効な段階。targetC は start、
// revokeC は target-captured、revokeA は revokec-sent、checkA
// は revokea-recorded のときにだけ有効である。
const CALLBACK_PHASES = Object.freeze({
  targetC: "start",
  revokeC: "target-captured",
  revokeA: "revokec-sent",
  checkA: "revokea-recorded",
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

function requireRole(role) {
  if (!S13_ROLES.includes(role)) {
    fail("bad_trial_input", "役割が targetC / revokeC / revokeA / checkA ではありません");
  }
  return role;
}

// 送信する失効要求オブジェクトを作り、深く凍結して返す。値は
// 凍結済み要求の表示（displayData）から取る。手入力の値は使わない。
export function buildS13RevokeRequest({ idToken, subjectHash, expectedGeneration }) {
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
export function buildS13VerifyOnlyRequest({ idToken }) {
  requireNonEmptyString(idToken, "ID トークン");
  return deepFreeze({ id_token: idToken });
}

// 応答の理由コードを正規化する。応答が返らなかった要求の局所
// コード "no_response" と、3xx 非追従の局所コード
// "redirect_not_followed" はそのまま通す。成功応答は理由コードを
// 持たないため、null / undefined はそのまま null として通す。
export function normalizeS13ResponseError(error) {
  if (error === null || error === undefined) return null;
  if (error === S13_NO_RESPONSE) return S13_NO_RESPONSE;
  if (error === S13_REDIRECT_NOT_FOLLOWED) return S13_REDIRECT_NOT_FOLLOWED;
  return normalizeResponseError(error);
}

// S13 試行の状態機械。許可する順序は C の対象取得 → A の取得
// （手順1）→ 失効C の凍結 → 失効C の送信 → A の取得（手順2）
// → 失効A の凍結 → 失効A の送信 → A の取得（手順3）→ A の
// 提示。応答なしは状態未確定として停止し、再送を許可しない。
// 各役割の捕捉は claimCallbackCapture で1回に固定する。nonce
// の取得も試行・役割に閉じ込める。beginNonceFetch は取得要求
// の開始直前に同期的に呼び、開始時刻（startedAtMs）を試行に
// 記録する。
export function createS13Session() {
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

  // 失効応答1件を期待と照合する内部関数。期待どおりなら次の
  // 段階名、応答なしなら "undetermined"、それ以外は null を返す。
  function matchRevoke(response, expected, nextPhase) {
    if (response === null || response === undefined) return "undetermined";
    if (typeof response.status !== "number") {
      fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
    }
    const error = normalizeS13ResponseError(response.error);
    if (expected.error === null || expected.error === undefined) {
      return response.status === expected.status &&
        error === null &&
        response.generation === expected.generation
        ? nextPhase
        : null;
    }
    return response.status === expected.status && error === expected.error
      ? nextPhase
      : null;
  }

  return {
    // 新しい S13 試行を始める。前回の試行を無効化する（旧トークン
    // の消去は呼び出し側が S13_TOKEN_ERASE_TRIGGERS の
    // "new-trial-begun" で行う）。開始直後の段階は start である。
    beginTrial() {
      generation += 1;
      const trialId = makeTrialId();
      current = {
        trialId,
        generation,
        phase: "start",
        targetCapture: null, // { subjectHash, verified }（対象 C）
        targetHash: null, // 対象 C の主体ハッシュ
        authorizerCapture: null, // { subjectHash, verified }（手順1の A）
        authorizerHash: null, // 手順1の認可者（A）の主体ハッシュ
        revokeACapture: null, // { subjectHash, verified }（手順2の A）
        checkACapture: null, // { subjectHash, verified }（手順3の A）
        claimed: { targetC: false, revokeC: false, revokeA: false, checkA: false },
        nonces: { targetC: null, revokeC: null, revokeA: null, checkA: null },
        frozenRevokeC: null, // { action, subjectHash, expectedGeneration, path }
        frozenRevokeA: null, // { action, subjectHash, expectedGeneration, path }
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
    // 状態へ書き込むのを防ぐ（S11・S12 と同じ型）。
    isCallbackCurrent(trialId, gen, role) {
      if (!this.isCurrent(trialId, gen)) return false;
      if (!S13_ROLES.includes(role)) return false;
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
    // 試行は stale_attempt。startedAtMs は画面が発行を依頼する
    // 直前の時刻であり、期限の保守的な起点になる。
    beginNonceFetch(trialId, gen, role, startedAtMs) {
      const cur = requireCurrent(trialId, gen);
      requireRole(role);
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
      if (!S13_ROLES.includes(role)) return null;
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
      requireRole(role);
      const req = cur.nonces[role];
      if (!req || req.state !== "issued") return null;
      return req.startedAtMs;
    },
    // 試行の nonce 取得が飛行中かどうか。古い試行は偽。
    isNonceFetchPending(trialId, gen, role) {
      if (!this.isCurrent(trialId, gen)) return false;
      if (!S13_ROLES.includes(role)) return false;
      const req = current.nonces[role];
      return !!req && req.state === "pending";
    },
    // 手順0：失効対象 C の主体ハッシュの取得完了。画面が PC 内
    // 署名検証を通した結果を渡す。start のときにだけ
    // target-captured へ進む。このトークンは管理操作には提示
    // しない（主体ハッシュだけを失効対象として使う）。
    markTargetCCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "start") {
        fail("trial_order", "試行が対象取得の段階ではありません");
      }
      if (!cur.nonces.targetC || cur.nonces.targetC.state !== "issued") {
        fail("trial_order", "targetC の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "C の主体ハッシュ");
      requireVerified(verified, "C の署名検証");
      cur.targetCapture = { subjectHash, verified: { ...verified } };
      cur.targetHash = subjectHash;
      cur.phase = "target-captured";
      return true;
    },
    // 手順1の前段：A の取得完了。target-captured のときにだけ
    // revokec-captured へ進む。認可者の主体ハッシュが対象 C と
    // 同一の場合は wrong_authorizer で試行を停止する（認可者は
    // 運営者 A でなければならない。C でログインした場合は対象
    // のハッシュと一致するため機械的に検出できる）。
    markRevokeCCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "target-captured") {
        fail("trial_order", "試行が対象取得の完了後ではありません");
      }
      if (!cur.nonces.revokeC || cur.nonces.revokeC.state !== "issued") {
        fail("trial_order", "revokeC の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "認可者の主体ハッシュ");
      requireVerified(verified, "認可者の署名検証");
      if (subjectHash === cur.targetHash) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("wrong_authorizer", "認可者の主体ハッシュが失効対象の C と同一です");
      }
      cur.authorizerCapture = { subjectHash, verified: { ...verified } };
      cur.authorizerHash = subjectHash;
      cur.phase = "revokec-captured";
      return true;
    },
    // 手順1：失効C の要求を凍結する。revokec-captured のときに
    // だけ凍結できる。対象は手順0で取得した C の主体ハッシュ、
    // 期待世代は手順の固定値（REVOKEC_EXPECTED_GENERATION = 5）
    // であり、手入力の値は使わない。画面はこの凍結内容を表示
    // し、所有者の確認でだけ送信指示を出す。
    freezeRevokeCRequest(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "revokec-captured") {
        fail("trial_order", "試行が A の取得完了後ではありません");
      }
      cur.frozenRevokeC = {
        action: REVOKE_ACTION,
        subjectHash: cur.targetHash,
        expectedGeneration: REVOKEC_EXPECTED_GENERATION,
        path: REVOKE_PATH,
      };
      cur.phase = "revokec-frozen";
      return deepFreeze({
        trialId,
        step: "revokeC",
        action: cur.frozenRevokeC.action,
        targetSubjectHash: cur.frozenRevokeC.subjectHash,
        expectedGeneration: cur.frozenRevokeC.expectedGeneration,
        path: cur.frozenRevokeC.path,
      });
    },
    // 失効C の凍結済み要求の表示内容。実際の凍結内容から生成する
    // （入力欄の値や画面の別表示からは作らない）。revokec-frozen
    // 以降の段階で読める。
    revokeCDisplayData(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (!cur.frozenRevokeC) {
        fail("trial_order", "失効C の要求が凍結されていません");
      }
      return deepFreeze({
        trialId: cur.trialId,
        step: "revokeC",
        action: cur.frozenRevokeC.action,
        targetSubjectHash: cur.frozenRevokeC.subjectHash,
        expectedGeneration: cur.frozenRevokeC.expectedGeneration,
        path: cur.frozenRevokeC.path,
      });
    },
    // 失効C の要求を今送ってよいか。revokec-frozen のときにだけ真。
    // 送信直前の再確認に使う。
    canSendRevokeC(trialId, gen) {
      if (!this.isCurrent(trialId, gen)) return false;
      return current.phase === "revokec-frozen";
    },
    // 手順1：失効C の送信結果を期待値と照合する。response が null
    // の場合は送信器が応答を得られなかった（状態未確定）であり、
    // 停止して再送を許可しない。期待は 200 ok・generation 6 で
    // あること。期待どおりなら revokec-sent へ進む。不一致なら
    // 試行を停止する（後段には進まない）。
    recordRevokeCSend(trialId, gen, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "revokec-frozen") {
        fail("trial_order", "試行が失効C の送信待ちの状態ではありません");
      }
      const m = matchRevoke(
        response,
        { status: EXPECTED_REVOKEC_RESPONSE.status, error: null, generation: EXPECTED_REVOKEC_RESPONSE.generation },
        "revokec-sent"
      );
      if (m === "undetermined") {
        cur.phase = "halted";
        cur.undetermined = true;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: true });
      }
      if (m === null) {
        cur.phase = "halted";
        cur.undetermined = false;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: false });
      }
      cur.phase = m;
      return deepFreeze({ trialId, matched: true, state: m, undetermined: false });
    },
    // 手順2の前段：A の取得完了（2回目）。revokec-sent のときに
    // だけ revokea-captured へ進む。主体ハッシュが手順1の認可者
    // A と異なる場合は wrong_authorizer で試行を停止する（手順2
    // の対象は手順1の認可者自身でなければならない）。
    markRevokeACaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "revokec-sent") {
        fail("trial_order", "試行が失効C の送信完了後ではありません");
      }
      if (!cur.nonces.revokeA || cur.nonces.revokeA.state !== "issued") {
        fail("trial_order", "revokeA の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "手順2の A の主体ハッシュ");
      requireVerified(verified, "手順2の A の署名検証");
      if (subjectHash !== cur.authorizerHash) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("wrong_authorizer", "手順2の A の主体ハッシュが手順1の認可者と同一ではありません");
      }
      cur.revokeACapture = { subjectHash, verified: { ...verified } };
      cur.phase = "revokea-captured";
      return true;
    },
    // 手順2：失効A の要求を凍結する。revokea-captured のときに
    // だけ凍結できる。対象は認可者 A 自身の主体ハッシュ、期待
    // 世代は手順の固定値（REVOKEA_EXPECTED_GENERATION = 6）で
    // あり、手入力の値は使わない。
    freezeRevokeARequest(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "revokea-captured") {
        fail("trial_order", "試行が手順2の A の取得完了後ではありません");
      }
      cur.frozenRevokeA = {
        action: REVOKE_ACTION,
        subjectHash: cur.authorizerHash,
        expectedGeneration: REVOKEA_EXPECTED_GENERATION,
        path: REVOKE_PATH,
      };
      cur.phase = "revokea-frozen";
      return deepFreeze({
        trialId,
        step: "revokeA",
        action: cur.frozenRevokeA.action,
        targetSubjectHash: cur.frozenRevokeA.subjectHash,
        expectedGeneration: cur.frozenRevokeA.expectedGeneration,
        path: cur.frozenRevokeA.path,
      });
    },
    // 失効A の凍結済み要求の表示内容。revokea-frozen 以降の段階で
    // 読める。
    revokeADisplayData(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (!cur.frozenRevokeA) {
        fail("trial_order", "失効A の要求が凍結されていません");
      }
      return deepFreeze({
        trialId: cur.trialId,
        step: "revokeA",
        action: cur.frozenRevokeA.action,
        targetSubjectHash: cur.frozenRevokeA.subjectHash,
        expectedGeneration: cur.frozenRevokeA.expectedGeneration,
        path: cur.frozenRevokeA.path,
      });
    },
    // 失効A の要求を今送ってよいか。revokea-frozen のときにだけ真。
    canSendRevokeA(trialId, gen) {
      if (!this.isCurrent(trialId, gen)) return false;
      return current.phase === "revokea-frozen";
    },
    // 手順2：失効A の送信結果を期待値と照合する。期待は 409
    // last_operator であり、この拒否が合格（matched = true）で
    // ある。期待どおりなら revokea-recorded へ進む。200 で成功
    // してしまった場合（最後の運営者保護が効かなかった場合）を
    // 含め、期待外れは試行を停止する。応答なしは状態未確定と
    // して停止する（再送は許可しない）。
    recordRevokeASend(trialId, gen, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "revokea-frozen") {
        fail("trial_order", "試行が失効A の送信待ちの状態ではありません");
      }
      const m = matchRevoke(response, EXPECTED_LAST_OPERATOR_RESPONSE, "revokea-recorded");
      if (m === "undetermined") {
        cur.phase = "halted";
        cur.undetermined = true;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: true });
      }
      if (m === null) {
        cur.phase = "halted";
        cur.undetermined = false;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: false });
      }
      cur.phase = m;
      return deepFreeze({ trialId, matched: true, state: m, undetermined: false });
    },
    // 手順3の前段：A の取得完了（3回目）。revokea-recorded の
    // ときにだけ checka-captured へ進む。主体ハッシュが手順1の
    // 認可者 A と異なる場合は wrong_authorizer で試行を停止する。
    markCheckACaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "revokea-recorded") {
        fail("trial_order", "試行が手順2の結果の記録後ではありません");
      }
      if (!cur.nonces.checkA || cur.nonces.checkA.state !== "issued") {
        fail("trial_order", "checkA の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "手順3の A の主体ハッシュ");
      requireVerified(verified, "手順3の A の署名検証");
      if (subjectHash !== cur.authorizerHash) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("wrong_authorizer", "手順3の A の主体ハッシュが手順1の認可者と同一ではありません");
      }
      cur.checkACapture = { subjectHash, verified: { ...verified } };
      cur.phase = "checka-captured";
      return true;
    },
    // 手順3：A の verify-only 提示結果を照合する。期待は 200 ok
    // （唯一の運営者 A が残って操作できることの確認）。期待
    // どおりなら completed へ進む。応答なしは状態未確定として
    // 停止する。
    recordCheckAVerifyOnly(trialId, gen, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "checka-captured") {
        fail("trial_order", "試行が A の提示待ちの状態ではありません");
      }
      if (response === null || response === undefined) {
        cur.phase = "halted";
        cur.undetermined = true;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: true });
      }
      if (typeof response.status !== "number") {
        fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
      }
      const error = normalizeS13ResponseError(response.error);
      const matched =
        response.status === EXPECTED_VERIFY_OK_RESPONSE.status && error === null;
      if (!matched) {
        cur.phase = "halted";
        cur.undetermined = false;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: false });
      }
      cur.phase = "completed";
      return deepFreeze({ trialId, matched: true, state: "completed", undetermined: false });
    },
    // 試行の破棄。現行の試行なら無効化し（トークンの消去は呼び
    // 出し側が S13_TOKEN_ERASE_TRIGGERS の "trial-discarded" で
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
        targetCaptured: cur.targetCapture !== null,
        authorizerCaptured: cur.authorizerCapture !== null,
        revokeCFrozen: cur.frozenRevokeC !== null,
        revokeACaptured: cur.revokeACapture !== null,
        revokeAFrozen: cur.frozenRevokeA !== null,
        checkACaptured: cur.checkACapture !== null,
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
export function makeS13LogEntry({ trialId, step, response }) {
  requireNonEmptyString(trialId, "試験 ID");
  const steps = [
    "target-captured",
    "revokec-frozen",
    "revokec-sent",
    "revokea-frozen",
    "revokea-recorded",
    "checka-verified",
  ];
  if (!steps.includes(step)) {
    fail("bad_trial_input", "ステップが S13 のステップではありません");
  }
  if (!response || typeof response.status !== "number") {
    fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
  }
  return deepFreeze({
    trial_id: trialId,
    step,
    response: {
      status: response.status,
      error: normalizeS13ResponseError(response.error),
      generation:
        typeof response.generation === "number" ? response.generation : null,
    },
  });
}
