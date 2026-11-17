import { useEffect, useId, useRef, useState } from "react";
import type {
  ClipboardEvent,
  DragEvent,
  FocusEvent,
  PointerEvent,
} from "react";
import {
  DRAWING_OBJECT_MAX_COUNT,
  DRAWING_OBJECT_SRC_MAX,
  DRAWING_OBJECT_TOTAL_MAX,
  DRAWING_STROKES_MAX,
  DRAWING_TEXT_MAX,
  DRAWING_TEXT_SIZE_DEFAULT,
  DRAWING_TEXT_SIZE_MAX,
  DRAWING_TEXT_SIZE_MIN,
  drawingFlatSrc,
  drawingValueToScene,
  emptyDrawingScene,
  isEmptyDrawingScene,
  isTextObject,
  serializeDrawingScene,
  type DrawingObject,
  type DrawingScene,
} from "./drawingScene";

const MAX_DATA = 120000;
const W = 960,
  H = 540;

/** JPEG has no alpha channel: composite onto white so untouched
 * (transparent) areas save as white, never black. */
function flatten(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return flat;
}

/** Keep individual private answer payloads below the worksheet API limit. */
function encode(canvas: HTMLCanvasElement): string {
  let current = flatten(canvas);
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

/** Encode a canvas as one object's image, small enough to store. */
function encodeObjectSrc(source: HTMLCanvasElement): string {
  let current = flatten(source);
  for (let step = 0; step < 8; step++) {
    for (const quality of [0.82, 0.68, 0.55, 0.4]) {
      const data = current.toDataURL("image/jpeg", quality);
      if (data.length <= 60_000 || step >= 4) {
        if (data.length <= DRAWING_OBJECT_SRC_MAX) return data;
      }
    }
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(120, Math.round(current.width * 0.8));
    smaller.height = Math.max(68, Math.round(current.height * 0.8));
    smaller
      .getContext("2d")!
      .drawImage(current, 0, 0, smaller.width, smaller.height);
    current = smaller;
  }
  return current.toDataURL("image/jpeg", 0.4);
}

/** Turn a loaded image into a storable object image (keeps transparency
 * as PNG when it stays small, otherwise flattens to JPEG). */
function imageToObjectSrc(image: HTMLImageElement): string {
  const scale = Math.min(1, 560 / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0, w, h);
  let hasAlpha = false;
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4 * 211) {
      if (data[i] < 250) {
        hasAlpha = true;
        break;
      }
    }
  } catch {
    hasAlpha = false;
  }
  if (hasAlpha) {
    const png = canvas.toDataURL("image/png");
    if (png.length <= 60_000) return png;
  }
  return encodeObjectSrc(canvas);
}

let objectCounter = 0;
function newObjectId(): string {
  objectCounter += 1;
  return `o${Date.now().toString(36)}${objectCounter}`;
}

/** Draw a text object onto the base canvas: wrapped to its frame and
 * clipped by it, in the same ink colour as the pen. */
function drawTextObject(
  ctx: CanvasRenderingContext2D,
  o: DrawingObject,
  cw: number,
  ch: number,
) {
  const fontPx = (o.size ?? DRAWING_TEXT_SIZE_DEFAULT) * ch;
  const x = o.x * cw,
    y = o.y * ch,
    w = o.w * cw,
    h = o.h * ch;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.font = `${fontPx}px sans-serif`;
  ctx.fillStyle = "#182b27";
  ctx.textBaseline = "top";
  const lineHeight = fontPx * 1.25;
  const maxLines = Math.max(1, Math.ceil(h / lineHeight) + 1);
  const lines: string[] = [];
  for (const raw of (o.text ?? "").split("\n")) {
    let line = "";
    for (const char of raw) {
      if (line && ctx.measureText(line + char).width > w) {
        lines.push(line);
        line = char;
      } else line += char;
    }
    lines.push(line);
    if (lines.length >= maxLines) break;
  }
  lines
    .slice(0, maxLines)
    .forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  ctx.restore();
}

type Mode = "select" | "pen" | "eraser";

export function WorksheetDrawing({
  label,
  value,
  disabled,
  preview,
  onChange,
  aspect,
  placeholder,
  allowText = false,
}: {
  label: string;
  value: string;
  disabled: boolean;
  preview: boolean;
  onChange: (value: string) => void;
  // Guidance shown inside the empty field until an image is added.
  placeholder?: string;
  // When the field is placed in a frame on a slide, the canvas adopts the
  // frame's aspect so a pasted image fills the frame instead of being
  // composed into a fixed 16:9 picture that only fills part of it.
  aspect?: number;
  // Free fields additionally let the learner place editable text boxes
  // on the canvas, next to images and hand drawing.
  allowText?: boolean;
}) {
  const ratio =
    aspect && Number.isFinite(aspect) && aspect > 0
      ? Math.min(4, Math.max(0.2, aspect))
      : 16 / 9;
  const cw = ratio >= 16 / 9 ? W : Math.round(H * ratio);
  const ch = ratio >= 16 / 9 ? Math.round(W / ratio) : H;
  const baseCanvas = useRef<HTMLCanvasElement>(null);
  const strokeCanvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const pendingFile = useRef<File | null>(null);
  const lastEmitted = useRef<string | undefined>(undefined);
  const baseGen = useRef(0);
  const strokeGen = useRef(0);
  // While the file dialog is up (and just after it closes) a stray focus
  // change or click must not end edit mode before the chosen file has been
  // handed over and decoded; guardUntil / loadingFile hold it open.
  const guardUntil = useRef(0);
  const fileInputId = useId();
  const loadingFile = useRef(false);
  const drawingStroke = useRef(false);
  const strokesEmpty = useRef(true);
  const history = useRef<string[]>([]);
  const imageCache = useRef(new Map<string, HTMLImageElement>());
  const sceneRef = useRef<DrawingScene>(emptyDrawingScene());
  const dragRef = useRef<
    | {
        kind: "move" | "resize";
        id: string;
        handle?: string;
        startX: number;
        startY: number;
        orig: DrawingObject;
        historyPushed: boolean;
      }
    | undefined
  >(undefined);
  const [scene, setSceneState] = useState<DrawingScene>(emptyDrawingScene());
  const [mode, setMode] = useState<Mode>("pen");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [ready, setReady] = useState(false);
  // Until the learner clicks into the field, only the placed/drawn image
  // is shown: no toolbar, heading note or hint text competes with it.
  const [active, setActive] = useState(false);
  // Crop mode: a rectangle over the flattened picture; applying it turns
  // the whole field into a single picture again.
  const [cropping, setCropping] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const editingTextRef = useRef<string | null>(null);
  function setEditingText(id: string | null) {
    editingTextRef.current = id;
    setEditingTextId(id);
  }
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageH, setStageH] = useState(0);
  const [rect, setRect] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const cropOnOpen = useRef(false);
  const cropDrag = useRef<
    | {
        mode: string;
        startX: number;
        startY: number;
        rect: { x: number; y: number; w: number; h: number };
      }
    | undefined
  >(undefined);
  const hasContent = !isEmptyDrawingScene(scene);
  const selected =
    scene.objects.find((o) => o.id === selectedId) ?? null;
  const editingObject =
    editingTextId != null
      ? (scene.objects.find((o) => o.id === editingTextId) ?? null)
      : null;

  function setScene(next: DrawingScene) {
    sceneRef.current = next;
    setSceneState(next);
  }

  function decodeImage(src: string): Promise<HTMLImageElement> {
    const cached = imageCache.current.get(src);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        imageCache.current.set(src, image);
        resolve(image);
      };
      image.onerror = reject;
      image.src = src;
    });
  }

  async function paintBase(target: DrawingScene) {
    const version = ++baseGen.current;
    const node = baseCanvas.current;
    if (!node) return;
    const images = await Promise.all(
      target.objects.map((o) =>
        isTextObject(o) ? null : decodeImage(o.src).catch(() => null),
      ),
    );
    if (version !== baseGen.current || !baseCanvas.current) return;
    const ctx = baseCanvas.current.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);
    target.objects.forEach((object, i) => {
      if (isTextObject(object)) {
        drawTextObject(ctx, object, cw, ch);
        return;
      }
      const image = images[i];
      if (image)
        ctx.drawImage(
          image,
          object.x * cw,
          object.y * ch,
          object.w * cw,
          object.h * ch,
        );
    });
  }

  function paintStrokes(target: DrawingScene) {
    const version = ++strokeGen.current;
    const node = strokeCanvas.current;
    if (!node) return;
    const ctx = node.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);
    strokesEmpty.current = !target.strokes;
    if (!target.strokes) return;
    void decodeImage(target.strokes)
      .then((image) => {
        if (version !== strokeGen.current || !strokeCanvas.current) return;
        strokeCanvas.current
          .getContext("2d")!
          .drawImage(image, 0, 0, cw, ch);
      })
      .catch(() => undefined);
  }

  async function paintAll(target: DrawingScene) {
    await paintBase(target);
    paintStrokes(target);
  }

  function composeFlatCanvas(): HTMLCanvasElement {
    const off = document.createElement("canvas");
    off.width = cw;
    off.height = ch;
    const ctx = off.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);
    if (baseCanvas.current) ctx.drawImage(baseCanvas.current, 0, 0);
    if (strokeCanvas.current) ctx.drawImage(strokeCanvas.current, 0, 0);
    return off;
  }

  /** Store the scene: recompose the flat preview and hand it over. */
  async function emit(target: DrawingScene) {
    await paintBase(target);
    try {
      const flat = isEmptyDrawingScene(target)
        ? ""
        : encode(composeFlatCanvas());
      const json = serializeDrawingScene(target, flat);
      lastEmitted.current = json;
      setError("");
      onChange(json);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function pushHistory() {
    history.current.push(JSON.stringify(sceneRef.current));
    if (history.current.length > 10) history.current.shift();
    setCanUndo(true);
  }

  async function initFromValue(next: string) {
    const initial = drawingValueToScene(next);
    history.current = [];
    setCanUndo(false);
    setSelectedId(null);
    setEditingText(null);
    setScene(initial);
    setMode(initial.objects.length > 0 ? "select" : "pen");
    setReady(false);
    await paintAll(initial);
    setReady(true);
    if (pendingFile.current) {
      const file = pendingFile.current;
      pendingFile.current = null;
      void load(file);
    }
  }

  useEffect(() => {
    if (disabled || preview) {
      lastEmitted.current = undefined;
      setReady(false);
      return;
    }
    // In view mode the saved value is rendered as an <img>; the canvases
    // only exist (and only need the scene) once the learner edits. They
    // are unmounted when edit mode closes, so the "already emitted"
    // marker must not survive into the next mount.
    if (!active) {
      lastEmitted.current = undefined;
      return;
    }
    if (value !== lastEmitted.current) void initFromValue(value);
    return () => {
      baseGen.current++;
      strokeGen.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, disabled, preview, active]);

  // The canvases are sized by the frame aspect; repaint from the scene
  // when it changes mid-edit (their bitmaps reset with the size).
  useEffect(() => {
    if (active) void paintAll(sceneRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cw, ch]);

  // The text-editing overlay sizes its font from the stage's real height.
  useEffect(() => {
    if (!active) return;
    const measure = () => setStageH(stageRef.current?.clientHeight ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active, cw, ch]);

  useEffect(() => {
    if (active && ready && cropOnOpen.current && hasContent) {
      cropOnOpen.current = false;
      setRect({ x: 0, y: 0, w: 1, h: 1 });
      setCropping(true);
    }
  }, [active, ready, hasContent]);

  useEffect(() => {
    if (!active) return;
    strokeCanvas.current?.focus({ preventScroll: true });
    // Leaving the field (click elsewhere) returns it to the image-only view.
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (loadingFile.current || Date.now() < guardUntil.current) return;
      if (
        container.current &&
        event.target instanceof Node &&
        !container.current.contains(event.target)
      ) {
        finishTextEdit();
        setCropping(false);
        setActive(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [active]);

  function captureStrokes(): string {
    const node = strokeCanvas.current;
    if (!node || strokesEmpty.current) return "";
    let current: HTMLCanvasElement = node;
    let data = current.toDataURL("image/png");
    for (let step = 0; step < 4 && data.length > DRAWING_STROKES_MAX; step++) {
      const smaller = document.createElement("canvas");
      smaller.width = Math.max(240, Math.round(current.width * 0.75));
      smaller.height = Math.max(135, Math.round(current.height * 0.75));
      smaller
        .getContext("2d")!
        .drawImage(current, 0, 0, smaller.width, smaller.height);
      current = smaller;
      data = current.toDataURL("image/png");
    }
    return data;
  }

  async function load(file: File) {
    if (
      !/^image\/(png|jpeg|webp|gif)$/.test(file.type) ||
      file.size > 10_000_000
    ) {
      setError("PNG・JPEG・WebP・GIFの10MB以下の画像を選んでください。");
      setNotice("");
      return;
    }
    if (
      sceneRef.current.objects.filter((o) => !isTextObject(o)).length >=
        DRAWING_OBJECT_MAX_COUNT ||
      sceneRef.current.objects.length >= DRAWING_OBJECT_TOTAL_MAX
    ) {
      setError(`画像は${DRAWING_OBJECT_MAX_COUNT}枚までです。`);
      return;
    }
    setNotice(`「${file.name}」を読み込み中…`);
    loadingFile.current = true;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      loadingFile.current = false;
      setNotice("");
      try {
        const src = imageToObjectSrc(image);
        const maxW = cw * 0.72;
        const maxH = ch * 0.72;
        const scale = Math.min(maxW / image.width, maxH / image.height);
        const w = (image.width * scale) / cw;
        const h = (image.height * scale) / ch;
        const cascade = (sceneRef.current.objects.length % 4) * 0.035;
        const object: DrawingObject = {
          id: newObjectId(),
          src,
          x: Math.min(Math.max((1 - w) / 2 + cascade, 0), 1 - w),
          y: Math.min(Math.max((1 - h) / 2 + cascade, 0), 1 - h),
          w,
          h,
        };
        pushHistory();
        const next: DrawingScene = {
          objects: [...sceneRef.current.objects, object],
          strokes: sceneRef.current.strokes,
        };
        setScene(next);
        setSelectedId(object.id);
        setMode("select");
        setError("");
        void emit(next);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      loadingFile.current = false;
      setNotice("");
      setError("画像を読み込めませんでした。");
    };
    image.src = url;
  }

  function paste(event: ClipboardEvent<HTMLElement>) {
    const file = Array.from(event.clipboardData.items)
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();
    if (file) {
      event.preventDefault();
      if (active) void load(file);
      else {
        pendingFile.current = file;
        setActive(true);
      }
    }
  }

  function blur(event: FocusEvent<HTMLDivElement>) {
    if (loadingFile.current || Date.now() < guardUntil.current) return;
    const next = event.relatedTarget as Node | null;
    // Focus lost to nowhere — e.g. a toolbar button that had focus
    // became disabled (undo right after drawing) — is not the learner
    // leaving the field; keep the editor open.
    if (!next) return;
    if (!event.currentTarget.contains(next)) setActive(false);
  }

  function drop(event: DragEvent<HTMLElement>) {
    const file = Array.from(event.dataTransfer.files).find((f) =>
      f.type.startsWith("image/"),
    );
    if (file) {
      event.preventDefault();
      if (active) void load(file);
      else {
        pendingFile.current = file;
        setActive(true);
      }
    }
  }

  function cropPoint(event: PointerEvent<HTMLDivElement>) {
    const r = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
    };
  }

  function applyCrop() {
    if (rect.w >= 0.999 && rect.h >= 0.999) {
      setCropping(false);
      return;
    }
    pushHistory();
    const flat = composeFlatCanvas();
    const cropped = document.createElement("canvas");
    cropped.width = cw;
    cropped.height = ch;
    const ctx = cropped.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(
      flat,
      rect.x * cw,
      rect.y * ch,
      rect.w * cw,
      rect.h * ch,
      0,
      0,
      cw,
      ch,
    );
    const next: DrawingScene = {
      objects: [
        {
          id: newObjectId(),
          src: encodeObjectSrc(cropped),
          x: 0,
          y: 0,
          w: 1,
          h: 1,
        },
      ],
      strokes: "",
    };
    setScene(next);
    setSelectedId(null);
    setCropping(false);
    void emit(next);
  }

  function undo() {
    const previous = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (!previous) return;
    const restored = JSON.parse(previous) as DrawingScene;
    setScene(restored);
    setSelectedId(null);
    void emit(restored);
  }

  function clearAll() {
    pushHistory();
    const next = emptyDrawingScene();
    setScene(next);
    setSelectedId(null);
    paintStrokes(next);
    void emit(next);
  }

  function removeSelected() {
    if (!selected) return;
    pushHistory();
    const next: DrawingScene = {
      objects: sceneRef.current.objects.filter((o) => o.id !== selected.id),
      strokes: sceneRef.current.strokes,
    };
    setScene(next);
    setSelectedId(null);
    void emit(next);
  }

  function reorderSelected(step: 1 | -1) {
    if (!selected) return;
    const objects = [...sceneRef.current.objects];
    const index = objects.findIndex((o) => o.id === selected.id);
    const target = index + step;
    if (index < 0 || target < 0 || target >= objects.length) return;
    pushHistory();
    [objects[index], objects[target]] = [objects[target], objects[index]];
    const next: DrawingScene = { objects, strokes: sceneRef.current.strokes };
    setScene(next);
    void emit(next);
  }

  // --- Text objects (free fields) -----------------------------------------
  function addText() {
    if (sceneRef.current.objects.length >= DRAWING_OBJECT_TOTAL_MAX) {
      setError(
        `画像と文字は合わせて${DRAWING_OBJECT_TOTAL_MAX}個までです。`,
      );
      return;
    }
    pushHistory();
    const cascade = (sceneRef.current.objects.length % 4) * 0.035;
    const object: DrawingObject = {
      id: newObjectId(),
      src: "",
      text: "",
      size: DRAWING_TEXT_SIZE_DEFAULT,
      x: Math.min(0.26 + cascade, 0.5),
      y: Math.min(0.36 + cascade, 0.7),
      w: 0.48,
      h: 0.24,
    };
    const next: DrawingScene = {
      objects: [...sceneRef.current.objects, object],
      strokes: sceneRef.current.strokes,
    };
    setScene(next);
    setSelectedId(object.id);
    setMode("select");
    setToolsOpen(false);
    setError("");
    setEditingText(object.id);
    void paintBase(next);
  }

  function startTextEdit(object: DrawingObject) {
    pushHistory();
    setSelectedId(object.id);
    setMode("select");
    setToolsOpen(false);
    setEditingText(object.id);
  }

  function updateEditingText(text: string) {
    const id = editingTextRef.current;
    if (!id) return;
    const next: DrawingScene = {
      objects: sceneRef.current.objects.map((o) =>
        o.id === id ? { ...o, text } : o,
      ),
      strokes: sceneRef.current.strokes,
    };
    setScene(next);
    void paintBase(next);
  }

  /** Close the text editor: an untouched box disappears, anything typed
   * is saved with the scene. */
  function finishTextEdit() {
    const id = editingTextRef.current;
    if (!id) return;
    setEditingText(null);
    let next = sceneRef.current;
    const object = next.objects.find((o) => o.id === id);
    if (object && isTextObject(object) && !(object.text ?? "").trim()) {
      next = {
        objects: next.objects.filter((o) => o.id !== id),
        strokes: next.strokes,
      };
      setScene(next);
      setSelectedId(null);
    }
    void emit(next);
  }

  function resizeSelectedText(factor: number) {
    if (!selected || !isTextObject(selected)) return;
    pushHistory();
    const size = Math.min(
      DRAWING_TEXT_SIZE_MAX,
      Math.max(
        DRAWING_TEXT_SIZE_MIN,
        (selected.size ?? DRAWING_TEXT_SIZE_DEFAULT) * factor,
      ),
    );
    const next: DrawingScene = {
      objects: sceneRef.current.objects.map((o) =>
        o.id === selected.id ? { ...o, size } : o,
      ),
      strokes: sceneRef.current.strokes,
    };
    setScene(next);
    void emit(next);
  }

  // --- Object dragging (select mode) -------------------------------------
  function stagePoint(event: {
    clientX: number;
    clientY: number;
    currentTarget: HTMLElement;
  }) {
    const r = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - r.left) / r.width,
      y: (event.clientY - r.top) / r.height,
    };
  }

  function hitDown(event: PointerEvent<HTMLDivElement>) {
    if (!ready || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = (event.target as HTMLElement).dataset
      .handle as string | undefined;
    const p = stagePoint(event);
    if (handle && selected) {
      dragRef.current = {
        kind: "resize",
        id: selected.id,
        handle,
        startX: p.x,
        startY: p.y,
        orig: { ...selected },
        historyPushed: false,
      };
    } else {
      const objects = sceneRef.current.objects;
      let hit: DrawingObject | undefined;
      for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        if (p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h) {
          hit = o;
          break;
        }
      }
      if (!hit) {
        setSelectedId(null);
        return;
      }
      setSelectedId(hit.id);
      dragRef.current = {
        kind: "move",
        id: hit.id,
        startX: p.x,
        startY: p.y,
        orig: { ...hit },
        historyPushed: false,
      };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function hitMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const p = stagePoint(event);
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    const orig = drag.orig;
    let next: DrawingObject;
    if (drag.kind === "move") {
      next = {
        ...orig,
        x: Math.min(Math.max(orig.x + dx, -orig.w + 0.05), 1 - 0.05),
        y: Math.min(Math.max(orig.y + dy, -orig.h + 0.05), 1 - 0.05),
      };
    } else if (isTextObject(orig)) {
      // Text frames resize freely; the opposite edge anchors.
      let w = orig.w;
      let h = orig.h;
      if (drag.handle!.includes("e")) w = orig.w + dx;
      if (drag.handle!.includes("w")) w = orig.w - dx;
      if (drag.handle!.includes("s")) h = orig.h + dy;
      if (drag.handle!.includes("n")) h = orig.h - dy;
      w = Math.min(1.5, Math.max(0.05, w));
      h = Math.min(1.5, Math.max(0.03, h));
      const x = drag.handle!.includes("w") ? orig.x + orig.w - w : orig.x;
      const y = drag.handle!.includes("n") ? orig.y + orig.h - h : orig.y;
      next = { ...orig, x, y, w, h };
    } else {
      // Resize keeping the picture's aspect; the opposite corner anchors.
      const aspectPx = (orig.w * cw) / (orig.h * ch);
      let w = orig.w;
      if (drag.handle!.includes("e")) w = orig.w + dx;
      if (drag.handle!.includes("w")) w = orig.w - dx;
      w = Math.min(1.5, Math.max(0.05, w));
      const h = Math.min(1.5, Math.max(0.02, (w * cw) / (aspectPx * ch)));
      const x = drag.handle!.includes("w") ? orig.x + orig.w - w : orig.x;
      const y = drag.handle!.includes("n") ? orig.y + orig.h - h : orig.y;
      next = { ...orig, x, y, w, h };
    }
    // Snapshot for undo only once the drag actually changes something,
    // so a plain click to select neither pollutes history nor re-saves.
    if (!drag.historyPushed) {
      pushHistory();
      drag.historyPushed = true;
    }
    const updated: DrawingScene = {
      objects: sceneRef.current.objects.map((o) =>
        o.id === drag.id ? next : o,
      ),
      strokes: sceneRef.current.strokes,
    };
    setScene(updated);
    void paintBase(updated);
  }

  function hitUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = undefined;
    if (drag.historyPushed) void emit(sceneRef.current);
  }

  // --- Hand drawing (pen / eraser) ---------------------------------------
  function strokePoint(event: PointerEvent<HTMLCanvasElement>) {
    const r = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(cw, ((event.clientX - r.left) * cw) / r.width)),
      y: Math.max(0, Math.min(ch, ((event.clientY - r.top) * ch) / r.height)),
    };
  }

  function strokeDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!ready || event.button !== 0 || drawingStroke.current) return;
    event.preventDefault();
    event.stopPropagation();
    pushHistory();
    drawingStroke.current = true;
    strokesEmpty.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ctx = event.currentTarget.getContext("2d")!;
    const p = strokePoint(event);
    if (mode === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.fillStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = 24;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "#182b27";
      ctx.fillStyle = "#182b27";
      ctx.lineWidth = 4;
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function strokeMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingStroke.current) return;
    event.preventDefault();
    event.stopPropagation();
    const p = strokePoint(event);
    const ctx = event.currentTarget.getContext("2d")!;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function strokeEnd(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingStroke.current) return;
    event.preventDefault();
    event.stopPropagation();
    drawingStroke.current = false;
    const ctx = event.currentTarget.getContext("2d")!;
    ctx.globalCompositeOperation = "source-over";
    const next: DrawingScene = {
      objects: sceneRef.current.objects,
      strokes: captureStrokes(),
    };
    setScene(next);
    void emit(next);
  }

  const flatSrc = drawingFlatSrc(value);
  if (disabled || preview)
    return flatSrc ? (
      <img
        className="worksheet-drawing-image"
        src={flatSrc}
        alt={`${label}の画像・手描き回答`}
      />
    ) : (
      <div className="worksheet-drawing-placeholder">
        {allowText ? "手描き・文字の回答欄" : "画像・手描きの回答欄"}
      </div>
    );
  if (!active)
    return (
      <>
        <button
          type="button"
          className="worksheet-drawing-view"
          aria-label={`${label}の画像・手描きを編集`}
          onClick={() => setActive(true)}
          onDoubleClick={() => {
            if (value) cropOnOpen.current = true;
          }}
          onPaste={paste}
          onDragOver={(event) => event.preventDefault()}
          onDrop={drop}
        >
          {flatSrc ? (
            <img src={flatSrc} alt={`${label}の画像・手描き回答`} />
          ) : (
            <span>
              {placeholder?.trim()
                ? placeholder
                : allowText
                  ? "クリックして手描き・文字・画像で入力"
                  : "クリックして画像を貼り付け・手描き"}
            </span>
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
        // While a text box is being edited its keys belong to the text.
        if (editingTextId) {
          if (event.key === "Escape") {
            event.stopPropagation();
            finishTextEdit();
          }
          return;
        }
        if (event.key === "Escape") {
          if (toolsOpen) setToolsOpen(false);
          else if (cropping) setCropping(false);
          else setActive(false);
        }
        if (
          (event.key === "Delete" || event.key === "Backspace") &&
          selected &&
          mode === "select" &&
          !cropping
        ) {
          event.preventDefault();
          removeSelected();
        }
      }}
      aria-busy={!ready}
    >
      <input
        id={fileInputId}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label={`${label}に画像を追加`}
        hidden
        onClick={() => {
          guardUntil.current = Date.now() + 5000;
          // Close the tools panel here, not in the label's click
          // handler: unmounting the label during its own click cancels
          // the label's activation behavior in some browsers, so the
          // file dialog never opens (the 「画像を追加」 regression).
          setToolsOpen(false);
        }}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void load(file);
          e.currentTarget.value = "";
        }}
      />
      <div className="worksheet-drawing-toolbar">
        {cropping ? (
          <>
            <span className="worksheet-drawing-crop-note">
              枠をドラッグして切り抜く範囲を選んでください
            </span>
            <button type="button" onClick={() => setCropping(false)}>
              切り抜きをやめる
            </button>
            <button
              type="button"
              className="worksheet-drawing-done"
              onClick={applyCrop}
            >
              切り抜く
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((open) => !open)}
            >
              ツール：
              {mode === "select"
                ? allowText
                  ? "動かす"
                  : "画像を動かす"
                : mode === "pen"
                  ? "ペン"
                  : "消しゴム"}
              {toolsOpen ? " ▲" : " ▼"}
            </button>
            <button
              type="button"
              className="worksheet-drawing-done"
              onClick={() => setActive(false)}
            >
              完了
            </button>
          </>
        )}
      </div>
      {toolsOpen && !cropping && (
        <div
          className="worksheet-drawing-tools"
          role="group"
          aria-label="画像・手描きのツール"
        >
            <button
              type="button"
              aria-pressed={mode === "select"}
              onClick={() => {
                setMode("select");
                setToolsOpen(false);
              }}
            >
              {allowText ? "動かす" : "画像を動かす"}
            </button>
            {allowText && (
              <button
                type="button"
                disabled={!ready}
                onClick={addText}
              >
                文字を追加
              </button>
            )}
            <button
              type="button"
              aria-pressed={mode === "pen"}
              onClick={() => {
                setMode("pen");
                setToolsOpen(false);
              }}
            >
              ペン
            </button>
            <button
              type="button"
              aria-pressed={mode === "eraser"}
              onClick={() => {
                setMode("eraser");
                setToolsOpen(false);
              }}
            >
              消しゴム
            </button>
            <label
              className="worksheet-drawing-upload"
              htmlFor={fileInputId}
              onPointerDown={() => {
                // Arm the hold-open guard NOW, not on click: pressing
                // the label shifts focus out of the field (to the
                // panel), and the root blur handler would close the
                // editor before the click — and with it the label's
                // activation — ever happens. That was the 「画像を
                // 追加」 regression: nothing responded at all.
                guardUntil.current = Date.now() + 5000;
              }}
              onClick={() => {
                // The file dialog is about to open; hold edit mode open
                // until the chosen file has been handed over. The panel
                // closes in the input's own click handler (see above):
                // closing it here unmounts this label mid-click and can
                // cancel the activation that opens the dialog.
                guardUntil.current = Date.now() + 5000;
              }}
            >
              画像を追加
            </label>
            <button
              type="button"
              disabled={!canUndo || !ready}
              onClick={() => {
                undo();
                setToolsOpen(false);
              }}
            >
              戻す
            </button>
            {selected && (
              <>
                {isTextObject(selected) && (
                  <>
                    <button
                      type="button"
                      onClick={() => startTextEdit(selected)}
                    >
                      文字を編集
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        resizeSelectedText(1.25);
                        setToolsOpen(false);
                      }}
                    >
                      文字を大きく
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        resizeSelectedText(0.8);
                        setToolsOpen(false);
                      }}
                    >
                      文字を小さく
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    removeSelected();
                    setToolsOpen(false);
                  }}
                >
                  {isTextObject(selected)
                    ? "選んだ文字を削除"
                    : "選んだ画像を削除"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    reorderSelected(1);
                    setToolsOpen(false);
                  }}
                >
                  前面へ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    reorderSelected(-1);
                    setToolsOpen(false);
                  }}
                >
                  背面へ
                </button>
              </>
            )}
            <button
              type="button"
              disabled={!hasContent || !ready}
              onClick={() => {
                clearAll();
                setToolsOpen(false);
              }}
            >
              消去
            </button>
            <button
              type="button"
              disabled={!hasContent || !ready}
              onClick={() => {
                setRect({ x: 0, y: 0, w: 1, h: 1 });
                setCropping(true);
                setToolsOpen(false);
              }}
            >
              切り抜き
            </button>
        </div>
      )}
      {notice && <p className="worksheet-drawing-notice">{notice}</p>}
      <div
        className="worksheet-drawing-stage"
        ref={stageRef}
        onPointerDown={() => {
          if (toolsOpen) setToolsOpen(false);
        }}
      >
        <canvas
          ref={baseCanvas}
          className="worksheet-drawing-base"
          width={cw}
          height={ch}
          style={{ aspectRatio: `${cw} / ${ch}` }}
          aria-hidden="true"
        />
        <canvas
          ref={strokeCanvas}
          className="worksheet-drawing-stroke"
          width={cw}
          height={ch}
          style={{
            aspectRatio: `${cw} / ${ch}`,
            pointerEvents: mode === "select" || cropping ? "none" : "auto",
          }}
          tabIndex={0}
          aria-label={`${label}の手描き欄`}
          onPointerDown={strokeDown}
          onPointerMove={strokeMove}
          onPointerUp={strokeEnd}
          onPointerCancel={strokeEnd}
        />
        {mode === "select" && !cropping && (
          <div
            className="worksheet-drawing-hit"
            onPointerDown={hitDown}
            onPointerMove={hitMove}
            onPointerUp={hitUp}
            onPointerCancel={hitUp}
            onDoubleClick={(event) => {
              if (!allowText) return;
              const p = stagePoint(event);
              const hit = [...sceneRef.current.objects]
                .reverse()
                .find(
                  (o) =>
                    isTextObject(o) &&
                    p.x >= o.x &&
                    p.x <= o.x + o.w &&
                    p.y >= o.y &&
                    p.y <= o.y + o.h,
                );
              if (hit) startTextEdit(hit);
            }}
          >
            {selected && (
              <div
                className="worksheet-drawing-selection"
                style={{
                  left: `${selected.x * 100}%`,
                  top: `${selected.y * 100}%`,
                  width: `${selected.w * 100}%`,
                  height: `${selected.h * 100}%`,
                }}
              >
                <span className="worksheet-drawing-handle is-nw" data-handle="nw" />
                <span className="worksheet-drawing-handle is-ne" data-handle="ne" />
                <span className="worksheet-drawing-handle is-sw" data-handle="sw" />
                <span className="worksheet-drawing-handle is-se" data-handle="se" />
              </div>
            )}
          </div>
        )}
        {editingObject && (
          <textarea
            className="worksheet-drawing-text-editor"
            aria-label={`${label}の文字を入力`}
            style={{
              left: `${editingObject.x * 100}%`,
              top: `${editingObject.y * 100}%`,
              width: `${editingObject.w * 100}%`,
              height: `${editingObject.h * 100}%`,
              fontSize: `${
                (editingObject.size ?? DRAWING_TEXT_SIZE_DEFAULT) *
                (stageH || ch)
              }px`,
              lineHeight: 1.25,
            }}
            value={editingObject.text ?? ""}
            maxLength={DRAWING_TEXT_MAX}
            autoFocus
            onChange={(event) => updateEditingText(event.target.value)}
            onBlur={finishTextEdit}
            onPointerDown={(event) => event.stopPropagation()}
          />
        )}
        {cropping && (
          <div
            className="drawing-crop"
            role="application"
            aria-label={`${label}の切り抜き範囲`}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = cropPoint(e);
              const handle = (e.target as HTMLElement).dataset
                .handle as string | undefined;
              const inside =
                p.x >= rect.x &&
                p.x <= rect.x + rect.w &&
                p.y >= rect.y &&
                p.y <= rect.y + rect.h;
              const whole = rect.w >= 0.999 && rect.h >= 0.999;
              cropDrag.current = {
                mode: handle ?? (inside && !whole ? "move" : "new"),
                startX: p.x,
                startY: p.y,
                rect: { ...rect },
              };
              if (!handle && !inside)
                setRect({ x: p.x, y: p.y, w: 0, h: 0 });
            }}
            onPointerMove={(e) => {
              const d = cropDrag.current;
              if (!d) return;
              e.preventDefault();
              e.stopPropagation();
              const p = cropPoint(e);
              const dx = p.x - d.startX,
                dy = p.y - d.startY,
                r = { ...d.rect },
                MIN = 0.08;
              if (d.mode === "move") {
                r.x = Math.max(0, Math.min(1 - r.w, r.x + dx));
                r.y = Math.max(0, Math.min(1 - r.h, r.y + dy));
              } else if (d.mode === "new") {
                r.x = Math.min(d.startX, p.x);
                r.y = Math.min(d.startY, p.y);
                r.w = Math.abs(p.x - d.startX);
                r.h = Math.abs(p.y - d.startY);
              } else {
                if (d.mode.includes("w")) {
                  const right = r.x + r.w;
                  r.x = Math.max(0, Math.min(right - MIN, r.x + dx));
                  r.w = right - r.x;
                }
                if (d.mode.includes("e")) {
                  r.w = Math.max(MIN, Math.min(1 - r.x, r.w + dx));
                }
                if (d.mode.includes("n")) {
                  const bottom = r.y + r.h;
                  r.y = Math.max(0, Math.min(bottom - MIN, r.y + dy));
                  r.h = bottom - r.y;
                }
                if (d.mode.includes("s")) {
                  r.h = Math.max(MIN, Math.min(1 - r.y, r.h + dy));
                }
              }
              setRect(r);
            }}
            onPointerUp={() => {
              const d = cropDrag.current;
              cropDrag.current = undefined;
              if (d?.mode === "new")
                setRect((r) =>
                  r.w < 0.08 || r.h < 0.08 ? { x: 0, y: 0, w: 1, h: 1 } : r,
                );
            }}
            onPointerCancel={() => {
              cropDrag.current = undefined;
            }}
          >
            <div
              className="drawing-crop-rect"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
              }}
            >
              <span className="drawing-crop-handle is-nw" data-handle="nw" />
              <span className="drawing-crop-handle is-ne" data-handle="ne" />
              <span className="drawing-crop-handle is-sw" data-handle="sw" />
              <span className="drawing-crop-handle is-se" data-handle="se" />
              <span className="drawing-crop-handle is-n" data-handle="n" />
              <span className="drawing-crop-handle is-e" data-handle="e" />
              <span className="drawing-crop-handle is-s" data-handle="s" />
              <span className="drawing-crop-handle is-w" data-handle="w" />
            </div>
          </div>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
