import { useEffect, useState } from "react";
import { bounds, type Deck } from "./model";
import type { BatchAxis } from "./mapBatch";
export function MapBatchPanel({
  deck,
  remainingPages,
  onApply,
  onClose,
  selection,
  selectionLost,
  onRangeChange,
  onClearSelection,
  filtered,
  onClearFilter,
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
  selection?: { axis: BatchAxis; index: number; serial: number };
  selectionLost: boolean;
  onRangeChange: (range?: {
    axis: BatchAxis;
    start: number;
    count: number;
  }) => void;
  onClearSelection: () => void;
  filtered: boolean;
  onClearFilter: () => void;
}) {
  const [axis, setAxis] = useState<BatchAxis>("rows"),
    [action, setAction] = useState<"add" | "delete">("add"),
    [start, setStart] = useState(bounds(deck).rows + 1),
    [count, setCount] = useState(1),
    [error, setError] = useState(""),
    [side, setSide] = useState<"before" | "after">("before");
  useEffect(() => {
    if (!selection) return;
    setAxis(selection.axis);
    setStart(
      selection.index + 1 + (action === "add" && side === "after" ? 1 : 0),
    );
    setError("");
  }, [selection, action, side]);
  const size = bounds(deck),
    length = axis === "rows" ? size.rows : size.cols,
    cross = axis === "rows" ? size.cols : size.rows;
  const valid =
    !selectionLost &&
    Number.isInteger(start) &&
    Number.isInteger(count) &&
    count >= 1 &&
    start >= 1 &&
    (action === "add"
      ? start <= length + 1 &&
        length + count <= 100 &&
        count * cross <= remainingPages
      : start + count - 1 <= length);
  useEffect(() => {
    onRangeChange(
      selection && valid && action === "delete"
        ? { axis, start: start - 1, count }
        : undefined,
    );
  }, [selection, valid, action, axis, start, count, onRangeChange]);
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
      {filtered ? (
        <p>
          フィルタ表示中は元の行・列を選べません。
          <button
            className="quiet map-batch-clear-filter"
            onClick={onClearFilter}
          >
            フィルタを解除して選ぶ
          </button>
        </p>
      ) : (
        <p className="map-batch-hint">
          マップの行番号または列見出しをクリックして、操作する位置を選べます。
        </p>
      )}
      <div className="map-batch-fields">
        <label>
          対象
          <select
            aria-label="操作する軸"
            value={axis}
            onChange={(e) => {
              const a = e.target.value as BatchAxis;
              onClearSelection();
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
              if (!selection) setStart(a === "add" ? length + 1 : 1);
              setError("");
            }}
          >
            <option value="add">空白ページを追加</option>
            <option value="delete">まとめて削除</option>
          </select>
        </label>
        {selection && action === "add" && (
          <label>
            挿入する場所
            <select
              aria-label="選択した行・列の挿入位置"
              value={side}
              onChange={(e) => setSide(e.target.value as "before" | "after")}
            >
              <option value="before">
                選択した{selection.axis === "rows" ? "行" : "列"}の前
              </option>
              <option value="after">
                選択した{selection.axis === "rows" ? "行" : "列"}の後
              </option>
            </select>
          </label>
        )}
        <label>
          {action === "add" ? "挿入する位置" : "開始番号"}
          <input
            aria-label="一括操作の開始番号"
            type="number"
            min={1}
            max={action === "add" ? length + 1 : length}
            value={Number.isNaN(start) ? "" : start}
            onChange={(e) => {
              onClearSelection();
              setStart(e.target.valueAsNumber);
            }}
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
      {selection && (
        <p role="status">
          選択中：{selection.index + 1}
          {selection.axis === "rows" ? "行目" : "列目"}
        </p>
      )}
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
      {selectionLost && (
        <p role="alert">
          選択した行・列が変更されたため、もう一度選んでください。
        </p>
      )}
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
