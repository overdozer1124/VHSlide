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
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
