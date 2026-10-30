import {
  MousePointer2,
  Pencil,
  Minus,
  RectangleHorizontal,
  Circle,
  PaintBucket,
  Eraser,
} from "lucide-react";
import type { Element } from "./model";
import type { InkStroke } from "./InkObject";
import { inkShapeKind } from "./inkStyle";
export function InkControls({
  element: e,
  selectedIndex,
  onSelect,
  onChange,
}: {
  element: Element;
  selectedIndex?: number;
  onSelect: (index?: number) => void;
  onChange: (patch: Partial<Element>) => void;
}) {
  const tool = e.drawingTool ?? "pen";
  const selected =
    tool === "select" && selectedIndex !== undefined
      ? e.drawing?.[selectedIndex]
      : undefined;
  const kind = selected ? inkShapeKind(selected) : undefined;
  const drawingShape = ["line", "rectangle", "ellipse"].includes(tool);
  const shapeMode = drawingShape || !!kind;
  const disabled = tool === "eraser" || (tool === "select" && !kind);
  const fill = selected
    ? (selected.fill ?? "none")
    : (e.inkShapeFill ?? "none");
  const dash = selected
    ? (selected.dash ?? "solid")
    : (e.inkShapeDash ?? "solid");
  const width = selected?.width ?? e.strokeWidth ?? 5;
  const color = selected?.color ?? e.stroke ?? "#173d38";
  function style(patch: Partial<InkStroke>) {
    if (selected && kind)
      onChange({
        drawing: e.drawing!.map((s, i) =>
          i === selectedIndex ? { ...s, shape: kind, ...patch } : s,
        ),
      });
    else
      onChange({
        ...(patch.color === undefined ? {} : { stroke: patch.color }),
        ...(patch.width === undefined ? {} : { strokeWidth: patch.width }),
        ...(patch.fill === undefined ? {} : { inkShapeFill: patch.fill }),
        ...(patch.dash === undefined ? {} : { inkShapeDash: patch.dash }),
      });
  }
  return (
    <section className="ink-controls">
      <h3>手描き</h3>
      <div className="ink-tools" role="group" aria-label="描画ツール">
        {(
          [
            {
              tool: "select",
              label: "図形を選択",
              caption: "選択",
              Icon: MousePointer2,
            },
            { tool: "pen", label: "ペン", caption: "ペン", Icon: Pencil },
            { tool: "line", label: "直線", caption: "直線", Icon: Minus },
            {
              tool: "rectangle",
              label: "四角形",
              caption: "四角形",
              Icon: RectangleHorizontal,
            },
            { tool: "ellipse", label: "楕円", caption: "楕円", Icon: Circle },
            {
              tool: "fill",
              label: "塗りつぶし",
              caption: "塗る",
              Icon: PaintBucket,
            },
            {
              tool: "eraser",
              label: "消しゴム",
              caption: "消しゴム",
              Icon: Eraser,
            },
          ] as const
        ).map(({ tool: t, label, caption, Icon }) => (
          <button
            key={t}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={tool === t}
            onClick={() => {
              onSelect();
              onChange({ drawingTool: t });
            }}
          >
            <Icon size={22} aria-hidden="true" />
            <span>{caption}</span>
          </button>
        ))}
      </div>
      <p className="ink-tool-help">
        {tool === "select"
          ? "図形をクリックして選ぶと、線や塗りを変更できます。"
          : tool === "eraser"
            ? "消したいところをなぞります。線も塗りも消せます。"
            : tool === "fill"
              ? "囲んだ部分をクリック。線が開いていると外側まで塗られます。"
              : tool === "line"
                ? "始点から終点へドラッグ。Shiftで方向を45度刻みにそろえます。"
                : drawingShape
                  ? "対角へドラッグ。Shiftで正方形・正円になります。"
                  : "枠内をドラッグして描きます。選択枠でサイズ変更、Alt＋枠で移動できます。"}
      </p>
      {shapeMode && (
        <p className="ink-style-target" role="status">
          {selected ? "選んだ図形の設定" : "これから描く図形の設定"}
        </p>
      )}
      <label>
        {shapeMode ? "線の色" : "描画の色"}
        <input
          type="color"
          disabled={disabled}
          value={color}
          onChange={(ev) => style({ color: ev.target.value })}
        />
      </label>
      <label>
        {tool === "eraser"
          ? "消しゴムの大きさ"
          : shapeMode
            ? "線の太さ"
            : "ペンの太さ"}
        <input
          type="range"
          min="1"
          max={tool === "eraser" ? 100 : 30}
          disabled={tool === "fill" || (tool === "select" && !kind)}
          value={tool === "eraser" ? (e.eraserWidth ?? 30) : width}
          onChange={(ev) =>
            tool === "eraser"
              ? onChange({ eraserWidth: Number(ev.target.value) })
              : style({ width: Number(ev.target.value) })
          }
        />
      </label>
      {shapeMode && (
        <>
          <div className="ink-dash-tools" role="group" aria-label="線の種類">
            {(
              [
                { value: "solid", label: "実線" },
                { value: "dash", label: "破線" },
                { value: "dot", label: "点線" },
              ] as const
            ).map(({ value, label }) => (
              <button
                type="button"
                key={value}
                aria-label={label}
                aria-pressed={dash === value}
                onClick={() => style({ dash: value })}
              >
                <svg width="36" height="12" aria-hidden="true">
                  <line
                    x1="2"
                    x2="34"
                    y1="6"
                    y2="6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={
                      value === "dash"
                        ? "7 5"
                        : value === "dot"
                          ? ".01 5"
                          : undefined
                    }
                  />
                </svg>
                <span>{label}</span>
              </button>
            ))}
          </div>
          {(kind ?? tool) !== "line" && (
            <div className="ink-shape-fill">
              <label>
                <input
                  type="checkbox"
                  checked={fill !== "none"}
                  onChange={(ev) =>
                    style({ fill: ev.target.checked ? "#e5f0dc" : "none" })
                  }
                />
                図形を塗りつぶす
              </label>
              <label>
                図形の塗り色
                <input
                  type="color"
                  disabled={fill === "none"}
                  value={fill === "none" ? "#e5f0dc" : fill}
                  onChange={(ev) => style({ fill: ev.target.value })}
                />
              </label>
            </div>
          )}
        </>
      )}
      <button
        disabled={!e.drawing?.length}
        onClick={() => {
          onSelect();
          onChange({ drawing: e.drawing!.slice(0, -1) });
        }}
      >
        最後の描画を消す
      </button>
      <button
        disabled={
          !e.drawing?.some(
            (s) => s.fillContours || (s.fill && s.fill !== "none"),
          )
        }
        onClick={() => {
          onSelect();
          onChange({
            drawing: e
              .drawing!.filter((s) => !s.fillContours)
              .map((s) => (s.fill ? { ...s, fill: "none" } : s)),
          });
        }}
      >
        塗りつぶしを消す
      </button>
    </section>
  );
}
