// S11 並行送信（項目6 手順3・4）の Node 側送信器。提供サーバー
// （tools/serve-real.mjs、127.0.0.1 のみ）から使う。ブラウザーには
// 配信しない。
//
// 位置づけ：ブラウザーからは手順4の並行2件を送れない。nonce
// context は Cookie 経由で結び付き、ブラウザーの fetch では
// Cookie ヘッダーを任意に設定できない（forbidden header）ため、
// 単一のブラウザープロファイルからは2件それぞれに異なる nonce
// context Cookie を送れない（2件目の /nonce が1件目の
// op2_nonce_ctx を上書きする）。画面（public/s11-parallel.html）
// は C の主体ハッシュと A の実トークン2件を集めて凍結した要求を
// 作り、表示を確認したうえで、送信指示をこの送信器へ渡す。送信器
// はスロットごとに Cookie jar を分け、2件を Promise.allSettled
// で並行送信する（S5 送信器 tools/s5-sender.mjs と同じ解決。
// Codex の手順レビュー seq 691 の条件1：各要求の Cookie 文脈分離）。
// 手順3の単発送信も、送信経路を1つにそろえ、ブラウザーの共有
// Cookie jar に一切依存しないため、この送信器経由とする。
//
// 信頼境界：ID トークンは、既存の /platform/apply の中継と同じく
// 提供サーバーのメモリーを通過する（ログ・ディスクには出さない）。
// この送信器が保持するのは、発行した nonce に対応する ctx 値
// （HttpOnly Cookie の値）と、送信指示で渡された要求だけであり、
// 送信の完了（成功・失敗を問わず）直後に破棄する。保持は送信の
// 直前から直後までの数秒に限る。発行した nonce の値そのものは
// 画面へ返す（GIS の nonce として使うため。表示・ログには出さない）。
//
// 動作：
// - issueNonces({ trialId, procedure }): 中継先の /nonce を手順に
//   応じた件数（stale は1回、concurrent は2回）呼び、スロット
//   ごとに { nonce, ctx, issuedAt } を保持する。issuedAt は発行を
//   始めた時刻であり、全スロット共通の保守的な起点である。送信の
//   寿命はその起点から4分で測る（S5 送信器と同じ。Worker は
//   /nonce 要求の到着時に有効期限を開始するため、応答受信時刻
//   では遅延分だけ新しく見積もってしまう）。1件でも失敗すれば
//   保持を破棄し、送信できない状態にする。返すのは nonce の配列
//   だけであり、ctx は返さない。発行は渡された試行 ID と手順に
//   結び付ける（送信指示の試行 ID・手順と一致しなければ送信
//   しない。別画面・別試行・別手順との競合防止）。発行中（busy）
//   は、並行する発行と送信を拒否する（s11_busy）。
// - sendStale({ trialId, request }): 送信前に次を確認し、満たさ
//   なければ1件も送らない（fail-closed）。(1) nonce を発行済み
//   で、手順が stale であること。(2) 発行開始から4分以内である
//   こと。(3) 送信指示の試行 ID が発行した試行 ID と一致すること。
//   (4) 要求の expected_generation が手順3の固定値（2）である
//   こと。(5) トークンの nonce クレームが、そのスロットに発行
//   した nonce と一致すること（JWT ペイロードの復号による結び
//   付け確認。署名検証はサーバー側が行う）。確認が通れば、送信
//   前に同期的に発行状態を消費して送信中へ遷移し（busy を
//   "sending" にする）、1件を送信する。消費は最初の await の前に
//   同期的に行うため、並行する send は2件目が s11_busy／
//   s11_not_prepared で拒否され、同じ枠が2回送られることはない。
// - sendConcurrent({ trialId, requests }): stale と同じ確認に
//   加え、(6) 要求が2件であること。(7) 2件の対象・期待世代が
//   同一であり、期待世代が手順4の固定値（3）であること
//   （verifyS11RequestsIdentical）。(8) 2件のトークンが互いに
//   異なること（同一トークンの使い回しは、同一 nonce の再送と
//   同じく nonce_replayed の交絡になるため拒否する）。確認が
//   通れば同期的に消費し、2件を Promise.allSettled で並行送信
//   する。各スロットの Cookie ヘッダーはそのスロットの ctx だけ
//   である。同時送信の担保は、消費と busy 遷移を最初の await の
//   前に行い、2件の fetch を同一の同期区間で開始することである
//   （片方だけが先に送られて結果を見てから他方を送る、という
//   逐次化は起きない）。
// - 応答はスロットごとに { slot, status, error, generation }
//   だけを記録する。generation は応答本文の数値の場合だけ残す
//   （世代の読み戻しは別途 Data Studio で行う。ここでは応答の
//   記録に限る）。応答が返らなかったスロットは { slot, status:
//   null, error: "no_response", generation: null } として記録し、
//   再送しない。3xx の応答は追従せず、再送なしの失敗
//   （error: "redirect_not_followed"）として記録する。送信の
//   完了後、保持した nonce・ctx・要求への参照は既に破棄済みで
//   ある。
// - fetch はすべて redirect: "manual" を明示する。307/308 で
//   中継先が外部 URL を返しても、ID トークン・Cookie を含む POST
//   が転送されることはない（S5 送信器と同じ）。/nonce も同様に
//   3xx 非追従とし、3xx は発行失敗として扱う。
// - ログにはメソッド・パス・応答状態だけを出す。要求・応答の
//   本体、トークン・Cookie・nonce の値は出さない（serve-real.mjs
//   の既存の規則と同じ）。

import { extractNonceCtx, tokenNonce } from "./s5-sender.mjs";
import {
  ADD_PATH,
  STALE_EXPECTED_GENERATION,
  CONCURRENT_EXPECTED_GENERATION,
  CONCURRENT_SLOT_COUNT,
  S11_NO_RESPONSE,
  S11_REDIRECT_NOT_FOLLOWED,
  verifyS11RequestsIdentical,
  normalizeS11ResponseError,
  aggregateS11ConcurrentResults,
} from "./s11-parallel.mjs";

const NONCE_CTX_COOKIE = "op2_nonce_ctx";
const EXPECTED_ORIGIN = "http://localhost:8787";
// nonce の有効期限は5分。送信は発行を開始した時刻から4分以内に
// 限る（余裕1分。起点は要求の開始時刻であり、応答の受信時刻では
// ない。Worker は要求の到着時に有効期限を開始する）。期限を過ぎた
// 発行は送信せず、再準備する。Worker の状態は消費されない。
const SEND_WITHIN_MS = 4 * 60 * 1000;

// 手順ごとの発行件数。stale（手順3）は1件、concurrent（手順4）は2件。
const PROCEDURE_SLOT_COUNTS = Object.freeze({
  stale: 1,
  concurrent: CONCURRENT_SLOT_COUNT,
});

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

export function createS11Sender({ relayUrl, fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (typeof relayUrl !== "string" || !relayUrl) {
    fail("bad_config", "中継先 URL が未指定です");
  }
  const base = relayUrl.replace(/\/$/, "");
  // issued: { trialId, procedure, slots: [{ nonce, ctx, issuedAt }] }
  // （送信前まで保持）
  // busy: null | "issuing" | "sending"（発行中・送信中の排他。同期的に
  // 遷移するため、並行する発行・送信の競合は2件目が s11_busy で
  // 拒否される）
  let issued = null;
  let busy = null;

  function clear() {
    issued = null;
  }

  function requireTrialId(trialId) {
    if (typeof trialId !== "string" || !trialId) {
      fail("bad_trial_input", "試験 ID がありません");
    }
    return trialId;
  }

  // 送信前の共通確認。満たさなければ例外（1件も送らない）。
  // 確認が通れば、最初の await の前に同期的に発行状態を消費して
  // 送信中へ遷移し、スロット一覧を返す。
  function consumeForSend({ trialId, procedure }) {
    if (busy) {
      fail("s11_busy", "発行中または送信中のため、送信はできません");
    }
    if (!issued) {
      fail("s11_not_prepared", "nonce を発行していません");
    }
    requireTrialId(trialId);
    if (trialId !== issued.trialId) {
      fail("s11_trial_mismatch", "発行した試行と送信指示の試行が一致しません");
    }
    if (procedure !== issued.procedure) {
      fail("s11_procedure_mismatch", "発行した手順と送信指示の手順が一致しません");
    }
    // 寿命は発行を開始した時刻から4分で測る（全スロット共通の
    // 保守的な起点。応答の遅延があっても、実際の期限より新しく
    // 見積もることはない）。
    const earliestIssuedAt = Math.min(...issued.slots.map((s) => s.issuedAt));
    if (now() - earliestIssuedAt > SEND_WITHIN_MS) {
      clear();
      fail("s11_nonces_expired", "nonce の発行開始から4分を過ぎました。再準備してください");
    }
    const slots = issued.slots;
    issued = null;
    busy = "sending";
    return slots;
  }

  // 1件の要求を、そのスロットの ctx だけで送信する。応答は
  // { status, error, generation } だけを返す。fetch の例外は
  // no_response として記録し、再送しない。
  async function postAdd(slotCtx, request) {
    const res = await fetchImpl(base + ADD_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: EXPECTED_ORIGIN,
        Cookie: `${NONCE_CTX_COOKIE}=${slotCtx}`,
      },
      // リダイレクトは追従しない。307/308 で中継先が外部 URL を
      // 返しても、ID トークン・Cookie を含む POST が転送される
      // ことはない。3xx は追従せず再送なしの失敗として記録する。
      redirect: "manual",
      body: JSON.stringify(request),
    });
    if (res.status >= 300 && res.status < 400) {
      try {
        if (res.body) await res.body.cancel();
      } catch { /* 本文破棄の失敗は無視する */ }
      return { status: res.status, error: S11_REDIRECT_NOT_FOLLOWED, generation: null };
    }
    const data = await res.json().catch(() => null);
    return {
      status: res.status,
      error: normalizeS11ResponseError(data && data.error !== undefined ? data.error : null),
      generation: data && typeof data.generation === "number" ? data.generation : null,
    };
  }

  return {
    // 手順に応じた件数分の nonce を発行し、スロットごとに ctx と
    // 発行時刻を保持する。返すのは nonce の配列だけである（ctx は
    // 返さない）。発行は試行 ID と手順に結び付ける。発行中は並行
    // する発行・送信を拒否する。
    async issueNonces({ trialId, procedure } = {}) {
      requireTrialId(trialId);
      const count = PROCEDURE_SLOT_COUNTS[procedure];
      if (!count) {
        fail("s11_bad_procedure", "手順が stale / concurrent ではありません");
      }
      if (busy) {
        fail("s11_busy", "発行中または送信中のため、nonce の発行はできません");
      }
      busy = "issuing";
      // 寿命の起点は、発行を始めた時刻（全スロット共通）である。
      // 最初の await の前に同期的に記録する。Worker は /nonce 要求
      // の到着時に有効期限を開始するため、応答受信時刻を起点に
      // すると、応答の遅延分だけ実際の期限より新しく見積もって
      // しまう（S5 送信器と同じ）。
      const issueStartedAt = now();
      const slots = [];
      try {
        for (let i = 0; i < count; i++) {
          const res = await fetchImpl(base + "/nonce", {
            method: "GET",
            // リダイレクトは追従しない。3xx は発行失敗として扱い、
            // 実リダイレクト先へは要求を送らない。
            redirect: "manual",
          });
          if (res.status >= 300 && res.status < 400) {
            try {
              if (res.body) await res.body.cancel();
            } catch { /* 本文破棄の失敗は無視する */ }
            throw new Error("nonce redirect not followed");
          }
          const data = await res.json().catch(() => null);
          const setCookies =
            typeof res.headers.getSetCookie === "function"
              ? res.headers.getSetCookie()
              : [];
          const ctx = extractNonceCtx(setCookies);
          if (!res.ok || !data || !data.nonce || !ctx) {
            throw new Error("nonce issuance failed");
          }
          // issuedAt は全スロットで発行開始時刻（issueStartedAt）を
          // 使う。スロットごとの応答受信時刻ではない。
          slots.push({ nonce: data.nonce, ctx, issuedAt: issueStartedAt });
        }
      } catch {
        clear();
        busy = null;
        fail("s11_nonce_issuance_failed", "nonce の発行に失敗しました");
      }
      issued = { trialId, procedure, slots };
      busy = null;
      return issued.slots.map((s) => s.nonce);
    },

    // 手順3の要求を1件送信する。送信前の確認に失敗すれば送らない。
    async sendStale({ trialId, request }) {
      if (busy) {
        fail("s11_busy", "発行中または送信中のため、送信はできません");
      }
      if (!issued) {
        fail("s11_not_prepared", "nonce を発行していません");
      }
      if (issued.procedure !== "stale") {
        fail("s11_procedure_mismatch", "発行した手順と送信指示の手順が一致しません");
      }
      if (!request || typeof request !== "object") {
        fail("bad_trial_input", "要求がありません");
      }
      if (request.expected_generation !== STALE_EXPECTED_GENERATION) {
        fail(
          "s11_bad_expected_generation",
          `手順3の期待世代は固定値 ${STALE_EXPECTED_GENERATION} でなければなりません`
        );
      }
      // トークンの nonce が、そのスロットに発行した nonce と一致
      // することを確認する（結び付けの取り違え防止）。発行状態の
      // 消費は、この確認が通った後に consumeForSend で行う。
      if (tokenNonce(request.id_token) !== issued.slots[0].nonce) {
        fail("slot_nonce_mismatch", "スロットとトークンの nonce が一致しません");
      }
      const slots = consumeForSend({ trialId, procedure: "stale" });
      try {
        const result = await postAdd(slots[0].ctx, request).catch(() => ({
          status: null,
          error: S11_NO_RESPONSE,
          generation: null,
        }));
        return { trial_id: trialId, procedure: "stale", result };
      } finally {
        busy = null;
      }
    },

    // 手順4の同一要求2件を並行送信する。送信前の確認に失敗すれば
    // 1件も送らない。
    async sendConcurrent({ trialId, requests }) {
      if (busy) {
        fail("s11_busy", "発行中または送信中のため、送信はできません");
      }
      if (!issued) {
        fail("s11_not_prepared", "nonce を発行していません");
      }
      if (issued.procedure !== "concurrent") {
        fail("s11_procedure_mismatch", "発行した手順と送信指示の手順が一致しません");
      }
      if (!Array.isArray(requests) || requests.length !== CONCURRENT_SLOT_COUNT) {
        fail("s11_bad_request_count", "要求が2件ではありません");
      }
      verifyS11RequestsIdentical(requests);
      for (const r of requests) {
        if (r.expected_generation !== CONCURRENT_EXPECTED_GENERATION) {
          fail(
            "s11_bad_expected_generation",
            `手順4の期待世代は固定値 ${CONCURRENT_EXPECTED_GENERATION} でなければなりません`
          );
        }
      }
      // 2件のトークンが同一ではならない（同一トークンは同一
      // nonce の再送となり、nonce_replayed の交絡になる）。
      if (requests[0].id_token === requests[1].id_token) {
        fail("s11_tokens_not_distinct", "2件の ID トークンが同一です");
      }
      // 各スロットのトークンの nonce が、そのスロットに発行した
      // nonce と一致することを確認する（結び付けの取り違え防止）。
      for (let i = 0; i < CONCURRENT_SLOT_COUNT; i++) {
        if (tokenNonce(requests[i].id_token) !== issued.slots[i].nonce) {
          fail("slot_nonce_mismatch", "スロットとトークンの nonce が一致しません");
        }
      }
      // 確認が通ったここで、最初の await の前に同期的に発行状態を
      // 消費して送信中へ遷移する。これ以降の並行 send は busy／
      // not_prepared により拒否され、同じ枠が2回送られることはない。
      const slots = consumeForSend({ trialId, procedure: "concurrent" });
      let settled;
      try {
        settled = await Promise.allSettled(
          requests.map((request, i) =>
            postAdd(slots[i].ctx, request).then((r) => ({ slot: i, ...r }))
          )
        );
      } finally {
        busy = null;
      }
      const results = settled.map((s, i) => {
        if (s.status === "fulfilled") return s.value;
        return { slot: i, status: null, error: S11_NO_RESPONSE, generation: null };
      });
      // 発行状態は送信前に既に消費済みである（成功・失敗を問わず再送しない）。
      return {
        trial_id: trialId,
        procedure: "concurrent",
        results,
        aggregate: aggregateS11ConcurrentResults(results),
      };
    },

    clear,
    // 試験用の状態確認。発行済みかどうかだけを返す（値は返さない）。
    isPrepared() {
      return issued !== null;
    },
  };
}
