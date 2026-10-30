import { useLayoutEffect, useRef } from "react";
import Quill, { Delta, Parchment } from "quill";
import { QuillBinding } from "y-quill";
import * as Y from "yjs";
import type { Element } from "./model";
import { useCloudText } from "./CloudContext";
import {
  cleanEditorDelta,
  parseRichText,
  richPlain,
  textDelta,
  RICH_FORMATS,
} from "./richText";
import {
  enableRichText,
  changeRichText,
  normalizeRichTerminals,
} from "./sharedRichText";
import type { TextController } from "./TextSelectionControls";
// Fixed allowlists: no arbitrary CSS classes, URLs, fonts or embedded content.
const Size = Quill.import(
  "attributors/style/size",
) as Parchment.StyleAttributor;
Size.whitelist = Array.from({ length: 109 }, (_, i) => `${i + 12}px`);
Quill.register(Size, true);
const Font = Quill.import(
  "attributors/class/font",
) as Parchment.ClassAttributor;
Font.whitelist = ["sans", "serif", "mono"];
Quill.register(Font, true);
Quill.register(
  new Parchment.StyleAttributor("lineheight", "line-height", {
    scope: Parchment.Scope.BLOCK,
    whitelist: ["1", "1.25", "1.5", "2"],
  }),
  true,
);
export type RichEditorProps = {
  element: Element;
  onChange: (patch: Partial<Element>) => void;
  onFinish: () => void;
  onController?: (control?: TextController) => void;
  onUndo?: () => void;
  onRedo?: () => void;
};
const focusRestorers = new WeakMap<HTMLElement, () => () => void>();
export function captureRichEditingFocus(element: HTMLElement) {
  return focusRestorers.get(element)?.();
}
export function CloudText({ element, ...props }: RichEditorProps) {
  const target = useRef<HTMLDivElement>(null),
    shared = useCloudText(element.id),
    latest = useRef({ ...props, element });
  latest.current = { ...props, element };
  const instance = useRef<
    { quill: Quill; value: Y.Text; local: boolean } | undefined
  >(undefined);
  useLayoutEffect(() => {
    const node = target.current;
    if (!node) return;
    let localDoc: Y.Doc | undefined;
    const value = shared ?? (localDoc = new Y.Doc()).getText("content");
    if (shared) {
      enableRichText(shared, element);
      normalizeRichTerminals(shared);
    } else value.applyDelta(textDelta(element));
    const quill = new Quill(node, {
      modules: { toolbar: false, history: false },
      formats: RICH_FORMATS,
    });
    const binding = new QuillBinding(value, quill);
    instance.current = { quill, value, local: !shared };
    let range = { index: 0, length: 0 },
      composing = false;
    const publish = () => {
      latest.current.onController?.({
        id: element.id,
        defaultSize: latest.current.element.fontSize ?? 24,
        length: range.length,
        formats: quill.getFormat(range.index, range.length),
        format: (name, v) => {
          quill.focus({ preventScroll: true });
          quill.setSelection(range.index, range.length, "silent");
          if (["align", "list", "lineheight"].includes(name))
            quill.formatLine(
              range.index,
              Math.max(1, range.length),
              name,
              v,
              "user",
            );
          else if (range.length)
            quill.formatText(range.index, range.length, name, v, "user");
          else quill.format(name, v, "user");
          publish();
        },
        clear: () => {
          if (range.length)
            quill.removeFormat(range.index, range.length, "user");
          quill.focus({ preventScroll: true });
          quill.setSelection(range.index, range.length, "silent");
          publish();
        },
      });
    };
    const selection = (r: { index: number; length: number } | null) => {
      if (r) range = r;
      publish();
    };
    const changed = (event: Y.YTextEvent) => {
      if (shared) normalizeRichTerminals(shared);
      if (event.transaction.origin === "server") {
        publish();
        return;
      }
      if (value.length > 10001) {
        quill.deleteText(10000, value.length - 10001, "user");
        return;
      }
      if (!shared) {
        const delta = cleanEditorDelta(value.toDelta());
        const plain = richPlain(delta);
        latest.current.onChange({
          text: plain,
          richText: parseRichText(delta, plain),
        });
      }
      publish();
    };
    value.observe(changed);
    quill.on("selection-change", selection);
    quill.on("text-change", publish);
    const root = quill.root;
    root.setAttribute("role", "textbox");
    root.setAttribute("aria-label", "スライド内の文字");
    root.setAttribute("aria-multiline", "true");
    root.spellcheck = true;
    focusRestorers.set(root, () => {
      const r = quill.getSelection() ?? range;
      const a = Y.createRelativePositionFromTypeIndex(value, r.index),
        b = Y.createRelativePositionFromTypeIndex(value, r.index + r.length);
      return () => {
        if (!root.isConnected || composing || !value.doc) return;
        const start = Y.createAbsolutePositionFromRelativePosition(
            a,
            value.doc,
          ),
          end = Y.createAbsolutePositionFromRelativePosition(b, value.doc);
        quill.focus({ preventScroll: true });
        quill.setSelection(
          start?.index ?? r.index,
          Math.max(
            0,
            (end?.index ?? r.index + r.length) - (start?.index ?? r.index),
          ),
          "api",
        );
      };
    });
    const blur = (event: FocusEvent) => {
      if (document.documentElement.dataset.hostFollow === "active") return;
      if ((event.relatedTarget as HTMLElement | null)?.closest(".inspector"))
        return;
      latest.current.onFinish();
    };
    const start = () => {
      composing = true;
      root.dataset.composing = "true";
    };
    const end = () => {
      composing = false;
      delete root.dataset.composing;
    };
    const keys = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.isComposing || composing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) latest.current.onRedo?.();
        else latest.current.onUndo?.();
      }
      if (
        e.key === "Escape" ||
        ((e.ctrlKey || e.metaKey) && e.key === "Enter")
      ) {
        e.preventDefault();
        latest.current.onFinish();
      }
    };
    const paste = (e: ClipboardEvent) => {
      const input = e.clipboardData?.getData("text/plain");
      if (input === undefined) return;
      if (
        !input &&
        Array.from(e.clipboardData?.items ?? []).some((i) =>
          i.type.startsWith("image/"),
        )
      ) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const r = quill.getSelection(true) ?? range;
      const room = 10000 - (quill.getLength() - 1 - r.length),
        text = input.slice(0, Math.max(0, room));
      quill.updateContents(
        new Delta().retain(r.index).delete(r.length).insert(text),
        "user",
      );
      quill.setSelection(r.index + text.length, 0, "silent");
    };
    root.addEventListener("blur", blur);
    root.addEventListener("keydown", keys);
    root.addEventListener("compositionstart", start);
    root.addEventListener("compositionend", end);
    root.addEventListener("paste", paste, true);
    quill.focus({ preventScroll: true });
    quill.setSelection(
      element.text === "ここにことばを入力" ? 0 : Math.max(0, value.length - 1),
      element.text === "ここにことばを入力" ? value.length - 1 : 0,
      "silent",
    );
    range = quill.getSelection() ?? range;
    publish();
    return () => {
      instance.current = undefined;
      focusRestorers.delete(root);
      latest.current.onController?.();
      binding.destroy();
      value.unobserve(changed);
      quill.off("selection-change", selection);
      quill.off("text-change", publish);
      root.removeEventListener("blur", blur);
      root.removeEventListener("keydown", keys);
      root.removeEventListener("compositionstart", start);
      root.removeEventListener("compositionend", end);
      root.removeEventListener("paste", paste, true);
      node.replaceChildren();
      localDoc?.destroy();
    };
  }, [element.id, shared]);
  useLayoutEffect(() => {
    const i = instance.current;
    if (!i?.local) return;
    const delta = textDelta(element);
    if (
      JSON.stringify(delta) !==
      JSON.stringify(cleanEditorDelta(i.value.toDelta()))
    )
      i.value.doc!.transact(
        () =>
          changeRichText(i.value, cleanEditorDelta(i.value.toDelta()), delta),
        "server",
      );
  }, [
    element.text,
    element.richText,
    element.bold,
    element.bullets,
    element.textAlign,
  ]);
  return (
    <div
      ref={target}
      className="slide-text inline-text cloud-text rich-editing"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
