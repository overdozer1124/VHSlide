import { useLayoutEffect, useRef } from "react";
import Quill from "quill";
import { QuillBinding } from "y-quill";
import type { Element } from "./model";
import { useCloudText } from "./CloudContext";
export function CloudText({
  element,
  onFinish,
}: {
  element: Element;
  onFinish: () => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const value = useCloudText(element.id);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  useLayoutEffect(() => {
    if (!target.current || !value) return;
    const node = target.current;
    const quill = new Quill(node, {
      modules: { toolbar: false, history: false },
      formats: [],
    });
    const binding = new QuillBinding(value, quill);
    const clamp = () => {
      if (value.length > 10000)
        quill.deleteText(10000, value.length - 10000, "user");
    };
    quill.on("text-change", clamp);
    quill.root.setAttribute("role", "textbox");
    quill.root.setAttribute("aria-label", "スライド内の文字");
    quill.root.setAttribute("aria-multiline", "true");
    quill.focus();
    quill.setSelection(
      element.text === "ここにことばを入力" ? 0 : value.length,
      element.text === "ここにことばを入力" ? value.length : 0,
    );
    const blur = () => finish.current();
    quill.root.addEventListener("blur", blur);
    return () => {
      binding.destroy();
      quill.off("text-change", clamp);
      quill.root.removeEventListener("blur", blur);
      node.replaceChildren();
    };
  }, [element.id, value]);
  return (
    <div
      ref={target}
      className="slide-text inline-text cloud-text"
      style={{
        fontSize: element.fontSize,
        fontWeight: element.bold ? 700 : 400,
        color: element.color,
        background: element.highlight,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          !event.nativeEvent.isComposing &&
          (event.key === "Escape" ||
            ((event.ctrlKey || event.metaKey) && event.key === "Enter"))
        ) {
          event.preventDefault();
          finish.current();
        }
      }}
    />
  );
}
