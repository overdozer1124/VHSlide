// S5 並行試験（項目2 手順3）の Node 側送信器。提供サーバー
// （tools/serve-real.mjs、127.0.0.1 のみ）から使う。ブラウザーには
// 配信しない。
//
// 位置づけ：ブラウザーからは6件の並行送信ができない。nonce context
// は Cookie 経由で結び付き、ブラウザーの fetch では Cookie ヘッダーを
// 任意に設定できない（forbidden header）ため、単一のブラウザー
// プロファイルからは6件それぞれに異なる nonce context Cookie を送れ
// ない。画面（public/s5-apply.html）は6件の実トークンを集めて凍結
// した要求を作り、表示を確認したうえで、送信指示をこの送信器へ渡す。
// 送信器はスロットごとに Cookie jar を分け、6件を Promise.all で
// 並行送信する。
//
// 信頼境界：ID トークン・一回値は、既存の /platform/apply の中継と
// 同じく提供サーバーのメモリーを通過する（ログ・ディスクには出さない）。
// この送信器が新たに保持するのは、発行した nonce に対応する ctx 値
// （HttpOnly Cookie の値）と、送信指示で渡された6件の要求だけであり、
// 送信の完了（成功・失敗を問わず）直後に破棄する。保持は送信の直前
// から直後までの数秒に限る。発行した nonce の値そのものは画面へ返す
// （GIS の nonce として使うため。表示・ログには出さない）。
//
// 動作：
// - issueNonces({ trialId }): 中継先の /nonce を6回呼び、スロットごと
//   に { nonce, ctx, issuedAt } を保持する。ctx は Set-Cookie の
//   op2_nonce_ctx の値である。issuedAt はスロットごとの発行時刻で
//   あり、送信の寿命は最初のスロットの発行から4分で測る（Codex
//   レビュー 6720755818 の指摘4。6件発行完了後に置いた単一の時刻では
//   発行中の遅延が考慮されないため）。1件でも失敗すれば保持を破棄し、
//   送信できない状態にする。返すのは nonce の配列だけであり、ctx は
//   返さない。発行した6枠は、渡された試行 ID に結び付ける（送信指示
//   の試行 ID と一致しなければ送信しない。別画面・別試行との競合防止）。
//   発行中（busy）は、並行する発行と送信を拒否する（s5_busy）。
// - send({ trialId, requests }): 送信前に次を確認し、満たさなければ
//   1件も送らない（fail-closed）。(1) nonce を発行済みであること。
//   (2) 最初のスロットの発行から4分以内であること（nonce の有効期限
//   は5分。期限切れの nonce で送ると trial が不成立になるため、余裕
//   を持って拒否する。拒否された場合は再準備する。Worker の状態は
//   消費されない）。(3) 要求が6件であること。(4) 6件の env_id・
//   purpose・一回値がすべて同一であること。(5) 各スロットのトークン
//   の nonce クレームが、そのスロットに発行した nonce と一致すること
//   （JWT ペイロードの復号による結び付け確認。署名検証はサーバー側が
//   行う）。(6) 送信指示の試行 ID が、発行した試行 ID と一致すること。
//   確認が通れば、送信前に同期的に発行状態を消費して送信中へ遷移し
//   （busy を "sending" にする）、6件を Promise.allSettled で並行
//   送信する。消費は最初の await の前に同期的に行うため、並行する
//   send は2件目が s5_busy で拒否され、同じ6枠が2回送られることは
//   ない。送信中の nonce 再発行も s5_busy で拒否する。各スロットの
//   Cookie ヘッダーはそのスロットの ctx だけである。応答はスロット
//   ごとに { slot, status, error } だけを記録する。応答が返らな
//   かったスロットは { slot, status: null, error: "no_response" }
//   として記録し、再送しない。3xx の応答は追従せず、再送なしの失敗
//   （error: "redirect_not_followed"）として記録する。送信の完了後、
//   保持した nonce・ctx・要求への参照は既に破棄済みである。
// - fetch はすべて redirect: "manual" を明示する。307/308 で中継先
//   が外部 URL を返しても、ID トークン・一回値・Cookie を含む POST
//   が転送されることはない（Codex レビュー 6720755818 の指摘1）。
//   /nonce も同様に 3xx 非追従とし、3xx は発行失敗として扱う。
// - ログにはメソッド・パス・応答状態だけを出す。要求・応答の本体、
//   トークン・一回値・Cookie・nonce の値は出さない（serve-real.mjs
//   の既存の規則と同じ）。

import { parseJwt } from "./subject-hash-verify.mjs";
import {
  S5_SLOT_COUNT,
  S5_NO_RESPONSE,
  S5_REDIRECT_NOT_FOLLOWED,
  aggregateS5Results,
  verifyS5RequestsEqual,
} from "./s5-apply.mjs";
import { normalizeResponseError } from "./trial-apply.mjs";

const NONCE_CTX_COOKIE = "op2_nonce_ctx";
const EXPECTED_ORIGIN = "http://localhost:8787";
// nonce の有効期限は5分。送信は最初のスロットの発行から4分以内に限る
// （余裕1分）。期限を過ぎた発行は送信せず、再準備する。
const SEND_WITHIN_MS = 4 * 60 * 1000;

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

// Set-Cookie 文字列の配列から op2_nonce_ctx の値を取り出す。
// 見つからなければ null。
export function extractNonceCtx(setCookies) {
  const list = Array.isArray(setCookies) ? setCookies : [];
  for (const sc of list) {
    if (typeof sc !== "string") continue;
    const pair = sc.split(";")[0].trim();
    const eq = pair.indexOf("=");
    if (eq > 0 && pair.slice(0, eq) === NONCE_CTX_COOKIE) {
      return pair.slice(eq + 1);
    }
  }
  return null;
}

// ID トークンのペイロードから nonce クレームを取り出す。署名検証は
// 行わない（結び付け確認だけ。署名検証はサーバー側が行う）。
// 実トークンは JWT 形式（3部分）であり、ペイロードの nonce クレーム
// を読む。ローカル模擬のモック形式（mockop|sub|nonce|iss|aud|exp）
// の場合は2番目の項目が nonce である（Worker の MOCK_AUTH 経路と
// 同じ形式。実環境では使われない）。復号できなければ null。
export function tokenNonce(idToken) {
  if (typeof idToken === "string" && idToken.startsWith("mockop|")) {
    const parts = idToken.slice("mockop|".length).split("|");
    return parts.length >= 2 && parts[1] ? parts[1] : null;
  }
  try {
    const { payload } = parseJwt(idToken);
    return typeof payload.nonce === "string" && payload.nonce
      ? payload.nonce
      : null;
  } catch {
    return null;
  }
}

export function createS5Sender({ relayUrl, fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (typeof relayUrl !== "string" || !relayUrl) {
    fail("bad_config", "中継先 URL が未指定です");
  }
  const base = relayUrl.replace(/\/$/, "");
  // issued: { trialId, slots: [{ nonce, ctx, issuedAt }] }（送信前まで保持）
  // busy: null | "issuing" | "sending"（発行中・送信中の排他。同期的に
  // 遷移するため、並行する発行・送信の競合は2件目が s5_busy で拒否される）
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

  return {
    // 6件分の nonce を発行し、スロットごとに ctx と発行時刻を保持する。
    // 返すのは nonce の配列だけである（ctx は返さない）。発行は試行 ID
    // に結び付ける。発行中は並行する発行・送信を拒否する。
    async issueNonces({ trialId } = {}) {
      requireTrialId(trialId);
      if (busy) {
        fail("s5_busy", "発行中または送信中のため、nonce の発行はできません");
      }
      busy = "issuing";
      const slots = [];
      try {
        for (let i = 0; i < S5_SLOT_COUNT; i++) {
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
          // 発行時刻はスロットごとに、応答を受け取った直後に記録する。
          // 6件発行完了後に置いた単一の時刻では、発行中の遅延が考慮
          // されないため（送信の寿命は最初のスロットの発行から測る）。
          const issuedAt = now();
          const data = await res.json().catch(() => null);
          const setCookies =
            typeof res.headers.getSetCookie === "function"
              ? res.headers.getSetCookie()
              : [];
          const ctx = extractNonceCtx(setCookies);
          if (!res.ok || !data || !data.nonce || !ctx) {
            throw new Error("nonce issuance failed");
          }
          slots.push({ nonce: data.nonce, ctx, issuedAt });
        }
      } catch {
        clear();
        busy = null;
        fail("s5_nonce_issuance_failed", "6件分の nonce の発行に失敗しました");
      }
      issued = { trialId, slots };
      busy = null;
      return issued.slots.map((s) => s.nonce);
    },

    // 6件の要求を並行送信する。送信前の確認に失敗すれば1件も送らない。
    async send({ trialId, requests }) {
      if (busy) {
        fail("s5_busy", "発行中または送信中のため、送信はできません");
      }
      if (!issued) {
        fail("s5_not_prepared", "nonce を発行していません");
      }
      requireTrialId(trialId);
      if (trialId !== issued.trialId) {
        fail("s5_trial_mismatch", "発行した試行と送信指示の試行が一致しません");
      }
      // 寿命は最初のスロットの発行から4分で測る（各スロットの発行時刻
      // に基づく。発行中の遅延があっても、最初の nonce の残存寿命で
      // 判断する）。
      const earliestIssuedAt = Math.min(...issued.slots.map((s) => s.issuedAt));
      if (now() - earliestIssuedAt > SEND_WITHIN_MS) {
        clear();
        fail("s5_nonces_expired", "最初の nonce の発行から4分を過ぎました。再準備してください");
      }
      if (!Array.isArray(requests) || requests.length !== S5_SLOT_COUNT) {
        fail("s5_bad_request_count", "要求が6件ではありません");
      }
      verifyS5RequestsEqual(requests);
      // 各スロットのトークンの nonce が、そのスロットに発行した
      // nonce と一致することを確認する（結び付けの取り違え防止）。
      for (let i = 0; i < S5_SLOT_COUNT; i++) {
        if (tokenNonce(requests[i].id_token) !== issued.slots[i].nonce) {
          fail("slot_nonce_mismatch", "スロットとトークンの nonce が一致しません");
        }
      }
      // 確認が通ったここで、最初の await の前に同期的に発行状態を消費
      // して送信中へ遷移する。これ以降の並行 send は busy により拒否
      // され、同じ6枠が2回送られることはない。
      const slots = issued.slots;
      issued = null;
      busy = "sending";
      let settled;
      try {
        settled = await Promise.allSettled(
          requests.map((request, i) =>
            fetchImpl(base + "/platform/apply", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                Origin: EXPECTED_ORIGIN,
                Cookie: `${NONCE_CTX_COOKIE}=${slots[i].ctx}`,
              },
              // リダイレクトは追従しない。307/308 で中継先が外部 URL を
              // 返しても、ID トークン・一回値・Cookie を含む POST が
              // 転送されることはない。3xx は追従せず再送なしの失敗として
              // 記録する。
              redirect: "manual",
              body: JSON.stringify(request),
            }).then(async (res) => {
              if (res.status >= 300 && res.status < 400) {
                try {
                  if (res.body) await res.body.cancel();
                } catch { /* 本文破棄の失敗は無視する */ }
                return { slot: i, status: res.status, error: S5_REDIRECT_NOT_FOLLOWED };
              }
              const data = await res.json().catch(() => null);
              return {
                slot: i,
                status: res.status,
                error: data && data.error ? normalizeResponseError(data.error) : null,
              };
            })
          )
        );
      } finally {
        busy = null;
      }
      const results = settled.map((s, i) => {
        if (s.status === "fulfilled") return s.value;
        return { slot: i, status: null, error: S5_NO_RESPONSE };
      });
      // 発行状態は送信前に既に消費済みである（成功・失敗を問わず再送しない）。
      return {
        trial_id: trialId,
        results,
        aggregate: aggregateS5Results(results),
      };
    },

    clear,
    // 試験用の状態確認。発行済みかどうかだけを返す（値は返さない）。
    isPrepared() {
      return issued !== null;
    },
  };
}
