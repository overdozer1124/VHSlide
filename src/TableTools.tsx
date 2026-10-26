import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Table2 } from "lucide-react";
import type { Element } from "./model";
import { uid } from "./model";
import { MAX_TABLE_AXIS, resizeTable } from "./tableData";
export function TableInsert({
  disabled,
  onInsert,
}: {
  disabled: boolean;
  onInsert: (rows: number, columns: number) => void;
}) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState(3),
    [columns, setColumns] = useState(3);
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLElement>(null),
    id = useId();
  const [position, setPosition] = useState({
    left: 8,
    top: 8,
    width: 290,
    maxHeight: 500,
  });
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useLayoutEffect(() => {
    if (!open || disabled) return;
    const place = () => {
      if (!trigger.current || !panel.current) return;
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth,
        height = viewport?.height ?? window.innerHeight;
      const x = viewport?.offsetLeft ?? 0,
        y = viewport?.offsetTop ?? 0;
      const anchor = trigger.current.getBoundingClientRect();
      const panelWidth = Math.min(290, width - 16),
        panelHeight = Math.min(panel.current.scrollHeight, height - 16);
      const below = anchor.bottom + 8;
      const top =
        below + panelHeight <= y + height - 8
          ? below
          : Math.max(y + 8, anchor.top - panelHeight - 8);
      const next = {
        left: Math.max(
          x + 8,
          Math.min(anchor.left, x + width - panelWidth - 8),
        ),
        top,
        width: panelWidth,
        maxHeight: height - 16,
      };
      setPosition((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    };
    const scroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) place();
    };
    place();
    panel.current
      ?.querySelector<HTMLInputElement>("input")
      ?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open, disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !panel.current?.contains(target) &&
        !trigger.current?.contains(target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  const valid = [rows, columns].every(
    (v) => Number.isInteger(v) && v >= 1 && v <= MAX_TABLE_AXIS,
  );
  return (
    <div className="table-insert">
      <button
        ref={trigger}
        className="tool-button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        aria-expanded={open}
        aria-label="表を追加"
        onClick={() => setOpen(!open)}
      >
        <Table2 size={20} />表
      </button>
      {open &&
        !disabled &&
        createPortal(
          <section
            ref={panel}
            id={id}
            role="dialog"
            className="table-insert-popover"
            aria-label="追加する表の大きさ"
            style={position}
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                !event.currentTarget.contains(event.relatedTarget) &&
                !trigger.current?.contains(event.relatedTarget)
              )
                close();
            }}
          >
            <strong>表を追加</strong>
            <label>
              行数
              <input
                aria-label="表の行数"
                type="number"
                min={1}
                max={MAX_TABLE_AXIS}
                value={rows || ""}
                onChange={(e) => setRows(Number(e.target.value))}
              />
            </label>
            <label>
              列数
              <input
                aria-label="表の列数"
                type="number"
                min={1}
                max={MAX_TABLE_AXIS}
                value={columns || ""}
                onChange={(e) => setColumns(Number(e.target.value))}
              />
            </label>
            <p>1〜12行・1〜12列。セルをクリックして入力できます。</p>
            <button
              className="button primary"
              disabled={!valid || disabled}
              onClick={() => {
                onInsert(rows, columns);
                close(true);
              }}
            >
              この大きさで表を追加
            </button>
            <button className="quiet" onClick={() => close(true)}>
              閉じる
            </button>
          </section>,
          document.body,
        )}
    </div>
  );
}
export function TableControls({
  element: e,
  onChange,
}: {
  element: Element;
  onChange: (patch: Partial<Element>) => void;
}) {
  const t = e.table!;
  function resize(axis: "rows" | "columns", delta: 1 | -1) {
    const next = resizeTable(t, axis, delta, uid);
    if (
      delta < 0 &&
      Object.keys(t.cells).some(
        (key) => !(key in next.cells) && t.cells[key].trim(),
      ) &&
      !window.confirm(
        `最後の${axis === "rows" ? "行" : "列"}には文字があります。削除しますか？`,
      )
    )
      return;
    onChange({ table: next });
  }
  return (
    <section className="table-controls" aria-label="表の設定">
      {(["rows", "columns"] as const).map((axis) => (
        <div className="table-axis-controls" key={axis}>
          <button
            disabled={t[axis].length >= MAX_TABLE_AXIS}
            onClick={() => resize(axis, 1)}
          >
            {axis === "rows" ? "行" : "列"}を追加
          </button>
        </div>
      ))}
      <details className="table-delete-actions">
        <summary>行・列を削除</summary>
        <div className="object-action-pair">
          {(["rows", "columns"] as const).map((axis) => (
            <button
              key={axis}
              className="danger-button"
              disabled={t[axis].length <= 1}
              onClick={() => resize(axis, -1)}
            >
              最後の{axis === "rows" ? "行" : "列"}を削除
            </button>
          ))}
        </div>
      </details>
      <label className="table-header-option">
        <input
          type="checkbox"
          checked={t.header}
          onChange={(event) =>
            onChange({ table: { ...t, header: event.target.checked } })
          }
        />
        先頭行を見出しにする
      </label>
      <label>
        文字の大きさ
        <input
          aria-label="表の文字の大きさ"
          type="number"
          min={12}
          max={72}
          value={e.fontSize}
          onChange={(event) => {
            const v = Number(event.target.value);
            if (v >= 12 && v <= 72) onChange({ fontSize: v });
          }}
        />
      </label>
      <label>
        文字の位置
        <select
          aria-label="表の文字の位置"
          value={e.textAlign ?? "left"}
          onChange={(event) =>
            onChange({ textAlign: event.target.value as Element["textAlign"] })
          }
        >
          <option value="left">左揃え</option>
          <option value="center">中央揃え</option>
          <option value="right">右揃え</option>
        </select>
      </label>
      {(
        [
          ["color", "表の文字色"],
          ["fill", "表の背景色"],
          ["stroke", "表の枠線色"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            type="color"
            aria-label={label}
            value={e[key]}
            onChange={(event) => onChange({ [key]: event.target.value })}
          />
        </label>
      ))}
    </section>
  );
}
