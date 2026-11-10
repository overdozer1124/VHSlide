import type { Element, Shape } from "./model";
import { alignRichParagraphs, textDelta } from "./richText";
import type { TextFont } from "./richText";

export type MultiTextPatch = Pick<
  Partial<Element>,
  "fontSize" | "color" | "bold" | "textAlign" | "verticalAlign" | "writingMode"
> & {
  font?: TextFont;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
};
export const isFormattableText = (e: Element) =>
  !e.survey &&
  !e.worksheet &&
  !e.responseField &&
  (e.type === "text" || (e.type === "shape" && e.text !== undefined));
export function formatSelectedText(
  elements: Element[],
  selectedIds: string[],
  patch: MultiTextPatch,
): Element[] {
  const selected = new Set(selectedIds);
  const { font, italic, underline, strike, ...base } = patch;
  const hasCharacterStyle =
    font !== undefined ||
    italic !== undefined ||
    underline !== undefined ||
    strike !== undefined;
  return elements.map((element) => {
    if (!selected.has(element.id) || !isFormattableText(element))
      return element;
    const { writingMode, ...common } = base;
    const next = {
      ...element,
      ...common,
      ...(element.type === "text" && writingMode !== undefined
        ? { writingMode }
        : {}),
    };
    if (!element.richText && !hasCharacterStyle) return next;
    let rich = textDelta(element);
    if (base.textAlign !== undefined)
      rich = alignRichParagraphs(rich, base.textAlign);
    rich = rich.flatMap((op) =>
      op.insert
        .split(/(\n)/)
        .filter(Boolean)
        .map((insert) => {
          if (insert === "\n") return { ...op, insert };
          const attributes = { ...op.attributes };
          if (base.fontSize !== undefined)
            attributes.size = `${Math.round(base.fontSize)}px`;
          if (base.color !== undefined) attributes.color = base.color;
          if (base.bold !== undefined) {
            if (base.bold) attributes.bold = true;
            else delete attributes.bold;
          }
          if (font !== undefined) {
            if (font === "sans") delete attributes.font;
            else attributes.font = font;
          }
          for (const [key, value] of [
            ["italic", italic],
            ["underline", underline],
            ["strike", strike],
          ] as const) {
            if (value === true) attributes[key] = true;
            else if (value === false) delete attributes[key];
          }
          return Object.keys(attributes).length
            ? { insert, attributes }
            : { insert };
        }),
    );
    return { ...next, richText: rich };
  });
}
export function formatSelectedShapes(
  elements: Element[],
  selectedIds: string[],
  patch: { shape?: Shape; fill?: string; stroke?: string },
): Element[] {
  const selected = new Set(selectedIds);
  return elements.map((e) =>
    selected.has(e.id) &&
    e.type === "shape" &&
    !e.survey &&
    !e.worksheet &&
    !e.responseField
      ? { ...e, ...patch }
      : e,
  );
}
