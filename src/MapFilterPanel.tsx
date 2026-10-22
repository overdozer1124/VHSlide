import { useState } from "react";
import type { Deck } from "./model";
import { emptyFilter, filterNumbers, matchesFilter } from "./mapFilter";
import type { MapFilter } from "./mapFilter";
export function MapFilterPanel({
  deck,
  value,
  onChange,
  onApply,
  onClose,
}: {
  deck: Deck;
  value: MapFilter;
  onChange: (filter: MapFilter) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(value.rows.map((n) => n + 1).join(","));
  const [columns, setColumns] = useState(
    value.columns.map((n) => n + 1).join(","),
  );
  const [error, setError] = useState("");
  function numbers(r: string, c: string) {
    setRows(r);
    setColumns(c);
    try {
      onChange({ ...value, rows: filterNumbers(r), columns: filterNumbers(c) });
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }
  const count = deck.slides.filter((s) => matchesFilter(s, value)).length;
  return (
    <div
      className="map-filter-panel"
      role="region"
      aria-label="マップのフィルタ設定"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="filter-heading">
        <strong>表示するページを選ぶ</strong>
        <button onClick={onClose}>閉じる</button>
      </div>
      <p>
        個別・行・列のいずれかに当てはまるページを表示します。元の配置や番号は変わりません。
      </p>
      <div className="filter-number-inputs">
        <label>
          段（行）の番号
          <input
            aria-label="フィルタする行"
            placeholder="例：1,3-5"
            value={rows}
            onChange={(e) => numbers(e.target.value, columns)}
          />
        </label>
        <label>
          話題（列）の番号
          <input
            aria-label="フィルタする列"
            placeholder="例：2,4"
            value={columns}
            onChange={(e) => numbers(rows, e.target.value)}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div
        className="filter-page-list"
        role="group"
        aria-label="個別に表示するページ"
      >
        {[...deck.slides]
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={value.ids.includes(s.id)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    ids: e.target.checked
                      ? [...value.ids, s.id]
                      : value.ids.filter((id) => id !== s.id),
                  })
                }
              />
              {s.y + 1}.{s.x + 1} {s.title}
            </label>
          ))}
      </div>
      <div className="filter-actions">
        <span>{count}ページを表示</span>
        <button
          onClick={() => {
            onChange(emptyFilter());
            setRows("");
            setColumns("");
            setError("");
          }}
        >
          選択をクリア
        </button>
        <button
          className="button primary"
          disabled={!!error || count === 0}
          onClick={onApply}
        >
          フィルタを適用
        </button>
      </div>
    </div>
  );
}
