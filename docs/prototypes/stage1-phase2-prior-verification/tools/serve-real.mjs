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
// - GET /s10-add-operator → public/s10-add-operator.html を返す（S10
//   運営者追加専用画面。同じくクライアント ID をメモリ上で差し込む）。
//   このページは B の主体取得 → A の認可 → 凍結要求の表示・確認 →
//   送信の順で POST /admin/registry/add へ送る。検証モジュール
//   tools/s10-add.mjs と tools/subject-hash-verify.mjs を import する。
// - GET /s10-add.mjs → tools/s10-add.mjs をそのまま返す
//   （s10-add-operator 画面が import する純粋モジュール）。
// - GET /s11-parallel → public/s11-parallel.html を返す（S11 並行送信
//   専用画面。同じくクライアント ID をメモリ上で差し込む）。この
//   ページは C の主体ハッシュと A の実トークンを集めて凍結した要求を
//   作り、送信直前に表示して、その送信指示を送信器へ渡す。送信は
//   ブラウザーから直接行わない（Cookie 文脈の分離のため）。検証
//   モジュール tools/s11-parallel.mjs と tools/subject-hash-verify.mjs
//   を import する。
// - GET /s11-parallel.mjs → tools/s11-parallel.mjs をそのまま返す
//   （s11-parallel 画面が import する純粋モジュール）。
// - GET /s11/nonces → 送信器が中継先の /nonce を手順に応じた件数
//   （stale は1回、concurrent は2回）呼び、スロットごとに nonce
//   context Cookie を保持し、nonce の配列だけを返す（ctx は返さ
//   ない）。発行から4分以内に送信しなければ送信器が拒否する。
//   呼び出し元の境界は S5 と同じ型（試験単位セッション・Host・
//   Origin）であり、発行は試験 ID と手順に結び付ける。
// - POST /s11/send-stale → 画面からの手順3の要求を受け取り、送信器
//   がそのスロットの Cookie で1件を送信し、応答（状態と理由コード・
//   返された世代だけ）を返す。
// - POST /s11/send-concurrent → 画面からの手順4の要求2件を受け取り、
//   送信器がスロットごとに Cookie jar を分けて2件を並行送信し、
//   スロットごとの応答と集計を返す。ID トークン・Cookie・nonce の
//   値はログ・応答に出さない。送信器は送信の完了直後に保持を破棄する。
// - GET /s12-revoke → public/s12-revoke.html を返す（S12 失効専用
//   画面。同じくクライアント ID をメモリ上で差し込む）。このページは
//   B のトークンを未使用のまま保持し、A の認可で B の失効を送り、
//   新しい B と保持した失効前トークンの提示拒否（not_operator）と
//   C の提示成功を確認する。送信はブラウザーから直接行わない
//   （Cookie 文脈の分離と保持のため）。検証モジュール
//   tools/s12-revoke.mjs と tools/subject-hash-verify.mjs を
//   import する。
// - GET /s12-revoke.mjs → tools/s12-revoke.mjs をそのまま返す
//   （s12-revoke 画面が import する純粋モジュール）。
// - GET /s12/nonces → 送信器が中継先の /nonce をスロット
//   （heldB / revokeA / freshB / checkC）ごとに1回呼び、その
//   スロットの nonce context Cookie を保持し、nonce だけを返す
//   （ctx は返さない）。スロットごとに発行から4分以内に送信
//   しなければ送信器が拒否する。呼び出し元の境界は S11 と同じ型
//   （試験単位セッション・Host・Origin）であり、発行は試験 ID と
//   スロットに結び付ける。
// - POST /s12/freeze-revoke → 画面が失効要求を凍結した時点で、
//   凍結済み要求の対象（手順1で保持した B の主体ハッシュ）を
//   送信器に固定する。送信器は以後の失効送信で、送信されてきた
//   要求の対象をこの固定値と照合し、異なれば1件も送らない
//   （送信器の境界での対象の結び付け）。応答は固定できたか
//   （ok）または理由コードだけを返し、固定値は返さない。
// - POST /s12/send-revoke → 画面からの失効要求を受け取り、送信器
//   が revokeA スロットの Cookie で1件を送信し、応答（状態と理由
//   コード・返された世代だけ）を返す。送信前に送信器が保持
//   トークン（heldB）の鮮度も確認し、古ければ1件も送らない。
// - POST /s12/send-verify-only → 画面からの提示要求とスロット名
//   を受け取り、送信器がそのスロットの Cookie で1件を送信し、
//   応答を返す。ID トークン・Cookie・nonce の値はログ・応答に
//   出さない。
// - GET /s13-revoke → public/s13-revoke.html を返す（S13 失効専用
//   画面。同じくクライアント ID をメモリ上で差し込む）。このページは
//   対象 C の主体ハッシュを取得し、A の認可で C の失効を送り
//   （generation 5→6）、A 自身の失効試行が 409 last_operator で
//   拒否されること（この拒否が合格）と A の提示成功を確認する。
//   送信はブラウザーから直接行わない（Cookie 文脈の分離のため）。
//   検証モジュール tools/s13-revoke.mjs と
//   tools/subject-hash-verify.mjs を import する。
// - GET /s13-revoke.mjs → tools/s13-revoke.mjs をそのまま返す
//   （s13-revoke 画面が import する純粋モジュール）。
// - GET /s13/nonces → 送信器が中継先の /nonce をスロット
//   （revokeC / revokeA / checkA）ごとに1回呼び、そのスロットの
//   nonce context Cookie を保持し、nonce だけを返す（ctx は
//   返さない）。対象取得（targetC）の nonce は画面が /nonce から
//   直接取得するため、ここには含まれない。スロットごとに発行
//   から4分以内に送信しなければ送信器が拒否する。呼び出し元の
//   境界は S12 と同じ型（試験単位セッション・Host・Origin）で
//   あり、発行は試験 ID とスロットに結び付ける。
// - POST /s13/freeze-revoke → 画面が各失効要求を凍結した時点で、
//   凍結済み要求の対象（手順1は C、手順2は A 自身の主体ハッシュ）
//   をスロット名とともに送信器に固定する。送信器は以後の失効
//   送信で、送信されてきた要求の対象をそのスロットの固定値と
//   照合し、異なれば1件も送らない（送信器の境界での対象の
//   結び付け）。応答は固定できたか（ok）または理由コードだけを
//   返し、固定値は返さない。
// - POST /s13/send-revoke → 画面からの失効要求とスロット名を
//   受け取り、送信器がそのスロットの Cookie で1件を送信し、
//   応答（状態と理由コード・返された世代だけ）を返す。期待世代
//   はスロットごとに固定であり（revokeC = 5、revokeA = 6）、
//   送信器が照合する。
// - POST /s13/send-verify-only → 画面からの提示要求とスロット名
//   （checkA）を受け取り、送信器がそのスロットの Cookie で1件
//   を送信し、応答を返す。ID トークン・Cookie・nonce の値は
//   ログ・応答に出さない。
// - GET /s14-rotate → public/s14-rotate.html を返す（S14 ローテー
//   ション専用画面。同じくクライアント ID をメモリ上で差し込む）。
//   このページは A・B の主体ハッシュを取得し、A の認可で
//   ローテーション（generation 6→7、登録簿 {A}→{B}）を送り、
//   A の次回操作が 403 not_operator で拒否されること（この拒否
//   が合格）と B の提示成功を確認する。送信はブラウザーから直接
//   行わない（Cookie 文脈の分離のため）。検証モジュール
//   tools/s14-rotate.mjs と tools/subject-hash-verify.mjs を
//   import する。
// - GET /s14-rotate.mjs → tools/s14-rotate.mjs をそのまま返す
//   （s14-rotate 画面が import する純粋モジュール）。
// - GET /s14/nonces → 送信器が中継先の /nonce をスロット
//   （rotateAB / checkA / checkB）ごとに1回呼び、そのスロットの
//   nonce context Cookie を保持し、nonce だけを返す（ctx は
//   返さない）。対象取得（targetA / targetB）の nonce は画面が
//   /nonce から直接取得するため、ここには含まれない。スロット
//   ごとに発行から4分以内に送信しなければ送信器が拒否する。
//   呼び出し元の境界は S13 と同じ型（試験単位セッション・Host・
//   Origin）であり、発行は試験 ID とスロットに結び付ける。
// - POST /s14/freeze-rotate → 画面がローテーション要求を凍結した
//   時点で、凍結済み要求の対象の組（旧主体 A・新主体 B の主体
//   ハッシュ）を送信器に固定する。送信器は以後のローテーション
//   送信で、送信されてきた要求の対象の組を固定値と照合し、
//   異なれば1件も送らない（送信器の境界での対象の結び付け）。
//   応答は固定できたか（ok）または理由コードだけを返し、固定値
//   は返さない。
// - POST /s14/send-rotate → 画面からのローテーション要求と
//   スロット名（rotateAB）を受け取り、送信器がそのスロットの
//   Cookie で1件を送信し、応答（状態と理由コード・返された世代
//   だけ）を返す。期待世代は固定であり（rotateAB = 6）、送信器
//   が照合する。
// - POST /s14/send-verify-only → 画面からの提示要求とスロット名
//   （checkA / checkB）を受け取り、送信器がそのスロットの
//   Cookie で1件を送信し、応答を返す。ID トークン・Cookie・
//   nonce の値はログ・応答に出さない。
// - GET /s15-apply.mjs → tools/s15-apply.mjs をそのまま返す
//   （S15 の状態機械の純粋モジュール。S15 専用画面は設けず、
//   準備は既存の trial-apply 画面の全面復旧の完全一致の流れが
//   担い、破棄送信は送信器／提供層で扱う。DESIGN.md の S15
//   付録を参照）。
// - GET /s15/nonces → 送信器が中継先の /nonce を試行枠
//   （attempt 1〜3）ごとに1回呼び、その試行枠の nonce context
//   Cookie を保持し、nonce だけを返す（ctx は返さない）。次の
//   試行枠は、先行試行の未成立の判定が /s15/record-judgment で
//   記録されるまで開かない。呼び出し元の境界は S14 と同じ型
//   （試験単位セッション・Host・Origin）であり、発行は試験 ID
//   と試行番号に結び付ける。
// - POST /s15/freeze-approval → 承認内容の凍結の時点で、凍結
//   済みの承認内容（操作ID・用途・対象主体ハッシュ・環境ID・
//   一回値）を送信器に固定する。送信器は以後の破棄送信で、
//   送信されてきた要求を固定値と照合し、異なれば1件も送ら
//   ない。応答は固定できたか（ok）または理由コードだけを
//   返し、固定値は返さない。
// - POST /s15/send-discard → 画面からの全面復旧の要求と試行
//   番号を受け取り、送信器がその試行枠の Cookie で1件を送信
//   し、応答は読み取らずに破棄する。応答として返すのは破棄
//   記録（sent と outcome: "discarded"）だけであり、実応答の
//   状態・本文・理由コード・世代は構造上ここに存在しない。
//   送信前の確認に失敗した場合は1件も送っておらず、理由
//   コードだけを返す。ID トークン・一回値・Cookie・nonce の
//   値はログ・応答に出さない。
// - POST /s15/record-judgment → 独立した読み戻しによる判定
//   （committed / uncommitted / discrepancy）を送信器へ記録
//   する。未成立の判定の記録だけが次の試行枠を開く。
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
import { createS11Sender } from "./s11-sender.mjs";
import { createS12Sender } from "./s12-sender.mjs";
import { createS13Sender } from "./s13-sender.mjs";
import { createS14Sender } from "./s14-sender.mjs";
import { createS15Sender } from "./s15-sender.mjs";

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

// S11 並行送信の送信器（1プロセスに1つ）。nonce・ctx・要求の保持は
// メモリー内だけであり、送信の完了直後に破棄する。
const s11Sender = createS11Sender({ relayUrl: RELAY });

// S11 入口の試験単位セッション。S5 と同じ型であり、起動ごとに不可
// 推測の値を新規発行し、/s11-parallel 画面へメモリ上で差し込む
// （ファイルは書き換えない）。画面は /s11/nonces・/s11/send-* の
// 呼び出し時にこの値をヘッダーで示す。脅威範囲は S5 と同じである
// （DESIGN.md の S5 付録の脅威範囲を参照）。
const S11_SESSION = randomUUID();
const S11_SESSION_PLACEHOLDER = "REPLACE_WITH_S11_SESSION";
// /s11/send-* の本体サイズ上限。2件の要求（ID トークン各1件を含む）
// は 10 KiB 程度であり、64 KiB で十分に足りる。超過は 413 で拒否する。
const S11_MAX_BODY_BYTES = 64 * 1024;

// S11 入口（/s11/nonces・/s11/send-*）の呼び出し元境界。S5 入口と
// 同じ型であり、次をすべて満たさなければ、状態を変更せず理由コード
// だけを返す。
function checkS11Entry(req) {
  const host = (req.headers.host || "").toLowerCase();
  const allowedHosts = new Set([
    `127.0.0.1:${PORT}`,
    `localhost:${PORT}`,
    `[::1]:${PORT}`,
  ]);
  if (!allowedHosts.has(host)) {
    return { ok: false, status: 403, error: "s11_bad_origin" };
  }
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    const allowedOrigins = new Set([
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${PORT}`,
    ]);
    if (!allowedOrigins.has(origin)) {
      return { ok: false, status: 403, error: "s11_bad_origin" };
    }
  }
  if (req.headers["x-s11-session"] !== S11_SESSION) {
    return { ok: false, status: 403, error: "s11_bad_session" };
  }
  return { ok: true };
}

// /s11/send-* の本体をサイズ上限付きで読む（S5 と同じ型）。
async function readS11SendBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > S11_MAX_BODY_BYTES) {
      return { tooLarge: true };
    }
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks) };
}

// S12 失効の送信器（1プロセスに1つ）。スロットごとの nonce・ctx・
// 要求の保持はメモリー内だけである。
const s12Sender = createS12Sender({ relayUrl: RELAY });

// S12 入口の試験単位セッション。S11 と同じ型であり、起動ごとに不可
// 推測の値を新規発行し、/s12-revoke 画面へメモリ上で差し込む
// （ファイルは書き換えない）。画面は /s12/nonces・/s12/send-* の
// 呼び出し時にこの値をヘッダーで示す。
const S12_SESSION = randomUUID();
const S12_SESSION_PLACEHOLDER = "REPLACE_WITH_S12_SESSION";
// /s12/send-* の本体サイズ上限。要求1件（ID トークンを含む）は
// 数 KiB であり、64 KiB で十分に足りる。超過は 413 で拒否する。
const S12_MAX_BODY_BYTES = 64 * 1024;

// S12 入口（/s12/nonces・/s12/send-*）の呼び出し元境界。S11 入口と
// 同じ型であり、次をすべて満たさなければ、状態を変更せず理由コード
// だけを返す。
function checkS12Entry(req) {
  const host = (req.headers.host || "").toLowerCase();
  const allowedHosts = new Set([
    `127.0.0.1:${PORT}`,
    `localhost:${PORT}`,
    `[::1]:${PORT}`,
  ]);
  if (!allowedHosts.has(host)) {
    return { ok: false, status: 403, error: "s12_bad_origin" };
  }
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    const allowedOrigins = new Set([
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${PORT}`,
    ]);
    if (!allowedOrigins.has(origin)) {
      return { ok: false, status: 403, error: "s12_bad_origin" };
    }
  }
  if (req.headers["x-s12-session"] !== S12_SESSION) {
    return { ok: false, status: 403, error: "s12_bad_session" };
  }
  return { ok: true };
}

// /s12/send-* の本体をサイズ上限付きで読む（S11 と同じ型）。
async function readS12SendBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > S12_MAX_BODY_BYTES) {
      return { tooLarge: true };
    }
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks) };
}

// S13 失効の送信器（1プロセスに1つ）。スロットごとの nonce・ctx・
// 要求の保持はメモリー内だけである。
const s13Sender = createS13Sender({ relayUrl: RELAY });

// S13 入口の試験単位セッション。S12 と同じ型であり、起動ごとに不可
// 推測の値を新規発行し、/s13-revoke 画面へメモリ上で差し込む
// （ファイルは書き換えない）。画面は /s13/nonces・/s13/send-* の
// 呼び出し時にこの値をヘッダーで示す。
const S13_SESSION = randomUUID();
const S13_SESSION_PLACEHOLDER = "REPLACE_WITH_S13_SESSION";
// /s13/send-* の本体サイズ上限。要求1件（ID トークンを含む）は
// 数 KiB であり、64 KiB で十分に足りる。超過は 413 で拒否する。
const S13_MAX_BODY_BYTES = 64 * 1024;

// S13 入口（/s13/nonces・/s13/send-*）の呼び出し元境界。S12 入口と
// 同じ型であり、次をすべて満たさなければ、状態を変更せず理由コード
// だけを返す。
function checkS13Entry(req) {
  const host = (req.headers.host || "").toLowerCase();
  const allowedHosts = new Set([
    `127.0.0.1:${PORT}`,
    `localhost:${PORT}`,
    `[::1]:${PORT}`,
  ]);
  if (!allowedHosts.has(host)) {
    return { ok: false, status: 403, error: "s13_bad_origin" };
  }
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    const allowedOrigins = new Set([
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${PORT}`,
    ]);
    if (!allowedOrigins.has(origin)) {
      return { ok: false, status: 403, error: "s13_bad_origin" };
    }
  }
  if (req.headers["x-s13-session"] !== S13_SESSION) {
    return { ok: false, status: 403, error: "s13_bad_session" };
  }
  return { ok: true };
}

// /s13/send-* の本体をサイズ上限付きで読む（S12 と同じ型）。
async function readS13SendBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > S13_MAX_BODY_BYTES) {
      return { tooLarge: true };
    }
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks) };
}

// S14 ローテーションの送信器（1プロセスに1つ）。スロットごとの
// nonce・ctx・要求の保持はメモリー内だけである。
const s14Sender = createS14Sender({ relayUrl: RELAY });

// S14 入口の試験単位セッション。S13 と同じ型であり、起動ごとに不可
// 推測の値を新規発行し、/s14-rotate 画面へメモリ上で差し込む
// （ファイルは書き換えない）。画面は /s14/nonces・/s14/send-* の
// 呼び出し時にこの値をヘッダーで示す。
const S14_SESSION = randomUUID();
const S14_SESSION_PLACEHOLDER = "REPLACE_WITH_S14_SESSION";
// /s14/send-* の本体サイズ上限。要求1件（ID トークンを含む）は
// 数 KiB であり、64 KiB で十分に足りる。超過は 413 で拒否する。
const S14_MAX_BODY_BYTES = 64 * 1024;

// S14 入口（/s14/nonces・/s14/send-*）の呼び出し元境界。S13 入口と
// 同じ型であり、次をすべて満たさなければ、状態を変更せず理由コード
// だけを返す。
function checkS14Entry(req) {
  const host = (req.headers.host || "").toLowerCase();
  const allowedHosts = new Set([
    `127.0.0.1:${PORT}`,
    `localhost:${PORT}`,
    `[::1]:${PORT}`,
  ]);
  if (!allowedHosts.has(host)) {
    return { ok: false, status: 403, error: "s14_bad_origin" };
  }
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    const allowedOrigins = new Set([
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${PORT}`,
    ]);
    if (!allowedOrigins.has(origin)) {
      return { ok: false, status: 403, error: "s14_bad_origin" };
    }
  }
  if (req.headers["x-s14-session"] !== S14_SESSION) {
    return { ok: false, status: 403, error: "s14_bad_session" };
  }
  return { ok: true };
}

// /s14/send-* の本体をサイズ上限付きで読む（S13 と同じ型）。
async function readS14SendBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > S14_MAX_BODY_BYTES) {
      return { tooLarge: true };
    }
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks) };
}

// S15 応答破棄ドリルの送信器（1プロセスに1つ）。試行枠ごとの
// nonce・ctx・承認固定値の保持はメモリー内だけである。
const s15Sender = createS15Sender({ relayUrl: RELAY });

// S15 入口の試験単位セッション。S14 と同じ型であり、起動ごとに
// 不可推測の値を新規発行する。S15 専用画面は設けないため、この
// 値は画面へ差し込まれず、PC 側の運転手順がメモリー内だけの
// 扱いで保持して各入口のヘッダーに示す（値の受け渡し方法は
// 実施手順の提案で Codex と確定する。DESIGN.md の S15 付録）。
const S15_SESSION = randomUUID();
const S15_MAX_BODY_BYTES = 64 * 1024;

// S15 入口（/s15/nonces・/s15/freeze-approval・/s15/send-discard・
// /s15/record-judgment）の呼び出し元境界。S14 入口と同じ型であり、
// 次をすべて満たさなければ、状態を変更せず理由コードだけを返す。
function checkS15Entry(req) {
  const host = (req.headers.host || "").toLowerCase();
  const allowedHosts = new Set([
    `127.0.0.1:${PORT}`,
    `localhost:${PORT}`,
    `[::1]:${PORT}`,
  ]);
  if (!allowedHosts.has(host)) {
    return { ok: false, status: 403, error: "s15_bad_origin" };
  }
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    const allowedOrigins = new Set([
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${PORT}`,
    ]);
    if (!allowedOrigins.has(origin)) {
      return { ok: false, status: 403, error: "s15_bad_origin" };
    }
  }
  if (req.headers["x-s15-session"] !== S15_SESSION) {
    return { ok: false, status: 403, error: "s15_bad_session" };
  }
  return { ok: true };
}

// /s15/* の POST の本体をサイズ上限付きで読む（S14 と同じ型）。
async function readS15SendBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > S15_MAX_BODY_BYTES) {
      return { tooLarge: true };
    }
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks) };
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

// S10 運営者追加専用画面も同じく、起動時に読み込み、クライアント ID を
// メモリ上で差し込む（ファイルは書き換えない）。検証モジュールはそのまま返す。
const rawS10AddHtml = await readFile(path.join(root, "public", "s10-add-operator.html"), "utf8");
if (!rawS10AddHtml.includes(PLACEHOLDER)) {
  console.error("error: s10-add-operator.html にクライアント ID のプレースホルダが見つかりません");
  process.exit(1);
}
const s10AddHtml = rawS10AddHtml.split(PLACEHOLDER).join(CLIENT_ID);
const s10AddJs = await readFile(path.join(root, "tools", "s10-add.mjs"), "utf8");

// S11 並行送信専用画面も同じく、起動時に読み込み、クライアント ID と
// S11 セッションをメモリ上で差し込む（ファイルは書き換えない）。検証
// モジュールはそのまま返す。
const rawS11ParallelHtml = await readFile(path.join(root, "public", "s11-parallel.html"), "utf8");
if (!rawS11ParallelHtml.includes(PLACEHOLDER)) {
  console.error("error: s11-parallel.html にクライアント ID のプレースホルダが見つかりません");
  process.exit(1);
}
if (!rawS11ParallelHtml.includes(S11_SESSION_PLACEHOLDER)) {
  console.error("error: s11-parallel.html に S11 セッションのプレースホルダが見つかりません");
  process.exit(1);
}
const s11ParallelHtml = rawS11ParallelHtml
  .split(PLACEHOLDER).join(CLIENT_ID)
  .split(S11_SESSION_PLACEHOLDER).join(S11_SESSION);
const s11ParallelJs = await readFile(path.join(root, "tools", "s11-parallel.mjs"), "utf8");

// S12 失効専用画面も同じく、起動時に読み込み、クライアント ID と
// S12 セッションをメモリ上で差し込む（ファイルは書き換えない）。検証
// モジュールはそのまま返す。
const rawS12RevokeHtml = await readFile(path.join(root, "public", "s12-revoke.html"), "utf8");
if (!rawS12RevokeHtml.includes(PLACEHOLDER)) {
  console.error("error: s12-revoke.html にクライアント ID のプレースホルダが見つかりません");
  process.exit(1);
}
if (!rawS12RevokeHtml.includes(S12_SESSION_PLACEHOLDER)) {
  console.error("error: s12-revoke.html に S12 セッションのプレースホルダが見つかりません");
  process.exit(1);
}
const s12RevokeHtml = rawS12RevokeHtml
  .split(PLACEHOLDER).join(CLIENT_ID)
  .split(S12_SESSION_PLACEHOLDER).join(S12_SESSION);
const s12RevokeJs = await readFile(path.join(root, "tools", "s12-revoke.mjs"), "utf8");

// S13 失効専用画面も同じく、起動時に読み込み、クライアント ID と
// S13 セッションをメモリ上で差し込む（ファイルは書き換えない）。検証
// モジュールはそのまま返す。
const rawS13RevokeHtml = await readFile(path.join(root, "public", "s13-revoke.html"), "utf8");
if (!rawS13RevokeHtml.includes(PLACEHOLDER)) {
  console.error("error: s13-revoke.html にクライアント ID のプレースホルダが見つかりません");
  process.exit(1);
}
if (!rawS13RevokeHtml.includes(S13_SESSION_PLACEHOLDER)) {
  console.error("error: s13-revoke.html に S13 セッションのプレースホルダが見つかりません");
  process.exit(1);
}
const s13RevokeHtml = rawS13RevokeHtml
  .split(PLACEHOLDER).join(CLIENT_ID)
  .split(S13_SESSION_PLACEHOLDER).join(S13_SESSION);
const s13RevokeJs = await readFile(path.join(root, "tools", "s13-revoke.mjs"), "utf8");

// S14 ローテーション専用画面も同じく、起動時に読み込み、クライアント
// ID と S14 セッションをメモリ上で差し込む（ファイルは書き換えない）。
// 検証モジュールはそのまま返す。
const rawS14RotateHtml = await readFile(path.join(root, "public", "s14-rotate.html"), "utf8");
if (!rawS14RotateHtml.includes(PLACEHOLDER)) {
  console.error("error: s14-rotate.html にクライアント ID のプレースホルダが見つかりません");
  process.exit(1);
}
if (!rawS14RotateHtml.includes(S14_SESSION_PLACEHOLDER)) {
  console.error("error: s14-rotate.html に S14 セッションのプレースホルダが見つかりません");
  process.exit(1);
}
const s14RotateHtml = rawS14RotateHtml
  .split(PLACEHOLDER).join(CLIENT_ID)
  .split(S14_SESSION_PLACEHOLDER).join(S14_SESSION);
const s14RotateJs = await readFile(path.join(root, "tools", "s14-rotate.mjs"), "utf8");

// S15 の状態機械モジュールはそのまま返す（S15 専用画面はない）。
const s15ApplyJs = await readFile(path.join(root, "tools", "s15-apply.mjs"), "utf8");

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
    if (req.method === "GET" && pathname === "/s10-add-operator") {
      console.log(`GET /s10-add-operator -> 200`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(s10AddHtml);
      return;
    }
    if (req.method === "GET" && pathname === "/s10-add.mjs") {
      console.log(`GET /s10-add.mjs -> 200`);
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(s10AddJs);
      return;
    }
    if (req.method === "GET" && pathname === "/s11-parallel") {
      console.log(`GET /s11-parallel -> 200`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(s11ParallelHtml);
      return;
    }
    if (req.method === "GET" && pathname === "/s11-parallel.mjs") {
      console.log(`GET /s11-parallel.mjs -> 200`);
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(s11ParallelJs);
      return;
    }
    if (req.method === "GET" && pathname === "/s12-revoke") {
      console.log(`GET /s12-revoke -> 200`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(s12RevokeHtml);
      return;
    }
    if (req.method === "GET" && pathname === "/s12-revoke.mjs") {
      console.log(`GET /s12-revoke.mjs -> 200`);
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(s12RevokeJs);
      return;
    }
    if (req.method === "GET" && pathname === "/s13-revoke") {
      console.log(`GET /s13-revoke -> 200`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(s13RevokeHtml);
      return;
    }
    if (req.method === "GET" && pathname === "/s13-revoke.mjs") {
      console.log(`GET /s13-revoke.mjs -> 200`);
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(s13RevokeJs);
      return;
    }
    if (req.method === "GET" && pathname === "/s14-rotate") {
      console.log(`GET /s14-rotate -> 200`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(s14RotateHtml);
      return;
    }
    if (req.method === "GET" && pathname === "/s14-rotate.mjs") {
      console.log(`GET /s14-rotate.mjs -> 200`);
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(s14RotateJs);
      return;
    }
    if (req.method === "GET" && pathname === "/s15-apply.mjs") {
      console.log(`GET /s15-apply.mjs -> 200`);
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(s15ApplyJs);
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
    // S11 並行送信の送信器への入口。ループバック限定の提供サーバー上
    // でのみ動く。要求・応答の本体、トークン・Cookie・nonce の値は
    // ログに出さない。送信器の局所エラーは理由コードだけを返す。
    // 呼び出し元の境界（Host・Origin・試験単位セッション）を先に
    // 確認し、通らなければ状態を変更しない。
    if (req.method === "GET" && pathname === "/s11/nonces") {
      const entry = checkS11Entry(req);
      if (!entry.ok) {
        console.log(`GET /s11/nonces -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const params = new URL(req.url, "http://127.0.0.1").searchParams;
      const trialId = params.get("trial_id");
      const procedure = params.get("procedure");
      if (!trialId || (procedure !== "stale" && procedure !== "concurrent")) {
        console.log(`GET /s11/nonces -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        const nonces = await s11Sender.issueNonces({ trialId, procedure });
        console.log(`GET /s11/nonces -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ nonces }));
      } catch (e) {
        console.log(`GET /s11/nonces -> 502`);
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s11_nonce_issuance_failed" }));
      }
      return;
    }
    if (
      req.method === "POST" &&
      (pathname === "/s11/send-stale" || pathname === "/s11/send-concurrent")
    ) {
      const entry = checkS11Entry(req);
      if (!entry.ok) {
        console.log(`POST ${pathname} -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const contentType = req.headers["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        console.log(`POST ${pathname} -> 415`);
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_content_type" }));
        return;
      }
      const read = await readS11SendBody(req);
      if (read.tooLarge) {
        console.log(`POST ${pathname} -> 413`);
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
        console.log(`POST ${pathname} -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        const out =
          pathname === "/s11/send-stale"
            ? await s11Sender.sendStale({ trialId: parsed.trial_id, request: parsed.request })
            : await s11Sender.sendConcurrent({ trialId: parsed.trial_id, requests: parsed.requests });
        console.log(`POST ${pathname} -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) {
        // 送信前の確認に失敗した場合は1件も送っていない。理由コード
        // だけを返し、値は返さない。期限切れは 410、その他は 409 とする。
        const status = e.code === "s11_nonces_expired" ? 410 : 409;
        console.log(`POST ${pathname} -> ${status}`);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s11_send_failed" }));
      }
      return;
    }
    // S12 失効の送信器への入口。ループバック限定の提供サーバー上での
    // み動く。要求・応答の本体、トークン・Cookie・nonce の値はログに
    // 出さない。送信器の局所エラーは理由コードだけを返す。呼び出し元
    // の境界（Host・Origin・試験単位セッション）を先に確認し、通らな
    // ければ状態を変更しない。
    if (req.method === "GET" && pathname === "/s12/nonces") {
      const entry = checkS12Entry(req);
      if (!entry.ok) {
        console.log(`GET /s12/nonces -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const params = new URL(req.url, "http://127.0.0.1").searchParams;
      const trialId = params.get("trial_id");
      const slot = params.get("slot");
      const S12_SLOT_NAMES = ["heldB", "revokeA", "freshB", "checkC"];
      if (!trialId || !S12_SLOT_NAMES.includes(slot)) {
        console.log(`GET /s12/nonces -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        // 送信器の試行は画面の試行に追随する。画面が新しい試行を
        // 始めたら、送信器もその試行で開始する（旧試行のスロットは
        // 破棄される）。
        const snap = s12Sender.snapshot();
        if (!snap || snap.trialId !== trialId) {
          s12Sender.beginTrial(trialId);
        }
        const issued = await s12Sender.issueNonce({ trialId, slot });
        console.log(`GET /s12/nonces -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ nonce: issued.nonce }));
      } catch (e) {
        console.log(`GET /s12/nonces -> 502`);
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s12_nonce_issuance_failed" }));
      }
      return;
    }
    if (req.method === "POST" && pathname === "/s12/freeze-revoke") {
      const entry = checkS12Entry(req);
      if (!entry.ok) {
        console.log(`POST /s12/freeze-revoke -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const contentType = req.headers["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        console.log(`POST /s12/freeze-revoke -> 415`);
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_content_type" }));
        return;
      }
      const read = await readS12SendBody(req);
      if (read.tooLarge) {
        console.log(`POST /s12/freeze-revoke -> 413`);
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
      if (
        !parsed || typeof parsed !== "object" ||
        typeof parsed.trial_id !== "string" || parsed.trial_id.length === 0 ||
        typeof parsed.subject_hash !== "string"
      ) {
        console.log(`POST /s12/freeze-revoke -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        // 送信器の試行は画面の試行に追随する（/s12/nonces と同じ）。
        const snap = s12Sender.snapshot();
        if (!snap || snap.trialId !== parsed.trial_id) {
          s12Sender.beginTrial(parsed.trial_id);
        }
        s12Sender.freezeRevokeTarget({
          trialId: parsed.trial_id,
          subjectHash: parsed.subject_hash,
        });
        console.log(`POST /s12/freeze-revoke -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        // 固定できなかった場合は理由コードだけを返す。固定値は
        // 応答・ログに出さない。
        console.log(`POST /s12/freeze-revoke -> 409`);
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s12_freeze_failed" }));
      }
      return;
    }
    if (
      req.method === "POST" &&
      (pathname === "/s12/send-revoke" || pathname === "/s12/send-verify-only")
    ) {
      const entry = checkS12Entry(req);
      if (!entry.ok) {
        console.log(`POST ${pathname} -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const contentType = req.headers["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        console.log(`POST ${pathname} -> 415`);
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_content_type" }));
        return;
      }
      const read = await readS12SendBody(req);
      if (read.tooLarge) {
        console.log(`POST ${pathname} -> 413`);
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
        console.log(`POST ${pathname} -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        const out =
          pathname === "/s12/send-revoke"
            ? await s12Sender.sendRevoke({ trialId: parsed.trial_id, request: parsed.request })
            : await s12Sender.sendVerifyOnly({
                trialId: parsed.trial_id,
                slot: parsed.slot,
                request: parsed.request,
              });
        console.log(`POST ${pathname} -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) {
        // 送信前の確認に失敗した場合は1件も送っていない。理由コード
        // だけを返し、値は返さない。期限切れ・保持トークンの鮮度不足
        // は 410、その他は 409 とする。
        const status =
          e.code === "s12_nonces_expired" || e.code === "s12_held_token_stale" ? 410 : 409;
        console.log(`POST ${pathname} -> ${status}`);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s12_send_failed" }));
      }
      return;
    }
    // S13 失効の送信器への入口。S12 入口と同じ型である。要求・応答の
    // 本体、トークン・Cookie・nonce の値はログに出さない。送信器の
    // 局所エラーは理由コードだけを返す。呼び出し元の境界（Host・
    // Origin・試験単位セッション）を先に確認し、通らなければ状態を
    // 変更しない。
    if (req.method === "GET" && pathname === "/s13/nonces") {
      const entry = checkS13Entry(req);
      if (!entry.ok) {
        console.log(`GET /s13/nonces -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const params = new URL(req.url, "http://127.0.0.1").searchParams;
      const trialId = params.get("trial_id");
      const slot = params.get("slot");
      const S13_SLOT_NAMES = ["revokeC", "revokeA", "checkA"];
      if (!trialId || !S13_SLOT_NAMES.includes(slot)) {
        console.log(`GET /s13/nonces -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        // 送信器の試行は画面の試行に追随する。画面が新しい試行を
        // 始めたら、送信器もその試行で開始する（旧試行のスロットは
        // 破棄される）。
        const snap = s13Sender.snapshot();
        if (!snap || snap.trialId !== trialId) {
          s13Sender.beginTrial(trialId);
        }
        const issued = await s13Sender.issueNonce({ trialId, slot });
        console.log(`GET /s13/nonces -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ nonce: issued.nonce }));
      } catch (e) {
        console.log(`GET /s13/nonces -> 502`);
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s13_nonce_issuance_failed" }));
      }
      return;
    }
    if (req.method === "POST" && pathname === "/s13/freeze-revoke") {
      const entry = checkS13Entry(req);
      if (!entry.ok) {
        console.log(`POST /s13/freeze-revoke -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const contentType = req.headers["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        console.log(`POST /s13/freeze-revoke -> 415`);
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_content_type" }));
        return;
      }
      const read = await readS13SendBody(req);
      if (read.tooLarge) {
        console.log(`POST /s13/freeze-revoke -> 413`);
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
      if (
        !parsed || typeof parsed !== "object" ||
        typeof parsed.trial_id !== "string" || parsed.trial_id.length === 0 ||
        (parsed.slot !== "revokeC" && parsed.slot !== "revokeA") ||
        typeof parsed.subject_hash !== "string"
      ) {
        console.log(`POST /s13/freeze-revoke -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        // 送信器の試行は画面の試行に追随する（/s13/nonces と同じ）。
        const snap = s13Sender.snapshot();
        if (!snap || snap.trialId !== parsed.trial_id) {
          s13Sender.beginTrial(parsed.trial_id);
        }
        s13Sender.freezeRevokeTarget({
          trialId: parsed.trial_id,
          slot: parsed.slot,
          subjectHash: parsed.subject_hash,
        });
        console.log(`POST /s13/freeze-revoke -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        // 固定できなかった場合は理由コードだけを返す。固定値は
        // 応答・ログに出さない。
        console.log(`POST /s13/freeze-revoke -> 409`);
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s13_freeze_failed" }));
      }
      return;
    }
    if (
      req.method === "POST" &&
      (pathname === "/s13/send-revoke" || pathname === "/s13/send-verify-only")
    ) {
      const entry = checkS13Entry(req);
      if (!entry.ok) {
        console.log(`POST ${pathname} -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const contentType = req.headers["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        console.log(`POST ${pathname} -> 415`);
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_content_type" }));
        return;
      }
      const read = await readS13SendBody(req);
      if (read.tooLarge) {
        console.log(`POST ${pathname} -> 413`);
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
        console.log(`POST ${pathname} -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        const out =
          pathname === "/s13/send-revoke"
            ? await s13Sender.sendRevoke({
                trialId: parsed.trial_id,
                slot: parsed.slot,
                request: parsed.request,
              })
            : await s13Sender.sendVerifyOnly({
                trialId: parsed.trial_id,
                slot: parsed.slot,
                request: parsed.request,
              });
        console.log(`POST ${pathname} -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) {
        // 送信前の確認に失敗した場合は1件も送っていない。理由コード
        // だけを返し、値は返さない。期限切れは 410、その他は 409 と
        // する。
        const status = e.code === "s13_nonces_expired" ? 410 : 409;
        console.log(`POST ${pathname} -> ${status}`);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s13_send_failed" }));
      }
      return;
    }
    // S14 ローテーションの送信器への入口。S13 入口と同じ型である。
    // 要求・応答の本体、トークン・Cookie・nonce の値はログに出さない。
    // 送信器の局所エラーは理由コードだけを返す。呼び出し元の境界
    // （Host・Origin・試験単位セッション）を先に確認し、通らなければ
    // 状態を変更しない。
    if (req.method === "GET" && pathname === "/s14/nonces") {
      const entry = checkS14Entry(req);
      if (!entry.ok) {
        console.log(`GET /s14/nonces -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const params = new URL(req.url, "http://127.0.0.1").searchParams;
      const trialId = params.get("trial_id");
      const slot = params.get("slot");
      const S14_SLOT_NAMES = ["rotateAB", "checkA", "checkB"];
      if (!trialId || !S14_SLOT_NAMES.includes(slot)) {
        console.log(`GET /s14/nonces -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        // 送信器の試行は画面の試行に追随する。画面が新しい試行を
        // 始めたら、送信器もその試行で開始する（旧試行のスロットは
        // 破棄される）。
        const snap = s14Sender.snapshot();
        if (!snap || snap.trialId !== trialId) {
          s14Sender.beginTrial(trialId);
        }
        const issued = await s14Sender.issueNonce({ trialId, slot });
        console.log(`GET /s14/nonces -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ nonce: issued.nonce }));
      } catch (e) {
        console.log(`GET /s14/nonces -> 502`);
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s14_nonce_issuance_failed" }));
      }
      return;
    }
    if (req.method === "POST" && pathname === "/s14/freeze-rotate") {
      const entry = checkS14Entry(req);
      if (!entry.ok) {
        console.log(`POST /s14/freeze-rotate -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const contentType = req.headers["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        console.log(`POST /s14/freeze-rotate -> 415`);
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_content_type" }));
        return;
      }
      const read = await readS14SendBody(req);
      if (read.tooLarge) {
        console.log(`POST /s14/freeze-rotate -> 413`);
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
      if (
        !parsed || typeof parsed !== "object" ||
        typeof parsed.trial_id !== "string" || parsed.trial_id.length === 0 ||
        typeof parsed.old_subject_hash !== "string" ||
        typeof parsed.new_subject_hash !== "string"
      ) {
        console.log(`POST /s14/freeze-rotate -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        // 送信器の試行は画面の試行に追随する（/s14/nonces と同じ）。
        const snap = s14Sender.snapshot();
        if (!snap || snap.trialId !== parsed.trial_id) {
          s14Sender.beginTrial(parsed.trial_id);
        }
        s14Sender.freezeRotateTargets({
          trialId: parsed.trial_id,
          oldSubjectHash: parsed.old_subject_hash,
          newSubjectHash: parsed.new_subject_hash,
        });
        console.log(`POST /s14/freeze-rotate -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        // 固定できなかった場合は理由コードだけを返す。固定値は
        // 応答・ログに出さない。
        console.log(`POST /s14/freeze-rotate -> 409`);
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s14_freeze_failed" }));
      }
      return;
    }
    if (
      req.method === "POST" &&
      (pathname === "/s14/send-rotate" || pathname === "/s14/send-verify-only")
    ) {
      const entry = checkS14Entry(req);
      if (!entry.ok) {
        console.log(`POST ${pathname} -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const contentType = req.headers["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        console.log(`POST ${pathname} -> 415`);
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_content_type" }));
        return;
      }
      const read = await readS14SendBody(req);
      if (read.tooLarge) {
        console.log(`POST ${pathname} -> 413`);
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
        console.log(`POST ${pathname} -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        const out =
          pathname === "/s14/send-rotate"
            ? await s14Sender.sendRotate({
                trialId: parsed.trial_id,
                slot: parsed.slot,
                request: parsed.request,
              })
            : await s14Sender.sendVerifyOnly({
                trialId: parsed.trial_id,
                slot: parsed.slot,
                request: parsed.request,
              });
        console.log(`POST ${pathname} -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) {
        // 送信前の確認に失敗した場合は1件も送っていない。理由コード
        // だけを返し、値は返さない。期限切れは 410、その他は 409 と
        // する。
        const status = e.code === "s14_nonces_expired" ? 410 : 409;
        console.log(`POST ${pathname} -> ${status}`);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s14_send_failed" }));
      }
      return;
    }
    // S15 応答破棄ドリルの送信器への入口。S14 入口と同じ型である。
    // 要求・応答の本体、トークン・一回値・Cookie・nonce の値は
    // ログに出さない。送信器の局所エラーは理由コードだけを返す。
    // 呼び出し元の境界（Host・Origin・試験単位セッション）を先に
    // 確認し、通らなければ状態を変更しない。破棄送信の応答は、
    // 実応答の内容ではなく破棄記録だけである。
    if (req.method === "GET" && pathname === "/s15/nonces") {
      const entry = checkS15Entry(req);
      if (!entry.ok) {
        console.log(`GET /s15/nonces -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const params = new URL(req.url, "http://127.0.0.1").searchParams;
      const trialId = params.get("trial_id");
      const attemptRaw = params.get("attempt");
      const attempt = attemptRaw !== null && /^\d+$/.test(attemptRaw) ? Number(attemptRaw) : NaN;
      if (!trialId || !Number.isInteger(attempt) || attempt < 1 || attempt > 3) {
        console.log(`GET /s15/nonces -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        // 送信器の試行は運転側の試行に追随する（S14 と同じ）。
        const snap = s15Sender.snapshot();
        if (!snap || snap.trialId !== trialId) {
          s15Sender.beginTrial(trialId);
        }
        const issued = await s15Sender.issueNonce({ trialId, attempt });
        console.log(`GET /s15/nonces -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ nonce: issued.nonce }));
      } catch (e) {
        const status = e.code === "s15_sender_busy" || (e.code || "").startsWith("s15_") ? 409 : 502;
        console.log(`GET /s15/nonces -> ${status}`);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s15_nonce_issuance_failed" }));
      }
      return;
    }
    if (
      req.method === "POST" &&
      (pathname === "/s15/freeze-approval" ||
        pathname === "/s15/send-discard" ||
        pathname === "/s15/record-judgment")
    ) {
      const entry = checkS15Entry(req);
      if (!entry.ok) {
        console.log(`POST ${pathname} -> ${entry.status}`);
        res.writeHead(entry.status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: entry.error }));
        return;
      }
      const contentType = req.headers["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        console.log(`POST ${pathname} -> 415`);
        res.writeHead(415, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_content_type" }));
        return;
      }
      const read = await readS15SendBody(req);
      if (read.tooLarge) {
        console.log(`POST ${pathname} -> 413`);
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
      const validAttempt =
        parsed && Number.isInteger(parsed.attempt) && parsed.attempt >= 1 && parsed.attempt <= 3;
      const validTrial =
        parsed && typeof parsed.trial_id === "string" && parsed.trial_id.length > 0;
      if (!parsed || typeof parsed !== "object" || !validTrial || !validAttempt) {
        console.log(`POST ${pathname} -> 400`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad_body" }));
        return;
      }
      try {
        // 送信器の試行は運転側の試行に追随する（/s15/nonces と同じ）。
        const snap = s15Sender.snapshot();
        if (!snap || snap.trialId !== parsed.trial_id) {
          s15Sender.beginTrial(parsed.trial_id);
        }
        if (pathname === "/s15/freeze-approval") {
          if (
            typeof parsed.operation_id !== "string" || parsed.operation_id.length === 0 ||
            typeof parsed.purpose !== "string" ||
            typeof parsed.subject_hash !== "string" ||
            typeof parsed.env_id !== "string" || parsed.env_id.length === 0 ||
            typeof parsed.one_time_value !== "string" || parsed.one_time_value.length === 0
          ) {
            console.log(`POST ${pathname} -> 400`);
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "bad_body" }));
            return;
          }
          s15Sender.freezeApproval({
            trialId: parsed.trial_id,
            attempt: parsed.attempt,
            operationId: parsed.operation_id,
            purpose: parsed.purpose,
            subjectHash: parsed.subject_hash,
            envId: parsed.env_id,
            oneTimeValue: parsed.one_time_value,
          });
          console.log(`POST ${pathname} -> 200`);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (pathname === "/s15/record-judgment") {
          if (!["committed", "uncommitted", "discrepancy"].includes(parsed.outcome)) {
            console.log(`POST ${pathname} -> 400`);
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "bad_body" }));
            return;
          }
          s15Sender.recordJudgment({
            trialId: parsed.trial_id,
            attempt: parsed.attempt,
            outcome: parsed.outcome,
          });
          console.log(`POST ${pathname} -> 200`);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        // /s15/send-discard：要求の形を確認してから送信器へ渡す。
        const request = parsed.request;
        if (
          !request || typeof request !== "object" ||
          typeof request.id_token !== "string" || request.id_token.length === 0 ||
          typeof request.one_time_value !== "string" ||
          typeof request.purpose !== "string" ||
          typeof request.env_id !== "string"
        ) {
          console.log(`POST ${pathname} -> 400`);
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "bad_body" }));
          return;
        }
        const out = await s15Sender.sendDiscard({
          trialId: parsed.trial_id,
          attempt: parsed.attempt,
          request,
        });
        // 返すのは破棄記録だけである（実応答の状態・理由・世代は
        // 送信器にも提供サーバーにも存在しない）。
        console.log(`POST ${pathname} -> 200`);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) {
        // 送信前の確認に失敗した場合は1件も送っていない。理由
        // コードだけを返し、値は返さない。期限切れは 410、その他
        // は 409 とする。
        const status = e.code === "s15_nonces_expired" ? 410 : 409;
        console.log(`POST ${pathname} -> ${status}`);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e.code || "s15_send_failed" }));
      }
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
