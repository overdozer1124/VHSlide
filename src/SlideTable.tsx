import { useTableFit } from "./useTableFit";
import { effectiveCellStyle } from "./cellFormatting";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { uid } from "./model";
import { cellRectangle, pasteTable } from "./tableData";
import type { Element } from "./model";
import { cellKey, MAX_CELL_TEXT } from "./tableData";
export function SlideTable({
  element: e,
  editable = false,
  onChange,
  onSelect,
  onMoveStart,
  selectedCells = [],
  rangeMode = false,
  onSelectCells,
}: {
  element: Element;
  editable?: boolean;
  onChange?: (element: Element) => void;
  onSelect?: () => void;
  onMoveStart?: (event: React.PointerEvent) => void;
  selectedCells?: string[];
  rangeMode?: boolean;
  onSelectCells?: (keys: string[]) => void;
}) {
  const t = e.table!;
  const fit = useTableFit(e.id, e, editable);
  const clipped = new Set(fit.issues.map((issue) => issue.cellKey));
  const anchor = useRef<string | undefined>(undefined),
    pointerFocus = useRef<string | undefined>(undefined);
  const [message, setMessage] = useState("");
  const rowTotal = t.rows.reduce((n, id) => n + (t.heights?.[id] ?? 1), 0),
    colTotal = t.columns.reduce((n, id) => n + (t.widths?.[id] ?? 1), 0);
  useEffect(() => {
    if (rangeMode) anchor.current = undefined;
  }, [rangeMode]);
  function select(key: string, extend = false) {
    const keys =
      extend && anchor.current ? cellRectangle(t, anchor.current, key) : [key];
    if (!extend || !anchor.current) anchor.current = key;
    onSelectCells?.(keys);
  }
  return (
    <table
      ref={fit.ref}
      className="slide-table"
      aria-label="スライド内の表"
      data-cell-range={rangeMode}
      style={{
        fontSize: e.fontSize,
        color: e.color,
        background: e.fill,
        borderColor: e.stroke,
        textAlign: e.textAlign ?? "left",
      }}
      onPointerDown={
        editable
          ? (event) => {
              const target = event.target as HTMLElement;
              if (!target.closest("textarea")) {
                const cell = target.closest<HTMLTableCellElement>("td,th");
                const field =
                  cell?.querySelector<HTMLTextAreaElement>("textarea");
                const rect = cell?.getBoundingClientRect();
                const gridEdge =
                  rect &&
                  Math.min(
                    event.clientX - rect.left,
                    rect.right - event.clientX,
                    event.clientY - rect.top,
                    rect.bottom - event.clientY,
                  ) <= 2;
                if (!field || gridEdge) {
                  onMoveStart?.(event);
                  return;
                }
                event.stopPropagation();
                event.preventDefault();
                pointerFocus.current = field.dataset.cell!;
                select(field.dataset.cell!, event.shiftKey || rangeMode);
                onSelect?.();
                if (!rangeMode) field.focus({ preventScroll: true });
              } else {
                event.stopPropagation();
                const field = (
                  event.target as HTMLElement
                ).closest<HTMLTextAreaElement>("textarea")!;
                const key = field.dataset.cell!;
                pointerFocus.current = key;
                select(key, event.shiftKey || rangeMode);
                if (rangeMode) event.preventDefault();
                onSelect?.();
              }
            }
          : undefined
      }
    >
      {message && (
        <caption className="table-paste-error" role="alert">
          {message}
        </caption>
      )}
      <colgroup>
        {t.columns.map((id) => (
          <col
            key={id}
            style={{ width: `${(100 * (t.widths?.[id] ?? 1)) / colTotal}%` }}
          />
        ))}
      </colgroup>
      <tbody>
        {t.rows.map((row, r) => (
          <tr
            key={row}
            style={{ height: `${(100 * (t.heights?.[row] ?? 1)) / rowTotal}%` }}
          >
            {t.columns.map((column, c) => {
              const key = cellKey(row, column),
                value = t.cells[key] ?? "",
                style = effectiveCellStyle(e, key);
              const cellStyle: React.CSSProperties = {
                borderColor: e.stroke,
                background: style.fill,
                color: style.color,
                fontSize: style.fontSize,
                fontWeight: style.bold ? 700 : 400,
                fontStyle: style.italic ? "italic" : undefined,
                textAlign: style.textAlign,
                verticalAlign: style.verticalAlign ?? "top",
              };
              const content = editable ? (
                <AutoCellText
                  aria-label={`表 ${r + 1}行 ${c + 1}列`}
                  data-cell={key}
                  formatKey={`${style.fontSize ?? e.fontSize}:${style.bold}:${style.italic}`}
                  value={value}
                  aria-selected={selectedCells.includes(key)}
                  onPaste={(event) => {
                    const input = event.clipboardData.getData("text/plain");
                    if (!input.includes("\t") && !input.includes("\n")) return;
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                      const result = pasteTable(
                        t,
                        selectedCells.length > 1 ? selectedCells[0] : key,
                        input,
                        uid,
                      );
                      onChange?.({ ...e, table: result.table });
                      onSelectCells?.(result.keys);
                      setMessage("");
                    } catch (error) {
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : "貼り付けできませんでした。",
                      );
                    }
                  }}
                  maxLength={MAX_CELL_TEXT}
                  spellCheck
                  onChange={(event) =>
                    onChange?.({
                      ...e,
                      table: {
                        ...t,
                        cells: { ...t.cells, [key]: event.target.value },
                      },
                    })
                  }
                  onFocus={() => {
                    onSelect?.();
                    if (pointerFocus.current === key) {
                      pointerFocus.current = undefined;
                      return;
                    }
                    select(key);
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                    if (event.key === "Tab") {
                      const fields = Array.from(
                        event.currentTarget
                          .closest("table")!
                          .querySelectorAll("textarea"),
                      );
                      const next =
                        fields[
                          fields.indexOf(event.currentTarget) +
                            (event.shiftKey ? -1 : 1)
                        ];
                      if (next) {
                        event.preventDefault();
                        next.focus();
                      }
                    }
                  }}
                />
              ) : (
                <span>{value}</span>
              );
              return t.header && r === 0 ? (
                <th
                  scope="col"
                  key={column}
                  style={cellStyle}
                  className={
                    editable && selectedCells.includes(key)
                      ? "selected-cell"
                      : ""
                  }
                  data-cell={key}
                >
                  <div
                    className="table-cell-content"
                    style={{
                      justifyContent:
                        style.verticalAlign === "middle"
                          ? "center"
                          : style.verticalAlign === "bottom"
                            ? "flex-end"
                            : "flex-start",
                    }}
                  >
                    {content}
                  </div>
                  {editable && clipped.has(key) && (
                    <span
                      className="cell-overflow-flag"
                      title={`${r + 1}行${c + 1}列：全文が表示されません`}
                      aria-label={`${r + 1}行${c + 1}列：全文が表示されません`}
                    >
                      !
                    </span>
                  )}
                </th>
              ) : (
                <td
                  key={column}
                  style={cellStyle}
                  className={
                    editable && selectedCells.includes(key)
                      ? "selected-cell"
                      : ""
                  }
                  data-cell={key}
                >
                  <div
                    className="table-cell-content"
                    style={{
                      justifyContent:
                        style.verticalAlign === "middle"
                          ? "center"
                          : style.verticalAlign === "bottom"
                            ? "flex-end"
                            : "flex-start",
                    }}
                  >
                    {content}
                  </div>
                  {editable && clipped.has(key) && (
                    <span
                      className="cell-overflow-flag"
                      title={`${r + 1}行${c + 1}列：全文が表示されません`}
                      aria-label={`${r + 1}行${c + 1}列：全文が表示されません`}
                    >
                      !
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AutoCellText({
  formatKey,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { formatKey: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      node.style.height = "0px";
      node.style.height = `${Math.min(node.parentElement!.clientHeight, node.scrollHeight)}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node.parentElement!);
    return () => observer.disconnect();
  }, [props.value, formatKey]);
  return <textarea {...props} ref={ref} />;
}
