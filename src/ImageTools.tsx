import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Element } from "./model";
import { coverCrop } from "./imageData";
export function ImageGraphic({ element: e }: { element: Element }) {
  const c = e.crop;
  return (
    <div className="image-window">
      <img
        className="slide-image"
        src={e.src}
        alt={e.altText ?? "スライドの画像"}
        draggable={false}
        style={
          c
            ? {
                position: "absolute",
                maxWidth: "none",
                left: `${(-100 * c.x) / c.w}%`,
                top: `${(-100 * c.y) / c.h}%`,
                width: `${100 / c.w}%`,
                height: `${100 / c.h}%`,
              }
            : undefined
        }
      />
    </div>
  );
}
export function ImageControls({
  element: e,
  onChange,
  onReplace,
  disabled,
}: {
  element: Element;
  onChange: (p: Partial<Element>) => void;
  onReplace: (file: File, id: string) => void;
  disabled: boolean;
}) {
  const [crop, setCrop] = useState(false),
    file = useRef<HTMLInputElement>(null);
  useEffect(() => setCrop(false), [disabled, e.id, e.src]);
  return (
    <section className="image-controls" aria-label="画像の設定">
      <h3>画像</h3>
      <div className="object-action-pair">
        <button disabled={disabled} onClick={() => setCrop(true)}>
          切り抜き・位置調整
        </button>
        <button disabled={disabled} onClick={() => file.current?.click()}>
          画像を差し替える
        </button>
      </div>
      <input
        ref={file}
        type="file"
        hidden
        aria-label="差し替える画像"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(ev) => {
          const f = ev.target.files?.[0];
          if (f) onReplace(f, e.id);
          ev.target.value = "";
        }}
      />
      <label>
        画像の説明（代替テキスト）
        <textarea
          aria-label="画像の説明"
          rows={3}
          maxLength={500}
          placeholder="画像に何が写っているかを書きます"
          value={e.altText ?? ""}
          onChange={(ev) => onChange({ altText: ev.target.value })}
        />
      </label>
      <p className="inspector-note">
        説明は画像を読み上げるときに使います。切り抜きや差し替えでも、位置と大きさを保てます。
      </p>
      {e.crop && (
        <button
          className="quiet"
          disabled={disabled}
          onClick={() => onChange({ crop: undefined })}
        >
          切り抜きを解除
        </button>
      )}
      {crop && !disabled && (
        <CropDialog
          element={e}
          onClose={() => setCrop(false)}
          onApply={(p) => {
            onChange(p);
            setCrop(false);
          }}
        />
      )}
    </section>
  );
}
function CropDialog({
  element: e,
  onClose,
  onApply,
}: {
  element: Element;
  onClose: () => void;
  onApply: (p: Partial<Element>) => void;
}) {
  const quarter = (e.rotation ?? 0) % 180 !== 0,
    original = { w: quarter ? e.h : e.w, h: quarter ? e.w : e.h };
  const [frame, setFrame] = useState(original),
    [sourceRatio, setSourceRatio] = useState<number>(),
    [error, setError] = useState(""),
    [zoom, setZoom] = useState(1),
    [focus, setFocus] = useState({ x: 0.5, y: 0.5 });
  const panel = useRef<HTMLElement>(null),
    preview = useRef<HTMLDivElement>(null),
    drag = useRef<
      | {
          x: number;
          y: number;
          fx: number;
          fy: number;
          w: number;
          h: number;
        }
      | undefined
    >(undefined);
  let crop = e.crop,
    cropError = "";
  try {
    if (sourceRatio)
      crop = coverCrop(sourceRatio, frame.w / frame.h, zoom, focus.x, focus.y);
  } catch {
    cropError =
      "この画像は細長すぎるため、この形では切り抜けません。形や拡大率を変更してください。";
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (ev: KeyboardEvent) => {
      ev.stopPropagation();
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
      }
      if (ev.key === "Tab") {
        const list = [
            ...panel.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input,select,textarea,[tabindex="0"]',
            ),
          ],
          at = list.indexOf(document.activeElement as HTMLElement),
          next = ev.shiftKey
            ? at <= 0
              ? list.length - 1
              : at - 1
            : (at + 1) % list.length;
        ev.preventDefault();
        list[next]?.focus();
      }
    };
    panel.current?.addEventListener("keydown", key);
    return () => {
      panel.current?.removeEventListener("keydown", key);
      previous?.focus({ preventScroll: true });
    };
  }, []);
  function preset(ratio: number) {
    setFrame({ w: original.w, h: original.w / ratio });
    setZoom(1);
    setFocus({ x: 0.5, y: 0.5 });
  }
  const current = { ...e, crop };
  return createPortal(
    <div
      className="modal-backdrop crop-backdrop"
      onPointerDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        className="crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="画像を切り抜く"
      >
        <header>
          <div>
            <h2>画像を切り抜く</h2>
            <p>
              画像をドラッグして位置を調整。確定するまで元の画像は変わりません。
            </p>
          </div>
          <button className="quiet" onClick={onClose}>
            閉じる
          </button>
        </header>
        <div className="crop-preview-space">
          <div
            ref={preview}
            className="crop-preview"
            style={{
              aspectRatio: `${frame.w}/${frame.h}`,
              width: `min(100%, calc(42dvh * ${frame.w / frame.h}))`,
              maxWidth: 620,
            }}
            onPointerDown={(ev) => {
              if (!crop) return;
              ev.preventDefault();
              ev.currentTarget.setPointerCapture(ev.pointerId);
              const r = ev.currentTarget.getBoundingClientRect();
              drag.current = {
                x: ev.clientX,
                y: ev.clientY,
                fx: focus.x,
                fy: focus.y,
                w: r.width,
                h: r.height,
              };
            }}
            onPointerMove={(ev) => {
              const d = drag.current;
              if (!d || !crop) return;
              setFocus({
                x:
                  crop.w >= 0.999
                    ? d.fx
                    : Math.max(
                        0,
                        Math.min(
                          1,
                          d.fx -
                            ((ev.clientX - d.x) * crop.w) / d.w / (1 - crop.w),
                        ),
                      ),
                y:
                  crop.h >= 0.999
                    ? d.fy
                    : Math.max(
                        0,
                        Math.min(
                          1,
                          d.fy -
                            ((ev.clientY - d.y) * crop.h) / d.h / (1 - crop.h),
                        ),
                      ),
              });
            }}
            onPointerUp={() => {
              drag.current = undefined;
            }}
            onPointerCancel={() => {
              drag.current = undefined;
            }}
          >
            <ImageGraphic element={current} />
            <div className="crop-thirds" aria-hidden="true" />
          </div>
        </div>
        <img
          hidden
          src={e.src}
          alt=""
          onLoad={(ev) => {
            const ratio =
              ev.currentTarget.naturalWidth / ev.currentTarget.naturalHeight;
            setSourceRatio(ratio);
            if (e.crop) {
              let base;
              try {
                base = coverCrop(ratio, original.w / original.h);
              } catch {
                setError("この画像の切り抜き範囲を読み込めません。");
                return;
              }
              setZoom(Math.max(1, Math.min(4, base.w / e.crop.w)));
              setFocus({
                x: e.crop.w >= 0.999 ? 0.5 : e.crop.x / (1 - e.crop.w),
                y: e.crop.h >= 0.999 ? 0.5 : e.crop.y / (1 - e.crop.h),
              });
            }
          }}
          onError={() =>
            setError("画像を読み込めません。接続を確認してください。")
          }
        />
        <div className="crop-presets" role="group" aria-label="切り抜きの形">
          <button onClick={() => preset(original.w / original.h)}>
            現在の枠
          </button>
          <button onClick={() => preset(1)}>正方形</button>
          <button onClick={() => preset(4 / 3)}>4：3</button>
          <button onClick={() => preset(16 / 9)}>16：9</button>
        </div>
        <div className="crop-sliders">
          <label>
            拡大率 {Math.round(zoom * 100)}%
            <input
              aria-label="画像の拡大率"
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(ev) => setZoom(Number(ev.target.value))}
            />
          </label>
          <label>
            左右の位置
            <input
              aria-label="切り抜きの左右位置"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={focus.x}
              onChange={(ev) =>
                setFocus({ ...focus, x: Number(ev.target.value) })
              }
            />
          </label>
          <label>
            上下の位置
            <input
              aria-label="切り抜きの上下位置"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={focus.y}
              onChange={(ev) =>
                setFocus({ ...focus, y: Number(ev.target.value) })
              }
            />
          </label>
        </div>
        {(e.rotation || e.flipX || e.flipY) && (
          <p>
            元の画像の向きで調整しています。回転・反転はスライドに反映されます。
          </p>
        )}
        {(error || cropError) && <p role="alert">{error || cropError}</p>}
        <p className="crop-original-note">
          切り抜きは見える範囲の調整です。共有先や完全バックアップには、元の画像も含まれます。
        </p>
        <footer>
          <button className="button" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="button primary"
            disabled={!sourceRatio || !!error || !!cropError}
            onClick={() => {
              const w = quarter ? frame.h : frame.w,
                h = quarter ? frame.w : frame.h,
                scale = Math.min(1, (960 - e.x) / w, (540 - e.y) / h);
              onApply({
                crop,
                w: Math.max(20, w * scale),
                h: Math.max(20, h * scale),
              });
            }}
          >
            切り抜きを適用
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
