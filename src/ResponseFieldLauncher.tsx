import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList } from "lucide-react";
import type { Element, Slide } from "./model";
import { ResponseFieldTools } from "./ResponseFieldTools";
import { useWorksheets } from "./WorksheetContext";
import { useActivityPanel } from "./ActivitiesPanel";
export function ResponseFieldLauncher({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const ctx = useWorksheets(),
    activity = useActivityPanel();
  return (
    <button
      className="tool-button response-field-launch"
      disabled={disabled || (!!ctx.deckId && !ctx.enabled)}
      title="フォーム：アンケート・ワークシート・回答欄・回答共有"
      onClick={(event) => activity.launch(activity.active, event.currentTarget)}
    >
      <ClipboardList size={20} />
      フォーム
    </button>
  );
}
export function ResponseFieldCreator({
  slide,
  onPlace,
}: {
  slide: Slide;
  onPlace: (elements: Element[]) => void;
}) {
  const activity = useActivityPanel(),
    root = useRef<HTMLElement>(null),
    alive = useRef(true);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!activity.open || activity.active !== "fields") return;
    const frame = requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLInputElement>('[aria-label="新しい入力項目名"]')
        ?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [activity.open]);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(false), 12000);
    return () => clearTimeout(timer);
  }, [hint]);
  function placed(elements: Element[]) {
    if (!alive.current) return;
    onPlace(elements);
    activity.close(true);
    setHint(true);
  }
  return (
    <>
      <section ref={root} className="response-field-integrated">
        <h3>スライドに回答欄を追加</h3>
        <p>
          配置先：{slide.title || "現在のページ"}
          。追加後にスライド上で自由に移動・サイズ変更できます。
        </p>
        <ol className="response-field-steps" aria-label="回答欄の作成手順">
          <li>
            <b>1</b>項目を決める
          </li>
          <li>
            <b>2</b>プレビューを確認して追加
          </li>
          <li>
            <b>3</b>スライド上で配置を調整
          </li>
        </ol>
        <ResponseFieldTools
          slide={slide}
          onPlace={placed}
          onBusyChange={activity.setBusy}
        />
      </section>
      {hint &&
        createPortal(
          <div className="response-placement-hint" role="status">
            回答欄を追加しました。「移動」で位置を変え、四隅のハンドルで大きさを調整できます。
            <button
              onClick={() => setHint(false)}
              aria-label="配置の案内を閉じる"
            >
              ×
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
