import { useEffect, useId, useRef, useState } from "react";
import { ClipboardList, X } from "lucide-react";
import type { Element, Slide } from "./model";
import { ResponseFieldTools } from "./ResponseFieldTools";
import { useWorksheets } from "./WorksheetContext";
export function ResponseFieldLauncher({
  slide,
  onPlace,
  disabled,
}: {
  slide: Slide;
  onPlace: (elements: Element[]) => void;
  disabled: boolean;
}) {
  const ctx = useWorksheets(),
    dialog = useRef<HTMLDialogElement>(null),
    alive = useRef(true);
  const [busy, setBusy] = useState(false),
    [hint, setHint] = useState(false);
  const id = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(false), 12000);
    return () => clearTimeout(timer);
  }, [hint]);
  function placed(elements: Element[]) {
    if (!alive.current) return;
    onPlace(elements);
    dialog.current?.close();
    setHint(true);
  }
  return (
    <>
      <button
        className="tool-button response-field-launch"
        disabled={disabled || (ctx.enabled && !ctx.host)}
        title="スライドに記述・チェック・選択式の回答欄を追加"
        onClick={() => {
          dialog.current?.showModal();
          dialog.current
            ?.querySelector<HTMLInputElement>('[aria-label="新しい入力項目名"]')
            ?.focus();
        }}
      >
        <ClipboardList size={20} />
        回答欄を追加
      </button>
      <dialog
        className="response-field-dialog"
        role="dialog"
        ref={dialog}
        aria-labelledby={`${id}-title`}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id={`${id}-title`}>スライドに回答欄を追加</h2>
            <p>
              項目を決めて追加し、スライド上で自由に移動・サイズ変更できます。
            </p>
          </div>
          <button
            className="button outline"
            aria-label="回答欄の追加を閉じる"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </header>
        <ol className="response-field-steps" aria-label="回答欄の作成手順">
          <li>
            <b>1</b> 項目を決める
          </li>
          <li>
            <b>2</b> プレビューを確認して追加
          </li>
          <li>
            <b>3</b> スライド上で配置を調整
          </li>
        </ol>
        <ResponseFieldTools
          slide={slide}
          onPlace={placed}
          onBusyChange={setBusy}
        />
      </dialog>
      {hint && (
        <div className="response-placement-hint" role="status">
          回答欄を追加しました。「移動」で位置を変え、四隅のハンドルで大きさを調整できます。
          <button
            onClick={() => setHint(false)}
            aria-label="配置の案内を閉じる"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
