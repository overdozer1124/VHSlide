import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { AppWindow, MousePointer2, Move } from "lucide-react";
import type { Element } from "./model";
import { embedHostName, isEmbedPoster } from "./embedBinding";

/**
 * スライドに埋め込んだWebアプリ。
 * - 大きく表示する画面（発表・集合・編集）ではアプリがそのまま動く
 * - 編集画面では、移動・選択できるように透明な板で覆い、「操作する」で
 *   アプリ側に切り替える
 * - サムネイルなどの静止表示では、アプリを起動せず場所だけを示す。
 *   橋渡しスクリプトを入れた自作アプリから撮影画像が届いていれば、
 *   その画像をサムネイルにする
 * - 撮影画像がまだ無い場合、編集画面で読み込んだタイミングで
 *   アプリ側へ撮影を求める（届いた画像は onPoster で保存される）
 */
export function SlideEmbed({
  element,
  interactive = false,
  onMoveStart,
  onPoster,
}: {
  element: Element;
  interactive?: boolean;
  onMoveStart?: (event: PointerEvent<HTMLElement>) => void;
  onPoster?: (image: string) => void;
}) {
  const [operating, setOperating] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // 再描画のたびに撮影要求を繰り返さないよう、要求回数は部品の生存期間で数える
  const asksRef = useRef(0);
  const asksUrlRef = useRef("");
  const url = element.embed?.url ?? "";
  const poster = element.embed?.poster;
  const host = embedHostName(url) || "Webアプリ";

  useEffect(() => {
    if (!interactive || !onPoster || poster || !loaded) return;
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      return;
    }
    if (asksUrlRef.current !== url) {
      asksUrlRef.current = url;
      asksRef.current = 0;
    }
    if (asksRef.current >= 4) return;
    let done = false;
    let timer = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      if (event.origin !== origin) return;
      const data = event.data as { type?: string; image?: unknown } | null;
      if (!data || data.type !== "vhslide-embed:snapshot") return;
      if (!isEmbedPoster(data.image)) return;
      done = true;
      onPoster(data.image);
    };
    window.addEventListener("message", onMessage);
    const ask = () => {
      if (done || asksRef.current >= 4) return;
      asksRef.current += 1;
      iframe.contentWindow?.postMessage(
        { type: "vhslide-embed:request-snapshot", version: 1 },
        origin,
      );
      timer = window.setTimeout(ask, 2500);
    };
    timer = window.setTimeout(ask, 900);
    return () => {
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [interactive, onPoster, poster, loaded, url]);

  if (!interactive) {
    if (poster)
      return (
        <div
          className="slide-embed-placeholder has-poster"
          aria-label={`埋め込みアプリ：${host}`}
        >
          <img src={poster} alt="" />
          <span className="slide-embed-poster-chip">
            <AppWindow size={12} aria-hidden="true" />
            {host}
          </span>
        </div>
      );
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
        ref={iframeRef}
        src={url}
        title={`埋め込みアプリ（${host}）`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock"
        allow="autoplay; fullscreen; camera; microphone; encrypted-media; picture-in-picture"
        loading="lazy"
        onLoad={() => setLoaded(true)}
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
