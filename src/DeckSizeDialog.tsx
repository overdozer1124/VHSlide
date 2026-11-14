import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { formatBytes, measureDeckSize } from "./deckSize";
import type { Deck } from "./model";

/** Read-only view of the current workbook's data size and its makeup. */
export function DeckSizeDialog({
  deck,
  close,
}: {
  deck: Deck;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current!,
      previous = document.activeElement as HTMLElement | null;
    node.showModal();
    return () => {
      node.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const size = measureDeckSize(deck);
  const percent = (size.totalBytes / size.limitBytes) * 100;
  return createPortal(
    <dialog
      ref={ref}
      className="tools-dialog deck-size-dialog"
      aria-label="ファイルサイズ"
      onCancel={close}
    >
      <header>
        <div>
          <h2>ファイルサイズ</h2>
          <p>いま開いている作品全体（全シート）のデータ量です。</p>
        </div>
        <button className="button outline" onClick={close}>
          閉じる
        </button>
      </header>
      <p className="deck-size-total">{formatBytes(size.totalBytes)}</p>
      <div
        className="deck-size-bar"
        role="img"
        aria-label={`保存上限の約${percent.toFixed(1)}%`}
      >
        <span style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <p className="deck-size-limit">
        保存上限（25MB）の約{percent.toFixed(1)}%を使っています。
      </p>
      <dl className="deck-size-breakdown">
        <div>
          <dt>スライド</dt>
          <dd>{size.slideCount}枚</dd>
        </div>
        <div>
          <dt>画像</dt>
          <dd>
            {formatBytes(size.imageBytes)}（{size.imageCount}件）
          </dd>
        </div>
        <div>
          <dt>埋め込みアプリのサムネイル</dt>
          <dd>
            {formatBytes(size.posterBytes)}（{size.posterCount}件）
          </dd>
        </div>
        <div>
          <dt>その他（文字・図形など）</dt>
          <dd>{formatBytes(size.otherBytes)}</dd>
        </div>
      </dl>
      <p className="deck-size-note">
        サイズは、保存・書き出しされる作品データ（JSON）の大きさです。大きな画像を減らすと小さくなります。
      </p>
    </dialog>,
    document.body,
  );
}
