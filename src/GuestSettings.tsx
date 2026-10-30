import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";

/** Form controls live in a settings panel, not in an arrow-key action menu. */
export function GuestSettings({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector("select")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <div
      ref={root}
      className="guest-settings"
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
        }
      }}
    >
      <button
        ref={trigger}
        className="button outline"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span>ゲストの設定</span>
      </button>
      {open && (
        <section
          id={id}
          role="dialog"
          aria-label="ゲストの表示設定"
          className="guest-settings-panel"
        >
          <h2>ゲストの設定</h2>
          {children}
        </section>
      )}
    </div>
  );
}
