// ログイン画面を http://localhost:8787 で配信する小さなサーバー（ローカル模擬用）。
//
// !!! 模擬専用 !!! 実試験には使いません。実試験では PC 側の静的配信で
// public/login-real.html を配信します。このサーバーが配信するのは
// 模擬専用の public/login-mock.html です。
//
// - GET / → public/login-mock.html を返す
// - それ以外 → ハーネス（HARNESS_URL、既定 http://127.0.0.1:8799）へ素通し中継する
//   （Origin・Cookie を含むヘッダーを変更しない。変形Bの中継と同じ前提）
//
// 使い方:
//   node tools/serve-login.mjs            # ポート 8787
//   HARNESS_URL=http://127.0.0.1:8799 PORT=8787 node tools/serve-login.mjs
//
// ハーネス側は別途 Miniflare で起動しておく（例: 試験ランナーとは別に
// miniflare CLI や小さな起動スクリプトで src/worker.js を載せる）。

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || "8787");
const HARNESS = (process.env.HARNESS_URL || "http://127.0.0.1:8799").replace(/\/+$/, "");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const loginHtml = await readFile(path.join(root, "public", "login-mock.html"));

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/login-mock.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(loginHtml);
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers };
    delete headers.host;
    const up = await fetch(HARNESS + req.url, {
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
    res.writeHead(up.status, outHeaders);
    res.end(Buffer.from(await up.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("proxy error: " + String(e && e.message));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`login page: http://localhost:${PORT}/  (harness: ${HARNESS})`);
});
