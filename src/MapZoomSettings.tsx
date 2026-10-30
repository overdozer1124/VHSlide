import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { DEFAULT_ZOOM_STEPS, parseZoomSteps } from "./workspacePreferences";
export function MapZoomSettings({
  steps,
  onApply,
  embedded = false,
  onDone,
}: {
  embedded?: boolean;
  onDone?: () => void;
  steps: number[];
  onApply: (steps: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(steps.join(", "));
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || embedded) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open, embedded]);
  function apply(steps: number[]) {
    onApply(steps);
    setOpen(false);
    if (onDone) onDone();
    else trigger.current?.focus({ preventScroll: true });
  }
  return (
    <div
      className={`map-zoom-settings${embedded ? " map-zoom-settings-embedded" : ""}`}
      ref={root}
    >
      <button
        ref={trigger}
        className="icon-button"
        aria-label="マップの倍率を設定"
        title="マップの倍率を設定"
        aria-expanded={open}
        aria-controls="map-zoom-settings-panel"
        onClick={() => {
          setText(steps.join(", "));
          setError("");
          setOpen(!open);
        }}
      >
        <SlidersHorizontal size={17} />
        {embedded && <span>マップの倍率を設定</span>}
      </button>
      {open && (
        <form
          id="map-zoom-settings-panel"
          className="zoom-settings-panel"
          aria-label="マップの倍率設定"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              apply(parseZoomSteps(text));
            } catch (reason) {
              setError((reason as Error).message);
            }
          }}
        >
          <div className="zoom-settings-heading">
            <strong>拡大・縮小のステップ</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="倍率設定を閉じる"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus({ preventScroll: true });
              }}
            >
              <X size={16} />
            </button>
          </div>
          <label>
            使いたい倍率（%）
            <input
              autoFocus
              aria-label="倍率のステップ（%）"
              value={text}
              maxLength={1500}
              placeholder="30, 80, 120"
              onChange={(event) => {
                setText(event.target.value);
                setError("");
              }}
            />
          </label>
          <p>
            10〜300%を、カンマや空白で区切って入力。倍率の数がステップ数になります。
          </p>
          <p>
            小さい順に切り替わり、最小倍率の手前は「番号一覧」です。最大倍率からさらにピンチアウトすると編集画面へ移ります。
          </p>
          <div className="zoom-presets">
            {["30, 80, 120", "80, 100", "60, 100, 200, 300"].map((preset) => (
              <button
                type="button"
                key={preset}
                onClick={() => {
                  setText(preset);
                  setError("");
                }}
              >
                {preset}%
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="zoom-settings-error">
              {error}
            </p>
          )}
          <div className="zoom-settings-actions">
            <button
              type="button"
              className="quiet"
              onClick={() => {
                apply([...DEFAULT_ZOOM_STEPS]);
              }}
            >
              初期設定に戻す
            </button>
            <button className="button primary" type="submit">
              この倍率で使う
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
