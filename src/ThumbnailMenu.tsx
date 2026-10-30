import { useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Copy, Layers, Trash2 } from "lucide-react";
import type { Deck } from "./model";

export type ThumbnailAction =
  | { kind: "duplicate-page"; id: string }
  | { kind: "delete-page"; id: string }
  | { kind: "duplicate-row"; y: number; count?: number }
  | { kind: "delete-row"; y: number };
export interface ThumbnailTarget {
  pageId?: string;
  row?: number;
}
export type OpenThumbnailMenu = (
  event: MouseEvent<HTMLElement>,
  target: ThumbnailTarget,
) => void;
export interface ThumbnailMenuState extends ThumbnailTarget {
  left: number;
  top: number;
  trigger: HTMLElement;
}

/** One menu for mouse, keyboard context-menu events, and touch-accessible ⋯ buttons. */
export function ThumbnailMenu({
  deck,
  readOnly = false,
  menu,
  onClose,
  onAction,
}: {
  deck: Deck;
  readOnly?: boolean;
  menu: ThumbnailMenuState;
  onClose: () => void;
  onAction: (action: ThumbnailAction) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [copies, setCopies] = useState(5);
  const [position, setPosition] = useState({ left: menu.left, top: menu.top });
  const page = deck.slides.find((s) => s.id === menu.pageId);
  const count = deck.slides.filter((s) => s.y === menu.row).length;
  function dismiss(restoreFocus = false) {
    onClose();
    if (restoreFocus)
      requestAnimationFrame(() => {
        if (menu.trigger.isConnected)
          (menu.trigger.matches(
            "button,a[href],input,select,textarea,[tabindex]",
          )
            ? menu.trigger
            : menu.trigger.querySelector<HTMLElement>(
                "button:not(:disabled),[tabindex='0']",
              )
          )?.focus({ preventScroll: true });
      });
  }
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(menu.left, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(menu.top, window.innerHeight - box.height - 8)),
    });
    (
      node.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? node
    ).focus({ preventScroll: true });
    function outside(event: Event) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    const resize = () => onClose();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", resize);
    // Thumbnail panes may scroll themselves to reveal the current page while
    // opening a menu. Only a document scroll should dismiss this fixed overlay.
    window.addEventListener("scroll", resize);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", resize);
    };
  }, [menu, readOnly]);
  const act = (action: ThumbnailAction) => {
    if (readOnly) return;
    onClose();
    onAction(action);
  };
  return createPortal(
    <div
      ref={ref}
      className="thumbnail-menu"
      role="menu"
      tabIndex={-1}
      aria-label={
        menu.row === undefined ? "ページの操作" : `${menu.row + 1}段目の操作`
      }
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          (event.target as HTMLElement).matches("input") &&
          event.key !== "Escape"
        )
          return;
        if (["Escape", "Tab"].includes(event.key)) {
          event.preventDefault();
          dismiss(true);
        } else if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const items = Array.from(
            ref.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
          );
          const current = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length;
          items[index]?.focus();
        }
      }}
    >
      <div className="thumbnail-menu-title">
        {menu.row === undefined
          ? page?.title
          : `${menu.row + 1}段目 · ${count}ページ`}
      </div>
      {readOnly && (
        <p className="thumbnail-menu-readonly" role="status">
          閲覧のみのため、ページの複製・削除はできません。
        </p>
      )}
      <button
        role="menuitem"
        disabled={readOnly || !page}
        onClick={() => page && act({ kind: "duplicate-page", id: page.id })}
      >
        <Copy size={16} />
        このページを複製
      </button>
      <button
        role="menuitem"
        className="menu-delete"
        disabled={readOnly || !page}
        onClick={() => page && act({ kind: "delete-page", id: page.id })}
      >
        <Trash2 size={16} />
        このページを削除
      </button>
      {menu.row !== undefined && (
        <>
          <div role="separator" className="thumbnail-menu-separator" />
          <button
            role="menuitem"
            disabled={readOnly || !count}
            onClick={() => act({ kind: "duplicate-row", y: menu.row! })}
          >
            <Layers size={16} />
            この段をまとめて複製
          </button>
          <div className="row-copy-count">
            <label>
              複製する段の数
              <input
                type="number"
                min={1}
                max={99}
                aria-label="複製する段の数"
                value={copies}
                disabled={readOnly}
                onChange={(e) => setCopies(Number(e.target.value))}
              />
            </label>
            <button
              role="menuitem"
              disabled={
                readOnly ||
                !count ||
                !Number.isInteger(copies) ||
                copies < 1 ||
                copies > 99
              }
              onClick={() =>
                act({ kind: "duplicate-row", y: menu.row!, count: copies })
              }
            >
              指定数の段を複製
            </button>
          </div>
          <button
            role="menuitem"
            className="menu-delete"
            disabled={readOnly}
            onClick={() => act({ kind: "delete-row", y: menu.row! })}
          >
            <Trash2 size={16} />
            この段をまとめて削除
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
