// 実ログイン画面（public/login-real.html）の提供サーバー（実試験用・PC 側）。
//
// !!! 実試験用 !!! 模擬専用の tools/serve-login.mjs とは別物です。
// 実試験の PC 側実行構成:
//   - 中継（relay/worker.js）を wrangler dev で起動し、検証用 Worker への
//     remote service binding で要求を届ける（RELAY_URL がその接続先）
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
// - /nonce・/register・/login・/recover・/operate への要求は、
//   環境変数 RELAY_URL（既定 http://127.0.0.1:8798）へ、メソッド・
//   ヘッダー・ボディを変更せずに転送する（Origin と Cookie を素通し
//   する。中継と検証用 Worker の側で照合・拒否が行われる前提で、
//   このサーバー自身はアプリケーションレベルの拒否をしない）
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
const RELAY = (process.env.RELAY_URL || "http://127.0.0.1:8798").replace(/\/+$/, "");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const rawHtml = await readFile(path.join(root, "public", "login-real.html"), "utf8");
if (!rawHtml.includes(PLACEHOLDER)) {
  console.error("error: login-real.html にクライアント ID のプレースホルダが見つかりません");
  process.exit(1);
}
// クライアント ID の差し込みはメモリ上だけで行う（ファイルは書き換えない）。
const loginHtml = rawHtml.split(PLACEHOLDER).join(CLIENT_ID);

const FORWARD_PATHS = new Set(["/nonce", "/register", "/login", "/recover", "/operate"]);

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  try {
    if (req.method === "GET" && pathname === "/") {
      console.log(`GET / -> 200`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(loginHtml);
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
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });
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
