// S14（項目6 手順7：ローテーション A→B）専用の純粋モジュール。
//
// 目的：S14 の手順を、専用画面（public/s14-rotate.html）と送信器
// （tools/s14-sender.mjs）から安全に行うための状態機械と検証を
// 提供する。表示・ログ・Issue・チャットに ID トークン・Cookie・
// nonce・主体ハッシュを出さない（主体ハッシュの表示は PC 画面の
// DOM だけ。S10〜S13 と同じ扱い）。
//
// 実ビルド（src/worker.js）で確認したローテーションの仕様（本
// モジュールの前提。S13 モジュールで確認済みの管理処理の順序と
// 同じ枠組み）：
// - POST /admin/registry/rotate の本体は { id_token,
//   old_subject_hash, new_subject_hash, expected_generation }。
// - RegistryDO の単一トランザクション内で、順に (1) ID トークン
//   の検証、(2) nonce の消費（未知は 401 unknown_nonce、再送は
//   403 nonce_replayed、期限切れは 401 nonce_expired、文脈不一
//   致は 403 nonce_context_mismatch。verify-only を含むすべての
//   管理提示が nonce を消費するため、トークンは提示1回限り）、
//   (3) 呼び出し元の運営者在籍（不在は 403 not_operator）、
//   (4) verify-only なら 200 { ok: true, generation } を返して
//   終了、(5) 世代照合（expected_generation が現在世代と異な
//   れば 409 stale_generation）、(6) ローテーションの対象照合
//   （旧主体が登録簿に不在なら 404 target_not_member、新主体が
//   既に在籍していれば 409 already_member）、(7) 旧主体行の
//   削除と新主体行の追加（同一トランザクション。追加行の
//   added_by は呼び出し元のハッシュ）、世代 +1、200
//   { ok: true, generation } を返す。
// - ローテーションには最後の運営者の保護（last_operator）は
//   適用されない。削除と追加が同一トランザクションで行われ、
//   登録簿が空になる瞬間がないためである（追加・失効とは違う
//   点）。旧主体＝新主体の場合は、新主体が既に在籍しているた
//   め 409 already_member になる。
// - 在籍は提示時点の登録簿で判定される（発行時点ではない）。
//   ローテーション元 A は、ローテーション直後の次の操作から
//   (3) で 403 not_operator として拒否される。
// - nonce の有効期限は発行から5分（NONCE_TTL_MS = 5 * 60 *
//   1000、Cookie の Max-Age も 300）。
// - /admin/* は固定の Origin（http://localhost:8787）でなけれ
//   ば 403 bad_origin を返す。
//
// S14 の手順（固定順）。開始時の実状態は S13 終了時（generation
// 6・登録簿 {A}・consumed=2・completion=2）：
//   0. ローテーション元 A とローテーション先 B の主体ハッシュ
//      を取得する（対象取得。これらのトークンは管理操作には
//      提示しない。S13 の対象取得と同じ型）。
//   1. rotateAB：運営者 A の新しい実トークンで、旧主体 A →
//      新主体 B のローテーションを送る
//      （expected_generation = 6）。期待は 200 ok・
//      generation 7・登録簿 {B}。
//   2. checkA：A の別の新しいトークンで verify-only を提示
//      する。期待は 403 not_operator であり、状態は変わら
//      ない。この拒否が本手順の合格（PASS）である（ローテー
//      ション元が次回操作で拒否されることの確認）。
//   3. checkB：B の新しいトークンで verify-only を提示する。
//      期待は 200 ok（ローテーション先 B が運営者として通る
//      ことの確認）。
// 終了時の固定状態：generation 7・登録簿 {B}、consumed=2・
// completion=2（登録簿操作はプラットフォームの操作IDを消費
// しない）。
//
// 順序の強制（状態機械の段階で機械的に守る）：
// - 手順2（checkA）の取得・提示は、手順1（rotateAB）が期待
//   どおり 200・generation 7 で記録されるまでできない（段階
//   rotateab-sent に進んでいなければ、checkA の取得自体も
//   始められない）。
// - 手順3（checkB）の取得・提示は、手順2の結果が期待どおり
//   （403 not_operator）記録されるまでできない。
// - 各提示・送信は1回限りで、再送の手段はない。応答なしは
//   状態未確定として停止する。
//
// 機械的な確認（送信前に状態機械・送信器が強制する）：
// - ローテーション先 B の主体がローテーション元 A と異なる
//   こと（同一なら wrong_subject で停止。実ビルドでも
//   already_member で拒否される形だが、送信前に機械的に
//   止める）。
// - 手順1の呼び出し元がローテーション元 A 本人であること
//   （手順0で取得した A と異なれば wrong_authorizer で停止）。
// - 手順2の A の主体がローテーション元 A と同一であること
//   （異なれば wrong_authorizer で停止。拒否されるべき主体
//   そのものの提示でなければならない）。
// - 手順3の B の主体が、手順0で取得したローテーション先 B
//   と同一であること（異なれば wrong_subject で停止）。
// - ローテーション対象は送信器の境界でも結び付ける：画面が
//   ローテーション要求を凍結した時点で、凍結済み要求の旧主
//   体・新主体の組を送信器にも登録し（freezeRotateTargets）、
//   送信器は登録値と一致する要求だけを受け付ける（S13 の
//   手順ごとの結び付けを、対象の組に拡張したもの）。
// - 期待世代は手順の固定値（6）であり、画面からの入力では
//   変えられない。送信器も固定値を照合する。
//
// タイミングの規律：S14 には保持トークンがないため、拘束は
// スロットごとの送信窓（nonce 発行開始時刻から4分。S5・S11・
// S12・S13 送信器と同じ保守的な規則）である。送信窓を過ぎた
// 捕捉は送信器が s14_nonces_expired で拒否し、その提示は未
// 実施として扱う（古い捕捉のまま送らない。試行を破棄して取
// 得からやり直す）。
//
// - このモジュールはネットワーク通信を一切行わない。Node
//   （試験・送信器）とブラウザー（画面）の両方から同じ実装を
//   使う。秘密の比較は呼び出し側のメモリー内だけで行い、この
//   モジュールは値を保存・出力しない。
// - トークン消去の契機は S14_TOKEN_ERASE_TRIGGERS に明記する。

import { normalizeResponseError } from "./trial-apply.mjs";

// S14 のローテーション操作の固定値。送信先と action、期待世代は
// 手順書 §4.3 項目6 手順7と §4.7 S14 の固定状態（開始前
// generation 6）から決まる定数であり、画面からの入力では変え
// られない。
export const ROTATE_ACTION = "rotate";
export const ROTATE_PATH = "/admin/registry/rotate";
export const VERIFY_ONLY_PATH = "/admin/verify-only";
// ローテーションが指定する期待世代＝S14 開始前の現在世代。
export const ROTATE_EXPECTED_GENERATION = 6;
// ローテーションの成功後に返される世代（開始前＋1）。
export const EXPECTED_ROTATE_FINAL_GENERATION = ROTATE_EXPECTED_GENERATION + 1;

// 手順1の期待応答。200 ok で generation が 7 であること。
export const EXPECTED_ROTATE_RESPONSE = Object.freeze({
  status: 200,
  generation: EXPECTED_ROTATE_FINAL_GENERATION,
});
// 手順2の期待応答。403 not_operator。この拒否が合格である。
export const EXPECTED_CHECKA_REFUSAL_RESPONSE = Object.freeze({
  status: 403,
  error: "not_operator",
});
// 手順3の期待応答。200 ok であること。
export const EXPECTED_VERIFY_OK_RESPONSE = Object.freeze({ status: 200 });

// 送信器のスロット（役割）。rotateAB は手順1の A、checkA は
// 手順2の A、checkB は手順3の B。送信器のスロット名と画面・
// 状態機械の役割名は同じ文字列を使う。
export const S14_SLOTS = Object.freeze(["rotateAB", "checkA", "checkB"]);
// 状態機械の捕捉役割。スロットに加えて、対象取得（targetA・
// targetB）がある。対象取得のトークンは管理操作に提示しない
// ため送信器のスロットは持たない（nonce は画面が /nonce から
// 直接取得する。対象主体ハッシュ取得ページと同じ経路）。
export const S14_ROLES = Object.freeze(["targetA", "targetB", "rotateAB", "checkA", "checkB"]);

// スロットごとのローテーションの期待世代（固定値）。送信器も
// この表で照合する。rotateAB だけがローテーションに使う。
export const ROTATE_EXPECTED_GENERATION_BY_SLOT = Object.freeze({
  rotateAB: ROTATE_EXPECTED_GENERATION,
});

// 送信器の局所コード：応答が返らなかった要求（再送しない）。
export const S14_NO_RESPONSE = "no_response";
// 送信器の局所コード：3xx の応答を追従せず、再送なしの失敗として
// 記録した要求（送信器が redirect: "manual" で受けた 3xx。Worker
// の理由コードではない）。
export const S14_REDIRECT_NOT_FOLLOWED = "redirect_not_followed";

// タイミングの定数。nonce の有効期限は5分（実ビルドの
// NONCE_TTL_MS）。送信器のスロット送信窓は、発行開始時刻から
// 4分（S5・S11・S12・S13 送信器と同じ保守的な規則。起点は要求
// 開始時刻であり、応答受信時刻ではない）。
export const S14_NONCE_TTL_MS = 5 * 60 * 1000;
export const SLOT_SEND_WINDOW_MS = 4 * 60 * 1000;

// トークン消去の契機。消去そのものは呼び出し側（ブラウザー画面）
// がメモリー内の変数を空にして行う。消去を忘れてはならない契機
// をここに列挙し、画面と試験で参照する。s13-revoke.mjs の同種の
// 定数とは別物であるため、S14 のものには接頭辞を付ける（画面
// 試験で複数モジュールを結合するため、同名の const は重複宣言
// になる）。
export const S14_TOKEN_ERASE_TRIGGERS = Object.freeze([
  "rotateab-sent", // 手順1のローテーション送信後（A のトークンは消費済み。再利用しない）
  "checka-recorded", // 手順2の提示の記録後（A のトークンは消費済み）
  "s14-completed", // S14 完了（手順3まで期待どおり）
  "s14-halted", // S14 停止（期待外れ応答・応答なし・機械確認の失敗）
  "trial-discarded", // 試行の破棄（破棄ボタン・捕捉時の検証失敗）
  "new-trial-begun", // 新規試行の開始（旧試行の無効化と同時に旧トークンを消去）
]);

// 各役割の GIS コールバックが有効な段階。targetA は start、
// targetB は targeta-captured、rotateAB は targetb-captured、
// checkA は rotateab-sent、checkB は checka-recorded のときに
// だけ有効である。
const CALLBACK_PHASES = Object.freeze({
  targetA: "start",
  targetB: "targeta-captured",
  rotateAB: "targetb-captured",
  checkA: "rotateab-sent",
  checkB: "checka-recorded",
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
  if (!S14_ROLES.includes(role)) {
    fail("bad_trial_input", "役割が targetA / targetB / rotateAB / checkA / checkB ではありません");
  }
  return role;
}

// 送信するローテーション要求オブジェクトを作り、深く凍結して
// 返す。値は凍結済み要求の表示（displayData）から取る。手入力
// の値は使わない。
export function buildS14RotateRequest({ idToken, oldSubjectHash, newSubjectHash, expectedGeneration }) {
  requireNonEmptyString(idToken, "ID トークン");
  requireSubjectHash(oldSubjectHash, "旧主体の主体ハッシュ");
  requireSubjectHash(newSubjectHash, "新主体の主体ハッシュ");
  if (!Number.isInteger(expectedGeneration) || expectedGeneration < 0) {
    fail("bad_trial_input", "期待世代が 0 以上の整数ではありません");
  }
  return deepFreeze({
    id_token: idToken,
    old_subject_hash: oldSubjectHash,
    new_subject_hash: newSubjectHash,
    expected_generation: expectedGeneration,
  });
}

// verify-only の提示要求オブジェクトを作り、深く凍結して返す。
// 本体は { id_token } だけである（実ビルドの仕様）。
export function buildS14VerifyOnlyRequest({ idToken }) {
  requireNonEmptyString(idToken, "ID トークン");
  return deepFreeze({ id_token: idToken });
}

// 応答の理由コードを正規化する。応答が返らなかった要求の局所
// コード "no_response" と、3xx 非追従の局所コード
// "redirect_not_followed" はそのまま通す。成功応答は理由コードを
// 持たないため、null / undefined はそのまま null として通す。
export function normalizeS14ResponseError(error) {
  if (error === null || error === undefined) return null;
  if (error === S14_NO_RESPONSE) return S14_NO_RESPONSE;
  if (error === S14_REDIRECT_NOT_FOLLOWED) return S14_REDIRECT_NOT_FOLLOWED;
  return normalizeResponseError(error);
}

// S14 試行の状態機械。許可する順序は A の対象取得 → B の対象
// 取得 → A の取得（手順1）→ ローテーションの凍結 → ローテー
// ションの送信 → A の取得（手順2）→ A の提示 → B の取得
// （手順3）→ B の提示。応答なしは状態未確定として停止し、
// 再送を許可しない。各役割の捕捉は claimCallbackCapture で
// 1回に固定する。nonce の取得も試行・役割に閉じ込める。
// beginNonceFetch は取得要求の開始直前に同期的に呼び、開始
// 時刻（startedAtMs）を試行に記録する。
export function createS14Session() {
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

  // 応答1件を期待と照合する内部関数。期待どおりなら次の段階名、
  // 応答なしなら "undetermined"、それ以外は null を返す。
  // expected.generation が指定されている場合だけ世代も照合する。
  function matchResponse(response, expected, nextPhase) {
    if (response === null || response === undefined) return "undetermined";
    if (typeof response.status !== "number") {
      fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
    }
    const error = normalizeS14ResponseError(response.error);
    if (response.status !== expected.status) return null;
    if (expected.error === null || expected.error === undefined) {
      if (error !== null) return null;
      if (
        expected.generation !== null &&
        expected.generation !== undefined &&
        response.generation !== expected.generation
      ) {
        return null;
      }
      return nextPhase;
    }
    return error === expected.error ? nextPhase : null;
  }

  return {
    // 新しい S14 試行を始める。前回の試行を無効化する（旧トークン
    // の消去は呼び出し側が S14_TOKEN_ERASE_TRIGGERS の
    // "new-trial-begun" で行う）。開始直後の段階は start である。
    beginTrial() {
      generation += 1;
      const trialId = makeTrialId();
      current = {
        trialId,
        generation,
        phase: "start",
        targetACapture: null, // { subjectHash, verified }（対象取得の A）
        targetAHash: null, // ローテーション元 A の主体ハッシュ
        targetBCapture: null, // { subjectHash, verified }（対象取得の B）
        targetBHash: null, // ローテーション先 B の主体ハッシュ
        authorizerCapture: null, // { subjectHash, verified }（手順1の A）
        checkACapture: null, // { subjectHash, verified }（手順2の A）
        checkBCapture: null, // { subjectHash, verified }（手順3の B）
        claimed: { targetA: false, targetB: false, rotateAB: false, checkA: false, checkB: false },
        nonces: { targetA: null, targetB: null, rotateAB: null, checkA: null, checkB: null },
        frozenRotate: null, // { action, oldSubjectHash, newSubjectHash, expectedGeneration, path }
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
    // 状態へ書き込むのを防ぐ（S11〜S13 と同じ型）。
    isCallbackCurrent(trialId, gen, role) {
      if (!this.isCurrent(trialId, gen)) return false;
      if (!S14_ROLES.includes(role)) return false;
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
      if (!S14_ROLES.includes(role)) return null;
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
      if (!S14_ROLES.includes(role)) return false;
      const req = current.nonces[role];
      return !!req && req.state === "pending";
    },
    // 手順0（前半）：ローテーション元 A の主体ハッシュの取得
    // 完了。画面が PC 内署名検証を通した結果を渡す。start の
    // ときにだけ targeta-captured へ進む。このトークンは管理
    // 操作には提示しない（主体ハッシュだけをローテーション元
    // として使う）。
    markTargetACaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "start") {
        fail("trial_order", "試行が対象取得（A）の段階ではありません");
      }
      if (!cur.nonces.targetA || cur.nonces.targetA.state !== "issued") {
        fail("trial_order", "targetA の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "A の主体ハッシュ");
      requireVerified(verified, "A の署名検証");
      cur.targetACapture = { subjectHash, verified: { ...verified } };
      cur.targetAHash = subjectHash;
      cur.phase = "targeta-captured";
      return true;
    },
    // 手順0（後半）：ローテーション先 B の主体ハッシュの取得
    // 完了。targeta-captured のときにだけ targetb-captured へ
    // 進む。B の主体が A と同一の場合は wrong_subject で試行を
    // 停止する（ローテーションは異なる主体への交代であり、
    // 実ビルドでも already_member で拒否される形である）。
    markTargetBCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "targeta-captured") {
        fail("trial_order", "試行が対象取得（B）の段階ではありません");
      }
      if (!cur.nonces.targetB || cur.nonces.targetB.state !== "issued") {
        fail("trial_order", "targetB の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "B の主体ハッシュ");
      requireVerified(verified, "B の署名検証");
      if (subjectHash === cur.targetAHash) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("wrong_subject", "ローテーション先 B の主体ハッシュがローテーション元 A と同一です");
      }
      cur.targetBCapture = { subjectHash, verified: { ...verified } };
      cur.targetBHash = subjectHash;
      cur.phase = "targetb-captured";
      return true;
    },
    // 手順1の前段：A の取得完了。targetb-captured のときにだけ
    // rotateab-captured へ進む。呼び出し元の主体ハッシュが
    // ローテーション元 A と異なる場合は wrong_authorizer で
    // 試行を停止する（ローテーションの呼び出し元は A 本人で
    // なければならない）。
    markRotateABCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "targetb-captured") {
        fail("trial_order", "試行が対象取得の完了後ではありません");
      }
      if (!cur.nonces.rotateAB || cur.nonces.rotateAB.state !== "issued") {
        fail("trial_order", "rotateAB の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "呼び出し元の主体ハッシュ");
      requireVerified(verified, "呼び出し元の署名検証");
      if (subjectHash !== cur.targetAHash) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("wrong_authorizer", "呼び出し元の主体ハッシュがローテーション元 A と同一ではありません");
      }
      cur.authorizerCapture = { subjectHash, verified: { ...verified } };
      cur.phase = "rotateab-captured";
      return true;
    },
    // 手順1：ローテーション要求を凍結する。rotateab-captured の
    // ときにだけ凍結できる。旧主体は手順0で取得した A の主体
    // ハッシュ、新主体は同じく B の主体ハッシュ、期待世代は
    // 手順の固定値（ROTATE_EXPECTED_GENERATION = 6）であり、
    // 手入力の値は使わない。画面はこの凍結内容を表示し、所有者
    // の確認でだけ送信指示を出す。
    freezeRotateRequest(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "rotateab-captured") {
        fail("trial_order", "試行が A の取得完了後ではありません");
      }
      cur.frozenRotate = {
        action: ROTATE_ACTION,
        oldSubjectHash: cur.targetAHash,
        newSubjectHash: cur.targetBHash,
        expectedGeneration: ROTATE_EXPECTED_GENERATION,
        path: ROTATE_PATH,
      };
      cur.phase = "rotateab-frozen";
      return deepFreeze({
        trialId,
        step: "rotateAB",
        action: cur.frozenRotate.action,
        oldSubjectHash: cur.frozenRotate.oldSubjectHash,
        newSubjectHash: cur.frozenRotate.newSubjectHash,
        expectedGeneration: cur.frozenRotate.expectedGeneration,
        path: cur.frozenRotate.path,
      });
    },
    // ローテーションの凍結済み要求の表示内容。実際の凍結内容
    // から生成する（入力欄の値や画面の別表示からは作らない）。
    // rotateab-frozen 以降の段階で読める。
    rotateDisplayData(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (!cur.frozenRotate) {
        fail("trial_order", "ローテーション要求が凍結されていません");
      }
      return deepFreeze({
        trialId: cur.trialId,
        step: "rotateAB",
        action: cur.frozenRotate.action,
        oldSubjectHash: cur.frozenRotate.oldSubjectHash,
        newSubjectHash: cur.frozenRotate.newSubjectHash,
        expectedGeneration: cur.frozenRotate.expectedGeneration,
        path: cur.frozenRotate.path,
      });
    },
    // ローテーション要求を今送ってよいか。rotateab-frozen の
    // ときにだけ真。送信直前の再確認に使う。
    canSendRotate(trialId, gen) {
      if (!this.isCurrent(trialId, gen)) return false;
      return current.phase === "rotateab-frozen";
    },
    // 手順1：ローテーションの送信結果を期待値と照合する。
    // response が null の場合は送信器が応答を得られなかった
    // （状態未確定）であり、停止して再送を許可しない。期待は
    // 200 ok・generation 7 であること。期待どおりなら
    // rotateab-sent へ進む。不一致なら試行を停止する（後段には
    // 進まない）。
    recordRotateSend(trialId, gen, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "rotateab-frozen") {
        fail("trial_order", "試行がローテーションの送信待ちの状態ではありません");
      }
      const m = matchResponse(
        response,
        { status: EXPECTED_ROTATE_RESPONSE.status, error: null, generation: EXPECTED_ROTATE_RESPONSE.generation },
        "rotateab-sent"
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
    // 手順2の前段：A の取得完了（2回目）。rotateab-sent のとき
    // にだけ checka-captured へ進む。主体ハッシュがローテー
    // ション元 A と異なる場合は wrong_authorizer で試行を停止
    // する（手順2で拒否されるべき主体はローテーション元その
    // ものでなければならない）。
    markCheckACaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "rotateab-sent") {
        fail("trial_order", "試行がローテーションの送信完了後ではありません");
      }
      if (!cur.nonces.checkA || cur.nonces.checkA.state !== "issued") {
        fail("trial_order", "checkA の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "手順2の A の主体ハッシュ");
      requireVerified(verified, "手順2の A の署名検証");
      if (subjectHash !== cur.targetAHash) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("wrong_authorizer", "手順2の主体ハッシュがローテーション元 A と同一ではありません");
      }
      cur.checkACapture = { subjectHash, verified: { ...verified } };
      cur.phase = "checka-captured";
      return true;
    },
    // 手順2：A の verify-only 提示結果を照合する。期待は 403
    // not_operator であり、この拒否が合格（matched = true）で
    // ある。期待どおりなら checka-recorded へ進む。200 で通っ
    // てしまった場合（ローテーションが在籍に反映されていない
    // 場合）を含め、期待外れは試行を停止する。応答なしは状態
    // 未確定として停止する（再送は許可しない）。
    recordCheckAVerifyOnly(trialId, gen, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "checka-captured") {
        fail("trial_order", "試行が A の提示待ちの状態ではありません");
      }
      const m = matchResponse(response, EXPECTED_CHECKA_REFUSAL_RESPONSE, "checka-recorded");
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
    // 手順3の前段：B の取得完了。checka-recorded のときにだけ
    // checkb-captured へ進む。主体ハッシュが手順0で取得した
    // ローテーション先 B と異なる場合は wrong_subject で試行
    // を停止する。
    markCheckBCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "checka-recorded") {
        fail("trial_order", "試行が手順2の結果の記録後ではありません");
      }
      if (!cur.nonces.checkB || cur.nonces.checkB.state !== "issued") {
        fail("trial_order", "checkB の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "手順3の B の主体ハッシュ");
      requireVerified(verified, "手順3の B の署名検証");
      if (subjectHash !== cur.targetBHash) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("wrong_subject", "手順3の主体ハッシュがローテーション先 B と同一ではありません");
      }
      cur.checkBCapture = { subjectHash, verified: { ...verified } };
      cur.phase = "checkb-captured";
      return true;
    },
    // 手順3：B の verify-only 提示結果を照合する。期待は 200 ok
    // （ローテーション先 B が運営者として通ることの確認）。期待
    // どおりなら completed へ進む。応答なしは状態未確定として
    // 停止する。
    recordCheckBVerifyOnly(trialId, gen, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "checkb-captured") {
        fail("trial_order", "試行が B の提示待ちの状態ではありません");
      }
      if (response === null || response === undefined) {
        cur.phase = "halted";
        cur.undetermined = true;
        return deepFreeze({ trialId, matched: false, state: "halted", undetermined: true });
      }
      if (typeof response.status !== "number") {
        fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
      }
      const error = normalizeS14ResponseError(response.error);
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
    // 出し側が S14_TOKEN_ERASE_TRIGGERS の "trial-discarded" で
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
        targetACaptured: cur.targetACapture !== null,
        targetBCaptured: cur.targetBCapture !== null,
        authorizerCaptured: cur.authorizerCapture !== null,
        rotateFrozen: cur.frozenRotate !== null,
        checkACaptured: cur.checkACapture !== null,
        checkBCaptured: cur.checkBCapture !== null,
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
export function makeS14LogEntry({ trialId, step, response }) {
  requireNonEmptyString(trialId, "試験 ID");
  const steps = [
    "targeta-captured",
    "targetb-captured",
    "rotateab-frozen",
    "rotateab-sent",
    "checka-refused",
    "checkb-verified",
  ];
  if (!steps.includes(step)) {
    fail("bad_trial_input", "ステップが S14 のステップではありません");
  }
  if (!response || typeof response.status !== "number") {
    fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
  }
  return deepFreeze({
    trial_id: trialId,
    step,
    response: {
      status: response.status,
      error: normalizeS14ResponseError(response.error),
      generation:
        typeof response.generation === "number" ? response.generation : null,
    },
  });
}
