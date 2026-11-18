import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  loadTextMineAnalyzer,
  type TextMineResult,
  type TextMineWord,
} from "./textMine";
import { layoutWordCloud } from "./wordCloud";

/** よく出る言葉のワードクラウド。大きさは書いた人数に比例する。 */
function WordCloud({ words }: { words: TextMineWord[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const placed = useMemo(() => {
    if (!width || !words.length) return [];
    const canvas = document.createElement("canvas").getContext("2d");
    const measure = (text: string, size: number) => {
      if (canvas) {
        canvas.font = `700 ${size}px "BIZ UDPGothic", sans-serif`;
        return { w: canvas.measureText(text).width, h: size };
      }
      return { w: text.length * size * 0.62, h: size };
    };
    return layoutWordCloud(
      words.map((w) => ({ word: w.word, weight: w.respondents })),
      width,
      280,
      measure,
    );
  }, [words, width]);
  if (!words.length) return null;
  const byWord = new Map(words.map((w) => [w.word, w]));
  return (
    <div
      className="console-wordcloud"
      ref={ref}
      role="img"
      aria-label="言葉のクラウド（文字の大きさは書いた人数の多さ）"
    >
      {placed.map((p) => (
        <span
          key={p.word}
          style={{ left: p.x, top: p.y, fontSize: p.size, color: p.color }}
          title={`${p.word}（${byWord.get(p.word)?.respondents ?? 0}人）`}
        >
          {p.word}
        </span>
      ))}
    </div>
  );
}

type TextMineState =
  | { kind: "idle" }
  | { kind: "loading"; done: number }
  | { kind: "done"; result: TextMineResult }
  | { kind: "error" };

/** 言葉の分析のパネル（テキストマイニング）。文章の集まりを受け取り、
 * ワークシートの記述回答と思考ツールのカードで共用する。解析はブラウザ
 * の中で行い、文章が外部へ送られることはない。辞書の読み込みは初回だけ。 */
export function TextMinePanel({
  texts,
  idleNote,
}: {
  texts: string[];
  idleNote: string;
}) {
  const [state, setState] = useState<TextMineState>({ kind: "idle" });
  const run = async () => {
    setState({ kind: "loading", done: 0 });
    try {
      const analyzer = await loadTextMineAnalyzer((done) =>
        setState({ kind: "loading", done }),
      );
      setState({ kind: "done", result: analyzer.analyze(texts) });
    } catch {
      setState({ kind: "error" });
    }
  };
  return (
    <div className="console-textmine">
      <button
        type="button"
        className="console-textmine-button"
        disabled={!texts.length || state.kind === "loading"}
        onClick={() => void run()}
      >
        {state.kind === "done" ? "最新の回答で分析し直す" : "言葉を分析する"}
      </button>
      {state.kind === "loading" && (
        <p className="console-textmine-status" role="status">
          {state.done > 0
            ? `辞書を読み込んでいます…（初回のみ）${state.done}/12`
            : "分析しています…"}
        </p>
      )}
      {state.kind === "error" && (
        <p className="console-textmine-status" role="alert">
          読み込みに失敗しました。通信環境を確認して、もう一度押してください。
        </p>
      )}
      {state.kind === "done" && (
        <>
          <p className="console-textmine-note">
            {state.result.texts}人の回答から分析しました。言葉の大きさは、書いた人数の多さです。
          </p>
          <WordCloud words={state.result.words} />
          <p className="console-textmine-note">よく出る言葉（人数順）：</p>
          <table className="console-textmine-table">
            <thead>
              <tr>
                <th>言葉</th>
                <th>人数</th>
                <th>回数</th>
              </tr>
            </thead>
            <tbody>
              {state.result.words.slice(0, 15).map((w) => (
                <tr key={w.word}>
                  <td>{w.word}</td>
                  <td>{w.respondents}人</td>
                  <td>{w.count}回</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.result.pairs.length > 0 && (
            <>
              <p className="console-textmine-note">よく一緒に出る言葉（同じ人が書いた言葉の組み合わせです）：</p>
              <ul className="console-textmine-pairs">
                {state.result.pairs.slice(0, 8).map((p) => (
                  <li key={p.a + "\0" + p.b}>
                    {p.a} × {p.b}（{p.respondents}人）
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {state.kind === "idle" && texts.length > 0 && (
        <p className="console-textmine-note">{idleNote}</p>
      )}
    </div>
  );
}