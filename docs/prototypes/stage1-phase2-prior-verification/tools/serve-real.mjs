// 実ログイン画面（public/login-real.html）の提供サーバー（実試験用・PC 側）。
// フェーズ2先行検証ハーネス用。フェーズ1の tools/serve-real.mjs の型。
//
// !!! 実試験用 !!! 実試験の PC 側実行構成:
//   - 中継（フェーズ1の relay/worker.js の型）を wrangler dev で起動し、
//     検証用 Worker への remote service binding で要求を届ける
//     （RELAY_URL がその接続先）
//   - このサーバーが画面と API を同一生成元（http://localhost:8787）で
//     提供することで、ブラウザーから見た生成元が OAuth クライアントの
//     登録済み生成元と一致する
//
// 仕様:
// - 127.0.0.1 のみにバインドする（0.0.0.0 は使わない）
// - GET / → public/login-real.html を返す。その際、環境変数
//   GOOGLE_CLIENT_ID の値を HTML 内のプレースホルダ定数の位置に
//   メモリ上で差し込む（ファイル自体は書き換えない）。
//   GOOGLE_CLIENT_ID が未設定・空なら起動時にエラーで終了する
// - GET /subject-hash → public/subject-hash.html を返す（対象主体ハッシュ
//   の取得専用ページ。同じくクライアント ID をメモリ上で差し込む）。
//   このページは ID トークンをどこへも送らない。公開鍵の取得はブラウザー
//   が直接行い、このサーバーは中継しない。
// - GET /subject-hash-verify.mjs → tools/subject-hash-verify.mjs をその
//   まま返す（取得ページが import する検証モジュール）。
// - GET /trial-apply → public/trial-apply.html を返す（不一致試験専用
//   画面。同じくクライアント ID をメモリ上で差し込む）。このページは
//   送信に使う単一の要求を凍結し、送信直前に非秘密項目と一致／不一致
//   の事実だけを表示して、その同じ要求を送る。送信する JSON の全文
//   表示はしない。検証モジュール tools/trial-apply.mjs と
//   tools/subject-hash-verify.mjs を import する。
// - GET /trial-apply.mjs → tools/trial-apply.mjs をそのまま返す
//   （trial-apply 画面が import する純粋モジュール）。
// - GET /s5-apply → public/s5-apply.html を返す（S5 並行試験専用画面。
//   同じくクライアント ID をメモリ上で差し込む）。このページは6件の
//   実トークンを集めて凍結した要求を作り、送信直前に6件の条件が等しい
//   ことと nonce が異なることを表示して、その同じ6件の要求を送信指示
//   として送信器へ渡す。検証モジュール tools/s5-apply.mjs と
//   tools/trial-apply.mjs・tools/subject-hash-verify.mjs を import する。
// - GET /s5-apply.mjs → tools/s5-apply.mjs をそのまま返す
//   （s5-apply 画面が import する純粋モジュール）。
// - GET /s9-negative → public/s9-negative.html を返す（S9 負例試験専用
//   画面。同じくクライアント ID をメモリ上で差し込む）。このページは
//   トークンを捕捉モードで保持し、署名改変・Cookie なし・元のトークン
//   （対照）・再送の順で POST /admin/verify-only へ送る。検証モジュール
//   tools/s9-negative.mjs と tools/subject-hash-verify.mjs を import する。
// - GET /s9-negative.mjs → tools/s9-negative.mjs をそのまま返す
//   （s9-negative 画面が import する純粋モジュール）。
// - GET /s5/nonces → 送信器が中継先の /nonce を6回呼び、スロットごと
//   に nonce context Cookie を保持し、nonce の配列だけを返す（ctx は
//   返さない）。発行から4分以内に送信しなければ送信器が拒否する。
//   呼び出し元は、試験単位の不可推測セッション（起動時に発行し、
//   /s5-apply 画面へメモリ上で差し込む）と、発行に結び付ける試験 ID
//   を示す。別オリジン・別画面・別試行からの状態変更は拒否する。
// - POST /s5/send → 画面からの6件の要求を受け取り、送信器がスロット
//   ごとに Cookie jar を分けて6件を並行送信し、スロットごとの応答
//   （状態と理由コードだけ）を返す。ID トークン・一回値・Cookie・
//   nonce の値はログ・応答に出さない。送信器は送信の完了直後に保持
//   を破棄する。呼び出し元の境界は /s5/nonces と同じ（セッション・
//   Origin・Host・JSON content-type・本体サイズ上限）。
// - GET /admin-negative → public/admin-negative.html を返す（S9・項目8
//   の負例専用画面。クライアント ID と画面専用の試験単位セッションを
//   メモリ上で差し込む）。この画面は ID トークンをメモリー内の変数
//   だけに保持し、条件を1点ずつ変えた試行を試行 ID で結んで表示する。
//   検証モジュール tools/admin-negative.mjs を import する。
// - GET /admin-negative.mjs → tools/admin-negative.mjs をそのまま返す
//   （admin-negative 画面が import する純粋モジュール）。
// - POST /admin-negative/origin-probe → セットC（Origin）の固定プローブ。
//   生成元チェックはトークン検証より前に行われるため、秘密を使わず、
//   固定のダミートークンで2要求を中継へ送る（Origin が期待値と異なる
//   値 → bad_origin を期待／Origin が期待値どおり → ダミートークンの
//   tokeninfo_rejected を期待）。返すのは状態と理由コードだけである。
//   呼び出し元の境界は /s5/nonces と同じ型（セッション・Origin・
//   Host・JSON content-type・本体サイズ上限）。
// - /nonce・/platform/apply・/admin/*（verify-only・registry の
//   add/revoke/rotate）への要求は、環境変数 RELAY_URL（既定
//   http://127.0.0.1:8798）へ、メソッド・ヘッダー・ボディを変更せずに
//   転送する（Origin と Cookie を素通しする。中継と検証用 Worker の
//   側で照合・拒否が行われる前提で、このサーバー自身はアプリケー
//   ションレベルの拒否をしない）
// - RELAY_URL は起動時に検証し、許可条件を満たさなければ理由を表示
//   して終了する（ID トークン・一回値・Cookie を外部へ転送しない
//   ため）。許可条件: scheme は http のみ（同一マシン内のローカル
//   中継が前提。https はループバックでも TLS 終端先が不明なため
//   許可しない）、ホストは明示されたループバックアドレスのみ
//   （127.0.0.1 / ::1 / localhost）、ポート番号の明示必須、
//   ユーザー情報（user:pass@）なし、パスは空か "/" のみ、
//   クエリ・フラグメントなし。
// - 転送時はリダイレクトを追従しない（fetch の redirect: "manual"）。
//   中継が 3xx を返した場合は追従せず、クライアントへ 502 エラー
//   として返す（中継先の指示で別の宛先へ機密を送らないため）。
// - ログにはメソッド・パス・応答状態だけを出す（ヘッダー・ボディ・
//   クエリの値は出さない。秘密や ID トークンが残らないようにするため）
// - それ以外のパスは 404
//
// 使い方:
//   GOOGLE_CLIENT_ID=<検証用 OAuth クライアント ID> \
//   RELAY_URL=http://127.0.0.1:8798 \
//   node tools/serve-real.mjs          # http://127.0.0.1:8787/
//   （PORT 環境変数で待ち受けポートを変更できる。既定 8787）

import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createS5Sender } from "./s5-sender.mjs";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
if (!CLIENT_ID) {
  console.error(
    "error: 環境変数 GOOGLE_CLIENT_ID（検証用 OAuth クライアント ID）が未設定です。設定してから起動してください"
  );
  process.exit(1);
}
const PLACEHOLDER = "REPLACE_WITH_VERIFICATION_OAUTH_CLIENT_ID";
const PORT = Number(process.env.PORT || "8787");

// RELAY_URL の検証。不正なら理由（文字列）を返し、正しければ
// 転送に使う正規化済みの基底 URL（末尾スラッシュなし）を返す。
// 値自体は理由にもログにも含めない（ユーザー情報などの漏えい防止。
// 試験用のダミー値でも同じ扱いにする）。
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
function validateRelayUrl(raw) {
  if (typeof raw !== "string" || raw.trim() !== raw || /\s/.test(raw)) {
    return { error: "URL として解釈できないか、空白を含んでいます" };
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: "URL として解釈できません" };
  }
  // scheme は http のみ。https はループバック宛てでも TLS の終端先が
  // このサーバーからは確認できないため許可しない。
  if (u.protocol !== "http:") {
    return { error: `scheme は http のみ許可します（指定された scheme: ${u.protocol.replace(":", "")}）` };
  }
  if (u.username || u.password) {
    return { error: "ユーザー情報（user:pass@）を含む URL は許可しません" };
  }
  if (u.search || u.hash) {
    return { error: "クエリ・フラグメントを含む URL は許可しません" };
  }
  if (u.pathname !== "" && u.pathname !== "/") {
    return { error: "パスは空か \"/\" のみ許可します" };
  }
  // IPv6 リテラルでは u.hostname が "[::1]" の形になるため括弧を外して比べる。
  const hostOnly = u.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (!LOOPBACK_HOSTS.has(hostOnly)) {
    return {
      error:
        "ホストはループバックアドレス（127.0.0.1 / ::1 / localhost）のみ許可します",
    };
  }
  // ポート番号の明示必須。URL パーサーは既定ポート（http の 80）を
  // u.port から落としてしまうため、生の authority 部分で明示を確かめる。
  const authority = raw.slice(raw.indexOf("://") + 3).split(/[/?#]/)[0];
  const portMatch = authority.startsWith("[")
    ? authority.match(/^\[[^\]]+\]:(\d+)$/)
    : authority.match(/^[^:@]+:(\d+)$/);
  if (!portMatch) {
    return { error: "ポート番号の明示が必要です" };
  }
  const portNum = Number(portMatch[1]);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return { error: "ポート番号が範囲外です（1〜65535）" };
  }
  return { relay: `http://${authority}` };
}

const relayValidation = validateRelayUrl(
  process.env.RELAY_URL || "http://127.0.0.1:8798"
);
if (relayValidation.error) {
  console.error(
    `error: RELAY_URL が許可条件を満たしません: ${relayValidation.error}。` +
      "RELAY_URL は同一マシン内のローカル中継だけを指定してください" +
      "（例: http://127.0.0.1:8798）。値は表示していません"
  );
  process.exit(1);
}
const RELAY = relayValidation.relay;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// S5 並行試験の送信器（1プロセスに1つ）。nonce・ctx・要求の保持は
// メモリー内だけであり、送信の完了直後に破棄する。
const s5Sender = createS5Sender({ relayUrl: RELAY });

// S5 入口の試験単位セッション。起動ごとに不可推測の値を新規発行し、
// /s5-apply 画面へメモリ上で差し込む（ファイルは書き換えない）。画面
// は /s5/nonces・/s5/send の呼び出し時にこの値をヘッダーで示す。
// 別オリジンのページは配信された画面を読めない（CORS なし）ため値を
// 知ることはできず、セッションなし・不一致の呼び出しは状態を変更
// しない。同一 PC の別プロセス（ブラウザー外）は 127.0.0.1 へ直接
// 要求できるため、この仕組みはその範囲を防御しない（脅威範囲は
// DESIGN.md に明記する）。
const S5_SESSION = randomUUID();
const S5_SESSION_PLACEHOLDER = "REPLACE_WITH_S5_SESSION";

// admin-negative 画面（S9 負例）専用の試験単位セッション。S5 と同じ型
// で、起動ごとに不可推測の値を新規発行し、画面へメモリ上で差し込む。
// /admin-negative/origin-probe の呼び出し元境界に使う。
const AN_SESSION = randomUUID();
const AN_SESSION_PLACEHOLDER = "REPLACE_WITH_AN_SESSION";
// /admin-negative/origin-probe の本体サイズ上限。本体は試行 ID だけ
// であり、16 KiB で十分に足りる。超過は 413 で拒否する。
const AN_MAX_BODY_BYTES = 16 * 1024;
// セットCのプローブで使う固定のダミートークン。秘密ではなく、生成元
// チェックがトークン検証より前に行われることの判別だけに使う（正しい
// Origin の対照では、この値が tokeninfo_rejected になることが前提）。
const ORIGIN_PROBE_DUMMY_TOKEN = "origin-probe-dummy-token";
const ORIGIN_PROBE_ORIGINS = {
  mismatch: "http://localhost:9999",
  expected: "http://localhost:8787",
};
// /s5/send の本体サイズ上限。6件の要求（ID トークン各1件を含む）は
// 10 KiB 程度であり、64 KiB で十分に足りる。超過は 413 で拒否する。
const S5_MAX_BODY_BYTES = 64 * 1024;

// S5 入口（/s5/nonces・/s5/send）の呼び出し元境界。次をすべて満たさ
// なければ、状態を変更せず理由コードだけを返す。失敗時は { ok, error }
// を返し、ok が偽なら呼び出し側は状態に応じた HTTP 状態で拒否する。
// - Host がこのサーバーのループバック宛て（127.0.0.1 / localhost /
//   ::1 にこのサーバーのポート）であること。DNS rebinding で別名から
//   届いた要求は Host が異なるため拒否する。
// - Origin があれば、このサーバーの同一生成元（http://127.0.0.1:PORT
//   または http://localhost:PORT）であること。同一生成元の GET には
//   Origin が付かないため、Origin なしは Host・セッションで判断する。
// - 試験単位のセッション（x-s5-session ヘッダー）が起動時に発行した
//   値と一致すること。別オリジンのページ・別画面からの呼び出しは
//   値を知らないため拒否する。
function checkS5Entry(req) {
  const host = (req.headers.host || "").toLowerCase();
  const allowedHosts = new Set([
    `127.0.0.1:${PORT}`,
    `localhost:${PORT}`,
    `[::1]:${PORT}`,
  ]);
  if (!allowedHosts.has(host)) {
    return { ok: false, status: 403, error: "s5_bad_origin" };
  }
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    const allowedOrigins = new Set([
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${PORT}`,
    ]);
    if (!allowedOrigins.has(origin)) {
      return { ok: false, status: 403, error: "s5_bad_origin" };
    }
  }
  if (req.headers["x-s5-session"] !== S5_SESSION) {
    return { ok: false, status: 403, error: "s5_bad_session" };
  }
  return { ok: true };
}

// /s5/send の本体をサイズ上限付きで読む。上限を超えれば
// { tooLarge: true } を返す。呼び出し側は 413 で拒否し、応答の送信
// 後にソケットを破棄する（応答より先に破棄すると、クライアントに
// 413 が届かない）。
async function readS5SendBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > S5_MAX_BODY_BYTES) {
      return { tooLarge: true };
    }
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks) };
}

// admin-negative 入口（/admin-negative/origin-probe）の呼び出し元境界。
// checkS5Entry と同じ型で、セッションヘッダーだけが異なる
// （x-an-session）。満たさなければ状態を変更せず理由コードだけを返す。
function checkAnEntry(req) {
  const host = (req.headers.host || "").toLowerCase();
  const allowedHosts = new Set([
    `127.0.0.1:${PORT}`,
    `localhost:${PORT}`,
    `[::1]:${PORT}`,
  ]);
  if (!allowedHosts.has(host)) {
    return { ok: false, status: 403, error: "an_bad_origin" };
  }
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    const allowedOrigins = new Set([
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${PORT}`,
    ]);
    if (!allowedOrigins.has(origin)) {
      return { ok: false, status: 403, error: "an_bad_origin" };
    }
  }
  if (req.headers["x-an-session"] !== AN_SESSION) {
    return { ok: false, status: 403, error: "an_bad_session" };
  }
  return { ok: true };
}

// /admin-negative/origin-probe の本体をサイズ上限付きで読む。
async function readAnBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > AN_MAX_BODY_BYTES) {
      return { tooLarge: true };
    }
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks) };
}

// セットCのプローブ送信。指定した Origin ヘッダーで、固定のダミー
// トークンを /admin/verify-only へ中継経由で送り、状態と理由コード
// だけを返す。node:http を使うのは、Origin ヘッダーを正確に固定する
// ためである（fetch 実装の自動付与・除去に依存しない）。宛先は検証
// 済みの RELAY 固定であり、リダイレクトは追従しない（3xx はそのまま
// 状態として返す。画面側の期待評価で期待と異なる扱いになる）。
function probeVerifyOnlyOrigin(origin) {
  return new Promise((resolve) => {
    const base = new URL(RELAY);
    const body = JSON.stringify({ id_token: ORIGIN_PROBE_DUMMY_TOKEN });
    const req = http.request(
      {
        method: "POST",
        hostname: base.hostname,
        port: base.port,
        path: "/admin/verify-only",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          origin,
        },
        timeout: 10000,
      },
      (up) => {
        const chunks = [];
        up.on("data", (c) => chunks.push(c));
        up.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            parsed = null;
          }
          resolve({
            status: up.statusCode || 0,
            ok: !!(parsed && parsed.ok === true),
            error:
              parsed && typeof parsed.error === "string" ? parsed.error : null,
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, ok: false, error: "probe_timeout" });
    });
    req.on("error", () => {
      resolve({ status: 0, ok: false, error: "probe_failed" });
    });
    req.end(body);
  });
}

const rawHtml = await readFile(path.join(root, "public", "login-real.html"), "utf8");
if (!rawHtml.includes(PLACEHOLDER)) {
  console.error("error: login-real.html にクライアント ID のプレースホルダが見つかりません");
  process.exit(1);
}
// クライアント ID の差し込みはメモリ上だけで行う（ファイルは書き換えない）。
const loginHtml = rawHtml.split(PLACEHOLDER).join(CLIENT_ID);

// 対象主体ハッシュの取得ページも同じく、起動時に読み込み、クライアント ID
// をメモリ上で差し込む（ファイルは書き換えない）。検証モジュールはそのまま返す。
const rawSubjectHashHtml = await readFile(path.join(root, "public", "subject-hash.html"), "utf8");
if (!rawSubjectHashHtml.includes(PLACEHOLDER)) {
  console.error("error: subject-hash.html にクライアント ID のプレースホルダが見つかりません");
  process.exit(1);
}
const subjectHashHtml = rawSubjectHashHtml.split(PLACEHOLDER).join(CLIENT_ID);
const subjectHashVerifyJs = await readFile(path.join(root, "tools", "subject-hash-verify.mjs"), "utf8");

// 不一致試験専用画面も同じく、起動時に読み込み、クライアント ID を
// メモリ上で差し込む（ファイルは書き換えない）。検証モジュールは
// そのまま返す。trial-apply 画面は subject-hash の検証モジュールも
// import する。
const rawTrialApplyHtml = await readFile(path.join(root, "public", "trial-apply.html"), "utf8");
if (!rawTrialApplyHtml.includes(PLACEHOLDER)) {
  console.error("error: trial-apply.html にクライアント ID のプレースホルダが見つかりません");
  process.exit(1);
}
const trialApplyHtml = rawTrialApplyHtml.split(PLACEHOLDER).join(CLIENT_ID);
const trialApplyJs = await readFile(path.join(root, "tools", "trial-apply.mjs"), "utf8");

// S5 並行試験専用画面も同じく、起動時に読み込み、クライアント ID を
// メモリ上で差し込む（ファイルは書き換えない）。検証モジュールはそのまま返す。
const rawS5ApplyHtml = await readFile(path.join(root, "public", "s5-apply.html"), "utf8");
if (!rawS5ApplyHtml.includes(PLACEHOLDER)) {
  console.error("error: s5-apply.html にクライアント ID のプレースホルダが見つかりません");
  process.exit(1);
}
if (!rawS5ApplyHtml.includes(S5_SESSION_PLACEHOLDER)) {
  console.error("error: s5-apply.html に S5 セッションのプレースホルダが見つかりません");
  process.exit(1);
}
// クライアント ID と S5 セッションはメモリ上で差し込む（ファイルは書き換えない）。
const s5ApplyHtml = rawS5ApplyHtml
  .split(PLACEHOLDER).join(CLIENT_ID)
  .split(S5_SESSION_PLACEHOLDER).join(S5_SESSION);
const s5ApplyJs = await readFile(path.join(root, "tools", "s5-apply.mjs"), "utf8");

// S9 負例試験専用画面も同じく、起動時に読み込み、クライアント ID を
// メモリ上で差し込む（ファイルは書き換えない）。検証モジュールはそのまま返す。
const rawS9NegativeHtml = await readFile(path.join(root, "public", "s9-negative.html"), "utf8");
if (!rawS9NegativeHtml.includes(PLACEHOLDER)) {
  console.error("error: s9-negative.html にクライアント ID のプレースホルダが見つかりません");
  process.exit(1);
}
const s9NegativeHtml = rawS9NegativeHtml.split(PLACEHOLDER).join(CLIENT_ID);
const s9NegativeJs = await readFile(path.join(root, "tools", "s9-negative.mjs"), "utf8");

// S9 負例専用画面も同じく、起動時に読み込み、クライアント ID と画面
// 専用セッションをメモリ上で差し込む（ファイルは書き換えない）。
// 検証モジュールはそのまま返す。
const rawAdminNegativeHtml = await readFile(path.join(root, "public", "admin-negative.html"), "utf8");
if (!rawAdminNegativeHtml.includes(PLACEHOLDER)) {
  console.error("error: admin-negative.html にクライアント ID のプレースホルダが見つかりません");
  process.exit(1);
}
if (!rawAdminNegativeHtml.includes(AN_SESSION_PLACEHOLDER)) {
  console.error("error: admin-negative.html に AN セッションのプレースホルダが見つかりません");
  process.exit(1);
}
const adminNegativeHtml = rawAdminNegativeHtml
  .split(PLACEHOLDER).join(CLIENT_ID)
  .split(AN_SESSION_PLACEHOLDER).join(AN_SESSION);
const adminNegativeJs = await readFile(path.join(root, "tools", "admin-negative.mjs"), "utf8");

const FORWARD_PATHS = new Set([
  "/nonce",
  "/platform/apply",
  "/admin/verify-only",
  "/admin/registry/add",
  "/admin/registry/revoke",
  "/admin/registry/rotate",
]);

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  try {
    if (req.method === "GET" && pathname === "/") {
      console.log(`GET / -> 200`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(loginHtml);
      return;
    }
    if (req.method === "GET" && pathname === "/subject-hash") {
      console.log(`GET /subject-hash -> 200`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(subjectHashHtml);
      return;
    }
    if (req.method === "GET" && pathname === "/subject-hash-verify.mjs") {
      console.log(`GET /subject-hash-verify.mjs -> 200`);
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(subjectHashVerifyJs);
      return;
    }
    if (req.method === "GET" && pathname === "/trial-apply") {
      console.log(`GET /trial-apply -> 200`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(trialApplyHtml);
      return;
    }
    if (req.method === "GET" && pathname === "/trial-apply.mjs") {
      console.log(`GET /trial-apply.mjs -> 200`);
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(trialApplyJs);
      return;
    }
    if (req.method === "GET" && pathname === "/s5-apply") {
      console.log(`GET /s5-apply -> 200`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(s5ApplyHtml);
      return;
    }
    if (req.method === "GET" && pathname === "/s5-apply.mjs") {
      console.log(`GET /s5-apply.mjs -> 200`);
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(s5ApplyJs);
      return;
    }
    if (req.method === "GET" && pathname === "/s9-negative") {
      console.log(`GET /s9-negative -> 200`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(s9NegativeHtml);
      return;
    }
    if (req.method === "GET" && pathname === "/s9-negative.mjs") {
      console.log(`GET /s9-negative.mjs -> 200`);
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(s9NegativeJs);
      return;
    }
    // S5 並行試験の送信器への入口。ループバック限定の提供サーバー上での
    // み動く。要求・応答の本体、トークン・一回値・Cookie・nonce の値は
    // ログに出さない。送信器の局所エラーは理由コードだけを返す。
    // 呼び出し元の境界（Host・Origin・試験単位セッション）を先に確認し、
    // 通らなければ状態を変更しない。
    if (req.method === "GET" && pathname === "/s5/nonces") {
      const entry = checkS5Entry(req);
      if (!entry.ok) {
        console.log(`GET /s5/nonces -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const trialId = new URL(req.url, "http://127.0.0.1").searchParams.get("trial_id");
      if (!trialId) {
        console.log(`GET /s5/nonces -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        const nonces = await s5Sender.issueNonces({ trialId });
        console.log(`GET /s5/nonces -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ nonces }));
      } catch (e) {
        console.log(`GET /s5/nonces -> 502`);
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s5_nonce_issuance_failed" }));
      }
      return;
    }
    if (req.method === "POST" && pathname === "/s5/send") {
      const entry = checkS5Entry(req);
      if (!entry.ok) {
        console.log(`POST /s5/send -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const contentType = req.headers["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        console.log(`POST /s5/send -> 415`);
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_content_type" }));
        return;
      }
      const read = await readS5SendBody(req);
      if (read.tooLarge) {
        console.log(`POST /s5/send -> 413`);
        res.writeHead(413, { "content-type": "application/json", Connection: "close" });
        res.end(JSON.stringify({ error: "body_too_large" }));
        // 読み残した本体がソケットに残るため、応答の送信後に破棄する。
        res.on("finish", () => {
          try {
            req.socket.destroy();
          } catch { /* 破棄の失敗は無視する */ }
        });
        return;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(read.body.toString("utf8"));
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== "object") {
        console.log(`POST /s5/send -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        const out = await s5Sender.send({
          trialId: parsed.trial_id,
          requests: parsed.requests,
        });
        console.log(`POST /s5/send -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) {
        // 送信前の確認に失敗した場合は1件も送っていない。理由コード
        // だけを返し、値は返さない。期限切れは 410、その他は 409 とする。
        const status = e.code === "s5_nonces_expired" ? 410 : 409;
        console.log(`POST /s5/send -> ${status}`);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s5_send_failed" }));
      }
      return;
    }
    if (req.method === "GET" && pathname === "/admin-negative") {
      console.log(`GET /admin-negative -> 200`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(adminNegativeHtml);
      return;
    }
    if (req.method === "GET" && pathname === "/admin-negative.mjs") {
      console.log(`GET /admin-negative.mjs -> 200`);
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(adminNegativeJs);
      return;
    }
    // セットC（Origin）の固定プローブへの入口。秘密は使わない。返す
    // のは2要求それぞれの状態と理由コードだけであり、要求・応答の
    // 本体やダミートークンの値はログ・応答に出さない（ダミートークン
    // は固定の非秘密値だが、扱いは同じにする）。
    if (req.method === "POST" && pathname === "/admin-negative/origin-probe") {
      const entry = checkAnEntry(req);
      if (!entry.ok) {
        console.log(`POST /admin-negative/origin-probe -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const contentType = req.headers["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        console.log(`POST /admin-negative/origin-probe -> 415`);
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_content_type" }));
        return;
      }
      const read = await readAnBody(req);
      if (read.tooLarge) {
        console.log(`POST /admin-negative/origin-probe -> 413`);
        res.writeHead(413, { "content-type": "application/json", Connection: "close" });
        res.end(JSON.stringify({ error: "body_too_large" }));
        res.on("finish", () => {
          try {
            req.socket.destroy();
          } catch { /* 破棄の失敗は無視する */ }
        });
        return;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(read.body.toString("utf8"));
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== "object" || typeof parsed.trial_id !== "string" || parsed.trial_id.length === 0) {
        console.log(`POST /admin-negative/origin-probe -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      const mismatch = await probeVerifyOnlyOrigin(ORIGIN_PROBE_ORIGINS.mismatch);
      const expected = await probeVerifyOnlyOrigin(ORIGIN_PROBE_ORIGINS.expected);
      console.log(
        `POST /admin-negative/origin-probe -> 200 (C1 ${mismatch.status}, C2 ${expected.status})`
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          trial_id: parsed.trial_id,
          results: [
            { status: mismatch.status, ok: mismatch.ok, error: mismatch.error },
            { status: expected.status, ok: expected.ok, error: expected.error },
          ],
        })
      );
      return;
    }
    if (FORWARD_PATHS.has(pathname)) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const headers = { ...req.headers };
      delete headers.host;
      const up = await fetch(RELAY + req.url, {
        method: req.method,
        headers,
        // リダイレクトは追従しない。中継の 3xx で外部へ誘導され、
        // ID トークン・一回値・Cookie が別宛先へ送られるのを防ぐ。
        redirect: "manual",
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });
      if (up.status >= 300 && up.status < 400) {
        // 3xx は追従せず、エラー（502）としてクライアントへ返す。
        // 3xx 自体をそのまま返すとブラウザーが Location へ進み得るため、
        // 状態はログにだけ残し、応答は 502 に変換する。
        console.log(`${req.method} ${pathname} -> 502 (relay redirect ${up.status} not followed)`);
        try {
          if (up.body) await up.body.cancel();
        } catch { /* 本文破棄の失敗は無視する */ }
        res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end("relay redirect not followed");
        return;
      }
      const outHeaders = {};
      up.headers.forEach((v, k) => {
        // fetch が復号済みの本文を返すため、符号化・長さのヘッダーは引き継がない。
        if (k !== "set-cookie" && k !== "content-encoding" && k !== "content-length" && k !== "transfer-encoding") {
          outHeaders[k] = v;
        }
      });
      const setCookies =
        typeof up.headers.getSetCookie === "function" ? up.headers.getSetCookie() : [];
      if (setCookies.length) outHeaders["set-cookie"] = setCookies;
      const buf = Buffer.from(await up.arrayBuffer());
      console.log(`${req.method} ${pathname} -> ${up.status}`);
      res.writeHead(up.status, outHeaders);
      res.end(buf);
      return;
    }
    console.log(`${req.method} ${pathname} -> 404`);
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (e) {
    console.log(`${req.method} ${pathname} -> 502`);
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("proxy error");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`real login page: http://127.0.0.1:${PORT}/  (relay: ${RELAY})`);
});
