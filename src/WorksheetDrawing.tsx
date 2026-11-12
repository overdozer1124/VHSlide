import { useEffect, useRef, useState } from "react";
import type {
  ClipboardEvent,
  DragEvent,
  FocusEvent,
  PointerEvent,
} from "react";

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
  aspect,
}: {
  label: string;
  value: string;
  disabled: boolean;
  preview: boolean;
  onChange: (value: string) => void;
  // When the field is placed in a frame on a slide, the canvas adopts the
  // frame's aspect so a pasted image fills the frame instead of being
  // composed into a fixed 16:9 picture that only fills part of it.
  aspect?: number;
}) {
  const ratio =
    aspect && Number.isFinite(aspect) && aspect > 0
      ? Math.min(4, Math.max(0.2, aspect))
      : 16 / 9;
  const cw = ratio >= 16 / 9 ? W : Math.round(H * ratio);
  const ch = ratio >= 16 / 9 ? Math.round(W / ratio) : H;
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const pendingFile = useRef<File | null>(null);
  const lastEmitted = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const loadSeq = useRef(0);
  // While the file dialog is up (and just after it closes) a stray focus
  // change or click must not end edit mode before the chosen file has been
  // handed over and decoded; guardUntil / loadingFile hold it open.
  const guardUntil = useRef(0);
  const loadingFile = useRef(false);
  const drawing = useRef(false);
  const history = useRef<{ data: string; hasContent: boolean }[]>([]);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [hasContent, setHasContent] = useState(!!value);
  const [ready, setReady] = useState(false);
  // Until the learner clicks into the field, only the pasted/drawn image is
  // shown: no toolbar, heading note or hint text competes with it for space.
  const [active, setActive] = useState(false);
  function paintBlank() {
    const node = canvas.current;
    if (!node) return;
    const ctx = node.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);
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
        canvas.current.getContext("2d")!.drawImage(image, 0, 0, cw, ch);
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
      return;
    }
    // In view mode the saved value is rendered as an <img>; the canvas only
    // needs restoring once the learner enters edit mode.
    if (!active) return;
    if (value !== lastEmitted.current) restore(value);
    return () => {
      generation.current++;
    };
  }, [value, disabled, preview, active, cw, ch]);
  useEffect(() => {
    if (!active) return;
    canvas.current?.focus({ preventScroll: true });
    if (pendingFile.current) {
      const file = pendingFile.current;
      pendingFile.current = null;
      load(file);
    }
    // Leaving the field (click elsewhere) returns it to the image-only view.
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (loadingFile.current || Date.now() < guardUntil.current) return;
      if (
        container.current &&
        event.target instanceof Node &&
        !container.current.contains(event.target)
      )
        setActive(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
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
      x: Math.max(0, Math.min(cw, ((event.clientX - r.left) * cw) / r.width)),
      y: Math.max(0, Math.min(ch, ((event.clientY - r.top) * ch) / r.height)),
    };
  }
  function load(file: File) {
    if (
      !/^image\/(png|jpeg|webp|gif)$/.test(file.type) ||
      file.size > 10_000_000
    ) {
      setError("PNG・JPEG・WebP・GIFの10MB以下の画像を選んでください。");
      setNotice("");
      return;
    }
    setNotice(`「${file.name}」を読み込み中…`);
    loadingFile.current = true;
    const url = URL.createObjectURL(file);
    const image = new Image();
    const seq = ++loadSeq.current;
    // A pending restore of the previous value must not repaint over the
    // image being loaded.
    ++generation.current;
    setReady(false);
    image.onload = () => {
      URL.revokeObjectURL(url);
      // A newer load superseded this one; let it win.
      if (seq !== loadSeq.current) return;
      loadingFile.current = false;
      setNotice("");
      // Compose the picture offscreen first, then emit it even if the edit
      // view closed while the image was decoding (the file dialog and the
      // focus changes around it can close the view), so an added image is
      // never silently lost.
      const composed = document.createElement("canvas");
      composed.width = cw;
      composed.height = ch;
      const off = composed.getContext("2d")!;
      off.fillStyle = "#ffffff";
      off.fillRect(0, 0, cw, ch);
      const fit = Math.min(cw / image.width, ch / image.height);
      const width = image.width * fit,
        height = image.height * fit;
      off.drawImage(image, (cw - width) / 2, (ch - height) / 2, width, height);
      const node = canvas.current;
      if (node) {
        remember();
        const ctx = node.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(composed, 0, 0);
      }
      setReady(true);
      try {
        const data = encode(composed);
        // Only when the visible canvas shows this same picture may the
        // restore effect treat the value as already painted; otherwise
        // re-entering edit mode restores it from the value.
        if (node) lastEmitted.current = data;
        setHasContent(true);
        setError("");
        onChange(data);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      if (seq === loadSeq.current) {
        loadingFile.current = false;
        setNotice("");
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
      if (active) load(file);
      else {
        pendingFile.current = file;
        setActive(true);
      }
    }
  }
  function blur(event: FocusEvent<HTMLDivElement>) {
    if (loadingFile.current || Date.now() < guardUntil.current) return;
    if (!event.currentTarget.contains(event.relatedTarget as Node | null))
      setActive(false);
  }
  function drop(event: DragEvent<HTMLElement>) {
    const file = Array.from(event.dataTransfer.files).find((f) =>
      f.type.startsWith("image/"),
    );
    if (file) {
      event.preventDefault();
      if (active) load(file);
      else {
        pendingFile.current = file;
        setActive(true);
      }
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
  if (!active)
    return (
      <>
        <button
          type="button"
          className="worksheet-drawing-view"
          aria-label={`${label}の画像・手描きを編集`}
          onClick={() => setActive(true)}
          onPaste={paste}
          onDragOver={(event) => event.preventDefault()}
          onDrop={drop}
        >
          {value ? (
            <img src={value} alt={`${label}の画像・手描き回答`} />
          ) : (
            <span>クリックして画像を貼り付け・手描き</span>
          )}
        </button>
        {notice && <p>{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </>
    );
  return (
    <div
      className="worksheet-drawing"
      ref={container}
      onPaste={paste}
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
      onBlur={blur}
      onKeyDown={(event) => {
        if (event.key === "Escape") setActive(false);
      }}
      aria-busy={!ready}
    >
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
                canvas.current.getContext("2d")!.drawImage(image, 0, 0, cw, ch);
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
        <label
          className="worksheet-drawing-upload"
          onClick={() => {
            // The file dialog is about to open; hold edit mode open until
            // the chosen file has been handed over (see guardUntil).
            guardUntil.current = Date.now() + 5000;
          }}
        >
          画像を追加
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label={`${label}に画像を追加`}
            onClick={() => {
              guardUntil.current = Date.now() + 5000;
            }}
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
        <button
          type="button"
          className="worksheet-drawing-done"
          onClick={() => setActive(false)}
        >
          完了
        </button>
      </div>
      {notice && <p className="worksheet-drawing-notice">{notice}</p>}
      <canvas
        ref={canvas}
        width={cw}
        height={ch}
        style={{ aspectRatio: `${cw} / ${ch}` }}
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
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
