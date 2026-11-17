// S15（項目7 手順1：応答破棄を伴う全面復旧）専用の純粋モジュール。
//
// 目的：S15 の手順を、提供サーバー側の送信器（tools/s15-sender.mjs）
// と運用コンソールから安全に行うための状態機械と、読み戻しによる
// 判定（judgeS15ReadBack）を提供する。表示・ログ・Issue・チャット
// に ID トークン・一回値・Cookie・nonce・主体ハッシュを出さない
// （主体ハッシュの表示は PC 画面の DOM だけ。S10〜S14 と同じ扱い）。
//
// 手順書 §4.4 項目7 手順1と §4.7 S15 の固定状態が前提である。
// - 開始状態：generation 7・登録簿 {B}・完了記録 2件・消費済み
//   操作ID は {#1, #3} の2件（実環境の消費IDそのもの。ローカルの
//   固定具では件数を同じ経路で再現し、ID 文字列は固定具側の値）。
// - 操作 #5：プラットフォーム経路の一時ビルドで全面復旧
//   （full-replace）を行う。対象主体は B、差し替え後の登録簿の
//   内容は現在値 {B} と同一である（意図的な同一値。成否の判断は
//   登録簿の差分ではなく消費記録・完了記録・世代の読み戻しで
//   行う。手順書 §4.4 の基準どおり）。
// - 承認内容（操作ID #5・用途 full-replace・内容 {B}・対象 B）
//   は送信前に凍結する。一回値は承認内容の一部だが秘密である
//   ため、このモジュールでは扱わない（送信器が試行ごとのメモリー
//   内だけで結び付ける。S13・S14 の対象の結び付けと同じ分担）。
// - 送信は「送信を完了し、応答は読み取らない」形に限る。送信器
//   が返すのは破棄記録 { sent: true, outcome: "discarded" } だけ
//   であり、このモジュールの recordSendDiscard はこの形以外の
//   記録（HTTP 状態・理由コード・世代を含むもの）を受け付け
//   ない。すなわち、応答の内容は状態機械に一切入らない。
// - 判定は独立した読み戻しだけで行う：
//     committed（実測）：操作 #5 が消費され、完了記録 3件、
//       generation 8、登録簿 {B}、消費集合が開始集合＋{#5} に
//       正確に一致する。
//     uncommitted（未成立）：操作 #5 が未消費で、状態が開始状態
//       と正確に一致する（generation 7・登録簿 {B}・完了 2件・
//       消費集合は開始集合と同一）。
//     discrepancy：上記のどちらでもない。停止して記録する。
//   判定の比較対象は generation・登録簿の主体集合・消費済み
//   操作ID集合・完了記録件数の4項目である。運営者行の
//   added_by／added_at は、コミット時に正当に変わる
//   （added_by は platform:<操作ID> になる）ため判定には含め
//   ない。未消費 nonce の内訳も、試行ごとの nonce 発行で正当に
//   変わるため判定には含めない（読み戻しの記録対象ではあるが、
//   S15 の成否区分は手順書 §4.4 の基準の4項目で行う）。
// - 未確定（送信済み・判定前）の間は、新しい操作を一切送れ
//   ない。再実施は、未成立（uncommitted）の判定が読み戻しで
//   記録された場合にだけ数え、最大で2回まで（送信は合計3回
//   まで）。各再実施は新しい一回値を使うが、操作ID #5 は同じ
//   である。committed の判定の後は送信手段は残らない。
// - 試行の切り替え関門（Codex レビュー 6879152477 への対応）：
//   beginTrial は、送信済みの現行試行を sent-undetermined の
//   まま上書きしない。新しい試行を始められる終端条件は次の
//   場合だけである。(a) 現行試行がない。(b) 現行試行が1件も
//   送信していない（開始そのものが明示的な破棄として働く）。
//   (c) 現行試行が完全に締まった（phase が closed：判定が
//   確定＝committed、または未成立で試行枯渇＝uncommitted-
//   final、かつ通常版復帰が記録済み）。送信済み・判定前は
//   s15_trial_unjudged、判定済みでも締まっていなければ
//   s15_trial_not_closed で拒否する。discrepancy で停止した
//   試行（halted）は、復帰が記録済みでも切り替え条件に含め
//   ない（停止して人の確認を待つ。切り替えは discard の
//   明示操作でのみ行う）。discard も、送信済み・判定前の
//   試行については s15_trial_unjudged で拒否する（関門の
//   迂回路にしない）。送信器（tools/s15-sender.mjs）も同じ
//   関門を持ち、そちらでは飛行中の送信も判定未記録として
//   塞ぐ。
// - 締め：committed／uncommitted のどちらの帰結でも、手順は
//   通常ビルドへの復帰と、有効なバージョン・バインディングの
//   確認で終わる（手順書 §5.1 の操作ごとの終了手順）。この
//   状態機械では、判定確定後に recordNormalRestored（版確認・
//   バインディング確認の両方が真）を受けて初めて試行を
//   closed にできる。discrepancy で停止した場合も復帰の記録
//   は受け付けるが、試行は halted のままとし、closed には
//   しない。
//
// - このモジュールはネットワーク通信を一切行わない。Node
//   （試験・送信器・運用コンソール）から使う。秘密の比較は
//   呼び出し側のメモリー内だけで行い、このモジュールは値を
//   保存・出力しない。
// - トークン消去の契機は S15_TOKEN_ERASE_TRIGGERS に明記する。

import { buildTrialRequest } from "./trial-apply.mjs";

// S15 の操作の固定値。送信先と用途、操作の台帳番号は手順書
// §4.4 項目7 手順1と §4.7 S15 から決まる定数であり、画面・
// 入力からは変えられない。操作ID の文字列そのものは、PC 側で
// アカウント保有者が一時ビルドに固定する値であり、試行の
// 開始時に beginTrial へ渡す（このモジュールは文字列を固定
// しない。台帳番号 5 が S15 の操作である）。
export const APPLY_PATH = "/platform/apply";
export const APPLY_PURPOSE = "full-replace";
export const S15_OPERATION_NUMBER = 5;
// 開始状態（§4.7 S14 終了時＝S15 開始前）。
export const START_GENERATION = 7;
export const START_COMPLETION_COUNT = 2;
export const START_CONSUMED_COUNT = 2;
// committed の場合の終了状態（§4.7 S15）。
export const COMMITTED_GENERATION = START_GENERATION + 1;
export const COMMITTED_COMPLETION_COUNT = START_COMPLETION_COUNT + 1;
// 送信の上限。再実施は最大2回（未成立の判定が記録された場合
// にだけ数える）であり、送信は合計3回まで。
export const MAX_REATTEMPTS = 2;
export const MAX_SENDS = MAX_REATTEMPTS + 1;

// 破棄送信の記録の outcome。送信器が返す記録は
// { sent: true, outcome: S15_DISCARDED_OUTCOME } だけであり、
// HTTP 状態・応答本文・理由コード・世代は含まない。
export const S15_DISCARDED_OUTCOME = "discarded";
export const S15_UNKNOWN_OUTCOME = "unknown";

// 判定の区分。
export const S15_JUDGMENT_COMMITTED = "committed";
export const S15_JUDGMENT_UNCOMMITTED = "uncommitted";
export const S15_JUDGMENT_DISCREPANCY = "discrepancy";

// タイミングの定数。nonce の有効期限は5分（実ビルドの
// NONCE_TTL_MS）。試行枠の送信窓は、発行開始時刻から4分
// （S5・S11〜S14 送信器と同じ保守的な規則。起点は要求開始
// 時刻であり、応答受信時刻ではない）。
export const S15_NONCE_TTL_MS = 5 * 60 * 1000;
export const ATTEMPT_SEND_WINDOW_MS = 4 * 60 * 1000;

// トークン消去の契機。消去そのものは呼び出し側（画面・運用
// コンソール）がメモリー内の変数を空にして行う。消去を忘れて
// はならない契機をここに列挙し、試験で参照する。
export const S15_TOKEN_ERASE_TRIGGERS = Object.freeze([
  "send-discarded", // 各試行の送信直後（その試行のトークン・一回値のコピーは再利用しない）
  "judgment-recorded", // 読み戻し判定の記録後（未確定の保持を残さない）
  "s15-closed", // S15 終了（判定確定＋通常版復帰の記録まで完了）
  "s15-halted", // S15 停止（discrepancy・機械確認の失敗）
  "trial-discarded", // 試行の破棄
  "new-trial-begun", // 新規試行の開始（旧試行の無効化と同時に旧トークンを消去）
]);

// 状態機械の捕捉役割。target は対象 B の主体取得（トークンは
// 提示しない）。attempt1〜attempt3 は各試行の B の取得である。
export function attemptRole(attempt) {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_SENDS) {
    fail("s15_bad_attempt", "試行番号が 1〜3 ではありません");
  }
  return `attempt${attempt}`;
}
export const S15_ROLES = Object.freeze([
  "target",
  attemptRole(1),
  attemptRole(2),
  attemptRole(3),
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

// 主体ハッシュの形式（SHA-256 の 64桁 hex）。値そのものは例外
// 文に含めない。
function requireSubjectHash(value, what) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    fail("bad_trial_input", `${what} が64桁の16進数ではありません`);
  }
  return value;
}

// PC 内署名検証の結果。署名・iss・aud・exp・nonce のすべてが
// 真であること。1つでも偽・未指定なら拒否する。
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
  if (!S15_ROLES.includes(role)) {
    fail("bad_trial_input", "役割が target / attempt1 / attempt2 / attempt3 ではありません");
  }
  return role;
}

// 送信する全面復旧の要求オブジェクトを作り、深く凍結して返す。
// 用途は手順の固定値（full-replace）であり、呼び出し側は指定
// できない。値は凍結済みの承認内容と送信器が照合する。
export function buildS15ApplyRequest({ idToken, oneTimeValue, envId }) {
  return buildTrialRequest({
    idToken,
    oneTimeValue,
    purpose: APPLY_PURPOSE,
    envId,
  });
}

// 読み戻し（RegistryDO の snapshot）の形を、判定用の正規形
// { generation, operatorHashes, consumedOperationIds,
// completionCount } へ変換する。DO の形（operators は行の
// 配列、consumed_ops は行の配列、completion は行の配列）と、
// 正規形そのものの両方を受ける。値の形式が不正なら
// bad_trial_input で拒否する（判定を曖昧にしない）。
export function normalizeS15Snapshot(raw) {
  if (!raw || typeof raw !== "object") {
    fail("bad_trial_input", "読み戻しがオブジェクトではありません");
  }
  const generation = raw.generation;
  if (!Number.isInteger(generation) || generation < 0) {
    fail("bad_trial_input", "読み戻しの generation が 0 以上の整数ではありません");
  }
  let operatorHashes;
  if (Array.isArray(raw.operators)) {
    operatorHashes = raw.operators.map((row) => {
      if (!row || typeof row !== "object") {
        fail("bad_trial_input", "読み戻しの運営者行がオブジェクトではありません");
      }
      return requireSubjectHash(row.subject_hash, "読み戻しの運営者の主体ハッシュ");
    });
  } else if (Array.isArray(raw.operatorHashes)) {
    operatorHashes = raw.operatorHashes.map((h) =>
      requireSubjectHash(h, "読み戻しの運営者の主体ハッシュ")
    );
  } else {
    fail("bad_trial_input", "読み戻しに運営者の一覧がありません");
  }
  let consumedOperationIds;
  if (Array.isArray(raw.consumed_ops)) {
    consumedOperationIds = raw.consumed_ops.map((row) => {
      if (!row || typeof row !== "object") {
        fail("bad_trial_input", "読み戻しの消費記録の行がオブジェクトではありません");
      }
      return requireNonEmptyString(row.operation_id, "読み戻しの消費済み操作ID");
    });
  } else if (Array.isArray(raw.consumedOperationIds)) {
    consumedOperationIds = raw.consumedOperationIds.map((id) =>
      requireNonEmptyString(id, "読み戻しの消費済み操作ID")
    );
  } else {
    fail("bad_trial_input", "読み戻しに消費済み操作IDの一覧がありません");
  }
  let completionCount;
  if (Array.isArray(raw.completion)) {
    completionCount = raw.completion.length;
  } else if (Number.isInteger(raw.completionCount) && raw.completionCount >= 0) {
    completionCount = raw.completionCount;
  } else {
    fail("bad_trial_input", "読み戻しに完了記録の件数がありません");
  }
  return deepFreeze({
    generation,
    operatorHashes: [...operatorHashes],
    consumedOperationIds: [...consumedOperationIds],
    completionCount,
  });
}

// 読み戻しの判定（純粋関数）。snapshot は normalizeS15Snapshot
// の正規形であること。開始状態は §4.7 の固定値（generation 7・
// 完了 2件）と、試行に固定した開始消費集合・対象主体で決まる。
// 戻り値は "committed" / "uncommitted" / "discrepancy" の
// いずれかであり、それ以外の情報（読み戻しの値そのもの）は
// 返さない。
export function judgeS15ReadBack({ snapshot, operationId, targetSubjectHash, startConsumedOperationIds }) {
  requireNonEmptyString(operationId, "操作ID");
  requireSubjectHash(targetSubjectHash, "対象主体の主体ハッシュ");
  if (!snapshot || typeof snapshot !== "object") {
    fail("bad_trial_input", "判定する読み戻しがありません");
  }
  const start = new Set(startConsumedOperationIds);
  const consumedList = snapshot.consumedOperationIds;
  const consumed = new Set(consumedList);
  const opConsumed = consumed.has(operationId);
  const coversStart = [...start].every((id) => consumed.has(id));
  const consumedIsStart =
    consumedList.length === start.size && consumed.size === start.size && coversStart && !opConsumed;
  const consumedIsCommitted =
    consumedList.length === start.size + 1 &&
    consumed.size === start.size + 1 &&
    coversStart &&
    opConsumed;
  const registryIsTarget =
    snapshot.operatorHashes.length === 1 && snapshot.operatorHashes[0] === targetSubjectHash;
  if (
    opConsumed &&
    consumedIsCommitted &&
    snapshot.generation === COMMITTED_GENERATION &&
    snapshot.completionCount === COMMITTED_COMPLETION_COUNT &&
    registryIsTarget
  ) {
    return S15_JUDGMENT_COMMITTED;
  }
  if (
    !opConsumed &&
    consumedIsStart &&
    snapshot.generation === START_GENERATION &&
    snapshot.completionCount === START_COMPLETION_COUNT &&
    registryIsTarget
  ) {
    return S15_JUDGMENT_UNCOMMITTED;
  }
  return S15_JUDGMENT_DISCREPANCY;
}

// S15 試行の状態機械。許可する順序は、対象 B の取得 → 承認
// 内容の凍結 → 試行1の B の取得 → 破棄送信 → 読み戻し判定 →
// （未成立の場合だけ）試行2・試行3の再実施 → 判定確定 →
// 通常版復帰の記録 → closed である。未確定の間は次の試行の
// 取得・送信を始められない。各役割の捕捉は
// claimCallbackCapture で1回に固定する。nonce の取得も試行・
// 役割に閉じ込める。
export function createS15Session() {
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

  // 役割の nonce 取得・コールバックが有効な段階。target は
  // start、attempt1 は approval-frozen、attempt2・attempt3 は
  // reattempt-ready のときにだけ有効であり、試行番号は
  // 「送信済み件数＋1」と一致しなければならない。
  function expectedPhaseForRole(cur, role) {
    if (role === "target") return "start";
    const attempt = Number(role.slice("attempt".length));
    if (attempt !== cur.sendCount + 1) return null;
    return attempt === 1 ? "approval-frozen" : "reattempt-ready";
  }

  // 次の試行の操作（取得・凍結相当・送信）が、既に確定した
  // 帰結によって禁止されている場合の理由コード。禁止されて
  // いなければ null。
  function settledBlock(cur) {
    if (cur.phase === "committed") return "s15_already_committed";
    if (cur.phase === "uncommitted-final" || cur.phase === "closed") {
      return "s15_attempts_exhausted";
    }
    return null;
  }

  return {
    // 新しい S15 試行を始める。operationId は PC 側で一時
    // ビルドに固定した操作ID #5 の文字列、envId は対象環境
    // の識別子、startConsumedOperationIds は開始時点の消費
    // 済み操作ID（{#1, #3} の2件）である。切り替え関門：
    // 現行試行が送信済みの場合、新しい試行を始められるのは
    // 現行試行が完全に締まった（closed）ときだけであり、
    // 送信済み・判定前は s15_trial_unjudged、判定済みでも
    // 締まっていなければ s15_trial_not_closed で拒否する。
    // 1件も送信していない現行試行は、開始そのものが明示的
    // な破棄として切り替えられる（旧トークンの消去は呼び
    // 出し側が S15_TOKEN_ERASE_TRIGGERS の "new-trial-begun"
    // で行う）。
    beginTrial({ operationId, envId, startConsumedOperationIds } = {}) {
      requireNonEmptyString(operationId, "操作ID");
      requireNonEmptyString(envId, "環境ID");
      if (
        !Array.isArray(startConsumedOperationIds) ||
        startConsumedOperationIds.length !== START_CONSUMED_COUNT
      ) {
        fail("bad_trial_input", "開始時点の消費済み操作IDが2件ではありません");
      }
      for (const id of startConsumedOperationIds) {
        requireNonEmptyString(id, "開始時点の消費済み操作ID");
      }
      if (new Set(startConsumedOperationIds).size !== START_CONSUMED_COUNT) {
        fail("bad_trial_input", "開始時点の消費済み操作IDに重複があります");
      }
      if (startConsumedOperationIds.includes(operationId)) {
        fail("bad_trial_input", "操作IDが開始時点の消費済み操作IDに含まれています");
      }
      if (current !== null && current.sendCount > 0) {
        if (current.phase === "sent-undetermined") {
          fail(
            "s15_trial_unjudged",
            "現行試行が送信済み・判定前であり、新しい試行は始められません"
          );
        }
        if (current.phase !== "closed") {
          fail(
            "s15_trial_not_closed",
            "現行試行が締まっておらず（判定確定＋通常版復帰の記録が必要）、新しい試行は始められません"
          );
        }
      }
      generation += 1;
      const trialId = makeTrialId();
      current = {
        trialId,
        generation,
        phase: "start",
        operationId,
        envId,
        startConsumedOperationIds: [...startConsumedOperationIds],
        targetCapture: null, // { subjectHash, verified }（対象取得の B）
        targetHash: null, // 対象 B の主体ハッシュ
        frozenApproval: null, // 凍結済みの承認内容（秘密を含まない）
        attemptCapture: null, // { attempt, subjectHash, verified }（現行試行の B）
        claimed: { target: false, attempt1: false, attempt2: false, attempt3: false },
        nonces: { target: null, attempt1: null, attempt2: null, attempt3: null },
        sendCount: 0,
        outcomeUnknownSends: [],
        uncommittedJudgments: 0,
        judgments: [], // { attempt, outcome }
        discrepancy: false,
        normalRestored: false,
      };
      return deepFreeze({ trialId, generation });
    },
    isCurrent(trialId, gen) {
      return (
        current !== null && current.trialId === trialId && current.generation === gen
      );
    },
    // GIS コールバックが現行の試行・役割・段階に属するかを
    // 照合する。古い試行・役割外・段階外は偽を返す。
    isCallbackCurrent(trialId, gen, role) {
      if (!this.isCurrent(trialId, gen)) return false;
      if (!S15_ROLES.includes(role)) return false;
      const expected = expectedPhaseForRole(current, role);
      return expected !== null && current.phase === expected;
    },
    // 役割ごとの捕捉は1回だけ受け付ける。claim は試行に閉じ
    // 込めるため、新しい試行は前の試行の claim に妨げられない。
    claimCallbackCapture(trialId, gen, role) {
      if (!this.isCallbackCurrent(trialId, gen, role)) return false;
      if (current.claimed[role]) return false;
      current.claimed[role] = true;
      return true;
    },
    // nonce 取得の開始を試行に記録する。役割ごとに許可された
    // 段階のときにだけ始められる。取得中の再取得は
    // nonce_fetch_busy、取得済みの再取得は
    // nonce_already_issued、送信上限に達した後の試行の取得は
    // s15_attempts_exhausted、committed 確定後の取得は
    // s15_already_committed で拒否する。startedAtMs は発行を
    // 依頼する直前の時刻であり、期限の保守的な起点になる。
    beginNonceFetch(trialId, gen, role, startedAtMs) {
      const cur = requireCurrent(trialId, gen);
      requireRole(role);
      if (role !== "target") {
        const blocked = settledBlock(cur);
        if (blocked) fail(blocked, "確定した帰結の後に新しい試行は始められません");
        if (cur.sendCount >= MAX_SENDS) {
          fail("s15_attempts_exhausted", "送信は合計3回までです");
        }
      }
      const expected = expectedPhaseForRole(cur, role);
      if (expected === null || cur.phase !== expected) {
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
    // nonce 取得の応答を試行に適用する。現行の試行・取得中の
    // ものに限る。遅れて戻った旧試行の応答・破棄後の応答は
    // null を返して適用しない。期限の起点は要求開始時刻
    // （startedAtMs）のままである。
    finishNonceFetch(trialId, gen, role, nonce) {
      if (!this.isCurrent(trialId, gen)) return null;
      if (!S15_ROLES.includes(role)) return null;
      const req = current.nonces[role];
      if (!req || req.state !== "pending") return null;
      if (typeof nonce !== "string" || nonce.length === 0) return null;
      req.state = "issued";
      req.nonce = nonce;
      return deepFreeze({ nonce, issuedAtMs: req.startedAtMs });
    },
    // 試行に記録された nonce 期限の起点（要求開始時刻）。未
    // 取得なら null。古い試行は stale_attempt。
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
      if (!S15_ROLES.includes(role)) return false;
      const req = current.nonces[role];
      return !!req && req.state === "pending";
    },
    // 対象 B の主体ハッシュの取得完了。画面が PC 内署名検証を
    // 通した結果を渡す。start のときにだけ target-captured へ
    // 進む。このトークンは提示しない（主体ハッシュだけを
    // 承認内容の対象として使う）。
    markTargetCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "start") {
        fail("trial_order", "試行が対象取得の段階ではありません");
      }
      if (!cur.nonces.target || cur.nonces.target.state !== "issued") {
        fail("trial_order", "target の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "対象 B の主体ハッシュ");
      requireVerified(verified, "対象 B の署名検証");
      cur.targetCapture = { subjectHash, verified: { ...verified } };
      cur.targetHash = subjectHash;
      cur.phase = "target-captured";
      return true;
    },
    // 承認内容を凍結する。target-captured のときにだけ凍結
    // できる。内容は、操作ID（試行に固定した #5）・用途
    // full-replace・登録簿の内容 {B}・対象 B（手順0で取得した
    // 主体ハッシュ）・環境ID・送信先であり、手入力の値は使わ
    // ない。一回値は秘密であるためここには含めない（送信器が
    // 試行ごとに結び付ける）。
    freezeApproval(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "target-captured") {
        fail("trial_order", "試行が対象取得の完了後ではありません");
      }
      cur.frozenApproval = {
        operationNumber: S15_OPERATION_NUMBER,
        operationId: cur.operationId,
        purpose: APPLY_PURPOSE,
        contentOperatorHashes: [cur.targetHash],
        targetSubjectHash: cur.targetHash,
        envId: cur.envId,
        path: APPLY_PATH,
        startGeneration: START_GENERATION,
        startCompletionCount: START_COMPLETION_COUNT,
      };
      cur.phase = "approval-frozen";
      return deepFreeze({ trialId, ...cur.frozenApproval });
    },
    // 凍結済みの承認内容の表示データ。実際の凍結内容から生成
    // する（入力欄の値からは作らない）。凍結後に読める。
    approvalDisplayData(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (!cur.frozenApproval) {
        fail("trial_order", "承認内容が凍結されていません");
      }
      return deepFreeze({ trialId: cur.trialId, ...cur.frozenApproval });
    },
    // 現行試行（送信済み件数＋1）の B の取得完了。段階は試行1
    // では approval-frozen、再実施では reattempt-ready で
    // あること。主体が対象 B と異なる場合は wrong_subject で
    // 試行を停止する（別の主体のトークンで全面復旧を送らない
    // ため）。
    markAttemptCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      const attempt = cur.sendCount + 1;
      const blocked = settledBlock(cur);
      if (blocked) fail(blocked, "確定した帰結の後に新しい試行は始められません");
      const role = attemptRole(attempt);
      const expected = expectedPhaseForRole(cur, role);
      if (expected === null || cur.phase !== expected) {
        fail("trial_order", "試行が B の取得の段階ではありません");
      }
      if (!cur.nonces[role] || cur.nonces[role].state !== "issued") {
        fail("trial_order", `${role} の nonce が取得済みではありません`);
      }
      requireSubjectHash(subjectHash, "試行の B の主体ハッシュ");
      requireVerified(verified, "試行の B の署名検証");
      if (subjectHash !== cur.targetHash) {
        cur.phase = "halted";
        fail("wrong_subject", "試行の主体ハッシュが対象 B と同一ではありません");
      }
      cur.attemptCapture = { attempt, subjectHash, verified: { ...verified } };
      cur.phase = "attempt-captured";
      return true;
    },
    // 破棄送信を今行ってよいか。attempt-captured のときに
    // だけ真。送信直前の再確認に使う。
    canSendDiscard(trialId, gen) {
      if (!this.isCurrent(trialId, gen)) return false;
      return current.phase === "attempt-captured";
    },
    // 破棄送信の記録。sendRecord は送信器が返した破棄記録
    // { sent: true, outcome: "discarded" } そのものでなければ
    // ならない。HTTP 状態・理由コード・世代など応答由来の
    // 項目を含む記録は bad_trial_input で拒否する（応答の
    // 内容は状態機械に入らない。判定は読み戻しだけで行う）。
    // 記録後は sent-undetermined となり、判定が記録される
    // まで次の試行は始められない。再送の手段はない。
    recordSendDiscard(trialId, gen, sendRecord) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase === "committed") {
        fail("s15_already_committed", "committed の判定の後に送信はできません");
      }
      if (cur.phase !== "attempt-captured") {
        fail("trial_order", "試行が破棄送信の待ち状態ではありません");
      }
      if (
        !sendRecord ||
        typeof sendRecord !== "object" ||
        sendRecord.sent !== true ||
        sendRecord.outcome !== S15_DISCARDED_OUTCOME ||
        Object.keys(sendRecord).length !== 2
      ) {
        fail(
          "bad_trial_input",
          "送信の記録が破棄記録 { sent: true, outcome: \"discarded\" } ではありません（応答由来の項目は受け付けません）"
        );
      }
      cur.sendCount += 1;
      cur.phase = "sent-undetermined";
      return deepFreeze({
        trialId,
        attempt: cur.sendCount,
        sendCount: cur.sendCount,
        state: "sent-undetermined",
      });
    },
    // 送信指示の応答を喪失した場合の復旧遷移（修正4、Codex
    // 再レビュー 6880300681）。画面が破棄記録を受け取れな
    // かった場合、画面の状態機械は attempt-captured のまま
    // 停止する。独立した読み戻しを行った上で、操作者が画面
    // の復旧手順を選んだときに限り、この遷移で送信を「送信
    // 済み・結果不明」として記録し、sent-undetermined へ進
    // める。この遷移自体は何も送らない（再送ではない）。
    // attempt-captured 以外の状態からは拒否する。破棄記録が
    // 得られた通常の送信には recordSendDiscard を使い、この
    // 遷移は使わない（通常の記録の後に呼ぶと拒否される）。
    // 送信器側の送信は記録の時点で完了している前提である
    // （送信器の recordJudgment が飛行中の判定記録を拒否する
    // ため、判定の送信器への鏡像は送信の確定を保証する）。
    recordSendOutcomeUnknown(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase === "committed") {
        fail("s15_already_committed", "committed の判定の後に送信はできません");
      }
      if (cur.phase !== "attempt-captured") {
        fail(
          "trial_order",
          "結果不明の復旧は、送信指示の応答を喪失した停止状態（attempt-captured）からのみ可能です"
        );
      }
      cur.sendCount += 1;
      cur.outcomeUnknownSends.push(cur.sendCount);
      cur.phase = "sent-undetermined";
      return deepFreeze({
        trialId,
        attempt: cur.sendCount,
        sendCount: cur.sendCount,
        state: "sent-undetermined",
        outcome: S15_UNKNOWN_OUTCOME,
      });
    },
    // 読み戻しによる判定の記録。sent-undetermined のときに
    // だけ呼べる。rawSnapshot は RegistryDO の snapshot の形
    // （または正規形）であり、正規化してから judgeS15ReadBack
    // で区分する。
    // - committed：phase は committed になる。以後の送信は
    //   一切できない。
    // - uncommitted：未成立の判定として数える。送信が合計
    //   3回未満なら reattempt-ready（再実施はこの判定が記録
    //   された場合にだけ開く）、3回目なら uncommitted-final。
    // - discrepancy：phase は halted になり、停止して記録
    //   する（成功としても未成立としても扱わない）。
    recordReadBackJudgment(trialId, gen, rawSnapshot) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "sent-undetermined") {
        fail("trial_order", "試行が読み戻し判定の待ち状態ではありません");
      }
      const snapshot = normalizeS15Snapshot(rawSnapshot);
      const outcome = judgeS15ReadBack({
        snapshot,
        operationId: cur.operationId,
        targetSubjectHash: cur.targetHash,
        startConsumedOperationIds: cur.startConsumedOperationIds,
      });
      const attempt = cur.sendCount;
      cur.judgments.push({ attempt, outcome });
      if (outcome === S15_JUDGMENT_COMMITTED) {
        cur.phase = "committed";
      } else if (outcome === S15_JUDGMENT_UNCOMMITTED) {
        cur.uncommittedJudgments += 1;
        cur.phase = cur.sendCount >= MAX_SENDS ? "uncommitted-final" : "reattempt-ready";
      } else {
        cur.discrepancy = true;
        cur.phase = "halted";
      }
      return deepFreeze({
        trialId,
        attempt,
        outcome,
        sendCount: cur.sendCount,
        reattemptsUsed: Math.max(0, cur.sendCount - 1),
        uncommittedJudgments: cur.uncommittedJudgments,
        state: cur.phase,
      });
    },
    // 通常版復帰の記録（締め）。判定が確定した後（committed
    // または uncommitted-final）に、通常ビルドへ復帰させ、
    // 有効なバージョンとバインディングを確認したことを記録
    // する。両方の確認が真でなければ restore_unverified で
    // 拒否する。記録が済むまで試行は closed にならない。
    // discrepancy で停止した場合（halted）も復帰の記録自体は
    // 受け付けるが、phase は halted のままとし closed には
    // しない（扱いの判断は記録をもって別途行う）。
    recordNormalRestored(trialId, gen, { versionVerified, bindingsVerified } = {}) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "committed" && cur.phase !== "uncommitted-final" && cur.phase !== "halted") {
        fail("trial_order", "判定が確定する前に通常版復帰は記録できません");
      }
      if (versionVerified !== true || bindingsVerified !== true) {
        fail("restore_unverified", "有効なバージョンとバインディングの確認がそろっていません");
      }
      cur.normalRestored = true;
      if (cur.phase !== "halted") cur.phase = "closed";
      return deepFreeze({ trialId, state: cur.phase, normalRestored: true });
    },
    // 試行の破棄。現行の試行なら無効化し（トークンの消去は
    // 呼び出し側が行う）、古い試行に対しては無害に偽を返す。
    // 明示的な破棄は切り替え関門の迂回路にしない：送信済み・
    // 判定前（sent-undetermined）の試行は s15_trial_unjudged
    // で拒否する。判定が記録済みの試行（discrepancy で停止
    // した試行を含む）・送信していない試行は破棄できる
    // （人の確認を経た明示操作として扱う）。
    discard(trialId, gen) {
      if (!this.isCurrent(trialId, gen)) return false;
      if (current.phase === "sent-undetermined") {
        fail(
          "s15_trial_unjudged",
          "送信済み・判定前の試行は破棄できません"
        );
      }
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
        approvalFrozen: cur.frozenApproval !== null,
        sendCount: cur.sendCount,
        reattemptsUsed: Math.max(0, cur.sendCount - 1),
        uncommittedJudgments: cur.uncommittedJudgments,
        judgmentsRecorded: cur.judgments.length,
        outcomeUnknownSends: cur.outcomeUnknownSends.length,
        undetermined: cur.phase === "sent-undetermined",
        discrepancy: cur.discrepancy,
        normalRestored: cur.normalRestored,
        closed: cur.phase === "closed",
      });
    },
    currentTrialId() {
      return current === null ? null : current.trialId;
    },
  };
}

// 試験 ID・ステップ・試行番号・判定区分だけの記録を返す。
// 送信の記録（send-discarded）は outcome が "discarded" で
// あることだけを含み、応答の状態・理由コード・世代は構造上
// 含まない。ID トークン・一回値・Cookie・nonce・主体ハッシュ
// は含まない。
export function makeS15LogEntry({ trialId, step, attempt = null, judgment = null }) {
  requireNonEmptyString(trialId, "試験 ID");
  const steps = [
    "target-captured",
    "approval-frozen",
    "attempt-captured",
    "send-discarded",
    "send-outcome-unknown",
    "judged-committed",
    "judged-uncommitted",
    "judged-discrepancy",
    "normal-restored",
    "s15-closed",
  ];
  if (!steps.includes(step)) {
    fail("bad_trial_input", "ステップが S15 のステップではありません");
  }
  const needsAttempt = step === "attempt-captured" || step === "send-discarded" || step === "send-outcome-unknown" || step.startsWith("judged-");
  if (needsAttempt && (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_SENDS)) {
    fail("bad_trial_input", "ステップに試行番号（1〜3）が必要です");
  }
  if (step.startsWith("judged-")) {
    const expected = step.slice("judged-".length);
    if (judgment !== expected) {
      fail("bad_trial_input", "判定のステップと判定区分が一致しません");
    }
  } else if (judgment !== null) {
    fail("bad_trial_input", "判定でないステップに判定区分は付きません");
  }
  return deepFreeze({
    trial_id: trialId,
    step,
    attempt: needsAttempt ? attempt : null,
    judgment: step.startsWith("judged-") ? judgment : null,
    outcome:
      step === "send-discarded"
        ? S15_DISCARDED_OUTCOME
        : step === "send-outcome-unknown"
          ? S15_UNKNOWN_OUTCOME
          : null,
  });
}
