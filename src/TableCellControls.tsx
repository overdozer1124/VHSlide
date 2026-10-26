import { useState } from "react";
import { cellFormatState, effectiveCellStyle } from "./cellFormatting";
import { NumberField } from "./ObjectLayout";
import type { Element } from "./model";
import { uid } from "./model";
import { changeTableAxis, type CellStyle } from "./tableData";
export type CellSelection = { id: string; keys: string[] };
export function TableCellControls({
  element: e,
  keys,
  rangeMode,
  message,
  onRangeMode,
  onChange,
}: {
  element: Element;
  keys: string[];
  rangeMode: boolean;
  message?: string;
  onRangeMode: () => void;
  onChange: (p: Partial<Element>) => void;
}) {
  const t = e.table!,
    valid = keys.filter((k) => k in t.cells),
    style = cellFormatState(e, valid),
    [row, column] = (valid[0] ?? "").split(":"),
    r = t.rows.indexOf(row),
    c = t.columns.indexOf(column);
  function format(patch: CellStyle) {
    const styles = { ...t.styles };
    for (const k of valid) styles[k] = { ...styles[k], ...patch };
    onChange({ table: { ...t, styles } });
  }
  function axis(
    axis: "rows" | "columns",
    action: "insert" | "delete",
    index: number,
  ) {
    const next = changeTableAxis(t, axis, action, index, uid);
    if (
      action === "delete" &&
      Object.keys(t.cells).some(
        (k) => !(k in next.cells) && t.cells[k].trim(),
      ) &&
      !confirm("この行・列には文字があります。削除しますか？")
    )
      return;
    onChange({ table: next });
  }
  return (
    <section className="cell-controls" aria-label="選択したセルの設定">
      <h3 className="cell-selection-status">
        {valid.length
          ? `${valid.length}セルを選択中`
          : "スライド上のセルを選んでください"}
      </h3>
      <button
        className="cell-range-toggle"
        aria-pressed={rangeMode}
        onClick={onRangeMode}
      >
        {rangeMode ? "範囲選択を終了" : "セルの範囲を選ぶ"}
      </button>
      {message && (
        <p role="alert" className="cell-message">
          {message}
        </p>
      )}
      {!!valid.length && (
        <>
          <div className="text-style-toggles">
            <button
              aria-label="セルを太字"
              aria-pressed={style.bold === null ? "mixed" : style.bold}
              onClick={() => format({ bold: style.bold !== true })}
            >
              <b>B</b> 太字{style.bold === null && <small>混在</small>}
            </button>
            <button
              aria-label="セルを斜体"
              aria-pressed={style.italic === null ? "mixed" : style.italic}
              onClick={() => format({ italic: !style.italic })}
            >
              <i>I</i> 斜体{style.italic === null && <small>混在</small>}
            </button>
          </div>
          <div className="object-number-grid">
            <CellColor
              key={`fill-${valid.join(",")}`}
              label="背景色"
              name="セルの背景色"
              value={style.fill}
              initial={effectiveCellStyle(e, valid[0]).fill}
              onChange={(fill) => format({ fill })}
            />
            <CellColor
              key={`color-${valid.join(",")}`}
              label="文字色"
              name="セルの文字色"
              value={style.color}
              initial={effectiveCellStyle(e, valid[0]).color}
              onChange={(color) => format({ color })}
            />
            <NumberField
              label="大きさ"
              ariaLabel="セルの文字の大きさ"
              min={12}
              max={72}
              value={style.fontSize}
              onCommit={(v) => format({ fontSize: v })}
            />

            <label>
              左右
              <select
                aria-label="セルの左右揃え"
                value={style.textAlign ?? "mixed"}
                onChange={(ev) =>
                  format({
                    textAlign: ev.target.value as CellStyle["textAlign"],
                  })
                }
              >
                {style.textAlign === null && (
                  <option value="mixed" disabled>
                    混在
                  </option>
                )}
                <option value="left">左</option>
                <option value="center">中央</option>
                <option value="right">右</option>
              </select>
            </label>
            <label>
              上下
              <select
                aria-label="セルの上下揃え"
                value={style.verticalAlign ?? "mixed"}
                onChange={(ev) =>
                  format({
                    verticalAlign: ev.target
                      .value as CellStyle["verticalAlign"],
                  })
                }
              >
                {style.verticalAlign === null && (
                  <option value="mixed" disabled>
                    混在
                  </option>
                )}
                <option value="top">上</option>
                <option value="middle">中央</option>
                <option value="bottom">下</option>
              </select>
            </label>
          </div>
          <button
            className="quiet"
            onClick={() => {
              const styles = { ...t.styles };
              valid.forEach((k) => delete styles[k]);
              onChange({
                table: {
                  ...t,
                  styles: Object.keys(styles).length ? styles : undefined,
                },
              });
            }}
          >
            セルの書式をリセット
          </button>
          <details className="table-position-actions">
            <summary>選択位置の行・列を操作</summary>
            <p>
              {r + 1}行目・{c + 1}列目を基準に操作します。
            </p>
            <div className="object-action-pair">
              <button
                disabled={t.rows.length >= 12}
                onClick={() => axis("rows", "insert", r)}
              >
                上に行を挿入
              </button>
              <button
                disabled={t.rows.length >= 12}
                onClick={() => axis("rows", "insert", r + 1)}
              >
                下に行を挿入
              </button>
              <button
                disabled={t.columns.length >= 12}
                onClick={() => axis("columns", "insert", c)}
              >
                左に列を挿入
              </button>
              <button
                disabled={t.columns.length >= 12}
                onClick={() => axis("columns", "insert", c + 1)}
              >
                右に列を挿入
              </button>
              <button
                className="danger-button"
                disabled={t.rows.length <= 1}
                onClick={() => axis("rows", "delete", r)}
              >
                選択位置の行を削除
              </button>
              <button
                className="danger-button"
                disabled={t.columns.length <= 1}
                onClick={() => axis("columns", "delete", c)}
              >
                選択位置の列を削除
              </button>
            </div>
            <label>
              この列の幅
              <input
                aria-label="選択列の幅"
                type="range"
                min={0.25}
                max={4}
                step={0.05}
                value={t.widths?.[column] ?? 1}
                onChange={(ev) =>
                  onChange({
                    table: {
                      ...t,
                      widths: {
                        ...t.widths,
                        [column]: Number(ev.target.value),
                      },
                    },
                  })
                }
              />
            </label>
            <label>
              この行の高さ
              <input
                aria-label="選択行の高さ"
                type="range"
                min={0.25}
                max={4}
                step={0.05}
                value={t.heights?.[row] ?? 1}
                onChange={(ev) =>
                  onChange({
                    table: {
                      ...t,
                      heights: { ...t.heights, [row]: Number(ev.target.value) },
                    },
                  })
                }
              />
            </label>
            <button
              className="quiet"
              onClick={() =>
                onChange({
                  table: { ...t, widths: undefined, heights: undefined },
                })
              }
            >
              行の高さ・列の幅を均等に戻す
            </button>
          </details>
        </>
      )}
    </section>
  );
}

function CellColor({
  label,
  name,
  value,
  initial,
  onChange,
}: {
  label: string;
  name: string;
  value: string | null;
  initial: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  if (value !== null)
    return (
      <label>
        {label}
        <input
          type="color"
          aria-label={name}
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
        />
      </label>
    );
  return (
    <div className="mixed-color-field">
      <span>{label}</span>
      <details
        onKeyDown={(ev) => {
          if (ev.key === "Escape") {
            ev.stopPropagation();
            ev.currentTarget.open = false;
          }
        }}
      >
        <summary aria-label={`${name}（混在）`}>
          <span className="mixed-color-swatch" />
          混在
        </summary>
        <div className="mixed-color-choice">
          <input
            type="color"
            aria-label={name}
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
          />
          <button type="button" onClick={() => onChange(draft)}>
            色を適用
          </button>
        </div>
      </details>
    </div>
  );
}
