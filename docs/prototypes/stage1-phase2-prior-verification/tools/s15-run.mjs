// S15 運転ランチャー（項目7 手順1：応答破棄を伴う全面復旧）。
//
// 役割：S15 の運転では、提供サーバー（tools/serve-real.mjs）を
// このプロセスで生成し、S15 専用画面（public/s15-apply.html）
// の配信と、復旧操作のための運転ハンドル（tools/s15-driver.mjs
// の attachS15Driver）を同一プロセスで保持する。これにより、
// 画面の送信指示の結果が不明になった場合でも、判定の記録が
// 「画面が使っている送信器そのもの」へ届く（Codex 再レビュー
// 6879939268 への対応）。以前の案内（運転コードから記録する）
// では、運転コードが別の提供サーバー・別の送信器を生成して
// しまうため、現在の送信器の状態を復旧できなかった。
//
// 起動:
//   GOOGLE_CLIENT_ID=<検証用 OAuth クライアント ID> \
//   RELAY_URL=http://127.0.0.1:8798 \
//   node tools/s15-run.mjs
//   （画面は http://127.0.0.1:8787/s15-apply。PORT 環境変数で
//    待ち受けポートを変更できる。既定 8787）
//
// 運転手順:
//   1. このランチャーを起動し、表示された URL の S15 専用画面
//      で通常の手順（試行の開始 → 対象 B の取得 → 承認内容の
//      凍結 → 送信器への固定 → 破棄送信 → 読み戻し判定）を
//      進める。
//   2. 送信指示の結果が不明になった場合（画面が状態未確定で
//      停止した場合）は、再送しない。独立した読み戻し（検証用
//      Worker の Data Studio 等）で状態を確かめる。
//   3. 判定の記録は画面が優先である（修正4、Codex 再レビュー
//      6880300681）：画面の復旧手順（⑤の「送信を結果不明とし
//      て記録する」）で画面の状態を sent-undetermined へ進め、
//      画面から判定を記録する。送信器側の判定はその鏡像で記録
//      されるため、ランチャーの操作は不要である。
//   4. 画面が使えない場合の代替として、このランチャーの標準
//      入力へ次の1行を入力する（復旧操作）。
//        judge <試行ID> <試行番号> <committed|uncommitted|discrepancy>
//      判定は同一プロセスの送信器へ記録され、結果（記録できた
//      こと、または拒否の理由コードだけ）が表示される。担い手
//      ルール：judge が先に記録していた場合でも、後から画面が
//      同じ区分を鏡像すると「記録済み（already_recorded）」と
//      して受け付けられ、復旧は失敗しない。異なる区分は競合
//      （s15_judgment_conflict）として拒否され、画面は不一致
//      として停止する（担い手の記録と読み戻し判定がずれて
//      いるため、扱いは所有者が判断する）。
//   5. 判定の記録後、画面側で再実施または締めへ進む。終了は
//      quit と入力するか、標準入力を閉じる。
//
// セッションの受け渡しはメモリー内だけである（createRealServer
// の戻り値を attachS15Driver へ JS の値として渡す）。セッ
// ション値・トークン・一回値は、標準入出力・URL・ファイルの
// いずれにも出ない。

import { createInterface } from "node:readline";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createRealServer } from "./serve-real.mjs";
import { attachS15Driver } from "./s15-driver.mjs";

const JUDGE_OUTCOMES = new Set(["committed", "uncommitted", "discrepancy"]);
const USAGE =
  "usage: judge <trial_id> <attempt 1-3> <committed|uncommitted|discrepancy> / quit";

// 復旧操作の1行（judge ...）を解釈する。形式が合わなければ
// null を返す。試行番号は送信器の試行枠（1〜3）だけを受け付
// ける。判定の可否そのものは送信器が決める。
export function parseJudgeCommand(line) {
  const parts = String(line).trim().split(/\s+/);
  if (parts.length !== 4 || parts[0] !== "judge") return null;
  const [, trialId, attemptText, outcome] = parts;
  if (!/^\d+$/.test(attemptText)) return null;
  const attempt = Number(attemptText);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 3) return null;
  if (!JUDGE_OUTCOMES.has(outcome)) return null;
  return { trialId, attempt, outcome };
}

// 復旧操作の1行を処理し、表示する文字列（秘密を含まない）を
// { text, quit } の形で返す。空行は text: null。判定が拒否され
// た場合は理由コードだけを示す。
export async function handleRecoveryLine(driver, line) {
  const trimmed = String(line).trim();
  if (trimmed === "") return { text: null, quit: false };
  if (trimmed === "quit" || trimmed === "exit") {
    return { text: "S15 運転ランチャーを終了します", quit: true };
  }
  if (trimmed === "judge" || trimmed.startsWith("judge ")) {
    const parsed = parseJudgeCommand(trimmed);
    if (!parsed) return { text: USAGE, quit: false };
    const result = await driver.recordJudgment(parsed);
    if (result && result.status === 200 && result.ok === true) {
      if (result.already_recorded === true) {
        return {
          text: `判定は記録済みでした（同じ区分）: trial=${parsed.trialId} attempt=${parsed.attempt} outcome=${parsed.outcome}`,
          quit: false,
        };
      }
      return {
        text: `判定を記録しました: trial=${parsed.trialId} attempt=${parsed.attempt} outcome=${parsed.outcome}`,
        quit: false,
      };
    }
    const code =
      result && typeof result.error === "string" ? result.error : "unknown";
    const status = result && typeof result.status === "number" ? result.status : "?";
    return {
      text: `判定の記録が拒否されました: ${code}（status=${status}）`,
      quit: false,
    };
  }
  return { text: USAGE, quit: false };
}

// 提供サーバーを同一プロセスで生成し、運転ハンドルを結び付け
// て返す。options は createRealServer へそのまま渡す（指定が
// なければ環境変数から読む）。戻り値にセッション値は含めない
// （ハンドルのクロージャ内だけに保持される）。
export async function startS15Run(options = {}) {
  const created = await createRealServer(options);
  const driver = await attachS15Driver(created);
  return { created, driver, baseUrl: driver.baseUrl, relay: created.relay };
}

// スクリプトとして実行された場合だけ、対話コンソールを始める
// （モジュールとして import した場合は生成も待ち受けもしない）。
const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  try {
    const { driver, relay } = await startS15Run();
    console.log(`S15 専用画面: ${driver.baseUrl}/s15-apply (relay: ${relay})`);
    console.log(
      "復旧操作: judge <trial_id> <attempt> <committed|uncommitted|discrepancy>、終了: quit"
    );
    const rl = createInterface({ input: process.stdin, terminal: false });
    for await (const line of rl) {
      const { text, quit } = await handleRecoveryLine(driver, line);
      if (text) console.log(text);
      if (quit) break;
    }
    await driver.close();
  } catch (e) {
    console.error(e && e.message ? e.message : String(e));
    process.exit(1);
  }
}
