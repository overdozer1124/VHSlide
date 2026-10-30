import { useEffect, useLayoutEffect, useRef } from "react";
import { captureRichEditingFocus } from "./CloudText";
function captureFocus() {
  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined;
  const rich = active ? captureRichEditingFocus(active) : undefined;
  const input =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? active
      : undefined;
  const selection = input
    ? {
        start: input.selectionStart,
        end: input.selectionEnd,
        direction: input.selectionDirection,
      }
    : undefined;
  const domSelection = window.getSelection(),
    range = domSelection?.rangeCount
      ? domSelection.getRangeAt(0).cloneRange()
      : undefined;
  const scrolls: { node: HTMLElement; left: number; top: number }[] = [];
  for (let p = active; p; p = p.parentElement ?? undefined)
    scrolls.push({ node: p, left: p.scrollLeft, top: p.scrollTop });
  return () => {
    if (!active?.isConnected) return;
    if (rich) rich();
    else {
      active.focus({ preventScroll: true });
      if (
        input &&
        selection?.start !== null &&
        selection?.end !== null &&
        selection
      ) {
        try {
          input.setSelectionRange(
            selection.start,
            selection.end,
            selection.direction ?? undefined,
          );
        } catch {}
      } else if (
        range &&
        range.startContainer.isConnected &&
        range.endContainer.isConnected
      ) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
    for (const s of scrolls)
      if (s.node.isConnected) {
        s.node.scrollLeft = s.left;
        s.node.scrollTop = s.top;
      }
  };
}
/** Keep the original editor mounted; finish only composition that began before interruption. */
export function useFollowLock(active: boolean) {
  const activeRef = useRef(active),
    composing = useRef<EventTarget | null>(null);
  activeRef.current = active;
  useEffect(() => {
    const start = (event: Event) => {
      if (!activeRef.current) composing.current = event.target;
    };
    const end = () => {
      if (!activeRef.current) composing.current = null;
    };
    window.addEventListener("compositionstart", start, true);
    window.addEventListener("compositionend", end, true);
    return () => {
      window.removeEventListener("compositionstart", start, true);
      window.removeEventListener("compositionend", end, true);
    };
  }, []);
  useLayoutEffect(() => {
    if (!active) return;
    document.documentElement.dataset.hostFollow = "active";
    let restore = captureFocus(),
      pending = composing.current,
      completion: ReturnType<typeof setTimeout> | undefined;
    const overlay = () =>
      document.querySelector<HTMLElement>(".host-follow-overlay");
    const focusOverlay = () => overlay()?.focus({ preventScroll: true });
    if (!pending) focusOverlay();
    const block = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const insidePending = (target: EventTarget | null) =>
      pending instanceof Node &&
      target instanceof Node &&
      (pending === target || pending.contains(target));
    const keys = (event: KeyboardEvent) => {
      if (
        event.key === "F5" ||
        ((event.ctrlKey || event.metaKey) &&
          ["r", "l", "w", "t", "n"].includes(event.key.toLowerCase()))
      )
        return;
      if (
        pending &&
        insidePending(event.target) &&
        (event.isComposing ||
          event.keyCode === 229 ||
          [
            "Enter",
            "Escape",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
          ].includes(event.key))
      )
        return;
      block(event);
    };
    const input = (event: Event) => {
      if (!pending || !insidePending(event.target)) block(event);
    };
    const finish = (event: Event) => {
      if (!insidePending(event.target)) return;
      clearTimeout(completion);
      completion = setTimeout(() => {
        restore = captureFocus();
        pending = null;
        composing.current = null;
        focusOverlay();
      }, 0);
    };
    const pointer = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".host-follow-overlay")
      )
        block(event);
    };
    const focus = (event: Event) => {
      if (
        !pending &&
        event.target instanceof Element &&
        !event.target.closest(".host-follow-overlay")
      )
        focusOverlay();
    };
    window.addEventListener("keydown", keys, true);
    window.addEventListener("beforeinput", input, true);
    window.addEventListener("compositionend", finish, true);
    window.addEventListener("focusin", focus, true);
    for (const name of ["paste", "cut", "drop"])
      window.addEventListener(name, block, true);
    for (const name of ["pointerdown", "pointermove", "click", "dblclick"])
      window.addEventListener(name, pointer, true);
    return () => {
      clearTimeout(completion);
      delete document.documentElement.dataset.hostFollow;
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("beforeinput", input, true);
      window.removeEventListener("compositionend", finish, true);
      window.removeEventListener("focusin", focus, true);
      for (const name of ["paste", "cut", "drop"])
        window.removeEventListener(name, block, true);
      for (const name of ["pointerdown", "pointermove", "click", "dblclick"])
        window.removeEventListener(name, pointer, true);
      restore();
    };
  }, [active]);
}
