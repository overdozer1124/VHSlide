import type { PointerEvent } from "react";
/** Keep native answer controls and scrollbars interactive when dragging a form. */
export function canDragForm(event: PointerEvent<HTMLElement>): boolean {
  const target = event.target;
  if (
    !(target instanceof Element) ||
    target.closest("input,textarea,select,button,label")
  )
    return false;
  const root = event.currentTarget;
  for (
    let node: Element | null = target;
    node && root.contains(node);
    node = node.parentElement
  ) {
    if (!(node instanceof HTMLElement)) continue;
    const rect = node.getBoundingClientRect();
    if (
      node.scrollHeight > node.clientHeight &&
      node.offsetWidth > node.clientWidth &&
      event.clientX >=
        rect.right -
          (node.offsetWidth - node.clientWidth) *
            (rect.width / node.offsetWidth)
    )
      return false;
    if (
      node.scrollWidth > node.clientWidth &&
      node.offsetHeight > node.clientHeight &&
      event.clientY >=
        rect.bottom -
          (node.offsetHeight - node.clientHeight) *
            (rect.height / node.offsetHeight)
    )
      return false;
  }
  return true;
}
