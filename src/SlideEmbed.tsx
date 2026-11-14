import { useState, type PointerEvent } from "react";
import { AppWindow, MousePointer2, Move } from "lucide-react";
import type { Element } from "./model";
import { embedHostName } from "./embedBinding";

/**
 * スライドに埋め込んだWebアプリ。
 * - 大きく表示する画面（発表・集合・編集）ではアプリがそのまま動く
 * - 編集画面では、移動・選択できるように透明な板で覆い、「操作する」で
 *   アプリ側に切り替える
 * - サムネイルなどの静止表示では、アプリを起動せず場所だけを示す
 */
export function SlideEmbed({
  element,
  interactive = false,
  onMoveStart,
}: {
  element: Element;
  interactive?: boolean;
  onMoveStart?: (event: PointerEvent<HTMLElement>) => void;
}) {
  const [operating, setOperating] = useState(false);
  const url = element.embed?.url ?? "";
  const host = embedHostName(url) || "Webアプリ";
  if (!interactive) {
    return (
      <div className="slide-embed-placeholder" aria-label={`埋め込みアプリ：${host}`}>
        <AppWindow size={26} aria-hidden="true" />
        <strong>Webアプリ</strong>
        <span>{host}</span>
        <small>開くとここで操作できます</small>
      </div>
    );
  }
  const editing = !!onMoveStart;
  return (
    <div className="slide-embed" data-slide-embed={interactive}>
      <iframe
        src={url}
        title={`埋め込みアプリ（${host}）`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock"
        allow="autoplay; fullscreen; camera; microphone; encrypted-media; picture-in-picture"
        loading="lazy"
      />
      {editing && !operating && (
        <>
          <div
            className="slide-embed-shield"
            onPointerDown={onMoveStart}
            title="ドラッグで移動できます"
          >
            <span className="slide-embed-shield-label">
              <Move size={15} aria-hidden="true" />
              {host}
            </span>
          </div>
          <button
            type="button"
            className="slide-embed-operate"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setOperating(true)}
          >
            <MousePointer2 size={14} aria-hidden="true" />
            アプリを操作する
          </button>
        </>
      )}
      {editing && operating && (
        <button
          type="button"
          className="slide-embed-operate is-operating"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setOperating(false)}
        >
          操作を終わる（移動できる状態にもどす）
        </button>
      )}
    </div>
  );
}
