import { lazy, Suspense, useLayoutEffect, useRef } from "react";
import type { Element } from "./model";
import { useCloudText } from "./CloudContext";
const CloudText = lazy(() =>
  import("./CloudText").then((module) => ({ default: module.CloudText })),
);

export function InlineText(props: {
  element: Element;
  onChange: (text: string) => void;
  onFinish: () => void;
}) {
  const text = useCloudText(props.element.id);
  return text ? (
    <Suspense fallback={<div className="slide-text">{props.element.text}</div>}>
      <CloudText element={props.element} onFinish={props.onFinish} />
    </Suspense>
  ) : (
    <LocalInlineText {...props} />
  );
}

/** Keep the editing DOM stable during React renders and Japanese IME composition. */
function LocalInlineText({
  element,
  onChange,
  onFinish,
}: {
  element: Element;
  onChange: (text: string) => void;
  onFinish: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.textContent = element.text ?? "";
    node.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(node);
    if (element.text !== "ここにことばを入力") range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [element.id]);
  function changed(node: HTMLDivElement) {
    const text = node.innerText.replace(/\r\n/g, "\n");
    if (text.length > 10000) node.textContent = text.slice(0, 10000);
    onChange(text.slice(0, 10000));
  }
  return (
    <div
      ref={ref}
      className="slide-text inline-text"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="スライド内の文字"
      aria-multiline="true"
      spellCheck
      style={{
        fontSize: element.fontSize,
        fontWeight: element.bold ? 700 : 400,
        color: element.color,
        background: element.highlight,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onInput={(event) => changed(event.currentTarget)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          !event.nativeEvent.isComposing &&
          (event.key === "Escape" ||
            ((event.ctrlKey || event.metaKey) && event.key === "Enter"))
        ) {
          event.preventDefault();
          onFinish();
        }
      }}
      onPaste={(event) => {
        if (
          !event.clipboardData.getData("text/plain") &&
          Array.from(event.clipboardData.items).some((item) =>
            item.type.startsWith("image/"),
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const node = event.currentTarget,
          selection = window.getSelection();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!node.contains(range.commonAncestorContainer)) return;
        const available =
          10000 - (node.innerText.length - selection.toString().length);
        const text = document.createTextNode(
          event.clipboardData
            .getData("text/plain")
            .slice(0, Math.max(0, available)),
        );
        range.deleteContents();
        range.insertNode(text);
        range.setStartAfter(text);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        changed(node);
      }}
      onBlur={onFinish}
    />
  );
}
