import { NumberField } from "./ObjectLayout";
import type { TextAttributes } from "./richText";
export type TextController = {
  id: string;
  defaultSize?: number;
  length: number;
  formats: Record<string, unknown>;
  format: (name: keyof TextAttributes, value: unknown) => void;
  clear: () => void;
};
export function TextSelectionControls({
  control: c,
}: {
  control: TextController;
}) {
  return (
    <section
      className="text-selection-controls"
      aria-label="選択した文字の書式"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
      }}
    >
      <h3>{c.length ? `選択した${c.length}文字` : "これから入力する文字"}</h3>
      <div className="text-style-toggles">
        {(
          [
            ["bold", "太字", "B"],
            ["italic", "斜体", "I"],
            ["underline", "下線", "U"],
            ["strike", "取り消し線", "S"],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            aria-label={`選択文字を${label}`}
            aria-pressed={c.formats[key] === true}
            onClick={() => c.format(key, c.formats[key] !== true)}
          >
            <span
              style={{
                fontWeight: key === "bold" ? 700 : undefined,
                fontStyle: key === "italic" ? "italic" : undefined,
                textDecoration:
                  key === "underline"
                    ? "underline"
                    : key === "strike"
                      ? "line-through"
                      : undefined,
              }}
            >
              {icon}
            </span>
          </button>
        ))}
      </div>
      <div className="object-number-grid">
        <label>
          書体
          <select
            aria-label="選択文字の書体"
            value={String(c.formats.font ?? "sans")}
            onChange={(e) => c.format("font", e.target.value)}
          >
            <option value="sans">読みやすい文字</option>
            <option value="serif">明朝体</option>
            <option value="mono">等幅</option>
          </select>
        </label>
        <NumberField
          label="大きさ"
          ariaLabel="選択文字の大きさ"
          min={12}
          max={120}
          value={
            typeof c.formats.size === "string"
              ? Number.parseInt(c.formats.size)
              : (c.defaultSize ?? 24)
          }
          onCommit={(v) => c.format("size", `${Math.round(v)}px`)}
        />

        <label>
          文字色
          <input
            aria-label="選択文字の色"
            type="color"
            value={
              typeof c.formats.color === "string" ? c.formats.color : "#173d38"
            }
            onChange={(e) => c.format("color", e.target.value)}
          />
        </label>
        <label>
          背景色
          <input
            aria-label="選択文字の背景色"
            type="color"
            value={
              typeof c.formats.background === "string"
                ? c.formats.background
                : "#ffff99"
            }
            onChange={(e) => c.format("background", e.target.value)}
          />
        </label>
      </div>
      <details>
        <summary>段落の設定</summary>
        <label>
          段落の揃え
          <select
            aria-label="選択段落の揃え"
            value={typeof c.formats.align === "string" ? c.formats.align : ""}
            onChange={(e) => c.format("align", e.target.value || false)}
          >
            <option value="">左揃え</option>
            <option value="center">中央揃え</option>
            <option value="right">右揃え</option>
            <option value="justify">両端揃え</option>
          </select>
        </label>
        <label>
          リスト
          <select
            aria-label="選択段落のリスト"
            value={typeof c.formats.list === "string" ? c.formats.list : ""}
            onChange={(e) => c.format("list", e.target.value || false)}
          >
            <option value="">なし</option>
            <option value="bullet">箇条書き</option>
            <option value="ordered">番号付き</option>
          </select>
        </label>
        <label>
          行間
          <select
            aria-label="選択段落の行間"
            value={
              typeof c.formats.lineheight === "string"
                ? c.formats.lineheight
                : "1.25"
            }
            onChange={(e) => c.format("lineheight", e.target.value)}
          >
            {["1", "1.25", "1.5", "2"].map((v) => (
              <option key={v} value={v}>
                {v}倍
              </option>
            ))}
          </select>
        </label>
      </details>
      <button className="quiet" disabled={!c.length} onClick={c.clear}>
        選択文字の書式をリセット
      </button>
    </section>
  );
}
