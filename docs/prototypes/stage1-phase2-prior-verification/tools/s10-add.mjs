// S10（項目6 手順1：運営者Bの追加）専用の純粋モジュール。
//
// 目的：Codex レビュー Issue #3 コメント 6758375470 への対応として、
// S10 の追加操作（B の主体取得 → A の認可 → 凍結要求の表示・確認 →
// 送信 → 登録後の検証）を、専用画面（public/s10-add-operator.html）
// から安全に行うための状態機械と検証を提供する。表示・ログ・Issue・
// チャットに ID トークン・Cookie・nonce・主体ハッシュを出さない。
//
// - このモジュールはネットワーク通信を一切行わない。Node（テスト）と
//   ブラウザー（画面）の両方から同じ実装を使うため、依存するのは
//   trial-apply.mjs・s9-negative.mjs（nonce 期限）と Object.freeze・
//   JSON だけである。秘密の比較は呼び出し側（ブラウザー画面）の
//   メモリー内だけで行い、このモジュールは値を保存・出力しない。
// - 順序は B の主体取得 → A の認可 → 凍結 → 送信の固定順である。
//   A の認可は B の主体取得が完了してからしか始められない（B 取得の
//   nonce・Cookie 文脈を、A 取得の /nonce が上書きしないため）。
// - B／A の本人確認は、画面側が PC 内署名検証
//   （tools/subject-hash-verify.mjs の verifyIdTokenLocal）で署名・
//   iss・aud・exp・nonce を確認した結果を、markBCaptured／
//   markACaptured に渡す。検証が通らなければ画面は試行を失敗させ、
//   このモジュールはその試行を進めない。B と A の主体ハッシュが同一
//   の場合は機械的に same_subject で試行を停止する（同一アカウントを
//   B と A の両方に使う誤りを、送信前に防ぐ）。B の表示と凍結要求の
//   表示は別の DOM 領域で、所有者が両方を目視で照合できる（根拠を
//   分ける。Codex レビュー 6758375470 の指摘1）。
// - 凍結要求は、実際の送信に使う値から生成する。対象の主体ハッシュは
//   B 取得でメモリーに保持した値、期待世代は手順の固定値
//   （EXPECTED_GENERATION = 2）であり、手入力欄は作らない。画面は
//   displayData の内容（試行 ID・action・対象・期待世代・送信先）を
//   送信直前に表示し、所有者の確認ボタンでだけ送信する（指摘2）。
// - nonce の期限は要求開始時刻（/nonce 要求の fetch 呼び出し直前に
//   同期的に記録した時刻）＋5分である（s9-negative.mjs と同一の規則。
//   応答の受信時刻は起点に使わない）。B 取得と A 認可の nonce は試行
//   に閉じ込め、取得中の再取得は nonce_fetch_busy、取得済みの再取得は
//   nonce_already_issued で拒否する。遅れて戻った旧応答は
//   finishNonceFetch が null で破棄する（期限・nonce を上書きしない）。
//   並行する /nonce 要求を出さないことで、Cookie の上書きを防ぐ。
// - 送信は一度だけである。recordSend は期待応答（200 ok かつ返された
//   generation が期待世代＋1＝3）と照合し、不一致なら試行を停止する。
//   fetch が例外（レスポンスなし）の場合は状態未確定として停止し、
//   再送を許可しない（再送せず読み戻す。指摘3・5）。二重配信に対する
//   サーバー側の保護は、同一 nonce の再送が nonce_replayed で拒否
//   されることと、世代照合（成功後は世代が 3 になり、期待世代 2 の
//   要求は stale_generation で拒否されること）であり、
//   test/s10-add-guard.test.mjs でローカル模擬により確認する。
// - 別タブ干渉：op2_nonce_ctx Cookie は同一生成元（ブラウザー）で共有
//   されるため、別タブで /nonce を取得すると現行試行の Cookie 文脈が
//   上書きされ、送信は nonce_context_mismatch で拒否される（誤った
//   適用にはならない。安全側の拒否である）。画面は試行中に他の検証
//   ページを開かないよう注記し、順序の固定と取得中の排他で窓を狭める。
// - トークン消去の契機は S10_TOKEN_ERASE_TRIGGERS に明記する（追加完了・
//   追加停止・試行の破棄・新規試行の開始）。消去そのものは呼び出し側
//   （ブラウザー画面）がメモリー内の変数を空にして行う。
// - 送信は fetch で method POST、headers content-type
//   application/json、body JSON {id_token, subject_hash,
//   expected_generation}、redirect: "manual" である。リダイレクトは
//   追従しない（3xx は応答として記録し、再送しない）。
//
// S10 の固定状態：開始前 generation 2・登録簿 {A}、終了時 generation
// 3・登録簿 {A, B}。世代の増分が1だけであることを、Data Studio の
// 読み戻し（対象行そのものの一致）と B の新しいトークンでの照会で
// 確認する（指摘4）。試験先は既存の検証用 Worker に限定し、本番には
// 触れない。

import { normalizeResponseError } from "./trial-apply.mjs";
// nonce の期限の規則（要求開始時刻＋5分）は s9-negative.mjs と同一
// のものを使う。画面は s9-negative.mjs から直接 import する。
import { NONCE_TTL_MS, nonceDeadline, isNonceExpired } from "./s9-negative.mjs";

// S10 の追加操作の固定値。送信先と action、期待世代は手順書 §4.7
// S10 の固定状態（開始前 generation 2）から決まる定数であり、画面
// からの入力では変えられない。
export const ADD_ACTION = "add";
export const ADD_PATH = "/admin/registry/add";
export const EXPECTED_GENERATION = 2;

// トークン消去の契機。消去そのものは呼び出し側（ブラウザー画面）が
// メモリー内の変数を空にして行う。消去を忘れてはならない契機をここに
// 列挙し、画面と試験で参照する。s9-negative.mjs の同名の定数とは別物
// であるため、S10 のものには接頭辞を付ける（画面試験で両モジュールを
// 結合するため、同名の const は重複宣言になる）。
export const S10_TOKEN_ERASE_TRIGGERS = Object.freeze([
  "add-completed", // 追加完了（期待どおりの 200・generation 3）
  "add-halted", // 追加停止（期待外れ応答・応答なし・同一主体の検出）
  "trial-discarded", // 試行の破棄（破棄ボタン・捕捉時の検証失敗）
  "new-trial-begun", // 新規試行の開始（旧試行の無効化と同時に旧トークンを消去）
]);

// 送信の期待応答。200 ok かつ返された generation が期待世代＋1
// （S10 では 3）であること。世代が異なれば不一致として停止する。
export const EXPECTED_SEND_RESPONSE = Object.freeze({
  status: 200,
  error: null,
  ok: true,
  generation: EXPECTED_GENERATION + 1,
});

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

// 主体ハッシュの形式（SHA-256 の 64桁 hex）。画面が PC 内署名検証で
// 算出した値を渡すときの形式確認。値そのものは例外文に含めない。
function requireSubjectHash(value, what) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    fail("bad_trial_input", `${what} が64桁の16進数ではありません`);
  }
  return value;
}

// PC 内署名検証の結果。画面が verifyIdTokenLocal の成功を受けて渡す。
// 署名・iss・aud・exp・nonce のすべてが真であること。1つでも偽・
// 未指定なら、検証が通っていないものとして拒否する。
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

// 追加試行の状態機械。許可する順序は B の主体取得 → A の認可 →
// 凍結 → 送信。fetch が例外（レスポンスなし）の場合は状態未確定と
// して停止し、再送を許可しない。古い世代のコールバックは拒否する。
// さらに役割と段階も照合する（isCallbackCurrent：B は b-preparing、
// A は b-captured のときにだけ有効）。重複 GIS コールバックも段階で
// 拒否する。さらに各役割の捕捉は claimCallbackCapture で1回に固定
// する（受付済み・処理中の同一試行・役割への後続コールバックは、
// ユーザーの確認で段階が進む前でも拒否する）。
// nonce の取得も試行に閉じ込める。beginNonceFetch は /nonce 要求の
// 開始直前に同期的に呼び、開始時刻（startedAtMs）を試行に記録する。
export function createAddSession() {
  let current = null; // { trialId, generation, phase, bCapture, aCapture, frozen, undetermined }
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
    // 新しい追加試行を始める。前回の試行を無効化する（旧トークンの
    // 消去は呼び出し側が S10_TOKEN_ERASE_TRIGGERS の "new-trial-begun"
    // で行う）。開始直後の段階は B の主体取得の準備である。
    beginTrial() {
      generation += 1;
      const trialId = makeTrialId();
      current = {
        trialId,
        generation,
        phase: "b-preparing",
        bCapture: null, // { subjectHash, verified }
        aCapture: null, // { subjectHash, verified }
        bCallbackClaimed: false, // 役割 B のコールバック受付済みか
        aCallbackClaimed: false, // 役割 A のコールバック受付済みか
        bNonce: null, // { startedAtMs, state: "pending" | "issued", nonce }
        aNonce: null,
        frozen: null, // { action, subjectHash, expectedGeneration, path }
        undetermined: false,
      };
      return deepFreeze({ trialId, generation });
    },
    isCurrent(trialId, gen) {
      return (
        current !== null && current.trialId === trialId && current.generation === gen
      );
    },
    // GIS コールバックが現行の試行・役割・段階に属するかを照合する。
    // 役割 B は b-preparing、役割 A は b-captured のときにだけ有効。
    // 古い試行・役割外・段階外のコールバックは偽を返す。画面は
    // onGoogleSignIn の各 await の後（JWKS 取得後・署名検証後・
    // sha256hex 後）でこれを呼び、遅延・破棄・新試行・役割移行を
    // またいだ古い／重複コールバックが共有の状態へ書き込むのを防ぐ。
    // 特に sha256hex は非同期であり、その完了を待つ間に試行が置換
    // され得るため、ハッシュ後の再照合が必須である（Codex コメント
    // 6758648104 の指摘1）。
    isCallbackCurrent(trialId, gen, role) {
      if (!this.isCurrent(trialId, gen)) return false;
      if (role === "B") return current.phase === "b-preparing";
      if (role === "A") return current.phase === "b-captured";
      return false;
    },
    // 役割ごとの捕捉は1回だけ受け付ける。コールバックは受付の時点で
    // この claim を取り、受付済み・処理中の同一試行・役割への後続
    // コールバックは偽を返して拒否させる。段階（b-preparing／
    // b-captured）はユーザーの確認（markBCaptured／markACaptured）
    // まで変化しないため、段階の照合だけでは、並行して各 await を
    // 通る同役割の複数コールバックのうち遅れて完了したものが、先に
    // 署名検証済みとして表示されたハッシュ・トークンを上書きし得る
    // （Codex コメント 6758817319）。claim は試行に閉じ込めるため、
    // 新しい試行は前の試行の claim に妨げられない。
    claimCallbackCapture(trialId, gen, role) {
      if (!this.isCallbackCurrent(trialId, gen, role)) return false;
      const slot = role === "B" ? "bCallbackClaimed" : "aCallbackClaimed";
      if (current[slot]) return false;
      current[slot] = true;
      return true;
    },
    // /nonce 要求の開始を試行に記録する。role は "B" または "A"。
    // B の取得は b-preparing のときにだけ、A の認可は b-captured の
    // ときにだけ始められる（B の取得が完了する前に A の /nonce を
    // 出すと、B の Cookie 文脈が上書きされるため）。取得中の再取得は
    // nonce_fetch_busy、取得済みの再取得は nonce_already_issued で
    // 拒否する。古い試行は stale_attempt。
    beginNonceFetch(trialId, gen, role, startedAtMs) {
      const cur = requireCurrent(trialId, gen);
      if (role !== "B" && role !== "A") {
        fail("bad_trial_input", "取得の役割が B / A ではありません");
      }
      if (role === "B" && cur.phase !== "b-preparing") {
        fail("trial_order", "B の主体取得の準備中ではありません");
      }
      if (role === "A" && cur.phase !== "b-captured") {
        fail("trial_order", "B の主体取得が完了していません");
      }
      if (!Number.isFinite(startedAtMs)) {
        fail("bad_trial_input", "nonce 要求の開始時刻が数値ではありません");
      }
      const slot = role === "B" ? "bNonce" : "aNonce";
      if (cur[slot] && cur[slot].state === "pending") {
        fail("nonce_fetch_busy", "nonce の取得中です");
      }
      if (cur[slot] && cur[slot].state === "issued") {
        fail("nonce_already_issued", "nonce は既に取得済みです");
      }
      cur[slot] = { startedAtMs, state: "pending", nonce: null };
      return deepFreeze({ trialId, generation: gen, role, startedAtMs });
    },
    // /nonce 応答を試行に適用する。現行の試行・取得中のものに限る。
    // 遅れて戻った旧試行の応答・破棄後の応答・取得中でない試行の応答は
    // null を返して適用しない。適用時は期限の起点として要求開始時刻
    // （startedAtMs）をそのまま返す（応答の受信時刻は使わない）。
    finishNonceFetch(trialId, gen, role, nonce) {
      if (!this.isCurrent(trialId, gen)) return null;
      const slot = role === "B" ? "bNonce" : "aNonce";
      const req = current[slot];
      if (!req || req.state !== "pending") return null;
      if (typeof nonce !== "string" || nonce.length === 0) return null;
      req.state = "issued";
      req.nonce = nonce;
      return deepFreeze({ nonce, issuedAtMs: req.startedAtMs });
    },
    // 試行に記録された nonce 期限の起点（要求開始時刻）。未取得なら
    // null。古い試行は stale_attempt。
    nonceIssuedAt(trialId, gen, role) {
      const cur = requireCurrent(trialId, gen);
      const slot = role === "B" ? "bNonce" : "aNonce";
      if (!cur[slot] || cur[slot].state !== "issued") return null;
      return cur[slot].startedAtMs;
    },
    // 試行の nonce 取得が飛行中かどうか。古い試行は偽。
    isNonceFetchPending(trialId, gen, role) {
      if (!this.isCurrent(trialId, gen)) return false;
      const slot = role === "B" ? "bNonce" : "aNonce";
      return !!current[slot] && current[slot].state === "pending";
    },
    // B の主体取得の完了。画面が PC 内署名検証を通した結果を渡す。
    // b-preparing のときにだけ b-captured へ進む。検証が不完全なら
    // 例外（試行は進まない）。主体ハッシュは画面のメモリー内にだけ
    // 保持し、このモジュールはログ・画面外へ出さない。
    markBCaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "b-preparing") {
        fail("trial_order", "試行が B の主体取得の準備中ではありません");
      }
      if (!cur.bNonce || cur.bNonce.state !== "issued") {
        fail("trial_order", "B の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "B の主体ハッシュ");
      requireVerified(verified, "B の署名検証");
      cur.bCapture = { subjectHash, verified: { ...verified } };
      cur.phase = "b-captured";
      return true;
    },
    // A の認可の完了。画面が PC 内署名検証を通した結果を渡す。
    // b-captured のときにだけ a-captured へ進む。A と B の主体ハッシュ
    // が同一の場合は same_subject で試行を停止する（同一アカウントを
    // 両方に使う誤りを、送信前に機械的に防ぐ）。
    markACaptured(trialId, gen, { subjectHash, verified }) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "b-captured") {
        fail("trial_order", "試行が B の主体取得の完了後ではありません");
      }
      if (!cur.aNonce || cur.aNonce.state !== "issued") {
        fail("trial_order", "A の nonce が取得済みではありません");
      }
      requireSubjectHash(subjectHash, "A の主体ハッシュ");
      requireVerified(verified, "A の署名検証");
      if (subjectHash === cur.bCapture.subjectHash) {
        cur.phase = "halted";
        cur.undetermined = false;
        fail("same_subject", "A と B の主体ハッシュが同一です");
      }
      cur.aCapture = { subjectHash, verified: { ...verified } };
      cur.phase = "a-captured";
      return true;
    },
    // 送信する要求を凍結する。a-captured のときにだけ凍結できる。
    // 対象は B 取得で保持した主体ハッシュ、期待世代は手順の固定値
    // （EXPECTED_GENERATION）であり、手入力の値は使わない。画面は
    // この凍結内容を表示し、所有者の確認でだけ送信する。
    freezeRequest(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "a-captured") {
        fail("trial_order", "試行が A の認可の完了後ではありません");
      }
      cur.frozen = {
        action: ADD_ACTION,
        subjectHash: cur.bCapture.subjectHash,
        expectedGeneration: EXPECTED_GENERATION,
        path: ADD_PATH,
      };
      cur.phase = "frozen";
      return deepFreeze({
        trialId,
        action: cur.frozen.action,
        targetSubjectHash: cur.frozen.subjectHash,
        expectedGeneration: cur.frozen.expectedGeneration,
        path: cur.frozen.path,
      });
    },
    // 凍結済み要求の表示内容。実際の凍結内容から生成する（入力欄の
    // 値や画面の別表示からは作らない）。frozen 以降の段階で読める。
    displayData(trialId, gen) {
      const cur = requireCurrent(trialId, gen);
      if (!cur.frozen) {
        fail("trial_order", "要求が凍結されていません");
      }
      return deepFreeze({
        trialId: cur.trialId,
        action: cur.frozen.action,
        targetSubjectHash: cur.frozen.subjectHash,
        expectedGeneration: cur.frozen.expectedGeneration,
        path: cur.frozen.path,
      });
    },
    // その要求を今送ってよいか。frozen のときにだけ真。
    canSend(trialId, gen) {
      if (!this.isCurrent(trialId, gen)) return false;
      return current.phase === "frozen";
    },
    // 送信の応答を期待値と照合する。response が null の場合は fetch
    // の例外（レスポンスなし）であり、状態未確定として停止し、再送を
    // 許可しない。期待は 200 ok かつ返された generation が期待世代＋1
    // （S10 では 3）であること。順序外・古い試行は例外（送信そのもの
    // を拒否）。
    recordSend(trialId, gen, response) {
      const cur = requireCurrent(trialId, gen);
      if (cur.phase !== "frozen") {
        fail("trial_order", "試行が送信待ちの状態ではありません");
      }
      if (response === null || response === undefined) {
        cur.phase = "halted";
        cur.undetermined = true;
        return deepFreeze({
          trialId,
          matched: false,
          state: "halted",
          undetermined: true,
          generation: null,
        });
      }
      if (typeof response.status !== "number") {
        fail("bad_trial_input", "応答の HTTP 状態が数値ではありません");
      }
      const matched =
        response.status === EXPECTED_SEND_RESPONSE.status &&
        (response.error === null || response.error === undefined) &&
        response.ok === true &&
        response.generation === EXPECTED_SEND_RESPONSE.generation;
      if (!matched) {
        cur.phase = "halted";
        cur.undetermined = false;
        return deepFreeze({
          trialId,
          matched: false,
          state: "halted",
          undetermined: false,
          generation:
            typeof response.generation === "number" ? response.generation : null,
        });
      }
      cur.phase = "completed";
      return deepFreeze({
        trialId,
        matched: true,
        state: "completed",
        undetermined: false,
        generation: response.generation,
      });
    },
    // fetch が例外（レスポンスなし）の場合の記録。recordSend に
    // null を渡すことと同じである。
    recordNoResponse(trialId, gen) {
      return this.recordSend(trialId, gen, null);
    },
    // 試行の破棄。現行の試行なら無効化し（トークンの消去は呼び出し側
    // が S10_TOKEN_ERASE_TRIGGERS の "trial-discarded" で行う）、古い試行
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
        phase: cur.phase,
        bCaptured: cur.bCapture !== null,
        aCaptured: cur.aCapture !== null,
        frozen: cur.frozen !== null,
        undetermined: cur.undetermined,
      });
    },
    currentTrialId() {
      return current === null ? null : current.trialId;
    },
  };
}

// 試験 ID・ステップ・応答の状態と正規化された理由コードだけの記録を
// 返す。成功応答（200 ok）は error が null のまま通す。一覧にない
// 理由コードは unexpected_error へ置き換える。ID トークン・Cookie・
// nonce・主体ハッシュは含まない。
export function makeAddLogEntry({ trialId, step, response }) {
  requireNonEmptyString(trialId, "試験 ID");
  const steps = ["b-captured", "a-captured", "frozen", "sent"];
  if (!steps.includes(step)) {
    fail("bad_trial_input", "ステップが b-captured / a-captured / frozen / sent ではありません");
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
    step,
    response: {
      status: response.status,
      error,
      generation:
        typeof response.generation === "number" ? response.generation : null,
    },
  });
}
