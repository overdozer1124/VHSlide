import type { CSSProperties } from "react";
import type { Element } from "./model";
import type { TextAttributes } from "./richText";
export const textFonts = {
  sans: '"Noto Sans JP", sans-serif',
  serif: '"Noto Serif JP", "Yu Mincho", serif',
  mono: "ui-monospace, monospace",
};
export function RichTextView({ element: e }: { element: Element }) {
  if (!e.richText)
    return (
      <div className="slide-text">
        {e.bullets
          ? e.text
              ?.split("\n")
              .map((l) => `• ${l}`)
              .join("\n")
          : e.text}
      </div>
    );
  const lines: {
    parts: { text: string; a: TextAttributes }[];
    a: TextAttributes;
  }[] = [];
  let parts: { text: string; a: TextAttributes }[] = [];
  for (const op of e.richText) {
    const split = op.insert.split("\n");
    split.forEach((value, i) => {
      if (value) parts.push({ text: value, a: op.attributes ?? {} });
      if (i < split.length - 1) {
        lines.push({ parts, a: op.attributes ?? {} });
        parts = [];
      }
    });
  }
  let number = 0;
  return (
    <div className="slide-text rich-text-view">
      {lines.map((line, i) => {
        number = line.a.list === "ordered" ? number + 1 : 0;
        return (
          <div
            className="rich-paragraph"
            key={i}
            style={{
              textAlign: line.a.align ?? "left",
              lineHeight: line.a.lineheight,
            }}
          >
            {line.a.list && (
              <span className="rich-list-marker" aria-hidden="true">
                {line.a.list === "ordered" ? `${number}. ` : "• "}
              </span>
            )}
            {line.parts.map((p, j) => (
              <span
                key={j}
                style={
                  {
                    fontWeight: p.a.bold ? 700 : 400,
                    fontStyle: p.a.italic ? "italic" : undefined,
                    textDecoration:
                      [
                        p.a.underline ? "underline" : "",
                        p.a.strike ? "line-through" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined,
                    color: p.a.color,
                    backgroundColor: p.a.background,
                    fontSize: p.a.size,
                    fontFamily: p.a.font ? textFonts[p.a.font] : undefined,
                  } as CSSProperties
                }
              >
                {p.text}
              </span>
            ))}
            {!line.parts.length && <br />}
          </div>
        );
      })}
    </div>
  );
}
