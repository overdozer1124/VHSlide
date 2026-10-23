import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Plus, MoreHorizontal } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragMoveEvent } from "@dnd-kit/core";
import type { changeSheet } from "./workbook";
type Sheet = { id: string; name: string };
type Action = Parameters<typeof changeSheet>[1];
type Target = { id: string; side: "before" | "after" };

export function SheetTabs({
  sheets,
  activeId,
  onSelect,
  onAction,
}: {
  sheets: Sheet[];
  activeId: string;
  onSelect: (id: string) => void;
  onAction: (action: Action, id: string, value?: string) => boolean;
}) {
  const [menu, setMenu] = useState<string>();
  const [menuX, setMenuX] = useState<number>();
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState<string>();
  const [target, setTarget] = useState<Target>();
  const targetRef = useRef<Target | undefined>(undefined);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const current = sheets.find((s) => s.id === menu);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 280, tolerance: 10 },
    }),
  );
  function openMenu(id: string, x?: number) {
    setMenu(id);
    setMenuX(
      x === undefined
        ? undefined
        : Math.max(8, Math.min(x, window.innerWidth - 310)),
    );
    setName(sheets.find((s) => s.id === id)?.name ?? "");
  }
  function rename(id: string) {
    setMenu(undefined);
    setName(sheets.find((s) => s.id === id)?.name ?? "");
    setEditing(id);
  }
  function finishName(id: string) {
    if (editing !== id) return;
    if (
      name.trim() === sheets.find((s) => s.id === id)?.name ||
      onAction("rename", id, name)
    )
      setEditing(undefined);
  }
  function focusTab(id: string) {
    requestAnimationFrame(() =>
      Array.from(
        barRef.current?.querySelectorAll<HTMLButtonElement>(
          "[data-sheet-id]",
        ) ?? [],
      )
        .find((tab) => tab.dataset.sheetId === id)
        ?.focus(),
    );
  }
  function updateTarget(event: DragMoveEvent) {
    const { active, over } = event;
    let next: Target | undefined;
    const rect = active.rect.current.translated;
    if (over && over.id !== active.id && rect) {
      next = {
        id: String(over.id),
        side:
          rect.left + rect.width / 2 < over.rect.left + over.rect.width / 2
            ? "before"
            : "after",
      };
    }
    targetRef.current = next;
    setTarget((old) =>
      old?.id === next?.id && old?.side === next?.side ? old : next,
    );
  }
  function clearDrag() {
    setDragging(undefined);
    setTarget(undefined);
    targetRef.current = undefined;
    // The pointer release after a drag must not select the drop target.
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }
  useEffect(() => {
    if (!current) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !(event.target as Element).closest("[data-sheet-menu-trigger]")
      )
        setMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(undefined);
        focusTab(current.id);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [current?.id]);
  useEffect(() => {
    if (editing && !sheets.some((s) => s.id === editing)) setEditing(undefined);
  }, [sheets, editing]);
  return (
    <DndContext
      sensors={sensors}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "シートはドラッグで並べ替えできます。タッチは長押し後に移動します。キーボードではシートの操作メニューから左右へ移動できます。",
        },
      }}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => {
        suppressClick.current = true;
        setMenu(undefined);
        setDragging(String(active.id));
      }}
      onDragMove={updateTarget}
      onDragOver={updateTarget}
      onDragCancel={clearDrag}
      onDragEnd={({ active, over }) => {
        const dest = targetRef.current;
        const rect = active.rect.current.translated;
        const bar = barRef.current?.getBoundingClientRect();
        const inside =
          rect &&
          bar &&
          rect.top + rect.height / 2 >= bar.top &&
          rect.top + rect.height / 2 <= bar.bottom;
        if (inside && over && dest && dest.id !== active.id)
          onAction(dest.side, String(active.id), dest.id);
        clearDrag();
      }}
    >
      <div className="sheet-bar" aria-label="シート一覧" ref={barRef}>
        <div className="sheet-tabs" role="tablist" aria-label="作品のシート">
          {sheets.map((s) => (
            <SheetTab
              key={s.id}
              sheet={s}
              active={s.id === activeId}
              editing={s.id === editing}
              name={name}
              setName={setName}
              target={target?.id === s.id ? target.side : undefined}
              onCommit={() => finishName(s.id)}
              onCancel={() => {
                setEditing(undefined);
                focusTab(s.id);
              }}
              onSelect={() => {
                if (suppressClick.current) return;
                if (activeId !== s.id) onSelect(s.id);
                setMenu(undefined);
              }}
              onRename={() => rename(s.id)}
              onMenu={(x) => openMenu(s.id, x)}
            />
          ))}
        </div>
        <button
          className="icon-button"
          aria-label="空のシートを追加"
          title="空のシートを追加"
          onClick={() => {
            setMenu(undefined);
            onAction("add", activeId);
          }}
        >
          <Plus size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="シートの操作"
          aria-expanded={!!current}
          data-sheet-menu-trigger
          onClick={() => {
            if (current) setMenu(undefined);
            else openMenu(activeId);
          }}
        >
          <MoreHorizontal size={18} />
        </button>
        {current && (
          <div
            className="sheet-menu"
            role="region"
            aria-label="シートの操作メニュー"
            ref={menuRef}
            style={
              menuX === undefined
                ? undefined
                : {
                    position: "fixed",
                    left: menuX,
                    bottom:
                      window.innerHeight -
                      (barRef.current?.getBoundingClientRect().top ??
                        window.innerHeight) +
                      6,
                  }
            }
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setMenu(undefined);
                focusTab(current.id);
              }
            }}
          >
            <strong>{current.name}</strong>
            <button onClick={() => rename(current.id)}>名前の変更</button>
            <button
              onClick={() => {
                onAction("duplicate", current.id);
                setMenu(undefined);
              }}
            >
              このシートを複製
            </button>
            <div>
              <button
                disabled={sheets[0].id === current.id}
                onClick={() => onAction("left", current.id)}
              >
                シートを左へ移動
              </button>
              <button
                disabled={sheets.at(-1)!.id === current.id}
                onClick={() => onAction("right", current.id)}
              >
                シートを右へ移動
              </button>
            </div>
            <button
              disabled={sheets.length === 1}
              className="menu-delete"
              onClick={() => {
                onAction("delete", current.id);
                setMenu(undefined);
              }}
            >
              このシートを削除
            </button>
            <button onClick={() => setMenu(undefined)}>閉じる</button>
          </div>
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="sheet-drag-preview">
            {sheets.find((s) => s.id === dragging)?.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
function SheetTab({
  sheet,
  active,
  editing,
  name,
  setName,
  target,
  onCommit,
  onCancel,
  onSelect,
  onRename,
  onMenu,
}: {
  sheet: Sheet;
  active: boolean;
  editing: boolean;
  name: string;
  setName: (name: string) => void;
  target?: "before" | "after";
  onCommit: () => void;
  onCancel: () => void;
  onSelect: () => void;
  onRename: () => void;
  onMenu: (x?: number) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: sheet.id,
    disabled: editing,
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: sheet.id });
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelBlur = useRef(false);
  useEffect(() => {
    if (editing) {
      cancelBlur.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  return (
    <div
      className="sheet-tab-item"
      ref={setDropRef}
      data-insert={target}
      style={{ opacity: isDragging ? 0.35 : 1 } as CSSProperties}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="sheet-name-input"
          aria-label="シート名を編集"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (!cancelBlur.current) onCommit();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancelBlur.current = true;
              onCancel();
            }
          }}
        />
      ) : (
        <button
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          role="tab"
          aria-selected={active}
          data-sheet-id={sheet.id}
          title="ダブルクリックで名前を変更・右クリックでメニュー・ドラッグで移動"
          onClick={onSelect}
          onDoubleClick={onRename}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!isDragging) onMenu(e.clientX);
          }}
          onKeyDown={(e) => {
            if (e.key === "F2") {
              e.preventDefault();
              onRename();
            }
            if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
              e.preventDefault();
              onMenu(e.currentTarget.getBoundingClientRect().left);
            }
          }}
        >
          {sheet.name}
        </button>
      )}
    </div>
  );
}
