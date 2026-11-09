import type { PointerEvent } from "react";
/** Keep native answer controls and scrollbars interactive when dragging a form. */
export function canDragForm(event: PointerEvent<HTMLElement>): boolean {
  const target = event.target;
  if (
    !(target instanceof Element) ||
    target.closest("input,textarea,select,button,canvas")
  )
    return false;
  const label = target.closest("label");
  if (
    label instanceof HTMLLabelElement &&
    label.control &&
    !(label.control instanceof HTMLTextAreaElement)
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
      node.offsetWidth > 0 &&
      event.clientX >=
        rect.right -
          Math.max(16, node.offsetWidth - node.clientWidth) *
            (rect.width / node.offsetWidth)
    )
      return false;
    if (
      node.scrollWidth > node.clientWidth &&
      node.offsetHeight > 0 &&
      event.clientY >=
        rect.bottom -
          Math.max(16, node.offsetHeight - node.clientHeight) *
            (rect.height / node.offsetHeight)
    )
      return false;
  }
  return true;
}
