import { useState } from "react";
import { bounds, type Deck } from "./model";
import type { BatchAxis } from "./mapBatch";
export function MapBatchPanel({
  deck,
  remainingPages,
  onApply,
  onClose,
}: {
  deck: Deck;
  remainingPages: number;
  onApply: (
    axis: BatchAxis,
    action: "add" | "delete",
    start: number,
    count: number,
  ) => boolean;
  onClose: () => void;
}) {
  const [axis, setAxis] = useState<BatchAxis>("rows"),
    [action, setAction] = useState<"add" | "delete">("add"),
    [start, setStart] = useState(bounds(deck).rows + 1),
    [count, setCount] = useState(1),
    [error, setError] = useState("");
  const size = bounds(deck),
    length = axis === "rows" ? size.rows : size.cols,
    cross = axis === "rows" ? size.cols : size.rows;
  const valid =
    Number.isInteger(start) &&
    Number.isInteger(count) &&
    count >= 1 &&
    start >= 1 &&
    (action === "add"
      ? start <= length + 1 &&
        length + count <= 100 &&
        count * cross <= remainingPages
      : start + count - 1 <= length);
  const removed = deck.slides.filter((s) => {
    const n = axis === "rows" ? s.y : s.x;
    return n >= start - 1 && n < start - 1 + count;
  }).length;
  return (
    <section className="map-batch-panel" aria-label="行・列の一括操作">
      <p>
        このシート全体の行・列を操作します（フィルタ外のページも対象）。追加できるのはあと
        {remainingPages}ページです。
      </p>
      <div className="map-batch-fields">
        <label>
          対象
          <select
            aria-label="操作する軸"
            value={axis}
            onChange={(e) => {
              const a = e.target.value as BatchAxis;
              setAxis(a);
              setStart(
                action === "add"
                  ? (a === "rows" ? size.rows : size.cols) + 1
                  : 1,
              );
              setError("");
            }}
          >
            <option value="rows">行（たて）</option>
            <option value="columns">列（よこ）</option>
          </select>
        </label>
        <label>
          操作
          <select
            aria-label="一括操作"
            value={action}
            onChange={(e) => {
              const a = e.target.value as "add" | "delete";
              setAction(a);
              setStart(a === "add" ? length + 1 : 1);
              setError("");
            }}
          >
            <option value="add">空白ページを追加</option>
            <option value="delete">まとめて削除</option>
          </select>
        </label>
        <label>
          {action === "add" ? "挿入する位置" : "開始番号"}
          <input
            aria-label="一括操作の開始番号"
            type="number"
            min={1}
            max={action === "add" ? length + 1 : length}
            value={Number.isNaN(start) ? "" : start}
            onChange={(e) => setStart(e.target.valueAsNumber)}
          />
        </label>
        <label>
          {axis === "rows" ? "行数" : "列数"}
          <input
            aria-label="一括操作の数"
            type="number"
            min={1}
            max={100}
            value={Number.isNaN(count) ? "" : count}
            onChange={(e) => setCount(e.target.valueAsNumber)}
          />
        </label>
      </div>
      <p>
        {valid
          ? action === "add"
            ? `${start}番目に${count}${axis === "rows" ? "行" : "列"}・${count * cross}ページを追加します。後ろの行・列は移動します。`
            : `${start}〜${start + count - 1}${axis === "rows" ? "行" : "列"}の${removed}ページを削除し、後ろの行・列を詰めます。`
          : "範囲を確認してください。縦横100マス、作品全体1000ページまでです。"}
        {action === "delete"
          ? " 先頭が空く場合は空白ページを1枚残します。もとに戻すこともできます。"
          : ""}
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        className={`button ${action === "delete" ? "outline danger" : "primary"}`}
        disabled={!valid}
        onClick={() => {
          try {
            if (onApply(axis, action, start - 1, count)) onClose();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {action === "add" ? "まとめて追加" : "この範囲を削除"}
      </button>
      <button className="quiet" onClick={onClose}>
        閉じる
      </button>
    </section>
  );
}
