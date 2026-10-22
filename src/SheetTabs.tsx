import { useState } from "react";
import { Plus, MoreHorizontal } from "lucide-react";
import type { changeSheet } from "./workbook";
export function SheetTabs({
  sheets,
  activeId,
  onSelect,
  onAction,
}: {
  sheets: { id: string; name: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  onAction: (
    action: Parameters<typeof changeSheet>[1],
    id: string,
    name?: string,
  ) => void;
}) {
  const [menu, setMenu] = useState<string>();
  const [name, setName] = useState("");
  const current = sheets.find((s) => s.id === menu);
  return (
    <div className="sheet-bar" aria-label="シート一覧">
      <div className="sheet-tabs" role="tablist" aria-label="作品のシート">
        {sheets.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === activeId}
            onClick={() => {
              onSelect(s.id);
              setMenu(undefined);
            }}
          >
            {s.name}
          </button>
        ))}
      </div>
      <button
        className="icon-button"
        aria-label="空のシートを追加"
        title="空のシートを追加"
        onClick={() => onAction("add", activeId)}
      >
        <Plus size={17} />
      </button>
      <button
        className="icon-button"
        aria-label="シートの操作"
        aria-expanded={!!current}
        onClick={() => {
          setMenu(current ? undefined : activeId);
          setName(sheets.find((s) => s.id === activeId)!.name);
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      {current && (
        <div
          className="sheet-menu"
          role="region"
          aria-label="シートの操作メニュー"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") setMenu(undefined);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAction("rename", current.id, name);
              setMenu(undefined);
            }}
          >
            <input
              aria-label="シート名"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button disabled={!name.trim()}>名前を変更</button>
          </form>
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
  );
}
