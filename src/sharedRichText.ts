import { textDifference } from "./textDiff.ts";
import { parseRichText, richPlain } from "./richText.ts";
import * as Y from "yjs";
import type { RichOp, TextAttributes } from "./richText.ts";
import { textDelta } from "./richText.ts";
/** Apply only changed characters/attributes, preserving unrelated concurrent formatting. */
export function changeRichText(
  target: Y.Text,
  before: RichOp[],
  after: RichOp[],
) {
  const chars = (ops: RichOp[]) =>
    ops.flatMap((o) =>
      Array.from({ length: o.insert.length }, (_, i) => ({
        char: o.insert[i],
        attrs: o.attributes ?? {},
      })),
    );
  const a = chars(before),
    b = chars(after);
  const { start, suffix } = textDifference(
    a.map((c) => c.char).join(""),
    b.map((c) => c.char).join(""),
  );
  if (a.length - start - suffix)
    target.delete(start, a.length - start - suffix);
  let at = start;
  while (at < b.length - suffix) {
    let end = at + 1;
    while (
      end < b.length - suffix &&
      JSON.stringify(b[end].attrs) === JSON.stringify(b[at].attrs)
    )
      end++;
    target.insert(
      at,
      b
        .slice(at, end)
        .map((c) => c.char)
        .join(""),
      b[at].attrs,
    );
    at = end;
  }
  const patches: (Record<string, unknown> | undefined)[] = Array(b.length);
  for (let i = 0; i < b.length; i++) {
    if (i >= start && i < b.length - suffix) continue;
    const old = a[i < start ? i : a.length - (b.length - i)]?.attrs ?? {},
      next = b[i].attrs;
    const patch: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      const k = key as keyof TextAttributes;
      if (old[k] !== next[k]) patch[k] = next[k] ?? null;
    }
    if (Object.keys(patch).length) patches[i] = patch;
  }
  for (let i = 0; i < patches.length;) {
    if (!patches[i]) {
      i++;
      continue;
    }
    let end = i + 1;
    while (
      end < patches.length &&
      JSON.stringify(patches[end]) === JSON.stringify(patches[i])
    )
      end++;
    target.format(i, end - i, patches[i]!);
    i = end;
  }
}
/** Migration retains existing Y.Text character identities; it is not an undoable edit. */
export function enableRichText(
  value: Y.Text,
  element: {
    text?: string;
    richText?: RichOp[];
    bold?: boolean;
    bullets?: boolean;
    textAlign?: "left" | "center" | "right";
  },
) {
  const item = value.parent;
  if (!(item instanceof Y.Map) || item.get("richText") === true) return;
  value.doc!.transact(() => {
    value.insert(value.length, "\n", { [TERMINAL]: true });
    const before = [{ insert: value.toString() }];
    const after = textDelta({
      ...element,
      text: value.toString().slice(0, -1),
    });
    changeRichText(value, before, after);
    item.set("richText", true);
  }, "vhslide-rich-init");
}

const TERMINAL = "__vh_terminal";
function terminals(value: Y.Text) {
  const indexes: number[] = [];
  let index = 0;
  for (const op of value.toDelta()) {
    if (typeof op.insert !== "string")
      throw new Error("文字の共有データが正しくありません。");
    if (op.attributes?.[TERMINAL] !== undefined) {
      if (op.attributes[TERMINAL] !== true || !/^\n+$/.test(op.insert))
        throw new Error("文字の終端が正しくありません。");
      for (let i = 0; i < op.insert.length; i++) indexes.push(index + i);
    }
    index += op.insert.length;
  }
  if (index > 11001 || indexes.length > 1000)
    throw new Error("文字が長すぎます。");
  return indexes;
}
/** Concurrent first-time migrations may each add one terminal. Keep a deterministic last one. */
export function normalizeRichTerminals(value: Y.Text) {
  const ends = terminals(value);
  if (ends.length < 2) return;
  value.doc!.transact(() => {
    for (let i = ends.length - 2; i >= 0; i--) value.delete(ends[i], 1);
  }, "vhslide-rich-init");
}
export function sharedRichDelta(value: Y.Text): RichOp[] {
  const ends = terminals(value),
    keep = ends.at(-1);
  let index = 0;
  const delta: RichOp[] = [];
  for (const op of value.toDelta()) {
    const attributes = { ...op.attributes };
    const marked = attributes[TERMINAL] === true;
    delete attributes[TERMINAL];
    const insert = marked
      ? Array.from({ length: op.insert.length }, (_, i) =>
          index + i === keep ? "\n" : "",
        ).join("")
      : op.insert;
    index += op.insert.length;
    if (insert)
      delta.push({
        insert,
        ...(Object.keys(attributes).length ? { attributes } : {}),
      });
  }
  return parseRichText(delta, richPlain(delta));
}
