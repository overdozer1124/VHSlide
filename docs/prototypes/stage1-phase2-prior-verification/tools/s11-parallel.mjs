// S11（項目6 手順3・4：古い世代の拒否、同一の追加（C）の並行2件）
// 専用の純粋モジュール。
//
// 目的：Codex の手順レビュー（SwarmChat seq 691）で合意した S11 の
// 手順を、専用画面（public/s11-parallel.html）と送信器
// （tools/s11-sender.mjs）から安全に行うための状態機械と検証を
// 提供する。表示・ログ・Issue・チャットに ID トークン・Cookie・
// nonce・主体ハッシュを出さない（主体ハッシュの表示は PC 画面の
// DOM だけ。S10 と同じ扱い）。
//
// 合意した手順（seq 691）：
// - 手順3：追加 C を expected_generation = 2（過去世代）で送る →
//   409 stale_generation で拒否され、状態は変わらないこと。
// - 手順4：同一の変更要求（action "add"・対象＝C・期待世代 3）を、
//   別々の nonce・別々のトークンで並行に2件送る → 正確に1件だけが
//   200 ok（generation 4）で成功し、もう1件は 409 stale_generation
//   で拒否されること。通常ビルドでは世代チェックが既存メンバー
//   判定より先であるため、負け側は already_member ではなく
//   stale_generation になるのが妥当な期待である。
// - 並行2件の認可は、どちらも運営者 A の別々のログインとする
//   （交絡を減らすため。呼び出し元までそろえる）。
//
// 状態機械の順序（固定順）：
//   C の主体取得 → B の参照取得 → 手順3の A 認可 → 手順3の凍結 →
//   手順3の送信（409 stale_generation が期待どおりの場合にだけ次へ）
//   → 手順4の A 認可×2 → 手順4の凍結 → 手順4の同時送信。
// 手順4は手順3が期待どおりに拒否された場合にだけ始められる
// （手順3で状態が変わっていないことが手順4の前提である）。
//
// 機械的な確認（送信前に状態機械が強制する）：
// - 対象 C の主体ハッシュが、運営者 B の参照ハッシュとも、手順3・
//   手順4の認可者（A）の主体ハッシュとも異なること
//   （target_matches_operator／wrong_authorizer で試行を停止する）。
// - 手順4の2件の認可が同一主体（A）であり、手順3の認可者とも
//   同一であること（authorizer_mismatch で試行を停止する）。
//   「A である」ことの最終確認は、所有者がアカウント選択を目視で
//   確認することと組み合わせる（S10 と同じ考え方。機械確認は
//   B・C との相異と2件の同一性を担う）。
// - 凍結した2件の要求が、action・対象・期待世代まで同一である
//   こと（トークンと nonce だけが異なる）。
//
// Cookie 文脈の分離（seq 691 の条件1）：送信はブラウザーから直接
// 行わない。ブラウザーの Cookie jar は生成元で1つしかなく、2件目の
// /nonce が1件目の op2_nonce_ctx を上書きするため、単一ブラウザー
// からは2件それぞれに異なる nonce 文脈を送れない。送信は提供
// サーバー側の送信器（tools/s11-sender.mjs、Node）がスロット
// ごとに Cookie jar を分けて行う（S5 送信器と同じ解決）。この
// モジュールと画面が行う /nonce 取得（C・B の主体ハッシュ捕捉用）
// は、トークンを送信に使わない捕捉専用であり、ブラウザー jar の
// 上書きが送信へ影響することはない。手順3の単発送信も、送信経路を
// 1つにそろえるため送信器経由とする。
//
// - このモジュールはネットワーク通信を一切行わない。Node（試験・
//   送信器）とブラウザー（画面）の両方から同じ実装を使うため、
//   依存するのは trial-apply.mjs（理由コードの正規化）と
//   Object.freeze・JSON だけである。秘密の比較は呼び出し側
//   （ブラウザー画面・送信器）のメモリー内だけで行い、この
//   モジュールは値を保存・出力しない。
// - nonce の期限の規則（要求開始時刻＋5分）は s9-negative.mjs と
//   同一であり、画面は s9-negative.mjs から直接 import する。
//   送信器経由の nonce（手順3・手順4の認可用）は、送信器が発行
//   開始時刻から4分以内の送信だけを許可する（送信器側の規則。
//   s5-sender.mjs と同じ）。状態機械側の beginNonceFetch／
//   finishNonceFetch は、画面が送信器へ発行を依頼した時刻を起点
//   として同じ形で試行に閉じ込める。
// - 送信は各手順で一度だけである。recordStaleSend／
//   recordConcurrentSend は期待応答と照合し、不一致なら試行を
//   停止する。応答なし（送信器が status null を返した場合）は
//   状態未確定として停止し、再送を許可しない（再送せず読み戻す。
//   seq 691 の条件：結果不明時は読み戻しで判断する）。
// - トークン消去の契機は S11_TOKEN_ERASE_TRIGGERS に明記する
//   （手順3の送信後・S11 完了・S11 停止・試行の破棄・新規試行の
//   開始）。消去そのものは呼び出し側（ブラウザー画面）がメモリー
//   内の変数を空にして行う。
//
// S11 の固定状態：開始前 generation 3・登録簿 {A, B}、終了時
// generation 4・登録簿 {A, B, C}。世代の増分が1だけであることを、
// Data Studio の読み戻し（対象行そのものの一致）で確認する。
// 試験先は既存の検証用 Worker に限定し、本番には触れない。

import { normalizeResponseError } from "./trial-apply.mjs";

// S11 の追加操作の固定値。送信先と action、期待世代は手順書 §4.3
// 項目6 手順3・4と §4.7 S11 の固定状態（開始前 generation 3）から
// 決まる定数であり、画面からの入力では変えられない。
export const ADD_ACTION = "add";
export const ADD_PATH = "/admin/registry/add";
// 手順3で指定する過去世代（S10 実施前の世代）。
export const STALE_EXPECTED_GENERATION = 2;
// S11 開始前の現在世代。手順4の2件が指定する期待世代でもある。
export const CONCURRENT_EXPECTED_GENERATION = 3;
// 手順4の並行件数。
export const CONCURRENT_SLOT_COUNT = 2;
// 手順4の成功後に返される世代（開始前＋1）。
export const EXPECTED_CONCURRENT_FINAL_GENERATION = CONCURRENT_EXPECTED_GENERATION + 1;

// 手順3の期待応答。409 stale_generation で拒否されること。
export const EXPECTED_STALE_RESPONSE = Object.freeze({
  status: 409,
  error: "stale_generation",
});

// 送信器の局所コード：応答が返らなかった要求（再送しない）。
export const S11_NO_RESPONSE = "no_response";
// 送信器の局所コード：3xx の応答を追従せず、再送なしの失敗として
// 記録した要求（送信器が redirect: "manual" で受けた 3xx。Worker
// の理由コードではない）。
export const S11_REDIRECT_NOT_FOLLOWED = "redirect_not_followed";

// トークン消去の契機。消去そのものは呼び出し側（ブラウザー画面）
// がメモリー内の変数を空にして行う。消去を忘れてはならない契機を
// ここに列挙し、画面と試験で参照する。s9-negative.mjs・
// s10-add.mjs の同種の定数とは別物であるため、S11 のものには
// 接頭辞を付ける（画面試験で複数モジュールを結合するため、同名の
// const は重複宣言になる）。
export const S11_TOKEN_ERASE_TRIGGERS = Object.freeze([
  "stale-sent", // 手順3の送信後（認可トークンは消費済み。再利用しない）
  "s11-completed", // S11 完了（手順4が期待どおり：成功ちょうど1件）
  "s11-halted", // S11 停止（期待外れ応答・応答なし・機械確認の失敗）
  "trial-discarded", // 試行の破棄（破棄ボタン・捕捉時の検証失敗）
  "new-trial-begun", // 新規試行の開始（旧試行の無効化と同時に旧トークンを消去）
]);

// 試行内の役割。C は追加対象、B は既存運営者の参照、P3 は手順3の
// 認可者、P4-1／P4-2 は手順4の2件の認可者（どちらも A）。
export const S11_ROLES = Object.freeze(["C", "B", "P3", "P4-1", "P4-2"]);

// 各役割の GIS コールバックが有効な段階。C は c-preparing、B は
// c-captured、P3 は refs-captured、P4-1／P4-2 は p3-completed
// （当該スロットが未捕捉の間）のときにだけ有効である。
const CALLBACK_PHASES = Object.freeze({
  C: "c-preparing",
  B: "c-captured",
  P3: "refs-captured",
  "P4-1": "p3-completed",
  "P4-2": "p3-completed",
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
  if (!S11_ROLES.includes(role)) {
    fail("bad_trial_input", "役割が C / B / P3 / P4-1 / P4-2 ではありません");
  }
  return role;
}

// 送信する要求オブジェクトを作り、深く凍結して返す。値は凍結済み
// 要求の表示（displayData）から取る。手入力の値は使わない。
export function buildS11Request({ idToken, subjectHash, expectedGeneration }) {
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

// 手順4の2件の要求オブジェクトを作り、深く凍結して返す。ID
// トークンだけがスロットごとに異なり、対象・期待世代は2件で同一
// である（同一であることは verifyS11RequestsIdentical で確認する）。
export function buildS11Requests({ tokens, subjectHash, expectedGeneration }) {
  if (!Array.isArray(tokens) || tokens.length !== CONCURRENT_SLOT_COUNT) {
    fail("bad_trial_input", "ID トークンが2件ではありません");
  }
  return deepFreeze(
    tokens.map((idToken) => buildS11Request({ idToken, subjectHash, expectedGeneration }))
  );
}

// 2件の要求の action 相当（対象の主体ハッシュと期待世代）がすべて
// 同一であることを確認する。等しいことだけを確認し、値は返さない。
// ID トークンはスロットごとに異なることが前提であり、ここでは
// 確認しない（トークンの相異と nonce の結び付けは送信器が確認する）。
export function verifyS11RequestsIdentical(requests) {
  if (!Array.isArray(requests) || requests.length !== CONCURRENT_SLOT_COUNT) {
    fail("bad_trial_input", "要求が2件ではありません");
  }
  const first = requests[0];
  for (const r of requests) {
    if (
      !r ||
      r.subject_hash !== first.subject_hash ||
      r.expected_generation !== first.expected_generation
    ) {
      fail("s11_requests_differ", "2件の要求の条件（対象・期待世代）が同一ではありません");
    }
  }
  return true;
}

// nonce が期待件数だけあり、すべて空でない文字列で互いに異なる
// ことを確認する。値そのものは返さず、失敗時の例外文にも値を
// 含めない。
export function verifyNoncesDistinct(nonces, expectedCount) {
  if (!Array.isArray(nonces) || nonces.length !== expectedCount) {
    fail("bad_trial_input", `nonce が${expectedCount}件ではありません`);
  }
  for (const n of nonces) requireNonEmptyString(n, "nonce");
  if (new Set(nonces).size !== expectedCount) {
    fail("bad_trial_input", "nonce の中に重複があります");
  }
  return true;
}

// 応答の理由コードを正規化する。応答が返らなかった要求の局所
// コード "no_response" と、3xx 非追従の局所コード
// "redirect_not_followed" はそのまま通す（Worker の理由コードでは
// なく、送信側で「応答なし・再送しない」「転送せず再送しない」を
// 示す記録である）。成功応答は理由コードを持たないため、null /
// undefined はそのまま null として通す。
export function normalizeS11ResponseError(error) {
  if (error === null || error === undefined) return null;
  if (error === S11_NO_RESPONSE) return S11_NO_RESPONSE;
  if (error === S11_REDIRECT_NOT_FOLLOWED) return S11_REDIRECT_NOT_FOLLOWED;
  return normalizeResponseError(error);
}

// 応答1件を集計用の形へ正規化する。null（応答なし）は status null・
// error "no_response" として扱う。generation は数値の場合だけ残す。
function normalizeResultEntry(entry, slot) {
  if (entry === null || entry === undefined) {
    return { slot, status: null, error: S11_NO_RESPONSE, generation: null };
  }
  if (typeof entry.status !== "number" && entry.status !== null) {
    fail("bad_trial_input", "応答の HTTP 状態が数値または null ではありません");
  }
  return {
    slot,
    status: entry.status,
    error:
      entry.status === null && (entry.error === null || entry.error === undefined)
        ? S11_NO_RESPONSE
        : normalizeS11ResponseError(entry.error),
    generation: typeof entry.generation === "number" ? entry.generation : null,
  };
}

// 手順4の2件の応答を集計する。成功（200 かつ返された generation
// が期待世代＋1＝4）が正確に1件で、もう1件が 409
// stale_generation のときにだけ ok が真になる。応答なしがある
// 場合や、成功が0件・2件の場合、負け側が stale_generation 以外の
// 場合は ok は偽である。集計だけでは並行性の証拠にならない
// （nonce の相異は送信前に verifyNoncesDistinct で、トークンの
// 相異とスロットとの結び付けは送信器で確認する）。
export function aggregateS11ConcurrentResults(results) {
  if (!Array.isArray(results) || results.length !== CONCURRENT_SLOT_COUNT) {
    fail("bad_trial_input", "集計対象の応答が2件ではありません");
  }
  const entries = results.map((r, i) => normalizeResultEntry(r, i));
  let success = 0;
  let stale = 0;
  let noResponse = 0;
  const others = [];
  for (const r of entries) {
    if (r.status === 200 && r.error === null && r.generation === EXPECTED_CONCURRENT_FINAL_GENERATION) {
      success += 1;
    } else if (r.status === EXPECTED_STALE_RESPONSE.status && r.error === EXPECTED_STALE_RESPONSE.error) {
      stale += 1;
    } else if (r.status === null) {
      noResponse += 1;
    } else {
      others.push({ slot: r.slot, status: r.status, error: r.error, generation: r.generation });
    }
  }
  return deepFreeze({
    success,
    stale,
    no_response: noResponse,
    other: others,
    ok: success === 1 && stale === CONCURRENT_SLOT_COUNT - 1,
  });
}

// S11 試行の状態機械。許可する順序は C の主体取得 → B の参照取得
// → 手順3の A 認可 → 手順3の凍結 → 手順3の送信 → 手順4の A 認可
// ×2 → 手順4の凍結 → 手順4の送信。応答なしは状態未確定として
// 停止し、再送を許可しない。古い世代のコールバックは拒否する。
// 各役割の捕捉は claimCallbackCapture で1回に固定する（受付済み・
// 処理中の同一試行・役割への後続コールバックは、ユーザーの確認で
// 段階が進む前でも拒否する）。nonce の取得も試行・役割に閉じ
// 込める。beginNonceFetch は取得要求の開始直前に同期的に呼び、
// 開始時刻（startedAtMs）を試行に記録する。
export function createS11Session() {
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

  function nonceSlot(role) {
    return role;
  }

  return {
    // 新しい S11 試行を始める。前回の試行を無効化する（旧トークン
    // の消去は呼び出し側が S11_TOKEN_ERASE_TRIGGERS の
    // "new-trial-begun" で行う）。開始直後の段階は C の主体取得の
    // 準備である。
    beginTrial() {
      generation += 1;
      const trialId = makeTrialId();
      current = {
        trialId,
        generation,
        phase: "c-preparing",
        targetCapture: null, // { subjectHash, verified }（C）
        referenceCapture: null, // { subjectHash, verified }（B）
        authorizerHash: null, // 手順3の認可者（A）の主体ハッシュ
        p3Capture: null, // { subjectHash, verified }
        p4Captures: [null, null], // スロットごとの { subjectHash, verified }
        claimed: { C: false, B: false, P3: false, "P4-1": false, "P4-2": false },
        nonces: { C: null, B: null, P3: null, "P4-1": null, "P4-2": null },
        frozenStale: null, // { action, subjectHash, expectedGeneration, path }
        frozenConcurrent: null, // [slot ごとの凍結内容]
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
    // する。役割ごとに有効な段階が決まっており（CALLBACK_PHASES）、
    // P4-1／P4-2 は当該スロットが未捕捉のときにだけ有効である。
    // 古い試行・役割外・段階外のコールバックは偽を返す。画面は
    // onGoogleSignIn の各 await の後（JWKS 取得後・署名検証後・
    // sha256hex 後）でこれを呼び、遅延・破棄・新試行・役割移行を
    // またいだ古い／重複コールバックが共有の状態へ書き込むのを防ぐ。
    isCallbackCurrent(trialId, gen, role) {
      if (!this.isCurrent(trialId, gen)) return false;
      if (!S11_ROLES.includes(role)) return false;
      if (current.phase !== CALLBACK_PHASES[role]) return false;
      if (role === "P4-1" && current.p4Captures[0] !== null) return false;
      if (role === "P4-2" && current.p4Captures[1] !== null) return false;
      return true;
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
    // 試行は stale_attempt。C・B はブラウザーが /nonce を取得する
    // 時刻、手順3・手順4は画面が送信器へ発行を依頼する時刻を
    // startedAtMs として渡す（どちらも要求開始直前の同期的な記録）。
    beginNonceFetch(trialId, gen, role, startedAtMs) {
      const cur = requireCurrent(trialId, gen);
      requireRole(role);
      if (cur.phase !== NONCE_PHASES[role]) {
        fail("trial_order", `${role} の nonce 取得を始められる段階ではありません`);
      }
      if (role === "P4-1" && cur.p4Captures[0] !== null) {
        fail("trial_order", "P4-1 は捕捉済みです");
      }
      if (role === "P4-2" && cur.p4Captures[1] !== null) {
        fail("trial_order", "P4-2 は捕捉済みです");
      }
      if (!Number.isFinite(startedAtMs)) {
        fail("bad_trial_input", "nonce 要求の開始時刻が数値ではありません");
      }
      const slot = nonceSlot(role);
      if (cur.nonces[slot] && cur.nonces[slot].state === "pending") {
        fail("nonce_fetch_busy", "nonce の取得中です");
      }
      if (cur.nonces[slot] && cur.nonces[slot].state === "issued") {
        fail("nonce_already_issued", "nonce は既に取得済みです");
      }
      cur.nonces[slot] = { startedAtMs, state: "pending", nonce: null };
      return deepFreeze({ trialId, generation: gen, role, startedAtMs });
    },
    // nonce 取得の応答を試行に適用する。現行の試行・取得中のもの
    // に限る。遅れて戻った旧試行の応答・破棄後の応答・取得中で
    // ない試行の応答は null を返して適用しない。適用時は期限の
    // 起点として要求開始時刻（startedAtMs）をそのまま返す（応答
    // の受信時刻は使わない）。
    finishNonceFetch(trialId, gen, role, nonce) {
      if (!this.isCurrent(trialId, gen)) return null;
      if (!S11_ROLES.includes(role)) return null;
      const req = current.nonces[nonceSlot(role)];
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
      const req = cur.nonces[nonceSlot(role)];
      if (!req || req.state !== "issued") return null;
      return req.startedAtMs;
    },
    // 試行の nonce 取得が飛行中かどうか。古い試行は偽。
    isNonceFetchPending(trialId, gen, role) {
      if (!this.isCurrent(trialId, gen)) return false;
      if (!S11_ROLES.includes(role)) return false;
      const req = current.nonces[nonceSlot(role)];
      return !!req && req.state === "pending";
    },
    // C の主体取得の完了。画面が PC 内署名検証を通した結果を渡す。
    // c-preparing のときにだけ c-captured へ進む。検証が不完全
    // なら例外（試行は進まない）。主体ハッシュは画面のメモリー
    // 内にだけ保持し、このモジュールはログ・画面外へ出さない。
    markCCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "c-preparing") {
        fail("trial_order", "試行が C の主体取得の準備中ではありません");
      }
      if (!cur.nonces.C || cur.nonces.C.state !== "issued") {
        fail("trial_order", "C の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "C の主体ハッシュ");
      requireVerified(verified, "C の署名検証");
      cur.targetCapture = { subjectHash, verified: { ...verified } };
      cur.phase = "c-captured";
      return true;
    },
    // B の参照取得の完了。画面が PC 内署名検証を通した結果を
    // 渡す。c-captured のときにだけ refs-captured へ進む。B の
    // 主体ハッシュが C と同一の場合は target_matches_operator で
    // 試行を停止する（追加対象が既存運営者である誤りを、送信前に
    // 機械的に防ぐ）。
    markBCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "c-captured") {
        fail("trial_order", "試行が C の主体取得の完了後ではありません");
      }
      if (!cur.nonces.B || cur.nonces.B.state !== "issued") {
        fail("trial_order", "B の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "B の主体ハッシュ");
      requireVerified(verified, "B の署名検証");
      if (subjectHash === cur.targetCapture.subjectHash) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("target_matches_operator", "C と B の主体ハッシュが同一です");
      }
      cur.referenceCapture = { subjectHash, verified: { ...verified } };
      cur.phase = "refs-captured";
      return true;
    },
    // 手順3の A 認可の完了。画面が PC 内署名検証を通した結果を
    // 渡す。refs-captured のときにだけ p3-captured へ進む。認可者
    // の主体ハッシュが C または B と同一の場合は wrong_authorizer
    // で試行を停止する（認可者は運営者 A でなければならない。
    // B でログインした場合は参照ハッシュと一致するため機械的に
    // 検出できる）。
    markP3Captured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "refs-captured") {
        fail("trial_order", "試行が参照取得の完了後ではありません");
      }
      if (!cur.nonces.P3 || cur.nonces.P3.state !== "issued") {
        fail("trial_order", "手順3の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "認可者の主体ハッシュ");
      requireVerified(verified, "認可者の署名検証");
      if (
        subjectHash === cur.targetCapture.subjectHash ||
        subjectHash === cur.referenceCapture.subjectHash
      ) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("wrong_authorizer", "認可者の主体ハッシュが C または B と同一です");
      }
      cur.p3Capture = { subjectHash, verified: { ...verified } };
      cur.authorizerHash = subjectHash;
      cur.phase = "p3-captured";
      return true;
    },
    // 手順4の A 認可の完了（スロットごと）。画面が PC 内署名検証
    // を通した結果を渡す。p3-completed のときにだけ受け付ける。
    // 認可者の主体ハッシュが C・B と同一なら wrong_authorizer、
    // 手順3の認可者と異なれば authorizer_mismatch で試行を停止
    // する（2件とも運営者 A の別ログインであることの機械確認）。
    // 2スロットとも捕捉が完了すると p4-captured へ進む。
    markP4Captured(trialId, gen, slot, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "p3-completed") {
        fail("trial_order", "試行が手順3の完了後ではありません");
      }
      if (slot !== 0 && slot !== 1) {
        fail("bad_trial_input", "スロットが 0 / 1 ではありません");
      }
      const role = slot === 0 ? "P4-1" : "P4-2";
      if (!cur.nonces[role] || cur.nonces[role].state !== "issued") {
        fail("trial_order", `${role} の nonce が取得済みではありません`);
      }
      if (cur.p4Captures[slot] !== null) {
        fail("trial_order", `${role} は捕捉済みです`);
      }
      requireSubjectHash(subjectHash, "認可者の主体ハッシュ");
      requireVerified(verified, "認可者の署名検証");
      if (
        subjectHash === cur.targetCapture.subjectHash ||
        subjectHash === cur.referenceCapture.subjectHash
      ) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("wrong_authorizer", "認可者の主体ハッシュが C または B と同一です");
      }
      if (subjectHash !== cur.authorizerHash) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("authorizer_mismatch", "手順4の認可者が手順3の認可者（A）と同一ではありません");
      }
      cur.p4Captures[slot] = { subjectHash, verified: { ...verified } };
      if (cur.p4Captures[0] !== null && cur.p4Captures[1] !== null) {
        cur.phase = "p4-captured";
      }
      return true;
    },
    // 手順3の要求を凍結する。p3-captured のときにだけ凍結できる。
    // 対象は C 取得で保持した主体ハッシュ、期待世代は手順の固定
    // 値（STALE_EXPECTED_GENERATION = 2）であり、手入力の値は
    // 使わない。画面はこの凍結内容を表示し、所有者の確認でだけ
    // 送信指示を出す。
    freezeStaleRequest(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "p3-captured") {
        fail("trial_order", "試行が手順3の認可の完了後ではありません");
      }
      cur.frozenStale = {
        action: ADD_ACTION,
        subjectHash: cur.targetCapture.subjectHash,
        expectedGeneration: STALE_EXPECTED_GENERATION,
        path: ADD_PATH,
      };
      cur.phase = "p3-frozen";
      return deepFreeze({
        trialId,
        action: cur.frozenStale.action,
        targetSubjectHash: cur.frozenStale.subjectHash,
        expectedGeneration: cur.frozenStale.expectedGeneration,
        path: cur.frozenStale.path,
      });
    },
    // 手順3の凍結済み要求の表示内容。実際の凍結内容から生成する
    // （入力欄の値や画面の別表示からは作らない）。p3-frozen 以降
    // の段階で読める。
    staleDisplayData(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (!cur.frozenStale) {
        fail("trial_order", "手順3の要求が凍結されていません");
      }
      return deepFreeze({
        trialId: cur.trialId,
        action: cur.frozenStale.action,
        targetSubjectHash: cur.frozenStale.subjectHash,
        expectedGeneration: cur.frozenStale.expectedGeneration,
        path: cur.frozenStale.path,
      });
    },
    // 手順3の要求を今送ってよいか。p3-frozen のときにだけ真。
    canSendStale(trialId, gen) {
      if (!this.isCurrent(trialId, gen)) return false;
      return current.phase === "p3-frozen";
    },
    // 手順3の送信結果を期待値と照合する。response が null の
    // 場合は送信器が応答を得られなかった（状態未確定）であり、
    // 停止して再送を許可しない。期待は 409 stale_generation で
    // あること。期待どおりなら p3-completed へ進み、手順4を
    // 始められる。不一致なら試行を停止する（手順4には進まない）。
    recordStaleSend(trialId, gen, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "p3-frozen") {
        fail("trial_order", "試行が手順3の送信待ちの状態ではありません");
      }
      if (response === null || response === undefined) {
        cur.phase = "halted";
        cur.undetermined = true;
        return deepFreeze({
          trialId,
          matched: false,
          state: "halted",
          undetermined: true,
        });
      }
      if (typeof response.status !== "number") {
        fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
      }
      const error = normalizeS11ResponseError(response.error);
      const matched =
        response.status === EXPECTED_STALE_RESPONSE.status &&
        error === EXPECTED_STALE_RESPONSE.error;
      if (!matched) {
        cur.phase = "halted";
        cur.undetermined = false;
        return deepFreeze({
          trialId,
          matched: false,
          state: "halted",
          undetermined: false,
        });
      }
      cur.phase = "p3-completed";
      return deepFreeze({
        trialId,
        matched: true,
        state: "p3-completed",
        undetermined: false,
      });
    },
    // 手順4の2件の要求を凍結する。p4-captured のときにだけ凍結
    // できる。2件とも対象は C 取得で保持した主体ハッシュ、期待
    // 世代は手順の固定値（CONCURRENT_EXPECTED_GENERATION = 3）
    // であり、凍結の時点で2件の同一性を機械確認する。画面は
    // この凍結内容を表示し、所有者の確認でだけ同時送信の指示を出す。
    freezeConcurrentRequests(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "p4-captured") {
        fail("trial_order", "試行が手順4の認可の完了後ではありません");
      }
      const slots = [0, 1].map((slot) => ({
        slot,
        action: ADD_ACTION,
        subjectHash: cur.targetCapture.subjectHash,
        expectedGeneration: CONCURRENT_EXPECTED_GENERATION,
        path: ADD_PATH,
      }));
      // 凍結内容同士の同一性（対象・期待世代）を機械確認する。
      verifyS11RequestsIdentical(
        slots.map((s) => ({
          subject_hash: s.subjectHash,
          expected_generation: s.expectedGeneration,
        }))
      );
      cur.frozenConcurrent = slots;
      cur.phase = "p4-frozen";
      return deepFreeze({
        trialId,
        requests: slots.map((s) => ({
          slot: s.slot,
          action: s.action,
          targetSubjectHash: s.subjectHash,
          expectedGeneration: s.expectedGeneration,
          path: s.path,
        })),
      });
    },
    // 手順4の凍結済み要求の表示内容。実際の凍結内容から生成する。
    // p4-frozen 以降の段階で読める。
    concurrentDisplayData(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (!cur.frozenConcurrent) {
        fail("trial_order", "手順4の要求が凍結されていません");
      }
      return deepFreeze({
        trialId: cur.trialId,
        requests: cur.frozenConcurrent.map((s) => ({
          slot: s.slot,
          action: s.action,
          targetSubjectHash: s.subjectHash,
          expectedGeneration: s.expectedGeneration,
          path: s.path,
        })),
      });
    },
    // 手順4の要求を今送ってよいか。p4-frozen のときにだけ真。
    canSendConcurrent(trialId, gen) {
      if (!this.isCurrent(trialId, gen)) return false;
      return current.phase === "p4-frozen";
    },
    // 手順4の同時送信の結果を期待値と照合する。results は
    // スロット順の2件で、各要素は { status, error, generation }
    // または null（応答なし）。期待は aggregateS11ConcurrentResults
    // の ok（成功ちょうど1件＝200・generation 4、もう1件は 409
    // stale_generation）であること。応答なしがあれば状態未確定
    // として停止する。いずれの場合も再送は許可しない。
    recordConcurrentSend(trialId, gen, results) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "p4-frozen") {
        fail("trial_order", "試行が手順4の送信待ちの状態ではありません");
      }
      const aggregate = aggregateS11ConcurrentResults(results);
      if (aggregate.ok) {
        cur.phase = "completed";
        return deepFreeze({
          trialId,
          matched: true,
          state: "completed",
          undetermined: false,
          aggregate,
        });
      }
      cur.phase = "halted";
      cur.undetermined = aggregate.no_response > 0;
      return deepFreeze({
        trialId,
        matched: false,
        state: "halted",
        undetermined: cur.undetermined,
        aggregate,
      });
    },
    // 試行の破棄。現行の試行なら無効化し（トークンの消去は呼び
    // 出し側が S11_TOKEN_ERASE_TRIGGERS の "trial-discarded" で
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
        cCaptured: cur.targetCapture !== null,
        bCaptured: cur.referenceCapture !== null,
        p3Captured: cur.p3Capture !== null,
        p4CapturedCount: cur.p4Captures.filter((c) => c !== null).length,
        staleFrozen: cur.frozenStale !== null,
        concurrentFrozen: cur.frozenConcurrent !== null,
        undetermined: cur.undetermined,
      });
    },
    currentTrialId() {
      return current === null ? null : current.trialId;
    },
  };
}

// 試験 ID・ステップ・応答の状態と正規化された理由コードだけの
// 記録を返す（単一応答のステップ用）。成功応答は error が null の
// まま通す。一覧にない理由コードは unexpected_error へ置き換える。
// ID トークン・Cookie・nonce・主体ハッシュは含まない。
export function makeS11LogEntry({ trialId, step, response }) {
  requireNonEmptyString(trialId, "試験 ID");
  const steps = [
    "c-captured",
    "b-captured",
    "p3-captured",
    "p3-frozen",
    "p3-sent",
    "p4-captured",
    "p4-frozen",
  ];
  if (!steps.includes(step)) {
    fail("bad_trial_input", "ステップが S11 の単一応答ステップではありません");
  }
  if (!response || typeof response.status !== "number") {
    fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
  }
  return deepFreeze({
    trial_id: trialId,
    step,
    response: {
      status: response.status,
      error: normalizeS11ResponseError(response.error),
      generation:
        typeof response.generation === "number" ? response.generation : null,
    },
  });
}

// 手順4の送信ログ記録。試験 ID とスロットごとの応答（状態・理由
// コード・返された世代）だけを含む。応答が返らなかったスロットは
// status null・error "no_response"（送信側の局所コード。再送
// しない）として記録する。ID トークン・Cookie・nonce・主体
// ハッシュは含まない。
export function makeS11ConcurrentLogEntry({ trialId, results }) {
  requireNonEmptyString(trialId, "試験 ID");
  if (!Array.isArray(results) || results.length !== CONCURRENT_SLOT_COUNT) {
    fail("bad_trial_input", "試験ログの応答が2件ではありません");
  }
  const entries = results.map((r, i) => normalizeResultEntry(r, i));
  return deepFreeze({
    trial_id: trialId,
    step: "p4-sent",
    slots: entries.map((r) => ({
      slot: r.slot,
      response: { status: r.status, error: r.error, generation: r.generation },
    })),
    aggregate: aggregateS11ConcurrentResults(results),
  });
}
