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
// - issueNonces(): 中継先の /nonce を6回呼び、スロットごとに
//   { nonce, ctx } を保持する。ctx は Set-Cookie の op2_nonce_ctx の
//   値である。1件でも失敗すれば保持を破棄し、送信できない状態にする。
//   返すのは nonce の配列だけであり、ctx は返さない。
// - send({ trialId, requests }): 送信前に次を確認し、満たさなければ
//   1件も送らない（fail-closed）。(1) nonce を発行済みであること。
//   (2) 発行から4分以内であること（nonce の有効期限は5分。期限切れ
//   の nonce で送ると trial が不成立になるため、余裕を持って拒否
//   する。拒否された場合は再準備する。Worker の状態は消費されない）。
//   (3) 要求が6件であること。(4) 6件の env_id・purpose・一回値が
//   すべて同一であること。(5) 各スロットのトークンの nonce クレーム
//   が、そのスロットに発行した nonce と一致すること（JWT ペイロード
//   の復号による結び付け確認。署名検証はサーバー側が行う）。
//   確認が通れば6件を Promise.all で並行送信する。各スロットの
//   Cookie ヘッダーはそのスロットの ctx だけである。応答はスロット
//   ごとに { slot, status, error } だけを記録する。応答が返らな
//   かったスロットは { slot, status: null, error: "no_response" }
//   として記録し、再送しない。送信の完了後、保持した nonce・ctx・
//   要求への参照を破棄する。
// - ログにはメソッド・パス・応答状態だけを出す。要求・応答の本体、
//   トークン・一回値・Cookie・nonce の値は出さない（serve-real.mjs
//   の既存の規則と同じ）。

import { parseJwt } from "./subject-hash-verify.mjs";
import {
  S5_SLOT_COUNT,
  S5_NO_RESPONSE,
  aggregateS5Results,
  verifyS5RequestsEqual,
} from "./s5-apply.mjs";
import { normalizeResponseError } from "./trial-apply.mjs";

const NONCE_CTX_COOKIE = "op2_nonce_ctx";
const EXPECTED_ORIGIN = "http://localhost:8787";
// nonce の有効期限は5分。送信は発行から4分以内に限る（余裕1分）。
// 期限を過ぎた発行は送信せず、再準備する。
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
  let issued = null; // { issuedAt, slots: [{ nonce, ctx }] }

  function clear() {
    issued = null;
  }

  return {
    // 6件分の nonce を発行し、スロットごとに ctx を保持する。
    // 返すのは nonce の配列だけである（ctx は返さない）。
    async issueNonces() {
      const slots = [];
      try {
        for (let i = 0; i < S5_SLOT_COUNT; i++) {
          const res = await fetchImpl(base + "/nonce", { method: "GET" });
          const data = await res.json().catch(() => null);
          const setCookies =
            typeof res.headers.getSetCookie === "function"
              ? res.headers.getSetCookie()
              : [];
          const ctx = extractNonceCtx(setCookies);
          if (!res.ok || !data || !data.nonce || !ctx) {
            throw new Error("nonce issuance failed");
          }
          slots.push({ nonce: data.nonce, ctx });
        }
      } catch {
        clear();
        fail("s5_nonce_issuance_failed", "6件分の nonce の発行に失敗しました");
      }
      issued = { issuedAt: now(), slots };
      return issued.slots.map((s) => s.nonce);
    },

    // 6件の要求を並行送信する。送信前の確認に失敗すれば1件も送らない。
    async send({ trialId, requests }) {
      if (!issued) {
        fail("s5_not_prepared", "nonce を発行していません");
      }
      if (now() - issued.issuedAt > SEND_WITHIN_MS) {
        clear();
        fail("s5_nonces_expired", "発行から4分を過ぎました。再準備してください");
      }
      if (!Array.isArray(requests) || requests.length !== S5_SLOT_COUNT) {
        fail("s5_bad_request_count", "要求が6件ではありません");
      }
      if (typeof trialId !== "string" || !trialId) {
        fail("bad_trial_input", "試験 ID がありません");
      }
      verifyS5RequestsEqual(requests);
      // 各スロットのトークンの nonce が、そのスロットに発行した
      // nonce と一致することを確認する（結び付けの取り違え防止）。
      for (let i = 0; i < S5_SLOT_COUNT; i++) {
        if (tokenNonce(requests[i].id_token) !== issued.slots[i].nonce) {
          fail("slot_nonce_mismatch", "スロットとトークンの nonce が一致しません");
        }
      }
      const slots = issued.slots;
      const settled = await Promise.allSettled(
        requests.map((request, i) =>
          fetchImpl(base + "/platform/apply", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Origin: EXPECTED_ORIGIN,
              Cookie: `${NONCE_CTX_COOKIE}=${slots[i].ctx}`,
            },
            body: JSON.stringify(request),
          }).then(async (res) => {
            const data = await res.json().catch(() => null);
            return {
              slot: i,
              status: res.status,
              error: data && data.error ? normalizeResponseError(data.error) : null,
            };
          })
        )
      );
      const results = settled.map((s, i) => {
        if (s.status === "fulfilled") return s.value;
        return { slot: i, status: null, error: S5_NO_RESPONSE };
      });
      // 送信の完了後、保持を破棄する（成功・失敗を問わず）。
      clear();
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
