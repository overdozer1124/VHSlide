import type { Deck } from "./model";
import { emptyFilter, matchesFilter } from "./mapFilter";
import type { MapFilter } from "./mapFilter";
export function MapFilterPanel({
  deck,
  value,
  onChange,
  onApply,
  onClose,
  editor,
  onEditorChange,
}: {
  deck: Deck;
  value: MapFilter;
  onChange: (filter: MapFilter) => void;
  onApply: () => void;
  onClose: () => void;
  editor: boolean;
  onEditorChange: (value: boolean) => void;
}) {
  const count = deck.slides.filter((s) => matchesFilter(s, value)).length;
  return (
    <div
      className="filter-selection-bar"
      role="region"
      aria-label="マップのフィルタ設定"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div>
        <strong>マップから選ぶ</strong>
        <span>
          行・列の番号やスライドを押して選択。もう一度押すと解除できます。
        </span>
      </div>
      <label>
        <input
          type="checkbox"
          checked={editor}
          onChange={(e) => onEditorChange(e.target.checked)}
        />
        編集画面にもフィルタを適用
      </label>
      <div className="filter-selection-actions">
        <strong aria-live="polite">{count}ページ選択中</strong>
        <button onClick={() => onChange(emptyFilter())}>選択をクリア</button>
        <button onClick={onClose}>キャンセル</button>
        <button className="button primary" disabled={!count} onClick={onApply}>
          フィルタを適用
        </button>
      </div>
    </div>
  );
}
