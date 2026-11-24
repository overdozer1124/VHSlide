import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Asked when a student imports a file into their assigned row and
 * the row already holds slides: replace them, or append after them.
 */
export function ImportRowChoiceDialog({
  pageCount,
  sheetName,
  rowNumber,
  onChoose,
  onCancel,
}: {
  pageCount: number;
  sheetName: string;
  rowNumber: number;
  onChoose: (mode: "replace" | "append") => void;
  onCancel: () => void;
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
  return createPortal(
    <dialog
      ref={ref}
      className="tools-dialog import-row-choice-dialog"
      aria-label="読み込み方法の選択"
      onCancel={onCancel}
    >
      <header>
        <div>
          <h2>あなたの行には、すでにスライドがあります</h2>
          <p>
            「{sheetName}」の{rowNumber}行目に、読み込んだ{pageCount}
            ページをどう入れるか選んでください。
          </p>
        </div>
      </header>
      <div className="import-row-choice-actions">
        <button className="button" onClick={() => onChoose("replace")}>
          置き換える
        </button>
        <p>今の行のスライドは消えて、読み込んだページだけになります。</p>
        <button className="button" onClick={() => onChoose("append")}>
          行の後ろに追加する
        </button>
        <p>今の行のスライドは残り、その後ろに読み込んだページが入ります。</p>
        <button className="button outline" onClick={onCancel}>
          やめる
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
