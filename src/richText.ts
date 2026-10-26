/** Safe, serializable Quill/Y.Text insert delta; no embeds, HTML, URLs or arbitrary CSS. */
export type TextAttributes = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  background?: string;
  size?: string;
  font?: "sans" | "serif" | "mono";
  align?: "center" | "right" | "justify";
  list?: "bullet" | "ordered";
  lineheight?: "1" | "1.25" | "1.5" | "2";
};
export type RichOp = { insert: string; attributes?: TextAttributes };
/** Whole-box alignment formats every paragraph, preserving character styles. */
export function alignRichParagraphs(
  ops: RichOp[],
  align: "left" | "center" | "right",
): RichOp[] {
  return ops.flatMap((op) =>
    op.insert
      .split(/(\n)/)
      .filter(Boolean)
      .map((insert) => {
        if (insert !== "\n") return { ...op, insert };
        const attributes = { ...op.attributes };
        if (align === "left") delete attributes.align;
        else attributes.align = align;
        return Object.keys(attributes).length
          ? { insert, attributes }
          : { insert };
      }),
  );
}
export const RICH_FORMATS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "color",
  "background",
  "size",
  "font",
  "align",
  "list",
  "lineheight",
];
export function parseRichText(input: unknown, plain: string): RichOp[] {
  const fail = (): never => {
    throw new Error("文字の書式データが正しくありません。");
  };
  if (!Array.isArray(input) || input.length > 20000) return fail();
  let length = 0;
  const ops: RichOp[] = input.map((op) => {
    if (
      !op ||
      typeof op !== "object" ||
      typeof op.insert !== "string" ||
      !op.insert.length ||
      Object.keys(op).some((k) => !["insert", "attributes"].includes(k))
    )
      return fail();
    for (const char of op.insert)
      if (
        char.length === 1 &&
        char.charCodeAt(0) >= 0xd800 &&
        char.charCodeAt(0) <= 0xdfff
      )
        return fail();
    length += op.insert.length;
    if (length > 10001) return fail();
    const attributes: Record<string, unknown> = {};
    if (op.attributes !== undefined) {
      if (
        !op.attributes ||
        typeof op.attributes !== "object" ||
        Array.isArray(op.attributes)
      )
        return fail();
      for (const [key, value] of Object.entries(op.attributes)) {
        if (!RICH_FORMATS.includes(key)) return fail();
        if (["bold", "italic", "underline", "strike"].includes(key)) {
          if (typeof value !== "boolean") return fail();
        } else if (["color", "background"].includes(key)) {
          if (typeof value !== "string" || !/^#[\da-fA-F]{6}$/.test(value))
            return fail();
        } else if (key === "size") {
          if (
            typeof value !== "string" ||
            !/^\d+px$/.test(value) ||
            Number.parseInt(value) < 12 ||
            Number.parseInt(value) > 120
          )
            return fail();
        } else if (key === "font") {
          if (!["sans", "serif", "mono"].includes(value as string))
            return fail();
        } else if (key === "align") {
          if (!["center", "right", "justify"].includes(value as string))
            return fail();
        } else if (key === "list") {
          if (!["bullet", "ordered"].includes(value as string)) return fail();
        } else if (key === "lineheight") {
          if (!["1", "1.25", "1.5", "2"].includes(value as string))
            return fail();
        }
        // Block formatting belongs only on newline inserts.
        if (
          ["align", "list", "lineheight"].includes(key) &&
          !/^\n+$/.test(op.insert)
        )
          return fail();
        attributes[key] = value;
      }
    }
    return {
      insert: op.insert,
      ...(Object.keys(attributes).length
        ? { attributes: attributes as TextAttributes }
        : {}),
    };
  });
  if (ops.map((o) => o.insert).join("") !== plain + "\n") return fail();
  const merged: RichOp[] = [];
  for (const op of ops) {
    const last = merged.at(-1);
    if (
      last &&
      JSON.stringify(last.attributes ?? {}) ===
        JSON.stringify(op.attributes ?? {})
    )
      last.insert += op.insert;
    else merged.push(op);
  }
  return merged;
}
export function richPlain(ops: RichOp[]): string {
  return ops
    .map((o) => o.insert)
    .join("")
    .replace(/\n$/, "");
}
export function textDelta(e: {
  text?: string;
  richText?: RichOp[];
  bold?: boolean;
  bullets?: boolean;
  textAlign?: "left" | "center" | "right";
}): RichOp[] {
  if (e.richText) return e.richText;
  const lines = (e.text ?? "").split("\n");
  return lines.flatMap((line) => [
    ...(line
      ? [{ insert: line, ...(e.bold ? { attributes: { bold: true } } : {}) }]
      : []),
    {
      insert: "\n",
      ...(e.bullets || (e.textAlign && e.textAlign !== "left")
        ? {
            attributes: {
              ...(e.bullets ? { list: "bullet" as const } : {}),
              ...(e.textAlign && e.textAlign !== "left"
                ? { align: e.textAlign }
                : {}),
            },
          }
        : {}),
    },
  ]);
}
export function cleanEditorDelta(
  ops: { insert?: unknown; attributes?: Record<string, unknown> }[],
): RichOp[] {
  // The editor has a format allowlist. Normalize Quill's rgb colors into safe hex.
  return ops
    .filter((o) => typeof o.insert === "string" && o.insert.length)
    .map((o) => {
      const a: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o.attributes ?? {})) {
        if (!RICH_FORMATS.includes(k) || v === null || v === false) continue;
        let value = v;
        if (k === "color" || k === "background") {
          const rgb = String(v).match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (rgb)
            value =
              "#" +
              rgb
                .slice(1, 4)
                .map((n) => Number(n).toString(16).padStart(2, "0"))
                .join("");
          if (/^#[\da-f]{3}$/i.test(String(value)))
            value =
              "#" +
              String(value)
                .slice(1)
                .split("")
                .map((c) => c + c)
                .join("");
        }
        a[k] = value;
      }
      return {
        insert: o.insert as string,
        ...(Object.keys(a).length ? { attributes: a as TextAttributes } : {}),
      };
    });
}
