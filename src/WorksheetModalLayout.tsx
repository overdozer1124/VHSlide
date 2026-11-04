import { useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorksheetDefinition, WorksheetField } from "./worksheets";

type Layout = NonNullable<WorksheetDefinition["modalLayout"]>;
type Item = Layout["items"][number];
export function modalLayoutItems(sheet: WorksheetDefinition): Item[] {
  const saved = sheet.modalLayout?.items ?? [];
  let bottom = saved.reduce((n, item) => Math.max(n, item.y + item.h + 12), 0);
  return sheet.fields.map((field) => {
    const existing = saved.find((item) => item.id === field.id);
    if (existing) return existing;
    const h =
      field.inputHeight === undefined
        ? field.kind === "radar"
          ? 560
          : field.kind === "checkbox"
            ? 80
            : 130
        : Math.min(
            3000,
            Math.max(60, field.inputHeight + (field.section ? 75 : 45)),
          );
    const item = {
      id: field.id,
      x: 0,
      y: Math.min(bottom, 10000, 11000 - h),
      w: (field.widthPercent ?? 100) * 10,
      h,
    };
    bottom += item.h + 12;
    return item;
  });
}
export function WorksheetModalLayout({
  sheet,
  editing = false,
  onChange,
  renderField,
}: {
  sheet: WorksheetDefinition;
  editing?: boolean;
  onChange?: (layout: Layout) => void;
  renderField: (field: WorksheetField) => ReactNode;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState("");
  const drag = useRef<
    | {
        item: Item;
        mode: "move" | "resize";
        x: number;
        y: number;
        scale: number;
      }
    | undefined
  >(undefined);
  const items = modalLayoutItems(sheet);
  const height = Math.max(100, ...items.map((item) => item.y + item.h)) + 12;
  function change(item: Item, dx: number, dy: number, mode: "move" | "resize") {
    const next =
      mode === "move"
        ? {
            ...item,
            x: Math.max(0, Math.min(1000 - item.w, Math.round(item.x + dx))),
            y: Math.max(
              0,
              Math.min(10000, 11000 - item.h, Math.round(item.y + dy)),
            ),
          }
        : {
            ...item,
            w: Math.max(50, Math.min(1000 - item.x, Math.round(item.w + dx))),
            h: Math.max(
              60,
              Math.min(3000, 11000 - item.y, Math.round(item.h + dy)),
            ),
          };
    onChange?.({
      items: items.map((entry) => (entry.id === item.id ? next : entry)),
    });
  }
  return (
    <div
      className={`worksheet-modal-layout-wrap ${editing ? "is-editing" : ""}`}
    >
      {editing && (
        <label className="worksheet-layout-select">
          操作する項目
          <select
            aria-label="レイアウトで操作する項目"
            value={
              items.some((item) => item.id === selectedId) ? selectedId : ""
            }
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">項目を選択</option>
            {sheet.fields.map((field, index) => (
              <option key={field.id} value={field.id}>
                {index + 1}. {field.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div
        className="worksheet-modal-layout"
        ref={canvas}
        style={{ height, fontSize: sheet.fontSize }}
      >
        {items.map((item, index) => {
          const field = sheet.fields.find((f) => f.id === item.id)!;
          const start = (
            event: React.PointerEvent<HTMLButtonElement>,
            mode: "move" | "resize",
          ) => {
            event.preventDefault();
            event.stopPropagation();
            drag.current = {
              item,
              mode,
              x: event.clientX,
              y: event.clientY,
              scale:
                (canvas.current?.getBoundingClientRect().width ?? 1000) / 1000,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          };
          const move = (event: React.PointerEvent<HTMLButtonElement>) => {
            const state = drag.current;
            if (!state) return;
            change(
              state.item,
              (event.clientX - state.x) / state.scale,
              event.clientY - state.y,
              state.mode,
            );
          };
          const keys = (
            event: React.KeyboardEvent<HTMLButtonElement>,
            mode: "move" | "resize",
          ) => {
            const delta: Record<string, [number, number]> = {
              ArrowLeft: [-10, 0],
              ArrowRight: [10, 0],
              ArrowUp: [0, -10],
              ArrowDown: [0, 10],
            };
            if (!delta[event.key]) return;
            event.preventDefault();
            event.stopPropagation();
            change(item, ...delta[event.key], mode);
          };
          return (
            <div
              key={item.id}
              className="worksheet-positioned-field"
              data-field-id={item.id}
              style={{
                left: `${item.x / 10}%`,
                top: item.y,
                width: `${item.w / 10}%`,
                height: item.h,
                zIndex: editing && selectedId === item.id ? 2 : undefined,
              }}
              onPointerDownCapture={
                editing ? () => setSelectedId(item.id) : undefined
              }
            >
              {editing && (
                <div className="worksheet-layout-handle">
                  <button
                    type="button"
                    aria-label={`${index + 1}. ${field.label}を移動`}
                    onPointerDown={(event) => start(event, "move")}
                    onPointerMove={move}
                    onPointerUp={() => {
                      drag.current = undefined;
                    }}
                    onPointerCancel={() => {
                      drag.current = undefined;
                    }}
                    onKeyDown={(event) => keys(event, "move")}
                  >
                    ⋮⋮ 移動
                  </button>
                  <span>
                    {index + 1}. {field.label}
                  </span>
                </div>
              )}
              <div
                className="worksheet-positioned-content"
                inert={editing || undefined}
              >
                {renderField(field)}
              </div>
              {editing && (
                <button
                  className="worksheet-layout-resize"
                  type="button"
                  aria-label={`${index + 1}. ${field.label}の大きさを変更`}
                  title="ドラッグまたは矢印キーでサイズを変更"
                  onPointerDown={(event) => start(event, "resize")}
                  onPointerMove={move}
                  onPointerUp={() => {
                    drag.current = undefined;
                  }}
                  onPointerCancel={() => {
                    drag.current = undefined;
                  }}
                  onKeyDown={(event) => keys(event, "resize")}
                >
                  ↘
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
