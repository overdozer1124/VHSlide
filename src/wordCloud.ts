// ワードクラウドの配置計算（描画から切り離した純粋関数）
// 大きさは「書いた人数」に比例（平方根スケールで差を読みやすくする）。
// 配置は中心からの渦巻き探索で、重ならない位置を決定的に選ぶ。
export interface CloudWordInput {
  word: string;
  weight: number;
}
export interface PlacedWord {
  word: string;
  /** 中心座標（px） */
  x: number;
  y: number;
  size: number;
  color: string;
}

const PALETTE = [
  "#2f6a45",
  "#315d4e",
  "#3f6ea5",
  "#b45a1b",
  "#5b7a3a",
  "#2a6a7a",
  "#8c4a6a",
  "#41604f",
];

export function cloudFontSize(
  weight: number,
  maxWeight: number,
  min = 13,
  max = 42,
): number {
  if (maxWeight <= 0) return min;
  return Math.round(min + (max - min) * Math.sqrt(weight / maxWeight));
}

function hashWord(word: string): number {
  let h = 0;
  for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box, gap: number) =>
  Math.abs(a.cx - b.cx) * 2 < a.w + b.w + gap &&
  Math.abs(a.cy - b.cy) * 2 < a.h + b.h + gap;

/**
 * 語をクラウド状に配置する。入りきらない語は少し縮めて1回だけ再試行し、
 * それでも無理なら落とす（正確な一覧は表で見る前提）。
 * @param measure 語とフォントサイズから描画幅・高さを返す関数
 */
export function layoutWordCloud(
  words: CloudWordInput[],
  width: number,
  height: number,
  measure: (text: string, size: number) => { w: number; h: number },
): PlacedWord[] {
  const sorted = words
    .filter((w) => w.word && w.weight > 0)
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 42);
  if (!sorted.length || width < 80 || height < 60) return [];
  const maxWeight = sorted[0].weight;
  const placed: Box[] = [];
  const out: PlacedWord[] = [];
  const cx = width / 2;
  const cy = height / 2;
  for (let i = 0; i < sorted.length; i++) {
    const { word, weight } = sorted[i];
    let size = cloudFontSize(weight, maxWeight);
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      const m = measure(word, size);
      const box = { cx: 0, cy: 0, w: m.w + 8, h: m.h + 5 };
      const start = (hashWord(word) % 628) / 100;
      for (let step = 0; step < 900; step++) {
        const angle = start + step * 0.32;
        const r = 2.1 * angle;
        // 出力と同じ整数座標で判定し、丸めによる重なりを作らない
        const x = Math.round(cx + r * Math.cos(angle) * 1.3);
        const y = Math.round(cy + r * Math.sin(angle) * 0.78);
        if (
          x - box.w / 2 < 2 ||
          x + box.w / 2 > width - 2 ||
          y - box.h / 2 < 2 ||
          y + box.h / 2 > height - 2
        )
          continue;
        box.cx = x;
        box.cy = y;
        if (placed.some((p) => overlaps(p, box, 3))) continue;
        placed.push({ ...box });
        out.push({
          word,
          x,
          y,
          size,
          color:
            i === 0 ? PALETTE[0] : PALETTE[(i + hashWord(word)) % PALETTE.length],
        });
        done = true;
        break;
      }
      size = Math.max(11, Math.round(size * 0.78));
    }
  }
  return out;
}
