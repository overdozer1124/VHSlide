import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, PointerEvent } from "react";

const MAX_DATA = 120000;
const W = 960,
  H = 540;

/** Keep individual private answer payloads below the worksheet API limit. */
function encode(canvas: HTMLCanvasElement): string {
  let current = canvas;
  for (let step = 0; step < 6; step++) {
    for (const quality of [0.72, 0.55, 0.4, 0.3]) {
      const data = current.toDataURL("image/jpeg", quality);
      if (data.length <= MAX_DATA) return data;
    }
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(240, Math.round(current.width * 0.75));
    smaller.height = Math.max(135, Math.round(current.height * 0.75));
    smaller
      .getContext("2d")!
      .drawImage(current, 0, 0, smaller.width, smaller.height);
    current = smaller;
  }
  throw new Error("画像を保存できる大きさに縮小できませんでした。");
}

export function WorksheetDrawing({
  label,
  value,
  disabled,
  preview,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  preview: boolean;
  onChange: (value: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const lastEmitted = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const drawing = useRef(false);
  const history = useRef<{ data: string; hasContent: boolean }[]>([]);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [error, setError] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [hasContent, setHasContent] = useState(!!value);
  const [ready, setReady] = useState(false);
  function paintBlank() {
    const node = canvas.current;
    if (!node) return;
    const ctx = node.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
  }
  function restore(data: string) {
    const version = ++generation.current;
    paintBlank();
    if (!data) {
      setReady(true);
      return;
    }
    setReady(false);
    const image = new Image();
    image.onload = () => {
      if (version === generation.current && canvas.current) {
        canvas.current.getContext("2d")!.drawImage(image, 0, 0, W, H);
        setReady(true);
      }
    };
    image.onerror = () => {
      if (version === generation.current)
        setError(
          "保存済みの画像を読み込めませんでした。再読み込みしてください。",
        );
    };
    image.src = data;
  }
  useEffect(() => {
    setHasContent(!!value);
    if (disabled || preview) {
      lastEmitted.current = undefined;
      setReady(false);
    } else if (value !== lastEmitted.current) restore(value);
    return () => {
      generation.current++;
    };
  }, [value, disabled, preview]);
  function save() {
    if (!canvas.current) return;
    try {
      const data = encode(canvas.current);
      lastEmitted.current = data;
      setHasContent(true);
      setError("");
      onChange(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function remember() {
    if (!canvas.current) return;
    history.current.push({
      data: canvas.current.toDataURL("image/jpeg", 0.6),
      hasContent,
    });
    if (history.current.length > 10) history.current.shift();
    setCanUndo(true);
  }
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const r = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(W, ((event.clientX - r.left) * W) / r.width)),
      y: Math.max(0, Math.min(H, ((event.clientY - r.top) * H) / r.height)),
    };
  }
  function load(file: File) {
    if (
      !/^image\/(png|jpeg|webp|gif)$/.test(file.type) ||
      file.size > 10_000_000
    ) {
      setError("PNG・JPEG・WebP・GIFの10MB以下の画像を選んでください。");
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    const version = ++generation.current;
    setReady(false);
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (version !== generation.current || !canvas.current) return;
      remember();
      paintBlank();
      const ratio = Math.min(W / image.width, H / image.height);
      const width = image.width * ratio,
        height = image.height * ratio;
      canvas.current
        .getContext("2d")!
        .drawImage(image, (W - width) / 2, (H - height) / 2, width, height);
      setReady(true);
      save();
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      if (version === generation.current) {
        setReady(true);
        setError("画像を読み込めませんでした。");
      }
    };
    image.src = url;
  }
  function paste(event: ClipboardEvent<HTMLElement>) {
    const file = Array.from(event.clipboardData.items)
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();
    if (file) {
      event.preventDefault();
      load(file);
    }
  }
  if (disabled || preview)
    return value ? (
      <img
        className="worksheet-drawing-image"
        src={value}
        alt={`${label}の画像・手描き回答`}
      />
    ) : (
      <div className="worksheet-drawing-placeholder">画像・手描きの回答欄</div>
    );
  return (
    <div className="worksheet-drawing" onPaste={paste} aria-busy={!ready}>
      <div className="worksheet-drawing-toolbar">
        <button
          type="button"
          aria-pressed={tool === "pen"}
          onClick={() => setTool("pen")}
        >
          ペン
        </button>
        <button
          type="button"
          aria-pressed={tool === "eraser"}
          onClick={() => setTool("eraser")}
        >
          消しゴム
        </button>
        <button
          type="button"
          disabled={!canUndo || !ready}
          onClick={() => {
            const previous = history.current.pop();
            setCanUndo(history.current.length > 0);
            if (previous) {
              const version = ++generation.current;
              setReady(false);
              const image = new Image();
              image.onload = () => {
                if (!canvas.current || version !== generation.current) return;
                canvas.current.getContext("2d")!.drawImage(image, 0, 0, W, H);
                setReady(true);
                if (previous.hasContent) save();
                else {
                  lastEmitted.current = "";
                  setHasContent(false);
                  onChange("");
                }
              };
              image.src = previous.data;
            }
          }}
        >
          戻す
        </button>
        <label className="worksheet-drawing-upload">
          画像を追加
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label={`${label}に画像を追加`}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) load(file);
              e.currentTarget.value = "";
            }}
          />
        </label>
        <button
          type="button"
          disabled={!hasContent || !ready}
          onClick={() => {
            remember();
            ++generation.current;
            paintBlank();
            setHasContent(false);
            lastEmitted.current = "";
            onChange("");
          }}
        >
          消去
        </button>
      </div>
      <canvas
        ref={canvas}
        width={W}
        height={H}
        tabIndex={0}
        aria-label={`${label}の手描き欄`}
        onPointerDown={(e) => {
          if (!ready || e.button !== 0 || drawing.current) return;
          e.preventDefault();
          e.stopPropagation();
          ++generation.current;
          remember();
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext("2d")!,
            p = point(e);
          ctx.strokeStyle = tool === "pen" ? "#182b27" : "#ffffff";
          ctx.fillStyle = ctx.strokeStyle;
          ctx.lineWidth = tool === "pen" ? 4 : 24;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          e.preventDefault();
          e.stopPropagation();
          const p = point(e),
            ctx = e.currentTarget.getContext("2d")!;
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={(e) => {
          if (!drawing.current) return;
          e.preventDefault();
          e.stopPropagation();
          drawing.current = false;
          save();
        }}
        onPointerCancel={() => {
          if (drawing.current) {
            drawing.current = false;
            save();
          }
        }}
      />
      <small>
        画像を貼り付け、ペンや消しゴムで書き込めます。入力は自動保存されます。
      </small>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
