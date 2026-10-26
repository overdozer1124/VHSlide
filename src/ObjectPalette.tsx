import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Shapes, MoveUpRight } from "lucide-react";
import { shapeCatalog } from "./shapeCatalog";
import type { Element, Shape } from "./model";
import { ShapeGraphic, LineGraphic } from "./ObjectGraphics";
function Palette({
  label,
  text,
  icon,
  disabled,
  children,
}: {
  label: string;
  text: string;
  icon: ReactNode;
  disabled: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({
      left: 8,
      top: 8,
      width: 340,
      maxHeight: 420,
    });
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    id = useId();
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open || disabled) return;
    const place = () => {
      const r = trigger.current!.getBoundingClientRect(),
        vp = window.visualViewport,
        w = vp?.width ?? innerWidth,
        h = vp?.height ?? innerHeight,
        x = vp?.offsetLeft ?? 0,
        y = vp?.offsetTop ?? 0;
      const width = Math.min(340, w - 16),
        maxHeight = Math.min(640, h - 24),
        height = Math.min(panel.current!.scrollHeight, maxHeight);
      setPosition({
        left: Math.max(x + 8, Math.min(r.left, x + w - width - 8)),
        top:
          r.bottom + 8 + height <= y + h
            ? r.bottom + 8
            : Math.max(y + 8, r.top - height - 8),
        width,
        maxHeight,
      });
    };
    place();
    panel.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    const scroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open, disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !panel.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        className="tool-button"
        aria-label={label}
        disabled={disabled}
        aria-expanded={open && !disabled}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {icon}
        {text}
      </button>
      {open &&
        !disabled &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label={label}
            className="object-palette"
            style={position}
          >
            <div className="object-palette-heading">
              <strong>{text}を選ぶ</strong>
              <button className="quiet" onClick={close}>
                閉じる
              </button>
            </div>
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}
export function ObjectPalette({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (
    type: "text" | "shape" | "line",
    shape?: Shape,
    lineKind?: Element["lineKind"],
    endArrow?: Element["endArrow"],
    startArrow?: Element["startArrow"],
  ) => void;
}) {
  const [category, setCategory] = useState("基本");
  return (
    <>
      <Palette
        label="図形を追加"
        text="図形"
        icon={<Shapes size={20} />}
        disabled={disabled}
      >
        {(close) => (
          <>
            <div
              className="palette-categories"
              role="group"
              aria-label="図形の分類"
            >
              {["基本", "矢印", "吹き出し", "フロー"].map((c) => (
                <button
                  key={c}
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="palette-grid">
              {shapeCatalog
                .filter((s) => s.category === category)
                .map((s) => (
                  <button
                    key={s.id}
                    aria-label={`${s.name}を追加`}
                    onClick={() => {
                      onAdd("shape", s.id);
                      close();
                    }}
                  >
                    <div className="palette-preview">
                      <ShapeGraphic
                        element={{
                          id: s.id,
                          type: "shape",
                          shape: s.id,
                          x: 0,
                          y: 0,
                          w: 100,
                          h: 100,
                          fill: "#e5f0dc",
                          stroke: "#315d4e",
                        }}
                      />
                    </div>
                    <span>{s.name}</span>
                  </button>
                ))}
            </div>
            <p className="palette-hint">クリックで文字入力 · 枠で移動</p>
          </>
        )}
      </Palette>
      <Palette
        label="線を追加"
        text="線"
        icon={<MoveUpRight size={20} />}
        disabled={disabled}
      >
        {(close) => (
          <div className="palette-grid line-palette">
            {(
              [
                ["直線", "straight", "none", "none"],
                ["矢印", "straight", "triangle", "none"],
                ["両矢印", "straight", "triangle", "triangle"],
                ["折れ線", "elbow", "triangle", "none"],
                ["曲線", "curve", "triangle", "none"],
              ] as const
            ).map(([name, lineKind, endArrow, startArrow]) => (
              <button
                key={name}
                aria-label={`${name}を追加`}
                onClick={() => {
                  onAdd("line", undefined, lineKind, endArrow, startArrow);
                  close();
                }}
              >
                <div className="palette-preview">
                  <LineGraphic
                    element={{
                      id: name,
                      type: "line",
                      x: 0,
                      y: 0,
                      w: 100,
                      h: 100,
                      stroke: "#315d4e",
                      strokeWidth: 2,
                      lineKind,
                      startArrow,
                      endArrow,
                      lineStart: { x: 8, y: lineKind === "straight" ? 50 : 80 },
                      lineEnd: { x: 92, y: lineKind === "straight" ? 50 : 20 },
                    }}
                  />
                </div>
                <span>{name}</span>
              </button>
            ))}
          </div>
        )}
      </Palette>
    </>
  );
}
