// テキストマイニング連携（設計: ~/workspace/textmine/DESIGN.md v2）
// 解析ライブラリと辞書は独立 Worker `vhslide-textmine` が配信し、
// 解析そのものはこのブラウザの中で行う。生徒の回答は外部へ送られない。
export interface TextMineWord {
  word: string;
  respondents: number;
  count: number;
  score: number;
}
export interface TextMinePair {
  a: string;
  b: string;
  respondents: number;
}
export interface TextMineResult {
  words: TextMineWord[];
  pairs: TextMinePair[];
  texts: number;
  tokens: number;
}

export const TEXTMINE_ANALYZER_URL =
  "https://vhslide-textmine.overdozer1124.workers.dev/v1/analyzer.js";

interface TextMineAnalyzer {
  analyze: (texts: string[]) => TextMineResult;
}
interface TextMineModule {
  createAnalyzer: (options?: {
    onProgress?: (name: string) => void;
  }) => Promise<TextMineAnalyzer>;
}

let analyzerPromise: Promise<TextMineAnalyzer> | null = null;

/** 解析器を用意する。初回だけ辞書（約17MB）の読み込みが起き、以降は使い回す。 */
export function loadTextMineAnalyzer(
  onProgress?: (done: number, total: number) => void,
): Promise<TextMineAnalyzer> {
  if (!analyzerPromise) {
    analyzerPromise = (async () => {
      const url: string = TEXTMINE_ANALYZER_URL;
      const mod = (await import(/* @vite-ignore */ url)) as TextMineModule;
      let done = 0;
      return mod.createAnalyzer({
        onProgress: () => {
          done += 1;
          onProgress?.(done, 12);
        },
      });
    })().catch((error) => {
      analyzerPromise = null; // 失敗したら次のクリックでやり直せるようにする
      throw error;
    });
  }
  return analyzerPromise;
}

/** 回答一覧から、指定した記述欄の文章だけを取り出す。 */
export function textMineTexts(
  responses: { values: Record<string, unknown> }[],
  fieldId: string,
): string[] {
  const out: string[] = [];
  for (const r of responses) {
    const v = r.values?.[fieldId];
    if (typeof v === "string" && v.trim()) out.push(v);
  }
  return out;
}
