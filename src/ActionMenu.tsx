import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, MoreHorizontal } from "lucide-react";
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
  showLabel = false,
  portal = false,
  icon,
  text,
  portalContainer,
}: {
  label: string;
  items: ActionItem[];
  primary?: boolean;
  showLabel?: boolean;
  portal?: boolean;
  icon?: ReactNode;
  text?: string;
  portalContainer?: () => HTMLElement | null;
}) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    id = useId();
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const contains = (target: EventTarget | null) =>
    target instanceof Node &&
    (!!root.current?.contains(target) || !!panel.current?.contains(target));
  useLayoutEffect(() => {
    if (!open || !portal) return;
    const update = () => {
      const button = trigger.current,
        menu = panel.current;
      if (!button || !menu) return;
      const width = Math.min(innerWidth, document.documentElement.clientWidth),
        height = Math.min(innerHeight, document.documentElement.clientHeight);
      menu.style.maxWidth = `${Math.max(0, width - 16)}px`;
      menu.style.maxHeight = `${Math.max(0, height - 16)}px`;
      const b = button.getBoundingClientRect(),
        m = menu.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(b.right - m.width, width - m.width - 8),
      );
      const wanted =
        b.bottom + 8 + m.height <= height ? b.bottom + 8 : b.top - m.height - 8;
      const top = Math.max(8, Math.min(wanted, height - m.height - 8));
      setPosition((old) =>
        old.left === left && old.top === top ? old : { left, top },
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, portal]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const buttons = () => [
    ...(panel.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ) ?? []),
  ];
  const menu = open ? (
    <div
      ref={panel}
      id={id}
      role="menu"
      aria-label={label}
      className="action-menu-panel"
      style={
        portal
          ? {
              position: "fixed",
              left: position.left,
              top: position.top,
              right: "auto",
            }
          : undefined
      }
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
  ) : null;
  return (
    <div
      ref={root}
      className="action-menu"
      onBlur={(e) => {
        if (!contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (portal && open && e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          const scope =
            root.current?.closest('[role="dialog"]') ??
            root.current?.closest(".app-shell") ??
            document;
          const candidates = [
            ...scope.querySelectorAll<HTMLElement>(
              "button,a[href],input,select,textarea,[tabindex]",
            ),
          ].filter(
            (node) =>
              !panel.current?.contains(node) &&
              node.tabIndex >= 0 &&
              !node.matches(":disabled") &&
              !node.closest('[inert],[aria-hidden="true"]') &&
              node.getClientRects().length > 0,
          );
          const index = candidates.indexOf(trigger.current!);
          (
            candidates[index + (e.shiftKey ? -1 : 1)] ?? trigger.current
          )?.focus();
          return;
        }
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
        className={`button ${primary ? "primary" : "outline"} action-menu-trigger${showLabel ? " action-menu-labeled" : ""}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setOpen(!open);
          if (!open && portal)
            requestAnimationFrame(() => buttons()[0]?.focus());
        }}
      >
        {showLabel ? (
          <>
            {icon ?? <MoreHorizontal size={17} aria-hidden="true" />}
            <span>{text ?? label}</span>
            {icon && <ChevronDown size={14} aria-hidden="true" />}
          </>
        ) : (
          <ChevronDown size={16} />
        )}
      </button>
      {portal && menu
        ? createPortal(menu, portalContainer?.() ?? document.body)
        : menu}
    </div>
  );
}
