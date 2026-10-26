import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
export type ActionItem = {
  label: string;
  detail?: string;
  action: () => void;
  disabled?: boolean;
};
/** The adjacent primary button keeps its one-click action. */
export function ActionMenu({
  label,
  items,
  primary = false,
}: {
  label: string;
  items: ActionItem[];
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const buttons = () => [
    ...root.current!.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ),
  ];
  return (
    <div
      ref={root}
      className="action-menu"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
          requestAnimationFrame(() => {
            const list = buttons(),
              i = list.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? list.length - 1
                  : e.key === "ArrowDown"
                    ? (i + 1) % list.length
                    : i < 0
                      ? list.length - 1
                      : (i - 1 + list.length) % list.length;
            list[next]?.focus();
          });
        }
      }}
    >
      <button
        ref={trigger}
        className={`button ${primary ? "primary" : "outline"} action-menu-trigger`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={16} />
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className="action-menu-panel"
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
                item.action();
              }}
            >
              <strong>{item.label}</strong>
              {item.detail && <small>{item.detail}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
