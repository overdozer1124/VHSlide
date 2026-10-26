import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Trash2,
  RotateCw,
  RotateCcw,
  FlipHorizontal2,
  FlipVertical2,
} from "lucide-react";
import type { Element } from "./model";
import type { Arrange } from "./objectEditing";
import { arrangementUnits } from "./structuredEditing";
import { elementBounds, resizeElement, canDistribute } from "./objectEditing";
export function NumberField({
  label,
  ariaLabel,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  ariaLabel?: string;
  value: number | null;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(
      value === null ? "" : String(Math.round(value * 10) / 10),
    ),
    focus = useRef(false),
    cancel = useRef(false),
    dirty = useRef(false);
  useEffect(() => {
    if (!focus.current)
      setDraft(value === null ? "" : String(Math.round(value * 10) / 10));
  }, [value]);
  return (
    <label>
      {label}
      <input
        aria-label={ariaLabel ?? label}
        type="number"
        min={min}
        max={max}
        step="any"
        value={draft}
        placeholder={value === null ? "混在" : undefined}
        onFocus={() => {
          focus.current = true;
          cancel.current = false;
          dirty.current = false;
        }}
        onChange={(e) => {
          dirty.current = true;
          setDraft(e.target.value);
        }}
        onBlur={() => {
          focus.current = false;
          const v = Number(draft);
          if (
            dirty.current &&
            !cancel.current &&
            draft !== "" &&
            Number.isFinite(v)
          ) {
            const committed = Math.max(min, Math.min(max, v));
            setDraft(String(Math.round(committed * 10) / 10));
            onCommit(committed);
          } else setDraft(value === null ? "" : String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            cancel.current = true;
            setDraft(value === null ? "" : String(value));
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
export function ObjectLayout({
  elements,
  allElements = elements,
  showActions = true,
  onArrange,
  onChange,
  onDuplicate,
  onDelete,
}: {
  elements: Element[];
  allElements?: Element[];
  showActions?: boolean;
  onArrange: (action: Arrange) => void;
  onChange: (p: Partial<Element>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const e = elements[0],
    single = elements.length === 1,
    units = arrangementUnits(
      allElements,
      elements.map((e) => e.id),
    ).map((unit) => ({ ...unit[0], ...elementBounds(unit) }));
  return (
    <section className="object-layout-controls" aria-label="オブジェクトの配置">
      {showActions && (
        <div className="object-quick-actions">
          <button onClick={onDuplicate}>
            <Copy size={16} />
            複製
          </button>
          <button className="danger-button" onClick={onDelete}>
            <Trash2 size={16} />
            選んだものを削除
          </button>
        </div>
      )}
      <h3>
        {units.length === 1 ? "スライドにそろえる" : "選んだものをそろえる"}
      </h3>
      <div className="arrange-buttons">
        {(
          [
            ["left", "左"],
            ["center", "中央"],
            ["right", "右"],
            ["top", "上"],
            ["middle", "まん中"],
            ["bottom", "下"],
          ] as const
        ).map(([action, label]) => (
          <button key={action} onClick={() => onArrange(action)}>
            {label}
          </button>
        ))}
      </div>
      {!single && (
        <div className="object-action-pair">
          <button
            disabled={!canDistribute(units, "horizontal")}
            onClick={() => onArrange("horizontal")}
          >
            横に等間隔
          </button>
          <button
            disabled={!canDistribute(units, "vertical")}
            onClick={() => onArrange("vertical")}
          >
            縦に等間隔
          </button>
        </div>
      )}
      {!single && (
        <p className="inspector-note">
          グループを1つと数えて3つ以上選び、両端の間に収まるときに等間隔にできます。重なる場合は先に両端を広げてください。
        </p>
      )}
      <h3>重なり順</h3>
      <div className="object-action-pair">
        {(
          [
            ["forward", "1つ前へ"],
            ["backward", "1つ後ろへ"],
            ["front", "最前面へ"],
            ["back", "最背面へ"],
          ] as const
        ).map(([action, label]) => (
          <button key={action} onClick={() => onArrange(action)}>
            {label}
          </button>
        ))}
      </div>
      <details className="object-transform-details">
        <summary>サイズ・向き</summary>
        <div className="object-action-pair">
          <button onClick={() => onArrange("rotateLeft")}>
            <RotateCcw size={16} />
            左へ90度
          </button>
          <button onClick={() => onArrange("rotateRight")}>
            <RotateCw size={16} />
            右へ90度
          </button>
          <button onClick={() => onArrange("flipX")}>
            <FlipHorizontal2 size={16} />
            左右反転
          </button>
          <button onClick={() => onArrange("flipY")}>
            <FlipVertical2 size={16} />
            上下反転
          </button>
        </div>
        <p className="inspector-note">
          回転してはみ出す場合は、スライド内に収まる大きさに調整します。
        </p>
        {single && (
          <>
            <label className="object-check">
              <input
                type="checkbox"
                checked={!!e.aspectLocked}
                onChange={(ev) => onChange({ aspectLocked: ev.target.checked })}
              />
              縦横比を固定
            </label>
            <div className="object-number-grid">
              <NumberField
                label="横の位置"
                value={e.x}
                min={0}
                max={960 - e.w}
                onCommit={(x) => onChange({ x })}
              />
              <NumberField
                label="縦の位置"
                value={e.y}
                min={0}
                max={540 - e.h}
                onCommit={(y) => onChange({ y })}
              />
              <NumberField
                label="幅"
                value={e.w}
                min={20}
                max={960 - e.x}
                onCommit={(w) => onChange(resizeElement(e, w, e.h))}
              />
              <NumberField
                label="高さ"
                value={e.h}
                min={20}
                max={540 - e.y}
                onCommit={(h) => onChange(resizeElement(e, e.w, h))}
              />
            </div>
            <NumberField
              label="不透明度（%）"
              value={(e.opacity ?? 1) * 100}
              min={0}
              max={100}
              onCommit={(v) => onChange({ opacity: v / 100 })}
            />
          </>
        )}
      </details>
    </section>
  );
}
export function StrokeControls({
  element: e,
  onChange,
}: {
  element: Element;
  onChange: (patch: Partial<Element>) => void;
}) {
  const fill = useRef(e.fill !== "none" ? e.fill : "#b8d394");
  if (e.fill && e.fill !== "none") fill.current = e.fill;
  return (
    <section
      className="object-stroke-controls"
      aria-label={e.type === "line" ? "線の見た目" : "図形の見た目"}
    >
      {e.type === "shape" && (
        <>
          <label>
            塗りの色
            <input
              type="color"
              aria-label="図形の塗り色"
              value={e.fill === "none" ? fill.current : e.fill}
              onChange={(ev) => onChange({ fill: ev.target.value })}
            />
          </label>
          <label className="object-check">
            <input
              type="checkbox"
              checked={e.fill === "none"}
              onChange={(ev) =>
                onChange({ fill: ev.target.checked ? "none" : fill.current })
              }
            />
            塗りなし
          </label>
        </>
      )}
      <label>
        {e.type === "line" ? "線の色" : "枠線の色"}
        <input
          type="color"
          aria-label={e.type === "line" ? "線の色" : "図形の枠線色"}
          value={e.stroke}
          onChange={(ev) => onChange({ stroke: ev.target.value })}
        />
      </label>
      <NumberField
        label="線の太さ"
        value={e.strokeWidth ?? 2}
        min={0}
        max={20}
        onCommit={(strokeWidth) => onChange({ strokeWidth })}
      />
      <label>
        線の種類
        <select
          aria-label="線の種類"
          value={e.strokeDash ?? "solid"}
          onChange={(ev) =>
            onChange({ strokeDash: ev.target.value as Element["strokeDash"] })
          }
        >
          <option value="solid">実線</option>
          <option value="dash">破線</option>
          <option value="dot">点線</option>
        </select>
      </label>
      {e.type === "line" && (
        <>
          <p className="inspector-note">
            線の両端の丸をドラッグして向きを変えます。
          </p>
          <label>
            線の曲がり方
            <select
              aria-label="線の曲がり方"
              value={e.lineKind ?? "straight"}
              onChange={(ev) =>
                onChange({ lineKind: ev.target.value as Element["lineKind"] })
              }
            >
              <option value="straight">直線</option>
              <option value="elbow">折れ線</option>
              <option value="curve">曲線</option>
            </select>
          </label>
          {(["startArrow", "endArrow"] as const).map((key, i) => (
            <label key={key}>
              {i === 0 ? "始点" : "終点"}
              <select
                aria-label={i === 0 ? "始点の形" : "終点の形"}
                value={e[key] ?? "none"}
                onChange={(ev) => onChange({ [key]: ev.target.value })}
              >
                <option value="none">なし</option>
                <option value="triangle">矢印</option>
                <option value="circle">丸</option>
              </select>
            </label>
          ))}
        </>
      )}
    </section>
  );
}
