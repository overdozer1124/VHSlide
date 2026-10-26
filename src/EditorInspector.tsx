import { ElementFitNotice } from "./ElementFitNotice";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Copy,
  Trash2,
  Paintbrush,
  Move,
  Link2,
  ChevronRight,
} from "lucide-react";
import type { Element } from "./model";
import type { CellSelection } from "./TableCellControls";
/** Navigation belongs outside the disabled form: viewers can inspect every section. */
export function EditorInspector({
  element,
  count,
  disabled,
  appearance,
  layout,
  links,
  group,
  onDuplicate,
  onDelete,
  onSectionChange,
  pageKey,
  pageElements,
  cellSelection,
}: {
  element?: Element;
  count: number;
  disabled: boolean;
  appearance: ReactNode;
  layout: ReactNode;
  links: ReactNode;
  group: ReactNode;
  onDuplicate: () => void;
  onDelete: () => void;
  onSectionChange: (section: string) => void;
  pageKey: string;
  pageElements: Element[];
  cellSelection?: CellSelection;
}) {
  const [tab, setTab] = useState("appearance"),
    body = useRef<HTMLDivElement>(null),
    id = useId();
  const previous = useRef({
    pageKey,
    ids: new Set(pageElements.map((e) => e.id)),
  });
  const scroll = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const old = previous.current;
    const inserted = element && !old.ids.has(element.id);
    if (old.pageKey !== pageKey || inserted) {
      scroll.current.clear();
      setTab("appearance");
      if (body.current) body.current.scrollTop = 0;
    }
    previous.current = { pageKey, ids: new Set(pageElements.map((e) => e.id)) };
  }, [pageKey, pageElements, element?.id]);
  useLayoutEffect(() => {
    if (cellSelection?.id === element?.id && cellSelection?.keys.length)
      setTab("appearance");
  }, [cellSelection, element?.id]);
  const multiple = count > 1;
  const current = !element ? "appearance" : multiple ? "layout" : tab;
  const scrollKey =
    current === "appearance"
      ? `${current}:${element?.type ?? "page"}`
      : current;
  useLayoutEffect(() => {
    if (body.current)
      body.current.scrollTop = scroll.current.get(scrollKey) ?? 0;
  }, [scrollKey, pageKey]);
  const title = multiple
    ? `${count}個の要素`
    : element
      ? {
          text: "文字",
          image: "画像",
          shape: "図形",
          table: "表",
          line: "線",
          chart: "グラフ",
        }[element.type]
      : "ページのデザイン";
  const tabs = [
    { key: "appearance", name: "見た目", icon: Paintbrush },
    { key: "layout", name: "配置", icon: Move },
    { key: "links", name: "リンク", icon: Link2 },
  ];
  return (
    <>
      <header className="editor-inspector-heading">
        <div>
          <span className="inspector-eyebrow">
            {count ? "選択中" : "ページ設定"}
          </span>
          <h2>{title}</h2>
        </div>
        {element?.type === "table" && !multiple && (
          <span className="inspector-count">
            {element.table!.rows.length}行 × {element.table!.columns.length}列
          </span>
        )}
      </header>
      {count > 0 && (
        <div className="inspector-quick-actions">
          <button disabled={disabled} onClick={onDuplicate}>
            <Copy size={16} />
            複製
          </button>
          <button
            disabled={disabled}
            onClick={onDelete}
            aria-label="選んだものを削除"
          >
            <Trash2 size={16} />
            削除
          </button>
        </div>
      )}
      {element && !multiple && (
        <div role="tablist" aria-label="編集設定" className="inspector-tabs">
          {tabs.map((t, i) => (
            <button
              key={t.key}
              id={`${id}-${t.key}-tab`}
              role="tab"
              aria-selected={current === t.key}
              aria-controls={`${id}-panel`}
              tabIndex={current === t.key ? 0 : -1}
              onClick={() => {
                setTab(t.key);
                onSectionChange(t.key);
              }}
              onKeyDown={(e) => {
                let index = i;
                if (e.key === "ArrowRight") index = (i + 1) % tabs.length;
                else if (e.key === "ArrowLeft")
                  index = (i + tabs.length - 1) % tabs.length;
                else if (e.key === "Home") index = 0;
                else if (e.key === "End") index = tabs.length - 1;
                else return;
                e.preventDefault();
                setTab(tabs[index].key);
                onSectionChange(tabs[index].key);
                (
                  e.currentTarget.parentElement!.children[index] as HTMLElement
                ).focus();
              }}
            >
              <t.icon size={16} />
              {t.name}
              {t.key === "links" && element.link && (
                <i aria-label="リンク設定済み" />
              )}
            </button>
          ))}
        </div>
      )}
      <div
        className="inspector-scroll"
        ref={body}
        onScroll={(ev) =>
          scroll.current.set(scrollKey, ev.currentTarget.scrollTop)
        }
      >
        {element &&
          !multiple &&
          (element.type === "table" || element.type === "chart") && (
            <ElementFitNotice element={element} />
          )}
        {disabled && (
          <p className="read-only-hint">
            閲覧のみ · 編集範囲はホストが設定します
          </p>
        )}
        <fieldset disabled={disabled} className="inspector-fields">
          {group}
          <div
            id={`${id}-panel`}
            role={element && !multiple ? "tabpanel" : undefined}
            aria-labelledby={
              element && !multiple ? `${id}-${current}-tab` : undefined
            }
          >
            {current === "appearance"
              ? appearance
              : current === "layout"
                ? layout
                : links}
          </div>
        </fieldset>
      </div>
    </>
  );
}
export function TableInspector({
  element,
  selection,
  cells,
  whole,
  onWhole,
}: {
  element: Element;
  selection?: CellSelection;
  cells: ReactNode;
  whole: ReactNode;
  onWhole: () => void;
}) {
  const signature =
    selection?.id === element.id ? selection.keys.join(",") : "";
  const [tab, setTab] = useState(signature ? "cells" : "whole"),
    id = useId();
  useEffect(() => {
    if (signature) setTab("cells");
  }, [signature, selection]);
  return (
    <section className="table-inspector" aria-label="表の編集範囲">
      <div
        className="table-scope-tabs"
        role="tablist"
        aria-label="表の編集対象"
      >
        {[
          { key: "cells", name: "セル" },
          { key: "whole", name: "表全体" },
        ].map((t, i) => (
          <button
            key={t.key}
            role="tab"
            id={`${id}-${t.key}`}
            aria-controls={`${id}-panel`}
            aria-selected={tab === t.key}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => {
              setTab(t.key);
              if (t.key === "whole") onWhole();
            }}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const n = e.key === "Home" ? 0 : e.key === "End" ? 1 : 1 - i;
              setTab(n ? "whole" : "cells");
              if (n) onWhole();
              (
                e.currentTarget.parentElement!.children[n] as HTMLElement
              ).focus();
            }}
          >
            {t.name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
        {tab === "cells" ? cells : whole}
      </div>
      <details className="inspector-help">
        <summary>
          <ChevronRight size={15} />
          表の操作ヒント
        </summary>
        <p>
          セルをクリックして入力。Tabで次のセルへ移動します。Shiftクリック、または「セルの範囲を選ぶ」で複数セルを選べます。
        </p>
        <p>
          Excelなどから複数セルを貼り付けできます。必要な行・列は12まで自動で増えます。表の外枠をドラッグすると移動できます。
        </p>
      </details>
    </section>
  );
}
